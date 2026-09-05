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

describe('hot-path performance gates', () => {
  it('matches 200k wildcard patterns within 500ms', () => {
    const topics = Array.from({ length: 100 }, (_, index) => `bench.rooms.room-${index}`);
    const start = Date.now();
    for (let index = 0; index < 200_000; index += 1) {
      topicMatchesPattern('bench.rooms.*', topics[index % topics.length]!);
    }
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('matches 200k exact topics within 500ms', () => {
    const topics = Array.from({ length: 100 }, (_, index) => `bench.rooms.room-${index}`);
    const start = Date.now();
    for (let index = 0; index < 200_000; index += 1) {
      topicMatchesPattern('bench.rooms.room-1', topics[index % topics.length]!);
    }
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('derives 100k opaque keys within 2.5s', () => {
    const start = Date.now();
    let sink = '';
    for (let index = 0; index < 100_000; index += 1) {
      sink = createOpaqueKey(`bench.rooms.room-${index % 100}`);
    }
    expect(sink).toBeTruthy();
    expect(Date.now() - start).toBeLessThan(2_500);
  });

  it('selects the least loaded of 50 workers 50k times within 1s', () => {
    const workers = makeWorkers(50);
    const start = Date.now();
    for (let index = 0; index < 50_000; index += 1) {
      selectLeastLoadedWorker(workers);
    }
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it('selects 3 active workers out of 50 twenty thousand times within 2.5s', () => {
    const workers = makeWorkers(50);
    const start = Date.now();
    for (let index = 0; index < 20_000; index += 1) {
      selectActiveWorkers(workers, 3);
    }
    expect(Date.now() - start).toBeLessThan(2_500);
  });
});
