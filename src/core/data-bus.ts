/**
 * CrossTabDataBus — the primary public API for cross-tab data distribution.
 *
 * Wraps WorkerClusterRuntime for cluster coordination and a DataBusTransport
 * for the real connection. Handles local handler reference counting, subscription
 * queuing, message dispatch, and clean lifecycle management (start/stop/BFCache).
 */
import { WorkerClusterRuntime } from './cluster';
import type { WorkerClusterOptions, WorkerClusterSnapshot } from './cluster';
import { topicMatchesPattern } from './routing';
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
import { PersistenceRetryCancelledError, ReplayManager } from './replay-manager';
import { DedupManager } from './dedup-manager';
import type { DataBusDedupOptions, DataBusDedupStats } from './dedup-manager';
import { SDK_VERSION } from './version';
import {
  CONTROL_ACTION,
  DEFAULT_STORAGE_PREFIX,
  FAILURE_SOURCE,
  HEALTH_STATE,
  INVOKE_LABEL,
  PRUNE_STRATEGY,
  PUBLICATION_EVENT,
  RECOVERY_OUTCOME,
  RELIABILITY_OPERATION,
  SUBSCRIPTION_ACTION,
  TRACE_EVENT_TYPE,
  TRACE_ERROR_SOURCE,
  TRACE_LIFECYCLE_ACTION,
  WORKER_ROLE,
  WORKER_STATUS
} from '../utils/constants';
import { publicationMetadata } from '../utils/metadata';
import { assertDedupOptions, assertReplayOptions, assertRecoveryOptions } from '../utils/validation';

/** Default ring size per topic when replay is enabled without a limit. */
const DEFAULT_REPLAY_MAX_PER_TOPIC = 100;

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
  /** History trimming policy. Defaults to both when both limits are configured. */
  pruneStrategy?: (typeof PRUNE_STRATEGY)[keyof typeof PRUNE_STRATEGY];
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

export type { DataBusDedupOptions, DataBusDedupStats };

export interface DataBusDiagnostics {
  sdkVersion: string;
  status: WorkerStatus;
  started: boolean;
  transportReady: boolean;
  recovery: { attempt: number; exhausted: boolean; maxAttempts: number; hasError: boolean; errorMessage: string | null; errorAt: number | null; generation: number; lastSuccessAt: number | null };
  dedup: DataBusDedupStats;
  replay: { enabled: boolean; topics: number; messages: number };
  persistence: DataBusPersistenceHealth;
  protocol: { version: number; unknownMessages: number; lastUnknownMessageType: string | null; peers: Record<string, number | null> };
  transport: { name: string; backend: string | null; status: WorkerStatus; suspended: boolean };
  cluster: WorkerClusterSnapshot;
}

/** Where a retained failure originated, as surfaced by {@link DataBusHealthSummary}. */
export type DataBusFailureSource = (typeof FAILURE_SOURCE)[keyof typeof FAILURE_SOURCE];

export interface DataBusLastFailure {
  source: DataBusFailureSource;
  message: string;
  at: number;
}

/** Bounded failure counters for the optional replay persistence backend. */
export interface DataBusPersistenceHealth {
  /** Total persistence failures reported since the last explicit start(). */
  failures: number;
  lastFailureAt: number | null;
  lastErrorMessage: string | null;
}

/** Compact single-object health verdict for dashboards and readiness probes.
 * Unlike {@link DataBusDiagnostics} this answers one question first — is the
 * bus usable right now — then attaches the failure and recovery context that
 * explains the verdict. */
export interface DataBusHealthSummary {
  /** True only while the bus is started, not suspended, and the transport is ready. */
  healthy: boolean;
  /** Lifecycle-derived verdict: 'stopped' | 'starting' | 'healthy' | 'recovering' | 'suspended' | 'degraded'.
   * 'degraded' means automatic recovery is exhausted and the transport is still down — a manual
   * start() (or resume) is required. */
  state: (typeof HEALTH_STATE)[keyof typeof HEALTH_STATE];
  status: WorkerStatus;
  sdkVersion: string;
  started: boolean;
  suspended: boolean;
  transport: { name: string; backend: string | null; ready: boolean; status: WorkerStatus };
  recovery: ReturnType<CrossTabDataBus['getRecoveryStats']>;
  /** Most recent failure of any source since the last explicit start(). */
  lastFailure: DataBusLastFailure | null;
  persistence: DataBusPersistenceHealth;
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
  recovery?: { cooldownMs?: number; maxAttempts?: number };
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
  private readonly replayManager: ReplayManager<TData>;
  private readonly initialConfig: TConfig | undefined;
  private readonly hasInitialConfig: boolean;
  private readonly trace: DataBusTraceReporter;
  private readonly dedupManager: DedupManager;
  private readonly now: () => number;
  private activeConfig: TConfig | undefined;
  private status: WorkerStatus = WORKER_STATUS.DISCONNECTED;
  private started = false;
  private stopping = false;
  private transportReady = false;
  // Last transport failure, retained so ready() can surface it to callers who
  // never awaited start() directly. Cleared on the next successful start.
  private lastError: unknown = null;
  private lastErrorAt: number | null = null;
  // Unified failure ledger for the health summary: the most recent failure of
  // any source (transport, persistence, dispatch) since the last explicit start.
  private lastFailure: DataBusLastFailure | null = null;
  private persistenceFailureCount = 0;
  private persistenceLastFailureAt: number | null = null;
  private persistenceLastErrorMessage: string | null = null;
  // Gate that serialises start/stop/suspend/resume — only one lifecycle
  // transition at a time. Resets to null once the operation settles.
  private startPromise: Promise<void> | null = null;
  // Timestamp of the last automatic transport recovery attempt.
  // Used to avoid a tight retry loop when the transport fails repeatedly.
  private lastRecoveryAt = 0;
  // Monotonic attempt number within one runtime recovery sequence; reset once
  // a transport reopen succeeds so traces can correlate repeated failures.
  private recoveryAttempt = 0;
  private recoveryExhausted = false;
  /** Monotonic generation incremented on every successful transport open.
   * Stays in lockstep with `lastSuccessAt` so callers can detect that the
   * transport has been reopened even if the timestamp window is short. */
  private recoveryGeneration = 0;
  /** Timestamp of the most recent successful transport open. Null until the
   * transport has reached the `ready` state at least once. */
  private lastSuccessAt: number | null = null;
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
  private readonly recoveryMaxAttempts: number;

  constructor(options: CrossTabDataBusOptions<TConfig, TData>) {
    const replay = options.replay;
    assertReplayOptions(replay);
    const { autoStart, initialConfig, trace, transport, dedup, recovery, ...clusterOptions } = options;
    assertRecoveryOptions(recovery);
    this.recoveryCooldownMs = recovery?.cooldownMs ?? 1000;
    this.recoveryMaxAttempts = recovery?.maxAttempts ?? Number.POSITIVE_INFINITY;
    this.now = dedup?.now ?? Date.now;
    this.transport = transport;
    this.initialConfig = initialConfig;
    this.hasInitialConfig = 'initialConfig' in options;
    this.trace = new DataBusTraceReporter(trace);
    this.replayManager = new ReplayManager<TData>({
      enabled: replay !== undefined,
      maxPerTopic: replay?.maxPerTopic ?? DEFAULT_REPLAY_MAX_PER_TOPIC,
      persistence: (replay?.persistence as DataBusReplayPersistence<TData> | undefined) ?? null,
      retentionMs: replay?.retentionMs,
      pruneStrategy: replay?.pruneStrategy ?? PRUNE_STRATEGY.COUNT,
      retentionSweepMs: replay?.retentionSweepMs,
      persistenceRetryMaxAttempts: replay?.persistenceRetry?.maxAttempts ?? 1,
      persistenceRetryBackoffMs: replay?.persistenceRetry?.backoffMs ?? 50,
      now: this.now,
      trace: this.trace,
      onPersistenceError: error => this.reportPersistenceError(error),
      onDispatchError: error => this.reportError(error, FAILURE_SOURCE.DISPATCH)
    });
    assertDedupOptions(dedup);
    this.dedupManager = new DedupManager({
      enabled: dedup !== undefined,
      maxEntries: dedup?.maxEntries ?? 1_000,
      ttlMs: dedup?.ttlMs ?? 60_000,
      adaptiveBounds: dedup?.adaptiveTtl,
      sweepMs: dedup?.sweepMs,
      now: this.now,
      trace: this.trace
    });
    this.cluster = new WorkerClusterRuntime({
      ...clusterOptions,
      handlers: {
        // The cluster calls `onControl` when it receives a SUBSCRIBE/UNSUBSCRIBE/PUBLISH
        // control message — meaning the owning Worker has delegated the action to us.
        onControl: (action, topic, data, messageId, timestamp) => {
          switch (action) {
            case CONTROL_ACTION.SUBSCRIBE:
              if (this.subscribeTransport(topic)) this.traceSubscription(SUBSCRIPTION_ACTION.SUBSCRIBE, topic);
              break;
            case CONTROL_ACTION.UNSUBSCRIBE:
              if (this.unsubscribeTransport(topic)) this.traceSubscription(SUBSCRIPTION_ACTION.UNSUBSCRIBE, topic);
              break;
            case CONTROL_ACTION.PUBLISH:
              this.runTransport(() => this.transport.publish(topic, data, publicationMetadata(messageId, timestamp)));
              break;
            default:
              break;
          }
        },
        // Batched variant of the PUBLISH action (CONTROL frames carrying
        // multiple items, and the local publishBatch fast path). Uses the
        // transport's one-frame publishBatch when available, preserving
        // per-item metadata; otherwise falls back to per-item publishes.
        onPublishBatch: (topic, items) => {
          if (typeof this.transport.publishBatch === 'function') {
            this.runTransport(() => this.transport.publishBatch!(topic, items));
            return;
          }
          for (const item of items) {
            this.runTransport(() => this.transport.publish(
              topic,
              item.data,
              publicationMetadata(item.messageId, item.timestamp)
            ));
          }
        },
        // The cluster calls `onEvent` when a publication broadcast arrives from
        // another tab. Dispatch locally if we have subscribers. The payload is
        // typed `unknown` at the cluster boundary (the cluster is transport-
        // agnostic); here we narrow it to DataBusMessage — the sender is our
        // own broadcastEvent call, which always posts a DataBusMessage.
        onEvent: (eventType, payload, _sourceWorkerId, originTabId) => {
          if (eventType !== PUBLICATION_EVENT) return;
          const incoming = payload as DataBusMessage<TData>;
          // Prefer the originTabId the sender stamped; only fall back to the
          // broadcast cluster tabId when the older cluster version is in use.
          const message: DataBusMessage<TData> = incoming.originTabId !== undefined
            ? incoming
            : originTabId !== undefined
              ? { ...incoming, originTabId }
              : incoming;
          if (this.cluster.hasLocalSubscriber(message.topic)) this.dispatch(message);
        },
        onSuspend: () => {
          // Suppress the suspend trace event during an explicit stop() so
          // the trace log ends on 'stop' rather than 'suspend'→'stop'.
          if (!this.stopping) this.trace.event({ type: TRACE_EVENT_TYPE.LIFECYCLE, action: TRACE_LIFECYCLE_ACTION.SUSPEND });
          this.trace.pause();
          this.replayManager.suspend();
          this.stopDedupSweep();
          this.suspendTransport();
        },
        onResume: () => {
          this.trace.event({ type: TRACE_EVENT_TYPE.LIFECYCLE, action: TRACE_LIFECYCLE_ACTION.RESUME });
          this.trace.start();
          this.startDedupSweep();
          this.replayManager.start();
          this.resumeTransport();
        },
        onDiagnostic: event => {
          this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, ...event });
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
    // A fresh start begins a new failure ledger so health consumers correlate
    // failures with the current session, not the previous one.
    this.lastFailure = null;
    this.persistenceFailureCount = 0;
    this.persistenceLastFailureAt = null;
    this.persistenceLastErrorMessage = null;
    this.trace.event({ type: TRACE_EVENT_TYPE.LIFECYCLE, action: TRACE_LIFECYCLE_ACTION.START });
    this.trace.start();
    this.startDedupSweep();
    this.replayManager.start();
    this.updateStatus(WORKER_STATUS.CONNECTING);
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
      type: TRACE_EVENT_TYPE.COORDINATION,
      coordinated: snapshot.coordinated,
      activeWorkers: snapshot.workers.filter(worker => worker.role === WORKER_ROLE.ACTIVE).length,
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
          if (this.status === WORKER_STATUS.ERROR) {
            throw new Error('Transport failed during startup.');
          }
          if (!this.suspended && !this.stopping) {
            this.recoveryGeneration += 1;
            this.lastSuccessAt = this.now();
            this.transportReady = true;
          }
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
        this.updateStatus(WORKER_STATUS.ERROR);
        this.reportError(error);
        this.lastError = error;
        this.lastErrorAt = this.now();
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
      this.replayManager.deliverReplay(topic, options.replay, handler, () =>
        Boolean(this.topicHandlers.get(topic)?.has(handler))
      );
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
    this.replayManager.onTopicUnsubscribed(topic);
    this.cluster.unsubscribe(topic);
  }

  /** Clear all in-memory replay buffers and, when supported, durable history. */
  async clearReplay(): Promise<void> {
    await this.replayManager.clearAll();
  }

  /** Clear replay history for one exact topic, including durable storage. */
  async clearReplayTopic(topic: string): Promise<void> {
    await this.replayManager.clearTopic(topic);
  }

  /** Remove replay entries older than an epoch-millisecond cutoff. */
  async clearReplayBefore(timestamp: number): Promise<void> {
    await this.replayManager.clearBefore(timestamp);
  }

  /** Return bounded deduplication counters for diagnostics and health checks. */
  getDedupStats(): DataBusDedupStats {
    return this.dedupManager.getStats();
  }

  /** Drop all remembered IDs and reset dedup counters. */
  resetDedup(): void {
    this.dedupManager.reset();
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

  /**
   * Burst-friendly variant of `publish()`: delivers `items` in a single
   * BroadcastChannel postMessage so the receiving owner can dispatch them all
   * in one tick. Per-item dedup / replay / ordering is preserved; each item
   * may carry its own `messageId` / `timestamp` via `options`. Empty array is
   * a no-op; single-item array delegates to `publish()`.
   */
  publishBatch(
    topic: string,
    items: ReadonlyArray<{ data: unknown; options?: DataBusPublishOptions }>
  ): void {
    this.ensureStarted();
    if (items.length === 0) return;
    if (items.length === 1) {
      const first = items[0]!;
      this.publish(topic, first.data, first.options);
      return;
    }
    const mapped = items.map(item => ({
      data: item.data,
      ...publicationMetadata(item.options?.messageId, item.options?.timestamp)
    }));
    if (!this.cluster.publishBatch(topic, mapped)) {
      this.reportError(
        new Error('Failed to send the batched publish control message to the owning worker.')
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

  /** Return the current automatic transport recovery state. `hasError` means a transport error is currently retained. */
  /** Return the current automatic transport recovery state plus diagnostics.
   * `generation` increments on every successful transport open (initial start
   * and every recovery); `lastSuccessAt` is the timestamp of the most recent
   * successful open, or `null` until the transport reaches `ready`. */
  getRecoveryStats(): {
    attempt: number;
    exhausted: boolean;
    maxAttempts: number;
    hasError: boolean;
    errorMessage: string | null;
    errorAt: number | null;
    generation: number;
    lastSuccessAt: number | null;
  } {
    const errorMessage = this.lastError instanceof Error ? this.lastError.message : this.lastError === null ? null : String(this.lastError);
    return {
      attempt: this.recoveryAttempt,
      exhausted: this.recoveryExhausted,
      maxAttempts: this.recoveryMaxAttempts,
      hasError: this.lastError !== null,
      errorMessage,
      errorAt: this.lastErrorAt,
      generation: this.recoveryGeneration,
      lastSuccessAt: this.lastSuccessAt
    };
  }

  /** Bounded failure counters for the replay persistence backend. */
  getPersistenceStats(): DataBusPersistenceHealth {
    return {
      failures: this.persistenceFailureCount,
      lastFailureAt: this.persistenceLastFailureAt,
      lastErrorMessage: this.persistenceLastErrorMessage
    };
  }

  /** Compact health verdict for dashboards, readiness probes, and support
   * bundles. Answers "is the bus usable right now" first, then attaches the
   * unified failure ledger and recovery context that explains the verdict. */
  getHealthSummary(): DataBusHealthSummary {
    const transport = this.transport;
    // A transport can report 'error'/'disconnected' while transportReady is
    // still set (the flag only resets via the open/failure paths), so the
    // live status must participate in the verdict.
    const transportDown = !this.transportReady || this.status === WORKER_STATUS.ERROR || this.status === WORKER_STATUS.DISCONNECTED;
    const state: DataBusHealthSummary['state'] =
      !this.started
        ? HEALTH_STATE.STOPPED
        : this.suspended
          ? HEALTH_STATE.SUSPENDED
          : transportDown
            ? this.recoveryExhausted
              ? HEALTH_STATE.DEGRADED
              : this.status === WORKER_STATUS.CONNECTING && this.recoveryAttempt === 0
                ? HEALTH_STATE.STARTING
                : HEALTH_STATE.RECOVERING
            : HEALTH_STATE.HEALTHY;
    return {
      healthy: state === HEALTH_STATE.HEALTHY,
      state,
      status: this.status,
      sdkVersion: SDK_VERSION,
      started: this.started,
      suspended: this.suspended,
      transport: {
        name: transport.diagnosticsName ?? transport.constructor.name,
        backend: transport.diagnosticsBackend ?? null,
        ready: this.transportReady,
        status: this.status
      },
      recovery: this.getRecoveryStats(),
      lastFailure: this.lastFailure,
      persistence: this.getPersistenceStats()
    };
  }

  /** Snapshot of the cluster state (workers, routes, assignments).
   * For diagnostics only — the returned object is a shallow copy but
   * nested arrays are snapshots at call time. */
  getClusterSnapshot() {
    return this.cluster.getSnapshot();
  }

  /** Return a single health snapshot combining lifecycle, recovery, dedup, replay, and cluster state. */
  getDiagnostics(): DataBusDiagnostics {
    const replay = this.replayManager.getStats();
    const cluster = this.cluster.getSnapshot();
    const unknownMessages = this.cluster.getUnknownMessageStats();
    const transport = this.transport;
    return {
      status: this.status,
      sdkVersion: SDK_VERSION,
      started: this.started,
      transportReady: this.transportReady,
      recovery: this.getRecoveryStats(),
      dedup: this.getDedupStats(),
      replay: { enabled: replay.enabled, topics: replay.topics, messages: replay.messages },
      persistence: this.getPersistenceStats(),
      protocol: { version: cluster.protocolVersion, unknownMessages: unknownMessages.count, lastUnknownMessageType: unknownMessages.lastType, peers: cluster.peerProtocolVersions },
      transport: {
        name: transport.diagnosticsName ?? transport.constructor.name,
        backend: transport.diagnosticsBackend ?? null,
        status: this.status,
        suspended: this.suspended
      },
      cluster
    };
  }

  /**
   * Gracefully stop the DataBus: unsubscribe all topics, stop the cluster,
   * and close the transport. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.stopping = true;
    this.replayManager.suspend();
    this.trace.event({ type: TRACE_EVENT_TYPE.LIFECYCLE, action: TRACE_LIFECYCLE_ACTION.STOP });
    this.trace.stop();
    this.stopDedupSweep();
    this.topicHandlers.clear();
    this.replayManager.resetBuffers();
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
      this.lastErrorAt = null;
      this.activeConfig = undefined;
      this.recoveryAttempt = 0;
      this.recoveryExhausted = false;
      this.updateStatus(WORKER_STATUS.DISCONNECTED);
    }
  }

  /**
   * Incoming message from the transport.
   * Records metrics, checks ownership via the cluster, broadcasts to other tabs,
   * and dispatches locally.
   */
  private handleTransportMessage(message: DataBusMessage<TData>): void {
    if (this.dedupManager.isDuplicate(message.messageId ?? '', message.topic)) return;
    this.trace.recordReceived(message.topic);
    // Drop messages for topics we do not own — the owning Worker fans out.
    if (!this.cluster.isAssigned(message.topic)) {
      this.trace.recordDiscarded(message.topic);
      return;
    }
    // Stamp the originating tab BEFORE broadcasting so neighbors replaying
    // history can attribute each entry to the tab that produced it. Locally
    // we publish first and dispatch second to keep the contract: a handler
    // called before the broadcast settled would still observe originTabId.
    const stamped: DataBusMessage<TData> = message.originTabId === undefined
      ? { ...message, originTabId: this.cluster.tabId }
      : message;
    this.cluster.broadcastEvent(PUBLICATION_EVENT, stamped, stamped.originTabId);
    if (this.cluster.hasLocalSubscriber(message.topic)) {
      this.dispatch(stamped);
      return;
    }
    this.trace.recordDiscarded(message.topic);
  }

  /** Start enqueuing the dedup expiry sweep (delegated to {@link DedupManager}). */
  private startDedupSweep(): void {
    this.dedupManager.start();
  }

  /** Stop enqueuing the dedup expiry sweep. */
  private stopDedupSweep(): void {
    this.dedupManager.stop();
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
    this.replayManager.record(message);
  }

  /**
   * Propagate a status change to the cluster, trace, and all registered
   * status handlers. On reconnect, re-subscribe any topics assigned to us.
   */
  private updateStatus(status: WorkerStatus): void {
    const previousStatus = this.status;
    this.status = status;
    if (previousStatus !== status) this.trace.event({ type: TRACE_EVENT_TYPE.STATUS, status });
    this.cluster.setStatus(status);
    // Clear transport subscriptions on disconnect; the transport is gone.
    if (status === WORKER_STATUS.DISCONNECTED || status === WORKER_STATUS.ERROR) this.transportSubscribedTopics.clear();
    // Re-subscribe assigned topics when the transport reconnects.
    if (status === WORKER_STATUS.CONNECTED && previousStatus !== WORKER_STATUS.CONNECTED) {
      for (const topic of this.cluster.getSnapshot().assignedTopics) this.subscribeTransport(topic);
    }
    // Auto-recover from a runtime transport failure (e.g. a crashed Worker)
    // while the bus is still meant to be started. Guarded by a cooldown to
    // avoid a tight retry loop when the transport fails immediately.
    // Uses setTimeout so the recovery does not run re-entrantly inside the
    // callback that produced this status (e.g. openTransport's catch).
    if (status === WORKER_STATUS.ERROR && this.started && !this.stopping) {
      const now = this.now();
      if (now - this.lastRecoveryAt >= this.recoveryCooldownMs) {
        this.lastRecoveryAt = now;
        const attempt = ++this.recoveryAttempt;
        if (attempt > this.recoveryMaxAttempts) {
          if (!this.recoveryExhausted) {
            this.recoveryExhausted = true;
            this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, operation: RELIABILITY_OPERATION.TRANSPORT_RECOVERY, attempt: this.recoveryMaxAttempts, outcome: RECOVERY_OUTCOME.EXHAUSTED });
          }
          return;
        }
        this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, operation: RELIABILITY_OPERATION.TRANSPORT_RECOVERY, attempt, outcome: RECOVERY_OUTCOME.SCHEDULED });
        setTimeout(() => {
          if (this.stopping || !this.started || this.suspended) return;
          // An explicit resume or subscribe already recovered the transport
          // (or is in flight), so this stale timer must not open it again.
          if (this.status !== WORKER_STATUS.ERROR) return;
          void this.reopenTransport(attempt);
        }, this.recoveryCooldownMs);
      }
    }
    this.invokeHandlers(this.statusHandlers, handler => handler(status));
  }

  private reportError(error: unknown, source: DataBusFailureSource = FAILURE_SOURCE.TRANSPORT): void {
    this.lastFailure = {
      source,
      message: error instanceof Error ? error.message : String(error),
      at: this.now()
    };
    if (source === FAILURE_SOURCE.PERSISTENCE) {
      this.persistenceFailureCount += 1;
      this.persistenceLastFailureAt = this.lastFailure.at;
      this.persistenceLastErrorMessage = this.lastFailure.message;
    }
    this.trace.event({
      type: TRACE_EVENT_TYPE.ERROR,
      source: source === FAILURE_SOURCE.TRANSPORT ? TRACE_ERROR_SOURCE.TRANSPORT : TRACE_ERROR_SOURCE.OPERATION
    });
    this.invokeHandlers(this.errorHandlers, handler => handler(error), INVOKE_LABEL.ERROR_HANDLER);
  }

  /** Report a persistence failure to the trace and the unified failure ledger,
   * unless it is a {@link PersistenceRetryCancelledError} cancellation from a
   * lifecycle transition (teardown should stay quiet). */
  private reportPersistenceError(error: unknown): void {
    if (error instanceof PersistenceRetryCancelledError) return;
    this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, operation: RELIABILITY_OPERATION.PERSISTENCE_CLEANUP });
    this.reportError(error, FAILURE_SOURCE.PERSISTENCE);
  }

  private traceSubscription(action: (typeof SUBSCRIPTION_ACTION)[keyof typeof SUBSCRIPTION_ACTION], topic: string): void {
    this.trace.event({
      type: TRACE_EVENT_TYPE.SUBSCRIPTION,
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
    label: (typeof INVOKE_LABEL)[keyof typeof INVOKE_LABEL] = INVOKE_LABEL.DISPATCH
  ): void {
    for (const handler of handlers) {
      try {
        callback(handler);
      } catch (error) {
        if (label === INVOKE_LABEL.ERROR_HANDLER) {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn(`[${DEFAULT_STORAGE_PREFIX}] error handler threw:`, error);
          }
        } else {
          this.reportError(error, FAILURE_SOURCE.DISPATCH);
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
    this.updateStatus(WORKER_STATUS.DISCONNECTED);
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
    this.updateStatus(WORKER_STATUS.CONNECTING);
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
          this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, operation: RELIABILITY_OPERATION.TRANSPORT_RECOVERY, attempt: traceAttempt, outcome: RECOVERY_OUTCOME.SUCCEEDED });
          this.recoveryAttempt = 0;
          this.recoveryExhausted = false;
        }
        if (this.startPromise === opening) this.startPromise = null;
      },
      () => {
        if (traceAttempt !== undefined) {
          this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, operation: RELIABILITY_OPERATION.TRANSPORT_RECOVERY, attempt: traceAttempt, outcome: RECOVERY_OUTCOME.FAILED });
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
