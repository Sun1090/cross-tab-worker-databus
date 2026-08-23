/**
 * Core type definitions for the cross-tab DataBus.
 *
 * Defines the shapes of Worker records, topic routes, control messages,
 * transport interfaces, trace events, and all supporting types used across
 * the cluster coordination, DataBus public API, and diagnostics layers.
 */

/** Convenience alias for values that may be synchronously returned or Promise. */
export type MaybePromise<T> = T | Promise<T>;

/** Whether this Worker can act as a Topic owner. */
export type WorkerRole = 'active' | 'standby';
/** Connection-level status of the transport. */
export type WorkerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
/** Control-plane actions routed between Workers via BroadcastChannel. */
export type WorkerControlAction = 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'PUBLISH';
/** Whether the tab is currently visible to the user. */
export type TabVisibilityState = 'visible' | 'hidden';

/**
 * A Worker's self-published registration record, written to localStorage
 * so sibling tabs can discover and route to it.
 */
export interface WorkerRecord {
  workerId: string;
  tabId: string;
  /** Number of topics this Worker owns. Not a CPU load. */
  load: number;
  role: WorkerRole;
  status: WorkerStatus;
  visibilityState: TabVisibilityState;
  /** Last heartbeat write timestamp (ms). */
  heartbeatAt: number;
  /** First registration timestamp (ms). Used for deterministic ordering. */
  registeredAt: number;
}

/**
 * A topic-to-Worker mapping stored in localStorage. The route is written
 * by the subscriber's Runtime and confirmed by the owner once it processes
 * the SUBSCRIBE control message.
 */
export interface WorkerRoute {
  topicKey: string;
  workerId: string;
  tabId: string;
  updatedAt: number;
  /** Monotonic route generation; handoff acknowledgements must match it. */
  generation: number;
  /** Previous owner must release its transport subscription before takeover. */
  handoffFromWorkerId?: string;
  /** Set by the owner when it has processed the SUBSCRIBE. Absent → subscriber will retry. */
  confirmedAt?: number;
}

/** Per-tab-per-topic marker stored in localStorage so the cluster knows which tabs still need a topic. */
export interface TopicSubscriberRecord {
  tabId: string;
  updatedAt: number;
}

/**
 * Messages exchanged over the BroadcastChannel. Three types:
 * - CONTROL: direct peer-to-peer actions (SUBSCRIBE / UNSUBSCRIBE / PUBLISH)
 * - EVENT: fan-out publications from the owning Worker to all tabs
 * - REGISTRY: heartbeat signal that triggers reconciliation on other tabs
 */
export type WorkerClusterMessage<TEvent = unknown> =
  | {
      type: 'CONTROL';
      sourceWorkerId: string;
      targetWorkerId: string;
      action: WorkerControlAction;
      topic: string;
      topicKey: string;
      data?: unknown;
    }
  | {
      type: 'EVENT';
      sourceWorkerId: string;
      eventType: string;
      payload: TEvent;
    }
  | {
      type: 'REGISTRY';
      sourceWorkerId: string;
    }
  | {
      type: 'ROUTE_RELEASED';
      sourceWorkerId: string;
      targetWorkerId: string;
      topic: string;
      topicKey: string;
      generation: number;
    };

export interface DataBusMessage<TData = unknown> {
  topic: string;
  data: TData;
}

/** Callbacks the transport calls to notify the DataBus of events. */
export interface DataBusTransportHandlers<TData = unknown> {
  onMessage: (message: DataBusMessage<TData>) => void;
  onStatus: (status: WorkerStatus) => void;
  onError: (error: unknown) => void;
}

/**
 * Transport abstraction that the DataBus delegates to for real I/O.
 * Implementations may wrap a WebSocket library, a Worker, or a mock.
 * subscribe / unsubscribe MUST be idempotent.
 */
export interface DataBusTransport<TConfig = unknown, TData = unknown> {
  start(config: TConfig, handlers: DataBusTransportHandlers<TData>): MaybePromise<void>;
  subscribe(topic: string): MaybePromise<void>;
  unsubscribe(topic: string): MaybePromise<void>;
  publish(topic: string, data: unknown): MaybePromise<void>;
  stop(): MaybePromise<void>;
}

export type DataBusMessageHandler<TData = unknown> = (message: DataBusMessage<TData>) => void;
export type DataBusStatusHandler = (status: WorkerStatus) => void;
export type DataBusErrorHandler = (error: unknown) => void;
