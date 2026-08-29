import { describe, expect, it } from 'vitest';
import { createOpaqueKey } from '../src/core/hash';
import {
  DEFAULT_MAX_ACTIVE_WORKERS,
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
