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
 * `PersistenceRetryCancelledError` is thrown when a lifecycle transition that
 * bumps `retryGeneration` supersedes the in-flight operation — in this class
 * that is `suspend()` alone, see the field's own note — and is swallowed by the
 * DataBus's persistence error sink so teardown never surfaces noise.
 */
import { isWildcardTopic, topicMatchesPattern } from './routing';
import { pruneReplayHistory } from './replay-pruning';
import type { DataBusReplayPersistence } from './replay-persistence';
import type { DataBusTraceReporter } from './trace';
import type { DataBusMessage, DataBusMessageHandler } from './types';
import { approximatePayloadBytes } from './routing';
import { PERSISTENCE_OPERATION, RELIABILITY_OPERATION, TRACE_EVENT_TYPE } from '../utils/constants';
import type { PRUNE_STRATEGY } from '../utils/constants';

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
  /** Per-topic count cap. AGE bounds timestamped entries by retention and
   * still applies this cap to timestamp-less legacy entries. */
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
  /** Bumped by exactly one statement, in `suspend()` below — which is where the
   * `generation !== this.retryGeneration` tests throughout this file look for a
   * cancellation. This class's own `stop()` does not touch the field. */
  private retryGeneration = 0;
  private pendingReplayPersistence: DataBusMessage<TData>[] = [];
  private persistenceFlushScheduled = false;
  /** Current hydration operation, if one belongs to the active lifecycle. */
  private hydration: Promise<void> | null = null;
  /** Invalidates a load from a superseded suspend/reset lifecycle. */
  private hydrationEpoch = 0;
  /** Whether the active lifecycle has finished (or deliberately skipped) hydration. */
  private hydrationComplete = false;
  /** A failed load is retried by the next explicit start(), not every replay request. */
  private hydrationFailed = false;
  /** Mutations that must be applied to a load already in flight. */
  private hydrationClearAll = false;
  private hydrationClearedTopics = new Set<string>();
  private hydrationClearBefore: number | null = null;
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
    void this.requestHydration();
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
    const pruned = pruneReplayHistory(buffer, {
      maxPerTopic: this.maxPerTopic,
      pruneStrategy: this.pruneStrategy,
      retentionMs: this.retentionMs,
      now: this.now()
    });
    if (pruned !== buffer) {
      buffer = pruned;
      this.buffers.set(message.topic, buffer);
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
      void this.requestHydration().then(() => {
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
    const clearing = this.persistence?.clearTopic
      ? this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR_TOPIC, () => this.persistence!.clearTopic!(topic))
      : null;
    // A load started before this unsubscribe may still resolve with the topic.
    // Record the mutation so the in-flight snapshot filters it out instead of
    // restoring history after the local subscription is gone.
    this.hydrationClearedTopics.add(topic);
    this.buffers.delete(topic);
    // A batched persistence flush may still be queued behind this task; drop
    // the topic's pending entries so clearTopic is not undone by the append.
    this.pendingReplayPersistence = this.pendingReplayPersistence.filter(message => message.topic !== topic);
    if (clearing) void clearing.catch(error => this.onPersistenceError(error));
  }

  /** Clear all in-memory replay buffers and, when supported, durable history.
   * Reports persistence failures and rethrows, mirroring the public API
   * contract that callers can observe a failed clear. */
  async clearAll(): Promise<void> {
    if (!this.buffers) return;
    const clearing = this.persistence?.clear
      ? this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR, () => this.persistence!.clear!())
      : null;
    this.hydrationClearAll = true;
    this.buffers.clear();
    // Cancel any queued batch flush so cleared history is not re-appended.
    this.pendingReplayPersistence = [];
    if (clearing) {
      try {
        await clearing;
      } catch (error) {
        this.onPersistenceError(error);
        throw error;
      }
    }
  }

  /** Clear replay history for one exact topic, and for its durable history when
   * the injected adapter provides the optional `clearTopic`. */
  async clearTopic(topic: string): Promise<void> {
    if (!this.buffers) return;
    const clearing = this.persistence?.clearTopic
      ? this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR_TOPIC, () => this.persistence!.clearTopic!(topic))
      : null;
    this.hydrationClearedTopics.add(topic);
    this.buffers.delete(topic);
    this.pendingReplayPersistence = this.pendingReplayPersistence.filter(message => message.topic !== topic);
    if (clearing) {
      try {
        await clearing;
      } catch (error) {
        this.onPersistenceError(error);
        throw error;
      }
    }
  }

  /** Remove replay entries older than an epoch-millisecond cutoff. */
  async clearBefore(timestamp: number): Promise<void> {
    if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be finite.');
    const clearing = this.persistence?.clearBefore
      ? this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR_BEFORE, () => this.persistence!.clearBefore!(timestamp))
      : null;
    if (this.buffers) {
      this.hydrationClearBefore = this.hydrationClearBefore === null
        ? timestamp
        : Math.max(this.hydrationClearBefore, timestamp);
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
    if (clearing) {
      try {
        await clearing;
      } catch (error) {
        this.onPersistenceError(error);
        throw error;
      }
    }
  }

  /** Start the periodic retention sweep. No-op when no durable retention
   * config makes it necessary. */
  start(): void {
    if (this.hydrationFailed) {
      this.hydrationComplete = false;
      this.hydrationFailed = false;
    }
    void this.requestHydration();
    if (this.retentionTimer || !this.retentionMs || !this.retentionSweepMs || !this.persistence?.clearBefore) return;
    this.retentionTimer = setInterval(() => {
      this.scheduleRetentionCleanup(this.now() - this.retentionMs!);
    }, this.retentionSweepMs);
  }

  /** Stop the periodic retention sweep. Its only caller in `src/` is `suspend()`,
   * which chains it at its end — the class is internal (`ReplayManager` appears
   * nowhere in the barrel), so no consumer reaches this method directly. It
   * cancels no in-flight work: that is the `retryGeneration` bump in `suspend()`. */
  stop(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }

  /** Cancel in-flight persistence retries by superseding their generation, so a
   * hidden tab or a stopped bus does not keep hammering the store. This is the
   * field's only writer; the bus reaches it from its two `replayManager.suspend()`
   * call sites (the cluster's `onSuspend` handler, and `beginStop()`), and this
   * class's own `stop()` only clears the sweep timer. */
  suspend(): void {
    this.retryGeneration += 1;
    // Detach an in-flight hydration so a re-entrant start() can begin a fresh
    // load instead of observing the cancelled operation. Completed hydration
    // remains valid: suspend() does not clear the rings it already populated.
    if (this.hydration) {
      this.hydrationEpoch += 1;
      this.hydration = null;
      this.hydrationComplete = false;
    }
    this.pendingReplayPersistence = [];
    // A flush that has not reached persistence yet belongs to the session being
    // suspended. Dropping it prevents the queued microtask from starting under
    // the next lifecycle generation and resurrecting stopped-session history.
    // A cutoff queued behind an in-flight cleanup belongs to the session that
    // is being suspended. The pass at the bottom of this file already stops on
    // its own — its loop condition reads `generation === this.retryGeneration`,
    // and `suspend()` bumped that a few lines above — so this drop is for the `finally` handoff,
    // which would otherwise hand the dead session's cutoff to a *fresh* cleanup
    // pass armed under the new generation.
    this.retentionCutoff = null;
    this.stop();
  }

  /** Drop all in-memory buffers and require hydration for the next lifecycle. */
  resetBuffers(): void {
    this.buffers?.clear();
    this.hydrationEpoch += 1;
    this.hydration = null;
    this.hydrationComplete = false;
    this.hydrationFailed = false;
    this.hydrationClearAll = false;
    this.hydrationClearedTopics.clear();
    this.hydrationClearBefore = null;
  }

  /** Buffer occupancy for diagnostics. `bytes` is an approximate in-memory
   * payload footprint (same heuristic as adaptive load weighting), computed on
   * demand so the hot append path never pays for it. */
  getStats(): { enabled: boolean; topics: number; messages: number; bytes: number } {
    let messages = 0;
    let bytes = 0;
    if (this.buffers) {
      for (const buffer of this.buffers.values()) {
        messages += buffer.length;
        for (const message of buffer) bytes += approximatePayloadBytes(message.data);
      }
    }
    return { enabled: this.enabled, topics: this.buffers?.size ?? 0, messages, bytes };
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
   * burst of publications does not issue one IndexedDB transaction each.
   * Only reachable when the backend advertises `appendBatch` (the sole queuer,
   * `record()`, guards on it), so the batched path is unconditional here. */
  private schedulePersistenceFlush(): void {
    if (this.persistenceFlushScheduled) return;
    this.persistenceFlushScheduled = true;
    queueMicrotask(() => {
      this.persistenceFlushScheduled = false;
      const batch = this.pendingReplayPersistence.splice(0);
      if (batch.length === 0 || !this.persistence) return;
      void this.withPersistenceRetry(PERSISTENCE_OPERATION.APPEND, () => this.persistence!.appendBatch!(batch))
        .catch(error => this.onPersistenceError(error));
    });
  }

  /** Start the active lifecycle's one-shot hydration, if it has not completed
   * or deliberately skipped hydration already. */
  private requestHydration(): Promise<void> {
    if (!this.buffers || !this.persistence) {
      this.hydrationComplete = true;
      return Promise.resolve();
    }
    if (this.hydration) return this.hydration;
    if (this.hydrationComplete) return Promise.resolve();

    const epoch = this.hydrationEpoch;
    const generation = this.retryGeneration;
    const operation = this.hydrate(epoch, generation);
    this.hydration = operation;
    return operation;
  }

  /** Load durable history into the in-memory rings once per lifecycle, pruning
   * entries past the retention window first. Failures are reported but do not
   * block startup — the bus runs with whatever survived. */
  private async hydrate(epoch: number, generation: number): Promise<void> {
    // Uncovered, and dominated: the only caller is `requestHydration()`, which
    // tests the same pair immediately before invoking this, and `hydrate` is
    // private. The checks stay because the body reads both through `!`
    // assertions, so the guard is what makes them sound for a future caller.
    if (!this.buffers || !this.persistence) {
      return;
    }
    try {
      try {
        if (this.retentionMs !== undefined && this.persistence.clearBefore) {
          await this.withPersistenceRetry(PERSISTENCE_OPERATION.CLEAR_BEFORE, () => this.persistence!.clearBefore!(this.now() - this.retentionMs!));
        }
        const loaded = await this.withPersistenceRetry(PERSISTENCE_OPERATION.LOAD, () => this.persistence!.load());
        // Uncovered. `withPersistenceRetry` re-checks this same generation after
        // the operation resolves and converts any failure into this same error, so
        // the only window left is a bump landing in the microtask gap between that
        // check and this line. `suspend()` is the sole bump site and it also bumps
        // the epoch, so the next line would catch it — the difference is a
        // reported cancellation vs. a silent drop, which is why this stays.
        if (generation !== this.retryGeneration) throw new PersistenceRetryCancelledError();
        if (epoch !== this.hydrationEpoch) return;
        const loadedByTopic = new Map<string, DataBusMessage<TData>[]>();
        for (const message of loaded) {
          if (
            this.hydrationClearAll ||
            this.hydrationClearedTopics.has(message.topic) ||
            (this.hydrationClearBefore !== null &&
              message.timestamp !== undefined &&
              message.timestamp < this.hydrationClearBefore)
          ) continue;
          let buffer = loadedByTopic.get(message.topic);
          if (!buffer) {
            buffer = [];
            loadedByTopic.set(message.topic, buffer);
          }
          buffer.push(message);
        }
        // Publications may be recorded locally while load() is in flight, before
        // the asynchronous backend can expose them through this snapshot. Put
        // durable history ahead of that live tail so count pruning retains the
        // newest messages instead of evicting them as if they were older.
        for (const [topic, durableBuffer] of loadedByTopic) {
          const liveBuffer = this.buffers.get(topic);
          this.buffers.set(topic, liveBuffer ? [...durableBuffer, ...liveBuffer] : durableBuffer);
        }
        const hydrationNow = this.now();
        for (const [topic, buffer] of this.buffers) {
          const pruned = pruneReplayHistory(buffer, {
            maxPerTopic: this.maxPerTopic,
            pruneStrategy: this.pruneStrategy,
            retentionMs: this.retentionMs,
            now: hydrationNow
          });
          if (pruned !== buffer) this.buffers.set(topic, pruned);
        }
        this.hydrationComplete = true;
        this.hydrationFailed = false;
      } catch (error) {
        if (generation !== this.retryGeneration) {
          // The `: new PersistenceRetryCancelledError()` arm reads 0, and it is
          // *not* dominated in the sense this ledger uses for that word.
          // `withPersistenceRetry` does convert a failure it catches after a
          // generation bump — both `generation !== retryGeneration` tests in that
          // loop throw the cancelled error — but its
          // `attempt >= persistenceRetryMaxAttempts` rethrow throws the raw error, and
          // it sits *after* those tests, so it can only fire while the captured
          // generation still matches.
          // so an already-queued continuation that calls `suspend()` or
          // `resetBuffers()` before this rejection resumes enters the branch with
          // a non-cancelled error. No such interleaving has been built — the gap
          // is a microtask hop, and the paths that close it are React-unmount-
          // shaped — which is why the arm has never executed rather than why it
          // cannot. The wrap stays because this branch's contract is "report a
          // cancellation", not "report whatever the backend happened to throw".
          this.onPersistenceError(
            error instanceof PersistenceRetryCancelledError ? error : new PersistenceRetryCancelledError()
          );
          return;
        }
        // A lifecycle transition superseded this load. `hydrationEpoch` has exactly
        // two writers — `suspend()` (and only while a hydration is in flight) and
        // `resetBuffers()` (from the bus's `beginStop`) — and the replacement session
        // owns the observable error. Do not report this one as a second, stale
        // hydration failure, and do not let it set the completion state the
        // replacement owns — that latch is what would suppress the newer load. Clear
        // and unsubscribe paths are *not* in this set: they set the filter flags
        // (`hydrationClearAll`, `hydrationClearedTopics`, `hydrationClearBefore`) and
        // each reports its own failure inside its own `catch`, never the epoch. Pinned
        // by tests/replay-manager.test.ts's 'does not let a superseded hydration
        // failure speak for the replacement session', which drives it through
        // `resetBuffers()`.
        if (epoch !== this.hydrationEpoch) return;
        this.onPersistenceError(error);
        this.hydrationComplete = true;
        this.hydrationFailed = true;
      }
    } finally {
      // Only the operation that still owns the current lifecycle slot may clear
      // it; an invalidated load must not clobber a replacement hydration.
      if (this.hydrationEpoch === epoch && this.retryGeneration === generation) {
        this.hydration = null;
      }
    }
  }

  /** Coalesce retention cleanup: the newest cutoff wins while one pass runs,
   * so a burst of publications issues at most one clearBefore transaction. */
  private scheduleRetentionCleanup(cutoff: number): void {
    // Uncovered, and dominated by both callers: `record()` checks
    // `this.persistence.clearBefore` before calling, and `start()` checks it
    // (plus `persistence`) before arming the sweep that is the third caller.
    // It stays because the loop below reads both through `!` assertions, so this
    // is the statement that they hold for the whole pass.
    if (!this.persistence?.clearBefore) return;
    if (this.retentionCutoff === null || cutoff > this.retentionCutoff) {
      this.retentionCutoff = cutoff;
    }
    if (this.retentionCleanup) return;
    const generation = this.retryGeneration;
    this.retentionCleanup = (async () => {
      while (this.retentionCutoff !== null && generation === this.retryGeneration) {
        const nextCutoff = this.retentionCutoff;
        this.retentionCutoff = null;
        try {
          await this.persistence!.clearBefore!(nextCutoff);
        } catch (error) {
          if (generation === this.retryGeneration) this.onPersistenceError(error);
        }
      }
    })().finally(() => {
      this.retentionCleanup = null;
      // A cutoff can be queued by a newer generation while this pass is still
      // unwinding after suspend(). The old pass cannot run it, but it still
      // owns the single in-flight slot, so hand that cutoff to a fresh cleanup
      // instead of dropping it until some unrelated future publication.
      if (this.retentionCutoff !== null) {
        this.scheduleRetentionCleanup(this.retentionCutoff);
      }
    });
  }

  /** Run a persistence operation with exponential backoff on transient failure.
   * The `suspend()` bump of `retryGeneration` cancels the loop early; a
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
        // Uncovered, and dominated on every pass: the first iteration captures
        // `generation` two statements above with no await between, and a later
        // iteration is only reached through the identical check at the end of the
        // catch, which has no await between it and this line. It is the loop's
        // "never issue an operation for a dead lifecycle" statement, so it stays
        // where a future await at the top of the body would make it real.
        if (generation !== this.retryGeneration) throw new PersistenceRetryCancelledError();
        const result = await operation();
        // A lifecycle transition may complete while an async backend operation
        // is in flight. Do not let its successful result mutate application
        // state after `suspend()` has already cleared it.
        if (generation !== this.retryGeneration) throw new PersistenceRetryCancelledError();
        return result;
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
