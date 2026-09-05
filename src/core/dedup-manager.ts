/**
 * DedupManager — bounded duplicate suppression for publications carrying
 * `messageId`.
 *
 * Extracted from CrossTabDataBus so the seen-ID map, adaptive TTL, and sweep
 * timer live in one self-contained unit with their own lifecycle. The DataBus
 * keeps a thin delegation: `isDuplicate()` on the inbound path, `start`/`stop`
 * on the lifecycle transitions, and `getStats()`/`reset()` on the diagnostics
 * surface.
 *
 * Deduplication is opt-in: an instance is only created when the DataBus was
 * configured with `dedup` options, so the zero-overhead default (no map, no
 * timer) is preserved.
 */
import type { DataBusTraceReporter } from './trace';
import { RELIABILITY_OPERATION, TRACE_EVENT_TYPE } from '../utils/constants';

/** Opt-in bounded duplicate suppression for publications carrying `messageId`. */
export interface DataBusDedupOptions {
  /** Max remembered message IDs before the oldest (FIFO) entry is evicted.
   * Default 1_000. */
  maxEntries?: number;
  /** Time-to-live for a remembered ID. Default 60_000 ms. */
  ttlMs?: number;
  /** Optional periodic sweep interval for quiet-topic expiry. */
  sweepMs?: number;
  /** Injectable epoch clock for deterministic tests and non-wall-clock hosts. */
  now?: () => number;
  /** Optional adaptive TTL bounds; enabled only when both are provided. */
  adaptiveTtl?: { minMs: number; maxMs: number };
}

/** Bounded deduplication counters for diagnostics and health checks. */
export interface DataBusDedupStats {
  enabled: boolean;
  /** Currently remembered message IDs. */
  tracked: number;
  /** Publications suppressed as duplicates since the last reset. */
  suppressed: number;
  /** Publications accepted (tracked) since the last reset. */
  accepted: number;
  /** Effective TTL when adaptive bounds are configured. */
  ttlMs?: number;
}

/** Resolved constructor options after defaults are applied. */
export interface DedupManagerOptions {
  /** Whether deduplication is enabled at all (false → no-op instance). */
  enabled: boolean;
  maxEntries: number;
  ttlMs: number;
  adaptiveBounds?: { minMs: number; maxMs: number } | undefined;
  /** Optional periodic sweep interval for quiet-topic expiry. */
  sweepMs?: number | undefined;
  /** Injectable epoch clock; also used as the message-arrival clock. */
  now: () => number;
  /** Trace sink for suppression events and metrics counters. */
  trace: DataBusTraceReporter;
}

/** Fixed observation window for adaptive TTL rate computation (5 s). */
const ADAPTIVE_WINDOW_MS = 5_000;
/** Message rate per ms treated as "quiet" — at or below this the adaptive TTL
 * relaxes toward `maxMs`. */
const QUIET_RATE_PER_MS = 0.01;

export class DedupManager {
  private readonly enabled: boolean;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly adaptiveBounds: { minMs: number; maxMs: number } | undefined;
  private readonly sweepMs: number | undefined;
  private readonly now: () => number;
  private readonly trace: DataBusTraceReporter;
  private readonly seenMessageIds = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private windowStartedAt = 0;
  private windowAccepted = 0;
  private suppressed = 0;
  private accepted = 0;

  constructor(options: DedupManagerOptions) {
    this.enabled = options.enabled;
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.adaptiveBounds = options.adaptiveBounds;
    this.sweepMs = options.sweepMs;
    this.now = options.now;
    this.trace = options.trace;
    this.windowStartedAt = this.now();
  }

  /** True when a publication carrying `messageId` was already seen. Records the
   * ID and updates counters/trace on acceptance. Disabled or ID-less messages
   * always pass through. */
  isDuplicate(messageId: string, topic: string): boolean {
    if (!this.enabled || !messageId) return false;
    const now = this.now();
    // Opportunistic expiry on the hot path keeps the map bounded between sweeps.
    for (const [id, timestamp] of this.seenMessageIds) {
      if (now - timestamp > this.ttlMs) this.seenMessageIds.delete(id);
    }
    if (this.seenMessageIds.has(messageId)) {
      this.suppressed += 1;
      this.trace.event({
        type: TRACE_EVENT_TYPE.RELIABILITY,
        operation: RELIABILITY_OPERATION.DEDUP_SUPPRESSED,
        topic
      });
      this.trace.recordDedupSuppressed();
      return true;
    }
    this.seenMessageIds.set(messageId, now);
    this.accepted += 1;
    this.windowAccepted += 1;
    this.trace.recordDedupAccepted();
    // Cap growth: evict oldest (FIFO) entries when the map exceeds the cap, so a
    // high-cardinality burst of distinct IDs cannot exhaust memory.
    while (this.seenMessageIds.size > this.maxEntries) {
      const oldest = this.seenMessageIds.keys().next().value;
      if (oldest === undefined) break;
      this.seenMessageIds.delete(oldest);
    }
    return false;
  }

  /** Start the periodic expiry sweep. No-op when disabled or no sweepMs was
   * configured (the hot-path opportunistic expiry still bounds the map). */
  start(): void {
    if (this.sweepTimer || !this.enabled || !this.sweepMs) return;
    this.sweepTimer = setInterval(() => this.pruneExpired(), this.sweepMs);
  }

  /** Stop the periodic expiry sweep. */
  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /** Return bounded deduplication counters for diagnostics and health checks. */
  getStats(): DataBusDedupStats {
    return {
      enabled: this.enabled,
      tracked: this.seenMessageIds.size,
      suppressed: this.suppressed,
      accepted: this.accepted,
      ...(this.adaptiveBounds ? { ttlMs: this.currentTtl() } : {})
    };
  }

  /** Drop all remembered IDs and reset dedup counters. */
  reset(): void {
    this.seenMessageIds.clear();
    this.suppressed = 0;
    this.accepted = 0;
    this.windowStartedAt = this.now();
    this.windowAccepted = 0;
  }

  /** Remove IDs whose timestamp predates the effective TTL cutoff. */
  private pruneExpired(): void {
    const cutoff = this.now() - this.currentTtl();
    for (const [id, timestamp] of this.seenMessageIds) {
      if (timestamp < cutoff) this.seenMessageIds.delete(id);
    }
  }

  /** Effective TTL: the fixed `ttlMs` unless adaptive bounds are configured, in
   * which case a higher recent message rate shortens the window (dedup only
   * needs to live long enough to bridge duplicate bursts). The window resets
   * every ADAPTIVE_WINDOW_MS. */
  private currentTtl(): number {
    if (!this.adaptiveBounds) return this.ttlMs;
    const now = this.now();
    const elapsed = now - this.windowStartedAt;
    if (elapsed >= ADAPTIVE_WINDOW_MS) {
      this.windowStartedAt = now;
      this.windowAccepted = 0;
      return this.adaptiveBounds.maxMs;
    }
    const rate = this.windowAccepted / Math.max(1, elapsed);
    const factor = Math.min(1, rate / QUIET_RATE_PER_MS);
    return this.adaptiveBounds.maxMs - (this.adaptiveBounds.maxMs - this.adaptiveBounds.minMs) * factor;
  }
}
