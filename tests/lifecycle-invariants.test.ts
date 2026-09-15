import { describe, it, expect, vi } from 'vitest';
import { CrossTabDataBus } from '../src/core/data-bus';
import { MemoryStorage, ChannelHub, createFakeEnvironment } from './fakes';
import type { DataBusTransport, DataBusTransportHandlers } from '../src/core/types';
import { WORKER_STATUS } from '../src/utils/constants';

/**
 * Seeded lifecycle state-machine exploration.
 *
 * Every lifecycle fix in this area started as a specific interleaving of the
 * same handful of inputs: `pagehide`/`pageshow`, an explicit `start()`/`stop()`,
 * transport status reports, and recovery timers — each of which can land while
 * a previous async open/stop is still in flight. Rather than hand-picking one
 * more ordering, this test drives randomized sequences through a transport
 * whose `start()`/`stop()` stay pending until the test releases them, then
 * releases everything and asserts the invariants that must hold at quiescence.
 *
 * The invariants deliberately avoid predicting the *intended* end state (that
 * depends on which pagehide actually reached the cluster); they only assert
 * self-consistency:
 *   1. the DataBus suspend flag and the cluster suspend flag never diverge, so
 *      a bus that reports a live transport always has live coordination; and
 *   2. whenever neither side is suspended and no stop was requested, `ready()`
 *      resolves to a healthy transport instead of leaving the caller parked; and
 *   3. a sequence whose last explicit lifecycle intent was `stop()` settles in
 *      `started === false` / `state === 'stopped'` with no live transport, even
 *      when a fresh `start()` was issued before the teardown completed. This is
 *      the invariant the settle-but-not-cleared stop gate violated.
 *
 * Seeds are fixed, so a failure is always reproducible.
 */
class PendingTransport implements DataBusTransport<object, number> {
  startCalls = 0;
  stopCalls = 0;
  startShouldFail = false;
  /** Once true, every start()/stop() settles immediately so the bus quiesces. */
  autoSettle = false;
  readonly pendingStart: Array<() => void> = [];
  readonly pendingStop: Array<() => void> = [];
  private handlers: DataBusTransportHandlers<number> | null = null;

  start(_config: object, handlers: DataBusTransportHandlers<number>): void | Promise<void> {
    this.startCalls += 1;
    this.handlers = handlers;
    const finish = () => {
      if (this.startShouldFail) handlers.onStatus(WORKER_STATUS.ERROR);
      else handlers.onStatus(WORKER_STATUS.CONNECTED);
    };
    if (this.autoSettle) {
      finish();
      return;
    }
    return new Promise<void>(resolve => {
      this.pendingStart.push(() => {
        resolve();
        finish();
      });
    });
  }

  stop(): void | Promise<void> {
    this.stopCalls += 1;
    this.handlers = null;
    if (this.autoSettle) return;
    return new Promise<void>(resolve => {
      this.pendingStop.push(resolve);
    });
  }

  subscribe(): void {}
  unsubscribe(): void {}
  publish(): void {}

  emitError(error: unknown): void {
    this.handlers?.onError(error);
  }

  setStatus(status: (typeof WORKER_STATUS)[keyof typeof WORKER_STATUS]): void {
    this.handlers?.onStatus(status);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Let every already-scheduled microtask continuation run. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

describe('CrossTabDataBus lifecycle invariants', () => {
  it('keeps the DataBus, cluster, and transport lifecycle flags consistent across interleavings', async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 1_500 && failures.length < 5; seed += 1) {
      const random = mulberry32(seed);
      vi.useFakeTimers();
      try {
        const storage = new MemoryStorage();
        const hub = new ChannelHub();
        let now = 1_000;
        const environment = createFakeEnvironment({
          storage,
          hub,
          now: () => now,
          randomId: `lifecycle-${seed}`
        });
        const transport = new PendingTransport();
        const bus = new CrossTabDataBus({
          clusterKey: `lifecycle-invariants-${seed}`,
          environment: environment.environment,
          initialConfig: {},
          transport
        });
        bus.onError(() => undefined);
        const unsubscribe = bus.subscribe('topic', () => undefined);
        await flushMicrotasks();

        type Intent = 'running' | 'suspended' | 'stopped';
        let intent: Intent = 'running';
        const ops: string[] = [];
        const steps = 3 + Math.floor(random() * 8);
        for (let step = 0; step < steps; step += 1) {
          const roll = random();
          if (roll < 0.18) {
            ops.push('hide');
            environment.pageHide();
            if (intent !== 'stopped') intent = 'suspended';
          } else if (roll < 0.36) {
            ops.push('show');
            environment.pageShow();
            if (intent === 'suspended') intent = 'running';
          } else if (roll < 0.5) {
            ops.push('error');
            transport.emitError(new Error('runtime failure'));
          } else if (roll < 0.58) {
            ops.push('timer');
            now += 2_000;
            await vi.advanceTimersByTimeAsync(2_000);
          } else if (roll < 0.68) {
            ops.push('publish');
            bus.publish('topic', step);
          } else if (roll < 0.74) {
            ops.push('subscribe');
            bus.subscribe(`topic-${step}`, () => undefined);
          } else if (roll < 0.76) {
            ops.push('disconnect');
            transport.setStatus(WORKER_STATUS.DISCONNECTED);
          } else if (roll < 0.78) {
            ops.push('toggleStartFailure');
            transport.startShouldFail = !transport.startShouldFail;
          } else if (roll < 0.82) {
            ops.push('start');
            intent = 'running';
            void bus.start({}).catch(() => undefined);
          } else if (roll < 0.9) {
            ops.push('stop');
            intent = 'stopped';
            void bus.stop().catch(() => undefined);
          } else {
            ops.push('flush');
          }
          await flushMicrotasks();
        }
        unsubscribe();

        // Release every gate and let the lifecycle settle.
        transport.startShouldFail = false;
        transport.autoSettle = true;
        for (let i = 0; i < 60; i += 1) {
          transport.pendingStart.shift()?.();
          transport.pendingStop.shift()?.();
          await flushMicrotasks();
          now += 2_000;
          await vi.advanceTimersByTimeAsync(2_000);
          await flushMicrotasks();
        }
        environment.runIntervals();
        await flushMicrotasks();

        const health = bus.getHealthSummary();
        const cluster = bus.getClusterSnapshot();
        const context = `seed=${seed} ops=${ops.join(',')} starts=${transport.startCalls} stops=${transport.stopCalls}`;

        if (health.suspended !== cluster.suspended) {
          failures.push(
            `${context}: bus.suspended=${health.suspended} but cluster.suspended=${cluster.suspended} (state=${health.state})`
          );
        }
        if (intent === 'stopped' && health.started !== false) {
          failures.push(`${context}: expected a stopped bus, got started=${health.started}`);
        }
        if (intent === 'stopped' && health.state !== 'stopped') {
          failures.push(
            `${context}: expected state=stopped, got state=${health.state} ` +
            `transportReady=${health.transport.ready} status=${health.status}`
          );
        }
        if (intent !== 'stopped' && !health.suspended && !cluster.suspended) {
          let readyError: unknown = null;
          try {
            await bus.ready();
          } catch (error) {
            readyError = error;
          }
          if (readyError !== null || health.state !== 'healthy') {
            failures.push(
              `${context}: expected a ready transport, got state=${health.state} error=${String(readyError)}`
            );
          }
        }
        await bus.stop().catch(() => undefined);
      } finally {
        vi.useRealTimers();
      }
    }
    expect(failures).toEqual([]);
  });
});
