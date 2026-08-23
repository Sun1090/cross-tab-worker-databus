import { describe, expect, it } from 'vitest';
import { createOpaqueKey } from '../src/core/hash';
import {
  DEFAULT_MAX_ACTIVE_WORKERS,
  selectActiveWorkers,
  selectLeastLoadedWorker,
  selectRebalanceTarget
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
