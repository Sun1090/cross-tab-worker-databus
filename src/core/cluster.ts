/**
 * WorkerClusterRuntime — cross-tab cluster coordination layer.
 *
 * Manages Worker registration, heartbeat, sticky topic-owner routing,
 * page-lifecycle handoff/resume, and BroadcastChannel-based
 * control messaging. Each DataBus instance owns one Runtime which drives the
 * transport and coordinates with other tabs via localStorage + BroadcastChannel.
 */
import { canUseStorage, createBrowserEnvironment, getOrCreateTabId } from './environment';
import type { ClusterChannel, ClusterEnvironment, StorageLike } from './environment';
import { createOpaqueKey } from './hash';
import {
  DEFAULT_MAX_ACTIVE_WORKERS,
  selectActiveWorkers,
  selectLeastLoadedWorker
} from './routing';
import type {
  TopicSubscriberRecord,
  WorkerClusterMessage,
  WorkerControlAction,
  WorkerRecord,
  WorkerRoute,
  WorkerStatus
} from './types';
import { BatchingStorageWriter } from './storage-batch';

/** Callbacks the cluster invokes to drive the transport and lifecycle. */
export interface WorkerClusterHandlers {
  /** A SUBSCRIBE/UNSUBSCRIBE/PUBLISH control action was received for this worker. */
  onControl: (action: WorkerControlAction, topic: string, data?: unknown) => void;
  /** A fan-out publication event was received from another Worker. */
  onEvent: (eventType: string, payload: unknown, sourceWorkerId: string) => void;
  /** The cluster suspended (tab hidden / pagehide). */
  onSuspend?: () => void;
  /** The cluster resumed (tab visible / pageshow). */
  onResume?: () => void;
}

export interface WorkerClusterOptions {
  /** Namespace for the cluster's storage keys and BroadcastChannel. */
  clusterKey: string;
  handlers: WorkerClusterHandlers;
  environment?: ClusterEnvironment;
  storagePrefix?: string;
  tabId?: string;
  workerId?: string;
  maxActiveWorkers?: number;
  heartbeatIntervalMs?: number;
  workerTtlMs?: number;
}

/** Read-only snapshot of the cluster state for diagnostics and tracing. */
export interface WorkerClusterSnapshot {
  coordinated: boolean;
  suspended: boolean;
  currentWorker: WorkerRecord;
  workers: WorkerRecord[];
  /** Routes with the plaintext topic injected from the in-memory knownTopics cache. */
  routes: Array<WorkerRoute & { topic: string | null }>;
  subscribedTopics: string[];
  assignedTopics: string[];
  /** Opaque key → plaintext topic mapping for debugging. */
  knownTopics: Array<{ topicKey: string; topic: string }>;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 3_000;
const DEFAULT_WORKER_TTL_MS = 10_000;
const DEFAULT_STORAGE_PREFIX = 'cross-tab-worker-databus';
// Upper bound on the topicKey → topic reverse cache. Control messages from
// other workers can reference arbitrary topics, so cap growth to avoid an
// unbounded memory leak from a misbehaving or malicious peer.
const MAX_KNOWN_TOPICS = 500;

/** Parse a JSON value from storage, returning null on malformed or missing data. */
function readJson<T>(storage: StorageLike, key: string): T | null {
  try {
    const value = storage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

/** Write a JSON value to storage, swallowing storage errors (coordination is best-effort). */
function writeJson(storage: StorageLike, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Coordination is best-effort. The local transport remains usable.
  }
}

/** List all storage keys that start with `prefix`. */
function listKeys(storage: StorageLike, prefix: string): string[] {
  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => Boolean(key?.startsWith(prefix))
    );
  } catch {
    return [];
  }
}

/**
 * Cross-tab worker coordination runtime.
 *
 * Manages a cluster of Workers (one per tab) that share topics via localStorage
 * and BroadcastChannel. Each Worker publishes its own record, subscribes to
 * topics, and routes publications through the owning Worker to avoid duplicates.
 *
 * Key responsibilities:
 * - Heartbeat-based failure detection (stale workers pruned after `workerTtlMs`)
 * - Topic-to-Worker routing with load-based rebalancing
 * - Page lifecycle integration (suspend on hide, resume on show)
 * - Storage-backed coordination with BatchingStorageWriter for write coalescing
 */
export class WorkerClusterRuntime {
  readonly tabId: string;
  readonly workerId: string;

  private readonly environment: ClusterEnvironment;
  private readonly handlers: WorkerClusterHandlers;
  private storage: StorageLike | null;
  private readonly maxActiveWorkers: number;
  private readonly heartbeatIntervalMs: number;
  private readonly workerTtlMs: number;
  private readonly workerPrefix: string;
  private readonly routePrefix: string;
  private readonly subscriberPrefix: string;
  private readonly channelName: string;
  // Topics this tab has subscribed to (local interest, plaintext).
  private readonly subscribedTopics = new Set<string>();
  // Topics assigned to this Worker as owner (topicKey → topic). Authoritative:
  // membership drives isAssigned() and load. Grows only via CONTROL/SUBSCRIBE
  // (or local self-subscribe), never via the reverse cache.
  private readonly assignedTopics = new Map<string, string>();
  // Reverse mapping: opaque topicKey → plaintext topic. A bounded cache with
  // FIFO eviction — NOT authoritative. It can hold a topicKey that is also in
  // assignedTopics (the owned guard prevents evicting those), because it is
  // the only source of plaintext when storage is unavailable. See the
  // rememberTopic() doc for the eviction contract.
  private readonly knownTopics = new Map<string, string>();
  private channel: ClusterChannel | null = null;
  private heartbeatHandle: unknown = null;
  private started = false;
  private suspended = false;
  private lifecycleListening = false;
  private currentRecord: WorkerRecord;

  constructor(options: WorkerClusterOptions) {
    this.environment = options.environment ?? createBrowserEnvironment();
    this.handlers = options.handlers;
    this.maxActiveWorkers = options.maxActiveWorkers ?? DEFAULT_MAX_ACTIVE_WORKERS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.workerTtlMs = options.workerTtlMs ?? DEFAULT_WORKER_TTL_MS;
    // Derive storage keys from a hash of the cluster key so that the plaintext
    // cluster identifier never appears in localStorage.
    const clusterHash = createOpaqueKey(options.clusterKey || '__default__');
    const prefix = options.storagePrefix ?? DEFAULT_STORAGE_PREFIX;
    const baseKey = `${prefix}:${clusterHash}`;
    this.workerPrefix = `${baseKey}:worker:`;
    this.routePrefix = `${baseKey}:route:`;
    this.subscriberPrefix = `${baseKey}:subscriber:`;
    this.channelName = `${prefix}:bus:${clusterHash}`;
    // Wrap localStorage in a BatchingStorageWriter to coalesce writes.
    this.storage = canUseStorage(this.environment.storage, `${baseKey}:probe`)
      ? new BatchingStorageWriter(this.environment.storage)
      : null;
    this.tabId = options.tabId ?? getOrCreateTabId(this.environment, `${prefix}:tab-id`);
    this.workerId = options.workerId ?? `worker-${this.tabId}-${this.environment.randomId()}`;
    const now = this.environment.now();
    this.currentRecord = {
      workerId: this.workerId,
      tabId: this.tabId,
      load: 0,
      role: 'standby',
      status: 'connecting',
      visibilityState: this.environment.getVisibilityState(),
      heartbeatAt: now,
      registeredAt: now
    };
  }

  /** Start the cluster: register, listen for lifecycle events, and begin heartbeats. */
  start(): void {
    if (this.started) return;
    this.suspended = false;
    this.addLifecycleListeners();
    this.activate();
  }

  /**
   * Stop the cluster: pause heartbeats, hand off assigned topics, remove
   * the worker record, and clean up lifecycle listeners. Idempotent.
   */
  stop(): void {
    if (!this.started && !this.suspended) return;
    this.pause();
    this.flushStorage();
    this.removeLifecycleListeners();
    this.subscribedTopics.clear();
    this.assignedTopics.clear();
    this.knownTopics.clear();
    this.suspended = false;
  }

  /**
   * Activate the cluster: open the BroadcastChannel, register the worker record,
   * subscribe to topics, and start the heartbeat interval.
   */
  private activate(): void {
    if (this.started) return;
    this.started = true;
    // Create the BroadcastChannel for cross-tab messaging. If storage is
    // unavailable, we cannot coordinate — skip the channel.
    this.channel = this.storage ? this.environment.createChannel(this.channelName) : null;
    if (!this.channel) this.storage = null;
    this.channel?.addEventListener('message', this.handleMessage);
    const now = this.environment.now();
    this.currentRecord = {
      ...this.currentRecord,
      heartbeatAt: now,
      registeredAt: now,
      visibilityState: this.environment.getVisibilityState()
    };
    this.refreshRole(this.readWorkers());
    this.writeRecord(true);
    // Re-subscribe any topics that were subscribed before the cluster started.
    if (!this.storage) {
      for (const topic of this.subscribedTopics) {
        this.sendControl(this.workerId, 'SUBSCRIBE', topic, this.rememberTopic(topic));
      }
    } else {
      for (const topic of this.subscribedTopics) this.writeSubscriber(this.rememberTopic(topic));
    }
    this.reconcile();
    // Periodic heartbeat + reconciliation.
    this.heartbeatHandle = this.environment.setInterval(() => {
      this.writeRecord(false);
      this.reconcile();
    }, this.heartbeatIntervalMs);
  }

  /**
   * Pause the cluster on pagehide: stop heartbeats, hand off assigned topics
   * to other workers, remove our worker record, and close the channel.
   */
  private pause(): void {
    if (!this.started) return;
    this.started = false;
    this.suspended = true;
    if (this.heartbeatHandle !== null) this.environment.clearInterval(this.heartbeatHandle);
    this.heartbeatHandle = null;
    this.channel?.removeEventListener('message', this.handleMessage);
    // Order matters: release local subscriptions BEFORE handing off assigned
    // topics, then clear the assignment map. Releasing first removes the
    // subscriber records so handoff sees the correct remaining subscribers;
    // clearing after handoff ensures no topic is both handed off and left
    // dangling. Do not reorder without addressing the handoff semantics.
    for (const topic of this.subscribedTopics) this.releaseSubscription(topic, false);
    this.handoffAssignedTopics();
    this.assignedTopics.clear();
    this.removeStorage(this.workerStorageKey(this.workerId));
    // Persist the final routes and worker removal before asking peers to
    // reconcile. A pagehide CONTROL message may be lost; REGISTRY must still
    // let peers observe the completed handoff immediately.
    this.flushStorage();
    this.notifyRegistry();
    this.channel?.close();
    this.channel = null;
    this.handlers.onSuspend?.();
  }

  /** Update the worker's connection status and persist the change. */
  setStatus(status: WorkerStatus): void {
    if (this.currentRecord.status === status) return;
    this.currentRecord = { ...this.currentRecord, status };
    if (this.started) this.writeRecord(true);
  }

  /**
   * Subscribe to a topic. Returns true if this worker becomes the assigned owner.
   * The topic is recorded locally and the cluster is notified via storage or
   * direct control message.
   */
  subscribe(topic: string): boolean {
    const topicKey = this.rememberTopic(topic);
    this.subscribedTopics.add(topic);
    if (!this.started) return false;
    if (!this.storage) {
      this.sendControl(this.workerId, 'SUBSCRIBE', topic, topicKey);
      return true;
    }
    this.writeSubscriber(topicKey);
    const workers = this.readWorkers();
    const existingRoute = this.readRoute(topicKey);
    if (existingRoute && workers.some(worker => worker.workerId === existingRoute.workerId)) {
      return existingRoute.workerId === this.workerId;
    }

    const activeWorkers = selectActiveWorkers(workers, this.maxActiveWorkers);
    const owner = selectLeastLoadedWorker(activeWorkers) ?? this.currentRecord;
    // A missing live owner cannot participate in a strict handoff. Assign and
    // subscribe immediately; pagehide uses handoffAssignedTopics() while the
    // old owner is still present when release ordering is required.
    this.writeRoute(topicKey, owner, undefined, (existingRoute?.generation ?? 0) + 1);
    this.sendControl(owner.workerId, 'SUBSCRIBE', topic, topicKey);
    this.notifyRegistry();
    return owner.workerId === this.workerId;
  }

  /**
   * Remove the local subscription. Cleans up the subscriber record and, if no
   * subscribers remain, deletes the route so the owning Worker can unsubscribe.
   */
  unsubscribe(topic: string): void {
    const topicKey = this.rememberTopic(topic);
    this.subscribedTopics.delete(topic);
    this.releaseSubscription(topic);
    // Keep the topic in knownTopics if we remain the owner (we may still fan out).
    if (!this.assignedTopics.has(topicKey)) this.knownTopics.delete(topicKey);
  }

  /** Remove this tab's subscriber record and, when it was the last one, delete the route. */
  private releaseSubscription(topic: string, notifyOwner = true): void {
    const topicKey = this.rememberTopic(topic);
    this.removeStorage(this.subscriberStorageKey(topicKey, this.tabId));
    const route = this.readRoute(topicKey);
    if (!route) return;
    const subscribers = this.readSubscriberTabIds(topicKey, this.readWorkers());
    if (subscribers.length === 0) {
      this.removeStorage(this.routeStorageKey(topicKey));
      if (notifyOwner) this.sendControl(route.workerId, 'UNSUBSCRIBE', topic, topicKey);
    }
  }

  /** Transfer assigned topics to other active workers so subscribers are not orphaned during pause. */
  private handoffAssignedTopics(): void {
    if (!this.storage || this.assignedTopics.size === 0) return;
    const remainingWorkers = this.readWorkers().filter(worker => worker.workerId !== this.workerId);
    const activeWorkers = selectActiveWorkers(remainingWorkers, this.maxActiveWorkers);
    // `WorkerRecord.load` is a snapshot from before this handoff. Keep a
    // projected load locally so a batch of topics is distributed across the
    // remaining workers instead of every route choosing the same initial
    // minimum.
    const projectedLoads = new Map(activeWorkers.map(worker => [worker.workerId, worker.load]));

    for (const [topicKey, topic] of this.assignedTopics) {
      if (this.readRoute(topicKey)?.workerId !== this.workerId) continue;
      const subscribers = this.readSubscriberTabIds(topicKey, remainingWorkers);
      if (subscribers.length === 0) {
        this.removeStorage(this.routeStorageKey(topicKey));
        continue;
      }
      const owner = selectLeastLoadedWorker(
        activeWorkers.map(worker => ({ ...worker, load: projectedLoads.get(worker.workerId) ?? worker.load }))
      );
      if (!owner) continue;
      projectedLoads.set(owner.workerId, (projectedLoads.get(owner.workerId) ?? owner.load) + 1);
      const previous = this.readRoute(topicKey);
      this.writeRoute(topicKey, owner, previous?.workerId, (previous?.generation ?? 0) + 1);
      // Make the new route visible before the target confirms it. This also
      // leaves a durable unconfirmed assignment when unload drops CONTROL.
      this.flushStorage();
      const generation = (previous?.generation ?? 0) + 1;
      // Release the old server subscription before authorizing the new owner.
      // The ACK is sent after the transport operation has been requested.
      this.handlers.onControl('UNSUBSCRIBE', topic);
      this.send({
        type: 'ROUTE_RELEASED',
        sourceWorkerId: this.workerId,
        targetWorkerId: owner.workerId,
        topic,
        topicKey,
        generation
      });
    }
  }

  /**
   * Publish a message to `topic`, routing through the owning Worker (or self if
   * no owner is found). Returns false when the control message could not be
   * posted to a remote owner, so the caller can surface the failure instead of
   * silently dropping the publication.
   */
  publish(topic: string, data: unknown): boolean {
    const topicKey = this.rememberTopic(topic);
    const workers = this.readWorkers();
    const route = this.readRoute(topicKey);
    const target = route && workers.some(worker => worker.workerId === route.workerId)
      ? route.workerId
      : this.workerId;
    return this.sendControl(target ?? this.workerId, 'PUBLISH', topic, topicKey, data);
  }

  /** Broadcast an event to every tab — used to fan out transport publications. */
  broadcastEvent(eventType: string, payload: unknown): void {
    this.send({ type: 'EVENT', sourceWorkerId: this.workerId, eventType, payload });
  }

  isAssigned(topic: string): boolean {
    // Deliberately recompute the key via createOpaqueKey rather than
    // rememberTopic(): this is a read-only query, not a state change, so it
    // must not populate the knownTopics reverse-cache. Hashing is cheap enough
    // that re-deriving here is preferable to evicting a cached entry that the
    // storage-less readRoute path may need (see rememberTopic eviction guard).
    const topicKey = createOpaqueKey(topic);
    // Prefer the in-memory assignment map: it is updated synchronously on
    // SUBSCRIBE/UNSUBSCRIBE, whereas readRoute() may observe a route that has
    // not yet been flushed through the BatchingStorageWriter, causing a message
    // destined for this worker to be dropped during the write window.
    if (this.assignedTopics.has(topicKey)) return true;
    return this.readRoute(topicKey)?.workerId === this.workerId;
  }

  /** True if this worker is among the active set (eligible to own topics). */
  isActiveWorker(): boolean {
    return selectActiveWorkers(this.readWorkers(), this.maxActiveWorkers).some(
      worker => worker.workerId === this.workerId
    );
  }

  /** True when this tab has a local subscriber registered for `topic`. */
  hasLocalSubscriber(topic: string): boolean {
    return this.subscribedTopics.has(topic);
  }

  /** Read-only snapshot of the cluster state (workers, routes, assignments). */
  getSnapshot(): WorkerClusterSnapshot {
    const routes = listKeysSafe(this.storage, this.routePrefix)
      .map(key => (this.storage ? readJson<WorkerRoute>(this.storage, key) : null))
      .filter((route): route is WorkerRoute => Boolean(route))
      .map(route => ({
        ...route,
        topic: this.knownTopics.get(route.topicKey) ?? null
      }));
    return {
      coordinated: Boolean(this.storage && this.channel),
      suspended: this.suspended,
      currentWorker: { ...this.currentRecord },
      workers: this.readWorkers().map(worker => ({ ...worker })),
      routes,
      subscribedTopics: [...this.subscribedTopics],
      assignedTopics: [...this.assignedTopics.values()],
      knownTopics: [...this.knownTopics.entries()].map(([topicKey, topic]) => ({ topicKey, topic }))
    };
  }

  private readonly handlePageHide = () => this.pause();

  private readonly handlePageShow = () => {
    if (!this.suspended) return;
    this.suspended = false;
    this.handlers.onResume?.();
    this.activate();
  };

  private readonly handleVisibilityChange = () => {
    const visibilityState = this.environment.getVisibilityState();
    if (visibilityState === this.currentRecord.visibilityState) return;
    this.currentRecord = { ...this.currentRecord, visibilityState };
    if (this.started) {
      this.writeRecord(true);
      this.reconcile();
    }
  };

  private addLifecycleListeners(): void {
    if (this.lifecycleListening) return;
    this.lifecycleListening = true;
    this.environment.addPageHideListener(this.handlePageHide);
    this.environment.addPageShowListener(this.handlePageShow);
    this.environment.addVisibilityChangeListener(this.handleVisibilityChange);
  }

  private removeLifecycleListeners(): void {
    if (!this.lifecycleListening) return;
    this.lifecycleListening = false;
    this.environment.removePageHideListener(this.handlePageHide);
    this.environment.removePageShowListener(this.handlePageShow);
    this.environment.removeVisibilityChangeListener(this.handleVisibilityChange);
  }

  /** Handle an incoming cluster message: dispatch by type to the per-type handlers. */
  private readonly handleMessage = (event: MessageEvent<WorkerClusterMessage>) => {
    const message = event.data;
    if (!message || message.sourceWorkerId === this.workerId) return;
    if (message.type === 'CONTROL') return this.handleControlMessage(message);
    if (message.type === 'ROUTE_RELEASED') return this.handleRouteReleasedMessage(message);
    if (message.type === 'EVENT') {
      this.handlers.onEvent(message.eventType, message.payload, message.sourceWorkerId);
      return;
    }
    this.reconcile();
  };

  /** Handle a point-to-point CONTROL message (SUBSCRIBE / UNSUBSCRIBE / PUBLISH). */
  private handleControlMessage(
    message: Extract<WorkerClusterMessage, { type: 'CONTROL' }>
  ): void {
    if (message.targetWorkerId !== this.workerId) return;
    this.rememberTopic(message.topic);
    if (message.action === 'SUBSCRIBE') {
      this.assignedTopics.set(message.topicKey, message.topic);
      this.confirmRoute(message.topicKey);
    }
    if (message.action === 'UNSUBSCRIBE') {
      if (this.releaseHandoffOnUnsubscribe(message)) return;
    }
    this.handlers.onControl(message.action, message.topic, message.data);
    if (message.action !== 'PUBLISH') this.updateLoad();
  }

  /**
   * When this worker is the previous owner in a graceful handoff and the new
   * owner asks us to unsubscribe, release the old transport subscription and
   * ACK the handoff with ROUTE_RELEASED. Returns true when the message was a
   * handoff release (the generic CONTROL dispatch must not run as well).
   */
  private releaseHandoffOnUnsubscribe(
    message: Extract<WorkerClusterMessage, { type: 'CONTROL' }>
  ): boolean {
    this.assignedTopics.delete(message.topicKey);
    const route = this.readRoute(message.topicKey);
    if (route?.handoffFromWorkerId !== this.workerId) return false;
    this.handlers.onControl('UNSUBSCRIBE', message.topic, undefined);
    this.send({
      type: 'ROUTE_RELEASED',
      sourceWorkerId: this.workerId,
      targetWorkerId: route.workerId,
      topic: message.topic,
      topicKey: message.topicKey,
      generation: route.generation
    });
    this.updateLoad();
    return true;
  }

  /**
   * Accept a graceful handoff only when the route still points to this worker,
   * the release comes from the recorded previous owner, and the generation is
   * at least as new as ours. Any other ROUTE_RELEASED is stale and dropped.
   */
  private handleRouteReleasedMessage(
    message: Extract<WorkerClusterMessage, { type: 'ROUTE_RELEASED' }>
  ): void {
    if (message.targetWorkerId !== this.workerId) return;
    const route = this.readRoute(message.topicKey);
    if (
      !route ||
      route.workerId !== this.workerId ||
      route.handoffFromWorkerId !== message.sourceWorkerId ||
      route.generation < message.generation
    ) return;
    this.assignedTopics.set(message.topicKey, message.topic);
    this.confirmRoute(message.topicKey);
    this.handlers.onControl('SUBSCRIBE', message.topic, undefined);
    this.updateLoad();
  }

  /** Full reconciliation cycle: workers, subscriptions, and assigned topics. */
  private reconcile(): void {
    if (!this.started) return;
    const workers = this.reconcileWorkers();
    const activeWorkers = selectActiveWorkers(workers, this.maxActiveWorkers);
    this.reconcileSubscriptions(workers, activeWorkers);
    this.reconcileAssignedTopics();
    this.updateLoad();
  }

  /** Prune stale workers/subscribers/routes and refresh role. Returns the live worker list. */
  private reconcileWorkers(): WorkerRecord[] {
    const workers = this.readWorkers();
    this.cleanupOrphanedSubscribers(workers);
    this.cleanupOrphanedRoutes(workers);
    const roleChanged = this.refreshRole(workers);
    if (roleChanged) this.writeRecord(false);
    return workers;
  }

  /**
   * Ensure every local subscription has a route and write subscriber records.
   *
   * Existing routes are deliberately sticky while their owner Worker is alive.
   * Load and visibility only influence placement of a new route; they must not
   * move an already-subscribed Topic merely because another Tab joins or becomes
   * visible. Ownership changes only after the owner leaves or its heartbeat
   * expires, which avoids unnecessary transport subscribe/unsubscribe churn.
   */
  private reconcileSubscriptions(
    workers: readonly WorkerRecord[],
    activeWorkers: readonly WorkerRecord[]
  ): void {
    const liveWorkerIds = new Set(workers.map(worker => worker.workerId));

    for (const topic of this.subscribedTopics) {
      const topicKey = this.rememberTopic(topic);
      this.writeSubscriber(topicKey);
      const route = this.readRoute(topicKey);
      if (!route || !liveWorkerIds.has(route.workerId)) {
        const owner = selectLeastLoadedWorker(activeWorkers) ?? this.currentRecord;
        // A route invalidated by owner departure or heartbeat expiry is
        // recovered immediately. Graceful pagehide uses the strict ACK path in
        // handoffAssignedTopics(), where the departing owner is still known.
        this.writeRoute(topicKey, owner, undefined, (route?.generation ?? 0) + 1);
        this.sendControl(owner.workerId, 'SUBSCRIBE', topic, topicKey);
        this.notifyRegistry();
        continue;
      }
      if (route.confirmedAt === undefined) {
        // During a handoff, the new owner waits for ROUTE_RELEASED from the
        // previous owner. Retrying SUBSCRIBE here would recreate overlap.
        if (!route.handoffFromWorkerId) {
          this.sendControl(route.workerId, 'SUBSCRIBE', topic, topicKey);
        }
      }
    }
  }

  /** Drop assignments where the route no longer points to this worker. */
  private reconcileAssignedTopics(): void {
    for (const [topicKey, topic] of [...this.assignedTopics]) {
      if (this.readRoute(topicKey)?.workerId === this.workerId) continue;
      this.assignedTopics.delete(topicKey);
      this.handlers.onControl('UNSUBSCRIBE', topic, undefined);
      const route = this.readRoute(topicKey);
      if (route?.handoffFromWorkerId === this.workerId) {
        this.send({
          type: 'ROUTE_RELEASED',
          sourceWorkerId: this.workerId,
          targetWorkerId: route.workerId,
          topic,
          topicKey,
          generation: route.generation
        });
      }
      if (!this.subscribedTopics.has(topic)) this.knownTopics.delete(topicKey);
    }
  }

  /**
   * Send a control message to `targetWorkerId`, or execute locally when targeting self.
   * Local execution updates the assignment map and route synchronously, bypassing
   * the BroadcastChannel latency.
   */
  private sendControl(
    targetWorkerId: string,
    action: WorkerControlAction,
    topic: string,
    topicKey: string,
    data?: unknown
  ): boolean {
    if (targetWorkerId === this.workerId) {
      if (action === 'SUBSCRIBE') {
        this.assignedTopics.set(topicKey, topic);
        this.confirmRoute(topicKey);
      }
      if (action === 'UNSUBSCRIBE') this.assignedTopics.delete(topicKey);
      this.handlers.onControl(action, topic, data);
      if (action !== 'PUBLISH') this.updateLoad();
      return true;
    }
    return this.send({
      type: 'CONTROL',
      sourceWorkerId: this.workerId,
      targetWorkerId,
      action,
      topic,
      topicKey,
      ...(data === undefined ? {} : { data })
    });
  }

  /** Post a message on the BroadcastChannel. Returns false on postMessage failure. */
  private send(message: WorkerClusterMessage): boolean {
    if (!this.channel) return false;
    try {
      this.channel.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  /** Read all live worker records from storage, pruning stale entries past the TTL. */
  private readWorkers(): WorkerRecord[] {
    if (!this.storage) return [this.currentRecord];
    const now = this.environment.now();
    const workers: WorkerRecord[] = [];
    for (const key of listKeys(this.storage, this.workerPrefix)) {
      const worker = readJson<WorkerRecord>(this.storage, key);
      if (!worker) continue;
      if (worker.workerId !== this.workerId && now - worker.heartbeatAt > this.workerTtlMs) {
        this.removeStorage(key);
        continue;
      }
      workers.push(worker);
    }
    if (this.started && !workers.some(worker => worker.workerId === this.workerId)) workers.push(this.currentRecord);
    return workers;
  }

  /** Enumerate all tab IDs that have a subscriber record for `topicKey`. */
  private readSubscriberTabIds(topicKey: string, workers: readonly WorkerRecord[]): string[] {
    if (!this.storage) return this.subscribedTopics.has(this.knownTopics.get(topicKey) ?? '') ? [this.tabId] : [];
    const activeTabIds = new Set(workers.map(worker => worker.tabId));
    const subscribers = new Set<string>();
    for (const key of listKeys(this.storage, `${this.subscriberPrefix}${topicKey}:`)) {
      const record = readJson<TopicSubscriberRecord>(this.storage, key);
      if (!record || !activeTabIds.has(record.tabId)) {
        this.removeStorage(key);
        continue;
      }
      subscribers.add(record.tabId);
    }
    return [...subscribers];
  }

  /** Read the current route for `topicKey`, returning null when no storage layer exists. */
  private readRoute(topicKey: string): WorkerRoute | null {
    if (!this.storage) {
      const topic = this.knownTopics.get(topicKey);
      return topic && (this.subscribedTopics.has(topic) || this.assignedTopics.has(topicKey))
        ? {
            topicKey,
            workerId: this.workerId,
            tabId: this.tabId,
            updatedAt: this.environment.now(),
            generation: 1
          }
        : null;
    }
    return readJson<WorkerRoute>(this.storage, this.routeStorageKey(topicKey));
  }

  /** Persist a route assignment, mapping `topicKey` to the owning Worker. */
  private writeRoute(
    topicKey: string,
    owner: WorkerRecord,
    handoffFromWorkerId?: string,
    generation = 1
  ): void {
    if (!this.storage) return;
    writeJson(this.storage, this.routeStorageKey(topicKey), {
      topicKey,
      workerId: owner.workerId,
      tabId: owner.tabId,
      updatedAt: this.environment.now(),
      generation,
      ...(handoffFromWorkerId ? { handoffFromWorkerId } : {})
    } satisfies WorkerRoute);
  }

  /** Stamp a route as confirmed once the owning Worker has acknowledged the assignment. */
  private confirmRoute(topicKey: string): void {
    if (!this.storage) return;
    const route = this.readRoute(topicKey);
    if (!route || route.workerId !== this.workerId || route.confirmedAt !== undefined) return;
    writeJson(this.storage, this.routeStorageKey(topicKey), {
      ...route,
      confirmedAt: this.environment.now()
    } satisfies WorkerRoute);
  }

  /** Remove routes whose topic has no subscribers and whose TTL has expired. */
  private cleanupOrphanedRoutes(workers: readonly WorkerRecord[]): void {
    if (!this.storage) return;
    const now = this.environment.now();
    for (const key of listKeys(this.storage, this.routePrefix)) {
      const route = readJson<WorkerRoute>(this.storage, key);
      if (!route || now - route.updatedAt <= this.workerTtlMs) continue;
      if (this.readSubscriberTabIds(route.topicKey, workers).length > 0) continue;
      this.removeStorage(key);
    }
  }

  /** Remove subscriber records for tabs that are no longer active. */
  private cleanupOrphanedSubscribers(workers: readonly WorkerRecord[]): void {
    if (!this.storage) return;
    const activeTabIds = new Set(workers.map(worker => worker.tabId));
    for (const key of listKeys(this.storage, this.subscriberPrefix)) {
      const record = readJson<TopicSubscriberRecord>(this.storage, key);
      if (!record || !activeTabIds.has(record.tabId)) this.removeStorage(key);
    }
  }

  /** Persist a subscriber record for this tab on `topicKey`. */
  private writeSubscriber(topicKey: string): void {
    if (!this.storage) return;
    writeJson(this.storage, this.subscriberStorageKey(topicKey, this.tabId), {
      tabId: this.tabId,
      updatedAt: this.environment.now()
    } satisfies TopicSubscriberRecord);
  }

  /** Persist the current worker record with an updated heartbeat timestamp. */
  private writeRecord(notify: boolean): void {
    this.currentRecord = { ...this.currentRecord, heartbeatAt: this.environment.now() };
    if (this.storage) writeJson(this.storage, this.workerStorageKey(this.workerId), this.currentRecord);
    if (notify) this.notifyRegistry();
  }

  /** Broadcast a REGISTRY message to trigger reconciliation on other tabs. */
  private notifyRegistry(): void {
    this.send({ type: 'REGISTRY', sourceWorkerId: this.workerId });
  }

  /** Recompute whether this worker is active (eligible to own topics) or standby. Returns true when changed. */
  private refreshRole(workers: readonly WorkerRecord[]): boolean {
    const role = selectActiveWorkers(workers, this.maxActiveWorkers).some(worker => worker.workerId === this.workerId)
      ? 'active'
      : 'standby';
    if (role === this.currentRecord.role) return false;
    this.currentRecord = { ...this.currentRecord, role };
    return true;
  }

  /** Persist the current topic load count (number of assigned topics) for load-balanced routing. */
  private updateLoad(): void {
    const load = this.assignedTopics.size;
    if (load === this.currentRecord.load) return;
    this.currentRecord = { ...this.currentRecord, load };
    if (this.started) this.writeRecord(true);
  }

  /**
   * Hash `topic` into its opaque key and populate the reverse-lookup cache.
   *
   * Despite the name, this is NOT a cache lookup — it unconditionally writes
   * the `topicKey → topic` pair. Hashing is cheap enough that a caller needing
   * the key should always call this rather than check `knownTopics` first;
   * the cache's FIFO eviction below keeps it bounded. Only `isAssigned`
   * deliberately bypasses this (it must not pollute the cache on a read-only
   * query), so if you add a new call site, prefer `rememberTopic` unless you
   * have the same "read-only query" reason.
   */
  private rememberTopic(topic: string): string {
    const topicKey = createOpaqueKey(topic);
    this.knownTopics.set(topicKey, topic);
    // Evict the oldest entry when the cache exceeds its cap. Plain Map iteration
    // order is insertion order, so deleting the first key is FIFO eviction (not
    // true LRU — reads do not promote recency). Hashing is cheap, so a missed
    // reverse-lookup merely recomputes the key, but the storage-less fallback
    // path (readSubscriberTabIds/readRoute) relies on this cache to recover the
    // plaintext topic. Never evict a key this worker still owns, or those reads
    // would silently return null for an assigned topic.
    if (this.knownTopics.size > MAX_KNOWN_TOPICS) {
      // Evict the oldest non-owned entry (FIFO). Scan from the front so the
      // cap holds as long as at least one tracked topic is not owned. Only
      // when every entry is owned (degenerate) do we let the cap slip — owned
      // topics must stay resolvable for the storage-less read path.
      for (const candidate of this.knownTopics.keys()) {
        if (candidate === topicKey || this.assignedTopics.has(candidate)) continue;
        this.knownTopics.delete(candidate);
        break;
      }
    }
    return topicKey;
  }

  private workerStorageKey(workerId: string): string {
    return `${this.workerPrefix}${workerId}`;
  }

  private routeStorageKey(topicKey: string): string {
    return `${this.routePrefix}${topicKey}`;
  }

  private subscriberStorageKey(topicKey: string, tabId: string): string {
    return `${this.subscriberPrefix}${topicKey}:${tabId}`;
  }

  private removeStorage(key: string): void {
    try {
      this.storage?.removeItem(key);
    } catch {
      // Ignore unavailable storage.
    }
  }

  /** Force-flush any pending batched writes (used during shutdown/teardown). */
  private flushStorage(): void {
    if (this.storage instanceof BatchingStorageWriter) this.storage.flush();
  }
}

function listKeysSafe(storage: StorageLike | null, prefix: string): string[] {
  return storage ? listKeys(storage, prefix) : [];
}
