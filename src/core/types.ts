/**
 * Core type definitions for the cross-tab DataBus.
 *
 * Defines the shapes of Worker records, topic routes, control messages,
 * transport interfaces, trace events, and all supporting types used across
 * the cluster coordination, DataBus public API, and diagnostics layers.
 */

/** Convenience alias for values that may be synchronously returned or as a
 * Promise. Used by the DataBusTransport contract so implementations can be
 * either sync or async without changing the call signature. */
export type MaybePromise<T> = T | Promise<T>;

/** Whether this Worker can act as a Topic owner. `active` workers are eligible
 * for new topic assignments; `standby` workers hold existing assignments but
 * are not selected for new ones (e.g. a hidden tab that already owns topics). */
export type WorkerRole = 'active' | 'standby';

/** Connection-level status of the transport. `error` triggers auto-recovery
 * (subject to a cooldown); `disconnected` is a clean or suspend state. */
export type WorkerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Control-plane actions routed between Workers via BroadcastChannel.
 * These are the three operations a subscriber asks the owning worker to perform. */
export type WorkerControlAction = 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'PUBLISH';

/** Transport-neutral metadata attached to a publication. */
export interface DataBusPublicationMetadata {
  /** Stable caller/server identifier propagated through the cluster and wire protocol. */
  messageId?: string;
  /** Producer-assigned Unix timestamp in milliseconds, used by retention policies. */
  timestamp?: number;
}

/** Optional metadata attached to an outbound publication. */
export type DataBusPublishOptions = DataBusPublicationMetadata;

/** Canonical transport-neutral publication shape. */
export interface DataBusPublication<TData = unknown> extends DataBusPublicationMetadata {
  topic: string;
  data: TData;
}

/** Forward-compatible JSON envelope accepted from WebSocket-style servers. */
export interface DataBusPublicationEnvelope<TData = unknown> {
  op: 'publication';
  publication: DataBusPublication<TData>;
}

/** Whether the tab is currently visible to the user. Only influences placement
 * of NEW topic routes; existing routes are sticky and never migrated on hide. */
export type TabVisibilityState = 'visible' | 'hidden';

/**
 * A Worker's self-published registration record, written to localStorage
 * so sibling tabs can discover and route to it.
 */
export interface WorkerRecord {
  /** Stable identity of this runtime instance. Random-suffixed; survives refresh. */
  workerId: string;
  /** Identity of the browser tab hosting this worker. Survives refresh. */
  tabId: string;
  /** Number of topics this Worker owns. NOT a CPU load metric. */
  load: number;
  role: WorkerRole;
  status: WorkerStatus;
  visibilityState: TabVisibilityState;
  /** Last heartbeat write timestamp (ms). Workers past `workerTtlMs` are pruned. */
  heartbeatAt: number;
  /** First registration timestamp (ms). Used for deterministic ordering in owner selection. */
  registeredAt: number;
}

/**
 * A topic-to-Worker mapping stored in localStorage. The route is written
 * by the subscriber's Runtime and confirmed by the owner once it processes
 * the SUBSCRIBE control message.
 */
export interface WorkerRoute {
  /** Opaque 128-bit hash of the topic name (never the plaintext). */
  topicKey: string;
  /** The workerId that owns this topic's transport subscription. */
  workerId: string;
  /** The tabId of the owning worker. */
  tabId: string;
  /** Timestamp (ms) of the last route write. Used for orphan-TTL cleanup. */
  updatedAt: number;
  /** Monotonic route generation; handoff acknowledgements must match it to
   * prevent a stale ACK from authorizing a superseded owner. */
  generation: number;
  /** Previous owner that must release its transport subscription before the
   * new owner takes over (graceful handoff only). */
  handoffFromWorkerId?: string;
  /** Set by the owner when it has processed the SUBSCRIBE. Absent → the
   * subscriber will retry the control message to recover from channel loss. */
  confirmedAt?: number;
}

/** Per-tab-per-topic marker stored in localStorage so the cluster knows which
 * tabs still need a topic. Each tab writes its own record independently,
 * avoiding read-modify-write contention on a shared array. */
export interface TopicSubscriberRecord {
  /** The tab that holds this subscription. */
  tabId: string;
  /** Timestamp (ms) of the last subscriber write. */
  updatedAt: number;
}

/**
 * Messages exchanged over the BroadcastChannel. Four types:
 * - CONTROL: point-to-point action (SUBSCRIBE / UNSUBSCRIBE / PUBLISH)
 * - EVENT: fan-out publications from the owning Worker to all tabs
 * - REGISTRY: nudge every tab to reconcile immediately
 * - ROUTE_RELEASED: ACK a graceful handoff (only matching generation acts)
 */
export type WorkerClusterMessage<TEvent = unknown> =
  /** A subscriber asks the target worker to perform an action on a topic.
   * Carries the plaintext topic (for transport calls) and the opaque key
   * (for storage/route bookkeeping). */
  | {
      type: 'CONTROL';
      sourceWorkerId: string;
      targetWorkerId: string;
      action: WorkerControlAction;
      topic: string;
      topicKey: string;
      /** Present only for PUBLISH actions; the publication payload.
       * Mutually exclusive with `items` — a single-message PUBLISH carries
       * `data`, a batched PUBLISH carries `items`. */
      data?: unknown;
      /** Optional stable identifier for the publication. */
      messageId?: string;
      /** Optional producer timestamp propagated with PUBLISH actions. */
      timestamp?: number;
      /** Present only for batched PUBLISH actions. When set, the receiver
       * unpacks each entry into an individual publication, preserving order
       * and applying per-item dedup/replay. The receiver ignores `data`,
       * `messageId`, and `timestamp` when `items` is set. */
      items?: Array<{ data: unknown; messageId?: string; timestamp?: number }>;
    }
  /** The owning worker fans out a publication to every tab. `eventType`
   * distinguishes databus publications from future event types.
   * `originTabId` (when present) is the browser tab that produced the event;
   * it survives the EVENT hop so listeners can tell local dispatch from
   * cross-tab relay, including for late subscribers replaying history. */
  | {
      type: 'EVENT';
      sourceWorkerId: string;
      eventType: string;
      payload: TEvent;
      originTabId?: string;
    }
  /** Nudge peers to reconcile immediately after a registry/route/subscriber
   * write, instead of waiting for the next heartbeat (3 s default). */
  | {
      type: 'REGISTRY';
      sourceWorkerId: string;
    }
  /** The old owner acknowledges it released the transport subscription.
   * Only the new owner whose route `generation` matches may act on this. */
  | {
      type: 'ROUTE_RELEASED';
      sourceWorkerId: string;
      targetWorkerId: string;
      topic: string;
      topicKey: string;
      generation: number;
    };

/** A publication delivered to a topic handler: the topic name and the
 * structured-clone-safe payload. */
export interface DataBusMessage<TData = unknown> extends DataBusPublication<TData> {
  /** True when this delivery is a historical replay (see the `replay`
   * subscription option) rather than a live publication. */
  replayed?: boolean;
  /** Identifier of the browser tab that originally produced this publication.
   * Carried across the cluster EVENT hop so handlers can distinguish local
   * dispatch from cross-tab relay, and so late subscribers replaying history
   * can still attribute each entry to its source tab. */
  originTabId?: string;
}

/** Callbacks the transport calls to notify the DataBus of events.
 * The DataBus wires these once during `start()`; the transport must hold
 * the reference and call them for the lifetime of the connection. */
export interface DataBusTransportHandlers<TData = unknown> {
  /** A publication arrived from the server for a topic this worker owns. */
  onMessage: (message: DataBusMessage<TData>) => void;
  /** The connection status changed. `error` triggers auto-recovery. */
  onStatus: (status: WorkerStatus) => void;
  /** A non-fatal transport error occurred. Does not imply disconnection. */
  onError: (error: unknown) => void;
}

/**
 * Transport abstraction that the DataBus delegates to for real I/O.
 * Implementations may wrap a WebSocket library, a Worker, or a mock.
 *
 * Contract requirements:
 * - `subscribe` / `unsubscribe` MUST be idempotent (called on reconnect).
 * - `start` is called once per lifecycle; `stop` is idempotent.
 * - `publish` may be called before `start` settles (queued by the DataBus).
 */
export interface DataBusTransport<TConfig = unknown, TData = unknown> {
  /** Open the connection with `config`. Report status changes via `handlers.onStatus`.
   * May return a Promise that resolves on connect or rejects on failure. */
  start(config: TConfig, handlers: DataBusTransportHandlers<TData>): MaybePromise<void>;
  /** Subscribe to a topic. Idempotent: re-subscribing an active topic is a no-op. */
  subscribe(topic: string): MaybePromise<void>;
  /** Unsubscribe from a topic. Idempotent: unsubscribing a non-subscribed topic is a no-op. */
  unsubscribe(topic: string): MaybePromise<void>;
  /** Publish `data` to `topic` via the server. */
  publish(topic: string, data: unknown, options?: DataBusPublishOptions): MaybePromise<void>;
  /** Close the connection and release all resources. Safe to call multiple times. */
  stop(): MaybePromise<void>;
}

/** Callback invoked for each publication delivered to a subscribed topic. */
export type DataBusMessageHandler<TData = unknown> = (message: DataBusMessage<TData>) => void;
/** Callback invoked on every transport status change. */
export type DataBusStatusHandler = (status: WorkerStatus) => void;
/** Callback invoked when the transport or an operation reports an error. */
export type DataBusErrorHandler = (error: unknown) => void;
