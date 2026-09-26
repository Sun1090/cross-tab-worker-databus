> [中文](./zh/configuration.md) | English

# Configuration

## Core DataBus Configuration

`CrossTabDataBus<TConfig, TData>` accepts `CrossTabDataBusOptions<TConfig, TData>`.

| Config | Type | Default | Description |
|---|---|---|---|
| `clusterKey` | `string` | Required | Isolates different connection contexts; not written to storage in plaintext |
| `transport` | `DataBusTransport<TConfig, TData>` | Required | Actual connection and subscription implementation |
| `initialConfig` | `TConfig` | None | Passed to transport on auto-start |
| `autoStart` | `boolean` | `true` when `initialConfig` is provided | Whether to auto-start after instance creation |
| `recovery.cooldownMs` | `number` | `1000` | Minimum delay before automatic transport reopen after an error |
| `recovery.maxAttempts` | `number` | `Infinity` | Maximum automatic reopen attempts per recovery sequence; explicit subscription demand can still retry |
| `storagePrefix` | `string` | `cross-tab-worker-databus` | Namespace for storage keys and BroadcastChannel |
| `maxActiveWorkers` | `number` | `3` | Maximum number of Workers that can be Topic owners |
| `heartbeatIntervalMs` | `number` | `3000` | Worker heartbeat interval |
| `workerTtlMs` | `number` | `10000` | Worker expiry threshold |
| `environment` | `ClusterEnvironment` | Browser native environment | Used for testing, embedded environments, or capability replacement |
| `tabId` | `string` | Auto-generated | Advanced debugging and test injection; not recommended for production use |
| `workerId` | `string` | Auto-generated | Advanced debugging and test injection; not recommended for production use |
| `trace` | `DataBusTraceOptions` | Disabled | Optional diagnostic events, message throughput, and distribution latency aggregates; does not affect data transfer |

## Diagnostics & Throughput Metrics

Trace is disabled by default. When enabled, lifecycle, connection status, coordination mode, and subscription count changes are output immediately; high-frequency messages are aggregated by count rather than printed individually.

```ts
const bus = new CrossTabDataBus({
  clusterKey: 'realtime-feed',
  initialConfig: {},
  transport,
  trace: {
    enabled: true,
    mode: 'all',
    metricsIntervalMs: 5000,
    sink: event => console.info('[DataBus]', event)
  }
});
```

| Config | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Master switch |
| `mode` | `'events' \| 'metrics' \| 'all'` | `'all'` | Low-frequency events only, aggregated metrics only, or both |
| `metricsIntervalMs` | `number` | `5000` | Aggregation window; must be a finite value greater than 0 |
| `sink` | `(event) => void` | Required | Determined by the integrator: console, monitoring SDK, or other output |

`message_metrics` contains window duration, received count, dispatched count, active Topic count, and receive-to-dispatch latency sample count, average, P50, P95, and maximum, plus `dedupAccepted` and `dedupSuppressed` counters for the same window. Latency is aggregated in 50ms buckets and never contains an individual message payload. Persistence failures also emit a bounded `reliability` event with `operation: persistence_cleanup` before reaching the error handlers. `dedup.now` and `trace.now` can be injected for deterministic TTL, event-timestamp, and metrics-window tests. Subscription events include their Topic so an integrator can correlate ownership changes. They are emitted only when the owner transport subscription set changes; idempotent `CONTROL` retries do not produce duplicate subscription events. Treat trace sinks as diagnostic surfaces: redact sensitive Topic conventions before writing to a console or external telemetry. Trace events do not include URLs, credentials, payloads, or error bodies. Errors thrown in the sink are isolated and will not interrupt message distribution, but will output to `console.warn` to help integrators discover diagnostic configuration issues.

When `replay.retentionMs` is enabled, automatic durable cleanup is coalesced during bursts: an in-flight cleanup is reused and the newest cutoff is applied after it settles. This bounds IndexedDB cleanup work without changing the retention boundary.

`replay.retentionSweepMs` optionally schedules the same cleanup on a periodic interval. It is useful for quiet topics whose old durable records should still expire; it requires `retentionMs` and a persistence adapter with `clearBefore()`. The timer follows visibility and lifecycle transitions and is disabled by default.

`replay.persistenceRetry` optionally controls transient persistence recovery. `maxAttempts` is the total number of attempts (default `1`), and `backoffMs` is the initial delay before retry (default `50`). Delays are capped only where they grow: after a failed attempt the delay doubles and the doubled value is capped at 1600 ms, while `backoffMs` itself is waited verbatim as the first delay — so `backoffMs: 5000` waits 5000 ms, then 1600 ms, rather than being clamped to the ceiling; final failures retain the existing `onError` and reliability behavior. A batch flush still queued in a microtask when the bus suspends or stops is discarded with its lifecycle generation rather than starting a durable append after teardown.

### Replay Options

| Config | Type | Default | Description |
|---|---|---|---|
| `maxPerTopic` | `number` | `100` | Maximum buffered publications per topic under `count`/`both`; oldest are evicted first. Under `age`, timestamped entries are retention-bounded and timestamp-less legacy entries are capped by this value (positive safe integer) |
| `persistence` | `DataBusReplayPersistence` | — | Optional durable backend (`createIndexedDbReplayPersistence`); omitted keeps history in memory only |
| `retentionMs` | `number` | — | Producer-timestamp retention window; history older than the cutoff is pruned through the adapter's `clearBefore` |
| `pruneStrategy` | `'count' \| 'age' \| 'both'` | `'count'` | `count` caps each topic at `maxPerTopic`; `age` prunes timestamped history by `retentionMs` and caps timestamp-less legacy entries by `maxPerTopic`; `both` applies both. `age` without `retentionMs` has nothing to prune by and falls back to the count cap |
| `retentionSweepMs` | `number` | — | Periodic durable-retention sweep for quiet topics; requires `retentionMs` and a `clearBefore` adapter |
| `persistenceRetry` | `{ maxAttempts, backoffMs }` | `1` / `50` | Bounded retry for transient persistence failures; the delay doubles after each attempt and the doubled value is capped at 1600 ms, `backoffMs` being waited verbatim first |

### Deduplication Options

| Config | Type | Default | Description |
|---|---|---|---|
| `maxEntries` | `number` | `1000` | Remembered message IDs before the oldest (FIFO) entry is evicted (positive safe integer) |
| `ttlMs` | `number` | `60000` | How long a remembered ID suppresses a repeat (positive finite) |
| `sweepMs` | `number` | — | Optional periodic sweep that expires quiet IDs; disabled by default |
| `now` | `() => number` | `Date.now` | Injectable clock for deterministic TTL tests and non-wall-clock hosts |
| `adaptiveTtl` | `{ minMs, maxMs }` | — | Optional bounded adaptive TTL: a high recent message rate shortens the window toward `minMs`, a quiet period relaxes it to `maxMs` (both required, `minMs <= maxMs`) |

When tracing is enabled, each retry before the final attempt emits a bounded `reliability` event with `operation: persistence_retry`, `persistenceOperation` (`load`, `append`, `clear`, `clearTopic`, or `clearBefore`), and the failed attempt number. No payload, URL, credential, or error body is included.

WebSocket binary frames may arrive as either `ArrayBuffer` or browser `Blob`; both use the same compact binary publication format. Blob conversion is asynchronous and conversion failures are reported through the transport error handler.

Retry waits are lifecycle-aware: `stop()` and pagehide suspension cancel pending retry attempts. A later `start()`/pageshow begins new work under a fresh lifecycle generation.

`dedup.sweepMs` optionally runs TTL cleanup while the bus is started and visible. It is disabled by default; on-message cleanup and `maxEntries` bounds remain in effect regardless.

The Vue adapter serializes bus replacement and ignores stale stop completions when reactive dependencies change rapidly, preserving the newest component lifecycle.

The React adapter relies on React's own effect ordering instead of a generation counter: an effect's cleanup always runs before its next invocation, and nothing inside the effect yields, so each run stops exactly the instance it created.

IndexedDB replay persistence closes connections receiving `versionchange` and lazily reopens them for the next operation, which keeps multi-tab schema upgrades recoverable.

On `pagehide`, the aggregation timer stops and discards the incomplete window; on `pageshow`, it resumes with a new window. A permanent `stop()` clears the timer. Only diagnostics output is throttled; actual message reception and distribution are never rate-limited.

### Timing Parameter Constraints

- `workerTtlMs` should be at least twice `heartbeatIntervalMs`.
- A TTL that is too short may cause false migrations during background scheduling jitter.
- A TTL that is too long delays recovery of abnormal tabs.
- The default `3000/10000` is suitable for general desktop browser real-time scenarios.

### TTL Message-Loss Window

When a worker dies abnormally (e.g., tab crash):

- Other workers detect the death only after `workerTtlMs` (default 10 000 ms) — the stale record is pruned during the next reconciliation cycle.
- The periodic heartbeat writes to localStorage without a BroadcastChannel notification, so a full heartbeat interval may pass before the stale record is discovered.
- **Worst-case window**: up to `heartbeatIntervalMs + workerTtlMs` (~13 s by default). During this window, topics owned by the dead worker receive no service — publications to those topics are lost.
- **Mitigation**: reduce `heartbeatIntervalMs` and `workerTtlMs` proportionally (e.g. 1 s / 4 s). This increases storage write frequency and raises the risk of false migrations during scheduling jitter.

The default 3 s / 10 s values are suitable for general desktop browser real-time scenarios. Tune based on your tolerance for missed publications vs. false migration rate.

### Active Worker Count

`maxActiveWorkers` limits the number of Workers that can become Topic owners, not the number of connections established by transport. In Dedicated Worker mode, each Tab can still create its own Worker; in SharedWorker mode, same-origin Tabs reuse the same Worker.

The active set is used only when a Topic needs a new owner. An existing live owner keeps its established routes even if visibility changes later mark that Worker as standby or place it outside the current candidate set.

- `1`: Minimum connections and subscriptions, but the single owner bears a concentrated load.
- `2-3`: Balances resource reuse and fault recovery.
- Larger values: Suitable for scenarios with many Topics and where a single connection faces server-side limits.

### Adaptive Owner Weighting

By default a new Topic is assigned to the owner with the fewest owned Topics. The
opt-in `loadWeighting` option adds traffic and scheduling signals so new routes
favor quieter, healthier Workers — existing routes stay sticky and never migrate.

```ts
const bus = createCentrifugeDataBus({
  connection: { url: getConnectionUrl() },
  loadWeighting: {
    messageRateWeight: 0.5,   // weight per message-per-second
    byteRateWeight: 0.001,    // weight per byte-per-second
    scheduleLagWeight: 2      // weight for heartbeat scheduling-lag ratio
  }
});
```

| Option | Default | Effect |
|---|---|---|
| `messageRateWeight` | `0` | Each Worker samples its own fan-out message rate per heartbeat window; the normalized rate is added to the effective load. |
| `byteRateWeight` | `0` | Same, for approximate payload bytes per second. |
| `scheduleLagWeight` | `0` | Weights the scheduling-lag ratio (`overrunMs ÷ windowMs`). A starved event loop lands heartbeats late, so this steers new routes away from a throttled Worker. |

All weights default to `0`, keeping the legacy pure topic-count behavior byte-identical.
Each weight must be a non-negative finite number; a negative or non-finite weight throws a
`TypeError` at construction, since a negative weight would bias new routes toward the
*busiest* Worker instead.
The per-Worker sample (`WorkerThroughputSample`) is published with the heartbeat and
carries `windowMs`, `messageCount`, `byteCount`, `overrunMs`, and `sampledAt`.

## Centrifuge Configuration

Main configuration for `createCentrifugeDataBus<TData>(options)`:

| Config | Type | Default | Description |
|---|---|---|---|
| `connection.url` | `string` | Required | Centrifuge connection URL |
| `connection.options` | `CentrifugeWorkerConfig` | `{}` | Client configuration sent to the Worker |
| `clusterKey` | `string` | `connection.url` | Manually isolate logical clusters |
| `workerMode` | `'dedicated' \| 'shared' \| 'auto'` | `'dedicated'` | Worker transport runtime mode; `auto` degrades via SharedWorker -> Dedicated Worker -> local mode, explicit `dedicated` degrades via Dedicated Worker -> SharedWorker -> local mode |
| `transferable` | `boolean` | `false` | When enabled, `publish(topic, ArrayBuffer)` uses Transferable transport; ArrayBuffer publications on the receiving side also follow the transfer path |
| `heartbeatIntervalMs` | `number` | `10000` | SharedWorker PING heartbeat interval (see SharedWorker Session Reaper below); `Infinity` disables heartbeats entirely and exempts that port from reaping. Distinct from the Core cluster heartbeat (default 3000 ms) which tracks worker liveness via localStorage |
| `workerFactory` | `() => Worker` | Built-in Worker | For testing or custom Worker loading |
| `sharedWorkerFactory` | `() => SharedWorker` | Built-in SharedWorker | For testing or custom SharedWorker loading |
| `credentialProvider` | `{ getToken?, getChannelToken? }` | `undefined` | Async credential refresh bridge: the Worker asks the main thread for each fresh token and this provider supplies it from application context. In practice that ask is `getToken`, the only credential hook `centrifuge@5.7.4` exposes — the type carries `getChannelToken` and the Worker protocol carries that request kind so a later SDK needs no change on this side, but nothing asks it today. Required because function-valued Centrifuge options cannot be structured-cloned into the Worker |
| Other Core config | Corresponding type | Core defaults | `storagePrefix`, heartbeat, TTL, etc. |

```ts
const bus = createCentrifugeDataBus({
  connection: {
    url: getConnectionUrl(),
    options: {
      token: getConnectionCredential(),
      timeout: 5000,
      maxServerPingDelay: 10000
    }
  },
  maxActiveWorkers: 3,
  heartbeatIntervalMs: 3000,
  workerTtlMs: 10000
});
```

## Worker Mode & Degradation

`workerMode` controls how the Centrifuge transport operates:

- `dedicated` (default): Each Tab creates its own Dedicated Worker; best compatibility.
- `shared`: Same-origin Tabs reuse the same SharedWorker; within the Worker, each connection port maintains its own independent `CentrifugeSession`. Stopping or refreshing one Tab does not affect other Tabs' connections.
- `auto`: Selects SharedWorker at runtime, degrades to Dedicated Worker if unsupported, and finally degrades to main-thread local mode.

The full chain for `auto` is **SharedWorker -> Dedicated Worker -> main-thread local mode**; the chain for explicit `shared` is identical to `auto` (**SharedWorker -> Dedicated Worker -> main-thread local mode**); the chain for explicit `dedicated` is **Dedicated Worker -> SharedWorker -> main-thread local mode**.

`shared` does not refuse to degrade: if the browser lacks `SharedWorker` support, it falls back through the same chain as `auto`. The only difference between `shared` and `auto` is the preference order's first choice — `shared` always prefers the SharedWorker, while `auto` performs the same selection but is the mode used when the caller has no strong preference.

When neither `sharedWorkerFactory` nor `workerFactory` is provided, the transport detects global `SharedWorker` / `Worker` capability at startup. When a custom factory is provided, the corresponding backend is considered available, avoiding false negatives from global capability detection in Node, SSR, or embedded environments. All modes perform the same structured clone validation; config and `publish` data must be structured-clonable.

## Coordination Channel Fallback (BroadcastChannel unavailable)

When `BroadcastChannel` is unavailable (some WebViews, older browsers), the cluster normally degrades to local-only operation: the transport works, but tabs do not coordinate ownership.

`createBrowserEnvironment({ channelFallback: 'storage-event' })` opts into a fallback `ClusterChannel` backed by localStorage `storage` events, preserving cross-tab coordination. It is opt-in because of a security trade-off: BroadcastChannel messages live in memory only, while the fallback writes coordination payloads (which carry plaintext topic names) to localStorage under the `cross-tab-worker-databus:channel:` key namespace — at least transiently, and indefinitely after a tab crash. The key is removed when the channel closes.

Storage events are delivered to other documents only. Two bus runtimes in the *same* document that share a `clusterKey` therefore do not exchange channel frames through the fallback; they still converge through the shared localStorage coordination records and the reconcile loop (bounded by the heartbeat interval). Give each runtime a distinct `clusterKey` — or keep BroadcastChannel — when you need same-document coordination.

## SharedWorker Session Reaper

A `MessagePort` has no `close` event, so the SharedWorker cannot know when a tab has crashed or been closed without sending a `STOP` message. To avoid leaking a `CentrifugeSession` (and its WebSocket) for a dead tab, the transport sends a periodic **PING heartbeat** to the SharedWorker, and the SharedWorker runs a **reaper** that closes any session whose port has been silent for longer than its timeout.

- **Heartbeat interval**: `heartbeatIntervalMs` (default `10000` ms). The main thread sends a `PING` on this cadence. Pass `Infinity` to disable heartbeats entirely: the transport sends no `PING` at all, and it tells the Worker so by carrying that same `Infinity` in its `INIT`, which **exempts the port from reaping** — nothing on that port can ever be judged silent. Use this only when the SharedWorker reaper is not needed (e.g. the tab always stops the bus itself, so every port leaves through `STOP`). The cost is symmetrical and worth stating: a tab configured this way and then *crashed* leaves its `CentrifugeSession` and its WebSocket in place, because the one thing that would have noticed was the heartbeat that was switched off.
- **Session timeout**: `3 × heartbeatIntervalMs` (default `30000` ms). A port silent for longer than its timeout is reaped: its session is stopped and its WebSocket closed. A port whose `INIT` carried `heartbeatIntervalMs: Infinity` has no timeout and is never reaped. This is distinct from the Core cluster heartbeat (default `3000` ms) which tracks worker liveness via localStorage — see the note below.
- **Adaptive cadence**: the reaper runs at the smallest configured heartbeat interval across active ports, so a port with a short heartbeat is reaped promptly. When the last port disconnects, the reaper interval is cleared so a long-lived SharedWorker does not run a perpetual no-op interval between connection bursts.
- **The tab is told before the port goes**: a port that is being reclaimed receives one final `SESSION_REAPED` message, then is closed, then its session is stopped. The order is the point — a `MessagePort` has no close event, and posting into a port the other side closed succeeds while delivering nothing, so this is the only thing a starved tab can ever learn from. Without it a tab that was merely stalled rather than gone (a long synchronous task, or the throttling a backgrounded tab gets) kept its cluster role and its topic routes while every publication it sent vanished into the dead port, and `getHealthSummary()` went on reporting `healthy` / `connected`. On receiving the message the transport discards the backend and reports the failure through `onError` and an `error` status, which is what lets the normal recovery path rebuild the session on a fresh port. Measured in a real browser: after a 34 s stall the tab re-established its subscription on its own — no user gesture, no lifecycle event — and the replacement connection was under a second old when it was observed.
- **Port closed before session stop**: when a port is reaped, the port is closed first and the session stopped after. Closing the port discards the session's `disconnected` status post (so it never reaches a live-but-slow main thread) and guarantees a closed port can never deliver a later message that would resurrect the session outside the reaper's tracking.
- **Failure isolation**: reaping wraps `target.notify()`/`close()`/`stop()` in try-catch and `dispose()` wraps `close()`/`stop()`, so a single failing port cannot abort the reaping pass or leave subsequent dead tabs uncollected. A step that throws does skip the steps after it — for that one port only.
- **`dispose()` has no Worker-side caller**: it clears the reaper interval and closes/stops **every** still-tracked session, and the unit tests exercise it, but the shipped SharedWorker never invokes it — a `MessagePort` has no close event, so there is no "the SharedWorker is shutting down" signal for such a hook to hang on. Every port leaves tracking through its own `STOP` handler or through the reaper, and the interval the reaper runs on is cleared once the last tracked port is gone.

This is the mechanism that recovers sessions for tabs that crash without sending `STOP`, and the announcement it makes is what lets a tab that did *not* crash notice and reconnect. Lower `heartbeatIntervalMs` to reap dead sessions faster, at the cost of more frequent PING messages on the port — and note that a value below roughly a third of the longest task your page runs will start reaping live tabs, each of which recovers by rebuilding its session.

`heartbeatIntervalMs` must be a positive number or `Infinity`; a value of `0`, a negative number, or `NaN` causes the transport constructor to throw a `TypeError` immediately (such a value would otherwise degenerate `setInterval` into a 0ms busy loop).

> **Two heartbeats, don't confuse them.** The Core `heartbeatIntervalMs` (default `3000` ms) is the cluster heartbeat — the WorkerClusterRuntime writes its liveness record to localStorage on this cadence. The Centrifuge `heartbeatIntervalMs` (default `10000` ms) is the SharedWorker PING heartbeat documented here. They are independent and both appear in the config surface; the Centrifuge one is only meaningful in `shared` mode.

## Binary Message Transfer

`transferable: true` enables the ArrayBuffer optimization path without changing the external API:

```ts
const bus = createCentrifugeDataBus({
  connection: { url: 'wss://example.test/connection/websocket' },
  transferable: true
});

bus.publish('resource.command', binaryBuffer);
```

When enabled, `publish(topic, ArrayBuffer)` uses `PUBLISH_BIN` for Worker transport and adds the buffer to the transfer list, avoiding structured clone copying. ArrayBuffer publications returned by the Worker are transferred back to the main thread via `MESSAGE_BIN`. The business layer still only sees `DataBusMessage<TData>`; object, string, and number payloads continue along the existing object message path. When disabled, ArrayBuffers are copied via structured clone like ordinary objects.

## Worker Structured Clone Constraints

In Worker mode, config is sent via `Worker` / `SharedWorker` `postMessage`; local mode also performs the same validation. Values must be structured-clonable. The following config items must not be passed directly:

- `getToken`
- `getData`
- Custom `websocket`
- Custom `fetch`
- `eventsource`
- `sockjs`
- `networkEventTarget`
- `ReadableStream` and other runtime objects

When non-clonable data is passed, `CentrifugeWorkerTransport` will throw a clear `TypeError`.

## Storage Data Boundaries

The coordination records this library writes itself — `{clusterHash}:worker:{workerId}`, `{clusterHash}:route:{topicKey}`, `{clusterHash}:subscriber:{topicKey}:{tabId}`, and the tab-id key — hold only:

- Worker and Tab identity, role, status, visibility, the owned-topic `load` figure, an optional rolling throughput sample, the advertised protocol version, and the heartbeat / first-registration timestamps
- The opaque Topic key, its owner's Worker and Tab identity, the last-update and generation numbers, and — during a graceful handoff — the previous owner and the owner's confirmation timestamp
- A subscriber record's Tab ID and its last-update timestamp
- The tab's own persisted id, which is what lets a reload reclaim its routes — written to `sessionStorage`, not to the cluster's `localStorage` namespace

Those records never hold:

- Connection URL plaintext
- Topic names
- Connection credentials
- Publication data

That is a boundary around *those keys*, not around browser storage in general. Two opt-ins put Topic plaintext and payloads into it:

- `channelFallback: 'storage-event'` writes every coordination **frame** whole under `cross-tab-worker-databus:channel:*`, and a `CONTROL/PUBLISH` frame carries its Topic name and payload — so they sit in `localStorage` until the channel is closed, and indefinitely if the tab is killed first.
- `replay.persistence` (e.g. `createIndexedDbReplayPersistence`) keeps replay history in IndexedDB in an object store keyed by the plaintext Topic, with the payloads in its rows.

Those two are the complete list, and it is checked rather than asserted: every durable write in `src/` is enumerated in `tests/storage-writers.test.ts`, and a new one — or a new row that carries a Topic without naming one of these two options — fails the suite.

Note: BroadcastChannel coordination messages carry topic names, event types, and publication payloads in plaintext (in memory only, unless the fallback above is what is carrying them). Only localStorage metadata is hashed via `createOpaqueKey()`.

## Security & Trust Model

The coordination plane has **no authentication**. Only use this library on pages where every same-origin script is trusted:

- `BroadcastChannel` messages are delivered to **every same-origin tab**, unencrypted, and any script in that origin can send or receive them. `localStorage` coordination records can likewise be read and written by any same-origin script.
- A malicious or buggy same-origin script can forge Worker records, hijack topic ownership, read Topic names and publication payloads from the BroadcastChannel, inject publications, or impersonate subscribers. Topics and payloads traverse the BroadcastChannel **in plaintext** (in memory only) — do not place credentials, tokens, or PII in Topic names or in coordinated message payloads beyond what your server would send anyway.
- `clusterKey` provides **isolation, not security**: it only prevents *accidental* cross-talk between logical clusters. It does not stop a script that can read `localStorage` or listen on the BroadcastChannel, because the opaque keys and channel name are derived from the same origin and can be recomputed. It also does not protect against scripts that read your page's own runtime state.
- `clusterKey` is hashed via `createOpaqueKey` (a non-cryptographic 128-bit hash) to derive the storage prefix and BroadcastChannel name. In practice `clusterKey` is always a connection URL or a developer-controlled namespace, so a hash collision between two different clusterKeys (~2⁻⁶⁴ birthday bound) is not a practical concern.
- Mitigations: keep the page free of untrusted third-party scripts; load coordination on an isolated origin; treat the origin's `localStorage` and BroadcastChannel namespaces as public. CSP cannot restrict BroadcastChannel or localStorage access from same-origin scripts.

The transport plane (e.g. the Centrifuge WebSocket) has its own security model — tokens, TLS, and server-side permissions — and is unaffected by the above. The cluster only decides which tab owns the transport subscription; a payload then reaches a tab from that owner over the BroadcastChannel, or from the server directly for the tab holding the subscription. The one exception is the `channelFallback: 'storage-event'` path above: there the channel *is* `localStorage`, so those same frames — payloads included — are written into it.

## Cluster Isolation Recommendations

The following contexts must use different `clusterKey`:

- Different server connections
- Different authentication identities
- Different data permission scopes
- Different protocol versions

When using the Centrifuge factory, the default connection URL usually provides sufficient isolation. When identity or permissions change under the same URL, an explicit `clusterKey` should be provided that includes the context version but not the credential plaintext.
