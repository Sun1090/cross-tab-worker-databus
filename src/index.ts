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

export { CrossTabDataBus } from './core/data-bus.js';
export type { CrossTabDataBusOptions, DataBusDedupOptions, DataBusDedupStats, DataBusDiagnostics, DataBusFailureSource, DataBusHealthSummary, DataBusLastFailure, DataBusPersistenceHealth, DataBusPersistenceRetryOptions, DataBusReplayOptions } from './core/data-bus.js';
export { createIndexedDbReplayPersistence } from './core/replay-persistence.js';
export type { DataBusReplayPersistence, IndexedDbReplayPersistenceOptions } from './core/replay-persistence.js';
export type {
  DataBusCoordinationTraceEvent,
  DataBusErrorTraceEvent,
  DataBusLifecycleTraceEvent,
  DataBusMetricsTraceEvent,
  DataBusReliabilityTraceEvent,
  DataBusStatusTraceEvent,
  DataBusSubscriptionTraceEvent,
  DataBusMetricsSnapshot,
  DataBusTraceEvent,
  DataBusTraceMode,
  DataBusTraceOptions
} from './core/trace.js';
export { WorkerClusterRuntime } from './core/cluster.js';
export type {
  WorkerClusterHandlers,
  WorkerClusterOptions,
  WorkerClusterSnapshot
} from './core/cluster.js';
export { createBrowserEnvironment, createStorageEventChannel, getOrCreateTabId } from './core/environment.js';
export type { ClusterChannel, ClusterEnvironment, StorageEventWindow, StorageLike } from './core/environment.js';
export { createOpaqueKey } from './core/hash.js';
export {
  WebSocketTransport,
  createWebSocketDataBus
} from './websocket.js';
export type {
  CreateWebSocketDataBusOptions,
  WebSocketDataBusConfig,
  WebSocketLike
} from './websocket.js';
export { selectWorkerBackend } from './worker-mode.js';
export type { WorkerAvailability, WorkerBackend, WorkerMode } from './worker-mode.js';
export {
  DEFAULT_MAX_ACTIVE_WORKERS,
  approximatePayloadBytes,
  effectiveWorkerLoad,
  hasActiveOwner,
  isWildcardTopic,
  selectActiveWorkers,
  selectLeastLoadedWorker,
  selectRebalanceTarget,
  topicMatchesPattern
} from './core/routing.js';
export type {
  DataBusErrorHandler,
  DataBusMessage,
  DataBusPublication,
  DataBusPublicationEnvelope,
  DataBusPublicationItem,
  DataBusPublicationMetadata,
  DataBusPublishOptions,
  DataBusMessageHandler,
  DataBusStatusHandler,
  DataBusTransport,
  DataBusTransportHandlers,
  LoadWeightingOptions,
  MaybePromise,
  TabVisibilityState,
  TopicSubscriberRecord,
  WorkerClusterMessage,
  WorkerControlAction,
  WorkerRecord,
  WorkerRole,
  WorkerRoute,
  WorkerStatus,
  WorkerThroughputSample
} from './core/types.js';
