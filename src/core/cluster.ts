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
  approximatePayloadBytes,
  selectActiveWorkers,
  selectLeastLoadedWorker,
  topicMatchesPattern
} from './routing';
import type {
  DataBusPublicationMetadata,
  LoadWeightingOptions,
  TopicSubscriberRecord,
  WorkerClusterMessage,
  WorkerControlAction,
  WorkerRecord,
  WorkerRole,
  WorkerRoute,
  WorkerStatus,
  WorkerThroughputSample
} from './types';
import { BatchingStorageWriter } from './storage-batch';
import {
  CLUSTER_MESSAGE_TYPE,
  CONTROL_ACTION,
  DEFAULT_STORAGE_PREFIX,
  RELIABILITY_OPERATION,
  TAB_VISIBILITY,
  WORKER_ROLE,
  WORKER_STATUS
} from '../utils/constants';
import { publicationMetadata } from '../utils/metadata';
import { readAllByPrefix, readJson, writeJson } from '../utils/storage-utils';
import { assertClusterOptions } from '../utils/validation';

/** Callbacks the cluster invokes to drive the transport and lifecycle. */
export interface WorkerClusterHandlers {
  /** A SUBSCRIBE/UNSUBSCRIBE/PUBLISH control action was received for this worker. */
  onControl: (
    action: WorkerControlAction,
    topic: string,
    data?: unknown,
    messageId?: string,
    timestamp?: number
  ) => void;
  /** Optional batched variant of the PUBLISH action: invoked once when a
   * CONTROL frame carries multiple publication items. When absent, the
   * cluster falls back to per-item `onControl('PUBLISH', …)` calls. */
  onPublishBatch?: (
    topic: string,
    items: ReadonlyArray<{ data: unknown; messageId?: string; timestamp?: number }>
  ) => void;
  /** Optional hook for forward-compatible messages from newer runtimes. */
  onUnknownMessage?: (message: unknown) => void;
  /** A fan-out publication event was received from another Worker.
   * `originTabId` is the tab that produced the original publication when the
   * cluster forwards one; it survives the BroadcastChannel hop so listeners
   * can tell a local dispatch from a cross-tab relay. */
  onEvent: (
    eventType: string,
    payload: unknown,
    sourceWorkerId: string,
    originTabId?: string
  ) => void;
  /** The cluster suspended (tab hidden / pagehide). */
  onSuspend?: () => void;
  /** The cluster resumed (tab visible / pageshow). */
  onResume?: () => void;
  /** Bounded diagnostics for route confirmation, graceful migration, and stranded-handoff recovery. */
  onDiagnostic?: (event: {
    operation: (typeof RELIABILITY_OPERATION.ROUTE_ACK | typeof RELIABILITY_OPERATION.ROUTE_MIGRATION | typeof RELIABILITY_OPERATION.ROUTE_MIGRATION_RECOVERY);
    topic: string;
  }) => void;
}

export interface WorkerClusterOptions {
  /** Namespace for the cluster's storage keys and BroadcastChannel.
   * Two DataBus instances with different clusterKeys operate in isolation.
   * The one exception is in the derivation rather than in the hash: an *empty*
   * key falls back to the literal `'__default__'` before it is hashed, so `''`
   * and `'__default__'` name the same cluster. Pinned by tests/cluster.test.ts's
   * 'treats an empty clusterKey as the default cluster, and every other key as
   * isolated', which also holds the other side — any third key still isolates. */
  clusterKey: string;
  /** Callbacks the cluster invokes to drive the transport and lifecycle. */
  handlers: WorkerClusterHandlers;
  /** Inject a custom environment (for tests or SSR). Defaults to browser. */
  environment?: ClusterEnvironment;
  /** Override the storage key prefix (default 'cross-tab-worker-databus'). */
  storagePrefix?: string;
  /** Inject a stable tab ID (for tests). Defaults to sessionStorage-derived. */
  tabId?: string;
  /** Inject a worker ID (for tests). Defaults to 'worker-<tabId>-<random>'. */
  workerId?: string;
  /** Cap on concurrently active owners (default 3). See DEFAULT_MAX_ACTIVE_WORKERS. */
  maxActiveWorkers?: number;
  /** Heartbeat + reconcile interval in ms (default 3000). */
  heartbeatIntervalMs?: number;
  /** TTL after which a silent worker is pruned (default 10000). */
  workerTtlMs?: number;
  /** Maximum entries kept in the publish route-owner cache (default 256).
   * When the cap is reached an entry is dropped, but not the first-seen one:
   * `touchRouteOwnerCache` re-inserts a key it is shown again, so the Map's
   * iteration order tracks the last *touch* rather than the original insertion.
   * Recency-ordered, not FIFO. */
  routeOwnerCacheMax?: number;
  /** Optional adaptive owner weighting. When set, this worker samples its own
   * fan-out traffic and publishes it with every heartbeat so peers can steer
   * NEW routes toward quieter workers; the weights are forwarded to the
   * least-loaded selection. Absent (default) keeps pure topic-count routing. */
  loadWeighting?: LoadWeightingOptions;
}

/** Read-only snapshot of the cluster state for diagnostics and tracing. */
export interface WorkerClusterSnapshot {
  protocolVersion: number;
  /** Protocol versions advertised by each currently visible peer; null means legacy peer. */
  peerProtocolVersions: Record<string, number | null>;
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
  routeOwnerCache?: { size: number; max: number; hits: number; misses: number };
}

const CLUSTER_PROTOCOL_VERSION = 1;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 3_000;
const DEFAULT_WORKER_TTL_MS = 10_000;
// Upper bound on the topicKey → topic reverse cache. Control messages from
// other workers can reference arbitrary topics, so cap growth to avoid an
// unbounded memory leak from a misbehaving or malicious peer.
const MAX_KNOWN_TOPICS = 500;

/**
 * Cross-tab worker coordination runtime.
 *
 * Manages a cluster of Workers (one per tab) that share topics via localStorage
 * and BroadcastChannel. Each Worker publishes its own record, subscribes to
 * topics, and routes publications through the owning Worker to avoid duplicates.
 *
 * Key responsibilities:
 * - Heartbeat-based failure detection (stale workers pruned after `workerTtlMs`)
 * - Topic-to-Worker routing with sticky ownership: load and visibility steer
 *   only the placement of *new* routes, and an established owner is never
 *   migrated (see `selectRebalanceTarget`, which the runtime deliberately
 *   does not call)
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
  /** Adaptive load weighting options; undefined keeps legacy topic-count routing. */
  private readonly loadWeighting: LoadWeightingOptions | undefined;
  /** Rolling traffic accumulator folded into the worker record on writeRecord. */
  private throughputWindow: { startedAt: number; messageCount: number; byteCount: number } = {
    startedAt: 0,
    messageCount: 0,
    byteCount: 0
  };
  // Topics this tab has subscribed to (local interest, plaintext).
  private readonly subscribedTopics = new Set<string>();
  // Topics assigned to this Worker as owner (topicKey → topic). Authoritative:
  // membership drives isAssigned() and load. Grown by exactly three writers —
  // CONTROL/SUBSCRIBE, ROUTE_RELEASED (completing a handoff this worker accepted),
  // and local self-subscribe — and never by the reverse cache.
  private readonly assignedTopics = new Map<string, string>();
  private readonly routeOwnerCache = new Map<string, { workerId: string; generation: number }>();
  private readonly routeOwnerCacheMax: number;
  private routeOwnerCacheHits = 0;
  private routeOwnerCacheMisses = 0;
  private unknownMessageCount = 0;
  private lastUnknownMessageType: string | null = null;
  private touchRouteOwnerCache(topicKey: string, value: { workerId: string; generation: number }): void {
    if (this.routeOwnerCache.has(topicKey)) this.routeOwnerCache.delete(topicKey);
    this.routeOwnerCache.set(topicKey, value);
    // The delete above re-inserts a known key at the back, so the front of the
    // Map's iteration order is the least-recently-touched entry. A call adds at
    // most one net entry, so one eviction is enough to reach the cap — and it is
    // often none: the size is over the cap only when a *new* key arrives while the
    // cache already sits at it. Measured at `routeOwnerCacheMax: 2` with two remote
    // owners, filling to 2 and then re-resolving either one leaves `size` at 2 and
    // the loop's first iteration breaks without deleting.
    for (const oldest of this.routeOwnerCache.keys()) {
      if (this.routeOwnerCache.size <= this.routeOwnerCacheMax) break;
      this.routeOwnerCache.delete(oldest);
    }
  }
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
  /** Invalidates an in-flight pageshow resume when a synchronous onResume
   * callback stops or pauses the cluster before activate() is reached. */
  private lifecycleGeneration = 0;
  private currentRecord: WorkerRecord;

  constructor(options: WorkerClusterOptions) {
    assertClusterOptions(options);
    this.environment = options.environment ?? createBrowserEnvironment();
    this.handlers = options.handlers;
    this.maxActiveWorkers = options.maxActiveWorkers ?? DEFAULT_MAX_ACTIVE_WORKERS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.routeOwnerCacheMax = options.routeOwnerCacheMax ?? 256;
    this.workerTtlMs = options.workerTtlMs ?? DEFAULT_WORKER_TTL_MS;
    this.loadWeighting = options.loadWeighting;
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
      protocolVersion: CLUSTER_PROTOCOL_VERSION,
      workerId: this.workerId,
      tabId: this.tabId,
      load: 0,
      role: WORKER_ROLE.STANDBY,
      status: WORKER_STATUS.CONNECTING,
      visibilityState: this.environment.getVisibilityState(),
      heartbeatAt: now,
      registeredAt: now
    };
  }

  /** Start the cluster: register, listen for lifecycle events, and begin heartbeats. */
  start(): void {
    if (this.started) return;
    this.lifecycleGeneration += 1;
    this.addLifecycleListeners();
    // A start can be issued after pagehide was missed by a synchronous teardown
    // path (for example, a restart queued behind an async transport.stop()).
    // Keep lifecycle listeners installed for the later pageshow, but do not
    // register a worker or open coordination resources for a hidden document.
    if (this.environment.getVisibilityState() === TAB_VISIBILITY.HIDDEN) {
      this.suspended = true;
      this.handlers.onSuspend?.();
      return;
    }
    this.suspended = false;
    this.activate();
  }

  /**
   * Stop the cluster: pause heartbeats, hand off assigned topics, remove
   * the worker record, and clean up lifecycle listeners. Idempotent.
   * The .clear() calls after pause() are safe no-ops when pause already
   * cleared the maps (the handoff path), but ensure a full teardown in the
   * stop() path where callers expect every Set/Map to be empty afterwards.
   */
  stop(): void {
    this.lifecycleGeneration += 1;
    // The three flags are exactly "something is still armed": `started` for the
    // channel/heartbeat pair, `suspended` for a document that is hidden and
    // waiting for a pageshow, and `lifecycleListening` for a runtime that never
    // activated at all. Without the third term a `stop()` issued from inside
    // `handlers.onResume` was dropped on the floor — `handlePageShow()` clears
    // `suspended` on the statement before it calls that callback, and `started`
    // is only set by the `activate()` the bumped generation then skips — so the
    // listeners stayed attached and the next visibility toggle resurrected the
    // runtime: measured, `onResume` fired a second time after the explicit
    // `stop()` and `getSnapshot().coordinated` went back to true.
    //
    // The other two terms are dominated by this one today, and measured so:
    // deleting `!this.started` alone, or `!this.suspended` alone, leaves the whole
    // suite green at its full count. The invariant behind that is local to this
    // class, and this is where it is stated: `started` is written true only in
    // `activate()`, which is reachable only from `start()` — one statement after
    // `addLifecycleListeners()` — or from `handlePageShow()`, which is itself one of
    // those listeners, so the flag can only be false there if the adapter ignores
    // its own `removePageShowListener` (`createBrowserEnvironment` and the test fake
    // both detach). `suspended` is written true in three places, all of which either
    // follow that install or are gated on the flag (`pause()`'s not-started leg
    // reads it). So either of the other two implies `lifecycleListening`, and the
    // third term subsumes them. Both are kept because the two shapes fail
    // differently: a redundant term in a disjunction costs one boolean test, while
    // a missing one drops a teardown quietly — which is the failure this line has
    // just had.
    if (!this.started && !this.suspended && !this.lifecycleListening) return;
    this.pause();
    this.flushStorage();
    this.removeLifecycleListeners();
    this.subscribedTopics.clear();
    this.assignedTopics.clear();
    this.routeOwnerCache.clear();
    this.knownTopics.clear();
    this.suspended = false;
  }

  /**
   * Activate the cluster: open the BroadcastChannel, register the worker record,
   * subscribe to topics, and start the heartbeat interval.
   */
  private activate(): void {
    // Zero-count, and the premise is unconstructible rather than merely
    // untested: the two callers are `start()`, which returns on this same test
    // one block above, and `handlePageShow()`, which returns unless `suspended`.
    // So entering here with `started` true needs `started && suspended` to hold
    // together, and no write produces that pair. `started` goes true only on the
    // next line and false only in `pause()`; each of the three `suspended = true`
    // writes runs with `started` false — `start()`'s hidden-document branch, and
    // `pause()`'s two legs, the started one setting `started = false` first. A
    // census over the whole suite saw one distinct entry vector,
    // `started=0 suspended=0 lifecycleListening=1`.
    if (this.started) return;
    this.started = true;
    // Create the BroadcastChannel for cross-tab messaging. If storage is
    // unavailable, we cannot coordinate — skip the channel. If the channel
    // itself fails to construct (sandboxed iframe, permissions policy),
    // null out storage too: without a channel the storage writes have no
    // peer to observe them, so the BatchingStorageWriter would write for
    // nothing and the degraded code paths must take over.
    if (this.storage) {
      try {
        this.channel = this.environment.createChannel(this.channelName);
      } catch {
        // Custom environments are allowed to wrap capability APIs directly.
        // Treat a synchronous constructor failure like an unavailable channel
        // rather than leaving start() half-active with `started === true`.
        this.channel = null;
      }
    } else {
      this.channel = null;
    }
    if (!this.channel) this.storage = null;
    // Activation is not atomic. `createChannel` above is consumer-supplied
    // adapter code and the storage-less self-SUBSCRIBE below calls
    // `handlers.onControl`, both on this stack with `started` already true and
    // `heartbeatHandle` still null — so a `stop()` or a pagehide landing in
    // either has already run `pause()` and cleared the state this method is
    // building. Measured without the two checks below, a teardown inside
    // `createChannel` left the runtime holding that freshly built channel with
    // `suspended === false` and `getSnapshot().coordinated === true`, back in
    // `storage` as a live worker record (so no peer ever TTL-prunes it), and
    // still accepting assignments: a `CONTROL/SUBSCRIBE` frame addressed to it
    // after the stop added its topic to `assignedTopics`. `pause()` could not
    // clean any of that up because it ran before the channel existed. Each of
    // the two checks and the rollback inside the first one dies to its own
    // assertion in `cluster.test.ts`: with this check deleted, "abandons
    // activation when the channel adapter tears the runtime down mid-start"
    // fails at "a stopped runtime must not be registered"; with only the
    // `this.channel = null` deleted from it, the same test fails at
    // `coordinated: false`; with the check below deleted, "abandons the
    // heartbeat when a handler stops the runtime during the storage-less
    // re-subscribe" fails at "no heartbeat may outlive the abandoned activation".
    // The `channel?.close()` is the one half nothing asserts: no listener is ever
    // attached to that channel, so a leaked port is invisible through the fake
    // hub. It is real-browser hygiene — an open BroadcastChannel keeps its port
    // and message queue alive — not a pinned behavior.
    if (!this.started) {
      const channel = this.channel;
      this.channel = null;
      // Close rather than drop: an open BroadcastChannel with no listener still
      // holds a port and its incoming queue. Nothing was ever sent on this one,
      // so there is no queued `ROUTE_RELEASED` for a close to discard — unlike
      // the deferred close in `pause()`, which protects a real handoff.
      channel?.close();
      return;
    }
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
    // rememberTopic is called once per topic regardless of branch so the reverse
    // cache is populated before either the control message or the subscriber write.
    for (const topic of this.subscribedTopics) {
      const topicKey = this.rememberTopic(topic);
      if (!this.storage) this.sendControl(this.workerId, CONTROL_ACTION.SUBSCRIBE, topic, topicKey);
      else this.writeSubscriber(topicKey);
    }
    // The second half of the window opened above: `handlers.onControl` in that
    // loop runs on this stack, so the teardown can arrive here too, after the
    // worker record was written. Arming the heartbeat at that point leaks a
    // timer no later `stop()` can clear — `pause()` nulls `heartbeatHandle`
    // before this assignment — and on a storage-backed runtime every leaked
    // tick re-registers the worker record `pause()` just removed, which keeps a
    // departed tab live to its peers forever.
    if (!this.started) return;
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
    this.lifecycleGeneration += 1;
    // A pagehide can re-enter synchronously from the pageshow onResume
    // callback after handlePageShow() has tentatively cleared `suspended` but
    // before activate() marks the runtime started. Preserve that newer hidden
    // intent so the outer pageshow is cancelled and a later pageshow can retry.
    if (!this.started) {
      // The false arm of this test is the "already fully stopped" case, and it
      // has never executed: `lifecycleListening` goes false only in
      // `removeLifecycleListeners()`, whose one caller is `stop()` — and `stop()`
      // cannot get past its own guard with the flag false, because the guard's
      // other two terms each imply the flag (see the note there). The other caller
      // of `pause()` is `handlePageHide`, which that same removal detaches. A
      // census over the whole suite saw four distinct `pause()` vectors — `started=0 suspended=0`, `started=0 suspended=1`, and
      // the two `started=1` ones, an armed heartbeat from the ordinary teardown and
      // a still-null one produced only by the abandoned-activation tests — with
      // `lifecycleListening` true in all four. This is the other half of the pair
      // `stop()`'s guard describes: each refuses the state the other would have to
      // observe, which is why neither can be deleted on the strength of the other.
      if (this.lifecycleListening) this.suspended = true;
      return;
    }
    this.started = false;
    this.suspended = true;
    // Reached with `heartbeatHandle === null` from the activation window, and that
    // provenance is measured rather than argued: instrumenting this branch and
    // running the whole suite printed exactly two lines and no third, one per
    // activation seam — the adapter's `createChannel` in
    // "abandons activation when the channel adapter tears the runtime down
    // mid-start", and the storage-less self-SUBSCRIBE's `handlers.onControl` in
    // "abandons the heartbeat when a handler stops the runtime during the
    // storage-less re-subscribe". Both tear down between `started = true` and the
    // `setInterval` at the end of `activate()`, which is the only way this arm was
    // ever taken (it is zero-count without them). The test protects against
    // nothing observable — measured: calling `clearInterval` unconditionally keeps
    // the whole suite green, and a null handle throws in neither adapter — so what
    // is load-bearing here is the `null` assignment on the next line, which is how
    // an armed handle stays distinguishable from a never-armed one.
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
    this.routeOwnerCache.clear();
    this.removeStorage(this.workerStorageKey(this.workerId));
    // Persist the final routes and worker removal before asking peers to
    // reconcile. A pagehide CONTROL message may be lost; REGISTRY must still
    // let peers observe the completed handoff immediately.
    this.flushStorage();
    this.notifyRegistry();
    // A failed final write arms the batching writer's retry timer. The runtime
    // is now suspended/stopped, so discard that retry state instead of leaving
    // background work attached to a torn-down coordination session. Stale
    // metadata remains covered by the normal TTL recovery path.
    if (this.storage instanceof BatchingStorageWriter) this.storage.discardPending();
    const channel = this.channel;
    this.channel = null;
    this.handlers.onSuspend?.();
    // Defer the physical close by one task: BroadcastChannel.close() discards
    // messages still queued for delivery — including the handoff's
    // ROUTE_RELEASED — which can strand the handoff target with an
    // unconfirmed route on a loaded runner. Letting the queued frames flush
    // first keeps the strict handoff live; on a frozen BFCache page the task
    // simply never runs and the channel object is garbage-collected with it.
    if (channel) {
      if (typeof globalThis.setTimeout === 'function') {
        globalThis.setTimeout(() => channel.close(), 0);
      } else {
        channel.close();
      }
    }
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
      this.sendControl(this.workerId, CONTROL_ACTION.SUBSCRIBE, topic, topicKey);
      return true;
    }
    this.writeSubscriber(topicKey);
    const workers = this.readWorkers();
    const existingRoute = this.readRoute(topicKey);
    if (this.routeOwnerIsLive(existingRoute, workers)) {
      return existingRoute?.workerId === this.workerId;
    }

    const activeWorkers = selectActiveWorkers(workers, this.maxActiveWorkers);
    const owner = selectLeastLoadedWorker(activeWorkers, undefined, this.loadWeighting) ?? this.currentRecord;
    // A missing live owner cannot participate in a strict handoff. Assign and
    // subscribe immediately; pagehide uses handoffAssignedTopics() while the
    // old owner is still present when release ordering is required.
    //
    // The `?? this.currentRecord` right arm has never executed, and the reason is
    // the `readWorkers()` call above: while `started` — which the top of this
    // method asserts — it appends this worker's own record when storage names
    // nobody, so `activeWorkers` cannot be empty and the election cannot return
    // undefined. `reconcileSubscriptions()` holds two more of the same shape, on its
    // invalidated-route leg and on its stale-handoff re-election, so this is one of
    // three fallbacks rather than a pair. None of the three is a behavior a test
    // could take and all three are something the call sites' types rest on: measured
    // per site by deleting just that one and running `tsc --noEmit`, this one is
    // rejected three times (`writeRoute(…, owner, …)` as `WorkerRecord | undefined`,
    // then `owner.workerId` twice), the route leg twice, and the stale-handoff leg
    // seven times across its projected-load set, its three `owner.workerId` reads and
    // its own `writeRoute`. Vitest transpiles without type checking, so the suite
    // stays green at its full count with any of them deleted — which is why the
    // classification is recorded here rather than pinned by a test.
    this.writeRoute(topicKey, owner, undefined, (existingRoute?.generation ?? 0) + 1);
    this.sendControl(owner.workerId, CONTROL_ACTION.SUBSCRIBE, topic, topicKey);
    this.notifyRegistry();
    return owner.workerId === this.workerId;
  }

  /**
   * Remove the local subscription. Cleans up the subscriber record and, if no
   * subscribers remain, deletes the route so the owning Worker can unsubscribe.
   */
  unsubscribe(topic: string): void {
    this.subscribedTopics.delete(topic);
    const topicKey = this.releaseSubscription(topic);
    // Keep the topic in knownTopics if we remain the owner (we may still fan out).
    if (topicKey && !this.assignedTopics.has(topicKey)) this.knownTopics.delete(topicKey);
  }

  /** Remove this tab's subscriber record and, when it was the last one, delete
   * the route. Returns the topicKey (so callers like `unsubscribe` can reuse
   * it instead of re-hashing the topic to evict the reverse cache). */
  private releaseSubscription(topic: string, notifyOwner = true): string {
    const topicKey = this.rememberTopic(topic);
    this.removeStorage(this.subscriberStorageKey(topicKey, this.tabId));
    const route = this.readRoute(topicKey);
    if (!route) return topicKey;
    const subscribers = this.readSubscriberTabIds(topicKey, this.readWorkers());
    if (subscribers.length === 0) {
      this.removeStorage(this.routeStorageKey(topicKey));
      if (notifyOwner) this.sendControl(route.workerId, CONTROL_ACTION.UNSUBSCRIBE, topic, topicKey);
    }
    return topicKey;
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
    //
    // Seeding the map from `activeWorkers` is also what makes the two `??` reads
    // below it zero-count, and it is the only difference from their textual
    // twins in `reconcileSubscriptions()`, which are covered: that method's
    // `recoveryProjectedLoads` starts empty, so its first election misses. Here
    // every key of `activeWorkers` is a key of this Map by the semantics of the
    // constructor, the `.map()` below iterates that same array, and `owner` is
    // one of its elements (its `workerId` copied verbatim by the spread), so
    // neither `.get()` can miss. Both legs were measured by deleting just one
    // `??` and running `tsc --noEmit`: one error each — the mapped array stops
    // satisfying `readonly WorkerRecord[]` on the read, and the `.set()` reports
    // `Object is possibly 'undefined'` — so the compiler holds the type of all
    // four of these reads (its twins here measure one error each too) while this
    // line is what holds their reach.
    const projectedLoads = new Map(activeWorkers.map(worker => [worker.workerId, worker.load]));

    for (const [topicKey, topic] of this.assignedTopics) {
      const previous = this.readRoute(topicKey);
      if (previous?.workerId !== this.workerId) continue;
      const subscribers = this.readSubscriberTabIds(topicKey, remainingWorkers);
      if (subscribers.length === 0) {
        this.removeStorage(this.routeStorageKey(topicKey));
        continue;
      }
      const owner = selectLeastLoadedWorker(
        activeWorkers.map(worker => ({ ...worker, load: projectedLoads.get(worker.workerId) ?? worker.load })),
        undefined,
        this.loadWeighting
      );
      // This guard has never executed, and what holds it up is a chain rather
      // than a race: `assertClusterOptions()` runs in the constructor before
      // `maxActiveWorkers` is read and rejects anything that is not a positive safe
      // integer, so `selectActiveWorkers()`'s `slice(0, maxActiveWorkers)` keeps at
      // least one record whenever its input is non-empty — and the input is
      // non-empty here, because `subscribers` above is filtered by the tabIds of
      // `remainingWorkers` (`readSubscriberTabIds()` drops every record whose tab is
      // not among the workers it was handed, and its storage-less `[this.tabId]` leg
      // cannot run at this call site: this method returns early when `!this.storage`),
      // while `selectLeastLoadedWorker()` returns undefined only for an empty list.
      // Each link already has a test of its own: `cluster.test.ts`'s "rejects a
      // maxActiveWorkers that is not a positive safe integer", `routing.test.ts`'s
      // "returns an empty array for an empty input" and "selectLeastLoadedWorker
      // returns undefined for an empty array", and `property.test.ts`'s
      // never-empty-subset property. Deleting the line leaves the suite green at its
      // full count (vitest transpiles without type checking) and fails
      // `tsc --noEmit` five times: three on `projectedLoads.set(owner.workerId,
      // (projectedLoads.get(owner.workerId) ?? owner.load) + 1)`, one on
      // `writeRoute(…, owner, …)`, one on `sendRouteReleased(owner.workerId, …)`. So
      // this is the narrowing the three calls below rest on, not a branch behavior
      // could take — the same shape as the three `?? this.currentRecord` fallbacks
      // (`subscribe()`'s election and the two in `reconcileSubscriptions()`,
      // enumerated at the first of those), which is why it is recorded here rather
      // than pinned by a test. This method's own election just above has no such
      // fallback: the guard on the line below *is* its handling of a nil owner,
      // which is also why deleting that guard costs five errors rather than none.
      if (!owner) continue;
      projectedLoads.set(owner.workerId, (projectedLoads.get(owner.workerId) ?? owner.load) + 1);
      // This `?? 0` is the odd one out among the three fallbacks in this block.
      // Deleting the other two is a compile error — the compiler is what holds
      // them — while deleting this one type-checks, because `WorkerRoute.generation`
      // is a required `number`. What makes its zero count honest is the filter
      // three lines above: a null `previous` makes `previous?.workerId` evaluate to
      // `undefined`, which never equals this worker's id, so that `continue` takes
      // every route-less topic out of the loop. The domination therefore lives in
      // that line rather than in this expression.
      const generation = (previous?.generation ?? 0) + 1;
      this.writeRoute(topicKey, owner, previous?.workerId, generation);
      this.handlers.onDiagnostic?.({ operation: RELIABILITY_OPERATION.ROUTE_MIGRATION, topic });
      // Make the new route visible before the target confirms it. This also
      // leaves a durable unconfirmed assignment when unload drops CONTROL.
      this.flushStorage();
      // Release the old server subscription before authorizing the new owner.
      // The ACK is sent after the transport operation has been requested.
      this.handlers.onControl(CONTROL_ACTION.UNSUBSCRIBE, topic);
      this.sendRouteReleased(owner.workerId, topic, topicKey, generation);
    }
  }

  /**
   * Publish a message to `topic`, routing through the owning Worker (or self if
   * no owner is found). Returns false when the control message could not be
   * posted to a remote owner, so the caller can surface the failure instead of
   * silently dropping the publication.
   */
  publish(topic: string, data: unknown, messageId?: string): boolean;
  publish(topic: string, data: unknown, metadata?: DataBusPublicationMetadata): boolean;
  publish(
    topic: string,
    data: unknown,
    metadataOrMessageId?: DataBusPublicationMetadata | string
  ): boolean {
    const metadata = typeof metadataOrMessageId === 'string'
      ? { messageId: metadataOrMessageId }
      : metadataOrMessageId;
    const topicKey = this.rememberTopic(topic);
    // The owning Worker already has a synchronous assignment map. Reuse it
    // for the hot local-publish path instead of scanning worker and route
    // records on every message. Which assignments this lookup answers for is the
    // whole question, because `assignedTopics` is keyed by the plaintext it was
    // given: a worker holding `chat.*` has the *pattern's* key here, so a
    // publication for `chat.room.1` misses this `has()` and falls through to
    // `resolvePublishTarget()` below — which does return this worker, once, when
    // no live route names anyone else. The sentence this replaced claimed
    // wildcard holders "use the same fast path", which had been true only of the
    // memo that used to sit in that fall-through; see the note under it.
    if (this.assignedTopics.has(topicKey)) {
      return this.sendControl(this.workerId, CONTROL_ACTION.PUBLISH, topic, topicKey, data, metadata);
    }
    // No per-topic wildcard memo here, and that is a correctness decision rather
    // than a removed optimization. The block this replaces scanned
    // `assignedTopics` on the *first* publication to a topic and, on a match,
    // dispatched locally without consulting the durable route; every later
    // publication went through `resolvePublishTarget`. Measured with one runtime
    // holding `chat.*` while a peer concretely owns `chat.room.1` (route record
    // naming the peer, both runtimes reporting `isAssigned` true): three
    // publications from the wildcard holder produced `atA=1 atB=0`, then
    // `atA=1 atB=1`, then `atA=1 atB=2`. The first was never delivered to the
    // owner it addressed, and delivery is at-most-once, so it is gone for good.
    // That is the 0.20.58 bug seen from the other side: there a cached `null`
    // short-circuited the owner lookup, here a cache *miss* did, so no eviction
    // rule could have bounded the growth without also fixing the ordering.
    // Wildcard ownership is still honoured — with no live concrete route
    // `resolvePublishTarget()` answers with this worker, and the receiving
    // ownership gate matches the pattern — it is just consulted once, on the same
    // path every other publication takes.
    return this.sendControl(this.resolvePublishTarget(topic, topicKey), CONTROL_ACTION.PUBLISH, topic, topicKey, data, metadata);
  }

  /**
   * Burst-friendly variant of `publish()`: packs up to N items into a single
   * BroadcastChannel postMessage so the receiving owner dispatches them all in
   * one tick. Per-item dedup / replay / dispatch ordering is preserved; items
   * may carry their own messageId/timestamp. Empty batch is a no-op,
   * single-item batch delegates to `publish()`.
   */
  publishBatch(
    topic: string,
    items: ReadonlyArray<{ data: unknown; messageId?: string; timestamp?: number }>
  ): boolean {
    if (items.length === 0) return true;
    if (items.length === 1) {
      const single = items[0]!;
      const metadata = single.messageId !== undefined || single.timestamp !== undefined
        ? {
            ...(single.messageId !== undefined ? { messageId: single.messageId } : {}),
            ...(single.timestamp !== undefined ? { timestamp: single.timestamp } : {})
          }
        : undefined;
      return this.publish(topic, single.data, metadata);
    }
    const topicKey = this.rememberTopic(topic);
    if (this.assignedTopics.has(topicKey)) {
      this.dispatchLocalPublishBatch(topic, topicKey, items);
      return true;
    }
    // Same rule as `publish()`, and the single-item delegation above reaches that
    // method for a one-element batch: no first-publication wildcard scan, because
    // a match there dispatched locally past a live concrete route owner.
    const target = this.resolvePublishTarget(topic, topicKey);
    if (target === this.workerId) {
      this.dispatchLocalPublishBatch(topic, topicKey, items);
      return true;
    }
    return this.send({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: this.workerId,
      targetWorkerId: target,
      action: CONTROL_ACTION.PUBLISH,
      topic,
      topicKey,
      items: items.map(item => ({
        data: item.data,
        ...(item.messageId !== undefined ? { messageId: item.messageId } : {}),
        ...(item.timestamp !== undefined ? { timestamp: item.timestamp } : {})
      }))
    });
  }

  /** Resolve which worker should receive a PUBLISH for `topic`. Centralises the
   * route-owner cache lookup so `publish()` and `publishBatch()` share one path. */
  private resolvePublishTarget(topic: string, topicKey: string): string {
    const workers = this.readWorkers();
    const route = this.readRoute(topicKey);
    const cached = this.routeOwnerCache.get(topicKey);
    const cachedLive = cached && route && route.generation === cached.generation && route.workerId === cached.workerId && workers.some(worker => worker.workerId === cached.workerId);
    if (cachedLive) this.routeOwnerCacheHits += 1; else this.routeOwnerCacheMisses += 1;
    // The `?? this.workerId` below has never been taken, and `routeOwnerIsLive()`
    // is where that is decided rather than here: its body is
    // `Boolean(route && workers.some(…))`, so the middle arm is reached only with a
    // non-null `route`. The `?.` and the fallback are what that method's own doc
    // signs up to — "Intentionally returns a plain boolean (not a type guard)" —
    // since a plain boolean leaves `route` nullable on both sides of the test, and
    // a narrowing signature would remove the need for this fallback as well.
    // Measured by deleting just this `??`: one `tsc --noEmit` error, `string |
    // undefined` not assignable to `string`, so like `writeRoute()`'s storage guard
    // it is the type holding the leg, not a test.
    const target = cachedLive
      ? cached.workerId
      : this.routeOwnerIsLive(route, workers)
        ? route?.workerId ?? this.workerId
        : this.workerId;
    if (route && target === route.workerId) {
      this.touchRouteOwnerCache(topicKey, { workerId: route.workerId, generation: route.generation });
    } else {
      this.routeOwnerCache.delete(topicKey);
    }
    return target;
  }

  /** Fan out a single batched item to the local onControl path. */
  private dispatchLocalPublish(
    topic: string,
    topicKey: string,
    data: unknown,
    messageId?: string,
    timestamp?: number
  ): void {
    void topicKey;
    const meta = publicationMetadata(messageId, timestamp);
    if (meta) this.handlers.onControl(CONTROL_ACTION.PUBLISH, topic, data, meta.messageId, meta.timestamp);
    else this.handlers.onControl(CONTROL_ACTION.PUBLISH, topic, data);
  }

  /** Fan out a publication batch to the local onControl path: one
   * onPublishBatch call when the owner supports it, per-item otherwise. */
  private dispatchLocalPublishBatch(
    topic: string,
    topicKey: string,
    items: ReadonlyArray<{ data: unknown; messageId?: string; timestamp?: number }>
  ): void {
    if (this.handlers.onPublishBatch) {
      this.handlers.onPublishBatch(topic, items);
      return;
    }
    for (const item of items) this.dispatchLocalPublish(topic, topicKey, item.data, item.messageId, item.timestamp);
  }

  /** True when `route` exists and its owner worker is among `workers`.
   * Shared by subscribe (skip re-assignment) and publish (route to owner).
   * Intentionally returns a plain boolean (not a type guard) so the caller
   * can still access `route?.generation` in the false branch. */
  private routeOwnerIsLive(route: WorkerRoute | null, workers: readonly WorkerRecord[]): boolean {
    return Boolean(route && workers.some(worker => worker.workerId === route.workerId));
  }

  /** Broadcast an event to every tab — used to fan out transport publications.
   * `originTabId` (when set) is propagated across the BroadcastChannel hop so
   * listeners can attribute the event to its source tab even after fan-out. */
  broadcastEvent(eventType: string, payload: unknown, originTabId?: string): void {
    // Default to the producing tab so listeners can attribute the event to
    // its source tab across the BroadcastChannel hop without callers having
    // to thread the tabId through every call site.
    const effectiveOriginTabId = originTabId ?? this.tabId;
    this.recordTraffic(payload);
    this.send({ type: CLUSTER_MESSAGE_TYPE.EVENT, sourceWorkerId: this.workerId, eventType, payload, originTabId: effectiveOriginTabId });
  }

  /** Count one fan-out unit toward the adaptive load sample. No-op unless
   * adaptive weighting is configured. */
  private recordTraffic(payload: unknown): void {
    if (this.loadWeighting === undefined) return;
    this.throughputWindow.messageCount += 1;
    this.throughputWindow.byteCount += approximatePayloadBytes(payload);
  }

  /** Convert the accumulated window into a publishable throughput sample and
   * reset the accumulator. Returns undefined until a full window has elapsed
   * so the first write does not emit a zero-width sample. */
  private sampleThroughput(now: number): WorkerThroughputSample | undefined {
    if (this.throughputWindow.startedAt === 0) {
      this.throughputWindow.startedAt = now;
      return undefined;
    }
    const windowMs = now - this.throughputWindow.startedAt;
    if (windowMs <= 0) return undefined;
    const sample: WorkerThroughputSample = {
      windowMs,
      messageCount: this.throughputWindow.messageCount,
      byteCount: this.throughputWindow.byteCount,
      // How much later the last record write landed relative to a nominal
      // heartbeat interval. The window is anchored at the previous writeRecord,
      // which the heartbeat tick causes but activation, a status change, a
      // visibility change and a load update also cause — so a worker writing on
      // any of those shorter paths yields a small window and a clamped zero.
      // A starved event loop stretches the window past the interval, and the
      // positive excess is the scheduling-overrun signal.
      overrunMs: Math.max(0, windowMs - this.heartbeatIntervalMs),
      sampledAt: now
    };
    this.throughputWindow = { startedAt: now, messageCount: 0, byteCount: 0 };
    return sample;
  }

  isAssigned(topic: string): boolean {
    // Deliberately recompute the key via createOpaqueKey rather than
    // rememberTopic(): this is a read-only query, not a state change, so it
    // must not populate the knownTopics reverse-cache. Hashing is cheap enough
    // that re-deriving here is preferable to evicting a cached entry that the
    // storage-less readRoute path may need (see rememberTopic eviction guard).
    const topicKey = createOpaqueKey(topic);
    // Prefer the in-memory map: it is the one authority with no durable counterpart.
    // handleControlMessage accepts a CONTROL/SUBSCRIBE whose route cannot be read,
    // and confirmRoute then stamps nothing, so readRoute() answers null for a topic
    // whose transport subscription this worker holds — tests/cluster.test.ts's
    // "accepts a CONTROL/SUBSCRIBE that has no durable route to check" asserts the
    // assignment while no `:route:` key exists in storage at all. This is *not*
    // about coalesced writes: BatchingStorageWriter.getItem serves the pending
    // value first, so a route written this tick already
    // reads back.
    if (this.assignedTopics.has(topicKey)) return true;
    // Wildcard assignments: this worker owns the transport subscription for a
    // pattern (e.g. "chat.*"), so publications arriving under a matching
    // concrete topic (e.g. "chat.room.1", as delivered by pattern-aware
    // servers) belong to the same route and must fan out from here too.
    for (const pattern of this.assignedTopics.values()) {
      if (pattern !== topic && topicMatchesPattern(pattern, topic)) return true;
    }
    return this.readRoute(topicKey)?.workerId === this.workerId;
  }

  /** True if this worker is among the active set (eligible to own topics). */
  isActiveWorker(): boolean {
    return this.isActiveAmong(this.readWorkers());
  }

  /** True when this workerId is in the active subset of `workers`. Shared by
   * isActiveWorker() and refreshRole() so both compute role identically. */
  private isActiveAmong(workers: readonly WorkerRecord[]): boolean {
    return selectActiveWorkers(workers, this.maxActiveWorkers).some(
      worker => worker.workerId === this.workerId
    );
  }

  /** True when this tab has a local subscriber registered for `topic` —
   * exactly, or via a wildcard subscription that matches it. */
  hasLocalSubscriber(topic: string): boolean {
    if (this.subscribedTopics.has(topic)) return true;
    for (const pattern of this.subscribedTopics) {
      if (pattern !== topic && topicMatchesPattern(pattern, topic)) return true;
    }
    return false;
  }

  /** Count and last type of unknown protocol messages observed. */
  getUnknownMessageStats(): { count: number; lastType: string | null } { return { count: this.unknownMessageCount, lastType: this.lastUnknownMessageType }; }

  /** Read-only snapshot of the cluster state (workers, routes, assignments). */
  getSnapshot(): WorkerClusterSnapshot {
    const workers = this.storage ? this.readWorkers() : [{ ...this.currentRecord }];
    const routes = this.storage
      ? readAllByPrefix<WorkerRoute>(this.storage, this.routePrefix).map(({ value }) => ({
          ...value,
          topic: this.knownTopics.get(value.topicKey) ?? null
        }))
      : [];
    return {
      protocolVersion: CLUSTER_PROTOCOL_VERSION,
      peerProtocolVersions: Object.fromEntries(workers.map(worker => [worker.workerId, worker.protocolVersion ?? null])),
      coordinated: Boolean(this.storage && this.channel),
      suspended: this.suspended,
      currentWorker: { ...this.currentRecord },
      workers: workers.map(worker => ({ ...worker })),
      routes,
      subscribedTopics: Array.from(this.subscribedTopics),
      assignedTopics: Array.from(this.assignedTopics.values()),
      knownTopics: Array.from(this.knownTopics.entries(), ([topicKey, topic]) => ({ topicKey, topic })),
      routeOwnerCache: { size: this.routeOwnerCache.size, max: this.routeOwnerCacheMax, hits: this.routeOwnerCacheHits, misses: this.routeOwnerCacheMisses }
    };
  }

  private readonly handlePageHide = () => this.pause();

  private readonly handlePageShow = () => {
    if (!this.suspended) return;
    const generation = ++this.lifecycleGeneration;
    this.suspended = false;
    this.handlers.onResume?.();
    // onResume is a synchronous extension point. A stop(), pause(), or newer
    // start() from the callback owns the lifecycle and must not be undone by
    // this outer pageshow handler reactivating the cluster.
    if (generation !== this.lifecycleGeneration) return;
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
    // Zero-count, and it is the mirror of `pause()`'s `lifecycleListening` test:
    // this method has one caller, `stop()`, which reaches it only past the
    // three-flag guard whose invariant is stated there — and once this line has
    // run, `stop()` clears `suspended` at its tail, so a second `stop()` sees all
    // three flags false and returns before getting here. The five statements
    // between the flag write below and that clearance are `Set`/`Map` `.clear()`
    // calls with no extension point, so the intermediate
    // `!lifecycleListening && suspended` state cannot be observed by consumer
    // code. The census recorded one distinct entry vector for this method across
    // the whole suite: `lifecycleListening=1 started=0 suspended=1`, i.e. always
    // the first removal after a pause. It stays because it is the re-entry form of
    // an idempotent teardown: a second call would hand the same three bound
    // handlers to `removePageHideListener` and friends again, and while the
    // shipped browser adapter shrugs that off (`removeEventListener` for a
    // listener that is not registered is a no-op) `ClusterEnvironment` is a
    // consumer-implemented port, so the guarantee comes from this line rather than
    // from what a custom adapter happens to do.
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
    switch (message.type) {
      case CLUSTER_MESSAGE_TYPE.CONTROL:
        return this.handleControlMessage(message);
      case CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED:
        return this.handleRouteReleasedMessage(message);
      case CLUSTER_MESSAGE_TYPE.EVENT:
        this.handlers.onEvent(message.eventType, message.payload, message.sourceWorkerId, message.originTabId);
        return;
      case CLUSTER_MESSAGE_TYPE.REGISTRY:
        this.reconcile();
        return;
      default: {
        this.unknownMessageCount += 1;
        const unknown = message as unknown as { type?: unknown };
        this.lastUnknownMessageType = typeof unknown.type === 'string' ? unknown.type : null;
        this.handlers.onUnknownMessage?.(message);
        return;
      }
    }
  };

  /** Handle a point-to-point CONTROL message (SUBSCRIBE / UNSUBSCRIBE / PUBLISH). */
  private handleControlMessage(
    message: Extract<WorkerClusterMessage, { type: typeof CLUSTER_MESSAGE_TYPE.CONTROL }>
  ): void {
    if (message.targetWorkerId !== this.workerId) return;
    // Every frame this library sends derives `topicKey` from `topic` with the
    // same hash, so a pair that disagrees cannot come from a conforming peer: it
    // is either forged or corrupt. The channel is a `BroadcastChannel`, which
    // any same-origin script can post into, and the fields below are used to
    // authorize ownership and to name the transport subscription — so without
    // this check one frame could keep a topicKey the route already names for us
    // while substituting a different plaintext, renaming our owned channel.
    if (message.topicKey !== undefined && createOpaqueKey(message.topic) !== message.topicKey) return;
    this.rememberTopic(message.topic);
    switch (message.action) {
      case CONTROL_ACTION.SUBSCRIBE: {
        const route = this.readRoute(message.topicKey);
        // A CONTROL/SUBSCRIBE is dropped when the durable route names a
        // *different* worker: a delayed frame from an earlier assignment round
        // must not make a non-owner subscribe. A missing route passes, and that
        // is a tolerance rather than a hole — `confirmRoute` writes nothing when
        // there is no route to stamp, so the frame cannot mint durable ownership,
        // and `reconcileAssignedTopics` takes the assignment back on the next
        // tick. Both halves are pinned by tests/cluster.test.ts's "accepts a
        // CONTROL/SUBSCRIBE that has no durable route to check, then sweeps it".
        // What the tolerance buys is coordination when a route cannot be read at
        // all: expired, corrupted, or storage that is not present. A pending
        // graceful handoff is stricter still: only its exact ROUTE_RELEASED ACK
        // may authorize the new owner, otherwise the old and new transport
        // subscriptions can overlap.
        if (route && route.workerId !== this.workerId) return;
        if (
          route?.workerId === this.workerId &&
          route.handoffFromWorkerId !== undefined &&
          route.confirmedAt === undefined
        ) {
          return;
        }
        this.assignedTopics.set(message.topicKey, message.topic);
        this.confirmRoute(message.topicKey);
        break;
      }
      case CONTROL_ACTION.UNSUBSCRIBE:
        // A graceful handoff release short-circuits the generic dispatch.
        if (this.releaseHandoffOnUnsubscribe(message)) return;
        break;
      case CONTROL_ACTION.PUBLISH:
        if (message.items !== undefined) {
          // `publishBatch()` is the only sender of `items` and it builds them with
          // `Array.prototype.map`, so a present batch that is not a non-empty array
          // — an iterable string, an array-like with a `length` — comes from a
          // hand-built frame. Rejecting it here is the only place that decision can
          // be taken: the loop below would throw out of this listener on a
          // non-iterable value, and falling through instead would publish
          // `message.data`, which a batch frame does not carry.
          if (!Array.isArray(message.items) || message.items.length === 0) return;
          // A batched CONTROL: hand the whole batch to the transport at once
          // when the owner supports it, preserving per-item metadata.
          if (this.handlers.onPublishBatch) {
            this.handlers.onPublishBatch(message.topic, message.items);
            return;
          }
          for (const item of message.items) {
            const itemMeta = publicationMetadata(item.messageId, item.timestamp);
            if (itemMeta) this.handlers.onControl(CONTROL_ACTION.PUBLISH, message.topic, item.data, itemMeta.messageId, itemMeta.timestamp);
            else this.handlers.onControl(CONTROL_ACTION.PUBLISH, message.topic, item.data);
          }
          return;
        }
        break;
      default:
        break;
    }
    const metadata = publicationMetadata(message.messageId, message.timestamp);
    if (metadata) this.handlers.onControl(
      message.action,
      message.topic,
      message.data,
      metadata.messageId,
      metadata.timestamp
    );
    else this.handlers.onControl(message.action, message.topic, message.data);
    if (message.action !== CONTROL_ACTION.PUBLISH) this.updateLoad();
  }

  /** Drop this worker's ownership of the topic, then — only when this worker is
   * the previous owner in a graceful handoff and the new owner is asking us to
   * unsubscribe — release the old transport subscription and ACK the handoff with
   * ROUTE_RELEASED. The ownership delete runs for *every* CONTROL/UNSUBSCRIBE,
   * before the handoff test; the handoff legs below do not gate it. Returns true
   * when the message was a handoff release (the generic CONTROL dispatch must not
   * run as well).
   */
  private releaseHandoffOnUnsubscribe(
    message: Extract<WorkerClusterMessage, { type: typeof CLUSTER_MESSAGE_TYPE.CONTROL }>
  ): boolean {
    this.assignedTopics.delete(message.topicKey);
    const route = this.readRoute(message.topicKey);
    if (route?.handoffFromWorkerId !== this.workerId) return false;
    this.handlers.onControl(CONTROL_ACTION.UNSUBSCRIBE, message.topic, undefined);
    this.sendRouteReleased(route.workerId, message.topic, message.topicKey, route.generation);
    this.updateLoad();
    return true;
  }

  /** Post a ROUTE_RELEASED ACK to the new owner, carrying the current route
   * generation so only the matching new owner may act on it. */
  private sendRouteReleased(
    targetWorkerId: string,
    topic: string,
    topicKey: string,
    generation: number
  ): void {
    this.send({
      type: CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED,
      sourceWorkerId: this.workerId,
      targetWorkerId,
      topic,
      topicKey,
      generation
    });
  }

  /**
   * Accept a graceful handoff only when the route still points to this worker,
   * the release comes from the recorded previous owner, and the generation
   * exactly matches ours. Any other ROUTE_RELEASED is stale and dropped.
   */
  private handleRouteReleasedMessage(
    message: Extract<WorkerClusterMessage, { type: typeof CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED }>
  ): void {
    if (message.targetWorkerId !== this.workerId) return;
    // The same pairing invariant `handleControlMessage` applies, and for the same
    // reason: this frame is the one that *completes* a handoff, and its
    // authorization is the durable route stored under `topicKey` while the
    // plaintext handed to `assignedTopics` and the transport is `topic`. Route
    // records are plain localStorage, so a same-origin script can read the real
    // key, the previous owner's id and the generation to pass every staleness
    // check below, and still name the channel this worker subscribes.
    if (createOpaqueKey(message.topic) !== message.topicKey) return;
    const route = this.readRoute(message.topicKey);
    if (!route || this.isStaleRouteRelease(route, message)) return;
    this.assignedTopics.set(message.topicKey, message.topic);
    this.confirmRoute(message.topicKey);
    this.handlers.onControl(CONTROL_ACTION.SUBSCRIBE, message.topic, undefined);
    this.updateLoad();
  }

  /** A ROUTE_RELEASED is stale (and must be dropped) unless the route still
   * points to us, the release comes from the recorded previous owner, and
   * the release generation exactly matches ours. A delayed ACK from either an
   * earlier or later handoff round belongs to a different route and must not
   * confirm the current round. */
  private isStaleRouteRelease(
    route: WorkerRoute,
    message: Extract<WorkerClusterMessage, { type: typeof CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED }>
  ): boolean {
    return (
      route.workerId !== this.workerId ||
      route.handoffFromWorkerId !== message.sourceWorkerId ||
      message.generation !== route.generation
    );
  }

  /** True when an unconfirmed handoff route has been stuck longer than a
   * worker TTL. The ACK for a live handoff is posted synchronously with the
   * route write, so anything older than the TTL with a dead previous owner
   * will never complete — while a fresh unconfirmed route may simply be
   * waiting out its confirmation flush and must be left alone. */
  private isStaleHandoff(route: WorkerRoute): boolean {
    return this.environment.now() - route.updatedAt > this.workerTtlMs;
  }

  /** Full reconciliation cycle: workers, subscriptions, and assigned topics. */
  private reconcile(): void {
    // Zero-count, and the window that could reach it closed with the checks in
    // `activate()`. Four callers, each gated: the call at the end of `activate()`
    // is now behind the second liveness check, the heartbeat tick can only fire
    // for an interval armed under that same check, `handleVisibilityChange` tests
    // `started` before calling it, and `handleMessage`'s REGISTRY branch is
    // reached through the message listener that `pause()` removes. That removal is
    // three statements *after* `pause()` clears `started`, so the ordering alone
    // would not be enough — and the statement list does not close it either. What
    // sits between is a boolean assignment, a conditional
    // `this.environment.clearInterval(…)`, and a `heartbeatHandle` write, and the
    // middle one is a call into adapter code: an adapter that ran anything
    // synchronous there would deliver a REGISTRY to a listener still attached. That
    // is the same custom-adapter premise `activate()`'s first liveness check is
    // written against, so this guard, not the absence of calls, is what closes the
    // window. The census over the whole suite saw this method entered with
    // `started` true in both of its distinct vectors (`storage` true in one,
    // false in the other). Of the four callers, two re-test `started` locally and
    // the REGISTRY leg is closed as above; the heartbeat tick is the one that
    // relies on this line, and what it actually depends on is `pause()` clearing
    // the interval that armed it. Keep the guard: it is the only statement of the
    // invariant in the method that needs it, so a fifth caller cannot arrive
    // ungated.
    if (!this.started) return;
    const workers = this.reconcileWorkers();
    // Runs before the subscription pass so a route released here is re-elected by
    // its remaining subscribers inside the same cycle, not one heartbeat later.
    this.reconcileStrandedSelfRoutes();
    const activeWorkers = selectActiveWorkers(workers, this.maxActiveWorkers);
    this.reconcileSubscriptions(workers, activeWorkers);
    this.reconcileAssignedTopics();
    this.updateLoad();
  }

  /** Prune stale workers/subscribers/routes and refresh role. Returns the live worker list.
   * Subscribers are cleaned before routes so cleanupOrphanedRoutes sees the
   * updated subscriber set when deciding whether a route is truly orphaned. */
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
    // Projected loads for stranded-handoff re-elections within this pass,
    // mirroring handoffAssignedTopics(): without it, every stranded topic
    // would pile onto the same least-loaded worker from the pass-start
    // snapshot — and routes are sticky, so the imbalance would persist.
    const recoveryProjectedLoads = new Map<string, number>();

    for (const topic of this.subscribedTopics) {
      const topicKey = this.rememberTopic(topic);
      this.writeSubscriber(topicKey);
      const route = this.readRoute(topicKey);
      if (!route || !liveWorkerIds.has(route.workerId)) {
        const owner = selectLeastLoadedWorker(activeWorkers, undefined, this.loadWeighting) ?? this.currentRecord;
        // A route invalidated by owner departure or heartbeat expiry is
        // recovered immediately. Graceful pagehide uses the strict ACK path in
        // handoffAssignedTopics(), where the departing owner is still known.
        // The `?? this.currentRecord` above is never taken, for the reason
        // recorded at `subscribe()`'s identical pair: `reconcile()` runs only
        // while started, and `readWorkers()` supplies this record when storage
        // names nobody.
        this.writeRoute(topicKey, owner, undefined, (route?.generation ?? 0) + 1);
        this.sendControl(owner.workerId, CONTROL_ACTION.SUBSCRIBE, topic, topicKey);
        this.notifyRegistry();
        continue;
      }
      if (route.confirmedAt === undefined) {
        // During a handoff, the new owner waits for ROUTE_RELEASED from the
        // previous owner. Retrying SUBSCRIBE here would recreate overlap.
        if (!route.handoffFromWorkerId) {
          this.sendControl(route.workerId, CONTROL_ACTION.SUBSCRIBE, topic, topicKey);
        } else if (!liveWorkerIds.has(route.handoffFromWorkerId) && this.isStaleHandoff(route)) {
          // The previous owner is gone, its ROUTE_RELEASED never arrived
          // (dropped channel message under load, or a crash between the route
          // write and the ACK), AND the handoff has been stuck longer than a
          // worker TTL. Waiting longer cannot help — nobody remains who could
          // send the ACK — and the route would strand unconfirmed forever:
          // the new owner keeps waiting while peers treat the live new owner
          // as authoritative and stay out. Re-elect a live owner and clear
          // the handoff marker so the normal confirmation path can complete.
          // The age gate matters: a fresh handoff route may simply not have
          // its confirmation flushed through the batching writer yet, and a
          // peer reconciling in that window must not mistake it for a
          // stranded one. While the previous owner is still alive this branch
          // is unreachable, so the strict handoff keeps its no-overlap
          // guarantee.
          // The third `?? this.currentRecord` in this class. Why it can never be
          // taken, and that it is a type narrowing rather than a behavior, is
          // enumerated at `subscribe()`'s copy; this one is the widest of the three,
          // seven `tsc` rejections across its projected-load set, its three
          // `owner.workerId` reads and its own `writeRoute`.
          const owner = selectLeastLoadedWorker(
            activeWorkers.map(worker => ({ ...worker, load: recoveryProjectedLoads.get(worker.workerId) ?? worker.load })),
            undefined,
            this.loadWeighting
          ) ?? this.currentRecord;
          recoveryProjectedLoads.set(owner.workerId, (recoveryProjectedLoads.get(owner.workerId) ?? owner.load) + 1);
          // Single-writer rule: only the elected owner performs the
          // re-election. Peers that compute a different owner stand down and
          // wait for its write. Concurrent writes from divergent views would
          // ping-pong generations and drop confirmations — every fresh write
          // is unconfirmed by construction, so two writers rewriting the same
          // route keep invalidating each other's confirmations and re-send
          // SUBSCRIBEs every pass. Standing down is always safe: the elected
          // owner reconciles on its own heartbeat, and if views disagree this
          // round they converge on the next flush (bounded by one heartbeat),
          // after which every peer computes the same owner.
          // Exception: when the elected owner has no local subscription it
          // will never reconcile this topic, so standing down would stall
          // forever. Fall back to writing the route and notifying it
          // directly (assigning without a local subscription is exactly what
          // the graceful handoff and the crash path already do).
          if (owner.workerId !== this.workerId) {
            const subscriberTabIds = new Set(this.readSubscriberTabIds(topicKey, workers));
            const ownerSubscribed = workers.some(
              worker => worker.workerId === owner.workerId && subscriberTabIds.has(worker.tabId)
            );
            if (ownerSubscribed) continue;
          }
          this.writeRoute(topicKey, owner, undefined, route.generation + 1);
          this.sendControl(owner.workerId, CONTROL_ACTION.SUBSCRIBE, topic, topicKey);
          this.handlers.onDiagnostic?.({ operation: RELIABILITY_OPERATION.ROUTE_MIGRATION_RECOVERY, topic });
          this.notifyRegistry();
        }
      }
    }
  }

  /**
   * Repair a confirmed route that names this Worker while its assignment is gone.
   *
   * Every write that settles ownership stamps the new owner's assignment in the
   * same task as the confirmation (`confirmRoute()` has exactly three call sites,
   * each directly after an `assignedTopics.set`), so a route carrying
   * `confirmedAt` while this map has no entry can only mean the assignment was
   * taken *after* the route settled. That is what `pause()` does: it clears the
   * map unconditionally but rewrites only the routes it can hand off, so a
   * handoff whose final flush is cut short by a storage failure — and the
   * `discardPending()` that ends the teardown throws the rest away — leaves a
   * durable route naming this worker. If the same worker id registers again (a
   * BFCache restore, or a runtime rebuilt with an explicit `workerId`), every
   * peer reads that route as a live, confirmed owner and stands down, while no
   * worker holds a transport subscription for the topic any more. Both reconcile
   * passes miss it by construction: one walks `subscribedTopics`, the other
   * `assignedTopics`, and the phantom is in neither.
   *
   * Acting here is this worker's alone — a peer that elected it is still waiting
   * for its own CONTROL/SUBSCRIBE to be accepted, and the single-writer rule
   * recorded in `reconcileSubscriptions()` forbids anyone else rewriting the
   * record. Reclaim when the local subscription is still live, which restores the
   * assignment and the transport subscription without touching the route, so the
   * owner and its generation stay exactly as peers recorded them; release
   * otherwise, since an owner that has no handler for the topic and never will is
   * a record nothing can act on.
   */
  private reconcileStrandedSelfRoutes(): void {
    if (!this.storage) return;
    let released = false;
    for (const { key, value: route } of readAllByPrefix<WorkerRoute>(this.storage, this.routePrefix)) {
      // The addressee and the confirmation both have to hold: an unconfirmed
      // route naming this worker is an election or a handoff still in flight, and
      // taking it over would put two transport subscriptions on one topic — the
      // overlap the strict handoff exists to prevent.
      if (route.confirmedAt === undefined || route.workerId !== this.workerId) continue;
      if (this.assignedTopics.has(route.topicKey)) continue;
      // `knownTopics` is the only place a stored key is ever paired with its
      // plaintext, and it answers only for a key this worker hashed itself, so
      // the reclaim leg cannot be steered by a hand-written route record.
      const topic = this.knownTopics.get(route.topicKey);
      if (topic !== undefined && this.subscribedTopics.has(topic)) {
        // The same self-assignment `subscribe()` performs for a local owner: it
        // sets the map and asks the transport, and leaves the durable record
        // byte-identical because `confirmRoute()` no-ops on a confirmed route.
        this.sendControl(this.workerId, CONTROL_ACTION.SUBSCRIBE, topic, route.topicKey);
        continue;
      }
      // No local handler and no way to name the topic: drop the record and nudge,
      // so a remaining subscriber elects an owner it can act on.
      this.removeStorage(key);
      released = true;
    }
    if (released) {
      // Flush before nudging, for the reason recorded in `pause()` and in
      // `handoffAssignedTopics()`: the deletion is queued in this worker's
      // batching writer, so a peer that reconciles on the nudge would otherwise
      // read the route that is still on disk, stand down, and wait a heartbeat
      // for the write to land.
      this.flushStorage();
      this.notifyRegistry();
    }
  }

  /** Drop assignments where the route no longer points to this worker. */
  private reconcileAssignedTopics(): void {
    for (const [topicKey, topic] of [...this.assignedTopics]) {
      const route = this.readRoute(topicKey);
      if (route?.workerId === this.workerId) continue;
      this.assignedTopics.delete(topicKey);
      this.handlers.onControl(CONTROL_ACTION.UNSUBSCRIBE, topic, undefined);
      if (route?.handoffFromWorkerId === this.workerId) {
        this.sendRouteReleased(route.workerId, topic, topicKey, route.generation);
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
    data?: unknown,
    metadata?: DataBusPublicationMetadata
  ): boolean {
    if (targetWorkerId === this.workerId) {
      switch (action) {
        case CONTROL_ACTION.SUBSCRIBE:
          this.assignedTopics.set(topicKey, topic);
          this.confirmRoute(topicKey);
          break;
        case CONTROL_ACTION.UNSUBSCRIBE:
          this.assignedTopics.delete(topicKey);
          break;
        case CONTROL_ACTION.PUBLISH:
        default:
          break;
      }
      if (metadata) this.handlers.onControl(
        action,
        topic,
        data,
        metadata.messageId,
        metadata.timestamp
      );
      else this.handlers.onControl(action, topic, data);
      if (action !== CONTROL_ACTION.PUBLISH) this.updateLoad();
      return true;
    }
    return this.send({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: this.workerId,
      targetWorkerId,
      action,
      topic,
      topicKey,
      ...(data === undefined ? {} : { data }),
      ...(metadata?.messageId === undefined ? {} : { messageId: metadata.messageId }),
      ...(metadata?.timestamp === undefined ? {} : { timestamp: metadata.timestamp })
    });
  }

  /** Post a message on the BroadcastChannel. Returns false on postMessage failure. */
  private send(message: WorkerClusterMessage): boolean {
    if (!this.channel) return false;
    try {
      this.channel.postMessage({ ...message, protocolVersion: CLUSTER_PROTOCOL_VERSION });
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
    for (const { key, value: worker } of readAllByPrefix<WorkerRecord>(this.storage, this.workerPrefix)) {
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
    if (!this.storage) {
      // Degraded mode: only this tab can be a subscriber. Recover the plaintext
      // topic to check local interest — without it we cannot know if we care.
      const topic = this.knownTopics.get(topicKey);
      return topic && this.subscribedTopics.has(topic) ? [this.tabId] : [];
    }
    const activeTabIds = new Set(workers.map(worker => worker.tabId));
    const subscribers = new Set<string>();
    for (const { key, value: record } of readAllByPrefix<TopicSubscriberRecord>(
      this.storage,
      `${this.subscriberPrefix}${topicKey}:`
    )) {
      if (!activeTabIds.has(record.tabId)) {
        this.removeStorage(key);
        continue;
      }
      subscribers.add(record.tabId);
    }
    return Array.from(subscribers);
  }

  /** Read the current route for `topicKey`. With a storage layer this returns
   * the durable route, or null when none is recorded. Without one (degraded
   * mode) it returns the synthesized local route from `buildLocalRoute`, which
   * is itself null unless this worker actually holds the topic. */
  private readRoute(topicKey: string): WorkerRoute | null {
    if (!this.storage) return this.buildLocalRoute(topicKey);
    return readJson<WorkerRoute>(this.storage, this.routeStorageKey(topicKey));
  }

  /** Synthesize a self-owned route when storage is unavailable (degraded mode).
   * The plaintext topic must be recoverable from the knownTopics cache; a
   * missing entry means we never subscribed to or were assigned the topic,
   * so there is no route to report. */
  private buildLocalRoute(topicKey: string): WorkerRoute | null {
    const topic = this.knownTopics.get(topicKey);
    if (!topic) return null;
    if (!this.subscribedTopics.has(topic) && !this.assignedTopics.has(topicKey)) return null;
    return {
      topicKey,
      workerId: this.workerId,
      tabId: this.tabId,
      updatedAt: this.environment.now(),
      generation: 1
    };
  }

  /** Persist a route assignment, mapping `topicKey` to the owning Worker. */
  private writeRoute(
    topicKey: string,
    owner: WorkerRecord,
    handoffFromWorkerId?: string,
    generation = 1
  ): void {
    // Degraded mode has one guard per accessor: three readers synthesize a value
    // (`readWorkers` returns just this worker, `readRoute` a `buildLocalRoute()`,
    // `readSubscriberTabIds` just this tab), and six writer/pass methods bail out
    // early — this one, `confirmRoute`, `writeSubscriber`, `cleanupOrphanedRoutes`,
    // `cleanupOrphanedSubscribers` and `reconcileStrandedSelfRoutes`. Of those six
    // early returns only this one is zero-count, and the census agrees with the
    // caller list: two distinct entry vectors across the suite, `storage` non-null
    // in both (one with `started` false, which is `handoffAssignedTopics()`
    // running after `pause()` cleared it). Why no caller can bring it a null
    // `storage`: `subscribe()` takes its own `!this.storage` leg before reaching
    // this call, `handoffAssignedTopics()` returns on `!this.storage` before its
    // loop, and `reconcileSubscriptions()`'s two calls both sit behind
    // `readRoute()` having returned a record — which in degraded mode is
    // `buildLocalRoute()`, self-owned and with no `handoffFromWorkerId`, so the
    // live-owner test rules out the first and the handoff test the second. The
    // contrast with `writeSubscriber`, whose identical guard *is* covered, is one
    // line: `reconcileSubscriptions()` calls that one unconditionally. Deleting
    // this line is a compile error (measured: one, `StorageLike | null` is not
    // assignable to the `writeJson` parameter), so a future caller cannot drop the
    // guard quietly — the type, not a test, is what holds it.
    if (!this.storage) return;
    writeJson(this.storage, this.routeStorageKey(topicKey), this.buildRouteRecord(topicKey, owner, handoffFromWorkerId, generation));
  }

  /** Construct a WorkerRoute record from the owner + handoff fields. Extracted
   * so writeRoute and confirmRoute share the same shape; confirmedAt is added
   * by confirmRoute via spread. */
  private buildRouteRecord(
    topicKey: string,
    owner: WorkerRecord,
    handoffFromWorkerId: string | undefined,
    generation: number
  ): WorkerRoute {
    return {
      topicKey,
      workerId: owner.workerId,
      tabId: owner.tabId,
      updatedAt: this.environment.now(),
      generation,
      ...(handoffFromWorkerId ? { handoffFromWorkerId } : {})
    };
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
    const topic = this.knownTopics.get(topicKey);
    if (topic) this.handlers.onDiagnostic?.({ operation: RELIABILITY_OPERATION.ROUTE_ACK, topic });
  }

  /** Remove routes whose topic has no subscribers and whose TTL has expired. */
  private cleanupOrphanedRoutes(workers: readonly WorkerRecord[]): void {
    if (!this.storage) return;
    const now = this.environment.now();
    for (const { key, value: route } of readAllByPrefix<WorkerRoute>(this.storage, this.routePrefix)) {
      if (now - route.updatedAt <= this.workerTtlMs) continue;
      if (this.readSubscriberTabIds(route.topicKey, workers).length > 0) continue;
      this.removeStorage(key);
    }
  }

  /** Remove subscriber records for tabs that are no longer active. */
  private cleanupOrphanedSubscribers(workers: readonly WorkerRecord[]): void {
    if (!this.storage) return;
    const activeTabIds = new Set(workers.map(worker => worker.tabId));
    for (const { key, value: record } of readAllByPrefix<TopicSubscriberRecord>(this.storage, this.subscriberPrefix)) {
      if (!activeTabIds.has(record.tabId)) this.removeStorage(key);
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

  /** Persist the current worker record with an updated heartbeat timestamp.
   * @param notify — when true, broadcast a REGISTRY nudge so peers reconcile
   *   immediately instead of waiting for the next heartbeat. False on the
   *   periodic heartbeat tick (peers will notice on their own heartbeat) to
   *   avoid a REGISTRY storm every 3 s. Which sites pass what: activation,
   *   status, visibility and load changes pass true; the heartbeat tick and a
   *   role change pass false. */
  private writeRecord(notify: boolean): void {
    const now = this.environment.now();
    const sample = this.loadWeighting !== undefined ? this.sampleThroughput(now) : undefined;
    this.currentRecord = {
      ...this.currentRecord,
      heartbeatAt: now,
      ...(sample ? { throughput: sample } : {})
    };
    if (this.storage) writeJson(this.storage, this.workerStorageKey(this.workerId), this.currentRecord);
    if (notify) this.notifyRegistry();
  }

  /** Broadcast a REGISTRY message to trigger reconciliation on other tabs. */
  private notifyRegistry(): void {
    this.send({ type: CLUSTER_MESSAGE_TYPE.REGISTRY, sourceWorkerId: this.workerId });
  }

  /** Recompute whether this worker is active (eligible to own topics) or standby. Returns true when changed. */
  private refreshRole(workers: readonly WorkerRecord[]): boolean {
    const role: WorkerRole = this.isActiveAmong(workers) ? WORKER_ROLE.ACTIVE : WORKER_ROLE.STANDBY;
    if (role === this.currentRecord.role) return false;
    this.currentRecord = { ...this.currentRecord, role };
    return true;
  }

  /** Persist the current topic load count (number of assigned topics) for load-balanced routing. */
  private updateLoad(): void {
    const load = this.assignedTopics.size;
    if (load === this.currentRecord.load) return;
    this.currentRecord = { ...this.currentRecord, load };
    // `sendControl()` runs a self-addressed SUBSCRIBE's handler synchronously
    // before returning, and that handler is application code — at the bus layer
    // it goes through `subscribeTransport()` into the host's
    // `transport.subscribe()`. A host that calls `stop()` from there therefore
    // arrives here with the assignment set already changed and `started` already
    // false, and writing now would republish the record `pause()` just removed.
    // Peers read liveness out of that record, so the stale version keeps topics
    // and publications pointed at a channel that is closed until the TTL
    // expires. It is the only write in that window: `confirmRoute()` runs before
    // the handler, and `notifyRegistry()` goes through `send()`, which returns
    // early once `channel` is null. Pinned by
    // tests/cluster.test.ts's 'publishes no worker record when a control handler
    // stops the cluster mid-subscribe', which is the only test that fails when
    // this guard is deleted.
    if (this.started) this.writeRecord(true);
  }

  /**
   * Hash `topic` into its opaque key and populate the reverse-lookup cache.
   *
   * Despite the name, this is NOT a cache lookup — it unconditionally writes
   * the `topicKey → topic` pair. Hashing is cheap enough that a caller needing
   * the key should always call this rather than check `knownTopics` first;
   * the cache's FIFO eviction below keeps it bounded. Two sites deliberately
   * bypass it, and for the same kind of reason — neither may write a plaintext
   * into the reverse cache before it is authorized: `isAssigned` re-derives the
   * key as a read-only query, and the `ROUTE_RELEASED` handler hashes the
   * frame's own `topic` only to compare it against `topicKey`, on a channel
   * where that field is attacker-controlled until the comparison passes. (The
   * `CONTROL` handler performs the same re-derivation but then *does* call this
   * method, so it is not a bypass.) If you add a new call site, prefer
   * `rememberTopic` unless you have one of those reasons.
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
      // Scan from the front (oldest insertion) for the first non-owned entry.
      // `break` after one eviction: we only need to get back under the cap, and
      // evicting more would unnecessarily drop resolvable topics. If every
      // entry is owned (degenerate), the loop completes without evicting —
      // owned topics must stay resolvable for the storage-less read path.
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
