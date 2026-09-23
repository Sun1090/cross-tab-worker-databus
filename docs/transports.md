# Transport Backends

> [中文](./zh/transports.md) | English

The core package (`cross-tab-worker-databus`) is transport-agnostic. It defines a
`DataBusTransport` contract; the built-in Centrifuge backend is one implementation
of that contract, exposed as the optional `./centrifuge` subpath. This document
describes the contract and how to wire up a third-party backend (native WebSocket,
socket.io, SSE, etc.).

## The `DataBusTransport` contract

Every backend implements five methods. `subscribe` / `unsubscribe` MUST be
idempotent — the DataBus may call them repeatedly and replays them on reconnect.

```ts
interface DataBusTransport<TConfig = unknown, TData = unknown> {
  /** Optional identity/backend labels surfaced through diagnostics. */
  readonly diagnosticsName?: string;
  readonly diagnosticsBackend?: string;
  start(config: TConfig, handlers: DataBusTransportHandlers<TData>): MaybePromise<void>;
  subscribe(topic: string): MaybePromise<void>;
  unsubscribe(topic: string): MaybePromise<void>;
  /** `options` carries the caller's `{ messageId, timestamp }`; a backend that
   * drops it silently strips dedup identity and producer timestamps from peers. */
  publish(topic: string, data: unknown, options?: DataBusPublishOptions): MaybePromise<void>;
  /** Optional: one frame for a burst. Without it the DataBus loops `publish`.
   * Each item is `{ data, messageId?, timestamp? }` — the same metadata `publish`
   * takes, per entry. That entry type is exported as `DataBusPublicationItem`;
   * name it, write it inline, or widen the `ReadonlyArray` to whatever your
   * backend accepts. */
  publishBatch?(topic: string, items: ReadonlyArray<{ data: unknown; messageId?: string; timestamp?: number }>): MaybePromise<void>;
  stop(): MaybePromise<void>;
}

interface DataBusTransportHandlers<TData = unknown> {
  onMessage: (message: DataBusMessage<TData>) => void;
  onStatus: (status: WorkerStatus) => void;   // 'connecting' | 'connected' | 'disconnected' | 'error'
  onError: (error: unknown) => void;
}
```

`start()` receives the user-supplied connection config (untyped `TConfig` — the
backend owns its shape) and the three callbacks. Call `onStatus` whenever the
connection state changes; call `onMessage` for each inbound publication; call
`onError` for non-fatal errors. Only `onStatus('error')` starts auto-recovery —
the DataBus paces that reopen with a recovery cooldown and bounds it with
`recovery.maxAttempts`, so a flapping connection does not retry-loop. `onError`
records the failure for `getHealthSummary().lastFailure` and notifies subscribers,
and nothing else: a backend that reports a dead socket through `onError` alone
is never reopened.

`start()` MUST settle its returned promise only once the backend is connected,
and reject it when the attempt fails. The DataBus uses that settlement as its
readiness and recovery boundary: a `CONNECTING` socket is not ready, and queued
operations must not be released until the handshake succeeds. A backend that
can stall should enforce its own handshake timeout and reject.

## Architectural layers

```
CrossTabDataBus  ──►  DataBusTransport (your backend)
                          │
                  ┌───────┴────────┐
                  │ Worker protocol │   (your backend's main-thread ↔ worker messages)
                  └───────┬────────┘
                          │
                     Session layer   (the actual client: WebSocket / centrifuge / …)
                          │
                        Server
```

The DataBus layer handles cross-tab coordination (BroadcastChannel control
plane, localStorage routes, owner selection, failover, page lifecycle). Your
transport only owns the I/O path: connect, subscribe, publish, disconnect.

## Implementing a backend

### 1. Define your Worker protocol

Mirror the Centrifuge backend's `centrifuge-protocol.ts`: a discriminated union
of messages the main thread sends to the Worker (`INIT` / `SUBSCRIBE` /
`UNSUBSCRIBE` / `PUBLISH` / `PUBLISH_BIN` / `PING` / `STOP`, plus
`TOKEN_RESPONSE` / `TOKEN_ERROR` answering a credential request) and a union the
Worker posts back (`STATUS` / `MESSAGE` / `MESSAGE_BIN` / `ERROR`, plus
`TOKEN_REQUEST` for the credential bridge and `SESSION_REAPED` when a SharedWorker
port is reclaimed). Keep it
structured-cloneable (no functions,
no class instances — `Error` must be serialised).

### 2. Implement the session

A session class owns one connection and lives inside the Worker (or, as a
fallback, on the main thread). It receives protocol messages via a `handle()`
method and posts outputs back through a sink. See
[`centrifuge-session.ts`](../src/centrifuge-session.ts) for the reference shape:

- `handle(message)` dispatches by `message.type`.
- `subscribe(topic)` is idempotent — re-subscribing an existing topic is a no-op.
- `unsubscribe(topic)` removes listeners before disconnecting, to avoid a late
  event resurrecting a re-subscribed topic.
- `stop()` disconnects, clears all subscriptions, and emits `disconnected`.

### 3. Implement the transport

The transport selects a backend (SharedWorker / Dedicated Worker / local),
posts protocol messages to it, and routes Worker outputs back to the
`DataBusTransportHandlers`. See [`centrifuge.ts`](../src/centrifuge.ts) for the
reference shape, including:

- **Backend selection**: reuse `selectWorkerBackend` from `worker-mode.ts` so
  your backend degrades consistently with the rest of the SDK.
- **Generation guard**: bump a monotonic counter when a backend is created or the
  transport stops. Only the asynchronous credential bridge compares it, because a
  provider can settle after the Worker it was answering is gone. Worker error
  handlers read no such counter in the reference implementation — `stop()` and
  `onWorkerFailed()` remove those listeners before the generation moves on, so a
  superseded backend cannot reach the transport at all. If your backend keeps a
  listener alive across a swap, that is when you need the check yourself.
- **SharedWorker heartbeat**: if you use a SharedWorker, send periodic PINGs
  so a `PortReaper` can reclaim dead-tab sessions, and handle the
  `SESSION_REAPED` message the reaper posts before it closes a port. That
  message is the only signal a starved-but-still-alive tab can receive (a
  `MessagePort` has no close event, and posting into a closed one delivers
  nothing), and this transport turns it into a reported backend failure so the
  recovery path rebuilds the session.

### 4. Expose as a subpath

Add `exports` entries in `package.json` (one per entry point — the main bundle,
the dedicated worker, the shared worker):

```json
{
  "exports": {
    "./your-backend": {
      "types": "./dist/your-backend.d.ts",
      "import": "./dist/your-backend.js"
    },
    "./your-backend.worker": "./dist/your-backend.worker.js",
    "./your-backend.shared.worker": "./dist/your-backend.shared.worker.js"
  }
}
```

This keeps the core package zero-dependency: users who do not import
`./your-backend` never pull your client library into their bundle.

### 5. Register the peer dependency

Declare your client library as an optional peer dependency so consumers
opt in:

```json
{
  "peerDependencies": { "your-client-lib": "^x.y.z" },
  "peerDependenciesMeta": { "your-client-lib": { "optional": true } }
}
```

## Built-in: native WebSocket backend

The package ships a second real backend, `WebSocketTransport`, proving the
contract above with zero dependencies. Use it when your server already speaks
WebSockets and you do not need Centrifugo features.

```ts
import { createWebSocketDataBus } from 'cross-tab-worker-databus';

const bus = createWebSocketDataBus({
  connection: { url: 'wss://example.test/ws' }
});
```

Wire protocol (JSON text frames):

- client → server: `{"op":"subscribe"|"unsubscribe"|"publish","topic":"...","data":...,"messageId"?:"...","timestamp"?:123}`
- client → server (batched): `{"op":"publishBatch","topic":"...","items":[{data,...,"messageId"?,"timestamp"?}]}` — one frame whose entries the server re-fans out as individual publications. Binary payloads ride inside it as byte arrays. A one-item batch is sent as a plain `publish` frame instead, so a server that implements only `publish` still sees the legacy shape; an empty batch is dropped before it reaches the socket. A batch frame on a closed socket is reported through `handlers.onError` and dropped.
- server → client: the canonical publication is `{"op":"publication","publication":{"topic":"...","data":...,"messageId"?:"...","timestamp"?:123}}`. The legacy flat `{"topic":"...","data":...}` frame remains accepted. Frames without a string topic are ignored; malformed JSON is reported through `handlers.onError` without throwing.
- A publication that carries its own string `topic` is addressed by **that** value rather than by the channel it arrived on — that is how a server delivering through a wildcard channel (`chat.*`) names the concrete topic. A payload whose top level happens to contain a `topic` string is therefore re-addressed, and dropped when no tab owns the resulting topic. On Centrifuge the channel normally arrives out of band, which is why the rule needs stating here: it is the one transport where "the topic was already in the frame" is not otherwise visible.

When `data` is an `ArrayBuffer`, publish uses a binary frame with a small
header (`0xc7`, UTF-8 topic length, topic, payload). Servers may echo the same
frame unchanged. A binary publication carrying metadata uses the JSON-compatible
byte-array envelope so `messageId` and `timestamp` are not lost.

The Centrifuge session applies the same transport-neutral contract. Payloads
without metadata keep their original shape. Metadata-bearing publishes use
`{ data, messageId?, timestamp? }`, while inbound publications additionally
accept the canonical nested `DataBusPublicationEnvelope`.

`start()` resolves only after `open` and rejects when the handshake errors,
closes before opening, or exceeds `connectTimeoutMs` (default `30000` ms; `0`
or `Infinity` waits indefinitely). A timed-out socket is closed and a late
`open` from that attempt is ignored.

Lifecycle mapping: `open` → `connected`, `close` → `disconnected`,
`error` → `error` (DataBus auto-recovery). Subscribe frames are re-sent when
the socket reopens in place. A successful reopen can either reuse the same
socket object or create a replacement through the factory; callbacks from the
superseded socket are ignored, so a late close or message from the failed
connection cannot pollute the recovered one. A clean `disconnected` schedules no
background recovery, but the next `subscribe()` / `publish()` demands one reopen
and flushes behind it, so a post-close operation is never sent to the closed
socket. A pattern-aware server may tag publications with the concrete topic —
see wildcard subscriptions in [api.md](./api.md).

## Factory entry point


Provide a `create<Backend>DataBus(options)` factory that wires the transport
into a `CrossTabDataBus`, mirroring `createCentrifugeDataBus`. This is the
surface most consumers use; it should accept the connection config, cluster
key (defaulting to the connection URL), and forward trace / worker-mode
options to the DataBus.

## What the transport does NOT own

- **Cross-tab routing**: the `WorkerClusterRuntime` decides which tab owns a
  topic. Your transport just subscribes when told.
- **Reconnect replay**: the DataBus replays the current owner's topics on
  reconnect; your transport's `subscribe` must be safe to call again.
- **Publication fan-out**: the owner broadcasts publications over
  BroadcastChannel; your transport only receives and reports them.
- **Page lifecycle**: the DataBus suspends/resumes the transport on
  `pagehide` / `pageshow`; your transport's `stop()` must be clean.
