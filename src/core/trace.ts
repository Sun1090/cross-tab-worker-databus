/**
 * DataBusTraceReporter — optional diagnostics, metrics, and delivery latency.
 *
 * Aggregates message throughput and dispatch latency over configurable windows,
 * emitting structured events (lifecycle, status, subscription, coordination,
 * error) and periodic metrics summaries. The sink is decoupled from the hot
 * message path — errors in the sink are isolated to console.warn.
 */
import type { WorkerStatus } from './types';

/** Trace reporting mode: record only events, only metrics, or both. */
export type DataBusTraceMode = 'events' | 'metrics' | 'all';

/** Emitted when the DataBus starts, stops, suspends, or resumes. */
export interface DataBusLifecycleTraceEvent {
  type: 'lifecycle';
  action: 'start' | 'stop' | 'suspend' | 'resume';
  timestamp: number;
}

/** Emitted when the transport connection status changes. */
export interface DataBusStatusTraceEvent {
  type: 'status';
  status: WorkerStatus;
  timestamp: number;
}

/** Emitted when a topic subscription is added or removed. */
export interface DataBusSubscriptionTraceEvent {
  type: 'subscription';
  action: 'subscribe' | 'unsubscribe';
  topic: string;
  activeTopics: number;
  timestamp: number;
}

/** Emitted on each reconciliation round to record whether the cluster coordinated. */
export interface DataBusCoordinationTraceEvent {
  type: 'coordination';
  coordinated: boolean;
  activeWorkers: number;
  workers: string[];
  routes: string[];
  timestamp: number;
}

/** Emitted when a transport or operation error occurs. */
export interface DataBusErrorTraceEvent {
  type: 'error';
  source: 'transport' | 'operation';
  timestamp: number;
}

/**
 * Periodic metrics snapshot: message throughput, dispatch latency percentiles,
 * and active topic count. Aggregated over the interval and emitted every
 * `metricsIntervalMs`.
 */
export interface DataBusMetricsTraceEvent {
  type: 'message_metrics';
  durationMs: number;
  received: number;
  dispatched: number;
  topics: number;
  dispatchSamples: number;
  dispatchAvgMs: number;
  dispatchP50Ms: number;
  dispatchP95Ms: number;
  dispatchMaxMs: number;
  timestamp: number;
}

export type DataBusTraceEvent =
  | DataBusLifecycleTraceEvent
  | DataBusStatusTraceEvent
  | DataBusSubscriptionTraceEvent
  | DataBusCoordinationTraceEvent
  | DataBusErrorTraceEvent
  | DataBusMetricsTraceEvent;

/** Distributive-conditional type: given a trace event union, derive the same shape minus `timestamp`. */
type DataBusTraceEventInput = DataBusTraceEvent extends infer TEvent
  ? TEvent extends DataBusTraceEvent
    ? Omit<TEvent, 'timestamp'>
    : never
  : never;

export interface DataBusTraceOptions {
  enabled?: boolean;
  mode?: DataBusTraceMode;
  metricsIntervalMs?: number;
  sink: (event: DataBusTraceEvent) => void;
}

// Default bounds for the metrics aggregation window.
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
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private intervalStartedAt = 0;
  private received = 0;
  private dispatched = 0;
  private latencySamples = 0;
  private readonly topics = new Set<string>();
  // Per-topic FIFO of received timestamps, used to compute dispatch latency.
  private readonly receivedAt = new Map<string, number[]>();
  // Bucketed histogram: bucket index = floor(delayMs / 50), capped at 19.
  private readonly latencyBuckets = new Array<number>(LATENCY_BUCKET_COUNT).fill(0);
  private latencySumMs = 0;

  constructor(options?: DataBusTraceOptions, now: () => number = Date.now) {
    this.enabled = options?.enabled ?? false;
    this.mode = options?.mode ?? 'all';
    this.metricsIntervalMs = normalizeInterval(options?.metricsIntervalMs);
    this.sink = options?.sink ?? (() => undefined);
    this.now = now;
  }

  /** Start the periodic metrics flush interval. No-op when mode is 'events'. */
  start(): void {
    if (!this.enabled || this.intervalHandle || this.mode === 'events') return;
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
    this.pause();
  }

  /** Record an instantaneous trace event (lifecycle, status, error, etc.). */
  event(event: DataBusTraceEventInput): void {
    if (!this.enabled || this.mode === 'metrics') return;
    this.emit({ ...event, timestamp: this.now() } as DataBusTraceEvent);
  }

  /** Record that a message was received on `topic`; stores its timestamp for latency tracking. */
  recordReceived(topic: string): void {
    if (!this.enabled || this.mode === 'events') return;
    this.received += 1;
    this.topics.add(topic);
    const queue = this.receivedAt.get(topic);
    if (!queue) {
      // Cap the number of tracked topics to avoid unbounded memory growth.
      if (this.receivedAt.size >= MAX_PENDING_TOPICS) return;
      this.receivedAt.set(topic, [this.now()]);
      return;
    }
    // Cap per-topic queue length so a single busy topic cannot starve others.
    if (queue.length >= MAX_PENDING_MESSAGES_PER_TOPIC) return;
    queue.push(this.now());
  }

  /**
   * Record that a received message will never be dispatched locally. Pops the
   * matching FIFO slot so a later dispatch on the same topic does not pair
   * with a stale receive timestamp.
   */
  recordDiscarded(topic: string): void {
    if (!this.enabled || this.mode === 'events') return;
    const queue = this.receivedAt.get(topic);
    if (!queue) return;
    queue.shift();
    if (queue.length === 0) this.receivedAt.delete(topic);
  }

  /**
   * Record that a message was dispatched on `topic`. Pops the oldest receive
   * timestamp (FIFO) and increments the latency histogram. Dispatches without
   * a matching receive (e.g. broadcast fan-out from another tab) still count
   * as dispatched but do not produce a latency sample.
   */
  recordDispatched(topic: string): void {
    if (!this.enabled || this.mode === 'events') return;
    this.dispatched += 1;
    this.topics.add(topic);
    const queue = this.receivedAt.get(topic);
    const receivedTimestamp = queue?.shift();
    if (queue && queue.length === 0) this.receivedAt.delete(topic);
    if (receivedTimestamp === undefined) return;
    this.latencySamples += 1;
    const delayMs = Math.max(0, this.now() - receivedTimestamp);
    // Map the raw delay to a 50ms-wide bucket, capped at the last bucket.
    const bucketIndex = Math.min(LATENCY_BUCKET_COUNT - 1, Math.floor(delayMs / LATENCY_BUCKET_SIZE_MS));
    this.latencyBuckets[bucketIndex] = (this.latencyBuckets[bucketIndex] ?? 0) + 1;
    this.latencySumMs += delayMs;
  }

  /** Emit the accumulated metrics snapshot if the interval is active. */
  flush(): void {
    if (!this.enabled || this.mode === 'events') return;
    this.flushNow();
  }

  private flushNow(): void {
    const timestamp = this.now();
    if (this.received > 0 || this.dispatched > 0) {
      const samples = this.latencySamples;
      this.emit({
        type: 'message_metrics',
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
  }

  private emit(event: DataBusTraceEvent): void {
    try {
      this.sink(event);
    } catch (error) {
      // Diagnostics must never affect data delivery, but surface a broken sink
      // so instrumentation bugs are not silently hidden.
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[cross-tab-worker-databus] trace sink threw:', error);
      }
    }
  }
}

/** Validate the metrics interval, falling back to the default when omitted. */
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
 * estimate. Returns the histogram ceiling when the rank exceeds all counts.
 */
function percentileMs(buckets: readonly number[], sampleCount: number, percentile: number): number {
  if (sampleCount <= 0) return 0;
  const rank = Math.max(1, Math.ceil(percentile * sampleCount));
  let seen = 0;
  for (let index = 0; index < buckets.length; index += 1) {
    seen += buckets[index] ?? 0;
    if (seen >= rank) return (index + 0.5) * LATENCY_BUCKET_SIZE_MS;
  }
  return buckets.length * LATENCY_BUCKET_SIZE_MS;
}

/** Round to one decimal place for stable, readable metrics output. */
function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
