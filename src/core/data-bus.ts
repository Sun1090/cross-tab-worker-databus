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
import type { DataBusMetricsSnapshot, DataBusTraceOptions } from './trace';
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
import { describeFailure } from '../utils/error-utils';
import { assertDedupOptions, assertPublicTopic, assertReplayOptions, assertRecoveryOptions } from '../utils/validation';

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
  /** Maximum buffered publications per topic under 'count'/'both'. With 'age',
   * timestamped history is bounded by `retentionMs` and timestamp-less legacy
   * entries are capped by this value. Oldest entries are evicted first.
   * Default 100. */
  maxPerTopic?: number;
  /** Optional durable history backend. Defaults to in-memory only. */
  persistence?: DataBusReplayPersistence<TData>;
  /** Optional producer-timestamp retention window in milliseconds. */
  retentionMs?: number;
  /** History trimming policy: 'count' (default) caps each topic at
   * `maxPerTopic`, 'age' prunes by `retentionMs`, and 'both' applies both.
   * With 'age', timestamped entries are bounded by the retention window and
   * timestamp-less legacy entries are capped by `maxPerTopic`. An 'age'
   * strategy without `retentionMs` falls back to the count cap. */
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
  replay: { enabled: boolean; topics: number; messages: number; bytes: number };
  persistence: DataBusPersistenceHealth;
  protocol: { version: number; unknownMessages: number; lastUnknownMessageType: string | null; peers: Record<string, number | null> };
  transport: { name: string; backend: string | null; status: WorkerStatus; suspended: boolean };
  cluster: WorkerClusterSnapshot;
  /** Current trace metrics window counters, or null when metrics are inactive. */
  metrics: DataBusMetricsSnapshot | null;
  /** Trace sink delivery mode and queued-event depth (asyncSink back-pressure). */
  trace: { asyncSink: boolean; pendingEvents: number };
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
  /** Current trace metrics window, or null when trace metrics are inactive. */
  metrics: DataBusMetricsSnapshot | null;
  /** Trace sink delivery mode and queued-event depth (asyncSink back-pressure). */
  trace: { asyncSink: boolean; pendingEvents: number };
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
  // Whether the installed transport has reported `connected` at least once
  // since the current open began. A clean `disconnected` after this point is
  // a lost working connection, not the pre-connect window of a worker-style
  // backend whose start() resolves before it reports the connection.
  private transportHasConnected = false;
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
  // Gate for an explicit stop(). Concurrent stop() calls share it, and a
  // start() received while stopping chains a fresh start after it.
  private stopPromise: Promise<void> | null = null;
  // A start() requested while an explicit stop() is still settling. Kept
  // separate from startPromise because stop()'s finally block clears the
  // ordinary lifecycle gate before the queued start is allowed to run.
  private queuedStart: Promise<void> | null = null;
  // Lazy readiness view of queuedStart. start() keeps its documented
  // resolve-on-cancellation contract, while ready() must reject when the
  // queued intent was superseded by a later stop().
  private queuedStartReady: Promise<void> | null = null;
  private queuedStartReadyToken = 0;
  // The queued continuation is chained to the stop promise and cannot be
  // un-scheduled once scheduled. A later stop() therefore invalidates the
  // current intent by recording its token; a subsequent start() issues a
  // higher token so the latest lifecycle request still wins.
  private queuedStartToken = 0;
  private canceledQueuedStartToken = 0;
  // Timestamp of the last automatic transport recovery attempt.
  // Used to avoid a tight retry loop when the transport fails repeatedly.
  private lastRecoveryAt = 0;
  // Monotonic attempt number within one runtime recovery sequence; reset once
  // a transport reopen succeeds so traces can correlate repeated failures.
  private recoveryAttempt = 0;
  private recoveryExhausted = false;
  // Gate that holds transport operations issued after a runtime `error` until
  // the scheduled recovery attempt has actually run. Without it, a dead
  // transport still has `transportReady === true` during the cooldown, so
  // publishes/subscribes would be written to the failed connection and lost.
  private recoveryGate: Promise<void> | null = null;
  private recoveryGateRelease: (() => void) | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimerToken = 0;
  // Invalidates operations parked on the recovery gate when a hide/stop
  // supersedes the recovery cycle. Their microtask may run after an immediate
  // explicit start has cleared `suspended`, so a state check alone is not
  // enough to keep stale work from reaching the replacement transport.
  private recoveryCancellationToken = 0;
  // Once an automatic attempt fails, an explicit transport operation may
  // recover immediately instead of waiting for the next paced attempt. The
  // gate still stays closed so the operation cannot reach the failed
  // transport; it is released by the successful on-demand reopen.
  private recoveryDemandAllowed = false;
  // Number of transport operations currently parked behind `recoveryGate`.
  // When an automatic attempt fails, these already-parked operations are
  // themselves demand: the failure path starts an on-demand reopen instead of
  // stranding them until some unrelated future operation arrives.
  private recoveryWaiters = 0;
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
  // Ownership token for asynchronous transport opens. Every lifecycle
  // transition invalidates callbacks and failure cleanup from older opens.
  private lifecycleEpoch = 0;
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
          // EVENT is a same-origin coordination boundary shared with older and
          // newer SDK versions. Ignore frames that do not carry the minimum
          // publication shape instead of letting a malformed peer throw from
          // the channel listener and break subsequent EVENT delivery.
          if (
            typeof payload !== 'object' ||
            payload === null ||
            typeof (payload as { topic?: unknown }).topic !== 'string'
          ) return;
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
          if (!this.resumeSuspendedResources()) return;
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
   * during an in-flight open return the same promise. A call received while an
   * explicit stop() is settling queues one fresh start after cleanup; a later
   * stop() before that queued start runs cancels it, so the latest lifecycle
   * intent wins. Once an operation settles (success or failure) its promise
   * gate is cleared so a subsequent start() or resumeTransport() can open a
   * fresh lifecycle.
   */
  start(config: TConfig): Promise<void> {
    if (this.queuedStart) return this.queuedStart;
    if (this.stopping) return this.queueStartAfterStop(config);
    // A suspended transport uses the same promise for startPromise and
    // pendingStop. Treat it as a stop gate here so an explicit start() queues a
    // real reopen instead of returning a promise that only waits for cleanup.
    if (this.startPromise && this.startPromise !== this.pendingStop) return this.startPromise;
    if (this.started) {
      const transportDown =
        !this.transportReady ||
        this.status === WORKER_STATUS.ERROR ||
        this.status === WORKER_STATUS.DISCONNECTED;
      if (!transportDown) return Promise.resolve();
      // An explicit start() is a manual recovery path after the automatic
      // recovery budget is exhausted. Keep the cluster and subscriptions
      // intact, but begin a fresh failure/recovery ledger before reopening.
      this.activeConfig = config;
      // Keep any operations parked on the recovery gate across this explicit
      // manual attempt. If it fails, those operations remain queued for the
      // next automatic recovery instead of being dropped with the superseded
      // opening.
      this.resetFailureState(true);
      // An explicit start() is also a documented resume path out of BFCache
      // suspension: it clears `suspended` and reopens the transport. The
      // cluster keeps its own paused flag and is normally resumed by the
      // pageshow listener, so resume it here too. Otherwise the bus reports a
      // healthy transport while cross-tab coordination stays dormant (closed
      // channel, no heartbeat, cleared assignments) and incoming publications
      // are discarded by isAssigned() until the next pageshow. reopenTransport()
      // clears `suspended` and installs the opening first so the cluster's
      // re-subscription traffic parks behind it instead of hitting the stopped
      // transport; cluster.start() is idempotent and a no-op when not paused.
      const resumingFromSuspend = this.suspended;
      // RESUME trace events are synchronous extension points. A sink can call
      // stop() while this resume is being prepared; the stop owns the newest
      // lifecycle and the outer start must not restart timers or the cluster.
      // A sink can equally call start(), which supersedes this resume by bumping
      // the epoch with no stop in flight at all — that is why the fallback is a
      // live arm and not decoration: `start()` returns `Promise<void>`, so
      // returning a bare null `stopPromise` breaks `bus.start(c).then(...)`.
      // Pinned by "returns a promise from a resume that a re-entered start() has
      // already superseded".
      if (resumingFromSuspend && !this.resumeSuspendedResources()) {
        return this.stopPromise ?? Promise.resolve();
      }
      const opening = this.reopenTransport();
      // The CONNECTING notification inside reopenTransport() is another
      // synchronous callback boundary. Only restore the cluster if that reopen
      // still owns the lifecycle after the callback returns.
      if (resumingFromSuspend && !this.stopping && !this.suspended) this.cluster.start();
      return opening;
    }
    this.started = true;
    this.stopping = false;
    this.suspended = false;
    this.activeConfig = config;
    // A fresh start begins a new failure ledger so health consumers correlate
    // failures with the current session, not the previous one.
    this.resetFailureState();
    // Establish lifecycle ownership before emitting START: a synchronous trace
    // sink can call stop() re-entrantly, and that stop must invalidate this
    // opening before transport.start() is reached. Installing startPromise
    // first also keeps cluster.subscribe() callbacks from opening a second
    // transport while this start is still in progress.
    const lifecycleEpoch = ++this.lifecycleEpoch;
    const opening = this.openTransport(
      config,
      this.pendingStop ?? Promise.resolve(),
      true,
      lifecycleEpoch
    );
    this.startPromise = opening;

    this.trace.start();
    this.trace.event({ type: TRACE_EVENT_TYPE.LIFECYCLE, action: TRACE_LIFECYCLE_ACTION.START });
    // A re-entrant stop() or suspend() owns the newest lifecycle now. Do not
    // continue starting timers/cluster resources after it has torn them down.
    if (lifecycleEpoch !== this.lifecycleEpoch || this.stopping) return opening;

    this.startDedupSweep();
    this.replayManager.start();
    this.updateStatus(WORKER_STATUS.CONNECTING);
    // Status handlers and trace sinks run synchronously from updateStatus().
    if (lifecycleEpoch !== this.lifecycleEpoch || this.stopping) return opening;

    this.cluster.start();
    if (lifecycleEpoch !== this.lifecycleEpoch || this.stopping) return opening;
    // Replay subscriptions that were registered before start() or that were lost
    // during a previous failure recovery. The cluster.stop() call in the failure
    // path clears subscribedTopics, but topicHandlers retains the intent.
    // Iterating topicHandlers (not transportSubscribedTopics) because the
    // transport hasn't subscribed to anything yet on a fresh start.
    for (const topic of this.topicHandlers.keys()) {
      // cluster.subscribe() can synchronously invoke onControl for a
      // self-owned topic, so a callback may supersede this lifecycle.
      //
      // Two superseding callbacks were built and measured, and neither one makes
      // this `break` observable: a re-entrant `stop()` (the transport received
      // ['first'] with the guard live *and* with it disabled, because a stopped
      // cluster's `subscribe()` is inert, so the iteration it prevents would have
      // done nothing), and a re-entrant `start()` (['first', 'second'] both ways,
      // because the newer lifecycle replays `second` itself and
      // `subscribeTransport()` absorbs the duplicate the old loop would have
      // issued). That is "executing and redundant in the reachable scenarios",
      // not "dominated": it is the only thing standing between a superseded
      // opening and issuing subscriptions at whichever transport is currently
      // installed, which the duplicate gate happens to cover today. Kept for that
      // reason, and the three start()/stop()/cluster.start() guards above it are
      // separately pinned, so a regression in this loop's job shows up there.
      if (lifecycleEpoch !== this.lifecycleEpoch || this.stopping) break;
      this.cluster.subscribe(topic);
    }
    // Once startup settles (success or failure), clear the pending gate so a
    // later start()/resumeTransport() can open a fresh operation. Guard against
    // clobbering a promise that suspend/resume may have already swapped in.
    void opening.then(
      () => {
        if (this.startPromise !== opening) return;
        // The coordination snapshot rides the success arm: a failed opening
        // describes a bus that never became usable, and the rejection arm above
        // emits nothing. It is not here to wait for storage flushes — see
        // emitCoordinationTrace() for the measurement that retired that reason.
        this.emitCoordinationTrace();
        this.startPromise = null;
      },
      () => {
        if (this.startPromise === opening) this.startPromise = null;
      }
    );
    return opening;
  }

  /** Return a cancellation-aware readiness view of the current queued start. */
  private getQueuedStartReady(): Promise<void> {
    const queued = this.queuedStart;
    // Unreachable from today's only caller — `ready()` guards with the identical
    // `if (this.queuedStart)` and calls this synchronously, with nothing in
    // between that could run user code — so the rejection below has never been
    // produced. Kept, because the two ways to drop it are not equal: without it
    // a future second caller gets `TypeError: Cannot read properties of null`
    // from the `.then` below, which is a formatter-shaped complaint about the
    // internals rather than the documented "No queued start is in flight."
    if (!queued) {
      return Promise.reject(new Error('No queued start is in flight.'));
    }
    const token = this.queuedStartToken;
    if (this.queuedStartReady && this.queuedStartReadyToken === token) {
      return this.queuedStartReady;
    }
    this.queuedStartReadyToken = token;
    this.queuedStartReady = queued.then(() => {
      if (token <= this.canceledQueuedStartToken) {
        throw new Error(
          'CrossTabDataBus start was canceled by a later stop(); ready() cannot report readiness. ' +
          'Call start() again after stop() resolves.'
        );
      }
      if (!this.started || !this.transportReady) {
        throw new Error('CrossTabDataBus restart completed without a ready transport.');
      }
    });
    return this.queuedStartReady;
  }

  /** Queue exactly one fresh start after an in-flight explicit stop settles. */
  private queueStartAfterStop(config: TConfig): Promise<void> {
    // Also unreachable from the only caller: `start()` returns `this.queuedStart`
    // one statement before it calls this, synchronously, so the dedupe below can
    // never fire. Kept for the same reason as the check above, but the asymmetry
    // is stronger here — dropping it would let a second caller queue a second
    // restart, and the "exactly one queued start" contract is what keeps a
    // burst of operations behind one stop from opening that many transports.
    if (this.queuedStart) return this.queuedStart;
    // No `.catch` on this await-then, and none is needed: `stopPromise` is
    // assigned a non-null value in exactly one place — stop()'s hand-resolved
    // gate — and both of that gate's settle handlers resolve it, which is what
    // keeps the public stop() contract non-rejecting.
    //
    // The read itself is load-bearing, and not for ordering. A restart that wakes
    // before its teardown settled goes back through `start()`'s
    // `if (this.stopping) return this.queueStartAfterStop(config)`, which re-queues
    // it — so replacing `this.stopPromise ?? …` with a bare `Promise.resolve()`
    // converts that one deferral into a microtask busy-wait which starves the
    // macrotask the transport stop needs, and allocates a promise chain per turn
    // until the heap goes. Measured: the mutation leaves `tests/data-bus.test.ts`
    // 194/194 green and aborts `tests/lifecycle-invariants.test.ts`'s worker with
    // `Ineffective mark-compacts near heap limit` inside `Builtins_RunMicrotasks`
    // after ~40 s of growth. That fuzz is this line's only witness, and it reports a
    // crash rather than an assertion; no assertion can replace it, measured — a test
    // that waits a bounded number of microtasks on a gated teardown and then releases
    // the gate passes with the read deleted, because the loop is invisible to anything
    // that never yields to the timer queue. So: do not delete that file's stop/restart
    // interleavings to speed it up.
    //
    // The fallback operand is a different question and now has its own case. Nothing
    // reachable through a browser re-enters here while `stopPromise` is null: a
    // failed *initial* open owns its cleanup through `pendingStop`, and the only
    // synchronous application-code seam inside that `stopping` window is the caller's
    // own `ClusterEnvironment` port. `tests/data-bus.test.ts`'s "queues a start()
    // re-entered from the environment port behind a failed open teardown" drives that
    // seam, and the ordering it asserts survives both this expression and a moved
    // `pendingStop` installation, because `start()` chains the reopen behind
    // `this.pendingStop` regardless. Neither operand can be dropped either: the field
    // is `Promise<void> | null`, so the bare read makes the `.then` below `TS18047`.
    const stop = this.stopPromise ?? Promise.resolve();
    const token = ++this.queuedStartToken;
    const queued = stop
      .then(() => {
        // Clear before invoking start(), which installs its own startPromise.
        if (this.queuedStart === queued) this.queuedStart = null;
        // stop() may have arrived after this restart was queued. The queued
        // continuation still runs (it is already chained), but it must not
        // reopen the transport: the latest lifecycle intent was a stop.
        if (token <= this.canceledQueuedStartToken) return;
        return this.start(config);
      });
    this.queuedStart = queued;
    return queued;
  }

  /** Release every operation waiting on the scheduled recovery attempt. */
  private releaseRecoveryGate(): void {
    const release = this.recoveryGateRelease;
    this.recoveryGate = null;
    this.recoveryGateRelease = null;
    this.recoveryDemandAllowed = false;
    release?.();
  }

  /** Cancel a pending automatic retry when an explicit lifecycle transition
   * supersedes it. The released gate re-enters runTransport(), which then
   * follows the newest start/stop/suspend intent. */
  private cancelScheduledRecovery(invalidateParkedOperations = false, releaseGate = true): void {
    this.recoveryTimerToken += 1;
    if (invalidateParkedOperations) this.recoveryCancellationToken += 1;
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (releaseGate) this.releaseRecoveryGate();
  }

  /** Keep the recovery gate closed after a failed attempt while allowing the
   * next explicit transport operation to start an immediate on-demand reopen.
   * If no gate/successor retry remains, release any waiters.
   *
   * `kickParkedWaiters` is set only when the failure is an automatic attempt: an
   * operation that was already parked on the gate is itself demand, so it must
   * not wait for some unrelated future operation. A failed *on-demand* reopen
   * passes `false`, so it re-arms the flag for a later operation instead of
   * looping on its own failure. */
  private allowDemandRecovery(kickParkedWaiters = false): void {
    if (
      this.recoveryGate !== null &&
      this.started &&
      !this.stopping &&
      !this.suspended &&
      this.status === WORKER_STATUS.ERROR
    ) {
      this.recoveryDemandAllowed = true;
      if (kickParkedWaiters && this.recoveryWaiters > 0) this.startDemandRecovery();
      return;
    }
    this.releaseRecoveryGate();
  }

  /** Start one on-demand reopen if a failed attempt has left parked operations
   * and enabled demand recovery. Consumes the demand token so at most one
   * reopen is issued; every waiter stays behind the gate until it succeeds. */
  private startDemandRecovery(): void {
    if (!this.recoveryDemandAllowed) return;
    // `suspended` and `stopping` cannot take this arm from either caller: the
    // `allowDemandRecovery()` call above already requires both to be clear, and
    // `runTransport()` returns on `suspended` and only enters the gate branch
    // when `!stopping`. Only `status !== ERROR` can fire, and reaching it needs
    // an `updateStatus()` away from error that neither releases the gate nor
    // consumes the token — `releaseRecoveryGate()` clears both, and the CONNECTED
    // arm releases when `transportReady` is set. Two constructions were tried
    // against that: a transport-level reconnect after a failed automatic attempt
    // (measured: the token was already consumed, so the guard at the line above
    // returned and the write went straight out), and the same with a
    // `disconnected` status (measured: a later automatic attempt reopened, so the
    // reopen-count assertion failed). Not proven dominated — an open zero-count
    // arm — and kept because deleting it would let any of those futures reopen a
    // connection that is reported up.
    if (this.status !== WORKER_STATUS.ERROR || this.suspended || this.stopping) return;
    this.recoveryDemandAllowed = false;
    const opening = this.reopenTransport();
    void opening.then(
      () => this.releaseRecoveryGate(),
      () => this.allowDemandRecovery()
    );
  }

  /** Reset failure and recovery diagnostics for a new explicit start session. */
  private resetFailureState(preserveRecoveryGate = false): void {
    this.cancelScheduledRecovery(false, !preserveRecoveryGate);
    if (preserveRecoveryGate) this.recoveryDemandAllowed = false;
    this.lastError = null;
    this.lastErrorAt = null;
    this.lastFailure = null;
    this.persistenceFailureCount = 0;
    this.persistenceLastFailureAt = null;
    this.persistenceLastErrorMessage = null;
    this.recoveryAttempt = 0;
    this.recoveryExhausted = false;
    this.lastRecoveryAt = 0;
  }

  /**
   * Open the transport, chained after `before` to ensure lifecycle ordering.
   * When `stopClusterOnFailure` is true (initial start), a transport failure
   * tears down the cluster as well.
   */
  private openTransport(
    config: TConfig,
    before: Promise<unknown>,
    stopClusterOnFailure: boolean,
    lifecycleEpoch: number
  ): Promise<void> {
    this.transportReady = false;
    const chainedPendingStop = this.pendingStop;
    const isCurrentLifecycle = () => lifecycleEpoch === this.lifecycleEpoch;
    // A transport can report `error` synchronously before start() settles.
    // Suppress the user-facing status notification until openTransport's catch
    // has created the stop gate and cleared startPromise; otherwise an onStatus
    // retry runs while the failed opening still owns the gate.
    let startupInProgress = true;
    // `before` resolves by construction, so no `.catch` is chained onto it: it is
    // either `Promise.resolve()` from reopenTransport() or `this.pendingStop` from
    // start(), and every non-null assignment of that field is a chain ending in a
    // terminal `.catch(error => this.reportError(error))`. That handler resolves for
    // any value a transport can reject with, because reportError's only coercion goes
    // through `describeFailure()`, which is total. It is not unconditional: a throwing
    // error subscriber plus a throwing `console.warn` escapes it — the same double
    // failure `stop()`'s `stopPromise` comment documents and
    // `tests/data-bus.test.ts`'s "settles stop() when the teardown failure cannot be
    // reported either" pins. Under that pair this promise rejects, the `.then()` below
    // is skipped and `transport.start()` is never reached, so the coercion's totality
    // and this premise have to stay together.
    return before
      .then(() => {
        // stop(), suspendTransport(), or a newer reopen may have arrived while
        // this opening was queued behind a pending stop. Abandon the open and
        // keep the settled stop gate visible so stop() does not issue a second
        // transport.stop().
        if (!isCurrentLifecycle() || this.stopping || this.suspended) return;
        // A stop we actually chained after has settled; this opening now owns
        // the lifecycle. The condition is always true here, and that is a
        // consequence of the epoch, not luck: `pendingStop` is written in
        // exactly four places — this line, the failed-open path below,
        // performStop()'s finally, and suspendTransport()'s chained stop — and
        // the last three all sit behind a `lifecycleEpoch` increment
        // (`beginStop()` and `suspendTransport()` each bump before they touch
        // the field), while the failed-open write belongs to this same chain and
        // runs strictly after this continuation. So an opening that arrives here
        // with its captured epoch still current cannot have had a different stop
        // chained meanwhile. The check is kept anyway, because the two ways it
        // could go wrong are not symmetric: an unconditional clear silently
        // depends on the invariant above, and if a future lifecycle transition
        // ever stops without bumping the epoch it would drop a live
        // `pendingStop` and let `stop()` issue a second `transport.stop()`.
        // Deleting it moves no coverage number, because the false arm has never
        // been taken and by that enumeration never can be.
        if (this.pendingStop === chainedPendingStop) this.pendingStop = null;
        // A fresh transport instance starts from scratch: until it reports
        // `connected` again its status is "not connected yet".
        this.transportHasConnected = false;
        return Promise.resolve(
          this.transport.start(config, {
            onMessage: message => {
              if (isCurrentLifecycle()) this.handleTransportMessage(message);
            },
            onStatus: status => {
              if (isCurrentLifecycle()) {
                this.updateStatus(status, status !== WORKER_STATUS.ERROR || !startupInProgress);
              }
            },
            onError: error => {
              if (isCurrentLifecycle()) this.reportError(error);
            }
          })
        ).then(() => {
          startupInProgress = false;
          if (!isCurrentLifecycle()) return;
          // A transport may report 'error' synchronously during start() (e.g. a
          // Worker that fails to boot) while still returning normally. Treat that
          // as a startup failure instead of marking the transport ready, so a
          // later subscribe/unsubscribe triggers a reopen rather than being
          // silently dropped on a dead transport.
          if (this.status === WORKER_STATUS.ERROR) {
            throw new Error('Transport failed during startup.');
          }
          // The two flags below can never be set for an opening that is still
          // current, which is why the false arm of this guard has never been
          // taken: `suspended` is assigned true in exactly one place, and
          // `stopping` in two. `suspendTransport()` and `beginStop()` each
          // increment `lifecycleEpoch` *before* raising the flag, so either one
          // having run makes the check above return first; the third site is the
          // failed-open cleanup below, which raises and lowers `stopping` inside
          // this same chain's catch, strictly after this continuation. Kept as
          // written, because the guard is the only thing that would notice a
          // future transition that suspends without superseding — marking a
          // hidden transport ready is the worse mistake.
          if (!this.suspended && !this.stopping) {
            this.recoveryGeneration += 1;
            this.lastSuccessAt = this.now();
            this.transportReady = true;
            // Release operations held during an automatic or on-demand reopen
            // only after the ready flag is visible. Releasing inside the
            // CONNECTED callback would make those operations bounce off the
            // still-clearing startPromise and can let ready() win the race.
            this.releaseRecoveryGate();
          }
        });
      })
      .catch(error => {
        // A newer suspend/resume/stop owns the lifecycle now. Do not let this
        // superseded open tear down the newer operation or clear its gate.
        if (!isCurrentLifecycle()) throw error;
        startupInProgress = false;
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
        this.transportReady = false;
        if (stopClusterOnFailure) {
          this.stopping = true;
          this.cluster.stop();
          this.stopping = false;
        }
        // Record the failure before any user callback can retry. The status
        // notification below runs re-entrantly and may legitimately call
        // start(); that explicit lifecycle must be able to reset this ledger.
        this.recordError(error);
        // Make the failed opening observable as settled before notifying any
        // status or error handler. Leaving the old rejecting promise in
        // startPromise would make a synchronous retry return the failure it is
        // reacting to instead of opening a new lifecycle. Settlement handlers
        // only clear this field when they still own the gate, so a reentrant
        // retry and any later error notification remain safe.
        this.startPromise = null;
        this.updateStatus(WORKER_STATUS.ERROR);
        this.notifyError(error);
        throw error;
      });
  }

  /**
   * Await the DataBus to be fully started (lazy init when using initialConfig).
   * Returns a rejected promise when the transport has failed and no start is in
   * flight — the caller can retry by calling start() or ready() again. While an
   * explicit stop() is settling, this rejects unless a restart is queued behind
   * it; false readiness during teardown is never reported. While the tab is
   * BFCache-suspended (pagehide without a following pageshow), this also
   * rejects: the suspended start promise is the transport-stop gate, not a
   * readiness signal.
   */
  ready(): Promise<void> {
    // A start() queued behind an in-flight stop is the newest lifecycle intent;
    // ready() remains its shared completion gate. Without that queued intent,
    // reporting readiness while teardown is in progress would be false.
    if (this.queuedStart) return this.getQueuedStartReady();
    if (this.stopping) {
      return Promise.reject(new Error(
        'CrossTabDataBus is stopping; ready() cannot report readiness until stop() resolves. ' +
        'Wait for stop() to resolve, then call start() before awaiting ready().'
      ));
    }
    // A page-hide suspension reuses startPromise as the async transport-stop
    // gate. That promise proves cleanup completed, not that the transport is
    // ready, so never let ready() resolve while the tab is intentionally
    // suspended. An explicit start()/pageshow clears the flag and installs a
    // real reopen promise before this check runs.
    if (this.suspended) {
      return Promise.reject(new Error(
        'CrossTabDataBus is suspended; ready() cannot report readiness until pageshow resumes the transport.'
      ));
    }
    // An explicit start(config) does not become an implicit initialConfig.
    // When that attempted start failed, ready() must still surface its real
    // transport error instead of masking it with "requires initialConfig".
    if (!this.started && !this.hasInitialConfig && this.lastError !== null) {
      return Promise.reject(this.lastError);
    }
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
    // Unreachable by construction, and deliberately *not* hunted for a test.
    // Reaching it needs `started && !transportReady && !suspended`, with
    // `startPromise` null and `lastError` null. `transportReady = false` is
    // written in exactly five places: `openTransport`'s entry (an opening owns
    // the gate, so the check above returns it), its failure path (which calls
    // `recordError` before it clears that gate, so the line above rejects with
    // the real reason), `performStop`'s finally (which also clears `started`,
    // so `ensureStarted` above has already either installed a fresh opening or
    // thrown for want of an `initialConfig`), and `reopenTransport` (which
    // assigns its opening synchronously a few lines earlier), and
    // `suspendTransport()` (which sets `suspended = true` just before clearing the
    // flag, so it is the `!suspended` term above that excludes it). Every other read
    // of the flag is true.
    //
    // It is kept rather than turned into an assertion because it is the last
    // `return` on a promise every caller awaits: a future path that cleared the
    // ready flag without recording a failure or installing an opening would
    // otherwise fall off the end and have `ready()` resolve on a dead transport,
    // which is the one mistake here that no caller could detect.
    return Promise.reject(
      new Error('Transport is not ready and no start operation is in flight')
    );
  }

  /**
   * Register a handler for `topic`. The handler fires on every publication
   * delivered to this tab, regardless of which tab published it. Returns an
   * unsubscribe function for convenience. During an explicit stop() the
   * registration is rejected through onError and a no-op cleanup is returned,
   * so a late subscriber cannot leak into a future restart.
   * @throws {TypeError} when `topic` is `''` — no transport can address such a
   *   channel, so the subscription could never receive anything.
   */
  subscribe(
    topic: string,
    handler: DataBusMessageHandler<TData>,
    options?: { replay?: boolean | number }
  ): () => void {
    // Argument validation precedes lifecycle state: a caller that passes `''`
    // has a bug whether or not the bus is stopping, and the TypeError names it.
    assertPublicTopic('subscribe', topic);
    // A subscription requested during teardown would either be erased by
    // topicHandlers.clear() or leak into the next start while its handler was
    // already dropped. Reject it explicitly, consistent with publish(), and
    // return a safe cleanup function so callers can keep uniform teardown code.
    if (this.stopping) {
      this.reportError(new Error(
        'CrossTabDataBus is stopping; subscribe() was not registered. ' +
        'Wait for stop() to resolve, then call start() before subscribing again.'
      ));
      return () => {};
    }
    this.ensureStarted();
    const handlers = this.topicHandlers.get(topic) ?? new Set<DataBusMessageHandler<TData>>();
    const wasUnused = handlers.size === 0;
    handlers.add(handler);
    this.topicHandlers.set(topic, handlers);
    // This 0→1 transition is the only entry into the cluster subscription *from
    // this method*. The other caller of `cluster.subscribe()` is `start()`'s replay
    // loop, which re-subscribes every key already in `topicHandlers` when a fresh
    // opening settles — so a topic can reach the cluster once per opening. That is
    // safe because the cluster's `subscribedTopics` is a Set and `subscribe()` is
    // idempotent by construction, which is what makes `wasUnused` the only gate
    // here: repeated installs of the same topic after a drop cannot
    // double-subscribe. The matching n→0 gate is in the unsubscribe path below.
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

  /** Clear replay history for one exact topic and, when the persistence adapter
   * implements `clearTopic`, its durable history too — an adapter without that
   * optional method leaves the persisted rows in place, exactly as `clearReplay`
   * does. */
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

  /** Publish a message to `topic`. The owning Worker delivers it to the transport.
   * @throws {TypeError} when `topic` is `''`; see `subscribe()`. */
  publish(topic: string, data: unknown, options?: DataBusPublishOptions): void {
    assertPublicTopic('publish', topic);
    this.ensureStarted();
    if (this.rejectPublishDuringStop('publish')) return;
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
   * @throws {TypeError} when `topic` is `''`; see `subscribe()`. Checked before
   *   the empty-array no-op, so `publishBatch('', [])` throws too — the topic is
   *   the caller's bug regardless of whether anything is carried.
   */
  publishBatch(
    topic: string,
    items: ReadonlyArray<{ data: unknown; options?: DataBusPublishOptions }>
  ): void {
    assertPublicTopic('publishBatch', topic);
    this.ensureStarted();
    if (items.length === 0) return;
    if (this.rejectPublishDuringStop('publishBatch')) return;
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

  /** Return the current automatic transport recovery state plus diagnostics.
   * `hasError`/`errorMessage`/`errorAt` describe the most recent retained
   * *transport* failure — from a transport open or a runtime `onError`. They
   * share the lifetime of the unified `lastFailure` ledger: a successful
   * recovery keeps the last failure visible, and only an explicit `start()`
   * clears it. `generation` increments on every successful transport open
   * (initial start and every recovery); `lastSuccessAt` is the timestamp of
   * the most recent successful open, or `null` until the transport reaches
   * `ready`. */
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
    const errorMessage = this.lastError === null ? null : describeFailure(this.lastError);
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
    // The live transport status is the source of truth for serviceability. A
    // transport that reports 'connected' is healthy even during the short
    // window before start() settles and the DataBus sets transportReady:
    // operations are queued behind that in-flight start promise rather than
    // dropped. `transportReady` stays in the snapshot as a diagnostic.
    const transportDown = this.status !== WORKER_STATUS.CONNECTED;
    // `stopping` means every operation is already rejected (publish/subscribe
    // return through onError, ready() rejects) even though the transport may
    // still report `connected` because teardown is async. Reporting HEALTHY
    // here would contradict that verdict, so an in-flight stop is surfaced as
    // STOPPED: the bus is not usable, and a queued restart behind this stop is
    // reported as STARTING once it actually owns the lifecycle.
    const state: DataBusHealthSummary['state'] =
      !this.started || this.stopping
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
      persistence: this.getPersistenceStats(),
      metrics: this.trace.getMetrics(),
      trace: this.trace.getSinkState()
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
      replay: { enabled: replay.enabled, topics: replay.topics, messages: replay.messages, bytes: replay.bytes },
      persistence: this.getPersistenceStats(),
      protocol: { version: cluster.protocolVersion, unknownMessages: unknownMessages.count, lastUnknownMessageType: unknownMessages.lastType, peers: cluster.peerProtocolVersions },
      transport: {
        name: transport.diagnosticsName ?? transport.constructor.name,
        backend: transport.diagnosticsBackend ?? null,
        status: this.status,
        suspended: this.suspended
      },
      cluster,
      metrics: this.trace.getMetrics(),
      trace: this.trace.getSinkState()
    };
  }

  /** Synchronous snapshot of the current trace metrics window (throughput,
   * dispatch latency, dedup outcomes), without flushing or resetting it.
   * Returns null when trace metrics are inactive (disabled or events-only). */
  getMetrics(): DataBusMetricsSnapshot | null {
    return this.trace.getMetrics();
  }

  /**
   * Gracefully stop the DataBus: unsubscribe all topics, stop the cluster,
   * and close the transport. Concurrent and repeated calls share the in-flight
   * stop promise. A start() received while stopping runs after this completes,
   * unless another stop() arrives first and cancels that queued restart.
   */
  stop(): Promise<void> {
    // A restart queued behind an in-flight stop is stale as soon as another
    // stop() is requested. Invalidate it and release the single queue slot so
    // a later start() can still queue a fresh restart with a higher token.
    if (this.queuedStart) {
      this.canceledQueuedStartToken = this.queuedStartToken;
      this.queuedStart = null;
    }
    // `stopPromise` is only the shared in-flight gate while the teardown is
    // still running. It is cleared in a microtask once performStop() settles,
    // so a stop() issued in that window (for example from code that observed
    // an earlier stop settle without awaiting it) would otherwise receive the
    // settled promise and skip a teardown the caller asked for, leaving a
    // concurrently restarted bus running. `stopping` flips to false inside
    // performStop()'s finally, so it is the authoritative "still stopping"
    // signal; a settled gate is stale and must fall through to a fresh stop.
    if (this.stopPromise && this.stopping) return this.stopPromise;
    if (!this.started && !this.startPromise && !this.pendingStop && !this.transportReady) {
      return Promise.resolve();
    }
    // Install the shared gate before running the synchronous prelude. The
    // teardown has not started yet, so this placeholder is what a stop()
    // re-entered from a synchronous trace sink receives: beginStop() below
    // emits the STOP lifecycle event, and `stopping` is already true by then,
    // so the nested call shares this gate instead of starting a second
    // teardown. The placeholder settles once the real teardown does, so every
    // caller observes the same completion.
    let resolveGate!: () => void;
    const stopGate = new Promise<void>(resolve => {
      resolveGate = resolve;
    });
    this.stopPromise = stopGate;
    // Run the synchronous prelude in the same tick as the gate installation:
    // every lifecycle flag and handler is flipped exactly as before, but the
    // STOP event emitted here already observes the shared gate.
    this.beginStop();
    const stopPromise = this.performStop();
    // Both settle arms clear the gate and resolve it, and the rejection arm is
    // not decoration: performStop() reports transport failures through
    // reportError(), which runs the error subscribers through invokeHandlers(),
    // which absorbs a throwing subscriber only by writing to console.warn. A
    // subscriber that throws *and* a console.warn that throws therefore escape
    // performStop()'s catch and reject it. On that path nothing else can wake a
    // caller of `await bus.stop()` — the transport shutdown is already done — so
    // resolveGate() here is the only thing that settles the public contract.
    // Pinned by "settles stop() when the teardown failure cannot be reported
    // either"; deleting resolveGate() from this arm makes that test report
    // 'hung' on its watchdog. The clearing beside it is defensive by the
    // reasoning at stop()'s `stopPromise && this.stopping` gate, which treats
    // `stopping` as authoritative and a settled gate as stale: deleting that
    // line changes no assertion in the file, measured. The swallow keeps an
    // unexpected teardown rejection from surfacing as an unhandled rejection for
    // fire-and-forget callers, and the public stop() contract stays
    // non-rejecting.
    void stopPromise.then(
      () => {
        if (this.stopPromise === stopGate) this.stopPromise = null;
        resolveGate();
      },
      () => {
        if (this.stopPromise === stopGate) this.stopPromise = null;
        resolveGate();
      }
    );
    return stopGate;
  }

  /**
   * Synchronous teardown prelude. Flips `stopping` (the authoritative
   * in-flight signal), cancels scheduled work, releases handlers, and emits the
   * observable STOP lifecycle event. stop() calls it after the shared gate is
   * installed but in the same tick, so the stop still takes effect immediately
   * while a re-entrant stop() from the STOP event shares the one teardown.
   */
  private beginStop(): void {
    this.lifecycleEpoch += 1;
    this.stopping = true;
    this.cancelScheduledRecovery(true);
    this.replayManager.suspend();
    this.trace.event({ type: TRACE_EVENT_TYPE.LIFECYCLE, action: TRACE_LIFECYCLE_ACTION.STOP });
    this.trace.stop();
    this.stopDedupSweep();
    this.topicHandlers.clear();
    this.replayManager.resetBuffers();
    this.cluster.stop();
  }

  private async performStop(): Promise<void> {
    // `stopping` is already true and handlers are released; this half awaits the
    // transport shutdown and completes the teardown.
    try {
      await this.startPromise?.catch(() => undefined);
      // A failed-open or suspend cleanup already stopped the transport;
      // awaiting it is enough, so stop() is not called a second time. No
      // `.catch` here, because there is nothing to catch: `pendingStop` is
      // assigned non-null in exactly two places — openTransport's failure path
      // via createStopPromise(), and suspendTransport()'s stop chained behind the
      // in-flight open — and both chains end in a terminal
      // `.catch(error => this.reportError(error))` that resolves. The failure is
      // therefore already recorded where it is produced, and a rejection reaching
      // this await would mean a third assignment site had been added. (Compare the
      // line above: `startPromise` genuinely can reject, because it holds the
      // opening that a failing `ready()` reports to its caller.)
      //
      // "Resolves" rests on `reportError` being total, i.e. on `describeFailure()`
      // never throwing for any rejection reason a transport can produce. Pinned by
      // "opens the transport on a retry when the failed open stop also failed
      // unrecordably", which is the same chain seen from the public API.
      const pendingStop = this.pendingStop;
      if (pendingStop) await pendingStop;
      else await this.transport.stop();
    } catch (error) {
      // A transport whose stop() rejects must not reject stop() itself: the
      // finally below completes the teardown either way, concurrent/repeated
      // callers share this one promise, and the React/Vue adapters legitimately
      // fire-and-forget `void bus.stop()`, where a rejection would surface as
      // an unhandled rejection. Route the failure through the same
      // ledger/onError channel suspendTransport() and createStopPromise() use.
      this.reportError(error);
    } finally {
      this.transportSubscribedTopics.clear();
      this.resetDedup();
      this.started = false;
      this.stopping = false;
      this.suspended = false;
      this.transportReady = false;
      this.startPromise = null;
      this.pendingStop = null;
      // Keep a stop failure visible in both failure ledgers. `lastFailure`
      // already survives teardown, and clearing only `lastError` here made the
      // same health snapshot report a retained transport failure alongside
      // `recovery.hasError: false`. `resetFailureState()` clears both on the
      // next explicit start.
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
    // A frame that already names its producer keeps it — `DataBusTransport` is a
    // public extension point, and a proxying or replaying one delivers someone
    // else's publication. Re-stamping here would attribute it to this tab, and
    // the EVENT fan-out and replay history both inherit that. Pinned by
    // 'keeps a producer stamp that arrives on the transport'.
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
  private updateStatus(status: WorkerStatus, notifyHandlers = true): void {
    const previousStatus = this.status;
    this.status = status;
    if (status === WORKER_STATUS.CONNECTED) this.transportHasConnected = true;
    if (previousStatus !== status) this.trace.event({ type: TRACE_EVENT_TYPE.STATUS, status });
    this.cluster.setStatus(status);
    // Clear transport subscriptions on disconnect; the transport is gone.
    if (status === WORKER_STATUS.DISCONNECTED || status === WORKER_STATUS.ERROR) this.transportSubscribedTopics.clear();
    // Re-subscribe assigned topics when the transport reconnects.
    if (status === WORKER_STATUS.CONNECTED && previousStatus !== WORKER_STATUS.CONNECTED) {
      // A transport may recover itself without a DataBus reopen (for example a
      // protocol-level reconnect). In that case the installed transport is
      // already ready and can drain operations held during recovery. During a
      // DataBus reopen transportReady is false until openTransport succeeds;
      // that success path releases the gate after publishing the ready state.
      if (this.transportReady) this.releaseRecoveryGate();
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
          // No automatic attempt is left. Release demand-driven operations so
          // subscribe/publish can still start an explicit manual recovery.
          this.releaseRecoveryGate();
          return;
        }
        this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, operation: RELIABILITY_OPERATION.TRANSPORT_RECOVERY, attempt, outcome: RECOVERY_OUTCOME.SCHEDULED });
        // Arm the gate before the timer so operations arriving in the
        // cooldown window cannot slip past onto the failed connection.
        if (this.recoveryGate === null) {
          let release!: () => void;
          this.recoveryGate = new Promise<void>(resolve => {
            release = resolve;
          });
          this.recoveryGateRelease = release;
        }
        this.recoveryDemandAllowed = false;
        const timerToken = ++this.recoveryTimerToken;
        this.recoveryTimer = setTimeout(() => {
          if (timerToken !== this.recoveryTimerToken) return;
          this.recoveryTimer = null;
          if (this.stopping || !this.started || this.suspended || this.status !== WORKER_STATUS.ERROR) {
            this.releaseRecoveryGate();
            return;
          }
          this.recoveryDemandAllowed = false;
          const opening = this.reopenTransport(attempt);
          void opening.then(
            () => this.releaseRecoveryGate(),
            // Operations already parked on the gate are demand: run one
            // on-demand reopen now instead of waiting for an unrelated event.
            () => this.allowDemandRecovery(true)
          );
        }, this.recoveryCooldownMs);
      }
    } else if (status === WORKER_STATUS.ERROR) {
      // An error outside an active recovery sequence (for example after an
      // initial start failure) must not leave demand-driven operations gated.
      this.releaseRecoveryGate();
    }
    if (notifyHandlers) this.invokeHandlers(this.statusHandlers, handler => handler(status));
  }

  private recordError(error: unknown, source: DataBusFailureSource = FAILURE_SOURCE.TRANSPORT): void {
    const at = this.now();
    // Transport failures must land in *both* ledgers. lastFailure is the
    // unified record exposed by getHealthSummary(); lastError/lastErrorAt are
    // the transport-failure ledger behind getRecoveryStats().hasError and
    // ready()'s "surface the last failure" path. Recording only lastFailure
    // let a single health snapshot report a retained transport failure while
    // recovery claimed hasError: false / errorMessage: null.
    if (source === FAILURE_SOURCE.TRANSPORT) {
      this.lastError = error;
      this.lastErrorAt = at;
    }
    this.lastFailure = {
      source,
      message: describeFailure(error),
      at
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
  }

  private notifyError(error: unknown): void {
    this.invokeHandlers(this.errorHandlers, handler => handler(error), INVOKE_LABEL.ERROR_HANDLER);
  }

  private reportError(error: unknown, source: DataBusFailureSource = FAILURE_SOURCE.TRANSPORT): void {
    this.recordError(error, source);
    this.notifyError(error);
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

  /** Emit the coordination trace snapshot from the current cluster state.
   * Called once per successful `start()`: `reopenTransport()`'s settle arms do not
   * emit, so a recovery produces no second snapshot. It runs after the opening
   * resolves — and not because a pre-open read would see no routes, which is the
   * wrong mechanism and was the shipped claim until it was measured: a snapshot
   * taken with the opening still unresolved already listed the route, its
   * confirmation and both tabs' worker records, because
   * `BatchingStorageWriter` serves pending writes on read — `getItem` returns the
   * pending value before touching the store, and the private `keys()` union of
   * persisted keys, pending writes minus pending deletes is what `readAllByPrefix`
   * walks. */
  private emitCoordinationTrace(): void {
    const snapshot = this.cluster.getSnapshot();
    this.trace.event({
      type: TRACE_EVENT_TYPE.COORDINATION,
      coordinated: snapshot.coordinated,
      activeWorkers: snapshot.workers.filter(worker => worker.role === WORKER_ROLE.ACTIVE).length,
      workers: snapshot.workers.map(formatWorkerTrace),
      routes: snapshot.routes.map(formatRouteTrace)
    });
  }

  /** Ask the transport to subscribe to a topic (idempotent). */
  private subscribeTransport(topic: string): boolean {
    if (this.transportSubscribedTopics.has(topic)) return false;
    this.transportSubscribedTopics.add(topic);
    // The guard is what makes a deferred subscribe cancelable: the set is the
    // desired state, and the release path can reach the transport immediately
    // while this call is still parked behind an opening. Without it the parked
    // subscribe flushes *after* its own unsubscribe and the connection keeps a
    // channel nothing owns.
    this.runTransport(
      () => this.transport.subscribe(topic),
      () => this.transportSubscribedTopics.has(topic)
    );
    return true;
  }

  private unsubscribeTransport(topic: string): boolean {
    if (!this.transportSubscribedTopics.delete(topic)) return false;
    // The same guard in the other direction, with a narrower measured cost: in
    // the scenarios where it fires the release and the later subscribe defer
    // together, so the flush still ends on a SUBSCRIBE and no channel is
    // stranded. What dropping it costs is an UNSUBSCRIBE on the wire between two
    // SUBSCRIBEs for a channel that stays wanted — which a real transport answers
    // by tearing the subscription down and re-establishing it.
    this.runTransport(
      () => this.transport.unsubscribe(topic),
      () => !this.transportSubscribedTopics.has(topic)
    );
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

  /** Resume the resources paused by a pagehide suspension. Both the native
   * pageshow path and explicit start() must run this so an explicit resume
   * cannot leave trace metrics and periodic cleanup timers permanently off. */
  private resumeSuspendedResources(): boolean {
    const lifecycleEpoch = this.lifecycleEpoch;
    this.trace.start();
    this.trace.event({ type: TRACE_EVENT_TYPE.LIFECYCLE, action: TRACE_LIFECYCLE_ACTION.RESUME });
    if (lifecycleEpoch !== this.lifecycleEpoch || this.stopping) return false;
    this.startDedupSweep();
    this.replayManager.start();
    return lifecycleEpoch === this.lifecycleEpoch && !this.stopping;
  }

  /**
   * Suspend the transport when the tab goes hidden. Stops the transport and
   * clears subscription state so it will be re-established on resume.
   */
  private suspendTransport(): void {
    if (this.stopping) return;
    const suspensionEpoch = ++this.lifecycleEpoch;
    this.suspended = true;
    this.cancelScheduledRecovery(true);
    this.transportReady = false;
    this.transportSubscribedTopics.clear();
    this.updateStatus(WORKER_STATUS.DISCONNECTED);
    // Status handlers run synchronously and may call start(), stop(), or
    // trigger another suspend. If that happened, the newer lifecycle owns the
    // transport; do not let this stale hide continuation stop it after a
    // replacement opening completes.
    if (suspensionEpoch !== this.lifecycleEpoch || this.stopping || !this.suspended) return;
    // Repeated hide/show rounds can leave a resume opening queued behind an
    // older stop gate. If this suspend is already represented by that gate,
    // reuse it. Otherwise the current startPromise is a newer opening (which
    // may already have called transport.start), so chain a fresh idempotent
    // stop after it. This restores the invariant that startPromise and
    // pendingStop are the same promise while suspended; without it a later
    // pageShow reuses the now-superseded opening and the bus stays hidden.
    if (this.pendingStop && (this.startPromise === null || this.startPromise === this.pendingStop)) {
      // A failed open may already own the stop cleanup; reuse it instead of
      // issuing a redundant idempotent stop. Restore the suspended invariant
      // so a later pageshow/start chains its reopen behind this same gate.
      this.startPromise = this.pendingStop;
      return;
    }
    // Chain the stop after any in-flight start so an async open settles first.
    const pending = this.startPromise ?? this.pendingStop ?? Promise.resolve();
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
    // The two disjuncts have different standings, and neither has ever fired
    // (0 of 5041 calls in the coverage run), so they are recorded rather than
    // assumed. `stopping` is redundant by construction: every caller re-checks it
    // or cancels the path first — resumeSuspendedResources() on both arms,
    // startDemandRecovery()'s status gate, runTransport()'s demand reopen, and
    // beginStop(), which cancels the recovery timer synchronously.
    // `activeConfig === undefined` is the one that is *not* re-checked anywhere: it
    // is the only thing between a future caller and `transport.start(undefined)`.
    // It is kept because that is a different kind of leg from the absorb below —
    // dropping that one would re-route a report, dropping this would hand a nonsense
    // config to the transport. Do not "cover" it by
    // driving a pageshow after a stop: cluster.stop() removes the visibility
    // listener (and bumps lifecycleGeneration), so the resume path is already gone
    // before this check matters — verified by mutation, which survived a full suite
    // that way.
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
    const lifecycleEpoch = ++this.lifecycleEpoch;
    const pending = this.startPromise ?? this.pendingStop ?? Promise.resolve();
    // This absorb has never run — `pending` resolving is provable, not merely
    // observed: the `startPromise !== this.pendingStop` guard above already returned
    // for any in-flight opening that is not also the stop gate, so `pending` is
    // `pendingStop` or a fresh resolved promise, and `pendingStop` has two non-null
    // assignments (`createStopPromise()` and `suspendTransport()`'s `stopping`), each
    // chain ending in a terminal `.catch(error => this.reportError(error))` that
    // resolves for any rejection reason, because reportError's only coercion goes
    // through `describeFailure()`, which is total. The one escape is the double
    // failure `stop()`'s `stopPromise` comment documents and
    // `tests/data-bus.test.ts`'s "settles stop() when the teardown failure cannot be
    // reported either" pins: a throwing error subscriber plus a throwing
    // `console.warn`.
    //
    // It is kept anyway, which is a different verdict from 0.21.2 and 0.21.3's two
    // deletions, and the reason is the shape of the failure rather than its
    // likelihood, measured four ways on `tests/data-bus.test.ts`. Deleting the absorb
    // alone: 194/194 green, so no ordinary run notices it. Making `pending` reject at
    // this seam for every reopen in the file, absorb intact: also 194/194, so nothing
    // even observes the violation this block's premise says cannot happen. The same
    // forcing with the absorb deleted: 51 of 194 fail. And the forcing's extra
    // `.then` link alone, rejection absent: 194/194, which is what makes the 51 the
    // rejection rather than the added link. A note here previously read "fails exactly
    // one test whether this line is present or deleted"; that reproduces under none of
    // the four, and the corrected set argues the same way more strongly — no assertion
    // protects the premise, and deleting the guard is not one diagnosable failure but
    // the file going down with it. The outcomes are also asymmetric: with the absorb
    // the reopen still proceeds, without it the `.then()` below is skipped and the bus
    // silently stays closed after a pageshow. A guard whose deletion converts
    // "degraded" into "stuck" is worth its one uncovered function; `performStop()`'s
    // deleted twin sat inside a `try`, where the rejection was already caught.
    const opening = pending
      .catch(() => undefined)
      .then(() => this.openTransport(config, Promise.resolve(), false, lifecycleEpoch));
    this.startPromise = opening;
    this.started = true;
    this.suspended = false;
    // Clear readiness before the synchronous CONNECTING notification. The old
    // transport is already down, but transportReady is intentionally retained
    // through a runtime error/disconnect so ready() can keep tracking that
    // installed instance. Without clearing it here, a second operation issued
    // before openTransport() runs sees CONNECTING instead of DISCONNECTED and
    // is written directly to the dead transport, bypassing the opening gate.
    this.transportReady = false;
    // Install the new lifecycle before publishing CONNECTING: a status handler
    // can synchronously call stop(), and stop() must see and await this opening
    // instead of tearing down while reopenTransport() later installs a fresh
    // transport. openTransport()'s epoch guard then abandons the superseded
    // opening before transport.start() is reached.
    this.updateStatus(WORKER_STATUS.CONNECTING);
    if (lifecycleEpoch !== this.lifecycleEpoch || this.stopping || this.suspended) {
      // The only handler this opening ever gets. `resumeTransport()` calls here with
      // `void`, and the `opening.then(f, g)` below is unreachable from this arm, so
      // without this line a rejected reopen — a superseded lifecycle whose transport
      // then failed to start — lands as an unhandled rejection. Unlike the absorb at
      // the top of this method, this one is not dominated by anything: it is the
      // handler.
      void opening.catch(() => undefined);
      return opening;
    }
    // Reset the gate on success too, so a later runtime failure can schedule a
    // fresh reopen instead of reusing this settled promise.
    void opening.then(
      () => {
        if (this.startPromise === opening) this.startPromise = null;
        if (lifecycleEpoch !== this.lifecycleEpoch) return;
        if (traceAttempt !== undefined) {
          this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, operation: RELIABILITY_OPERATION.TRANSPORT_RECOVERY, attempt: traceAttempt, outcome: RECOVERY_OUTCOME.SUCCEEDED });
          this.recoveryAttempt = 0;
          this.recoveryExhausted = false;
        }
      },
      () => {
        if (this.startPromise === opening) this.startPromise = null;
        // Load-bearing, and pinned: a failing reopen publishes ERROR from its own
        // teardown before this rejection settles, so an application that retries
        // from that callback already owns a newer lifecycle here. Reporting
        // `failed` past that point puts a recovery failure *after* the start that
        // replaced it, which no reader of the trace can reinterpret.
        if (lifecycleEpoch !== this.lifecycleEpoch) return;
        if (traceAttempt !== undefined) {
          this.trace.event({ type: TRACE_EVENT_TYPE.RELIABILITY, operation: RELIABILITY_OPERATION.TRANSPORT_RECOVERY, attempt: traceAttempt, outcome: RECOVERY_OUTCOME.FAILED });
        }
      }
    );
    // Deliberately no trailing `void opening.catch(() => undefined)` here. The
    // `then(f, g)` two lines up passes an onRejected handler, which registers
    // *that* as a handler of `opening` — so `opening` can never surface as an
    // unhandled rejection on this path, whatever it rejects with, and a second
    // swallow would only add a permanently uncovered function. That is a property
    // of Promise semantics rather than of any assignment enumeration, which is why
    // this one could be deleted and the one at the top of the method could not.
    return opening;
  }

  /**
   * Run a transport operation now if the transport is ready, otherwise queue
   * it behind the start promise. This ensures subscribe/unsubscribe calls made
   * during startup are not lost.
   *
   * `stillWanted` expresses the deferred work as the *current* desired state
   * rather than a captured call, and is checked at each place that resumes on a
   * later task — the recovery gate and the opening flush. The immediate branch
   * carries no check because every path into it evaluates the desired state in
   * the same task: a caller that just mutated `transportSubscribedTopics`, or
   * the gate re-entry one line above.
   */
  private runTransport(operation: () => void | Promise<void>, stillWanted?: () => boolean): void {
    // A hidden tab's transport is intentionally stopped; subscriptions are
    // re-established by the cluster on resume, and publications must not be
    // sent to a stopped transport.
    if (this.suspended) return;
    // Automatic recovery is scheduled but has not run yet. Hold the operation
    // until that attempt settles instead of writing it to the connection that
    // just reported `error`.
    if (this.recoveryGate && !this.stopping) {
      const gate = this.recoveryGate;
      const cancellationToken = this.recoveryCancellationToken;
      // A failed automatic attempt leaves the gate closed but enables explicit
      // demand recovery. The first transport operation starts that reopen once;
      // every waiter remains queued behind the gate and runs after success.
      this.startDemandRecovery();
      this.recoveryWaiters += 1;
      void gate.then(() => {
        this.recoveryWaiters -= 1;
        if (
          this.stopping ||
          this.suspended ||
          cancellationToken !== this.recoveryCancellationToken
        ) return;
        if (stillWanted && !stillWanted()) return;
        this.runTransport(operation, stillWanted);
      });
      return;
    }
    // `transportReady` is intentionally retained through a runtime error so
    // ready() keeps tracking the installed transport. Operations, however,
    // must not be written to a connection that is gone. `error` always falls
    // through to recovery, and a clean `disconnected` *after* the transport
    // actually reached `connected` means the working connection dropped (a
    // WebSocket `close`); both fall through to the demand-driven reopen below
    // so the operation is flushed against the replacement instead of being
    // handed to a closed socket that can only report a dropped frame. A
    // transport that resolved start() before reporting its first `connected`
    // (worker-style backends report the connection asynchronously) keeps the
    // previous behaviour: its `disconnected` status is "not connected yet".
    const droppedAfterConnect =
      this.transportHasConnected && this.status === WORKER_STATUS.DISCONNECTED;
    if (this.transportReady && this.status !== WORKER_STATUS.ERROR && !droppedAfterConnect && !this.stopping) {
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
      .then(
        () => {
          if (!this.started || this.stopping || this.suspended) return;
          if (stillWanted && !stillWanted()) return;
          return operation();
        },
        // The opening promise reports its own lifecycle failure through
        // openTransport(). Swallowing it here prevents a stale startup
        // rejection from being recorded again after an onStatus/onError
        // callback has already started and reset the ledger for a retry.
        () => undefined
      )
      .catch(error => this.reportError(error));
  }

  /**
   * Publications started after teardown begins cannot reach any transport.
   * Surface that as a normal asynchronous API failure instead of letting
   * runTransport() return silently. Empty publishBatch() calls remain a no-op
   * and are filtered by the caller before this check.
   */
  private rejectPublishDuringStop(operation: 'publish' | 'publishBatch'): boolean {
    if (!this.stopping) return false;
    this.reportError(new Error(
      `CrossTabDataBus is stopping; ${operation}() was not sent. ` +
      'Wait for stop() to resolve, then call start() before publishing again.'
    ));
    return true;
  }

  /**
   * Ensure the DataBus is started, throwing if no initialConfig was provided.
   * subscribe/publish/ready call this *unconditionally*: the gate is the
   * `hasInitialConfig` check below, not the `autoStart` option. `autoStart`
   * participates in exactly one place, the constructor's
   * `if (autoStart ?? this.hasInitialConfig)`, where it overrides the default rather
   * than enabling a later path — so `autoStart: true` with no `initialConfig` throws
   * from the constructor. `docs/configuration.md`'s "`true` when `initialConfig` is
   * provided" row describes that single site.
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
