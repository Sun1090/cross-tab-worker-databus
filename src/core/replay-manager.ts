/**
 * ReplayManager — bounded per-topic replay history with optional durable
 * persistence.
 *
 * Extracted from CrossTabDataBus so the ring buffers, IndexedDB append/load
 * lifecycle, retention cleanup, and retry policy live in one self-contained
 * unit. The DataBus keeps a thin delegation: `record()` on dispatch,
 * `deliverReplay()` on late-joining handlers, `start`/`stop`/`suspend()` on
 * lifecycle transitions, and `clear*()` on the public replay API.
 *
 * Replay is opt-in: an instance is created with `enabled: false` when the
 * DataBus has no `replay` options, making the zero-overhead default (no ring,
 * no timer, no persistence calls) explicit.
 *
 * Persistence failures are reported through the injected `onPersistenceError`
 * sink (the DataBus routes these to its persistence failure ledger and health
 * summary). Transient failures are retried with exponential backoff; a
 * `PersistenceRetryCancelledError` is thrown when a lifecycle transition
 * (suspend/stop) supersedes the in-flight operation, and is swallowed by the
 * DataBus's persistence error sink so teardown never surfaces noise.
 */
import { isWildcardTopic, topicMatchesPattern } from './routing';
import type { DataBusReplayPersistence } from './replay-persistence';
import type { DataBusTraceReporter } from './trace';
import type { DataBusMessage, DataBusMessageHandler } from './types';
import { PERSISTENCE_OPERATION, PRUNE_STRATEGY, RELIABILITY_OPERATION, TRACE_EVENT_TYPE } from '../utils/constants';

/** Thrown when a lifecycle transition cancels an in-flight persistence retry. */
export class PersistenceRetryCancelledError extends Error {
  constructor() {
    super('Persistence retry cancelled by lifecycle transition.');
    this.name = 'PersistenceRetryCancelledError';
  }
}

/** Resolved constructor options after the DataBus applies defaults. */
export interface ReplayManagerDeps<TData = unknown> {
  /** Whether replay buffering is enabled at all (false → no-op instance). */
  enabled: boolean;
  /** Maximum buffered publications per topic. */
  maxPerTopic: number;
  /** Optional durable history backend; null → in-memory only. */
  persistence?: DataBusReplayPersistence<TData> | null;
  /** Optional producer-timestamp retention window in milliseconds. */
  retentionMs?: number | undefined;
  /** History trimming policy. */
  pruneStrategy: (typeof PRUNE_STRATEGY)[keyof typeof PRUNE_STRATEGY];
  /** Optional periodic sweep interval for durable retention cleanup. */
  retentionSweepMs?: number | undefined;
  /** Total persistence attempts including the initial operation. */
  persistenceRetryMaxAttempts: number;
  /** Initial delay between persistence retry attempts. */
  persistenceRetryBackoffMs: number;
  /** Injectable epoch clock; used for retention cutoffs. */
  now: () => number;
  /** Trace sink for persistence retry/cleanup diagnostics. */
  trace: DataBusTraceReporter;
  /** Sink for persistence failures (routes to the DataBus failure ledger). */
  onPersistenceError: (error: unknown) => void;
  /** Sink for a throwing replay-delivery handler (dispatch error source). */
  onDispatchError: (error: unknown) => void;
}

/** Cap on the exponential backoff delay (ms) for persistence retries. */
const MAX_RETRY_DELAY_MS = 1_600;

export class ReplayManager<TData = unknown> {
  private readonly buffers: Map<string, DataBusMessage<TData>[]> | null;
  private readonly maxPerTopic: number;
  private readonly persistence: DataBusReplayPersistence<TData> | null;
  private readonly retentionMs: number | undefined;
  private readonly pruneStrategy: (typeof PRUNE_STRATEGY)[keyof typeof PRUNE_STRATEGY];
  private readonly retentionSweepMs: number | undefined;
  private readonly persistenceRetryMaxAttempts: number;
  private readonly persistenceRetryBackoffMs: number;
  private readonly now: () => number;
  private readonly trace: DataBusTraceReporter;
  private readonly onPersistenceError: (error: unknown) => void;
  private readonly onDispatchError: (error: unknown) => void;
  /** Bumped on suspend/stop so in-flight persistence retries are cancelled. */
  private retryGeneration = 0;
  private pendingReplayPersistence: DataBusMessage<TData>[] = [];
  private persistenceFlushScheduled = false;
  private readonly hydration: Promise<void>;
  /** Coalesced retention cleanup: the newest cutoff wins while one is running. */
  private retentionCleanup: Promise<void> | null = null;
  private retentionCutoff: number | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: ReplayManagerDeps<TData>) {
    this.buffers = deps.enabled ? new Map() : null;
    this.maxPerTopic = deps.maxPerTopic;
    this.persistence = deps.persistence ?? null;
    this.retentionMs = deps.retentionMs;
    this.pruneStrategy = deps.pruneStrategy;
    this.retentionSweepMs = deps.retentionSweepMs;
    this.persistenceRetryMaxAttempts = deps.persistenceRetryMaxAttempts;
    this.persistenceRetryBackoffMs = deps.persistenceRetryBackoffMs;
    this.now = deps.now;
    this.trace = deps.trace;
    this.onPersistenceError = deps.onPersistenceError;
    this.onDispatchError = deps.onDispatchError;
    this.hydration = this.hydrate();
  }

  /** True when replay buffering is enabled. */
  get enabled(): boolean {
    return this.buffers !== null;
  }

  /** Append a dispatched publication to the topic's replay ring buffer.
   * No-op when replay is disabled. */
  record(message: DataBusMessage<TData>): void {
    if (!this.buffers) return;
    let buffer = this.buffers.get(message.topic);
    if (!buffer) {
      buffer = [];
      this.buffers.set(message.topic, buffer);
    }
    // Preserve the public message shape for legacy adapters. Retention pruning
    // applies to messages that carry an explicit producer timestamp.
    buffer.push(message);
    if (this.pruneStrategy !== PRUNE_STRATEGY.AGE) {
      while (buffer.length > this.maxPerTopic) buffer.shift();
    }
    if (this.pruneStrategy !== PRUNE_STRATEGY.COUNT && this.retentionMs !== undefined) {
      const cutoff = this.now() - this.retentionMs;
      while (buffer.length > 0) {
        const first = buffer[0];
        if (!first || first.timestamp === undefined || first.timestamp >= cutoff) break;
        buffer.shift();
      }
    }
    if (!this.persistence) return;
    if (this.persistence.appendBatch) {
      this.pendingReplayPersistence.push(message);
      this.schedulePersistenceFlush();
    } else {
      void this.withPersistenceRetry(PERSISTENCE_OPERATION.APPEND, () => this.persistence!.append(message))
        .catch(error => this.onPersistenceError(error));
    }
    if (this.retentionMs !== undefined && this.persistence.clearBefore) {
      this.scheduleRetentionCleanup(this.now() - this.retentionMs);
    }
  }

  /** Deliver buffered history to a newly-registered handler. For an exact
   * topic this is that topic's ring; for a wildcard subscription every
   * buffered topic matching the pattern contributes (in buffer insertion
   * order). Replay deliveries are marked `replayed: true` and are not counted
   * into trace metrics.
   *
   * When a durable persistence backend is present, delivery waits for the
   * hydration load to settle first; `isHandlerActive` is then consulted so a
   * handler that unsubscribed during the async load does not receive history.
   */
  deliverReplay(
    topic: string,
    replayOption: boolean | number,
    handler: DataBusMessageHandler<TData>,
    isHandlerActive?: () => boolean
  ): void {
    if (!this.buffers) return;
    const limit = typeof replayOption === 'number'
      ? Math.min(Math.floor(replayOption), this.maxPerTopic)
      : this.maxPerTopic;
    if (this.persistence) {
      void this.hydration.then(() => {
        if (isHandlerActive?.() ?? true) this.deliver(topic, limit, handler);
      });
      return;
    }
    this.deliver(topic, limit, handler);
  }

  /** Clean up a topic that lost its last local handler: drop the ring buffer,
   * filter queued batch flushes (so an in-flight append cannot undo the
   * clearTopic), and prune durable history. */
  onTopicUnsubscribed(topic: string): void {
    if (!this.buffers) return;
    this.buffers.delete(topic);
    // A batched persistence flush may still be queued behind this task; drop
    // the topic's pending entries so clearTopic is not undone by the append.
    this.pendingReplayPersistence = this.pendingReplayPersistence.filter(message => message.topic !== topic);
    if (this.persistence?.clearTopic) {
      void this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR_TOPIC, () => this.persistence!.clearTopic!(topic))
        .catch(error => this.onPersistenceError(error));
    }
  }

  /** Clear all in-memory replay buffers and, when supported, durable history.
   * Reports persistence failures and rethrows, mirroring the public API
   * contract that callers can observe a failed clear. */
  async clearAll(): Promise<void> {
    if (!this.buffers) return;
    this.buffers.clear();
    // Cancel any queued batch flush so cleared history is not re-appended.
    this.pendingReplayPersistence = [];
    if (this.persistence?.clear) {
      try {
        await this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR, () => this.persistence!.clear!());
      } catch (error) {
        this.onPersistenceError(error);
        throw error;
      }
    }
  }

  /** Clear replay history for one exact topic, including durable storage. */
  async clearTopic(topic: string): Promise<void> {
    if (!this.buffers) return;
    this.buffers.delete(topic);
    this.pendingReplayPersistence = this.pendingReplayPersistence.filter(message => message.topic !== topic);
    if (this.persistence?.clearTopic) {
      try {
        await this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR_TOPIC, () => this.persistence!.clearTopic!(topic));
      } catch (error) {
        this.onPersistenceError(error);
        throw error;
      }
    }
  }

  /** Remove replay entries older than an epoch-millisecond cutoff. */
  async clearBefore(timestamp: number): Promise<void> {
    if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be finite.');
    if (this.buffers) {
      for (const [topic, messages] of this.buffers) {
        const kept = messages.filter(message => message.timestamp === undefined || message.timestamp >= timestamp);
        if (kept.length) this.buffers.set(topic, kept);
        else this.buffers.delete(topic);
      }
    }
    // A queued batch flush must not resurrect pruned entries.
    this.pendingReplayPersistence = this.pendingReplayPersistence.filter(
      message => message.timestamp === undefined || message.timestamp >= timestamp
    );
    if (this.persistence?.clearBefore) {
      try {
        await this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR_BEFORE, () => this.persistence!.clearBefore!(timestamp));
      } catch (error) {
        this.onPersistenceError(error);
        throw error;
      }
    }
  }

  /** Start the periodic retention sweep. No-op when no durable retention
   * config makes it necessary. */
  start(): void {
    if (this.retentionTimer || !this.retentionMs || !this.retentionSweepMs || !this.persistence?.clearBefore) return;
    this.retentionTimer = setInterval(() => {
      this.scheduleRetentionCleanup(this.now() - this.retentionMs!);
    }, this.retentionSweepMs);
  }

  /** Stop the periodic retention sweep. */
  stop(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }

  /** Suspend the manager: cancel in-flight persistence retries (so a hidden tab
   * or stopped bus does not keep hammering the store) and stop the sweep. */
  suspend(): void {
    this.retryGeneration += 1;
    this.stop();
  }

  /** Drop all in-memory buffers (used on full teardown). */
  resetBuffers(): void {
    this.buffers?.clear();
  }

  /** Buffer occupancy for diagnostics. */
  getStats(): { enabled: boolean; topics: number; messages: number } {
    let messages = 0;
    if (this.buffers) for (const buffer of this.buffers.values()) messages += buffer.length;
    return { enabled: this.enabled, topics: this.buffers?.size ?? 0, messages };
  }

  /** Deliver history from one topic's ring to a handler, isolating a throwing
   * handler so the remaining buffers are still delivered. */
  private deliver(topic: string, limit: number, handler: DataBusMessageHandler<TData>): void {
    if (!this.buffers || limit <= 0) return;
    const deliverBuffer = (buffer: DataBusMessage<TData>[]) => {
      for (const message of buffer.slice(-limit)) {
        try {
          handler({ ...message, replayed: true });
        } catch (error) {
          this.onDispatchError(error);
        }
      }
    };
    if (isWildcardTopic(topic)) {
      for (const [bufferedTopic, buffer] of this.buffers) {
        if (topicMatchesPattern(topic, bufferedTopic)) deliverBuffer(buffer);
      }
      return;
    }
    const buffer = this.buffers.get(topic);
    if (buffer) deliverBuffer(buffer);
  }

  /** Coalesce queued persistence appends into a single microtask batch so a
   * burst of publications does not issue one IndexedDB transaction each. */
  private schedulePersistenceFlush(): void {
    if (this.persistenceFlushScheduled) return;
    this.persistenceFlushScheduled = true;
    queueMicrotask(() => {
      this.persistenceFlushScheduled = false;
      const batch = this.pendingReplayPersistence.splice(0);
      if (batch.length === 0 || !this.persistence) return;
      const operation = this.persistence.appendBatch
        ? () => this.persistence!.appendBatch!(batch)
        : () => Promise.all(batch.map(message => this.persistence!.append(message))).then(() => undefined);
      void this.withPersistenceRetry(PERSISTENCE_OPERATION.APPEND, operation).catch(error => this.onPersistenceError(error));
    });
  }

  /** Load durable history into the in-memory rings once at startup, pruning
   * entries past the retention window first. Failures are reported but do not
   * block startup — the bus runs with whatever survived. */
  private async hydrate(): Promise<void> {
    if (!this.buffers || !this.persistence) {
      return;
    }
    try {
      if (this.retentionMs !== undefined && this.persistence.clearBefore) {
        await this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR_BEFORE, () => this.persistence!.clearBefore!(this.now() - this.retentionMs!));
      }
      for (const message of await this.withPersistenceRetry(PERSISTENCE_OPERATION.LOAD, () => this.persistence!.load())) {
        let buffer = this.buffers.get(message.topic);
        if (!buffer) {
          buffer = [];
          this.buffers.set(message.topic, buffer);
        }
        buffer.push(message);
        if (buffer.length > this.maxPerTopic) buffer.shift();
      }
    } catch (error) {
      this.onPersistenceError(error);
    }
  }

  /** Coalesce retention cleanup: the newest cutoff wins while one pass runs,
   * so a burst of publications issues at most one clearBefore transaction. */
  private scheduleRetentionCleanup(cutoff: number): void {
    if (!this.persistence?.clearBefore) return;
    if (this.retentionCutoff === null || cutoff > this.retentionCutoff) {
      this.retentionCutoff = cutoff;
    }
    if (this.retentionCleanup) return;
    this.retentionCleanup = (async () => {
      while (this.retentionCutoff !== null) {
        const nextCutoff = this.retentionCutoff;
        this.retentionCutoff = null;
        try {
          await this.persistence!.clearBefore!(nextCutoff);
        } catch (error) {
          this.onPersistenceError(error);
        }
      }
    })().finally(() => {
      this.retentionCleanup = null;
      if (this.retentionCutoff !== null) {
        this.scheduleRetentionCleanup(this.retentionCutoff);
      }
    });
  }

  /** Run a persistence operation with exponential backoff on transient failure.
   * Bumped `retryGeneration` (suspend/stop) cancels the loop early; a
   * structurally failing operation throws after `persistenceRetryMaxAttempts`,
   * leaving the ring buffer intact so the bus keeps working. */
  private async withPersistenceRetry<T>(
    persistenceOperation: (typeof PERSISTENCE_OPERATION)[keyof typeof PERSISTENCE_OPERATION],
    operation: () => Promise<T>
  ): Promise<T> {
    const generation = this.retryGeneration;
    let attempt = 0;
    let delay = this.persistenceRetryBackoffMs;
    while (true) {
      attempt += 1;
      try {
        if (generation !== this.retryGeneration) throw new PersistenceRetryCancelledError();
        return await operation();
      } catch (error) {
        if (error instanceof PersistenceRetryCancelledError || generation !== this.retryGeneration) {
          throw new PersistenceRetryCancelledError();
        }
        if (attempt >= this.persistenceRetryMaxAttempts) throw error;
        this.trace.event({
          type: TRACE_EVENT_TYPE.RELIABILITY,
          operation: RELIABILITY_OPERATION.PERSISTENCE_RETRY,
          persistenceOperation,
          attempt,
        });
        if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
        if (generation !== this.retryGeneration) throw new PersistenceRetryCancelledError();
        delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
      }
    }
  }
}
