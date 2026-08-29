import { describe, expect, it, vi } from 'vitest';
import { WorkerClusterRuntime } from '../src/core/cluster';
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
      'worker-a'
    );
    const persisted = storage.entries().flat().join('\n');
    expect(persisted).not.toContain('private-connection-context');
    expect(persisted).not.toContain('secret-topic');
    expect(persisted).not.toContain('payload-secret');
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
