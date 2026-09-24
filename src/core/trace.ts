/**
 * DataBusTraceReporter — optional diagnostics, metrics, and delivery latency.
 *
 * Aggregates message throughput and dispatch latency over configurable windows,
 * emitting structured events (lifecycle, status, subscription, coordination,
 * error) and periodic metrics summaries. The sink is decoupled from the hot
 * message path — errors in the sink are isolated to console.warn.
 */
import type { WorkerStatus } from './types';
import type {
  PERSISTENCE_OPERATION,
  RECOVERY_OUTCOME,
  RELIABILITY_OPERATION,
  SUBSCRIPTION_ACTION,
  TRACE_ERROR_SOURCE,
  TRACE_LIFECYCLE_ACTION
} from '../utils/constants';
import {
  DEFAULT_STORAGE_PREFIX,
  TRACE_EVENT_TYPE,
  TRACE_MODE
} from '../utils/constants';

/** Trace reporting mode: record only events, only metrics, or both. */
/** Selects which trace categories the reporter emits.
 * - `events` — every non-metrics category: lifecycle, status, subscription,
 *   coordination, error **and reliability** events. The gate is
 *   `mode !== 'metrics'`, so `metrics` is the only category this mode excludes.
 * - `metrics` — periodic `message_metrics` snapshots only.
 * - `all` — both event streams and metrics snapshots. */
export type DataBusTraceMode = (typeof TRACE_MODE)[keyof typeof TRACE_MODE];

/** Emitted when the DataBus starts, stops, suspends, or resumes. */
export interface DataBusLifecycleTraceEvent {
  type: typeof TRACE_EVENT_TYPE.LIFECYCLE;
  action: (typeof TRACE_LIFECYCLE_ACTION)[keyof typeof TRACE_LIFECYCLE_ACTION];
  timestamp: number;
}

/** Emitted when the transport connection status changes. */
export interface DataBusStatusTraceEvent {
  type: typeof TRACE_EVENT_TYPE.STATUS;
  status: WorkerStatus;
  timestamp: number;
}

/** Emitted when a topic subscription is added or removed. */
export interface DataBusSubscriptionTraceEvent {
  type: typeof TRACE_EVENT_TYPE.SUBSCRIPTION;
  action: (typeof SUBSCRIPTION_ACTION)[keyof typeof SUBSCRIPTION_ACTION];
  topic: string;
  activeTopics: number;
  timestamp: number;
}

/** Emitted once per successful `start()`, on the opening's success arm — the
 * rejection arm emits nothing, and a recovery reopen does not produce a second
 * snapshot. It is *not* positioned there to wait for storage flushes:
 * `BatchingStorageWriter` serves pending writes on read, so a snapshot taken
 * before the opening resolved listed the same routes. Reports the coordinated
 * cluster state, including the route list as settled at that point. */
export interface DataBusCoordinationTraceEvent {
  type: typeof TRACE_EVENT_TYPE.COORDINATION;
  coordinated: boolean;
  activeWorkers: number;
  workers: string[];
  routes: string[];
  timestamp: number;
}

/** Emitted when a transport or operation error occurs. */
export interface DataBusErrorTraceEvent {
  type: typeof TRACE_EVENT_TYPE.ERROR;
  source: (typeof TRACE_ERROR_SOURCE)[keyof typeof TRACE_ERROR_SOURCE];
  timestamp: number;
}

/** Bounded reliability diagnostics for recovery, acknowledgments, and migrations. */
export interface DataBusReliabilityTraceEvent {
  type: typeof TRACE_EVENT_TYPE.RELIABILITY;
  operation: (typeof RELIABILITY_OPERATION)[keyof typeof RELIABILITY_OPERATION];
  topic?: string;
  persistenceOperation?: (typeof PERSISTENCE_OPERATION)[keyof typeof PERSISTENCE_OPERATION];
  attempt?: number;
  /** Outcome for a transport recovery attempt. */
  outcome?: (typeof RECOVERY_OUTCOME)[keyof typeof RECOVERY_OUTCOME];
  durationMs?: number;
  timestamp: number;
}

/**
 * Periodic metrics snapshot: message throughput, dispatch latency percentiles,
 * and active topic count. Aggregated over the interval and emitted every
 * `metricsIntervalMs`.
 */
export interface DataBusMetricsTraceEvent {
  type: typeof TRACE_EVENT_TYPE.MESSAGE_METRICS;
  durationMs: number;
  received: number;
  dispatched: number;
  topics: number;
  dispatchSamples: number;
  dispatchAvgMs: number;
  dispatchP50Ms: number;
  dispatchP95Ms: number;
  dispatchMaxMs: number;
  dedupAccepted: number;
  dedupSuppressed: number;
  timestamp: number;
}

/**
 * Synchronous metrics snapshot: same derived counters as a periodic
 * `message_metrics` event, but queryable on demand (e.g. from
 * `getDiagnostics()`) without a sink or an interval flush, and without
 * resetting the aggregation window.
 */
export interface DataBusMetricsSnapshot {
  /** Milliseconds elapsed in the current aggregation window. */
  durationMs: number;
  /** Messages received in the window. */
  received: number;
  /** Messages dispatched locally in the window. */
  dispatched: number;
  /** Distinct topics touched in the window. */
  topics: number;
  /** Latency samples collected in the window. */
  dispatchSamples: number;
  dispatchAvgMs: number;
  dispatchP50Ms: number;
  dispatchP95Ms: number;
  dispatchMaxMs: number;
  dedupAccepted: number;
  dedupSuppressed: number;
  timestamp: number;
}

export type DataBusTraceEvent =
  | DataBusLifecycleTraceEvent
  | DataBusStatusTraceEvent
  | DataBusSubscriptionTraceEvent
  | DataBusCoordinationTraceEvent
  | DataBusErrorTraceEvent
  | DataBusReliabilityTraceEvent
  | DataBusMetricsTraceEvent;

/** Distributive-conditional type: given a trace event union, derive the same shape minus `timestamp`. */
type DataBusTraceEventInput = DataBusTraceEvent extends infer TEvent
  ? TEvent extends DataBusTraceEvent
    ? Omit<TEvent, 'timestamp'>
    : never
  : never;

/** Configuration for {@link DataBusTraceReporter}. `sink` receives every
 * emitted event (filtered by `mode`); all other fields are optional. */
export interface DataBusTraceOptions {
  /** Tracing is opt-in: when `false` the reporter is inert, and the default is
   * `false` — so `trace: { sink }` alone emits nothing and `enabled: true` is
   * required. Pinned by `tests/data-bus.test.ts`'s `no-trace` case. */
  enabled?: boolean;
  /** Which event categories to emit. Default `all`. */
  mode?: DataBusTraceMode;
  /** Aggregation window for `message_metrics` events. Default 5 s. */
  metricsIntervalMs?: number;
  /** Injectable epoch clock for deterministic metrics and lifecycle tests. */
  now?: () => number;
  /** Callback invoked for each emitted trace event. */
  sink: (event: DataBusTraceEvent) => void;
  /** Queue sink delivery onto a microtask to keep hot paths non-blocking. */
  asyncSink?: boolean;
}

// Default bounds for the metrics aggregation window.
/** Default metrics aggregation window: 5 s between snapshots. */
const DEFAULT_METRICS_INTERVAL_MS = 5_000;
const MAX_PENDING_TOPICS = 1_000;
const MAX_PENDING_MESSAGES_PER_TOPIC = 256;
// Latency histogram: 20 buckets, each 50ms wide → covers 0–1000ms.
const LATENCY_BUCKET_COUNT = 20;
const LATENCY_BUCKET_SIZE_MS = 50;

/**
 * Aggregates DataBus diagnostics — lifecycle events, status changes, and
 * periodic latency histograms — and forwards them to a user-supplied sink.
 *
 * Latency is measured in a bucketed histogram (20 buckets × 50ms) rather than
 * storing every sample, keeping memory bounded even under high throughput.
 */
export class DataBusTraceReporter {
  private readonly enabled: boolean;
  private readonly mode: DataBusTraceMode;
  private readonly metricsIntervalMs: number;
  private readonly sink: (event: DataBusTraceEvent) => void;
  private readonly now: () => number;
  private readonly asyncSink: boolean;
  private pendingEvents: DataBusTraceEvent[] = [];
  private sinkFlushScheduled = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private intervalStartedAt = 0;
  // A reporter may be flushed explicitly before start(), but once stop() is
  // called it must remain inert until a new start() begins another session.
  private stopped = false;
  private received = 0;
  private dispatched = 0;
  private latencySamples = 0;
  private readonly topics = new Set<string>();
  // Per-topic FIFO of received timestamps, used to compute dispatch latency.
  private readonly receivedAt = new Map<string, number[]>();
  // Bucketed histogram: bucket index = floor(delayMs / 50), capped at 19.
  private readonly latencyBuckets = new Array<number>(LATENCY_BUCKET_COUNT).fill(0);
  private latencySumMs = 0;
  private dedupAccepted = 0;
  private dedupSuppressed = 0;

  constructor(options?: DataBusTraceOptions, now: () => number = options?.now ?? Date.now) {
    this.enabled = options?.enabled ?? false;
    this.mode = options?.mode ?? 'all';
    this.metricsIntervalMs = normalizeInterval(options?.metricsIntervalMs);
    // The zero on this arm counts the closure's *invocations*, not the `??`
    // selection: `tests/property.test.ts` builds a no-arg reporter 300 times per
    // run, which selects this default every time, and the arm still reads 0 —
    // because a reporter with no options has `enabled` false, and every emit path
    // is gated on it. Selection *with* emission needs `enabled: true` and no
    // `sink`, which the types forbid: `sink` is a required member of
    // `DataBusTraceOptions` (documented Required in en and zh) and this class is
    // not exported by the package, so only untyped JavaScript gets there. What
    // deleting the default costs that caller: each emission throws inside
    // `emitSync` and surfaces as a `[cross-tab-worker-databus] trace sink threw:`
    // warning — measured 2 events → 2 `TypeError`s where the default gives none,
    // and the 884-test suite is green either way. Recorded rather than pinned,
    // because pinning it needs a cast that fakes a call the declared types forbid.
    this.sink = options?.sink ?? (() => undefined);
    this.asyncSink = options?.asyncSink ?? false;
    this.now = now;
  }

  /** Start the periodic metrics flush interval. Only the `!enabled` return is a
   * true no-op: in 'events' mode, or with an interval already armed, it returns
   * without arming anything but has already cleared `stopped` one statement
   * earlier — which is what re-opens the event stream after a `stop()`. */
  start(): void {
    if (!this.enabled) return;
    this.stopped = false;
    if (this.intervalHandle || this.mode === TRACE_MODE.EVENTS) return;
    this.intervalStartedAt = this.now();
    this.intervalHandle = setInterval(() => this.flush(), this.metricsIntervalMs);
  }

  /** Pause the metrics interval and reset accumulated counters. */
  pause(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.intervalStartedAt = 0;
    this.resetMetrics();
  }

  stop(): void {
    this.stopped = true;
    // Events produced before stop are part of the old session and must not
    // leak through the queued async-sink microtask after teardown.
    this.pendingEvents = [];
    this.pause();
  }

  /** Synchronous sink state for diagnostics: whether delivery is async and how
   * many events are queued behind the microtask flush. A growing queue under
   * `asyncSink: true` is the first sign of sink back-pressure. */
  getSinkState(): { asyncSink: boolean; pendingEvents: number } {
    return { asyncSink: this.asyncSink, pendingEvents: this.pendingEvents.length };
  }

  /** Record an instantaneous trace event (lifecycle, status, error, etc.). */
  event(event: DataBusTraceEventInput): void {
    if (!this.enabled || this.stopped || this.mode === TRACE_MODE.METRICS) return;
    this.emit({ ...event, timestamp: this.now() } as DataBusTraceEvent);
  }

  /** Synchronous snapshot of the current metrics window without resetting it.
   * Returns the same derived counters as a periodic `message_metrics` event,
   * or null when metrics recording is inactive, which covers each of disabled,
   * stopped and events-only mode. The window keeps accumulating until the next
   * interval flush. */
  getMetrics(): DataBusMetricsSnapshot | null {
    if (!this.metricsActive) return null;
    const timestamp = this.now();
    const samples = this.latencySamples;
    return {
      durationMs: Math.max(0, timestamp - this.intervalStartedAt),
      received: this.received,
      dispatched: this.dispatched,
      topics: this.topics.size,
      dispatchSamples: samples,
      dispatchAvgMs: roundMs(samples === 0 ? 0 : this.latencySumMs / samples),
      dispatchP50Ms: roundMs(percentileMs(this.latencyBuckets, samples, 0.5)),
      dispatchP95Ms: roundMs(percentileMs(this.latencyBuckets, samples, 0.95)),
      dispatchMaxMs: roundMs(percentileMs(this.latencyBuckets, samples, 1)),
      dedupAccepted: this.dedupAccepted,
      dedupSuppressed: this.dedupSuppressed,
      timestamp
    };
  }

  /** Record that a message was received on `topic`; stores its timestamp for latency tracking. */
  recordReceived(topic: string): void {
    if (!this.metricsActive) return;
    this.received += 1;
    this.topics.add(topic);
    const queue = this.receivedAt.get(topic);
    // First receive for this topic creates a new FIFO queue (subject to the
    // topic cap); subsequent receives append to the existing queue (subject to
    // the per-topic cap). Both caps prevent a single misbehaving topic from
    // exhausting memory.
    if (!queue) {
      if (this.receivedAt.size >= MAX_PENDING_TOPICS) return;
      this.receivedAt.set(topic, [this.now()]);
      return;
    }
    if (queue.length >= MAX_PENDING_MESSAGES_PER_TOPIC) return;
    queue.push(this.now());
  }

  /**
   * Record that a received message will never be dispatched locally. Pops the
   * matching FIFO slot so a later dispatch on the same topic does not pair
   * with a stale receive timestamp.
   */
  recordDiscarded(topic: string): void {
    if (!this.metricsActive) return;
    const queue = this.receivedAt.get(topic);
    if (!queue) return;
    queue.shift();
    if (queue.length === 0) this.receivedAt.delete(topic);
  }

  /**
   * Record that a message was dispatched on `topic`. Pops the oldest receive
   * timestamp (FIFO) and increments the latency histogram. Dispatches without
   * a matching receive (e.g. broadcast fan-out from another tab) still count
   * as dispatched but do not produce a latency sample, and neither does a
   * dispatch whose delay cannot be computed at all.
   */
  recordDispatched(topic: string): void {
    if (!this.metricsActive) return;
    this.dispatched += 1;
    this.topics.add(topic);
    const queue = this.receivedAt.get(topic);
    const receivedTimestamp = queue?.shift();
    if (queue && queue.length === 0) this.receivedAt.delete(topic);
    if (receivedTimestamp === undefined) return;
    const delayMs = this.now() - receivedTimestamp;
    // A non-finite reading of the public `trace.now()` clock is not an extreme
    // latency but the absence of one, and recording it corrupts the whole window
    // instead of widening it: the sample count rises while the bucket write lands
    // on the key `"NaN"`, which no percentile walk reaches. Measured on the pre-fix
    // reporter with one good sample and one NaN one — `dispatchAvgMs` becomes NaN,
    // which a JSON sink renders as `null` so the field vanishes, and both the p95
    // and the max pin at the histogram ceiling because the rank exceeds the sum of
    // every reachable bucket, while p50 still prints a plausible number. A
    // *negative* delay is the other case: the pair is real and only its order is
    // wrong, which is what the clamp below answers, and the same window measures
    // an average and a max that agree with its histogram.
    if (!Number.isFinite(delayMs)) return;
    this.latencySamples += 1;
    const measuredMs = Math.max(0, delayMs);
    // `?? 0` is not a behavior guard and cannot be removed: `noUncheckedIndexedAccess`
    // types an index read as `number | undefined`, so the assignment needs the
    // fallback to compile at all (deleting it is TS2532, not a passing edit). The
    // arm it protects is the one the two lines above exclude — the clamp leaves a
    // finite non-negative delay, so `Math.floor` is a non-negative integer and
    // `Math.min` caps it at the last bucket, and the array is dense from
    // `.fill(0)` at the declaration and in `resetMetrics()` with this as its only
    // element write. So this leg is uncloseable in both directions: no input can
    // reach it, and no edit can delete it.
    const bucketIndex = Math.min(LATENCY_BUCKET_COUNT - 1, Math.floor(measuredMs / LATENCY_BUCKET_SIZE_MS));
    this.latencyBuckets[bucketIndex] = (this.latencyBuckets[bucketIndex] ?? 0) + 1;
    this.latencySumMs += measuredMs;
  }

  /** Record deduplication outcomes for the next metrics window. */
  recordDedupAccepted(): void {
    if (this.metricsActive) this.dedupAccepted += 1;
  }

  recordDedupSuppressed(): void {
    if (this.metricsActive) this.dedupSuppressed += 1;
  }

  /** True when metrics recording is active: enabled, not stopped, and the mode
   * includes metrics. Extracted so the seven readers — `getMetrics`, the five
   * `record*` methods and `flush` — share one guard instead of repeating it, which
   * leaves `stopped` read in exactly two places: this term, and `event()`, which
   * skips metrics entirely and so gates on the field itself.
   *
   * Do not add a `|| this.stopped` back at a call site. `getMetrics` and `flush`
   * each carried one, and the repetition is what made this term look untestable:
   * deleting the term left all 37 test files green, because a read of a field the
   * guard consulted one expression earlier can never be the decider. With both
   * repeats gone the same deletion dies twice in `tests/trace.test.ts` — to
   * "starts a fresh metrics window after pause and resume, and stop prevents later
   * flushes", and to "getMetrics returns null while metrics recording is inactive",
   * whose name promises all three inactive cases and which tested two of them until
   * this file stopped absorbing the third. What the term holds: `stop()` resets the
   * counters through `pause()` before any later call can reach them, so without it a
   * `record*` during a stopped window accumulates unreset and `start()` — which
   * clears `stopped` without resetting — hands it to the new session's window. */
  private get metricsActive(): boolean {
    return this.enabled && !this.stopped && this.mode !== TRACE_MODE.EVENTS;
  }

  /** Emit the accumulated metrics snapshot if the interval is active. */
  flush(): void {
    if (!this.metricsActive) return;
    this.flushNow();
  }

  private flushNow(): void {
    const timestamp = this.now();
    // Only emit when there was activity in this window — an all-zero metrics
    // snapshot adds noise without information. All four operands are activity in
    // that sentence's sense, and each was measured on its own: deleting any one of
    // them reddens the suite. The first two already were (three cases for
    // `received`, two for `dispatched`); the dedup pair was not, and the reason is
    // the shape of the test that covers them — 'includes dedup outcomes in metrics
    // windows' raises both counters in one window, so either surviving operand still
    // emits and neither deletion was observable. Two single-counter cases now pin
    // each half.
    //
    // What the two dedup legs have in common is the reporter; what they do not is
    // reachability through the bus. `DedupManager.isDuplicate` has exactly one
    // caller, `handleTransportMessage`, and it runs one statement *before*
    // `trace.recordReceived`: a suppression returns there without recording a
    // receive, so a bus window holding only suppressions is a real state (duplicate
    // publications on an otherwise idle topic). An acceptance falls through to that
    // `recordReceived` within the same synchronous block, and no timer can interleave
    // between two statements of one task — so an acceptance with nothing received and
    // nothing dispatched happens only when the reporter is called directly.
    //
    // The interval still advances `intervalStartedAt` on the silent path, so the next
    // window's duration is measured from this flush rather than from the last one that
    // emitted.
    if (this.received > 0 || this.dispatched > 0 || this.dedupAccepted > 0 || this.dedupSuppressed > 0) {
      const samples = this.latencySamples;
      this.emit({
        type: TRACE_EVENT_TYPE.MESSAGE_METRICS,
        durationMs: Math.max(0, timestamp - this.intervalStartedAt),
        received: this.received,
        dispatched: this.dispatched,
        topics: this.topics.size,
        dispatchSamples: samples,
        dispatchAvgMs: roundMs(samples === 0 ? 0 : this.latencySumMs / samples),
        // Percentiles are derived from the histogram, not sorted samples.
        dispatchP50Ms: roundMs(percentileMs(this.latencyBuckets, samples, 0.5)),
        dispatchP95Ms: roundMs(percentileMs(this.latencyBuckets, samples, 0.95)),
        dispatchMaxMs: roundMs(percentileMs(this.latencyBuckets, samples, 1)),
        dedupAccepted: this.dedupAccepted,
        dedupSuppressed: this.dedupSuppressed,
        timestamp
      });
      this.resetMetrics();
    }
    this.intervalStartedAt = timestamp;
  }

  private resetMetrics(): void {
    this.received = 0;
    this.dispatched = 0;
    this.latencySamples = 0;
    this.topics.clear();
    this.receivedAt.clear();
    this.latencyBuckets.fill(0);
    this.latencySumMs = 0;
    this.dedupAccepted = 0;
    this.dedupSuppressed = 0;
  }

  private emit(event: DataBusTraceEvent): void {
    if (this.asyncSink) {
      this.pendingEvents.push(event);
      if (!this.sinkFlushScheduled) {
        this.sinkFlushScheduled = true;
        queueMicrotask(() => {
          this.sinkFlushScheduled = false;
          const events = this.pendingEvents;
          this.pendingEvents = [];
          for (const queued of events) this.emitSync(queued);
        });
      }
      return;
    }
    this.emitSync(event);
  }

  private emitSync(event: DataBusTraceEvent): void {
    try {
      this.sink(event);
    } catch (error) {
      // Diagnostics must never affect data delivery, but surface a broken sink
      // so instrumentation bugs are not silently hidden.
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[${DEFAULT_STORAGE_PREFIX}] trace sink threw:`, error);
      }
    }
  }
}

/** Validate the metrics interval, falling back to the default when omitted.
 * @throws {RangeError} when `value` is not a positive finite number. */
function normalizeInterval(value: number | undefined): number {
  if (value === undefined) return DEFAULT_METRICS_INTERVAL_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('trace.metricsIntervalMs must be a positive finite number.');
  }
  return value;
}

/**
 * Approximate a percentile from the bucketed histogram. Walks buckets in
 * order, accumulating counts until the cumulative total reaches the rank
 * (`percentile * sampleCount`), and returns the bucket's midpoint as the
 * estimate.
 *
 * The closing `return` — the histogram ceiling, for a rank that exceeds every
 * count — has never executed, and it is not a leg a test is missing. All six
 * calls pass one of `0.5`, `0.95`, `1` together with this reporter's own
 * `latencySamples`, and `recordDispatched` increments that counter and exactly
 * one bucket in the same synchronous block with nothing between the two that can
 * skip either, so `samples === sum(buckets)` at every read; `sampleCount <= 0`
 * returns one line above, so `rank = max(1, ceil(p * samples)) <= samples` and
 * the walk always returns inside the loop. `recordDispatched`'s non-finite guard
 * is what keeps that true — before it, a `NaN` delay raised the sample count
 * while the bucket write landed on the non-index key `"NaN"`, and this line was
 * the value p95 and the max both reported. Deleting the statement is TS2366
 * ("Function lacks ending return statement"), not a passing edit, so the zero
 * count is a classification rather than a gap.
 */
function percentileMs(buckets: readonly number[], sampleCount: number, percentile: number): number {
  if (sampleCount <= 0) return 0;
  const rank = Math.max(1, Math.ceil(percentile * sampleCount));
  let seen = 0;
  for (let index = 0; index < buckets.length; index += 1) {
    // Same shape as the histogram write above, and the same reason it has zero
    // counts: `noUncheckedIndexedAccess` demands the fallback to compile. Unlike
    // there, nothing here excludes the hole — `buckets` is a parameter, and
    // `readonly number[]` is satisfied by `new Array(3)` — so this arm is a
    // statement about the argument rather than a leg a test could be pointed at.
    // Every call site passes the reporter's own dense array.
    seen += buckets[index] ?? 0;
    if (seen >= rank) return (index + 0.5) * LATENCY_BUCKET_SIZE_MS;
  }
  return buckets.length * LATENCY_BUCKET_SIZE_MS;
}

/** Round to one decimal place for stable, readable metrics output.
 * Avoids floating-point noise like 12.300000000001 in the trace sink. */
function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
