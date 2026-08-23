> [中文](./zh/api.md) | English

# API Reference

## Package Entry Points

```ts
import {
  CrossTabDataBus,
  type DataBusTraceEvent,
  WorkerClusterRuntime,
  createBrowserEnvironment,
  createOpaqueKey,
  selectWorkerBackend,
  type WorkerMode
} from 'cross-tab-worker-databus';

import {
  CentrifugeWorkerTransport,
  createCentrifugeDataBus
} from 'cross-tab-worker-databus/centrifuge';
```

Business integration should prefer `CrossTabDataBus` or `createCentrifugeDataBus`. `WorkerClusterRuntime` is an advanced coordination API.

## `CrossTabDataBus<TConfig, TData>`

### constructor

```ts
new CrossTabDataBus<TConfig, TData>(options)
```

Creates a DataBus. When `initialConfig` is provided, it starts automatically by default.

### `start(config)`

```ts
start(config: TConfig): Promise<void>
```

Starts cluster coordination and transport. The first call actually starts the transport; concurrent calls during startup share the same start Promise without creating a duplicate transport. After startup succeeds or fails, the internal gate resets: subsequent calls are no-ops on an already-started instance (immediately resolve) and do not restart; after `stop()`, it can be called again to restart.

### `ready()`

```ts
ready(): Promise<void>
```

Waits for the current transport's `start` to complete. The Promise rejects when auto-start fails; calling again can trigger a retry based on `initialConfig`.

When no `initialConfig` is provided and `start(config)` has not been called, `ready()` returns a rejected Promise instead of throwing synchronously, so callers can attach `.catch` and decide whether to start explicitly.

`ready()` is not equivalent to the server being connected; protocol connection status is obtained via `onStatus`.

### `subscribe(topic, handler)`

```ts
subscribe(
  topic: string,
  handler: DataBusMessageHandler<TData>
): () => void
```

Registers a local subscription and returns a cleanup function.

- Multiple handlers for the same topic use reference counting.
- The first handler in the current tab registers a cluster subscription.
- The current tab only leaves the topic after the last handler is released.
- Subscriptions are automatically queued when the transport is not yet ready.

### `unsubscribe(topic, handler?)`

```ts
unsubscribe(topic: string, handler?: DataBusMessageHandler<TData>): void
```

When a handler is provided, only that callback is released; when omitted, all handlers for the topic on the current instance are released.

Prefer using the cleanup function returned by `subscribe` to avoid accidentally removing callbacks from other modules.

### `publish(topic, data)`

```ts
publish(topic: string, data: unknown): void
```

Routes the publish operation to the current topic owner; uses the current Worker when no valid route exists.

Published data must satisfy the serialization constraints of the underlying transport. The SDK does not persist or defer replay of publish commands during page suspension.

When the owning Worker is a remote Tab and the publish control message cannot be posted (for example the BroadcastChannel fails to clone the payload), `publish()` reports the failure through `onError` instead of silently dropping it.

### `onStatus(handler)`

```ts
onStatus(handler: DataBusStatusHandler): () => void
```

Listens for transport status. Receives the current status immediately upon registration.

### `onError(handler)`

```ts
onError(handler: DataBusErrorHandler): () => void
```

Listens for errors in startup, subscription, unsubscription, publishing, and Worker operations.

### `getStatus()`

```ts
getStatus(): WorkerStatus
```

Returns the current status: `connecting`, `connected`, `disconnected`, or `error`.

### `getClusterSnapshot()`

Returns a diagnostic snapshot:

```ts
interface WorkerClusterSnapshot {
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
```

The snapshot is intended for diagnostics and testing, and should not be used as a business state source.

Use `console.table(snapshot.routes)` to inspect all routes with their plaintext topics, or `snapshot.knownTopics` to correlate opaque keys with topics.

### `trace`

Enables optional diagnostics via construction config:

```ts
trace: {
  enabled: true,
  mode: 'all',
  metricsIntervalMs: 5000,
  sink: (event: DataBusTraceEvent) => report(event)
}
```

Low-frequency event types include `lifecycle`, `status`, `subscription`, `coordination`, and `error`; high-frequency data is output as `message_metrics` per window, containing receive/dispatch counts, active topic count, and dispatch latency aggregates (`dispatchSamples`, `dispatchAvgMs`, `dispatchP50Ms`, `dispatchP95Ms`, `dispatchMaxMs`). All public events use a fixed structure and do not contain raw topics, message payloads, connection addresses, or error bodies. Errors thrown by the sink are isolated and do not interrupt message dispatch, but are output to `console.warn` to facilitate diagnosing configuration issues. The sink should ideally not throw — capture expected error conditions in the event data rather than raising exceptions.

### `stop()`

```ts
stop(): Promise<void>
```

Permanently destroys the current instance: cleans up handlers, cluster registration, routes, Workers, and transport. Normal page hide and restore do not require calling this method.

## `DataBusTransport<TConfig, TData>`

```ts
interface DataBusTransport<TConfig, TData> {
  start(config, handlers): void | Promise<void>;
  subscribe(topic): void | Promise<void>;
  unsubscribe(topic): void | Promise<void>;
  publish(topic, data): void | Promise<void>;
  stop(): void | Promise<void>;
}
```

Implementation requirements:

- `subscribe` and `unsubscribe` must be idempotent.
- After `stop`, it must allow `start` to be called again, for BFCache restoration.
- When data is received, call `handlers.onMessage({ topic, data })`.
- When status changes, call `handlers.onStatus(status)`.
- Asynchronous errors are reported via rejection or `handlers.onError(error)`.

## `createCentrifugeDataBus<TData>(options)`

```ts
createCentrifugeDataBus<TData>(options): CrossTabDataBus<CentrifugeDataBusConfig, TData>
```

Creates an auto-starting Centrifuge DataBus. Defaults:

- `clusterKey = connection.url`
- `workerMode = 'dedicated'`, each tab uses an independent Dedicated Worker
- Uses the bundled `centrifuge.worker.js`
- Worker name is `cross-tab-worker-databus`

SharedWorker mode uses the bundled `centrifuge.shared.worker.js`. With `workerMode: 'auto'`, it degrades from SharedWorker to Dedicated Worker to local mode. See [configuration.md](./configuration.md) for full configuration.

## `CentrifugeWorkerTransport<TData>`

Low-level Centrifuge transport. Only create directly when custom DataBus assembly is needed:

```ts
const transport = new CentrifugeWorkerTransport({
  workerMode: 'auto',
  workerFactory: () => new Worker(customWorkerUrl, { type: 'module' }),
  sharedWorkerFactory: () => new SharedWorker(customSharedWorkerUrl, { type: 'module' })
});
```

Available options:

- `workerMode`: `'dedicated'` (default), `'shared'`, or `'auto'`; the `auto` degradation chain is SharedWorker -> Dedicated Worker -> local mode
- `transferable`: `boolean`, default `false`; when enabled, ArrayBuffer payloads use Transferable transport, while the object message API remains unchanged
- `heartbeatIntervalMs`: `number`, default `10000`; SharedWorker PING heartbeat interval in ms. `Infinity` disables heartbeats. Must be a positive number or `Infinity` — `0`, a negative number, or `NaN` throws a `TypeError` in the transport constructor. See [configuration](./configuration.md#sharedworker-session-reaper) for details
- `workerFactory`: custom Dedicated Worker loading method
- `sharedWorkerFactory`: custom SharedWorker loading method

## `WorkerClusterRuntime`

Advanced API responsible for Worker registration, heartbeat, visibility, routing, BroadcastChannel protocol, and migration. Business modules should not operate on it directly.

Main methods:

- `start()` / `stop()`
- `setStatus(status)`
- `subscribe(topic)` / `unsubscribe(topic)`
- `publish(topic, data)`
- `broadcastEvent(eventType, payload)`
- `isAssigned(topic)`
- `isActiveWorker()`
- `hasLocalSubscriber(topic)`
- `getSnapshot()`

## Utility Functions

### `createOpaqueKey(value)`

Generates a stable 128-bit hexadecimal opaque key. Used to avoid writing raw connection or topic text into coordination metadata; it is not a cryptographic digest and should not be used for password storage or security signing.

### `createBrowserEnvironment()`

Creates a default browser environment adapter, including storage, BroadcastChannel, timers, and page lifecycle events.

### `selectWorkerBackend(mode, availability?)`

Selects the actual backend based on `WorkerMode` and capability detection, returning `'shared' | 'dedicated' | 'local'`:

- `shared` / `auto`: SharedWorker -> Dedicated Worker -> local mode
- `dedicated` (default): Dedicated Worker -> SharedWorker -> local mode

`availability` can explicitly pass `worker` / `sharedWorker` capability flags, for use in SSR, testing, or embedded environments, avoiding access to non-existent global objects.

### Routing Functions

- `selectActiveWorkers`
- `selectLeastLoadedWorker`
- `selectRebalanceTarget`
- `hasActiveOwner`

These pure functions are primarily used for testing, diagnostics, and custom coordination strategies.
