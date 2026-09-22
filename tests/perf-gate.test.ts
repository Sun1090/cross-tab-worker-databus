/**
 * Hot-path performance gates.
 *
 * These are NOT benchmarks — run `pnpm bench` for real measurements. Each gate
 * asserts a generous ceiling (roughly 20x the local baseline, so shared CI
 * runners stay well clear of flakiness) and exists to catch catastrophic
 * regressions, e.g. an accidental O(n) allocation or a lost fast path in the
 * routing/hash hot loops that every publication and lookup traverses.
 */
import { describe, expect, it } from 'vitest';
import { selectActiveWorkers, selectLeastLoadedWorker, topicMatchesPattern } from '../src/core/routing';
import type { WorkerRecord } from '../src/core/types';
import { createOpaqueKey } from '../src/core/hash';

function makeWorkers(count: number): WorkerRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    workerId: `worker-${index}`,
    tabId: `tab-${index}`,
    load: index % 7,
    lastSeenAt: 1_000,
    heartbeatAt: 1_000,
    registeredAt: 1_000,
    status: 'connected' as const,
    protocolVersion: 1,
    role: 'active' as const,
    visibilityState: 'visible' as const
  }));
}

/**
 * Fastest of `repeats` runs over the same workload, in milliseconds.
 *
 * One wall-clock sample measures the scheduler as much as the code: vitest
 * isolates every file into its own worker, so a full-suite run shares the
 * runner's cores 38 ways and a descheduled loop can read 2x slower with nothing
 * changed — which took two of these five gates down in one run (2079ms against a
 * 1000ms ceiling) while the same file passed on its own. The fastest repeat is
 * the one that was not preempted, and a real regression is slow on *every*
 * repeat, so the minimum keeps the gate's teeth and drops its sensitivity to
 * load.
 */
function bestOfMs(repeats: number, work: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < repeats; run += 1) {
    const start = performance.now();
    work();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/** Enough repeats to outlast a preemption spike without tripling gate cost. */
const REPEATS = 3;

describe('hot-path performance gates', () => {
  it('matches 200k wildcard patterns within 500ms', () => {
    const topics = Array.from({ length: 100 }, (_, index) => `bench.rooms.room-${index}`);
    const elapsed = bestOfMs(REPEATS, () => {
      for (let index = 0; index < 200_000; index += 1) {
        topicMatchesPattern('bench.rooms.*', topics[index % topics.length]!);
      }
    });
    expect(elapsed).toBeLessThan(500);
  });

  it('matches 200k exact topics within 500ms', () => {
    const topics = Array.from({ length: 100 }, (_, index) => `bench.rooms.room-${index}`);
    const elapsed = bestOfMs(REPEATS, () => {
      for (let index = 0; index < 200_000; index += 1) {
        topicMatchesPattern('bench.rooms.room-1', topics[index % topics.length]!);
      }
    });
    expect(elapsed).toBeLessThan(500);
  });

  it('derives 100k opaque keys within 2.5s', () => {
    let sink = '';
    const elapsed = bestOfMs(REPEATS, () => {
      for (let index = 0; index < 100_000; index += 1) {
        sink = createOpaqueKey(`bench.rooms.room-${index % 100}`);
      }
    });
    expect(sink).toBeTruthy();
    expect(elapsed).toBeLessThan(2_500);
  });

  it('selects the least loaded of 50 workers 50k times within 1s', () => {
    const workers = makeWorkers(50);
    const elapsed = bestOfMs(REPEATS, () => {
      for (let index = 0; index < 50_000; index += 1) {
        selectLeastLoadedWorker(workers);
      }
    });
    expect(elapsed).toBeLessThan(1_000);
  });

  it('selects 3 active workers out of 50 twenty thousand times within 2.5s', () => {
    const workers = makeWorkers(50);
    const elapsed = bestOfMs(REPEATS, () => {
      for (let index = 0; index < 20_000; index += 1) {
        selectActiveWorkers(workers, 3);
      }
    });
    expect(elapsed).toBeLessThan(2_500);
  });
});
