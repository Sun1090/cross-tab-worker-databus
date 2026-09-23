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

Starts cluster coordination and transport. The first call actually starts the transport; concurrent calls during an in-flight open share the same start Promise without creating a duplicate transport. A call made on a healthy started instance is an immediate no-op. If the transport is down, `start()` acts as an explicit manual recovery: it preserves the cluster, subscriptions, and replay buffers, resets the failure/recovery ledger, and reopens the transport. If an explicit `stop()` is still settling, `start()` queues one fresh start behind that cleanup and returns a Promise that settles with the restart. That queued restart belongs to the latest lifecycle intent: a `stop()` arriving before it can run cancels it (resolving the queued start Promise without opening a transport), and a `start()` issued after that cancellation queues a fresh restart. After `stop()` has completed, `start()` can be called normally to restart. When an open fails, its cleanup and lifecycle gate settle before the startup-failure `onError` handlers run, so a `start()` retry issued synchronously from that callback begins a fresh attempt after the failed transport cleanup instead of returning the rejecting promise. A transport that reports `error` synchronously while `start()` is still in flight follows the same contract for both notifications: the internal status is updated immediately, but the user-facing `onStatus('error')` callback is deferred until `openTransport()` has completed cleanup, installed the failed transport's stop gate, recorded the failure, and cleared `startPromise`. A `start()` retry from that callback or from the subsequent startup-failure `onError` callback therefore queues a fresh lifecycle after cleanup. If the retry succeeds, it opens a new failure ledger and the original opening's rejection does not repopulate it.

### `ready()`

```ts
ready(): Promise<void>
```

Waits for the current transport's `start` to complete. The Promise rejects when auto-start fails; calling again can trigger a retry based on `initialConfig`.

While an explicit `stop()` is settling, `ready()` rejects unless a `start()` has queued a restart behind that stop. It never resolves against a transport that is already being torn down. Wait for `stop()` to settle, then call `start()` before awaiting `ready()` again.

If a later `stop()` cancels that queued restart, the queued `start()` Promise still resolves without opening a transport, but `ready()` rejects with a lifecycle error rather than reporting a stopped bus as ready.

While the tab is BFCache-suspended (after `pagehide` and before `pageshow`), `ready()` rejects with a suspended-state error. The suspend path reuses `startPromise` as the asynchronous `transport.stop()` gate, so returning it would resolve readiness against a deliberately stopped transport. `pageshow` or an explicit `start()` clears the suspension and installs a real reopen promise, after which `ready()` resolves normally once the transport is ready. Both resume paths also restart the coordination plane: `pagehide` pauses the cluster independently of the transport (closing its channel, stopping its heartbeat, and releasing route assignments), so an explicit `start()` resumes the cluster too — otherwise the bus would report a healthy transport while cross-tab deliveries were still being discarded.

If that queued restart fails during transport startup, `ready()` rejects with the underlying startup error even when no `initialConfig` was supplied. The failure is retained for explicit recovery rather than being replaced by the generic missing-configuration error.

When no `initialConfig` is provided and `start(config)` has not been called, `ready()` returns a rejected Promise instead of throwing synchronously, so callers can attach `.catch` and decide whether to start explicitly.

`ready()` resolves when the current transport satisfies its `start()` contract; it is not a guarantee that the remote server is ready to serve application traffic. For the built-in WebSocket backend, `start()` waits for the socket handshake and rejects on a pre-open `error`, a pre-open `close`, or `connectTimeoutMs` expiry, so `ready()` cannot resolve against a `CONNECTING` socket. Protocol-level connection status remains available through `onStatus`.

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
- Subscriptions are automatically queued when the transport is not yet ready, including while a transport recovery is pending: they are held behind the recovery gate and issued once the reopen succeeds instead of being written to the connection that just reported `error`.
- A subscription requested while an explicit `stop()` is settling is not registered: `subscribe()` reports the rejection through `onError` and returns a no-op cleanup function. Wait for `stop()` to settle, then call `start()` before subscribing again.
- Wildcard subscriptions: a topic ending in `.*` (`chat.*`) matches any remainder, and `*` matches everything. The pattern is routed, owned, and transport-subscribed as a literal channel; publications tagged with a matching concrete topic (or with the pattern itself) are delivered to wildcard handlers. See `topicMatchesPattern` below.
- Topics must be non-empty: `subscribe()`, `publish()` and `publishBatch()` throw a `TypeError` when passed `''`, before any other effect (no start is requested and no handler is registered). No transport can address an empty channel, so a subscription to it could never receive anything, and a publication to it was dropped without a trace. `''` warned once per instance from 0.20.96 and became a rejection in 0.21.0, following the pre-1.0 deprecation policy; the guard sits with the option-validation asserts, so an empty topic fails the same way a bad `replay.maxPerTopic` does. `publishBatch('', [])` throws too — the invalid argument is checked ahead of the empty-array no-op.
- Replay (opt-in): construct the bus with `replay: { maxPerTopic }` and pass `{ replay: true | n }` as the third `subscribe()` argument. `maxPerTopic` must be a positive safe integer. The new handler immediately receives the buffered history (up to `n`, capped by `maxPerTopic`, default 100) with `message.replayed: true`, so late joiners do not miss earlier publications. Only dispatched publications are buffered (a topic with no local subscriber drops them as unowned); buffers are in-memory and cleared when the last handler for the topic unsubscribes. Wildcard subscriptions replay across every buffered topic matching the pattern — and note that a pattern is not a topic: the rings it fills stay keyed by the concrete publication topics, so unsubscribing `chat.*` clears none of them (its durable cleanup is asked for `chat.*`, which names no stored row), and re-subscribing the pattern later replays whatever is still buffered. `maxPerTopic` caps each ring's depth, never the number of rings a wide pattern creates, so an unbounded topic space under `*` or `prefix.*` grows the buffer map until you bound it — drop it with `clearReplay()` / `clearReplayTopic(topic)` or cap it in time with `retentionMs`. For reload/BFCache persistence, pass an optional `persistence` created by `createIndexedDbReplayPersistence({ maxPerTopic })`; persistence is asynchronous and failures are reported through `onError` without breaking live delivery. Set `retentionMs` to prune expired producer-timestamped history in memory and to sweep adapters that implement `clearBefore` during hydration and after appends. Set `persistenceRetry: { maxAttempts, backoffMs }` to retry transient persistence failures; defaults preserve one-attempt behavior. Set `pruneStrategy` to `'count'` (default), `'age'`, or `'both'` to cap by `maxPerTopic`, prune timestamped history by `retentionMs`, or apply both. Under `age`, timestamp-less legacy entries are retained but capped by `maxPerTopic`; timestamped entries are bounded by the retention window.
  When tracing is enabled, retries emit `reliability` events with `operation: 'persistence_retry'`, a bounded `persistenceOperation`, and `attempt`.

The WebSocket transport accepts binary publications delivered as either `ArrayBuffer` or browser `Blob` frames.
- Persistent replay stores may also implement `clearTopic(topic)`; the bus calls it on final topic unsubscribe — for a wildcard subscription with the pattern string, while the concrete topics that pattern filled are keyed separately and so survive (see the note above). A store may expose `clear()` for application-controlled retention cleanup; `stop()` deliberately preserves durable history for reload/BFCache recovery.

### `unsubscribe(topic, handler?)`

```ts
unsubscribe(topic: string, handler?: DataBusMessageHandler<TData>): void
```

When a handler is provided, only that callback is released; when omitted, all handlers for the topic on the current instance are released.

Prefer using the cleanup function returned by `subscribe` to avoid accidentally removing callbacks from other modules.

### `publish(topic, data, options?)`

```ts
publish(
  topic: string,
  data: unknown,
  options?: { messageId?: string; timestamp?: number }
): void
```

Routes the publish operation to the current topic owner; uses the current Worker when no valid route exists.

Published data must satisfy the serialization constraints of the underlying transport. The SDK does not persist or defer replay of publish commands during page suspension.

When the owning Worker is a remote Tab and the publish control message cannot be posted (for example the BroadcastChannel fails to clone the payload), `publish()` reports the failure through `onError` instead of silently dropping it.

Calling `publish()` while `stop()` is still settling reports through `onError` and routes nothing; the message is not deferred until a later start. Publications issued earlier and still queued behind an in-flight transport open are canceled by the stop.

A publication issued after a runtime transport `error` is held behind the recovery gate and sent once the transport is ready again, so it is never written to the connection that just failed. If the recovery budget is exhausted or the wait is superseded by `stop()` / page hide, the publication is dropped rather than deferred indefinitely (page suspension keeps its documented drop-without-defer semantics). A clean `disconnected` status does not schedule a background DataBus reopen, but it no longer swallows later operations either: a `subscribe()` / `publish()` issued after the close demands one on-demand reopen, is held until the replacement connects, and then flushes. Call `start()` (or send an operation) to reopen explicitly.

Incoming messages may include a caller/server supplied `messageId`. Enable bounded duplicate suppression with `dedup: { maxEntries, ttlMs }`; repeated IDs within the bounded per-bus window are ignored. This is disabled by default and is best-effort: it does not provide an end-to-end at-least-once or exactly-once server guarantee. One accepted transport publication is fanned out once and dispatches at most once per matching local handler, while the transport/server may still redeliver or lose publications and a disconnected or suspended tab can miss the cross-tab event. Tests and hosts with a custom time source may provide `dedup.now`. A full `stop()` clears the remembered ID window; a later `start()` begins a fresh dedup session.

When supplied, `options.messageId` and `options.timestamp` are propagated through cross-tab routing, Worker boundaries, and supported transports. The server must echo or otherwise preserve them for inbound deduplication and replay retention.

`DataBusMessage` and `DataBusPublication` expose the same optional metadata.
`DataBusPublicationEnvelope<TData>` is the canonical JSON envelope type:

```ts
{
  op: 'publication',
  publication: { topic, data, messageId?, timestamp? }
}
```

### `publishBatch(topic, items)`

```ts
publishBatch(
  topic: string,
  items: Array<{ data: unknown; messageId?: string; timestamp?: number }>
): void
```

Publishes many items to one topic as a single unit of work. The bundled WebSocket transport packs the whole batch into one wire frame (the `publishBatch` op) rather than one frame per item; a transport that does not implement the optional `DataBusTransport.publishBatch` hook falls back to per-item `publish()`, so the call is safe either way.

Per-item `messageId` and `timestamp` survive the wire frame, and dedup, replay, and ordering apply per item in source order. An empty batch is a no-op; a single-item batch delegates to `publish()`. `WorkerClusterRuntime` exposes the same method for callers that coordinate directly.

A non-empty batch issued while `stop()` is still settling reports through `onError` and sends nothing; an empty batch remains a no-op.

### `clearReplay()`

```ts
clearReplay(): Promise<void>
```

Clears in-memory replay buffers and invokes the persistence adapter's optional `clear()` hook. Useful for retention policies, logout, or tenant switching. Durable history is otherwise preserved across `stop()`.

`clearReplayTopic(topic)` applies the same cleanup to one exact topic. `getDedupStats()` returns bounded counters (`enabled`, `tracked`, `accepted`, `suppressed`, plus the current `ttlMs` whenever `dedup.adaptiveTtl` is configured), and `resetDedup()` clears remembered IDs and counters without changing configuration.

`clearReplayBefore(timestamp)` removes entries with an explicit producer timestamp older than an epoch-millisecond cutoff from memory and from adapters that implement optional `clearBefore(timestamp)`. Legacy messages without a producer timestamp are preserved for compatibility. Incoming messages receive a bus timestamp when the transport does not provide one; that bus timestamp is not treated as producer metadata for retention cleanup.

When automatic retention is enabled, repeated cleanup requests are coalesced while a persistence cleanup is in flight; the newest cutoff is applied next.

Set `replay.retentionSweepMs` to periodically apply the retention cutoff even when no new publications arrive. The sweep is active only while the bus is started and visible; it pauses during pagehide and stops permanently on `stop()`.

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

### `getHealthSummary()`

```ts
getHealthSummary(): DataBusHealthSummary
```

Compact readiness verdict for dashboards, readiness probes, and support bundles. Answers "is the bus usable right now" first, then attaches the failure and recovery context that explains the verdict:

```ts
interface DataBusHealthSummary {
  healthy: boolean;   // started, not stopping/suspended, live transport status is 'connected'
  state: 'stopped' | 'starting' | 'healthy' | 'recovering' | 'suspended' | 'degraded';
  status: WorkerStatus;
  sdkVersion: string;
  started: boolean;
  suspended: boolean;                       // true while the tab is hidden (BFCache)
  transport: { name; backend; ready; status };
  recovery: { attempt; exhausted; maxAttempts; generation; lastSuccessAt; hasError; errorMessage; errorAt };
  lastFailure: { source: 'transport' | 'persistence' | 'dispatch'; message: string; at: number } | null;
  persistence: { failures: number; lastFailureAt: number | null; lastErrorMessage: string | null };
  metrics: DataBusMetricsSnapshot | null;   // live trace window, or null when trace metrics are inactive
  trace: { asyncSink: boolean; pendingEvents: number };  // sink back-pressure visibility
}
```

`state` semantics: `stopped` (not started, or an explicit `stop()` is still tearing down), `starting` (initial open in flight), `recovering` (automatic transport recovery in progress), `suspended` (tab hidden, resumes on pageshow), `degraded` (automatic recovery exhausted — call `start()` or subscribe again to recover manually), `healthy`. Calling `start()` again while degraded keeps the cluster, subscriptions, and replay buffers intact, resets the failure/recovery ledger, and reopens the transport; subscribe and publish also trigger the same reopen path. `lastFailure` is a unified ledger across all failure sources and resets on every explicit `start()`. The `healthy` verdict follows the live transport status, except that an in-flight `stop()` always reads as `stopped` because every other lifecycle API (`publish()`, `subscribe()`, `ready()`) already rejects during teardown; `transport.ready` is diagnostic and can remain `false` for the brief window between a transport reporting `connected` and its `start()` Promise settling, during which operations are queued behind that in-flight start rather than dropped.

### `getRecoveryStats()` / `getPersistenceStats()`

```ts
getRecoveryStats(): { attempt; exhausted; maxAttempts; hasError; errorMessage; errorAt; generation; lastSuccessAt }
getPersistenceStats(): { failures; lastFailureAt; lastErrorMessage }
```

`recovery.generation` increments on every successful transport open (initial start and each recovery); `lastSuccessAt` is the timestamp of that open (`null` before the first one). `recovery.hasError` / `errorMessage` / `errorAt` describe the most recent retained *transport* failure — from a transport open or a runtime `onError` — and share the lifetime of the unified `lastFailure` ledger: a successful recovery keeps the last failure visible, and only an explicit `start()` clears it. Non-transport failures (`persistence`, `dispatch`) never flip the recovery ledger; they stay visible through `lastFailure` (and `getPersistenceStats()` for the replay backend). A transport failure is stamped once, so `recovery.errorAt` and the `lastFailure.at` of that same failure are equal. Persistence counters cover the optional replay persistence backend only.

### `getDiagnostics()`

```ts
getDiagnostics(): DataBusDiagnostics
```

Full diagnostics snapshot combining lifecycle, transport identity (`name`, `backend`, live `status`, `suspended`), recovery, dedup, replay, persistence, protocol (`version`, `unknownMessages`, `peers`), the cluster snapshot, plus two diagnostics-only additions:

- `metrics: DataBusMetricsSnapshot | null` — the current trace metrics window (throughput, dispatch latency percentiles, dedup outcomes), or `null` when trace metrics are inactive (disabled or events-only mode).
- `trace: { asyncSink: boolean; pendingEvents: number }` — sink delivery mode and queued-event depth; a growing `pendingEvents` under `asyncSink: true` is the first sign of sink back-pressure.

`sdkVersion` is injected from `package.json` at build time. Prefer `getHealthSummary()` when a consumer only needs the readiness verdict.

### `getMetrics()`

```ts
getMetrics(): DataBusMetricsSnapshot | null
```

Synchronous, non-destructive snapshot of the current trace metrics window — the same derived counters a periodic `message_metrics` event carries (received, dispatched, topics, dispatch latency avg/p50/p95/max, dedup accepted/suppressed), readable on demand without a sink or an interval flush. Returns `null` when trace metrics are inactive.

`getDiagnostics().replay` ships `{ enabled, topics, messages, bytes }` — `bytes` is the approximate in-memory payload footprint of the buffered replay rings (same string/binary/number sizing heuristic as adaptive load weighting), computed on demand so the hot append path never pays for it.

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

Low-frequency event types include `lifecycle`, `status`, `subscription`, `coordination`, `reliability`, and `error`; high-frequency data is output as `message_metrics` per window, containing receive/dispatch counts, active topic count, and dispatch latency aggregates (`dispatchSamples`, `dispatchAvgMs`, `dispatchP50Ms`, `dispatchP95Ms`, `dispatchMaxMs`), and deduplication outcomes (`dedupAccepted`, `dedupSuppressed`). Route ownership changes surface as `reliability` events: a graceful handoff reports `operation: 'route_migration'`, while a re-election that recovered a stranded unconfirmed handoff (previous owner gone, ACK never arrived) reports `operation: 'route_migration_recovery'`, so trace consumers can tell recoveries apart from routine handoffs. The `coordination` event is emitted once per successful `start()` — a later automatic or on-demand reopen emits no second snapshot — and carries `coordinated`, `activeWorkers`, `workers` (formatted worker records), and `routes` (`topicKey@workerId|confirmed=…`) reflecting the settled route list. All public events use a fixed structure, and none of them carries a message payload, a connection address, or an error body. Topic plaintext appears in exactly two event types: `subscription`, which reports the transition, and `reliability`, which names the route for the route-scoped operations (`route_ack`, `route_migration`, `route_migration_recovery`) and omits it elsewhere. Every other event is topic-free, and `coordination` identifies routes by their opaque `topicKey` rather than by name. Since those two event types do carry topic names, treat a trace sink as a diagnostic surface and redact sensitive topic conventions before forwarding events to external telemetry (see `configuration.md`). Errors thrown by the sink are isolated and do not interrupt message dispatch, but are output to `console.warn` to facilitate diagnosing configuration issues. The sink should ideally not throw — capture expected error conditions in the event data rather than raising exceptions.

**`asyncSink: true` delivery semantics.** By default (`false`) the sink runs synchronously for each emitted event. With `asyncSink: true`, events are queued in memory and delivered in one microtask batch: the first event of a task schedules `queueMicrotask`, and every event emitted before that microtask runs is sent to the sink in FIFO order in a single pass (including the periodic `message_metrics` snapshots). The hot message path therefore never blocks on sink work. Error isolation is unchanged from the synchronous mode — a throwing sink is caught and reported via `console.warn` and never interrupts dispatch or the remaining events in the batch. Ordering boundary: order **within** a batch is guaranteed, but delivery is deferred to the next microtask, so a trace event is no longer observed before your next statement runs, and events emitted after a batch flushed settle into a later batch. Use the default synchronous sink (or consolidate counters yourself) when each event must be visible before the following line executes.

### `stop()`

```ts
stop(): Promise<void>
```

Permanently destroys the current instance: cleans up handlers, cluster registration, routes, Workers, and transport. If a transport open or reopen is still settling, `stop()` waits for it and invalidates its result so it cannot become ready after the stop. Normal page hide and restore do not require calling this method. Teardown is fault-tolerant: if the transport's own `stop()` rejects (or throws), `stop()` still resolves once the bus is destroyed and reports the failure through `onError` and the unified `lastFailure` record instead of rejecting, so the fire-and-forget unmount path in the React and Vue adapters cannot produce an unhandled rejection. The instance remains restartable afterwards.

## `DataBusTransport<TConfig, TData>`

```ts
interface DataBusTransport<TConfig, TData> {
  start(config, handlers): void | Promise<void>;
  subscribe(topic): void | Promise<void>;
  unsubscribe(topic): void | Promise<void>;
  publish(topic, data): void | Promise<void>;
  /** Optional: one wire frame for many items. The DataBus falls back to
   * per-item `publish` calls when this is absent. Each item is a
   * `DataBusPublicationItem` — `{ data, messageId?, timestamp? }`, exported. */
  publishBatch?(topic, items): void | Promise<void>;
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

SharedWorker mode uses the bundled `centrifuge.shared.worker.js`, and its Worker is named `cross-tab-worker-databus-shared`. With `workerMode: 'auto'`, it degrades from SharedWorker to Dedicated Worker to local mode. See [configuration.md](./configuration.md) for full configuration.

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
- `heartbeatIntervalMs`: `number`, default `10000`; SharedWorker PING heartbeat interval in ms. `Infinity` disables heartbeats and exempts that port from reaping. Must be a positive number or `Infinity` — `0`, a negative number, or `NaN` throws a `TypeError` in the transport constructor. See [configuration](./configuration.md#sharedworker-session-reaper) for details
- `workerFactory`: custom Dedicated Worker loading method
- `sharedWorkerFactory`: custom SharedWorker loading method

## `createStorageEventChannel(options)`

```ts
createStorageEventChannel(options: {
  name: string;
  storage: StorageLike | null;
  win: StorageEventWindow | null;
}): ClusterChannel | null
```

Creates a `ClusterChannel` backed by localStorage `storage` events — the coordination fallback for environments without BroadcastChannel. Returns `null` when storage or a storage-event source is unavailable. Delivery semantics follow BroadcastChannel where cross-tab coordination needs them — no echo to the sending tab, JSON-serializable messages, closed channels refuse further posts — with one deliberate divergence: `postMessage` also never dispatches to the channel's own listeners, so two channels created in the **same** document do not see each other, which a real BroadcastChannel does. Only cross-tab delivery matters to this fallback, and the divergence is pinned by the sibling-channel case in `tests/storage-channel.test.ts`; the payload envelope carries a per-channel sender nonce **and** a monotonic sequence, which is what keeps consecutive identical messages deliverable — including two tabs whose first frame would otherwise store the same `seq=1` value and be silently suppressed. Opt in via `createBrowserEnvironment({ channelFallback: 'storage-event' })`; see the security note in [configuration.md](./configuration.md#coordination-channel-fallback-broadcastchannel-unavailable).

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

Implements `DataBusTransport`. `start()` settles only after the socket handshake completes: it resolves on `open` and rejects when the attempt errors, closes before opening, or exceeds `connectTimeoutMs`. Connection lifecycle maps to the DataBus status vocabulary: socket `open` → `connected`, `close` → `disconnected`, `error` → `error` (which triggers DataBus auto-recovery). Subscriptions are re-asserted when a socket reopens in place. When the bus reopens after a failed socket — automatic recovery after `error`, or an explicit `start()` / page restore / later operation after `close` — `start()` creates a replacement socket and ignores late lifecycle or message callbacks from the superseded one, including a late `open` from a timed-out attempt. Frames dropped while the socket is not open are reported via `handlers.onError`; the replacement re-sends subscribe frames.

`WebSocketDataBusConfig` fields:

- `url` — WebSocket endpoint.
- `protocols` — optional subprotocol(s) for the handshake.
- `webSocketFactory` — optional factory `(url, protocols) => WebSocketLike` for tests and non-browser runtimes (defaults to the global `WebSocket`).
- `connectTimeoutMs` — optional handshake budget in milliseconds. Defaults to `30000`; `0` or `Infinity` waits indefinitely. On expiry the attempt reports `error` and rejects `start()` (and therefore `ready()`), then closes the half-open socket.

### Wire protocol

JSON text frames:

- client → server: `{"op":"subscribe"|"unsubscribe"|"publish","topic":"...","data":...,"messageId"?:...,"timestamp"?:...}`
- server → client (canonical): `{"op":"publication","publication":{"topic":"...","data":...,"messageId"?:...,"timestamp"?:...}}`
- server → client (legacy, still accepted): `{"topic":"...","data":...}`

Frames without a string publication `topic` are ignored; malformed JSON surfaces via `handlers.onError` without throwing.

A pattern-aware server may deliver publications tagged with the concrete topic (recommended); publications tagged with the pattern itself are delivered through the exact-match path.

## React Hooks (`cross-tab-worker-databus/hooks`)

React (>= 18) is an optional peer dependency; this entry is separate so non-React consumers never load it.

### `useCrossTabDataBus(create, deps?)`

Creates a bus for the component's lifetime: created on mount, stopped on unmount. StrictMode-safe — the double-invoked effect runs create → `stop()` → create across **separate** instances, so it exercises the stop path but not the BFCache one: page-hide takes `onSuspend()`, which keeps this same bus, its handlers and its replay buffers, and resume reverses it. Coverage of suspend/resume therefore has to come from a real hide/show, not from this hook. Returns the active bus or `null` before the first effect (SSR / initial render).

Pass a fresh bus per effect run (an inline factory); key recreation through `deps`.

### `useCrossTabSubscription(bus, topic, handler)`

Attaches a message handler with automatic cleanup. The handler is read through a ref on each delivery, so inline closures do not cause resubscription across re-renders. Queues while `bus` is `null` or the transport is not ready.

### `useCrossTabStatus(bus)`

Mirrors `bus.onStatus()` into React state and reads the current value synchronously whenever the bus identity changes. Returns `'connecting' | 'connected' | 'disconnected' | 'error'`.

### `useCrossTabHealth(bus, options?)`

Mirrors `bus.getHealthSummary()` into React state (`DataBusHealthSummary | null`). Because the summary is a snapshot, the hook polls it on an interval (default 1000 ms; pass `{ intervalMs: 0 }` for event-driven refreshes only) and refreshes immediately on status changes and errors. An `intervalMs` change replaces the polling timer without recreating the bus. Returns `null` while the bus has not been created yet.

## Vue Composables (`cross-tab-worker-databus/vue`)

Vue 3.3+ is an optional peer dependency; this entry is separate from the core package.

```ts
const bus = useVueCrossTabDataBus(() => createWebSocketDataBus({ connection: { url } }));
const status = useVueCrossTabStatus(bus);
useVueCrossTabSubscription(bus, 'chat.*', message => console.log(message.data));
```

`useCrossTabDataBus` returns a Vue `Ref` that is populated on mount and stopped on unmount. `useCrossTabSubscription` accepts a string or `Ref<string>` topic and rebinds when the bus or topic changes. `useCrossTabStatus` returns a `Ref<WorkerStatus>` synchronized with `bus.onStatus()`.

### `useVueCrossTabHealth(bus, options?)`

The Vue binding of `useCrossTabHealth`: mirrors `bus.getHealthSummary()` into a `Ref<DataBusHealthSummary | null>`. Because the summary is a snapshot rather than an event stream, the composable polls it on an interval (default 1000 ms; pass `{ intervalMs: 0 }` for event-driven refreshes only) and refreshes immediately on status changes and errors. A reactive `intervalMs` change replaces the polling timer without rebuilding the bus. Returns `null` while the bus has not been created yet.

## `WorkerClusterRuntime`

Advanced API responsible for Worker registration, heartbeat, visibility, routing, BroadcastChannel protocol, and migration. Business modules should not operate on it directly.

Main methods:

- `start()` / `stop()`
- `setStatus(status)`
- `subscribe(topic)` / `unsubscribe(topic)`
- `publish(topic, data)`
- `publishBatch(topic, items)`
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

### `getOrCreateTabId(environment, key?)`

Returns the stable identity of the current page/tab instance, reading it from session storage and creating one (`tab-<random>`) on first call, so a reloaded tab reclaims its routes instead of looking like a brand new one.

The stored value is deliberately *not* reused when `window.opener` is present: `window.open()` clones the opener's `sessionStorage` into the child, so a blind reuse would make two live tabs share one identity. When storage is unavailable or throws, a fresh ID is generated instead.

### `selectWorkerBackend(mode, availability?)`

Selects the actual backend based on `WorkerMode` and capability detection, returning `'shared' | 'dedicated' | 'local'`:

- `shared` / `auto`: SharedWorker -> Dedicated Worker -> local mode
- `dedicated` (default): Dedicated Worker -> SharedWorker -> local mode

`availability` (`WorkerAvailability`, exported) can explicitly pass `worker` / `sharedWorker` capability flags, for use in SSR, testing, or embedded environments, avoiding access to non-existent global objects.

### `effectiveWorkerLoad(worker, options?)`

The pure scoring function behind least-loaded owner selection: `worker.load` (the owned-Topic count) plus the weighted traffic and scheduling-lag terms when `options` carries the `loadWeighting` weights.

The score is always finite. A Worker with no throughput sample, an unset (all-zero) weight set, a non-positive or non-finite sample window, or a non-finite weighted sum scores as its raw Topic count — a non-finite score would never compare correctly and would make owner selection depend on the order of the Worker array rather than on load. See [configuration.md](./configuration.md#adaptive-owner-weighting) for the weights.

### `approximatePayloadBytes(payload)`

Cheap estimate of a payload's wire size, used for the byte side of an adaptive load sample and — because `getDiagnostics().replay` reports a `bytes` figure computed on demand — to size the retained replay buffers, so it is not gated on adaptive routing. It is not allocation-free either: an object node materialises `Object.values`. Approximate sizes are fine either way; the goal is a stable cross-Worker comparison, not an exact byte count.

Sizes: `null`/`undefined` and symbols/functions `0`, booleans `4`, numbers and bigints `8`, strings their length, `ArrayBuffer`s and typed-array views their `byteLength`, arrays an 8-byte header plus their elements, and plain objects the sum of their values.

### `DEFAULT_MAX_ACTIVE_WORKERS`

The default cap on how many Workers may own Topics concurrently (`3`). It bounds fan-out breadth: only that many Workers are eligible to become new-route owners, so a cluster of twenty tabs still concentrates ownership on a few rather than spreading it thin. Override it with the `maxActiveWorkers` cluster option.

### Routing Functions

- `selectActiveWorkers`
- `selectLeastLoadedWorker`
- `selectRebalanceTarget`
- `hasActiveOwner`
- `isWildcardTopic(pattern)`
- `topicMatchesPattern(pattern, topic)` — wildcard matching used by subscriptions: `chat.*` matches `chat.room.1` (segment-boundary prefix), `*` matches everything

These pure functions are primarily used for testing, diagnostics, and custom coordination strategies.
