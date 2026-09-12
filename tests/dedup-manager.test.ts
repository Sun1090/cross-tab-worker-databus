/**
 * DedupManager direct unit tests.
 *
 * The manager was previously only exercised indirectly through
 * `CrossTabDataBus`, which left the hot-path expiry semantics, the FIFO
 * eviction boundary, the sweep lifecycle, and the adaptive TTL sampling
 * without focused coverage. These tests drive the class directly with an
 * injected clock so TTL windows are deterministic.
 *
 * One real defect is pinned here: the hot-path expiry used the fixed
 * `ttlMs` while the sweep and `getStats()` used the adaptive effective
 * TTL, so a burst that shrank the window toward `minMs` still retained IDs
 * for the full fixed TTL on the path that handles nearly all traffic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DedupManager } from '../src/core/dedup-manager';
import type { DedupManagerOptions } from '../src/core/dedup-manager';
import { DataBusTraceReporter } from '../src/core/trace';
import type { DataBusTraceEvent } from '../src/core/trace';

interface Harness {
  manager: DedupManager;
  events: DataBusTraceEvent[];
  advance(ms: number): void;
}

function createManager(overrides: Partial<DedupManagerOptions> = {}): Harness {
  let now = 1_000;
  const events: DataBusTraceEvent[] = [];
  const manager = new DedupManager({
    enabled: true,
    maxEntries: 1_000,
    ttlMs: 60_000,
    now: () => now,
    trace: new DataBusTraceReporter({ enabled: true, sink: event => events.push(event) }, () => now),
    ...overrides
  });
  return {
    manager,
    events,
    advance(ms: number) {
      now += ms;
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DedupManager — acceptance and suppression', () => {
  it('passes everything through when disabled and ignores empty IDs', () => {
    const { manager } = createManager({ enabled: false });
    expect(manager.isDuplicate('a', 't')).toBe(false);
    expect(manager.isDuplicate('a', 't')).toBe(false);
    expect(manager.getStats()).toMatchObject({ enabled: false, tracked: 0, accepted: 0, suppressed: 0 });

    const enabled = createManager();
    expect(enabled.manager.isDuplicate('', 't')).toBe(false);
    expect(enabled.manager.getStats().tracked).toBe(0);
  });

  it('accepts first sightings, suppresses repeats, and reports counters plus a trace event', () => {
    const { manager, events } = createManager();
    expect(manager.isDuplicate('a', 't')).toBe(false);
    expect(manager.isDuplicate('b', 't')).toBe(false);
    expect(manager.isDuplicate('a', 't')).toBe(true);
    expect(manager.getStats()).toMatchObject({ tracked: 2, accepted: 2, suppressed: 1 });
    const suppressions = events.filter(
      event => event.type === 'reliability' && event.operation === 'dedup_suppressed' && event.topic === 't'
    );
    expect(suppressions).toHaveLength(1);
  });

  it('expires entries on the hot path once they outlive the fixed TTL', () => {
    const { manager, advance } = createManager({ ttlMs: 1_000 });
    expect(manager.isDuplicate('x', 't')).toBe(false);
    advance(500);
    expect(manager.isDuplicate('x', 't')).toBe(true);
    advance(600);
    expect(manager.isDuplicate('x', 't')).toBe(false);
    expect(manager.getStats()).toMatchObject({ accepted: 2, suppressed: 1 });
  });

  it('evicts the oldest entry first when the map exceeds maxEntries', () => {
    const { manager } = createManager({ maxEntries: 2 });
    expect(manager.isDuplicate('a', 't')).toBe(false);
    expect(manager.isDuplicate('b', 't')).toBe(false);
    expect(manager.isDuplicate('a', 't')).toBe(true);
    expect(manager.isDuplicate('c', 't')).toBe(false);
    // 'a' was evicted to make room for 'c'.
    expect(manager.isDuplicate('a', 't')).toBe(false);
    // ...which in turn evicted 'b'.
    expect(manager.isDuplicate('b', 't')).toBe(false);
    expect(manager.getStats().tracked).toBe(2);
  });

  it('reset() clears remembered IDs, counters, and the sampling window', () => {
    const { manager } = createManager();
    expect(manager.isDuplicate('a', 't')).toBe(false);
    expect(manager.isDuplicate('a', 't')).toBe(true);
    manager.reset();
    expect(manager.getStats()).toMatchObject({ tracked: 0, accepted: 0, suppressed: 0 });
    expect(manager.isDuplicate('a', 't')).toBe(false);
  });

  it('omits ttlMs from stats unless adaptive bounds are configured', () => {
    expect(createManager().manager.getStats()).not.toHaveProperty('ttlMs');
    expect(
      createManager({ adaptiveBounds: { minMs: 100, maxMs: 2_000 } }).manager.getStats()
    ).toHaveProperty('ttlMs');
  });
});

describe('DedupManager — sweep lifecycle', () => {
  it('prunes quiet entries on the sweep interval and stops with the manager', () => {
    vi.useFakeTimers();
    try {
      const { manager, advance } = createManager({ ttlMs: 1_000, sweepMs: 500 });
      manager.start();
      expect(vi.getTimerCount()).toBe(1);
      // A second start must not schedule a duplicate timer.
      manager.start();
      expect(vi.getTimerCount()).toBe(1);

      expect(manager.isDuplicate('a', 't')).toBe(false);
      advance(1_500);
      vi.advanceTimersByTime(500);
      // The sweep pruned 'a', so it is accepted again.
      expect(manager.isDuplicate('a', 't')).toBe(false);

      manager.stop();
      expect(vi.getTimerCount()).toBe(0);
      // Restarting re-arms the sweep.
      manager.start();
      expect(vi.getTimerCount()).toBe(1);
      manager.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not start a sweep timer when disabled or unconfigured', () => {
    vi.useFakeTimers();
    try {
      const disabled = createManager({ enabled: false, sweepMs: 100 });
      disabled.manager.start();
      // Would throw if a timer were scheduled with a dead clock; advancing
      // time must also change nothing.
      vi.advanceTimersByTime(10_000);
      expect(disabled.manager.getStats().tracked).toBe(0);

      const noSweep = createManager({ ttlMs: 1_000 });
      noSweep.manager.start();
      noSweep.advance(5_000);
      vi.advanceTimersByTime(5_000);
      // Hot-path expiry still bounds the map without any timer.
      expect(noSweep.manager.isDuplicate('a', 't')).toBe(false);
      expect(noSweep.manager.isDuplicate('a', 't')).toBe(true);
      noSweep.manager.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DedupManager — adaptive TTL', () => {
  it('expires entries on the hot path using the shrunk adaptive TTL, not the fixed one', () => {
    // Regression: the hot-path expiry used the fixed 60 s TTL while the
    // sweep and getStats() used the adaptive window, so a burst that shrank
    // the effective TTL toward minMs never took effect where it matters.
    const { manager, advance } = createManager({
      ttlMs: 60_000,
      adaptiveBounds: { minMs: 100, maxMs: 2_000 }
    });
    for (let index = 0; index < 500; index += 1) {
      expect(manager.isDuplicate(`burst-${index}`, 't')).toBe(false);
    }
    expect(manager.getStats().ttlMs).toBe(100);
    // 150 ms later the IDs are older than the adaptive 100 ms window.
    advance(150);
    expect(manager.isDuplicate('burst-0', 't')).toBe(false);
    // ...but still far younger than the fixed 60 s TTL, so the old code
    // would have kept suppressing here.
    expect(manager.getStats()).toMatchObject({ suppressed: 0 });
  });

  it('relaxes toward maxMs when traffic is quiet', () => {
    const { manager, advance } = createManager({
      ttlMs: 1_000,
      adaptiveBounds: { minMs: 100, maxMs: 2_000 }
    });
    expect(manager.isDuplicate('a', 't')).toBe(false);
    advance(1_000);
    // 1 message per 1000 ms = 0.001/ms, well below the 0.01/ms quiet rate.
    const ttlMs = manager.getStats().ttlMs ?? 0;
    expect(ttlMs).toBeGreaterThan(1_500);
    expect(ttlMs).toBeLessThanOrEqual(2_000);
  });

  it('resets the sampling window after the adaptive window elapses', () => {
    const { manager, advance } = createManager({
      ttlMs: 1_000,
      adaptiveBounds: { minMs: 100, maxMs: 2_000 }
    });
    for (let index = 0; index < 300; index += 1) {
      manager.isDuplicate(`burst-${index}`, 't');
    }
    expect(manager.getStats().ttlMs).toBe(100);
    advance(6_000);
    // A fresh window reports the relaxed bound...
    expect(manager.getStats().ttlMs).toBe(2_000);
    // ...and a new burst shrinks it again.
    for (let index = 0; index < 300; index += 1) {
      manager.isDuplicate(`round-2-${index}`, 't');
    }
    expect(manager.getStats().ttlMs).toBe(100);
  });
});
