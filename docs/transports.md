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
  start(config: TConfig, handlers: DataBusTransportHandlers<TData>): MaybePromise<void>;
  subscribe(topic: string): MaybePromise<void>;
  unsubscribe(topic: string): MaybePromise<void>;
  publish(topic: string, data: unknown): MaybePromise<void>;
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
`onError` for non-fatal errors (the DataBus applies a recovery cooldown so a
flapping connection does not retry-loop).

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
`UNSUBSCRIBE` / `PUBLISH` / `PUBLISH_BIN` / `PING` / `STOP`) and a union the
Worker posts back (`STATUS` / `MESSAGE` / `MESSAGE_BIN` / `ERROR`). Keep it
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
- **Generation guard**: bump a monotonic counter when a backend is created;
  error handlers check it so late errors from a superseded Worker cannot
  corrupt the fresh session.
- **SharedWorker heartbeat**: if you use a SharedWorker, send periodic PINGs
  so a `PortReaper` can reclaim dead-tab sessions.

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
