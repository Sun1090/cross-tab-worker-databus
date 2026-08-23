/**
 * CrossTabDataBus — the primary public API for cross-tab data distribution.
 *
 * Wraps WorkerClusterRuntime for cluster coordination and a DataBusTransport
 * for the real connection. Handles local handler reference counting, subscription
 * queuing, message dispatch, and clean lifecycle management (start/stop/BFCache).
 */
import { WorkerClusterRuntime } from './cluster';
import type { WorkerClusterOptions } from './cluster';
import type {
  DataBusErrorHandler,
  DataBusMessage,
  DataBusMessageHandler,
  DataBusStatusHandler,
  DataBusTransport,
  WorkerStatus
} from './types';
import { DataBusTraceReporter } from './trace';
import type { DataBusTraceOptions } from './trace';

/**
 * Event type used to broadcast topic publications across tabs via the cluster.
 * The cluster's `onEvent` handler filters on this to distinguish databus
 * publications from other control-plane events.
 */
const PUBLICATION_EVENT = 'DATABUS_PUBLICATION';

export interface CrossTabDataBusOptions<TConfig, TData>
  extends Omit<WorkerClusterOptions, 'handlers'> {
  transport: DataBusTransport<TConfig, TData>;
  initialConfig?: TConfig;
  autoStart?: boolean;
  trace?: DataBusTraceOptions;
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
  private readonly initialConfig: TConfig | undefined;
  private readonly hasInitialConfig: boolean;
  private readonly trace: DataBusTraceReporter;
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
  // True while the tab is hidden so an in-flight transport start does not mark
  // the transport ready after suspendTransport() has stopped it.
  private suspended = false;
  // Single gate for async transport.stop() cleanup, shared by failed opens and
  // page-hide suspension. Kept separate from startPromise so ready() still
  // surfaces a failure while later opens and automatic recovery wait for the
  // stop to settle.
  private pendingStop: Promise<void> | null = null;
  // Minimum interval in ms between automatic recovery attempts.
  private static readonly RECOVERY_COOLDOWN_MS = 1000;

  constructor(options: CrossTabDataBusOptions<TConfig, TData>) {
    const { autoStart, initialConfig, trace, transport, ...clusterOptions } = options;
    this.transport = transport;
    this.initialConfig = initialConfig;
    this.hasInitialConfig = 'initialConfig' in options;
    this.trace = new DataBusTraceReporter(trace);
    this.cluster = new WorkerClusterRuntime({
      ...clusterOptions,
      handlers: {
        // The cluster calls `onControl` when it receives a SUBSCRIBE/UNSUBSCRIBE/PUBLISH
        // control message — meaning the owning Worker has delegated the action to us.
        onControl: (action, topic, data) => {
          if (action === 'SUBSCRIBE') {
            if (this.subscribeTransport(topic)) this.traceSubscription('subscribe', topic);
          }
          if (action === 'UNSUBSCRIBE') {
            if (this.unsubscribeTransport(topic)) this.traceSubscription('unsubscribe', topic);
          }
          if (action === 'PUBLISH') this.runTransport(() => this.transport.publish(topic, data));
        },
        // The cluster calls `onEvent` when a publication broadcast arrives from
        // another tab. Dispatch locally if we have subscribers.
        onEvent: (eventType, payload) => {
          if (eventType !== PUBLICATION_EVENT) return;
          const message = payload as DataBusMessage<TData>;
          if (this.cluster.hasLocalSubscriber(message.topic)) this.dispatch(message);
        },
        onSuspend: () => {
          if (!this.stopping) this.trace.event({ type: 'lifecycle', action: 'suspend' });
          this.trace.pause();
          this.suspendTransport();
        },
        onResume: () => {
          this.trace.event({ type: 'lifecycle', action: 'resume' });
          this.trace.start();
          this.resumeTransport();
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
    for (const topic of this.topicHandlers.keys()) {
      this.cluster.subscribe(topic);
    }
    const snapshot = this.cluster.getSnapshot();
    this.trace.event({
      type: 'coordination',
      coordinated: snapshot.coordinated,
      activeWorkers: snapshot.workers.filter(worker => worker.role === 'active').length,
      workers: snapshot.workers.map(w => `${w.workerId}|${w.status}|load=${w.load}|tab=${w.tabId}`),
      routes: snapshot.routes.map(r => `${r.topicKey}@${r.workerId}|confirmed=${r.confirmedAt !== undefined}`)
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
          this.pendingStop = Promise.resolve()
            .then(() => this.transport.stop())
            .catch(stopError => this.reportError(stopError));
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
  subscribe(topic: string, handler: DataBusMessageHandler<TData>): () => void {
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
    return () => this.unsubscribe(topic, handler);
  }

  /** Remove a specific handler, or all handlers for `topic`. */
  unsubscribe(topic: string, handler?: DataBusMessageHandler<TData>): void {
    const handlers = this.topicHandlers.get(topic);
    if (!handlers) return;
    if (handler) handlers.delete(handler);
    else handlers.clear();
    if (handlers.size > 0) return;
    this.topicHandlers.delete(topic);
    this.cluster.unsubscribe(topic);
  }

  /** Publish a message to `topic`. The owning Worker delivers it to the transport. */
  publish(topic: string, data: unknown): void {
    this.ensureStarted();
    if (!this.cluster.publish(topic, data)) {
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

  /** Snapshot of the cluster state (workers, routes, assignments). */
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
    this.trace.event({ type: 'lifecycle', action: 'stop' });
    this.trace.stop();
    this.topicHandlers.clear();
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

  /** Deliver a message to every local handler registered for its topic. */
  private dispatch(message: DataBusMessage<TData>): void {
    this.trace.recordDispatched(message.topic);
    for (const handler of this.topicHandlers.get(message.topic) ?? []) {
      try {
        handler(message);
      } catch (error) {
        this.reportError(error);
      }
    }
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
      const now = Date.now();
      if (now - this.lastRecoveryAt >= CrossTabDataBus.RECOVERY_COOLDOWN_MS) {
        this.lastRecoveryAt = now;
        setTimeout(() => {
          if (this.stopping || !this.started || this.suspended) return;
          // An explicit resume or subscribe already recovered the transport
          // (or is in flight), so this stale timer must not open it again.
          if (this.status !== 'error') return;
          void this.reopenTransport();
        }, CrossTabDataBus.RECOVERY_COOLDOWN_MS);
      }
    }
    for (const handler of this.statusHandlers) {
      try {
        handler(status);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  private reportError(error: unknown): void {
    this.trace.event({ type: 'error', source: 'transport' });
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch (handlerError) {
        // A failing error handler must not break the others or the call stack.
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[cross-tab-worker-databus] error handler threw:', handlerError);
        }
      }
    }
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
    // same pendingStop gate.
    if (this.pendingStop) return;
    const pending = this.startPromise ?? Promise.resolve();
    const stopping = pending
      .catch(() => undefined)
      .then(() => this.transport.stop())
      .catch(error => this.reportError(error));
    this.startPromise = stopping;
    this.pendingStop = stopping;
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
  private reopenTransport(): Promise<void> {
    if (this.stopping || this.activeConfig === undefined) return Promise.resolve();
    // A resume/recovery already has an opening in flight. Reuse it so a stale
    // recovery timer or a second caller cannot open a second transport. A
    // page-hide stop gate must not be reused as an opening, so the reopen
    // still chains after that stop below.
    if (this.startPromise && this.startPromise !== this.pendingStop) return this.startPromise;
    const config = this.activeConfig;
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
        if (this.startPromise === opening) this.startPromise = null;
      },
      () => undefined
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
