import { describe, expect, it } from 'vitest';
import { createOpaqueKey } from '../src/core/hash';
import {
  DEFAULT_MAX_ACTIVE_WORKERS,
  approximatePayloadBytes,
  effectiveWorkerLoad,
  hasActiveOwner,
  isWildcardTopic,
  selectActiveWorkers,
  selectLeastLoadedWorker,
  selectRebalanceTarget,
  topicMatchesPattern
} from '../src/core/routing';
import type { WorkerRecord } from '../src/core/types';

const workers: WorkerRecord[] = [
  {
    workerId: 'worker-a',
    tabId: 'tab-a',
    load: 3,
    role: 'active',
    status: 'connected',
    visibilityState: 'visible',
    heartbeatAt: 1_000,
    registeredAt: 1
  },
  {
    workerId: 'worker-b',
    tabId: 'tab-b',
    load: 1,
    role: 'active',
    status: 'connected',
    visibilityState: 'visible',
    heartbeatAt: 1_000,
    registeredAt: 2
  }
];

describe('routing selection', () => {
  it('keeps a live owner sticky before considering load', () => {
    expect(selectLeastLoadedWorker(workers, 'worker-a')?.workerId).toBe('worker-a');
    expect(selectLeastLoadedWorker(workers)?.workerId).toBe('worker-b');
  });

  it('limits active workers and promotes by registration order', () => {
    const candidates = Array.from({ length: 5 }, (_, index): WorkerRecord => ({
      workerId: `worker-${index}`,
      tabId: `tab-${index}`,
      load: index,
      role: 'standby',
      status: 'connected',
      visibilityState: 'visible',
      heartbeatAt: 1_000,
      registeredAt: index + 1
    }));

    expect(DEFAULT_MAX_ACTIVE_WORKERS).toBe(3);
    expect(selectActiveWorkers(candidates).map(worker => worker.workerId)).toEqual([
      'worker-0',
      'worker-1',
      'worker-2'
    ]);
  });

  it('prefers visible workers while retaining hidden workers as a fallback', () => {
    const hiddenWorker = { ...workers[0]!, visibilityState: 'hidden' as const };
    expect(selectActiveWorkers([hiddenWorker, workers[1]!]).map(worker => worker.workerId)).toEqual([
      'worker-b'
    ]);
    expect(selectActiveWorkers([hiddenWorker]).map(worker => worker.workerId)).toEqual(['worker-a']);
  });

  it('rebalances only when the load gap is greater than one', () => {
    expect(selectRebalanceTarget(workers, 'worker-a')?.workerId).toBe('worker-b');
    expect(selectRebalanceTarget(workers, 'worker-b')).toBeNull();
    expect(selectRebalanceTarget([{ ...workers[0]!, load: 2 }, workers[1]!], 'worker-a')).toBeNull();
  });

  it('creates a stable opaque key without retaining the source value', () => {
    const topic = 'market.tick.private-context';
    const key = createOpaqueKey(topic);
    expect(key).toBe(createOpaqueKey(topic));
    expect(key).toHaveLength(32);
    expect(key).not.toContain('private-context');
  });
});

describe('routing edge cases', () => {
  const makeWorker = (overrides: Partial<WorkerRecord> = {}): WorkerRecord => ({
    workerId: 'w1',
    tabId: 't1',
    load: 0,
    role: 'active',
    status: 'connected',
    visibilityState: 'visible',
    heartbeatAt: 0,
    registeredAt: 0,
    ...overrides
  });

  it('selectLeastLoadedWorker returns undefined for an empty array', () => {
    expect(selectLeastLoadedWorker([])).toBeUndefined();
  });

  it('selectLeastLoadedWorker returns the sole worker for a single-element array', () => {
    const sole = makeWorker({ workerId: 'only' });
    expect(selectLeastLoadedWorker([sole])).toBe(sole);
  });

  it('selectLeastLoadedWorker breaks load ties by workerId ascending', () => {
    const a = makeWorker({ workerId: 'worker-z', load: 2 });
    const b = makeWorker({ workerId: 'worker-a', load: 2 });
    // Equal load → smallest workerId wins, regardless of array order.
    expect(selectLeastLoadedWorker([a, b])?.workerId).toBe('worker-a');
    expect(selectLeastLoadedWorker([b, a])?.workerId).toBe('worker-a');
  });

  it('selectLeastLoadedWorker ignores a preferred id that is not in the list', () => {
    const a = makeWorker({ workerId: 'w1', load: 5 });
    const b = makeWorker({ workerId: 'w2', load: 1 });
    expect(selectLeastLoadedWorker([a, b], 'absent')?.workerId).toBe('w2');
  });

  it('selectActiveWorkers returns an empty array for an empty input', () => {
    expect(selectActiveWorkers([])).toEqual([]);
  });

  it('selectActiveWorkers falls back to all workers when none is healthy', () => {
    // All disconnected → healthyWorkers is empty, so the fallback uses everyone.
    const dead = makeWorker({ workerId: 'w1', status: 'disconnected' });
    const dead2 = makeWorker({ workerId: 'w2', status: 'disconnected', registeredAt: 2 });
    expect(selectActiveWorkers([dead, dead2]).map(w => w.workerId)).toEqual(['w1', 'w2']);
  });

  it('hasActiveOwner returns false for a null route', () => {
    expect(hasActiveOwner(null, [makeWorker()])).toBe(false);
  });

  it('hasActiveOwner returns false when the owner is absent from the worker set', () => {
    const route = { topicKey: 'k', workerId: 'ghost', tabId: 't', updatedAt: 0, generation: 1 };
    expect(hasActiveOwner(route, [makeWorker({ workerId: 'real' })])).toBe(false);
  });

  it('hasActiveOwner returns true when the owner is alive', () => {
    const route = { topicKey: 'k', workerId: 'w1', tabId: 't', updatedAt: 0, generation: 1 };
    expect(hasActiveOwner(route, [makeWorker({ workerId: 'w1' })])).toBe(true);
  });
});

describe('routing selection edge branches', () => {
  const makeWorker = (overrides: Partial<WorkerRecord> = {}): WorkerRecord => ({
    workerId: 'w1',
    tabId: 't1',
    load: 0,
    role: 'active',
    status: 'connected',
    visibilityState: 'visible',
    heartbeatAt: 0,
    registeredAt: 0,
    ...overrides
  });

  it('selectLeastLoadedWorker keeps the lighter worker when a heavier one arrives later', () => {
    const light = makeWorker({ workerId: 'worker-light', load: 1 });
    const heavy = makeWorker({ workerId: 'worker-heavy', load: 9 });
    // byLoad > 0 → the later, heavier worker must not displace the incumbent.
    expect(selectLeastLoadedWorker([light, heavy])?.workerId).toBe('worker-light');
  });

  it('selectActiveWorkers sorts same-registration workers by workerId ascending', () => {
    const z = makeWorker({ workerId: 'worker-z', registeredAt: 1 });
    const a = makeWorker({ workerId: 'worker-a', registeredAt: 1 });
    expect(selectActiveWorkers([z, a]).map(w => w.workerId)).toEqual(['worker-a', 'worker-z']);
  });
});

describe('wildcard topic matching', () => {
  it('classifies wildcard patterns', () => {
    expect(isWildcardTopic('*')).toBe(true);
    expect(isWildcardTopic('chat.*')).toBe(true);
    expect(isWildcardTopic('chat.room.*')).toBe(true);
    expect(isWildcardTopic('chat.room.1')).toBe(false);
    expect(isWildcardTopic('chat.*.room')).toBe(false);
    expect(isWildcardTopic('')).toBe(false);
  });

  it('matches concrete topics against suffix wildcards', () => {
    expect(topicMatchesPattern('chat.*', 'chat.room.1')).toBe(true);
    expect(topicMatchesPattern('chat.*', 'chat.deep.nested.topic')).toBe(true);
    expect(topicMatchesPattern('chat.room.*', 'chat.room.1')).toBe(true);
    // The prefix must respect segment boundaries: "chat.*" does not match
    // "chatter.1" even though the string starts with "chat".
    expect(topicMatchesPattern('chat.*', 'chatter.1')).toBe(false);
    expect(topicMatchesPattern('chat.*', 'other.topic')).toBe(false);
  });

  it('treats "*" as match-everything and exact patterns as identity-only', () => {
    expect(topicMatchesPattern('*', 'anything.at.all')).toBe(true);
    expect(topicMatchesPattern('chat.room.1', 'chat.room.1')).toBe(true);
    expect(topicMatchesPattern('chat.room.1', 'chat.room.2')).toBe(false);
    expect(topicMatchesPattern('', '')).toBe(false);
    expect(topicMatchesPattern('a.*', '')).toBe(false);
  });
});

describe('adaptive load weighting', () => {
  const makeWorker = (overrides: Partial<WorkerRecord> = {}): WorkerRecord => ({
    workerId: 'w1',
    tabId: 't1',
    load: 0,
    role: 'active',
    status: 'connected',
    visibilityState: 'visible',
    heartbeatAt: 0,
    registeredAt: 0,
    ...overrides
  });

  const busySample = {
    windowMs: 1_000,
    messageCount: 100,
    byteCount: 10_000,
    overrunMs: 0,
    sampledAt: 5_000
  };

  it('effectiveWorkerLoad returns the raw topic count without a sample or weights', () => {
    const quiet = makeWorker({ workerId: 'quiet', load: 7 });
    expect(effectiveWorkerLoad(quiet)).toBe(7);
    expect(effectiveWorkerLoad(quiet, {})).toBe(7);
    // A sample alone changes nothing while the weights stay at their defaults.
    expect(effectiveWorkerLoad({ ...quiet, throughput: busySample })).toBe(7);
  });

  it('effectiveWorkerLoad adds normalized per-second rates when weights are set', () => {
    const worker = makeWorker({ workerId: 'w', load: 3, throughput: busySample });
    // 100 msg/s * 0.5 + 10_000 B/s * 0.001 = 50 + 10 = 60 → score 63.
    expect(effectiveWorkerLoad(worker, { messageRateWeight: 0.5, byteRateWeight: 0.001 })).toBeCloseTo(63, 10);
  });

  it('effectiveWorkerLoad ignores a non-positive window (no usable rate)', () => {
    const degenerate = makeWorker({
      workerId: 'w',
      load: 2,
      throughput: { windowMs: 0, messageCount: 10, byteCount: 0, overrunMs: 0, sampledAt: 0 }
    });
    expect(effectiveWorkerLoad(degenerate, { messageRateWeight: 1 })).toBe(2);
  });

  it('selectLeastLoadedWorker stays topic-count-only without options (legacy parity)', () => {
    const heavy = makeWorker({ workerId: 'heavy', load: 5, throughput: { ...busySample, messageCount: 1 } });
    const light = makeWorker({ workerId: 'light', load: 1, throughput: { ...busySample, messageCount: 999 } });
    expect(selectLeastLoadedWorker([heavy, light])?.workerId).toBe('light');
  });

  it('selectLeastLoadedWorker weights throughput when enabled, steering away from a busy owner', () => {
    const equalTopics = [
      makeWorker({ workerId: 'quiet', load: 2, throughput: { ...busySample, messageCount: 1 } }),
      makeWorker({ workerId: 'busy', load: 2, throughput: busySample })
    ];
    const options = { messageRateWeight: 0.5, byteRateWeight: 0.001 };
    // Same topic count; the quieter worker has the lower effective score.
    expect(selectLeastLoadedWorker(equalTopics, undefined, options)?.workerId).toBe('quiet');
    // Reversing array order must not change the result (deterministic scoring).
    expect(selectLeastLoadedWorker([equalTopics[1]!, equalTopics[0]!], undefined, options)?.workerId).toBe('quiet');
  });

  it('selectLeastLoadedWorker keeps a live sticky owner regardless of throughput', () => {
    const owner = makeWorker({ workerId: 'owner', load: 9, throughput: busySample });
    const standby = makeWorker({ workerId: 'standby', load: 1 });
    const options = { messageRateWeight: 1 };
    expect(selectLeastLoadedWorker([owner, standby], 'owner', options)?.workerId).toBe('owner');
  });

  it('effectiveWorkerLoad folds scheduling lag into the score', () => {
    // overrunMs 500 over windowMs 1000 → lagRatio 0.5 → +0.5 per weight unit.
    const laggy = makeWorker({
      workerId: 'laggy',
      load: 2,
      throughput: { windowMs: 1_000, messageCount: 0, byteCount: 0, overrunMs: 500, sampledAt: 0 }
    });
    expect(effectiveWorkerLoad(laggy, { scheduleLagWeight: 1 })).toBeCloseTo(2.5, 10);
    // Without the weight, lag contributes nothing.
    expect(effectiveWorkerLoad(laggy)).toBe(2);
    expect(effectiveWorkerLoad(laggy, {})).toBe(2);
  });

  it('selectLeastLoadedWorker steers away from a scheduling-laggy worker', () => {
    const laggy = makeWorker({
      workerId: 'laggy',
      load: 1,
      throughput: { windowMs: 1_000, messageCount: 0, byteCount: 0, overrunMs: 800, sampledAt: 0 }
    });
    const healthy = makeWorker({
      workerId: 'healthy',
      load: 2,
      throughput: { windowMs: 1_000, messageCount: 0, byteCount: 0, overrunMs: 0, sampledAt: 0 }
    });
    const options = { scheduleLagWeight: 2 };
    // Legacy (no weight) picks the fewer-topics worker; weighted picks healthy.
    expect(selectLeastLoadedWorker([laggy, healthy])?.workerId).toBe('laggy');
    expect(selectLeastLoadedWorker([laggy, healthy], undefined, options)?.workerId).toBe('healthy');
  });
});

describe('approximatePayloadBytes', () => {
  it('sizes primitives and empty values', () => {
    expect(approximatePayloadBytes(null)).toBe(0);
    expect(approximatePayloadBytes(undefined)).toBe(0);
    expect(approximatePayloadBytes(true)).toBe(4);
    expect(approximatePayloadBytes(42)).toBe(8);
    expect(approximatePayloadBytes('hello')).toBe(5);
    expect(approximatePayloadBytes(() => undefined)).toBe(0);
    expect(approximatePayloadBytes(Symbol('x'))).toBe(0);
  });

  it('uses the byte length of binary payloads and views', () => {
    expect(approximatePayloadBytes(new ArrayBuffer(16))).toBe(16);
    expect(approximatePayloadBytes(new Uint8Array(8).buffer)).toBe(8);
    // Typed-array / DataView views report their own byteLength, not the
    // underlying buffer's.
    expect(approximatePayloadBytes(new Uint8Array(8))).toBe(8);
    expect(approximatePayloadBytes(new DataView(new ArrayBuffer(12)))).toBe(12);
    expect(approximatePayloadBytes(new Float64Array(4))).toBe(4 * 8);
  });

  it('adds an array header plus elements', () => {
    expect(approximatePayloadBytes(['ab', true])).toBe(8 + 2 + 4);
  });

  it('sums object values recursively', () => {
    expect(approximatePayloadBytes({ a: 'x', b: { c: 3 } })).toBe(1 + 8);
  });
});
