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

import {
  WebSocketTransport,
  createWebSocketDataBus
} from 'cross-tab-worker-databus';

import {
  useCrossTabDataBus,
  useCrossTabStatus,
  useCrossTabSubscription
} from 'cross-tab-worker-databus/hooks';

import {
  useCrossTabDataBus as useVueCrossTabDataBus,
  useCrossTabStatus as useVueCrossTabStatus,
  useCrossTabSubscription as useVueCrossTabSubscription
} from 'cross-tab-worker-databus/vue';
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
- Wildcard subscriptions: a topic ending in `.*` (`chat.*`) matches any remainder, and `*` matches everything. The pattern is routed, owned, and transport-subscribed as a literal channel; publications tagged with a matching concrete topic (or with the pattern itself) are delivered to wildcard handlers. See `topicMatchesPattern` below.
- Replay (opt-in): construct the bus with `replay: { maxPerTopic }` and pass `{ replay: true | n }` as the third `subscribe()` argument. `maxPerTopic` must be a positive safe integer. The new handler immediately receives the buffered history (up to `n`, capped by `maxPerTopic`, default 100) with `message.replayed: true`, so late joiners do not miss earlier publications. Only dispatched publications are buffered (a topic with no local subscriber drops them as unowned); buffers are in-memory and cleared when the last handler for the topic unsubscribes. Wildcard subscriptions replay across every buffered topic matching the pattern. For reload/BFCache persistence, pass an optional `persistence` created by `createIndexedDbReplayPersistence({ maxPerTopic })`; persistence is asynchronous and failures are reported through `onError` without breaking live delivery.
- Persistent replay stores may also implement `clearTopic(topic)`; the bus calls it on final topic unsubscribe. A store may expose `clear()` for application-controlled retention cleanup; `stop()` deliberately preserves durable history for reload/BFCache recovery.

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

Incoming messages may include a caller/server supplied `messageId`. Enable bounded duplicate suppression with `dedup: { maxEntries, ttlMs }`; repeated IDs within the window are ignored. This is disabled by default and does not provide an exactly-once server guarantee.

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

## WebSocket Transport Backend

A dependency-free transport over a plain WebSocket. Any server speaking the JSON frame protocol below can back the same cross-tab clustering stack (owner dedup, sticky routes, failover) as the Centrifuge backend.

### `createWebSocketDataBus<TData>(options)`

```ts
createWebSocketDataBus<TData>(options): CrossTabDataBus<WebSocketDataBusConfig, TData>
```

Creates an auto-starting WebSocket DataBus. Defaults: `clusterKey = connection.url`.

```ts
const bus = createWebSocketDataBus({
  connection: { url: 'wss://example.test/ws' },
  trace: { enabled: true, sink: event => console.log(event) }
});
```

### `WebSocketTransport<TData>`

```ts
new WebSocketTransport<TData>(connection: WebSocketDataBusConfig)
```

Implements `DataBusTransport`. Connection lifecycle maps to the DataBus status vocabulary: socket `open` → `connected`, `close` → `disconnected`, `error` → `error` (which triggers DataBus auto-recovery). Subscriptions are re-asserted when a socket reopens in place. Frames dropped while the socket is not open are reported via `handlers.onError`; reopening re-sends subscribe frames.

`WebSocketDataBusConfig` fields:

- `url` — WebSocket endpoint.
- `protocols` — optional subprotocol(s) for the handshake.
- `webSocketFactory` — optional factory `(url, protocols) => WebSocketLike` for tests and non-browser runtimes (defaults to the global `WebSocket`).

### Wire protocol

JSON text frames:

- client → server: `{"op":"subscribe"|"unsubscribe"|"publish","topic":"...","data":...}`
- server → client: `{"topic":"...","data":...}` for publications. Frames without a string `topic` field are ignored; malformed JSON surfaces via `handlers.onError` without throwing.

A pattern-aware server may deliver publications tagged with the concrete topic (recommended); publications tagged with the pattern itself are delivered through the exact-match path.

## React Hooks (`cross-tab-worker-databus/hooks`)

React (>= 18) is an optional peer dependency; this entry is separate so non-React consumers never load it.

### `useCrossTabDataBus(create, deps?)`

Creates a bus for the component's lifetime: created on mount, stopped on unmount. StrictMode-safe — the double-invoked effect exercises the same stop/recreate path as BFCache suspend/resume. Returns the active bus or `null` before the first effect (SSR / initial render).

Pass a fresh bus per effect run (an inline factory); key recreation through `deps`.

### `useCrossTabSubscription(bus, topic, handler)`

Attaches a message handler with automatic cleanup. The handler is read through a ref on each delivery, so inline closures do not cause resubscription across re-renders. Queues while `bus` is `null` or the transport is not ready.

### `useCrossTabStatus(bus)`

Mirrors `bus.onStatus()` into React state and reads the current value synchronously whenever the bus identity changes. Returns `'connecting' | 'connected' | 'disconnected' | 'error'`.

## Vue Composables (`cross-tab-worker-databus/vue`)

Vue 3.3+ is an optional peer dependency; this entry is separate from the core package.

```ts
const bus = useVueCrossTabDataBus(() => createWebSocketDataBus({ connection: { url } }));
const status = useVueCrossTabStatus(bus);
useVueCrossTabSubscription(bus, 'chat.*', message => console.log(message.data));
```

`useCrossTabDataBus` returns a Vue `Ref` that is populated on mount and stopped on unmount. `useCrossTabSubscription` accepts a string or `Ref<string>` topic and rebinds when the bus or topic changes. `useCrossTabStatus` returns a `Ref<WorkerStatus>` synchronized with `bus.onStatus()`.

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
- `isWildcardTopic(pattern)`
- `topicMatchesPattern(pattern, topic)` — wildcard matching used by subscriptions: `chat.*` matches `chat.room.1` (segment-boundary prefix), `*` matches everything

These pure functions are primarily used for testing, diagnostics, and custom coordination strategies.
