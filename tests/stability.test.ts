/**
 * Long-session stability regressions: owner handoff ACK validation, BFCache
 * round-trips, transport recovery exhaustion, storage write failure recovery,
 * and replay-persistence cleanup races. Each test pins behaviour that was
 * observed to degrade under realistic multi-tab lifecycle stress.
 */
import { describe, expect, it, vi } from 'vitest';
import { WorkerClusterRuntime } from '../src/core/cluster';
import type { WorkerControlAction } from '../src/core/types';
import { BatchingStorageWriter } from '../src/core/storage-batch';
import { CrossTabDataBus } from '../src/core/data-bus';
import { ChannelHub, createFakeEnvironment, FakeTransport, MemoryStorage } from './fakes';

function makeRuntime(options: {
  storage: MemoryStorage;
  hub?: ChannelHub | undefined;
  now?: () => number;
  tabId: string;
  workerId: string;
  onControl?: (action: WorkerControlAction, topic: string, data?: unknown) => void;
}) {
  const env = createFakeEnvironment({
    storage: options.storage,
    ...(options.hub ? { hub: options.hub } : {}),
    now: options.now ?? (() => 1_000),
    randomId: options.workerId
  });
  const runtime = new WorkerClusterRuntime({
    clusterKey: 'stability-cluster',
    environment: env.environment,
    tabId: options.tabId,
    workerId: options.workerId,
    handlers: { onControl: options.onControl ?? vi.fn(), onEvent: vi.fn() }
  });
  return { env, runtime };
}

describe('stability: owner handoff ACK validation', () => {
  function forgeHandoffRoute(storage: MemoryStorage, overrides: Record<string, unknown>) {
    const entry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(entry[1]) as Record<string, unknown>;
    // A handoff-written route is unconfirmed until the new owner ACKs; drop
    // the original owner's confirmedAt so ACK acceptance is observable.
    storage.setItem(entry[0], JSON.stringify({ ...route, confirmedAt: undefined, ...overrides }));
    return route.topicKey as string;
  }

  function postRouteReleased(
    hub: ChannelHub,
    channelName: string,
    message: { sourceWorkerId: string; targetWorkerId: string; topic: string; topicKey: string; generation: number }
  ) {
    hub.create(channelName).postMessage({ type: 'ROUTE_RELEASED', ...message });
  }

  it('confirms a handoff only when the ACK generation matches the route record', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const channelNames: string[] = [];
    const a = makeRuntime({ storage, hub, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({ storage, hub, tabId: 'tab-b', workerId: 'worker-b' });
    a.env.environment.createChannel = name => {
      channelNames.push(name);
      return hub.create(name);
    };
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    b.runtime.start();
    const topicKey = forgeHandoffRoute(storage, {
      workerId: 'worker-b',
      tabId: 'tab-b',
      generation: 3,
      handoffFromWorkerId: 'worker-a'
    });

    // A replayed ACK from an earlier handoff round (generation 2) must not
    // confirm the current generation-3 handoff. isAssigned cannot be used
    // here: it falls back to the stored route owner, which already points at
    // worker-b, so confirmedAt is the observable ACK acceptance signal.
    postRouteReleased(hub, channelNames[0]!, {
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-b',
      topic: 'topic-a',
      topicKey,
      generation: 2
    });
    expect(b.runtime.getSnapshot().routes[0]?.confirmedAt).toBeUndefined();

    // The matching ACK confirms the assignment and re-subscribes the transport.
    postRouteReleased(hub, channelNames[0]!, {
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-b',
      topic: 'topic-a',
      topicKey,
      generation: 3
    });
    expect(b.runtime.isAssigned('topic-a')).toBe(true);
    expect(b.runtime.getSnapshot().routes[0]?.confirmedAt).toBe(1_000);
  });

  it('drops a ROUTE_RELEASED whose source is not the recorded previous owner', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const channelNames: string[] = [];
    const a = makeRuntime({ storage, hub, tabId: 'tab-a', workerId: 'worker-a' });
    const c = makeRuntime({ storage, hub, tabId: 'tab-c', workerId: 'worker-c' });
    a.env.environment.createChannel = name => {
      channelNames.push(name);
      return hub.create(name);
    };
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    c.runtime.start();
    const topicKey = forgeHandoffRoute(storage, {
      workerId: 'worker-c',
      tabId: 'tab-c',
      generation: 3,
      handoffFromWorkerId: 'worker-b'
    });

    postRouteReleased(hub, channelNames[0]!, {
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-c',
      topic: 'topic-a',
      topicKey,
      generation: 3
    });
    expect(c.runtime.getSnapshot().routes[0]?.confirmedAt).toBeUndefined();
  });
});

describe('stability: BFCache round-trips', () => {
  it('stays consistent across repeated pagehide/pageshow cycles and only dispatches while visible', async () => {
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'bfcache' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'bfcache-cycles',
      environment: env.environment,
      initialConfig: {},
      transport
    });
    const received: number[] = [];
    bus.subscribe('topic', message => received.push(message.data));
    await bus.ready();
    transport.emit('topic', 1);
    expect(received).toEqual([1]);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      env.pageHide();
      // The chained suspend stop needs a microtask to detach the transport
      // handlers; afterwards a message delivered while hidden is discarded.
      await Promise.resolve();
      await Promise.resolve();
      const deliveredBefore = received.length;
      expect(() => transport.emit('topic', 2)).not.toThrow();
      expect(received.length).toBe(deliveredBefore);

      env.pageShow();
      await bus.ready();
      transport.emit('topic', 3);
      expect(received.length).toBe(deliveredBefore + 1);
    }

    // One transport open per initial start plus one per resume — no duplicate
    // opens, and the topic is re-subscribed exactly once per reopen.
    expect(transport.startCalls).toBe(3);
    expect(transport.subscribeCalls.filter(topic => topic === 'topic')).toHaveLength(3);
    await bus.stop();
  });

  it('cancels an in-flight persistence retry when the tab suspends', async () => {
    vi.useRealTimers();
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'suspend-retry' });
    const transport = new FakeTransport<number>();
    const persisted: Array<{ topic: string; data: number }> = [];
    let appendAttempts = 0;
    const bus = new CrossTabDataBus({
      clusterKey: 'suspend-retry',
      environment: env.environment,
      initialConfig: {},
      transport,
      replay: {
        persistenceRetry: { maxAttempts: 3, backoffMs: 30 },
        persistence: {
          load: async () => [],
          append: async () => undefined,
          appendBatch: async batch => {
            appendAttempts += 1;
            if (appendAttempts === 1) throw new Error('transient failure');
            persisted.push(...batch);
          }
        }
      }
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    bus.subscribe('topic', () => {});
    await bus.ready();

    transport.emit('topic', 1);
    await Promise.resolve();
    expect(appendAttempts).toBe(1);

    // Suspend before the 30ms retry timer fires: the generation bump must
    // cancel the pending retry instead of reporting a persistence error.
    env.pageHide();
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(appendAttempts).toBe(1);
    expect(errors).toEqual([]);

    // After resume the persistence path is usable again.
    env.pageShow();
    await bus.ready();
    transport.emit('topic', 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(persisted).toEqual([expect.objectContaining({ topic: 'topic', data: 2 })]);
    await bus.stop();
  });
});

describe('stability: transport recovery exhaustion', () => {
  it('resets the exhausted state after a successful reopen', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'exhaust-reset' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'exhaust-reset',
      environment: env.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 250, maxAttempts: 1 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    // First failure consumes the single automatic attempt. The failed reopen
    // itself reports 'error' after the cooldown has elapsed, which increments
    // the attempt again and immediately marks recovery as exhausted.
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(250);
    expect(transport.startCalls).toBe(2);
    expect(bus.getRecoveryStats().attempt).toBe(2);
    expect(bus.getRecoveryStats().exhausted).toBe(true);

    // Further errors do not schedule another automatic attempt.
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(transport.startCalls).toBe(2);

    // A successful reopen (triggered by the next subscribe on a down
    // transport) clears the exhausted flag and the attempt counter.
    transport.startShouldFail = false;
    bus.subscribe('topic-2', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(3);
    const stats = bus.getRecoveryStats();
    expect(stats.exhausted).toBe(false);
    expect(stats.attempt).toBe(0);
    await bus.stop();
  });
});

describe('stability: storage write failure recovery', () => {
  it('resets the backoff delay after a fully drained flush', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const originalSetItem = storage.setItem.bind(storage);
    let failures = 0;
    storage.setItem = (key, value) => {
      if (failures > 0) {
        failures -= 1;
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }
      originalSetItem(key, value);
    };
    const writer = new BatchingStorageWriter(storage);

    // First write fails once and lands on the 50ms retry.
    failures = 1;
    writer.setItem('first', '1');
    await vi.advanceTimersByTimeAsync(50);
    expect(storage.getItem('first')).toBe('1');

    // A drained flush resets the delay: the next failing write retries at
    // 50ms again, not at the elevated 100ms delay left by the first failure.
    failures = 1;
    writer.setItem('second', '2');
    await vi.advanceTimersByTimeAsync(50);
    expect(storage.getItem('second')).toBe('2');
    vi.useRealTimers();
  });

  it('gives up per key and lets other queued keys land once the failing key is dropped', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === 'doomed') throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      originalSetItem(key, value);
    };
    const writer = new BatchingStorageWriter(storage);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The failing key is written first, so the flush stops at it and the
    // healthy key stays queued behind it until the failing key is dropped.
    writer.setItem('doomed', 'x');
    writer.setItem('healthy', 'y');
    await vi.advanceTimersByTimeAsync(2_000);

    expect(storage.getItem('doomed')).toBeNull();
    expect(storage.getItem('healthy')).toBe('y');
    expect(writer.pendingSize).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('gave up after retries'), 'doomed');
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('resets the elevated retry delay when clear() cancels pending retries', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const originalSetItem = storage.setItem.bind(storage);
    let failures = 0;
    storage.setItem = (key, value) => {
      if (failures > 0) {
        failures -= 1;
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }
      originalSetItem(key, value);
    };
    const writer = new BatchingStorageWriter(storage);

    // Elevate the delay: a failed write leaves the next retry at 100ms.
    failures = 1;
    writer.setItem('abandoned', '1');
    writer.clear();
    expect(storage.getItem('abandoned')).toBeNull();

    // A fresh failing write must retry at the initial 50ms delay.
    failures = 1;
    writer.setItem('fresh', '2');
    await vi.advanceTimersByTimeAsync(50);
    expect(storage.getItem('fresh')).toBe('2');
    vi.useRealTimers();
  });
});

describe('stability: replay persistence cleanup races', () => {
  it('does not resurrect cleared topic history when a batch flush races unsubscribe', async () => {
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'clear-race' });
    const transport = new FakeTransport<number>();
    const appendBatch = vi.fn(async () => undefined);
    const clearTopic = vi.fn(async () => undefined);
    const bus = new CrossTabDataBus({
      clusterKey: 'clear-race',
      environment: env.environment,
      initialConfig: {},
      transport,
      replay: { persistence: { load: async () => [], append: async () => undefined, appendBatch, clearTopic } }
    });
    const unsubscribe = bus.subscribe('topic', () => {});
    await bus.ready();

    // Publish and unsubscribe within the same task: the batch flush microtask
    // is queued before the clearTopic call lands.
    transport.emit('topic', 1);
    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();

    expect(clearTopic).toHaveBeenCalledWith('topic');
    expect(appendBatch).not.toHaveBeenCalled();
    await bus.stop();
  });

  it('does not resurrect pruned history when a batch flush races clearReplayBefore', async () => {
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'prune-race' });
    const transport = new FakeTransport<number>();
    const persisted: Array<{ topic: string; data: number }> = [];
    const appendBatch = vi.fn(async (batch: ReadonlyArray<{ topic: string; data: number }>) => {
      persisted.push(...batch);
    });
    const clearBefore = vi.fn(async () => undefined);
    const bus = new CrossTabDataBus({
      clusterKey: 'prune-race',
      environment: env.environment,
      initialConfig: {},
      transport,
      replay: { persistence: { load: async () => [], append: async () => undefined, appendBatch, clearBefore } }
    });
    bus.subscribe('topic', () => {});
    await bus.ready();

    transport.emit('topic', 1, undefined, 500);
    await bus.clearReplayBefore(900);
    await Promise.resolve();
    await Promise.resolve();

    expect(clearBefore).toHaveBeenCalledWith(900);
    expect(appendBatch).not.toHaveBeenCalled();
    expect(persisted).toEqual([]);
    await bus.stop();
  });

  it('drops pending batch entries for a topic cleared via clearReplayTopic', async () => {
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'topic-clear-race' });
    const transport = new FakeTransport<number>();
    const appendBatch = vi.fn(async () => undefined);
    const bus = new CrossTabDataBus({
      clusterKey: 'topic-clear-race',
      environment: env.environment,
      initialConfig: {},
      transport,
      replay: { persistence: { load: async () => [], append: async () => undefined, appendBatch } }
    });
    bus.subscribe('topic', () => {});
    await bus.ready();

    transport.emit('topic', 1);
    await bus.clearReplayTopic('topic');
    await Promise.resolve();
    await Promise.resolve();

    expect(appendBatch).not.toHaveBeenCalled();
    await bus.stop();
  });
});
