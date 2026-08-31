/**
 * cross-tab-worker-databus — public API barrel export.
 *
 * Re-exports every type and class consumers need from the library's
 * internal modules. Consumers import from the package root:
 *
 * ```ts
 * import { CrossTabDataBus, createOpaqueKey } from 'cross-tab-worker-databus';
 * ```
 */

export { CrossTabDataBus } from './core/data-bus';
export type { CrossTabDataBusOptions, DataBusDedupOptions, DataBusReplayOptions } from './core/data-bus';
export { createIndexedDbReplayPersistence } from './core/replay-persistence';
export type { DataBusReplayPersistence, IndexedDbReplayPersistenceOptions } from './core/replay-persistence';
export type {
  DataBusCoordinationTraceEvent,
  DataBusErrorTraceEvent,
  DataBusLifecycleTraceEvent,
  DataBusMetricsTraceEvent,
  DataBusReliabilityTraceEvent,
  DataBusStatusTraceEvent,
  DataBusSubscriptionTraceEvent,
  DataBusTraceEvent,
  DataBusTraceMode,
  DataBusTraceOptions
} from './core/trace';
export { WorkerClusterRuntime } from './core/cluster';
export type {
  WorkerClusterHandlers,
  WorkerClusterOptions,
  WorkerClusterSnapshot
} from './core/cluster';
export { createBrowserEnvironment, getOrCreateTabId } from './core/environment';
export type { ClusterChannel, ClusterEnvironment, StorageLike } from './core/environment';
export { createOpaqueKey } from './core/hash';
export {
  WebSocketTransport,
  createWebSocketDataBus
} from './websocket';
export type {
  CreateWebSocketDataBusOptions,
  WebSocketDataBusConfig,
  WebSocketLike
} from './websocket';
export { selectWorkerBackend } from './worker-mode';
export type { WorkerBackend, WorkerMode } from './worker-mode';
export {
  DEFAULT_MAX_ACTIVE_WORKERS,
  hasActiveOwner,
  isWildcardTopic,
  selectActiveWorkers,
  selectLeastLoadedWorker,
  selectRebalanceTarget,
  topicMatchesPattern
} from './core/routing';
export type {
  DataBusErrorHandler,
  DataBusMessage,
  DataBusMessageHandler,
  DataBusStatusHandler,
  DataBusTransport,
  DataBusTransportHandlers,
  MaybePromise,
  TabVisibilityState,
  TopicSubscriberRecord,
  WorkerClusterMessage,
  WorkerControlAction,
  WorkerRecord,
  WorkerRole,
  WorkerRoute,
  WorkerStatus
} from './core/types';
