import { describe, expect, it, vi } from 'vitest';
import { WorkerClusterRuntime } from '../src/core/cluster';
import { approximatePayloadBytes } from '../src/core/routing';
import type { WorkerControlAction, WorkerRecord } from '../src/core/types';
import type { WorkerClusterMessage } from '../src/core/types';
import { CLUSTER_MESSAGE_TYPE } from '../src/utils/constants';
import { ChannelHub, createFakeEnvironment, MemoryStorage } from './fakes';

describe('WorkerClusterRuntime', () => {
  it('keeps one topic owner and migrates it when the owner stops', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'wss://example.test/connection',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'wss://example.test/connection',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });

    runtimeA.start();
    now += 1;
    runtimeB.start();
    runtimeA.subscribe('market.tick.BTCUSDT');
    await Promise.resolve();
    runtimeB.subscribe('market.tick.BTCUSDT');
    await Promise.resolve();

    expect(controlA).toHaveBeenCalledWith('SUBSCRIBE', 'market.tick.BTCUSDT', undefined);
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'market.tick.BTCUSDT', undefined);
    expect(runtimeA.isAssigned('market.tick.BTCUSDT')).toBe(true);
    expect(runtimeB.isAssigned('market.tick.BTCUSDT')).toBe(false);

    runtimeA.stop();

    expect(runtimeB.isAssigned('market.tick.BTCUSDT')).toBe(true);
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'market.tick.BTCUSDT', undefined);
    expect(runtimeB.getSnapshot().workers.map(worker => worker.workerId)).toEqual(['worker-b']);
  });

  it('publishes through the synchronous local assignment without rereading storage', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'fast-publish' });
    const control = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'publish-fast-path',
      environment: env.environment,
      tabId: 'tab-fast-publish',
      workerId: 'worker-fast-publish',
      handlers: { onControl: control, onEvent: vi.fn() }
    });

    runtime.start();
    runtime.subscribe('hot-topic');
    await Promise.resolve();
    const getItem = vi.spyOn(storage, 'getItem');

    expect(runtime.publish('hot-topic', { value: 1 })).toBe(true);
    expect(control).toHaveBeenLastCalledWith('PUBLISH', 'hot-topic', { value: 1 });
    expect(getItem).not.toHaveBeenCalled();
  });

  it('preserves publish order and avoids storage reads during a burst', async () => {
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'publish-burst' });
    const control = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'publish-burst',
      environment: env.environment,
      tabId: 'tab-publish-burst',
      workerId: 'worker-publish-burst',
      handlers: { onControl: control, onEvent: vi.fn() }
    });

    runtime.start();
    runtime.subscribe('hot-topic');
    await Promise.resolve();
    control.mockClear();
    const getItem = vi.spyOn(storage, 'getItem');

    for (let index = 0; index < 1_000; index += 1) {
      expect(runtime.publish('hot-topic', { sequence: index })).toBe(true);
    }

    expect(getItem).not.toHaveBeenCalled();
    expect(control).toHaveBeenCalledTimes(1_000);
    expect(control.mock.calls.map(call => (call[2] as { sequence: number }).sequence)).toEqual(
      Array.from({ length: 1_000 }, (_, index) => index)
    );
  });

  it('preserves publication metadata across a remote owner control message', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'metadata-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'metadata-b' });
    const controlA = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'metadata-routing',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'metadata-routing',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('market.tick');
    await Promise.resolve();
    now += 1;
    runtimeB.start();

    expect(runtimeB.publish('market.tick', { price: 1 }, {
      messageId: 'm-1',
      timestamp: 42
    })).toBe(true);
    expect(controlA).toHaveBeenLastCalledWith(
      'PUBLISH',
      'market.tick',
      { price: 1 },
      'm-1',
      42
    );
  });

  it('keeps existing topic owners and balances only newly introduced topics', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'sticky-existing-routes',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'sticky-existing-routes',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    const existingTopics = ['public:STONEX:GCZ6', 'public:SCP01:XAUUSD', 'public:AutoGen:XAUFutureSpot.032'];

    runtimeA.start();
    for (const topic of existingTopics) runtimeA.subscribe(topic);
    await Promise.resolve();
    now += 1;
    runtimeB.start();
    for (const topic of existingTopics) runtimeB.subscribe(topic);
    await Promise.resolve();

    expect(runtimeA.getSnapshot().assignedTopics).toEqual(expect.arrayContaining(existingTopics));
    expect(runtimeB.getSnapshot().assignedTopics).toEqual([]);
    for (const topic of existingTopics) {
      expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', topic, undefined);
    }

    runtimeB.subscribe('public:new-topic');
    await Promise.resolve();

    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'public:new-topic', undefined);
    expect(runtimeB.isAssigned('public:new-topic')).toBe(true);
  });

  it('unsubscribes the old owner before handing off an owned topic on pagehide', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'reload-handoff',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'reload-handoff',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    now += 1;
    runtimeB.start();
    runtimeA.subscribe('shared-topic');
    await Promise.resolve();
    runtimeB.subscribe('shared-topic');
    await Promise.resolve();
    controlA.mockClear();
    controlB.mockClear();

    envA.pageHide();
    await Promise.resolve();

    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'shared-topic');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'shared-topic', undefined);
    expect(runtimeB.isAssigned('shared-topic')).toBe(true);
  });

  it('does not recreate a handed-off route after the surviving tab unsubscribes', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'handoff-unsub' });
    const control = vi.fn();
    const runtime = new WorkerClusterRuntime({ clusterKey: 'handoff-unsub', environment: env.environment, tabId: 'tab-a', workerId: 'worker-a', handlers: { onControl: control, onEvent: vi.fn() } });
    runtime.start();
    runtime.subscribe('topic');
    await Promise.resolve();
    runtime.unsubscribe('topic');
    env.runIntervals();
    expect(runtime.isAssigned('topic')).toBe(false);
    expect(control).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic', undefined);
  });

  it('completes a four-tab handoff when the pagehide control message is lost', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const controls = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const environments = ['a', 'b', 'c', 'd'].map(randomId =>
      createFakeEnvironment({ storage, hub, now: () => now, randomId })
    );
    const runtimes = environments.map((environment, index) =>
      new WorkerClusterRuntime({
        clusterKey: 'notice-failover',
        environment: environment.environment,
        tabId: `tab-${index}`,
        workerId: `worker-${index}`,
        maxActiveWorkers: 3,
        handlers: { onControl: controls[index]!, onEvent: vi.fn() }
      })
    );

    for (const runtime of runtimes) {
      runtime.start();
      runtime.subscribe('notice-token-topic');
      now += 1;
      await Promise.resolve();
    }
    expect(runtimes[0]!.isAssigned('notice-token-topic')).toBe(true);
    controls.forEach(control => control.mockClear());

    hub.dropNextControl();
    environments[0]!.pageHide();
    await Promise.resolve();

    expect(runtimes[1]!.isAssigned('notice-token-topic')).toBe(true);
    expect(controls[1]).toHaveBeenCalledWith('SUBSCRIBE', 'notice-token-topic', undefined);
    expect(runtimes[1]!.getSnapshot().routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workerId: 'worker-1', confirmedAt: expect.any(Number) })
      ])
    );
  });

  it('does not unsubscribe the owner when a non-owner tab reloads', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_001, randomId: 'b' });
    const controlA = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'non-owner-reload',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'non-owner-reload',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeA.subscribe('shared-topic');
    await Promise.resolve();
    runtimeB.subscribe('shared-topic');
    await Promise.resolve();
    controlA.mockClear();

    envB.pageHide();
    await Promise.resolve();

    expect(controlA).not.toHaveBeenCalledWith('UNSUBSCRIBE', 'shared-topic', undefined);
    expect(runtimeA.isAssigned('shared-topic')).toBe(true);
  });

  it('retries an unconfirmed remote assignment after a control message is lost', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_001, randomId: 'b' });
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'assignment-confirmation',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'assignment-confirmation',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeA.subscribe('first-topic');
    await Promise.resolve();
    hub.dropNextControl();

    runtimeA.subscribe('second-topic');
    await Promise.resolve();
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'second-topic', undefined);
    expect(runtimeA.getSnapshot().routes.find(route => route.workerId === 'worker-b')?.confirmedAt).toBeUndefined();

    envA.runIntervals();
    await Promise.resolve();
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'second-topic', undefined);
    expect(runtimeA.getSnapshot().routes.find(route => route.workerId === 'worker-b')?.confirmedAt).toBe(1_001);
  });

  it('removes expired routes that no longer have subscriber tabs', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const environment = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'cleanup' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'route-cleanup',
      environment: environment.environment,
      tabId: 'tab-cleanup',
      workerId: 'worker-cleanup',
      workerTtlMs: 10_000,
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('expired-topic');
    await Promise.resolve();
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'));
    const subscriberEntry = storage.entries().find(([key]) => key.includes(':subscriber:'));
    expect(routeEntry).toBeDefined();
    expect(subscriberEntry).toBeDefined();
    runtime.unsubscribe('expired-topic');
    if (routeEntry) storage.setItem(routeEntry[0], routeEntry[1]);
    if (subscriberEntry) {
      storage.setItem(subscriberEntry[0], JSON.stringify({ tabId: 'expired-tab', updatedAt: now }));
    }

    now += 10_001;
    environment.runIntervals();
    await Promise.resolve();

    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(false);
    expect(storage.entries().some(([key]) => key.includes(':subscriber:'))).toBe(false);
  });

  it('forwards events to other tabs without persisting topic or payload text', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_001, randomId: 'b' });
    const onEvent = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'private-connection-context',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'private-connection-context',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeA.subscribe('secret-topic');
    runtimeB.subscribe('secret-topic');
    runtimeA.broadcastEvent('publication', { topic: 'secret-topic', value: 'payload-secret' });

    expect(onEvent).toHaveBeenCalledWith(
      'publication',
      { topic: 'secret-topic', value: 'payload-secret' },
      'worker-a',
      'tab-a'
    );
    const persisted = storage.entries().flat().join('\n');
    expect(persisted).not.toContain('private-connection-context');
    expect(persisted).not.toContain('secret-topic');
    expect(persisted).not.toContain('payload-secret');
  });

  it('ignores unknown protocol message variants and reports them to the opt-in hook', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'unknown' });
    const onUnknownMessage = vi.fn();
    const runtime = new WorkerClusterRuntime({ clusterKey: 'unknown', environment: env.environment, tabId: 'tab-unknown', workerId: 'worker-unknown', handlers: { onControl: vi.fn(), onEvent: vi.fn(), onUnknownMessage } });
    runtime.start();
    (runtime as unknown as { handleMessage: (event: MessageEvent) => void }).handleMessage({ data: { type: 'FUTURE_PROTOCOL_V2', sourceWorkerId: 'other', payload: { value: 1 } } } as MessageEvent);
    expect(onUnknownMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'FUTURE_PROTOCOL_V2' }));
    runtime.stop();
  });

  it('exposes protocol version and accepts legacy and versioned frames', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'versioned' });
    const onControl = vi.fn();
    const onEvent = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'versioned', environment: env.environment, tabId: 'tab-versioned', workerId: 'worker-versioned',
      handlers: { onControl, onEvent }
    });
    runtime.start();
    expect(runtime.getSnapshot().protocolVersion).toBe(1);
    const handleMessage = (runtime as unknown as { handleMessage: (event: MessageEvent) => void }).handleMessage;
    handleMessage({ data: { type: 'EVENT', sourceWorkerId: 'peer', eventType: 'publication', payload: { value: 1 }, protocolVersion: 1 } } as MessageEvent);
    handleMessage({ data: { type: 'EVENT', sourceWorkerId: 'peer', eventType: 'publication', payload: { value: 2 } } } as MessageEvent);
    expect(onEvent).toHaveBeenCalledTimes(2);
    runtime.stop();
  });

  it('reports versioned and legacy peer capabilities in its snapshot', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'capability-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'capability-b' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'capabilities', environment: envA.environment, tabId: 'tab-a', workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'capabilities', environment: envB.environment, tabId: 'tab-b', workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeB.start();
    await Promise.resolve();

    expect(runtimeA.getSnapshot().peerProtocolVersions).toEqual({ 'worker-a': 1, 'worker-b': 1 });
    const legacyEntry = storage.entries().find(([key, value]) => key.includes(':worker:worker-b') && value.includes('worker-b'));
    expect(legacyEntry).toBeDefined();
    const [legacyKey, legacyValue] = legacyEntry!;
    const legacyRecord = JSON.parse(legacyValue) as Record<string, unknown>;
    delete legacyRecord.protocolVersion;
    storage.setItem(legacyKey, JSON.stringify(legacyRecord));

    expect(runtimeA.getSnapshot().peerProtocolVersions).toEqual({ 'worker-a': 1, 'worker-b': null });
    runtimeA.stop();
    runtimeB.stop();
  });

  it('falls back to the local worker when BroadcastChannel is unavailable', () => {
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'local' });
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'cluster',
      environment: env.environment,
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('topic');

    expect(runtime.getSnapshot().coordinated).toBe(false);
    expect(onControl).toHaveBeenCalledWith('SUBSCRIBE', 'topic', undefined);
    expect(runtime.isAssigned('topic')).toBe(true);
  });

  it('keeps subscription intent across pagehide and restores it on pageshow', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lifecycle' });
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'lifecycle',
      environment: env.environment,
      tabId: 'tab-lifecycle',
      workerId: 'worker-lifecycle',
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('topic');
    await Promise.resolve();
    env.pageHide();
    await Promise.resolve();

    expect(runtime.getSnapshot().suspended).toBe(true);
    expect(runtime.getSnapshot().subscribedTopics).toEqual(['topic']);

    env.pageShow();
    expect(runtime.getSnapshot().suspended).toBe(false);
    expect(onControl).toHaveBeenCalledWith('SUBSCRIBE', 'topic', undefined);
  });

  it('flushes batched storage writes before pagehide returns', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'flush' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'flush-before-hide',
      environment: env.environment,
      tabId: 'tab-flush',
      workerId: 'worker-flush',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('topic');
    await Promise.resolve();

    expect(storage.entries().length).toBeGreaterThan(0);
    env.pageHide();
    await Promise.resolve();

    expect(runtime.getSnapshot().suspended).toBe(true);
    expect(storage.entries()).toEqual([]);
  });

  it('keeps a live topic owner when its tab becomes hidden', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'visibility',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'visibility',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    now += 1;
    runtimeB.start();
    runtimeA.subscribe('topic');
    await Promise.resolve();
    expect(runtimeA.isAssigned('topic')).toBe(true);

    envA.setVisibility('hidden');
    runtimeB.subscribe('topic');
    await Promise.resolve();

    expect(runtimeA.isAssigned('topic')).toBe(true);
    expect(runtimeB.isAssigned('topic')).toBe(false);
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic', undefined);
    expect(runtimeB.publish('topic', { value: 1 })).toBe(true);
    expect(controlA).toHaveBeenCalledWith('PUBLISH', 'topic', { value: 1 });
  });

  it('caps knownTopics at MAX_KNOWN_TOPICS and evicts the oldest non-owned entries first (FIFO)', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'fifo' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'known-topics-fifo',
      environment: env.environment,
      tabId: 'tab-fifo',
      workerId: 'worker-fifo',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    // publish() fills knownTopics via rememberTopic without creating ownership,
    // so all 600 entries stay non-owned and become eligible for FIFO eviction.
    for (let index = 0; index < 600; index += 1) {
      runtime.publish(`fifo-topic-${index}`, { value: index });
    }

    const known = runtime.getSnapshot().knownTopics;
    const topics = new Set(known.map(entry => entry.topic));
    // Cache is capped at 500 entries.
    expect(known.length).toBe(500);
    // Oldest 100 published topics were evicted first.
    for (let index = 0; index < 100; index += 1) {
      expect(topics.has(`fifo-topic-${index}`)).toBe(false);
    }
    // The most recent 500 survive.
    for (let index = 100; index < 600; index += 1) {
      expect(topics.has(`fifo-topic-${index}`)).toBe(true);
    }
  });

  it('never evicts a topic the worker still owns from knownTopics', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'owner' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'known-topics-owner',
      environment: env.environment,
      tabId: 'tab-owner',
      workerId: 'worker-owner',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    // The subscribed topic is self-owned and inserted first.
    runtime.subscribe('owned-topic');
    expect(runtime.isAssigned('owned-topic')).toBe(true);
    // Flood the cache with non-owned entries that would evict the oldest key.
    for (let index = 0; index < 600; index += 1) {
      runtime.publish(`fill-topic-${index}`, { value: index });
    }

    const known = runtime.getSnapshot().knownTopics;
    expect(known.some(entry => entry.topic === 'owned-topic')).toBe(true);
  });

  it('keeps the storage-less path coherent when knownTopics caps out', async () => {
    // A storage that rejects every write makes canUseStorage fail, so the
    // Runtime runs in storage-less mode where readRoute/readSubscriberTabIds
    // rely on the knownTopics reverse cache.
    const brokenStorage = new (class extends MemoryStorage {
      override setItem(): void {
        throw new Error('QuotaExceededError');
      }
    })();
    const env = createFakeEnvironment({ storage: brokenStorage, now: () => 1_000, randomId: 'nolocal' });
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'known-topics-nostorage',
      environment: env.environment,
      tabId: 'tab-nolocal',
      workerId: 'worker-nolocal',
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();
    expect(runtime.getSnapshot().coordinated).toBe(false);

    // Subscribe to a topic and flood the cache past the cap.
    runtime.subscribe('owned-topic');
    for (let index = 0; index < 600; index += 1) {
      runtime.publish(`fill-topic-${index}`, { value: index });
    }
    await Promise.resolve();

    // The owned topic must still resolve as assigned even though the reverse
    // cache held >500 entries, and isAssigned must agree with readRoute.
    expect(runtime.isAssigned('owned-topic')).toBe(true);
    expect(onControl).toHaveBeenCalledWith('SUBSCRIBE', 'owned-topic', undefined);
    // A published-but-unowned topic resolves through rememberTopic's cache path.
    expect(runtime.isAssigned('fill-topic-599')).toBe(false);
  });

  it('evicts the oldest route owner cache entry once the cap is reached', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-cap' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'lru-cap',
      environment: env.environment,
      tabId: 'tab-cap',
      workerId: 'worker-cap',
      routeOwnerCacheMax: 3,
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtime.start();
    await Promise.resolve();
    env.runIntervals();
    for (let i = 0; i < 5; i += 1) {
      runtime.publish(`bench.cap.${i}`, { value: i });
      await Promise.resolve();
      env.runIntervals();
    }
    const snap = runtime.getSnapshot().routeOwnerCache;
    expect(snap?.max).toBe(3);
    expect(snap?.size).toBeLessThanOrEqual(3);
    runtime.stop();
  });

  it('clears route owner cache diagnostics when stopped', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-stop' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'lru-stop',
      environment: env.environment,
      tabId: 'tab-stop',
      workerId: 'worker-stop',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtime.start();
    runtime.publish('bench.stop.topic', { value: 1 });
    expect(runtime.getSnapshot().routeOwnerCache?.misses).toBe(1);
    runtime.stop();
    expect(runtime.getSnapshot().routeOwnerCache?.size).toBe(0);
  });

  it('route owner cache populates for a remote owner and serves subsequent publishes from cache', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-remote-A' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-remote-B' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'lru-remote',
      environment: envA.environment,
      tabId: 'tab-remote-A',
      workerId: 'worker-remote-A',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'lru-remote',
      environment: envB.environment,
      tabId: 'tab-remote-B',
      workerId: 'worker-remote-B',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeB.subscribe('bench.remote.topic');
    await Promise.resolve();
    envA.runIntervals();
    envB.runIntervals();
    runtimeA.publish('bench.remote.topic', { value: 1 });
    const after1 = runtimeA.getSnapshot().routeOwnerCache;

    expect(after1?.misses).toBe(1);
    expect(after1?.hits).toBe(0);

    runtimeA.publish('bench.remote.topic', { value: 2 });
    const after2 = runtimeA.getSnapshot().routeOwnerCache;

    expect(after2?.hits).toBeGreaterThanOrEqual(1);
    runtimeA.stop();
    runtimeB.stop();
  });

  it('route owner cache misses on the first publish and reuses a fresh route', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-miss' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'lru-miss',
      environment: env.environment,
      tabId: 'tab-miss',
      workerId: 'worker-miss',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtime.start();
    const before = runtime.getSnapshot().routeOwnerCache;
    expect(before?.misses).toBe(0);
    runtime.publish('bench.miss.topic', { value: 1 });
    const after = runtime.getSnapshot().routeOwnerCache;
    expect(after?.misses).toBe(1);
  });

  it('route owner cache falls back when the cached worker TTL expires', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const environmentA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'lru-ttl-A' });
    const environmentB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'lru-ttl-B' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'lru-ttl',
      environment: environmentA.environment,
      tabId: 'tab-ttl-A',
      workerId: 'worker-ttl-A',
      workerTtlMs: 5_000,
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'lru-ttl',
      environment: environmentB.environment,
      tabId: 'tab-ttl-B',
      workerId: 'worker-ttl-B',
      workerTtlMs: 5_000,
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeB.subscribe('bench.ttl.topic');
    await Promise.resolve();
    environmentA.runIntervals();
    environmentB.runIntervals();
    runtimeA.publish('bench.ttl.topic', { value: 1 });
    const firstSnapshot = runtimeA.getSnapshot().routeOwnerCache;
    expect(firstSnapshot?.misses).toBe(1);
    // Worker B 'crashes' (no pagehide, no stop): we stop ticking B and jump
    // time past its 5s TTL, then let only A reconcile. A's route cache for B
    // should now be invalid; the next publish must re-resolve.
    now += 5_001;
    environmentA.runIntervals();
    await Promise.resolve();
    runtimeA.publish('bench.ttl.topic', { value: 2 });
    const secondSnapshot = runtimeA.getSnapshot().routeOwnerCache;
    expect(secondSnapshot?.misses).toBeGreaterThanOrEqual(2);
    expect(secondSnapshot?.size).toBeLessThanOrEqual(1);
    runtimeA.stop();
    runtimeB.stop();
  });

  it('route owner cache survives an owner migration and routes to the new owner', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-mig-A' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-mig-B' });
    const envC = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-mig-C' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'lru-mig',
      environment: envA.environment,
      tabId: 'tab-mig-A',
      workerId: 'worker-mig-A',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'lru-mig',
      environment: envB.environment,
      tabId: 'tab-mig-B',
      workerId: 'worker-mig-B',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeC = new WorkerClusterRuntime({
      clusterKey: 'lru-mig',
      environment: envC.environment,
      tabId: 'tab-mig-C',
      workerId: 'worker-mig-C',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeC.start();
    // B subscribes first; A and C publish to its topic.
    runtimeB.subscribe('bench.mig.topic');
    await Promise.resolve();
    envA.runIntervals();
    envB.runIntervals();
    envC.runIntervals();
    runtimeA.publish('bench.mig.topic', { value: 1 });
    const cacheA = runtimeA.getSnapshot().routeOwnerCache;
    expect(cacheA?.misses).toBe(1);
    // B hands off (pagehide) and C takes ownership. B's pagehide triggers a
    // graceful handoff; C is the least-loaded worker so it wins the race.
    envB.pageHide();
    await Promise.resolve();
    envA.runIntervals();
    envB.runIntervals();
    envC.runIntervals();
    await Promise.resolve();
    await Promise.resolve();
    // After migration the route owner should have changed. A's next publish
    // must miss (cached owner is stale) and successfully route to the new owner.
    runtimeA.publish('bench.mig.topic', { value: 2 });
    const cacheA2 = runtimeA.getSnapshot().routeOwnerCache;
    expect(cacheA2?.misses).toBeGreaterThanOrEqual(2);
    runtimeA.stop();
    runtimeB.stop();
    runtimeC.stop();
  });
});


describe('WorkerClusterRuntime publishBatch', () => {
  function makeBatchRuntime(options: {
    clusterKey: string;
    tabId: string;
    workerId: string;
    onControl: (action: WorkerControlAction, topic: string, data?: unknown, messageId?: string, timestamp?: number) => void;
    onEvent?: (eventType: string, payload: unknown, sourceWorkerId: string, originTabId?: string) => void;
  }): { runtime: WorkerClusterRuntime; env: ReturnType<typeof createFakeEnvironment> } {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const env = createFakeEnvironment({
      storage,
      hub,
      now: () => now,
      randomId: options.workerId
    });
    const runtime = new WorkerClusterRuntime({
      clusterKey: options.clusterKey,
      environment: env.environment,
      tabId: options.tabId,
      workerId: options.workerId,
      handlers: { onControl: options.onControl, onEvent: options.onEvent ?? vi.fn() }
    });
    return { runtime, env };
  }

  it('treats an empty batch as a no-op', () => {
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-empty',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: vi.fn()
    });
    runtime.start();
    expect(runtime.publishBatch('any', [])).toBe(true);
    runtime.stop();
  });

  it('delegates a single-item batch to publish()', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-single',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('feed.tick');
    await Promise.resolve();
    const before = control.mock.calls.length;
    expect(runtime.publishBatch('feed.tick', [{ data: { p: 1 }, messageId: 'm-single', timestamp: 7 }])).toBe(true);
    await Promise.resolve();
    expect(control).toHaveBeenLastCalledWith('PUBLISH', 'feed.tick', { p: 1 }, 'm-single', 7);
    expect(control.mock.calls.length).toBe(before + 1);
    runtime.stop();
  });

  it('dispatches every item locally when the topic is assigned to this worker', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-local',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('feed.live');
    await Promise.resolve();
    control.mockClear();
    expect(runtime.publishBatch('feed.live', [
      { data: 1, messageId: 'a' },
      { data: 2, timestamp: 99 },
      { data: 3, messageId: 'c', timestamp: 100 }
    ])).toBe(true);
    await Promise.resolve();
    const publishCalls = control.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishCalls).toHaveLength(3);
    expect(publishCalls[0]).toEqual(['PUBLISH', 'feed.live', 1, 'a', undefined]);
    expect(publishCalls[1]).toEqual(['PUBLISH', 'feed.live', 2, undefined, 99]);
    expect(publishCalls[2]).toEqual(['PUBLISH', 'feed.live', 3, 'c', 100]);
    runtime.stop();
  });

  it('routes a batch through a remote owner and unpacks every item on the receiver', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'batch-remote-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'batch-remote-b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'batch-remote',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'batch-remote',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('remote.feed');
    await Promise.resolve();
    now += 1;
    runtimeB.start();
    controlA.mockClear();

    expect(runtimeB.publishBatch('remote.feed', [
      { data: { i: 0 }, messageId: 'm0' },
      { data: { i: 1 }, timestamp: 11 },
      { data: { i: 2 }, messageId: 'm2', timestamp: 22 }
    ])).toBe(true);
    await Promise.resolve();
    const publishCalls = controlA.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishCalls).toHaveLength(3);
    expect(publishCalls[0]).toEqual(['PUBLISH', 'remote.feed', { i: 0 }, 'm0', undefined]);
    expect(publishCalls[1]).toEqual(['PUBLISH', 'remote.feed', { i: 1 }, undefined, 11]);
    expect(publishCalls[2]).toEqual(['PUBLISH', 'remote.feed', { i: 2 }, 'm2', 22]);
    runtimeA.stop();
    runtimeB.stop();
  });

  it('hands a batched CONTROL to onPublishBatch once when the receiver supports it', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'batch-owner-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'batch-owner-b' });
    const controlA = vi.fn();
    const batchA = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'batch-owner',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onPublishBatch: batchA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'batch-owner',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('remote.batch');
    await Promise.resolve();
    now += 1;
    runtimeB.start();

    expect(runtimeB.publishBatch('remote.batch', [
      { data: { i: 0 }, messageId: 'm0' },
      { data: { i: 1 }, timestamp: 11 }
    ])).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(batchA).toHaveBeenCalledTimes(1);
    expect(batchA).toHaveBeenCalledWith('remote.batch', [
      { data: { i: 0 }, messageId: 'm0' },
      { data: { i: 1 }, timestamp: 11 }
    ]);
    expect(controlA).not.toHaveBeenCalledWith('PUBLISH', expect.anything(), expect.anything());
    runtimeA.stop();
    runtimeB.stop();
  });

  it('dispatches a batch through a wildcard assignment when the concrete topic is not owned', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-wildcard',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('feed.*');
    await Promise.resolve();
    control.mockClear();
    expect(runtime.publishBatch('feed.room-1', [
      { data: 'a' },
      { data: 'b' },
      { data: 'c' }
    ])).toBe(true);
    await Promise.resolve();
    const publishCalls = control.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishCalls.map(call => call[1])).toEqual(['feed.room-1', 'feed.room-1', 'feed.room-1']);
    expect(publishCalls.map(call => call[2])).toEqual(['a', 'b', 'c']);
    runtime.stop();
  });

  it('preserves item order for large batches', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-order',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('order.topic');
    await Promise.resolve();
    control.mockClear();
    const N = 50;
    const items = Array.from({ length: N }, (_, i) => ({ data: i, messageId: `id-${i}` }));
    expect(runtime.publishBatch('order.topic', items)).toBe(true);
    await Promise.resolve();
    const publishCalls = control.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishCalls).toHaveLength(N);
    publishCalls.forEach((call, index) => {
      expect(call[2]).toBe(index);
      expect(call[3]).toBe(`id-${index}`);
    });
    runtime.stop();
  });
});


describe('WorkerClusterRuntime resilience', () => {
  function makeRuntime(options: {
    storage: MemoryStorage;
    hub?: ChannelHub;
    now?: () => number;
    clusterKey?: string;
    tabId: string;
    workerId: string;
    workerTtlMs?: number;
    onControl?: (action: string, topic: string, data?: unknown) => void;
  }) {
    const env = createFakeEnvironment({
      storage: options.storage,
      ...(options.hub ? { hub: options.hub } : {}),
      now: options.now ?? (() => 1_000),
      randomId: options.workerId
    });
    const runtime = new WorkerClusterRuntime({
      clusterKey: options.clusterKey ?? 'resilience',
      environment: env.environment,
      tabId: options.tabId,
      workerId: options.workerId,
      ...(options.workerTtlMs !== undefined ? { workerTtlMs: options.workerTtlMs } : {}),
      handlers: { onControl: options.onControl ?? vi.fn(), onEvent: vi.fn() }
    });
    return { env, runtime };
  }

  it('treats a corrupt route record as absent instead of throwing', () => {
    const storage = new MemoryStorage();
    const { runtime } = makeRuntime({ storage, tabId: 'tab-a', workerId: 'worker-a' });
    runtime.start();
    runtime.subscribe('topic-a');
    // Corrupt every route record on disk.
    for (const [key, value] of storage.entries()) {
      if (key.includes(':route:')) storage.setItem(key, `${value}{corrupted`);
    }
    expect(() => runtime.getSnapshot()).not.toThrow();
    expect(runtime.getSnapshot().routes).toEqual([]);
    // isAssigned falls back to the in-memory assignment.
    expect(runtime.isAssigned('topic-a')).toBe(true);
  });

  it('keeps the runtime usable when storage writes start failing mid-session', () => {
    const storage = new MemoryStorage();
    let failWrites = false;
    const flaky = new (class extends MemoryStorage {
      override setItem(key: string, value: string): void {
        if (failWrites) throw new Error('QuotaExceededError');
        super.setItem(key, value);
      }
      override removeItem(key: string): void {
        if (failWrites) throw new Error('QuotaExceededError');
        super.removeItem(key);
      }
    })();
    // Seed the shared storage so canUseStorage passes at construction.
    const { env, runtime } = makeRuntime({ storage, tabId: 'tab-a', workerId: 'worker-a' });
    env.environment.storage = flaky;
    runtime.start();
    runtime.subscribe('topic-a');
    failWrites = true;
    expect(() => {
      runtime.subscribe('topic-b');
      env.runIntervals();
      runtime.unsubscribe('topic-a');
    }).not.toThrow();
  });

  it('prunes a crashed worker and its records after the TTL expires', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', workerTtlMs: 5_000 });
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b', workerTtlMs: 5_000 });
    a.runtime.start();
    b.runtime.start();
    a.env.runIntervals();
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().workers.map(w => w.workerId)).toEqual(['worker-a', 'worker-b']);

    // Worker A crashes: no pagehide, no stop — heartbeats just stop.
    now += 5_001;
    b.env.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    expect(b.runtime.getSnapshot().workers.map(w => w.workerId)).toEqual(['worker-b']);
  });

  it('removes subscriber records whose tab is no longer active', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', workerTtlMs: 5_000 });
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b', workerTtlMs: 5_000 });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();

    // Worker A crashes with a subscriber record on disk.
    const subscriberEntry = storage.entries().find(([key]) => key.includes(':subscriber:'));
    expect(subscriberEntry).toBeDefined();
    now += 5_001;
    b.env.runIntervals();
    await Promise.resolve();

    expect(storage.entries().some(([key]) => key.includes(':subscriber:'))).toBe(false);
  });

  it('prunes a dead-tab subscriber inside pause() without a prior reconcile', async () => {
    // readSubscriberTabIds carries its own orphan-prune branch even though
    // reconcile's cleanupOrphanedSubscribers normally runs first: pause()
    // never runs that cleanup, so a subscriber record whose tab has no
    // worker record must be ignored (and removed) right there — otherwise
    // the dead tab would count as a remaining subscriber and the route
    // would be handed off instead of deleted.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();

    // A ghost subscriber with no worker record anywhere in storage.
    const ownEntry = storage.entries().find(([key]) => key.includes(':subscriber:'))!;
    const ghostKey = ownEntry[0].replace(':tab-a', ':tab-ghost');
    storage.setItem(ghostKey, JSON.stringify({ tabId: 'tab-ghost', updatedAt: now }));
    await Promise.resolve();

    a.env.pageHide();
    await Promise.resolve();

    // Both the owner's own record and the ghost are gone, and with no live
    // subscribers left the route is deleted rather than handed off.
    expect(storage.entries().some(([key]) => key.includes(':subscriber:'))).toBe(false);
    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(false);
  });

  it('forwards an unknown CONTROL action through the generic dispatch without crashing', async () => {
    // A future-protocol CONTROL action must not break the receiver: the
    // switch falls through to the generic metadata + onControl dispatch.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const channelNames: string[] = [];
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    b.env.environment.createChannel = name => {
      channelNames.push(name);
      return hub.create(name);
    };
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    const topicKey = JSON.parse(storage.entries().find(([key]) => key.includes(':route:'))![1]).topicKey as string;

    expect(() =>
      hub.create(channelNames[0]!).postMessage({
        type: 'CONTROL',
        sourceWorkerId: 'worker-a',
        targetWorkerId: 'worker-b',
        // A future protocol version's action: not part of the local union,
        // exactly what the wire-compat path must tolerate.
        action: 'FUTURE-ACTION' as WorkerControlAction,
        topic: 'topic-a',
        topicKey
      })
    ).not.toThrow();
    expect(controlB).toHaveBeenCalledWith('FUTURE-ACTION', 'topic-a', undefined);
  });

  it('cleans up an orphaned route once no subscriber tab remains alive', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', workerTtlMs: 5_000 });
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(true);

    // Worker A crashes. A peer that comes online after the TTL reconciles the
    // registry: dead worker, dead subscriber, then the orphaned route go away.
    now += 5_001;
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b', workerTtlMs: 5_000 });
    b.runtime.start();
    await Promise.resolve();
    b.env.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(false);
    expect(storage.entries().some(([key]) => key.includes(':subscriber:'))).toBe(false);
    // Only the live peer's worker record remains.
    const workerRecords = storage.entries().filter(([key]) => key.includes(':worker:'));
    expect(workerRecords).toHaveLength(1);
    expect(JSON.parse(workerRecords[0]![1]).workerId).toBe('worker-b');
  });

  it('short-circuits a handoff UNSUBSCRIBE on the old owner and ACKs ROUTE_RELEASED', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlA = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', onControl: controlA });
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b' });
    const channelNames: string[] = [];
    a.env.environment.createChannel = name => {
      channelNames.push(name);
      return hub.create(name);
    };
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();
    const topicKey = JSON.parse(storage.entries().find(([key]) => key.includes(':route:'))![1]).topicKey as string;
    controlA.mockClear();

    // Simulate a graceful handoff record: the route now belongs to worker-b
    // and names worker-a as the previous owner that must release.
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({ ...route, workerId: 'worker-b', tabId: 'tab-b', generation: 2, handoffFromWorkerId: 'worker-a', updatedAt: now })
    );

    // The new owner asks the old owner to release via a point-to-point CONTROL.
    hub.create(channelNames[0]!).postMessage({
      type: 'CONTROL',
      sourceWorkerId: 'worker-b',
      targetWorkerId: 'worker-a',
      action: 'UNSUBSCRIBE',
      topic: 'topic-a',
      topicKey
    });

    // The old owner releases locally exactly once (no generic double dispatch)
    // and ACKs with ROUTE_RELEASED, which lets worker-b confirm ownership.
    expect(controlA).toHaveBeenCalledTimes(1);
    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic-a', undefined);
    await Promise.resolve();
    expect(b.runtime.isAssigned('topic-a')).toBe(true);
    expect(b.runtime.getSnapshot().routes[0]?.confirmedAt).toBe(now);
  });

  it('recovers a stranded unconfirmed handoff once the previous owner is dead', async () => {
    // Regression: if the previous owner's ROUTE_RELEASED never arrives
    // (dropped channel message under load, or a crash between the route
    // write and the ACK), the route sat unconfirmed forever — the new owner
    // kept waiting for the ACK while peers treated the live new owner as
    // authoritative and stayed out. Reconcile must re-elect a live owner
    // once the previous owner is gone AND the handoff has been stuck longer
    // than a worker TTL (the age gate keeps a fresh handoff — whose
    // confirmation may simply not have flushed yet — from being mistaken
    // for a stranded one).
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-handoff-recovery');
    await Promise.resolve();
    b.runtime.subscribe('topic-handoff-recovery');
    await Promise.resolve();
    expect(a.runtime.isAssigned('topic-handoff-recovery')).toBe(true);

    // Strand the handoff mid-flight: the route names worker-b with worker-a
    // as the previous owner, but the ACK is never delivered. The original
    // route was confirmed by worker-a, so confirmedAt must be stripped —
    // otherwise the crafted record is not actually unconfirmed.
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    // The original route was confirmed by worker-a; drop the stamp so the
    // crafted record is genuinely unconfirmed.
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    // Kill the previous owner. Its pause() sees the route no longer points
    // at itself, so it sends no ACK — exactly the stranded state. The
    // immediate reconcile (driven by the REGISTRY nudge) must NOT recover
    // yet: the handoff is brand new and the ACK could still be in flight.
    // (Assertions use the snapshot's in-memory assignment list — the same
    // signal the e2e owner poll reads — because isAssigned() also returns
    // true for a storage route that merely points at this worker.)
    a.runtime.stop();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('topic-handoff-recovery');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-recovery', undefined);

    // Past the worker TTL with no confirmation, the next reconcile re-elects.
    now += 10_001;
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-recovery');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-recovery', undefined);
    const recovered = b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b');
    expect(recovered).toMatchObject({ generation: 3, confirmedAt: now });
    expect(recovered).not.toHaveProperty('handoffFromWorkerId');

    // A further reconcile round stays converged on the single owner.
    controlB.mockClear();
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-recovery');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-recovery', undefined);
  });

  it('recovers a real pagehide handoff whose ROUTE_RELEASED is lost on the wire', async () => {
    // End-to-end version of the stranded-handoff regression: a genuine
    // pageHide() writes the handoff route, but the ACK itself is dropped in
    // transit (the CI soak failure mode) — no hand-crafted storage. The new
    // owner must still converge once the handoff goes stale.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-handoff-wire-loss');
    await Promise.resolve();
    b.runtime.subscribe('topic-handoff-wire-loss');
    await Promise.resolve();
    expect(a.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-wire-loss');

    // Drop exactly one ROUTE_RELEASED: the handoff route lands, the ACK does not.
    const originalSend = hub.send.bind(hub);
    let ackDropped = false;
    hub.send = (source: { name: string }, message: WorkerClusterMessage) => {
      if (!ackDropped && message.type === CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED) {
        ackDropped = true;
        return;
      }
      originalSend(source as never, message);
    };
    a.env.pageHide();
    await Promise.resolve();
    expect(ackDropped).toBe(true);

    // The route really did move to worker-b, unconfirmed, with the handoff
    // marker — written by the actual handoff code, not the test.
    const stranded = b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b');
    expect(stranded).toMatchObject({ handoffFromWorkerId: 'worker-a' });
    expect(stranded?.confirmedAt).toBeUndefined();
    // Fresh handoff: the new owner waits, no premature recovery.
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('topic-handoff-wire-loss');

    now += 10_001;
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-wire-loss');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-wire-loss', undefined);
    expect(
      b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b')?.confirmedAt
    ).toBe(now);
  });

  it('converges repeated pagehides with every handoff ACK lost', async () => {
    // Soak over the stranded-handoff recovery: three consecutive owners each
    // go through pageHide() with the ACK dropped, and every round must still
    // converge on exactly one confirmed holder with no handoff marker left
    // behind and a monotonically increasing generation (no reset/duplication
    // across recovery cycles).
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const topic = 'topic-handoff-soak';
    const tabs = (['a', 'b', 'c'] as const).map(id =>
      makeRuntime({ storage, hub, now: () => now, tabId: `tab-${id}`, workerId: `worker-${id}` })
    );
    for (const tab of tabs) tab.runtime.start();
    for (const tab of tabs) {
      tab.runtime.subscribe(topic);
      await Promise.resolve();
    }
    const holders = () => tabs.filter(tab => tab.runtime.getSnapshot().assignedTopics.includes(topic));
    expect(holders()).toHaveLength(1);

    const originalSend = hub.send.bind(hub);
    let lastGeneration = 1;
    // Advance time in 1 s steps with a heartbeat round and a microtask flush
    // per step: heartbeats must keep propagating (as they do in a real
    // browser every 3 s) so live peers never look TTL-dead to each other. A
    // single +11 s jump would strand every peer's heartbeat write in its own
    // writer's pending queue while the others reconcile — an artifact of the
    // shared fake clock, not of the recovery logic.
    const stepTime = async (ms: number) => {
      const steps = Math.ceil(ms / 1000);
      for (let step = 0; step < steps; step += 1) {
        now += 1000;
        for (const tab of tabs) tab.env.runIntervals();
        await Promise.resolve();
      }
    };
    for (let round = 0; round < 3; round += 1) {
      const owners = holders();
      expect(owners).toHaveLength(1);
      // Drop this round's ACK; the handoff route still lands.
      let ackDropped = false;
      hub.send = (source: { name: string }, message: WorkerClusterMessage) => {
        if (!ackDropped && message.type === CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED) {
          ackDropped = true;
          return;
        }
        originalSend(source as never, message);
      };
      const suspended = owners[0]!;
      suspended.env.pageHide();
      await Promise.resolve();
      expect(ackDropped).toBe(true);

      await stepTime(11_000);
      // One settle round: if two survivors re-elected on the same stale view
      // (last-writer-wins, mirroring the pre-existing crash-recovery race),
      // the holder's next reconcile completes confirmation through the normal
      // unconfirmed-route retry path.
      for (const tab of tabs) tab.env.runIntervals();
      await Promise.resolve();
      const converged = holders();
      expect(converged).toHaveLength(1);
      const route = converged[0]!.runtime
        .getSnapshot()
        .routes.find(entry => entry.topic === topic);
      expect(route?.confirmedAt).toBeDefined();
      expect(route).not.toHaveProperty('handoffFromWorkerId');
      expect(route!.generation).toBeGreaterThan(lastGeneration);
      lastGeneration = route!.generation;

      // The suspended owner rejoins as a subscriber (mirroring the e2e
      // pageshow step): the sticky route must stay with the survivor — the
      // returning tab reuses the replacement owner instead of taking back.
      suspended.env.pageShow();
      await Promise.resolve();
      const afterRejoin = holders();
      expect(afterRejoin).toHaveLength(1);
      expect(afterRejoin[0]).toBe(converged[0]);
    }
  });

  it('has the old owner release and re-ACK when it still holds a handed-off assignment', async () => {
    // Covers reconcileAssignedTopics' cooperative path: an old owner that
    // still lists the topic as assigned while the route already names a new
    // owner with itself as handoff source drops the assignment and re-sends
    // ROUTE_RELEASED, letting the new owner confirm.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlA = vi.fn();
    const controlB = vi.fn();
    const a = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: controlA
    });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-handoff-coop');
    await Promise.resolve();
    b.runtime.subscribe('topic-handoff-coop');
    await Promise.resolve();
    expect(a.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-coop');

    // A handoff record naming worker-b is visible, but worker-a never
    // processed the release (e.g. it missed its own pause): it still holds
    // the in-memory assignment while the route already moved on.
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    a.env.runIntervals();
    await Promise.resolve();
    // The old owner drops its stale assignment and the re-sent ACK lets the
    // new owner confirm: exactly one holder, confirmed route, no re-election
    // churn (generation stays 2 — no new write happened).
    expect(a.runtime.getSnapshot().assignedTopics).not.toContain('topic-handoff-coop');
    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic-handoff-coop', undefined);
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-coop');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-coop', undefined);
    expect(b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b')).toMatchObject({
      generation: 2,
      confirmedAt: now
    });
  });

  it('keeps waiting for ROUTE_RELEASED while the previous owner is still alive', async () => {
    // The recovery above must not fire while the previous owner is live:
    // retrying SUBSCRIBE then would recreate the overlap the strict handoff
    // exists to prevent.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-handoff-wait');
    await Promise.resolve();
    b.runtime.subscribe('topic-handoff-wait');
    await Promise.resolve();

    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    // Previous owner alive: reconcile must not re-elect and must not
    // re-send SUBSCRIBE for the unconfirmed route.
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('topic-handoff-wait');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-wait', undefined);
    const waiting = b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b');
    expect(waiting).toMatchObject({ generation: 2, handoffFromWorkerId: 'worker-a' });
    expect(waiting?.confirmedAt).toBeUndefined();
  });

  it('drops a locally assigned topic when the route no longer points at this worker', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlA = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', onControl: controlA });
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b' });
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();
    expect(a.runtime.isAssigned('topic-a')).toBe(true);

    // Simulate the route being taken over by another live worker in this
    // tab's absence (e.g. a peer that won the race after a pause).
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({ ...route, workerId: 'worker-b', tabId: 'tab-b', generation: (route.generation as number) + 1, updatedAt: now })
    );

    a.env.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    // A releases its local subscription and stops claiming the topic.
    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic-a', undefined);
    expect(a.runtime.isAssigned('topic-a')).toBe(false);
  });
});

describe('WorkerClusterRuntime adaptive load weighting', () => {
  const loadWeighting = { messageRateWeight: 1 };

  function workerRecordOf(storage: MemoryStorage, workerId: string): WorkerRecord {
    const entry = storage.entries().find(([key]) => key.includes(`:worker:${workerId}`));
    expect(entry).toBeDefined();
    return JSON.parse(entry![1]) as WorkerRecord;
  }

  it('leaves the worker record byte-identical to legacy when weighting is unset', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'legacy' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'weighting-legacy',
      environment: env.environment,
      tabId: 'tab-legacy',
      workerId: 'worker-legacy',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    runtime.broadcastEvent('evt', { n: 1 });
    now += 3_000;
    env.runIntervals();
    await Promise.resolve();

    expect(workerRecordOf(storage, 'worker-legacy').throughput).toBeUndefined();
    runtime.stop();
  });

  it('publishes a rolling traffic sample when weighting is configured', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'sampled' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'weighting-sampled',
      environment: env.environment,
      tabId: 'tab-sampled',
      workerId: 'worker-sampled',
      loadWeighting,
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    const payload = { kind: 'flow', seq: 7 };
    runtime.broadcastEvent('evt', payload);
    now += 3_000;
    env.runIntervals();
    await Promise.resolve();

    const record = workerRecordOf(storage, 'worker-sampled');
    expect(record.throughput).toEqual({
      windowMs: 3_000,
      messageCount: 1,
      byteCount: approximatePayloadBytes(payload),
      overrunMs: 0,
      sampledAt: now
    });
    runtime.stop();
  });

  it('reports positive scheduling overrun when the heartbeat lands late', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'overrun' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'weighting-overrun',
      environment: env.environment,
      tabId: 'tab-overrun',
      workerId: 'worker-overrun',
      heartbeatIntervalMs: 3_000,
      loadWeighting,
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    // A starved event loop delays the heartbeat far past its nominal interval.
    now += 9_000;
    env.runIntervals();
    await Promise.resolve();

    expect(workerRecordOf(storage, 'worker-overrun').throughput).toMatchObject({
      windowMs: 9_000,
      overrunMs: 6_000
    });
    runtime.stop();
  });

  it('steers a new route to a quieter worker despite a higher topic count', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'weighting-steer',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      loadWeighting,
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'weighting-steer',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      loadWeighting,
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });

    runtimeA.start();
    runtimeA.subscribe('topic-1');
    runtimeA.subscribe('topic-2');
    await Promise.resolve();
    runtimeB.start();
    runtimeB.subscribe('topic-3');
    await Promise.resolve();

    // A owns two topics, B owns one — but B handles a heavy fan-out burst.
    expect(runtimeA.isAssigned('topic-1')).toBe(true);
    expect(runtimeA.isAssigned('topic-2')).toBe(true);
    expect(runtimeB.isAssigned('topic-3')).toBe(true);
    for (let index = 0; index < 50; index += 1) runtimeB.broadcastEvent('evt', { n: index });
    now += 3_000;
    envA.runIntervals();
    envB.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    // The quieter worker wins the new route despite carrying more topics.
    runtimeA.subscribe('steer-topic');
    await Promise.resolve();
    expect(runtimeA.isAssigned('steer-topic')).toBe(true);
    expect(runtimeB.isAssigned('steer-topic')).toBe(false);
    expect(controlA).toHaveBeenCalledWith('SUBSCRIBE', 'steer-topic', undefined);
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'steer-topic', undefined);

    runtimeA.stop();
    runtimeB.stop();
  });

  it('steers a new route away from a scheduling-lagging worker despite fewer topics', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const scheduleLagOptions = { scheduleLagWeight: 3 };
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'weighting-lag-steer',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      loadWeighting: scheduleLagOptions,
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'weighting-lag-steer',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      loadWeighting: scheduleLagOptions,
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });

    // B owns two topics, A owns one — legacy would place a new route on A.
    runtimeB.start();
    runtimeB.subscribe('topic-2');
    runtimeB.subscribe('topic-3');
    await Promise.resolve();
    runtimeA.start();
    runtimeA.subscribe('topic-1');
    await Promise.resolve();
    expect(runtimeB.isAssigned('topic-2')).toBe(true);
    expect(runtimeB.isAssigned('topic-3')).toBe(true);
    expect(runtimeA.isAssigned('topic-1')).toBe(true);

    // One healthy heartbeat: both records carry a lag-free sample.
    now += 3_000;
    envA.runIntervals();
    envB.runIntervals();
    await Promise.resolve();

    // Starve A only: its next heartbeat lands far past the interval, so its
    // record publishes a sample with positive scheduling overrun.
    now += 9_000;
    envA.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    // A's effective load (1 topic + 3 × 0.667 lag) now exceeds B's (2 topics
    // + 3 × 0), so the route with fewer topics still lands on the healthier B.
    runtimeA.subscribe('steer-lag');
    await Promise.resolve();
    await Promise.resolve();
    expect(runtimeB.isAssigned('steer-lag')).toBe(true);
    expect(runtimeA.isAssigned('steer-lag')).toBe(false);
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'steer-lag', undefined);
    expect(controlA).not.toHaveBeenCalledWith('SUBSCRIBE', 'steer-lag', undefined);

    runtimeA.stop();
    runtimeB.stop();
  });

  it('falls back to the legacy fewest-topics rule when weighting is unset', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'weighting-legacy-steer',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'weighting-legacy-steer',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });

    runtimeA.start();
    runtimeA.subscribe('topic-1');
    runtimeA.subscribe('topic-2');
    await Promise.resolve();
    runtimeB.start();
    runtimeB.subscribe('topic-3');
    await Promise.resolve();

    // Identical traffic, no weighting → the fewest-topics worker (B) wins.
    for (let index = 0; index < 50; index += 1) runtimeB.broadcastEvent('evt', { n: index });
    now += 3_000;
    envA.runIntervals();
    envB.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    runtimeA.subscribe('legacy-steer-topic');
    await Promise.resolve();
    expect(runtimeB.isAssigned('legacy-steer-topic')).toBe(true);
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'legacy-steer-topic', undefined);

    runtimeA.stop();
    runtimeB.stop();
  });
});
