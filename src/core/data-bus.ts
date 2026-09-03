/**
 * CrossTabDataBus — the primary public API for cross-tab data distribution.
 *
 * Wraps WorkerClusterRuntime for cluster coordination and a DataBusTransport
 * for the real connection. Handles local handler reference counting, subscription
 * queuing, message dispatch, and clean lifecycle management (start/stop/BFCache).
 */
import { WorkerClusterRuntime } from './cluster';
import type { WorkerClusterOptions } from './cluster';
import { isWildcardTopic, topicMatchesPattern } from './routing';
import type {
  DataBusErrorHandler,
  DataBusMessage,
  DataBusMessageHandler,
  DataBusPublishOptions,
  DataBusStatusHandler,
  DataBusTransport,
  WorkerStatus
} from './types';
import { DataBusTraceReporter } from './trace';
import type { DataBusTraceOptions } from './trace';
import type { DataBusReplayPersistence } from './replay-persistence';

/**
 * Event type used to broadcast topic publications across tabs via the cluster.
 * The cluster's `onEvent` handler filters on this to distinguish databus
 * publications from other control-plane events.
 */
/** Event type used to broadcast topic publications across tabs via the cluster.
 * The cluster's `onEvent` handler filters on this to distinguish databus
 * publications from other control-plane events. */
const PUBLICATION_EVENT = 'DATABUS_PUBLICATION';
/** Default ring size per topic when replay is enabled without a limit. */
const DEFAULT_REPLAY_MAX_PER_TOPIC = 100;
class PersistenceRetryCancelledError extends Error {
  constructor() {
    super('Persistence retry cancelled by lifecycle transition.');
    this.name = 'PersistenceRetryCancelledError';
  }
}

/** Constructor options for {@link CrossTabDataBus}. Extends WorkerClusterOptions
 * (cluster coordination config) with the transport, initial connection config,
 * and trace options. */
/** Replay (bounded local history) configuration. When present, the DataBus
 * keeps a bounded ring buffer of the most recent dispatched publications per
 * topic, and `subscribe()` can deliver that history to late-joining handlers.
 * Buffers live in memory by default; an optional persistence backend can make
 * them durable. */
export interface DataBusReplayOptions<TData = unknown> {
  /** Maximum buffered publications per topic. Oldest entries are evicted
   * first. Default 100. */
  maxPerTopic?: number;
  /** Optional durable history backend. Defaults to in-memory only. */
  persistence?: DataBusReplayPersistence<TData>;
  /** Optional producer-timestamp retention window in milliseconds. */
  retentionMs?: number;
  /** Optional periodic sweep interval for durable retention cleanup. */
  retentionSweepMs?: number;
  /** Optional bounded retry policy for transient persistence failures. */
  persistenceRetry?: DataBusPersistenceRetryOptions;
}

export interface DataBusPersistenceRetryOptions {
  /** Total attempts including the initial operation. Default 1. */
  maxAttempts?: number;
  /** Initial delay between attempts. Default 50ms. */
  backoffMs?: number;
}

/** Opt-in bounded duplicate suppression for publications carrying `messageId`. */
export interface DataBusDedupOptions {
  maxEntries?: number;
  ttlMs?: number;
  /** Optional periodic sweep interval for quiet-topic expiry. */
  sweepMs?: number;
  /** Injectable epoch clock for deterministic tests and non-wall-clock hosts. */
  now?: () => number;
}

export interface DataBusDedupStats {
  enabled: boolean;
  tracked: number;
  suppressed: number;
  accepted: number;
}

export interface CrossTabDataBusOptions<TConfig, TData>
  extends Omit<WorkerClusterOptions, 'handlers'> {
  transport: DataBusTransport<TConfig, TData>;
  initialConfig?: TConfig;
  autoStart?: boolean;
  trace?: DataBusTraceOptions;
  /** Opt-in bounded per-topic history. Absent → no buffering, zero overhead. */
  replay?: DataBusReplayOptions<TData>;
  /** Optional duplicate suppression; absent means every publication is delivered. */
  dedup?: DataBusDedupOptions;
  /** Automatic transport recovery pacing. */
  recovery?: { cooldownMs?: number };
}

/**
 * High-level cross-tab pub/sub client.
 *
 * Orchestrates a transport (e.g. Centrifuge WebSocket inside a Worker) and a
 * WorkerClusterRuntime for cross-tab coordination. Messages arriving from the
 * transport are fanned out to all tabs in the cluster and dispatched locally
 * to registered handlers.
 */
export class CrossTabDataBus<TConfig = unknown, TData = unknown> {
  private readonly transport: DataBusTransport<TConfig, TData>;
  private readonly cluster: WorkerClusterRuntime;
  // Map of topic → set of local subscribers.
  private readonly topicHandlers = new Map<string, Set<DataBusMessageHandler<TData>>>();
  // Topics for which the transport has been asked to subscribe (used to avoid
  // duplicate subscribe calls during reconnection).
  private readonly transportSubscribedTopics = new Set<string>();
  private readonly statusHandlers = new Set<DataBusStatusHandler>();
  private readonly errorHandlers = new Set<DataBusErrorHandler>();
  // Bounded per-topic ring of recent dispatched publications. Null unless
  // replay is enabled — buffering is opt-in and must cost nothing otherwise.
  private readonly replayBuffers: Map<string, DataBusMessage<TData>[]> | null;
  private readonly replayMaxPerTopic: number;
  private readonly replayPersistence: DataBusReplayPersistence<TData> | null;
  private readonly replayRetentionMs: number | undefined;
  private readonly replayRetentionSweepMs: number | undefined;
  private readonly persistenceRetryMaxAttempts: number;
  private readonly persistenceRetryBackoffMs: number;
  private persistenceRetryGeneration = 0;
  private readonly replayHydration: Promise<void>;
  // Retention cleanup is coalesced so a burst of publications does not issue
  // one IndexedDB read/write transaction per message. The newest cutoff wins.
  private replayRetentionCleanup: Promise<void> | null = null;
  private replayRetentionCutoff: number | null = null;
  private replayRetentionTimer: ReturnType<typeof setInterval> | null = null;
  private readonly initialConfig: TConfig | undefined;
  private readonly hasInitialConfig: boolean;
  private readonly trace: DataBusTraceReporter;
  private readonly dedupMaxEntries: number;
  private readonly dedupTtlMs: number;
  private readonly dedupSweepMs: number | undefined;
  private dedupSweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly dedupEnabled: boolean;
  private readonly now: () => number;
  private readonly seenMessageIds = new Map<string, number>();
  private dedupSuppressed = 0;
  private dedupAccepted = 0;
  private activeConfig: TConfig | undefined;
  private status: WorkerStatus = 'disconnected';
  private started = false;
  private stopping = false;
  private transportReady = false;
  // Last transport failure, retained so ready() can surface it to callers who
  // never awaited start() directly. Cleared on the next successful start.
  private lastError: unknown = null;
  // Gate that serialises start/stop/suspend/resume — only one lifecycle
  // transition at a time. Resets to null once the operation settles.
  private startPromise: Promise<void> | null = null;
  // Timestamp of the last automatic transport recovery attempt.
  // Used to avoid a tight retry loop when the transport fails repeatedly.
  private lastRecoveryAt = 0;
  // Monotonic attempt number within one runtime recovery sequence; reset once
  // a transport reopen succeeds so traces can correlate repeated failures.
  private recoveryAttempt = 0;
  // True while the tab is hidden so an in-flight transport start does not mark
  // the transport ready after suspendTransport() has stopped it.
  private suspended = false;
  // Single gate for async transport.stop() cleanup, shared by failed opens and
  // page-hide suspension. Kept separate from startPromise so ready() still
  // surfaces a failure while later opens and automatic recovery wait for the
  // stop to settle.
  private pendingStop: Promise<void> | null = null;
  // Minimum interval in ms between automatic recovery attempts.
  private readonly recoveryCooldownMs: number;

  constructor(options: CrossTabDataBusOptions<TConfig, TData>) {
    const replay = options.replay;
    if (replay) {
      const maxPerTopic = replay.maxPerTopic ?? DEFAULT_REPLAY_MAX_PER_TOPIC;
      if (!Number.isSafeInteger(maxPerTopic) || maxPerTopic <= 0) {
        throw new TypeError(
          `replay.maxPerTopic must be a positive safe integer, got ${String(maxPerTopic)}.`
        );
      }
    }
    this.replayMaxPerTopic = replay?.maxPerTopic ?? DEFAULT_REPLAY_MAX_PER_TOPIC;
    this.replayBuffers = replay ? new Map() : null;
    this.replayPersistence = (replay?.persistence as DataBusReplayPersistence<TData> | undefined) ?? null;
    this.replayRetentionMs = replay?.retentionMs;
    if (this.replayRetentionMs !== undefined && (!Number.isFinite(this.replayRetentionMs) || this.replayRetentionMs <= 0)) {
      throw new TypeError('replay.retentionMs must be a positive finite number.');
    }
    this.replayRetentionSweepMs = replay?.retentionSweepMs;
    if (this.replayRetentionSweepMs !== undefined && (!Number.isFinite(this.replayRetentionSweepMs) || this.replayRetentionSweepMs <= 0)) {
      throw new TypeError('replay.retentionSweepMs must be a positive finite number.');
    }
    this.persistenceRetryMaxAttempts = replay?.persistenceRetry?.maxAttempts ?? 1;
    this.persistenceRetryBackoffMs = replay?.persistenceRetry?.backoffMs ?? 50;
    if (!Number.isSafeInteger(this.persistenceRetryMaxAttempts) || this.persistenceRetryMaxAttempts <= 0) {
      throw new TypeError('replay.persistenceRetry.maxAttempts must be a positive safe integer.');
    }
    if (!Number.isFinite(this.persistenceRetryBackoffMs) || this.persistenceRetryBackoffMs < 0) {
      throw new TypeError('replay.persistenceRetry.backoffMs must be a non-negative finite number.');
    }
    const { autoStart, initialConfig, trace, transport, dedup, recovery, ...clusterOptions } = options;
    this.recoveryCooldownMs = recovery?.cooldownMs ?? 1000;
    if (!Number.isFinite(this.recoveryCooldownMs) || this.recoveryCooldownMs <= 0) {
      throw new TypeError('recovery.cooldownMs must be a positive finite number.');
    }
    this.now = dedup?.now ?? Date.now;
    this.replayHydration = this.hydrateReplay();
    this.transport = transport;
    this.initialConfig = initialConfig;
    this.hasInitialConfig = 'initialConfig' in options;
    this.trace = new DataBusTraceReporter(trace);
    this.dedupMaxEntries = dedup?.maxEntries ?? 1_000;
    this.dedupTtlMs = dedup?.ttlMs ?? 60_000;
    this.dedupSweepMs = dedup?.sweepMs;
    this.dedupEnabled = dedup !== undefined;
    if (!Number.isSafeInteger(this.dedupMaxEntries) || this.dedupMaxEntries <= 0) {
      throw new TypeError('dedup.maxEntries must be a positive safe integer.');
    }
    if (!Number.isFinite(this.dedupTtlMs) || this.dedupTtlMs <= 0) {
      throw new TypeError('dedup.ttlMs must be a positive finite number.');
    }
    if (this.dedupSweepMs !== undefined && (!Number.isFinite(this.dedupSweepMs) || this.dedupSweepMs <= 0)) {
      throw new TypeError('dedup.sweepMs must be a positive finite number.');
    }
    this.cluster = new WorkerClusterRuntime({
      ...clusterOptions,
      handlers: {
        // The cluster calls `onControl` when it receives a SUBSCRIBE/UNSUBSCRIBE/PUBLISH
        // control message — meaning the owning Worker has delegated the action to us.
        onControl: (action, topic, data, messageId, timestamp) => {
          switch (action) {
            case 'SUBSCRIBE':
              if (this.subscribeTransport(topic)) this.traceSubscription('subscribe', topic);
              break;
            case 'UNSUBSCRIBE':
              if (this.unsubscribeTransport(topic)) this.traceSubscription('unsubscribe', topic);
              break;
            case 'PUBLISH':
              this.runTransport(() => this.transport.publish(
                topic,
                data,
                messageId === undefined && timestamp === undefined
                  ? undefined
                  : {
                      ...(messageId === undefined ? {} : { messageId }),
                      ...(timestamp === undefined ? {} : { timestamp })
                    }
              ));
              break;
            default:
              break;
          }
        },
        // The cluster calls `onEvent` when a publication broadcast arrives from
        // another tab. Dispatch locally if we have subscribers. The payload is
        // typed `unknown` at the cluster boundary (the cluster is transport-
        // agnostic); here we narrow it to DataBusMessage — the sender is our
        // own broadcastEvent call, which always posts a DataBusMessage.
        onEvent: (eventType, payload) => {
          if (eventType !== PUBLICATION_EVENT) return;
          const message = payload as DataBusMessage<TData>;
          if (this.cluster.hasLocalSubscriber(message.topic)) this.dispatch(message);
        },
        onSuspend: () => {
          // Suppress the suspend trace event during an explicit stop() so
          // the trace log ends on 'stop' rather than 'suspend'→'stop'.
          if (!this.stopping) this.trace.event({ type: 'lifecycle', action: 'suspend' });
          this.trace.pause();
          this.persistenceRetryGeneration += 1;
          this.stopDedupSweep();
          this.stopReplayRetentionSweep();
          this.suspendTransport();
        },
        onResume: () => {
          this.trace.event({ type: 'lifecycle', action: 'resume' });
          this.trace.start();
          this.startDedupSweep();
          this.startReplayRetentionSweep();
          this.resumeTransport();
        },
        onDiagnostic: event => {
          this.trace.event({ type: 'reliability', ...event });
        }
      }
    });
    // Auto-start when initialConfig is provided, or when autoStart is explicitly true.
    if (autoStart ?? this.hasInitialConfig) this.ensureStarted();
  }

  /**
   * Start the DataBus with the given transport config.
   *
   * The first call starts the cluster and opens the transport. Concurrent calls
   * during an in-flight start return the same promise. Once the operation
   * settles (success or failure) the promise gate is cleared so a subsequent
   * start() or resumeTransport() can open a fresh lifecycle.
   */
  start(config: TConfig): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.started) return Promise.resolve();
    this.started = true;
    this.stopping = false;
    this.suspended = false;
    this.activeConfig = config;
    this.lastError = null;
    this.trace.event({ type: 'lifecycle', action: 'start' });
    this.trace.start();
    this.startDedupSweep();
    this.startReplayRetentionSweep();
    this.updateStatus('connecting');
    this.cluster.start();
    // Establish the opening before replaying topicHandlers: cluster.subscribe()
    // can synchronously invoke onControl for self-owned topics, and those
    // callbacks would otherwise see startPromise=null and open a second transport.
    const opening = this.openTransport(config, this.pendingStop ?? Promise.resolve(), true);
    this.startPromise = opening;
    // Replay subscriptions that were registered before start() or that were lost
    // during a previous failure recovery. The cluster.stop() call in the failure
    // path clears subscribedTopics, but topicHandlers retains the intent.
    // Iterating topicHandlers (not transportSubscribedTopics) because the
    // transport hasn't subscribed to anything yet on a fresh start.
    for (const topic of this.topicHandlers.keys()) {
      this.cluster.subscribe(topic);
    }
    const snapshot = this.cluster.getSnapshot();
    this.trace.event({
      type: 'coordination',
      coordinated: snapshot.coordinated,
      activeWorkers: snapshot.workers.filter(worker => worker.role === 'active').length,
      workers: snapshot.workers.map(formatWorkerTrace),
      routes: snapshot.routes.map(formatRouteTrace)
    });
    // Once startup settles (success or failure), clear the pending gate so a
    // later start()/resumeTransport() can open a fresh operation. Guard against
    // clobbering a promise that suspend/resume may have already swapped in.
    void opening.then(
      () => {
        if (this.startPromise === opening) this.startPromise = null;
      },
      () => {
        if (this.startPromise === opening) this.startPromise = null;
      }
    );
    return opening;
  }

  /**
   * Open the transport, chained after `before` to ensure lifecycle ordering.
   * When `stopClusterOnFailure` is true (initial start), a transport failure
   * tears down the cluster as well.
   */
  private openTransport(
    config: TConfig,
    before: Promise<unknown>,
    stopClusterOnFailure: boolean
  ): Promise<void> {
    this.transportReady = false;
    const chainedPendingStop = this.pendingStop;
    return before
      .catch(() => undefined)
      .then(() => {
        // stop() or suspendTransport() may have arrived while this opening was
        // queued behind a pending stop. Abandon the open and keep the settled
        // stop gate visible so stop() does not issue a second transport.stop().
        if (this.stopping || this.suspended) return;
        // A stop we actually chained after has settled; this opening now owns
        // the lifecycle. A stop created concurrently (e.g. by suspendTransport)
        // is a different promise and must stay visible to later catch/resume
        // paths so cleanup is not duplicated.
        if (this.pendingStop === chainedPendingStop) this.pendingStop = null;
        return Promise.resolve(
          this.transport.start(config, {
            onMessage: message => this.handleTransportMessage(message),
            onStatus: status => this.updateStatus(status),
            onError: error => this.reportError(error)
          })
        ).then(() => {
          // A transport may report 'error' synchronously during start() (e.g. a
          // Worker that fails to boot) while still returning normally. Treat that
          // as a startup failure instead of marking the transport ready, so a
          // later subscribe/unsubscribe triggers a reopen rather than being
          // silently dropped on a dead transport.
          if (this.status === 'error') {
            throw new Error('Transport failed during startup.');
          }
          if (!this.suspended && !this.stopping) this.transportReady = true;
        });
      })
      .catch(error => {
        // Reset started before reporting so an initial-start failure does not
        // schedule automatic recovery; only the caller can retry a first start.
        if (stopClusterOnFailure) this.started = false;
        // Keep the stop cleanup in a single gate so a subsequent
        // start()/reopenTransport() cannot overlap an asynchronous
        // transport.stop(). If suspendTransport() already chained a stop for
        // the tab hiding mid-open, reuse it instead of stopping twice.
        if (!this.pendingStop) {
          this.pendingStop = this.createStopPromise();
        }
        this.updateStatus('error');
        this.reportError(error);
        this.lastError = error;
        this.transportReady = false;
        if (stopClusterOnFailure) {
          this.stopping = true;
          this.cluster.stop();
          this.stopping = false;
        }
        this.startPromise = null;
        throw error;
      });
  }

  /**
   * Await the DataBus to be fully started (lazy init when using initialConfig).
   * Returns a rejected promise when the transport has failed and no start is in
   * flight — the caller can retry by calling start() or ready() again.
   */
  ready(): Promise<void> {
    try {
      this.ensureStarted();
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.startPromise) return this.startPromise;
    if (this.transportReady) return Promise.resolve();
    // Surface the last failure so callers can distinguish a transient retry
    // from a dead transport. The promise is rejected, not thrown, so the
    // caller can retry by calling ready() or start() again.
    if (this.lastError !== null) return Promise.reject(this.lastError);
    return Promise.reject(
      new Error('Transport is not ready and no start operation is in flight')
    );
  }

  /**
   * Register a handler for `topic`. The handler fires on every publication
   * delivered to this tab, regardless of which tab published it. Returns an
   * unsubscribe function for convenience.
   */
  subscribe(
    topic: string,
    handler: DataBusMessageHandler<TData>,
    options?: { replay?: boolean | number }
  ): () => void {
    this.ensureStarted();
    const handlers = this.topicHandlers.get(topic) ?? new Set<DataBusMessageHandler<TData>>();
    const wasUnused = handlers.size === 0;
    handlers.add(handler);
    this.topicHandlers.set(topic, handlers);
    // This 0→1 transition is the SINGLE entry point into the cluster
    // subscription. The cluster's subscribedTopics is a Set, so repeated
    // installs of the same topic after a drop cannot double-subscribe:
    // wasUnused is the only gate, and cluster.subscribe() is idempotent by
    // construction. The matching n→0 gate is in the unsubscribe path below.
    if (wasUnused) this.cluster.subscribe(topic);
    if (options?.replay) {
      const limit = Math.min(
        typeof options.replay === 'number' ? Math.floor(options.replay) : this.replayMaxPerTopic,
        this.replayMaxPerTopic
      );
      if (this.replayPersistence) {
        void this.replayHydration.then(() => {
          if (this.topicHandlers.get(topic)?.has(handler)) this.deliverReplay(topic, limit, handler);
        });
      } else {
        this.deliverReplay(topic, limit, handler);
      }
    }
    return () => this.unsubscribe(topic, handler);
  }

  /** Remove a specific handler, or all handlers for `topic`.
   * When `handler` is omitted, clears every handler for the topic — the
   * caller used the `unsubscribe(topic)` form expecting a full teardown.
   * The cluster is only notified on the n→0 transition (handlers.size === 0). */
  unsubscribe(topic: string, handler?: DataBusMessageHandler<TData>): void {
    const handlers = this.topicHandlers.get(topic);
    if (!handlers) return;
    if (handler) handlers.delete(handler);
    else handlers.clear();
    if (handlers.size > 0) return;
    this.topicHandlers.delete(topic);
    this.replayBuffers?.delete(topic);
    if (this.replayPersistence?.clearTopic) {
      void this.withPersistenceRetry('clearTopic', () => this.replayPersistence!.clearTopic!(topic))
        .catch(error => this.reportPersistenceError(error));
    }
    this.cluster.unsubscribe(topic);
  }

  /** Clear all in-memory replay buffers and, when supported, durable history. */
  async clearReplay(): Promise<void> {
    this.replayBuffers?.clear();
    if (this.replayPersistence?.clear) {
      try {
        await this.withPersistenceRetry('clear', () => this.replayPersistence!.clear!());
      } catch (error) {
        this.reportPersistenceError(error);
        throw error;
      }
    }
  }

  /** Clear replay history for one exact topic, including durable storage. */
  async clearReplayTopic(topic: string): Promise<void> {
    this.replayBuffers?.delete(topic);
    if (this.replayPersistence?.clearTopic) {
      try {
        await this.withPersistenceRetry('clearTopic', () => this.replayPersistence!.clearTopic!(topic));
      } catch (error) {
        this.reportPersistenceError(error);
        throw error;
      }
    }
  }

  /** Remove replay entries older than an epoch-millisecond cutoff. */
  async clearReplayBefore(timestamp: number): Promise<void> {
    if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be finite.');
    if (this.replayBuffers) {
      for (const [topic, messages] of this.replayBuffers) {
        const kept = messages.filter(message => message.timestamp === undefined || message.timestamp >= timestamp);
        if (kept.length) this.replayBuffers.set(topic, kept);
        else this.replayBuffers.delete(topic);
      }
    }
    if (this.replayPersistence?.clearBefore) {
      try {
        await this.withPersistenceRetry('clearBefore', () => this.replayPersistence!.clearBefore!(timestamp));
      } catch (error) {
        this.reportPersistenceError(error);
        throw error;
      }
    }
  }

  /** Return bounded deduplication counters for diagnostics and health checks. */
  getDedupStats(): DataBusDedupStats {
    return {
      enabled: this.dedupEnabled,
      tracked: this.seenMessageIds.size,
      suppressed: this.dedupSuppressed,
      accepted: this.dedupAccepted
    };
  }

  /** Drop all remembered IDs and reset dedup counters. */
  resetDedup(): void {
    this.seenMessageIds.clear();
    this.dedupSuppressed = 0;
    this.dedupAccepted = 0;
  }

  /** Publish a message to `topic`. The owning Worker delivers it to the transport. */
  publish(topic: string, data: unknown, options?: DataBusPublishOptions): void {
    this.ensureStarted();
    if (!this.cluster.publish(topic, data, options)) {
      this.reportError(
        new Error('Failed to send the publish control message to the owning worker.')
      );
    }
  }

  /** Register a handler that fires on every transport status change. Immediately invoked with the current status. */
  onStatus(handler: DataBusStatusHandler): () => void {
    this.statusHandlers.add(handler);
    try {
      handler(this.status);
    } catch (error) {
      this.reportError(error);
    }
    return () => this.statusHandlers.delete(handler);
  }

  /** Register a handler for transport errors. */
  onError(handler: DataBusErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /** Current transport connection status. */
  getStatus(): WorkerStatus {
    return this.status;
  }

  /** Snapshot of the cluster state (workers, routes, assignments).
   * For diagnostics only — the returned object is a shallow copy but
   * nested arrays are snapshots at call time. */
  getClusterSnapshot() {
    return this.cluster.getSnapshot();
  }

  /**
   * Gracefully stop the DataBus: unsubscribe all topics, stop the cluster,
   * and close the transport. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.stopping = true;
    this.persistenceRetryGeneration += 1;
    this.trace.event({ type: 'lifecycle', action: 'stop' });
    this.trace.stop();
    this.stopDedupSweep();
    this.stopReplayRetentionSweep();
    this.topicHandlers.clear();
    this.replayBuffers?.clear();
    this.cluster.stop();
    try {
      await this.startPromise?.catch(() => undefined);
      // A failed-open or suspend cleanup already stopped the transport;
      // awaiting it is enough, so stop() is not called a second time.
      const pendingStop = this.pendingStop;
      if (pendingStop) await pendingStop.catch(() => undefined);
      else await this.transport.stop();
    } finally {
      this.transportSubscribedTopics.clear();
      this.resetDedup();
      this.started = false;
      this.stopping = false;
      this.suspended = false;
      this.transportReady = false;
      this.startPromise = null;
      this.pendingStop = null;
      this.lastError = null;
      this.activeConfig = undefined;
      this.updateStatus('disconnected');
    }
  }

  /**
   * Incoming message from the transport.
   * Records metrics, checks ownership via the cluster, broadcasts to other tabs,
   * and dispatches locally.
   */
  private handleTransportMessage(message: DataBusMessage<TData>): void {
    if (this.isDuplicate(message)) return;
    this.trace.recordReceived(message.topic);
    // Drop messages for topics we do not own — the owning Worker fans out.
    if (!this.cluster.isAssigned(message.topic)) {
      this.trace.recordDiscarded(message.topic);
      return;
    }
    this.cluster.broadcastEvent(PUBLICATION_EVENT, message);
    if (this.cluster.hasLocalSubscriber(message.topic)) {
      this.dispatch(message);
      return;
    }
    this.trace.recordDiscarded(message.topic);
  }

  private isDuplicate(message: DataBusMessage<TData>): boolean {
    if (!this.dedupEnabled || !message.messageId) return false;
    const now = this.now();
    for (const [id, timestamp] of this.seenMessageIds) {
      if (now - timestamp > this.dedupTtlMs) this.seenMessageIds.delete(id);
    }
    if (this.seenMessageIds.has(message.messageId)) {
      this.trace.event({ type: 'reliability', operation: 'dedup_suppressed', topic: message.topic });
      this.dedupSuppressed += 1;
      this.trace.recordDedupSuppressed();
      return true;
    }
    this.seenMessageIds.set(message.messageId, now);
    this.dedupAccepted += 1;
    this.trace.recordDedupAccepted();
    while (this.seenMessageIds.size > this.dedupMaxEntries) {
      const oldest = this.seenMessageIds.keys().next().value;
      if (oldest === undefined) break;
      this.seenMessageIds.delete(oldest);
    }
    return false;
  }

  private startDedupSweep(): void {
    if (this.dedupSweepTimer || !this.dedupEnabled || !this.dedupSweepMs) return;
    this.dedupSweepTimer = setInterval(() => this.pruneExpiredDedup(), this.dedupSweepMs);
  }

  private stopDedupSweep(): void {
    if (this.dedupSweepTimer) clearInterval(this.dedupSweepTimer);
    this.dedupSweepTimer = null;
  }

  private pruneExpiredDedup(): void {
    const cutoff = this.now() - this.dedupTtlMs;
    for (const [id, timestamp] of this.seenMessageIds) {
      if (timestamp < cutoff) this.seenMessageIds.delete(id);
    }
  }

  /** Deliver a message to every local handler registered for its topic,
   * plus every handler registered with a wildcard subscription that matches
   * (e.g. a handler subscribed to "chat.*" receives "chat.room.1"). */
  private dispatch(message: DataBusMessage<TData>): void {
    this.trace.recordDispatched(message.topic);
    this.invokeHandlers(this.topicHandlers.get(message.topic) ?? [], handler => handler(message));
    for (const [pattern, handlers] of this.topicHandlers) {
      if (pattern !== message.topic && topicMatchesPattern(pattern, message.topic)) {
        this.invokeHandlers(handlers, handler => handler(message));
      }
    }
    this.recordReplay(message);
  }

  /** Append a dispatched publication to the topic's replay ring buffer.
   * No-op when replay is disabled. */
  private recordReplay(message: DataBusMessage<TData>): void {
    if (!this.replayBuffers) return;
    let buffer = this.replayBuffers.get(message.topic);
    if (!buffer) {
      buffer = [];
      this.replayBuffers.set(message.topic, buffer);
    }
    // Preserve the public message shape for legacy adapters. Retention pruning
    // applies to messages that carry an explicit producer timestamp.
    const storedMessage = message;
    buffer.push(storedMessage);
    if (buffer.length > this.replayMaxPerTopic) buffer.shift();
    if (this.replayPersistence) {
      void this.withPersistenceRetry('append', () => this.replayPersistence!.append(storedMessage))
        .catch(error => this.reportPersistenceError(error));
      if (this.replayRetentionMs !== undefined && this.replayPersistence.clearBefore) {
        this.scheduleReplayRetentionCleanup(this.now() - this.replayRetentionMs);
      }
    }
  }

  private async hydrateReplay(): Promise<void> {
    if (!this.replayBuffers || !this.replayPersistence) {
      return;
    }
    try {
      if (this.replayRetentionMs !== undefined && this.replayPersistence.clearBefore) {
        await this.withPersistenceRetry('clearBefore', () => this.replayPersistence!.clearBefore!(this.now() - this.replayRetentionMs!));
      }
      for (const message of await this.withPersistenceRetry('load', () => this.replayPersistence!.load())) {
        let buffer = this.replayBuffers.get(message.topic);
        if (!buffer) {
          buffer = [];
          this.replayBuffers.set(message.topic, buffer);
        }
        buffer.push(message);
        if (buffer.length > this.replayMaxPerTopic) buffer.shift();
      }
    } catch (error) {
      this.reportPersistenceError(error);
    }
  }

  private scheduleReplayRetentionCleanup(cutoff: number): void {
    if (!this.replayPersistence?.clearBefore) return;
    if (this.replayRetentionCutoff === null || cutoff > this.replayRetentionCutoff) {
      this.replayRetentionCutoff = cutoff;
    }
    if (this.replayRetentionCleanup) return;
    this.replayRetentionCleanup = (async () => {
      while (this.replayRetentionCutoff !== null) {
        const nextCutoff = this.replayRetentionCutoff;
        this.replayRetentionCutoff = null;
        try {
          await this.replayPersistence!.clearBefore!(nextCutoff);
        } catch (error) {
          this.reportPersistenceError(error);
        }
      }
    })().finally(() => {
      this.replayRetentionCleanup = null;
      if (this.replayRetentionCutoff !== null) {
        this.scheduleReplayRetentionCleanup(this.replayRetentionCutoff);
      }
    });
  }

  private startReplayRetentionSweep(): void {
    if (this.replayRetentionTimer || !this.replayRetentionMs || !this.replayRetentionSweepMs || !this.replayPersistence?.clearBefore) return;
    this.replayRetentionTimer = setInterval(() => {
      this.scheduleReplayRetentionCleanup(this.now() - this.replayRetentionMs!);
    }, this.replayRetentionSweepMs);
  }

  private stopReplayRetentionSweep(): void {
    if (this.replayRetentionTimer) clearInterval(this.replayRetentionTimer);
    this.replayRetentionTimer = null;
  }

  private async withPersistenceRetry<T>(
    persistenceOperation: 'load' | 'append' | 'clear' | 'clearTopic' | 'clearBefore',
    operation: () => Promise<T>
  ): Promise<T> {
    const generation = this.persistenceRetryGeneration;
    let attempt = 0;
    let delay = this.persistenceRetryBackoffMs;
    while (true) {
      attempt += 1;
      try {
        if (generation !== this.persistenceRetryGeneration) throw new PersistenceRetryCancelledError();
        return await operation();
      } catch (error) {
        if (error instanceof PersistenceRetryCancelledError || generation !== this.persistenceRetryGeneration) {
          throw new PersistenceRetryCancelledError();
        }
        if (attempt >= this.persistenceRetryMaxAttempts) throw error;
        this.trace.event({
          type: 'reliability',
          operation: 'persistence_retry',
          persistenceOperation,
          attempt,
        });
        if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
        if (generation !== this.persistenceRetryGeneration) throw new PersistenceRetryCancelledError();
        delay = Math.min(delay * 2, 1_600);
      }
    }
  }

  /** Deliver buffered history to a newly-registered handler. For an exact
   * topic this is that topic's ring; for a wildcard subscription every
   * buffered topic matching the pattern contributes (in buffer insertion
   * order). Replay deliveries are marked `replayed: true` and are not
   * counted into trace metrics. */
  private deliverReplay(
    topic: string,
    limit: number,
    handler: DataBusMessageHandler<TData>
  ): void {
    if (!this.replayBuffers || limit <= 0) return;
    const deliver = (buffer: DataBusMessage<TData>[]) => {
      for (const message of buffer.slice(-limit)) {
        this.invokeHandlers([handler], h => h({ ...message, replayed: true }));
      }
    };
    if (isWildcardTopic(topic)) {
      for (const [bufferedTopic, buffer] of this.replayBuffers) {
        if (topicMatchesPattern(topic, bufferedTopic)) deliver(buffer);
      }
      return;
    }
    const buffer = this.replayBuffers.get(topic);
    if (buffer) deliver(buffer);
  }

  /**
   * Propagate a status change to the cluster, trace, and all registered
   * status handlers. On reconnect, re-subscribe any topics assigned to us.
   */
  private updateStatus(status: WorkerStatus): void {
    const previousStatus = this.status;
    this.status = status;
    if (previousStatus !== status) this.trace.event({ type: 'status', status });
    this.cluster.setStatus(status);
    // Clear transport subscriptions on disconnect; the transport is gone.
    if (status === 'disconnected' || status === 'error') this.transportSubscribedTopics.clear();
    // Re-subscribe assigned topics when the transport reconnects.
    if (status === 'connected' && previousStatus !== 'connected') {
      for (const topic of this.cluster.getSnapshot().assignedTopics) this.subscribeTransport(topic);
    }
    // Auto-recover from a runtime transport failure (e.g. a crashed Worker)
    // while the bus is still meant to be started. Guarded by a cooldown to
    // avoid a tight retry loop when the transport fails immediately.
    // Uses setTimeout so the recovery does not run re-entrantly inside the
    // callback that produced this status (e.g. openTransport's catch).
    if (status === 'error' && this.started && !this.stopping) {
      const now = this.now();
      if (now - this.lastRecoveryAt >= this.recoveryCooldownMs) {
        this.lastRecoveryAt = now;
        const attempt = ++this.recoveryAttempt;
        this.trace.event({ type: 'reliability', operation: 'transport_recovery', attempt, outcome: 'scheduled' });
        setTimeout(() => {
          if (this.stopping || !this.started || this.suspended) return;
          // An explicit resume or subscribe already recovered the transport
          // (or is in flight), so this stale timer must not open it again.
          if (this.status !== 'error') return;
          void this.reopenTransport(attempt);
        }, this.recoveryCooldownMs);
      }
    }
    this.invokeHandlers(this.statusHandlers, handler => handler(status));
  }

  private reportError(error: unknown): void {
    this.trace.event({ type: 'error', source: 'transport' });
    this.invokeHandlers(this.errorHandlers, handler => handler(error), 'error handler');
  }

  private reportPersistenceError(error: unknown): void {
    if (error instanceof PersistenceRetryCancelledError) return;
    this.trace.event({ type: 'reliability', operation: 'persistence_cleanup' });
    this.reportError(error);
  }

  private traceSubscription(action: 'subscribe' | 'unsubscribe', topic: string): void {
    this.trace.event({
      type: 'subscription',
      action,
      topic,
      activeTopics: this.transportSubscribedTopics.size
    });
  }

  /** Ask the transport to subscribe to a topic (idempotent). */
  private subscribeTransport(topic: string): boolean {
    if (this.transportSubscribedTopics.has(topic)) return false;
    this.transportSubscribedTopics.add(topic);
    this.runTransport(() => this.transport.subscribe(topic));
    return true;
  }

  private unsubscribeTransport(topic: string): boolean {
    if (!this.transportSubscribedTopics.delete(topic)) return false;
    this.runTransport(() => this.transport.unsubscribe(topic));
    return true;
  }

  /** Invoke `callback` for each item in `handlers`, isolating a throwing
   * callback so the remaining ones still run. Dispatch/status handler failures
   * are routed to `reportError` (which surfaces them to error subscribers);
   * error-handler failures are logged to the console to avoid infinite
   * recursion through reportError itself. */
  private invokeHandlers<T>(
    handlers: Iterable<T>,
    callback: (handler: T) => void,
    label: 'dispatch' | 'status' | 'error handler' = 'dispatch'
  ): void {
    for (const handler of handlers) {
      try {
        callback(handler);
      } catch (error) {
        if (label === 'error handler') {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[cross-tab-worker-databus] error handler threw:', error);
          }
        } else {
          this.reportError(error);
        }
      }
    }
  }

  /**
   * Suspend the transport when the tab goes hidden. Stops the transport and
   * clears subscription state so it will be re-established on resume.
   */
  private suspendTransport(): void {
    if (this.stopping) return;
    this.suspended = true;
    this.transportReady = false;
    this.transportSubscribedTopics.clear();
    this.updateStatus('disconnected');
    // A failed open already owns a stop cleanup; reuse it so the suspend does
    // not stop an already-stopped transport. Resume/reopen chain after the
    // same pendingStop gate. Without this guard, suspendTransport would issue
    // a second transport.stop() that races with the failed-open cleanup.
    if (this.pendingStop) return;
    // Chain the stop after any in-flight start so an async open settles first.
    // startPromise and pendingStop MUST be the same promise so reopenTransport's
    // `startPromise !== pendingStop` check can distinguish a suspend-stop gate
    // from a resume opening — do not wrap one without wrapping the other.
    const pending = this.startPromise ?? Promise.resolve();
    const stopping = pending
      .catch(() => undefined)
      .then(() => this.transport.stop())
      .catch(error => this.reportError(error));
    this.startPromise = stopping;
    this.pendingStop = stopping;
  }

  /** Create an immediate stop promise (no prior chain). Used by openTransport's
   * failure path where there is no in-flight start to wait for. */
  private createStopPromise(): Promise<void> {
    return Promise.resolve()
      .then(() => this.transport.stop())
      .catch(stopError => this.reportError(stopError));
  }

  /**
   * Resume the transport when the tab becomes visible again, or recover from a
   * runtime transport failure. Re-opens the transport with the stored active
   * config, chained after any pending operation so an async transport stop
   * completes before the new start. Returns the opening promise.
   */
  private resumeTransport(): void {
    void this.reopenTransport();
  }

  /**
   * Re-open the transport with the previously stored active config. Chains
   * after any in-flight lifecycle operation (e.g. a suspend stop), swallowing
   * its rejection so the reopen is not blocked. Returns the opening promise so
   * callers can queue operations behind it.
   */
  private reopenTransport(recoveryAttempt?: number): Promise<void> {
    if (this.stopping || this.activeConfig === undefined) return Promise.resolve();
    // A resume/recovery already has an opening in flight. Reuse it so a stale
    // recovery timer or a second caller cannot open a second transport. A
    // page-hide stop gate (startPromise === pendingStop) must not be reused
    // as an opening — that would make resume return a promise that resolves
    // on stop completion, not on a ready transport. Instead, fall through and
    // chain the new open after that pending stop.
    if (this.startPromise && this.startPromise !== this.pendingStop) return this.startPromise;
    const config = this.activeConfig;
    const traceAttempt = recoveryAttempt ?? (this.recoveryAttempt > 0 ? this.recoveryAttempt : undefined);
    // A resume/recovery means the bus is meant to keep running, even after an
    // initial start failed and then recovered while hidden. Without this, a
    // later stop() would be a no-op and leave the reopened transport running.
    this.started = true;
    this.suspended = false;
    this.updateStatus('connecting');
    const pending = this.startPromise ?? this.pendingStop ?? Promise.resolve();
    const opening = pending
      .catch(() => undefined)
      .then(() => this.openTransport(config, Promise.resolve(), false));
    this.startPromise = opening;
    // Reset the gate on success too, so a later runtime failure can schedule a
    // fresh reopen instead of reusing this settled promise.
    void opening.then(
      () => {
        if (traceAttempt !== undefined) {
          this.trace.event({ type: 'reliability', operation: 'transport_recovery', attempt: traceAttempt, outcome: 'succeeded' });
          this.recoveryAttempt = 0;
        }
        if (this.startPromise === opening) this.startPromise = null;
      },
      () => {
        if (traceAttempt !== undefined) {
          this.trace.event({ type: 'reliability', operation: 'transport_recovery', attempt: traceAttempt, outcome: 'failed' });
        }
      }
    );
    void opening.catch(() => undefined);
    return opening;
  }

  /**
   * Run a transport operation now if the transport is ready, otherwise queue
   * it behind the start promise. This ensures subscribe/unsubscribe calls made
   * during startup are not lost.
   */
  private runTransport(operation: () => void | Promise<void>): void {
    // A hidden tab's transport is intentionally stopped; subscriptions are
    // re-established by the cluster on resume, and publications must not be
    // sent to a stopped transport.
    if (this.suspended) return;
    if (this.transportReady && !this.stopping) {
      try {
        void Promise.resolve(operation()).catch(error => this.reportError(error));
      } catch (error) {
        this.reportError(error);
      }
      return;
    }
    // Transport is down but we are still meant to be started — reopen so the
    // operation is not silently dropped. This covers the case where a resume
    // or recovery attempt failed, leaving transportReady=false, startPromise=null.
    let ready = this.startPromise;
    if (!ready && this.started && !this.stopping && this.activeConfig !== undefined) {
      ready = this.reopenTransport();
    }
    if (!ready || this.stopping) return;
    void ready
      .then(() => {
        if (!this.started || this.stopping || this.suspended) return;
        return operation();
      })
      .catch(error => this.reportError(error));
  }

  /**
   * Ensure the DataBus is started, throwing if no initialConfig was provided.
   * Called automatically by subscribe/publish/ready when autoStart is true.
   */
  private ensureStarted(): void {
    if (this.started) return;
    if (!this.hasInitialConfig) {
      throw new Error(
        'CrossTabDataBus requires initialConfig for automatic startup, or an explicit start(config) call.'
      );
    }
    const starting = this.start(this.initialConfig as TConfig);
    void starting.catch(() => undefined);
  }
}

/** Format a WorkerRecord for the coordination trace event. */
function formatWorkerTrace(worker: { workerId: string; status: string; load: number; tabId: string }): string {
  return `${worker.workerId}|${worker.status}|load=${worker.load}|tab=${worker.tabId}`;
}

/** Format a route for the coordination trace event. */
function formatRouteTrace(route: { topicKey: string; workerId: string; confirmedAt?: number }): string {
  return `${route.topicKey}@${route.workerId}|confirmed=${route.confirmedAt !== undefined}`;
}
