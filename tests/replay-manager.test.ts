/**
 * ReplayManager direct unit tests.
 *
 * The manager was previously only exercised indirectly through
 * `CrossTabDataBus`, which left the retention-sweep coalescing, the
 * persistence retry/backoff loop, the lifecycle cancellation path, and the
 * wildcard replay delivery gates without focused coverage. These tests drive
 * the class directly with an in-memory persistence double so each branch is
 * pinned deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistenceRetryCancelledError, ReplayManager } from '../src/core/replay-manager';
import type { ReplayManagerDeps } from '../src/core/replay-manager';
import type { DataBusReplayPersistence } from '../src/core/replay-persistence';
import { DataBusTraceReporter } from '../src/core/trace';
import type { DataBusMessage } from '../src/core/types';
import { PRUNE_STRATEGY } from '../src/utils/constants';

type Payload = { value: number };

function message(topic: string, value: number, timestamp?: number): DataBusMessage<Payload> {
  return { topic, data: { value }, ...(timestamp === undefined ? {} : { timestamp }) };
}

/** Minimal in-memory persistence double with per-operation fault injection.
 *
 * The optional protocol members are assigned as own properties inside the
 * constructor (never on the prototype) so a backend that does not advertise
 * `appendBatch` / `clear*` really is missing the method, which is exactly what
 * the manager's capability checks probe.
 */
class FakePersistence implements DataBusReplayPersistence<Payload> {
  messages: DataBusMessage<Payload>[] = [];
  appendCalls = 0;
  appendBatchCalls: number[] = [];
  clearBeforeCalls: number[] = [];
  clearTopicCalls: string[] = [];
  clearCalls = 0;
  loadCalls = 0;
  /** When > 0, the next N operations of the named kind reject. */
  failures: Partial<Record<'load' | 'append' | 'appendBatch' | 'clear' | 'clearTopic' | 'clearBefore', number>> = {};

  appendBatch?: (items: ReadonlyArray<DataBusMessage<Payload>>) => Promise<void>;
  clear?: () => Promise<void>;
  clearTopic?: (topic: string) => Promise<void>;
  clearBefore?: (timestamp: number) => Promise<void>;

  constructor(support: {
    appendBatch?: boolean;
    clear?: boolean;
    clearTopic?: boolean;
    clearBefore?: boolean;
  } = {}) {
    if (support.appendBatch) {
      this.appendBatch = async items => {
        this.appendBatchCalls.push(items.length);
        this.gate('appendBatch');
        this.messages.push(...items);
      };
    }
    if (support.clear) {
      this.clear = async () => {
        this.clearCalls += 1;
        this.gate('clear');
        this.messages = [];
      };
    }
    if (support.clearTopic) {
      this.clearTopic = async topic => {
        this.clearTopicCalls.push(topic);
        this.gate('clearTopic');
        this.messages = this.messages.filter(item => item.topic !== topic);
      };
    }
    if (support.clearBefore) {
      this.clearBefore = async timestamp => {
        this.clearBeforeCalls.push(timestamp);
        this.gate('clearBefore');
        this.messages = this.messages.filter(item => item.timestamp === undefined || item.timestamp >= timestamp);
      };
    }
  }

  private gate(kind: keyof FakePersistence['failures']): void {
    const remaining = this.failures[kind] ?? 0;
    if (remaining > 0) {
      this.failures[kind] = remaining - 1;
      throw new Error(`${kind} failed`);
    }
  }

  async load(): Promise<ReadonlyArray<DataBusMessage<Payload>>> {
    this.loadCalls += 1;
    this.gate('load');
    return this.messages.slice();
  }

  async append(item: DataBusMessage<Payload>): Promise<void> {
    this.appendCalls += 1;
    this.gate('append');
    this.messages.push(item);
  }
}

interface Harness {
  manager: ReplayManager<Payload>;
  persistenceErrors: unknown[];
  dispatchErrors: unknown[];
  traceEvents: { type: string; [key: string]: unknown }[];
  advance(ms: number): void;
}

function createManager(overrides: Partial<ReplayManagerDeps<Payload>> = {}): Harness {
  let now = 10_000;
  const persistenceErrors: unknown[] = [];
  const dispatchErrors: unknown[] = [];
  const traceEvents: { type: string; [key: string]: unknown }[] = [];
  const manager = new ReplayManager<Payload>({
    enabled: true,
    maxPerTopic: 3,
    pruneStrategy: PRUNE_STRATEGY.COUNT,
    persistenceRetryMaxAttempts: 3,
    persistenceRetryBackoffMs: 0,
    now: () => now,
    trace: new DataBusTraceReporter({ enabled: true, sink: event => traceEvents.push(event as never) }, () => now),
    onPersistenceError: error => persistenceErrors.push(error),
    onDispatchError: error => dispatchErrors.push(error),
    ...overrides
  });
  return {
    manager,
    persistenceErrors,
    dispatchErrors,
    traceEvents,
    advance(ms: number) {
      now += ms;
    }
  };
}

/** Let queued microtasks (persistence flush) and zero-delay timers settle. */
async function settle(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe('ReplayManager — disabled instance', () => {
  it('is inert: no buffers, no delivery, no persistence work', async () => {
    const persistence = new FakePersistence({ clear: true, clearTopic: true, clearBefore: true });
    const { manager } = createManager({ enabled: false, persistence });
    const handler = vi.fn();

    expect(manager.enabled).toBe(false);
    manager.record(message('t', 1));
    manager.deliverReplay('t', true, handler);
    manager.onTopicUnsubscribed('t');
    await manager.clearAll();
    await manager.clearTopic('t');

    expect(handler).not.toHaveBeenCalled();
    expect(persistence.appendCalls).toBe(0);
    expect(persistence.clearCalls).toBe(0);
    expect(persistence.clearTopicCalls).toEqual([]);
    expect(manager.getStats()).toEqual({ enabled: false, topics: 0, messages: 0, bytes: 0 });
  });

  it('still prunes durable history on clearBefore so a disabled ring cannot strand storage', async () => {
    const persistence = new FakePersistence({ clearBefore: true });
    const { manager } = createManager({ enabled: false, persistence });
    await manager.clearBefore(5_000);
    expect(persistence.clearBeforeCalls).toEqual([5_000]);
  });
});

describe('ReplayManager — in-memory ring semantics', () => {
  it('trims by count under the default strategy', () => {
    const { manager } = createManager();
    for (let index = 0; index < 5; index += 1) manager.record(message('t', index));
    const received: number[] = [];
    manager.deliverReplay('t', true, item => received.push(item.data.value));
    expect(received).toEqual([2, 3, 4]);
  });

  it('trims by age only under the age strategy, ignoring the count cap', () => {
    const { manager } = createManager({
      pruneStrategy: PRUNE_STRATEGY.AGE,
      retentionMs: 1_000,
      maxPerTopic: 2
    });
    manager.record(message('t', 1, 5_000)); // older than now(10_000) - 1_000
    manager.record(message('t', 2, 9_500));
    manager.record(message('t', 3, 9_900));
    const received: number[] = [];
    // maxPerTopic caps the replay limit, so ask for the age-pruned window.
    manager.deliverReplay('t', 2, item => received.push(item.data.value));
    expect(received).toEqual([2, 3]);
  });

  it('applies both count and age trimming under the both strategy', () => {
    const { manager } = createManager({
      pruneStrategy: PRUNE_STRATEGY.BOTH,
      retentionMs: 1_000,
      maxPerTopic: 3
    });
    manager.record(message('t', 1, 5_000));
    manager.record(message('t', 2, 9_500));
    manager.record(message('t', 3, 9_600));
    manager.record(message('t', 4, 9_700));
    const received: number[] = [];
    manager.deliverReplay('t', true, item => received.push(item.data.value));
    expect(received).toEqual([2, 3, 4]);
  });

  it('keeps timestamp-less messages when retention pruning runs', () => {
    const { manager } = createManager({ pruneStrategy: PRUNE_STRATEGY.BOTH, retentionMs: 1_000 });
    manager.record(message('t', 1));
    manager.record(message('t', 2, 9_900));
    const received: number[] = [];
    manager.deliverReplay('t', true, item => received.push(item.data.value));
    expect(received).toEqual([1, 2]);
  });

  it('reports buffer occupancy including an approximate payload footprint', () => {
    const { manager } = createManager();
    manager.record(message('a', 1));
    manager.record(message('b', 2));
    const stats = manager.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.topics).toBe(2);
    expect(stats.messages).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('drops every buffer on resetBuffers', () => {
    const { manager } = createManager();
    manager.record(message('t', 1));
    manager.resetBuffers();
    expect(manager.getStats().messages).toBe(0);
  });
});

describe('ReplayManager — replay delivery', () => {
  it('honors a numeric replay limit clamped to maxPerTopic', () => {
    const { manager } = createManager({ maxPerTopic: 5 });
    for (let index = 0; index < 5; index += 1) manager.record(message('t', index));
    const limited: number[] = [];
    manager.deliverReplay('t', 2, item => limited.push(item.data.value));
    expect(limited).toEqual([3, 4]);

    const overflow: number[] = [];
    manager.deliverReplay('t', 99, item => overflow.push(item.data.value));
    expect(overflow).toEqual([0, 1, 2, 3, 4]);
  });

  it('delivers nothing for a non-positive or fractional-to-zero limit', () => {
    const { manager } = createManager();
    manager.record(message('t', 1));
    const handler = vi.fn();
    manager.deliverReplay('t', 0, handler);
    manager.deliverReplay('t', 0.4, handler);
    manager.deliverReplay('t', -3, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers nothing for a topic with no buffer', () => {
    const { manager } = createManager();
    const handler = vi.fn();
    manager.deliverReplay('missing', true, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('marks replayed deliveries so consumers can distinguish history', () => {
    const { manager } = createManager();
    manager.record(message('t', 1));
    const received: DataBusMessage<Payload>[] = [];
    manager.deliverReplay('t', true, item => received.push(item));
    expect(received[0]?.replayed).toBe(true);
    // The buffered copy is untouched — replayed is stamped on delivery only.
    const again: DataBusMessage<Payload>[] = [];
    manager.deliverReplay('t', true, item => again.push(item));
    expect(again[0]?.replayed).toBe(true);
  });

  it('fans a wildcard subscription across every matching buffered topic', () => {
    const { manager } = createManager();
    manager.record(message('chat.a', 1));
    manager.record(message('chat.b', 2));
    manager.record(message('chatter.c', 3));
    manager.record(message('other', 4));
    const received: number[] = [];
    manager.deliverReplay('chat.*', true, item => received.push(item.data.value));
    expect(received.sort()).toEqual([1, 2]);
  });

  it('fans the universal wildcard across all buffers', () => {
    const { manager } = createManager();
    manager.record(message('a', 1));
    manager.record(message('b', 2));
    const received: number[] = [];
    manager.deliverReplay('*', true, item => received.push(item.data.value));
    expect(received.sort()).toEqual([1, 2]);
  });

  it('isolates a throwing handler so remaining history is still delivered', () => {
    const { manager, dispatchErrors } = createManager();
    manager.record(message('t', 1));
    manager.record(message('t', 2));
    const seen: number[] = [];
    manager.deliverReplay('t', true, item => {
      seen.push(item.data.value);
      if (item.data.value === 1) throw new Error('handler boom');
    });
    expect(seen).toEqual([1, 2]);
    expect(dispatchErrors).toHaveLength(1);
  });

  it('waits for hydration and skips a handler that unsubscribed during the load', async () => {
    const persistence = new FakePersistence();
    persistence.messages = [message('t', 7)];
    const { manager } = createManager({ persistence });

    const inactive = vi.fn();
    manager.deliverReplay('t', true, inactive, () => false);
    const active: number[] = [];
    manager.deliverReplay('t', true, item => active.push(item.data.value), () => true);
    await settle();

    expect(inactive).not.toHaveBeenCalled();
    expect(active).toEqual([7]);
  });
});

describe('ReplayManager — hydration', () => {
  it('loads durable history into the rings, trimming to maxPerTopic', async () => {
    const persistence = new FakePersistence();
    persistence.messages = [0, 1, 2, 3, 4].map(value => message('t', value));
    const { manager } = createManager({ persistence, maxPerTopic: 3 });
    const received: number[] = [];
    manager.deliverReplay('t', true, item => received.push(item.data.value));
    await settle();
    expect(received).toEqual([2, 3, 4]);
  });

  it('prunes past the retention window before loading', async () => {
    const persistence = new FakePersistence({ clearBefore: true });
    persistence.messages = [message('t', 1, 5_000), message('t', 2, 9_900)];
    const { manager } = createManager({ persistence, retentionMs: 1_000 });
    const received: number[] = [];
    manager.deliverReplay('t', true, item => received.push(item.data.value));
    await settle();
    expect(persistence.clearBeforeCalls).toEqual([9_000]);
    expect(received).toEqual([2]);
  });

  it('reports a hydration failure without blocking startup', async () => {
    const persistence = new FakePersistence();
    persistence.failures.load = 99;
    const { manager, persistenceErrors } = createManager({ persistence });
    const handler = vi.fn();
    manager.deliverReplay('t', true, handler);
    await settle(20);
    expect(persistenceErrors.length).toBeGreaterThan(0);
    // The bus still works: recording and replaying in-memory is unaffected.
    manager.record(message('t', 1));
    const received: number[] = [];
    manager.deliverReplay('t', true, item => received.push(item.data.value));
    await settle();
    expect(received).toEqual([1]);
  });
});

describe('ReplayManager — persistence appends', () => {
  it('appends one call per record when the backend has no appendBatch', async () => {
    const persistence = new FakePersistence();
    const { manager } = createManager({ persistence });
    manager.record(message('t', 1));
    manager.record(message('t', 2));
    await settle();
    expect(persistence.appendCalls).toBe(2);
  });

  it('coalesces a burst into a single appendBatch microtask flush', async () => {
    const persistence = new FakePersistence({ appendBatch: true });
    const { manager } = createManager({ persistence });
    manager.record(message('t', 1));
    manager.record(message('t', 2));
    manager.record(message('t', 3));
    await settle();
    expect(persistence.appendBatchCalls).toEqual([3]);
  });

  it('does not issue an empty flush when the queue is drained before the microtask', async () => {
    const persistence = new FakePersistence({ appendBatch: true, clearTopic: true });
    const { manager } = createManager({ persistence });
    manager.record(message('t', 1));
    manager.onTopicUnsubscribed('t'); // drops the queued entry
    await settle();
    expect(persistence.appendBatchCalls).toEqual([]);
    expect(persistence.clearTopicCalls).toEqual(['t']);
  });

  it('reports an append failure through the persistence error sink', async () => {
    const persistence = new FakePersistence();
    persistence.failures.append = 99;
    const { manager, persistenceErrors } = createManager({ persistence });
    manager.record(message('t', 1));
    await settle(20);
    expect(persistenceErrors).toHaveLength(1);
  });

  it('reports a batched append failure through the persistence error sink', async () => {
    const persistence = new FakePersistence({ appendBatch: true });
    persistence.failures.appendBatch = 99;
    const { manager, persistenceErrors } = createManager({ persistence });
    manager.record(message('t', 1));
    await settle(20);
    expect(persistenceErrors).toHaveLength(1);
  });
});

describe('ReplayManager — clear APIs', () => {
  it('clearAll drops buffers, cancels the queued flush, and clears durable history', async () => {
    const persistence = new FakePersistence({ appendBatch: true, clear: true });
    const { manager } = createManager({ persistence });
    persistence.messages = [message('t', 0)];
    manager.record(message('t', 1));
    await manager.clearAll();
    await settle();
    expect(manager.getStats().messages).toBe(0);
    expect(persistence.appendBatchCalls).toEqual([]);
    expect(persistence.messages).toEqual([]);
  });

  it('clearAll reports and rethrows a durable failure', async () => {
    const persistence = new FakePersistence({ clear: true });
    persistence.failures.clear = 99;
    const { manager, persistenceErrors } = createManager({ persistence });
    await expect(manager.clearAll()).rejects.toThrow('clear failed');
    expect(persistenceErrors).toHaveLength(1);
  });

  it('clearTopic removes only the named topic and reports a durable failure', async () => {
    const persistence = new FakePersistence({ clearTopic: true });
    const { manager } = createManager({ persistence });
    manager.record(message('a', 1));
    manager.record(message('b', 2));
    await manager.clearTopic('a');
    expect(manager.getStats().topics).toBe(1);
    expect(persistence.clearTopicCalls).toEqual(['a']);

    persistence.failures.clearTopic = 99;
    const { manager: failing, persistenceErrors } = createManager({ persistence });
    await expect(failing.clearTopic('a')).rejects.toThrow('clearTopic failed');
    expect(persistenceErrors).toHaveLength(1);
  });

  it('onTopicUnsubscribed reports a durable clearTopic failure without throwing', async () => {
    const persistence = new FakePersistence({ clearTopic: true });
    persistence.failures.clearTopic = 99;
    const { manager, persistenceErrors } = createManager({ persistence });
    manager.record(message('t', 1));
    expect(() => manager.onTopicUnsubscribed('t')).not.toThrow();
    await settle(20);
    expect(persistenceErrors).toHaveLength(1);
  });

  it('clearBefore prunes buffers, drops the topic when empty, and keeps queued newer entries', async () => {
    const persistence = new FakePersistence({ appendBatch: true, clearBefore: true });
    const { manager } = createManager({ persistence, maxPerTopic: 5 });
    manager.record(message('old', 1, 1_000));
    manager.record(message('mixed', 2, 1_000));
    manager.record(message('mixed', 3, 9_000));
    await manager.clearBefore(5_000);
    expect(manager.getStats().topics).toBe(1);
    const received: number[] = [];
    manager.deliverReplay('mixed', true, item => received.push(item.data.value));
    await settle();
    expect(received).toEqual([3]);
    expect(persistence.clearBeforeCalls).toContain(5_000);
    // The queued batch must not resurrect the pruned entries.
    expect(persistence.messages.map(item => item.data.value)).not.toContain(1);
  });

  it('clearBefore rejects a non-finite cutoff', async () => {
    const { manager } = createManager();
    await expect(manager.clearBefore(Number.NaN)).rejects.toThrow(TypeError);
    await expect(manager.clearBefore(Number.POSITIVE_INFINITY)).rejects.toThrow(TypeError);
  });

  it('clearBefore reports and rethrows a durable failure', async () => {
    const persistence = new FakePersistence({ clearBefore: true });
    persistence.failures.clearBefore = 99;
    const { manager, persistenceErrors } = createManager({ persistence });
    await expect(manager.clearBefore(1_000)).rejects.toThrow('clearBefore failed');
    expect(persistenceErrors).toHaveLength(1);
  });
});

describe('ReplayManager — retention sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() is a no-op without a retention window, sweep interval, or clearBefore support', () => {
    const noSupport = new FakePersistence();
    const { manager: a } = createManager({ persistence: noSupport, retentionMs: 1_000, retentionSweepMs: 100 });
    a.start();
    const { manager: b } = createManager({
      persistence: new FakePersistence({ clearBefore: true }),
      retentionSweepMs: 100
    });
    b.start();
    const { manager: c } = createManager({
      persistence: new FakePersistence({ clearBefore: true }),
      retentionMs: 1_000
    });
    c.start();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sweeps durable history on the configured interval and stops on stop()', async () => {
    const persistence = new FakePersistence({ clearBefore: true });
    const { manager } = createManager({ persistence, retentionMs: 1_000, retentionSweepMs: 100 });
    await vi.advanceTimersByTimeAsync(0); // let hydration settle
    const baseline = persistence.clearBeforeCalls.length;
    manager.start();
    manager.start(); // idempotent — a second start must not add a timer
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(persistence.clearBeforeCalls.length).toBeGreaterThan(baseline);
    const afterRunning = persistence.clearBeforeCalls.length;
    manager.stop();
    manager.stop(); // idempotent
    await vi.advanceTimersByTimeAsync(500);
    expect(persistence.clearBeforeCalls.length).toBe(afterRunning);
  });

  it('coalesces bursts into a single in-flight cleanup and re-runs with the newest cutoff', async () => {
    const persistence = new FakePersistence({ clearBefore: true });
    const harness = createManager({ persistence, retentionMs: 1_000, maxPerTopic: 10 });
    await vi.advanceTimersByTimeAsync(0);
    persistence.clearBeforeCalls.length = 0;

    harness.manager.record(message('t', 1, 10_000));
    harness.advance(500);
    harness.manager.record(message('t', 2, 10_500));
    harness.advance(500);
    harness.manager.record(message('t', 3, 11_000));
    await vi.advanceTimersByTimeAsync(10);

    // Three records, but the coalescing keeps the transaction count at or
    // below two: the first pass plus one re-run with the newest cutoff.
    expect(persistence.clearBeforeCalls.length).toBeLessThanOrEqual(2);
    expect(Math.max(...persistence.clearBeforeCalls)).toBe(10_000);
  });

  it('reports a sweep failure without stopping the loop', async () => {
    const persistence = new FakePersistence({ clearBefore: true });
    const harness = createManager({ persistence, retentionMs: 1_000, retentionSweepMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    persistence.failures.clearBefore = 1;
    harness.manager.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(harness.persistenceErrors).toHaveLength(1);
    expect(persistence.clearBeforeCalls.length).toBeGreaterThanOrEqual(2);
    harness.manager.stop();
  });
});

describe('ReplayManager — persistence retry policy', () => {
  it('retries a transient failure and traces each attempt', async () => {
    const persistence = new FakePersistence();
    persistence.failures.append = 2;
    const { manager, persistenceErrors, traceEvents } = createManager({ persistence });
    manager.record(message('t', 1));
    await settle(20);
    expect(persistence.appendCalls).toBe(3);
    expect(persistenceErrors).toEqual([]);
    expect(traceEvents.filter(event => event.operation === 'persistence_retry')).toHaveLength(2);
  });

  it('gives up after persistenceRetryMaxAttempts and keeps the ring intact', async () => {
    const persistence = new FakePersistence();
    persistence.failures.append = 99;
    const { manager, persistenceErrors } = createManager({ persistence, persistenceRetryMaxAttempts: 2 });
    manager.record(message('t', 1));
    await settle(20);
    expect(persistence.appendCalls).toBe(2);
    expect(persistenceErrors).toHaveLength(1);
    const received: number[] = [];
    manager.deliverReplay('t', true, item => received.push(item.data.value));
    await settle();
    expect(received).toEqual([1]);
  });

  it('honors the backoff delay between attempts, capped by the retry ceiling', async () => {
    vi.useFakeTimers();
    try {
      const persistence = new FakePersistence();
      persistence.failures.append = 2;
      const { manager } = createManager({
        persistence,
        persistenceRetryBackoffMs: 50,
        persistenceRetryMaxAttempts: 5
      });
      manager.record(message('t', 1));
      await vi.advanceTimersByTimeAsync(0);
      expect(persistence.appendCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(50);
      expect(persistence.appendCalls).toBe(2);
      await vi.advanceTimersByTimeAsync(100);
      expect(persistence.appendCalls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('suspend() cancels an in-flight retry with PersistenceRetryCancelledError', async () => {
    vi.useFakeTimers();
    try {
      const persistence = new FakePersistence();
      persistence.failures.append = 99;
      const { manager, persistenceErrors } = createManager({
        persistence,
        persistenceRetryBackoffMs: 50,
        persistenceRetryMaxAttempts: 10
      });
      manager.record(message('t', 1));
      await vi.advanceTimersByTimeAsync(0);
      manager.suspend();
      await vi.advanceTimersByTimeAsync(200);
      expect(persistenceErrors).toHaveLength(1);
      expect(persistenceErrors[0]).toBeInstanceOf(PersistenceRetryCancelledError);
      // No further attempts after the cancellation is observed.
      const attemptsAtCancel = persistence.appendCalls;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(persistence.appendCalls).toBe(attemptsAtCancel);
    } finally {
      vi.useRealTimers();
    }
  });

  it('suspend() also stops the retention sweep', async () => {
    vi.useFakeTimers();
    try {
      const persistence = new FakePersistence({ clearBefore: true });
      const { manager } = createManager({ persistence, retentionMs: 1_000, retentionSweepMs: 100 });
      await vi.advanceTimersByTimeAsync(0);
      manager.start();
      expect(vi.getTimerCount()).toBe(1);
      manager.suspend();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels before issuing the operation when the generation already advanced', async () => {
    const persistence = new FakePersistence({ clear: true });
    const { manager } = createManager({ persistence });
    manager.suspend();
    // clearAll starts a fresh retry generation, so it still succeeds; the
    // cancellation guard only rejects work started before the bump.
    await expect(manager.clearAll()).resolves.toBeUndefined();
    expect(persistence.clearCalls).toBe(1);
  });
});
