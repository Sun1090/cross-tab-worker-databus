# cross-tab-worker-databus

[![npm version](https://img.shields.io/npm/v/cross-tab-worker-databus)](https://www.npmjs.com/package/cross-tab-worker-databus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> [中文](./README.zh.md) | English

Framework-agnostic browser cross-tab data bus.

By default each tab holds its own Dedicated Worker; when configured with `workerMode: 'shared'` or `'auto'`, same-origin tabs can reuse a single SharedWorker. In `auto` mode it degrades automatically through SharedWorker → Dedicated Worker → main-thread WebSocket. Same-origin tabs form a logical Worker cluster over BroadcastChannel; the SDK automatically coordinates sticky Topic owners, subscription reuse, new-Topic load distribution, failover, and page lifecycle, so the application only needs to subscribe to Topics and process data.

## Features

- Subscribable immediately after creation; subscriptions auto-queue while the connection is pending
- Subscriptions within the same tab are deduplicated by handler reference counting
- Topic owners are reused across same-origin tabs, reducing duplicate real-time subscriptions
- In SharedWorker mode, same-origin tabs reuse a single SharedWorker; each tab's port maintains its own independent connection, so refreshing or stopping one tab does not affect others
- `workerMode` supports `dedicated` / `shared` / `auto`; `auto` degrades via SharedWorker → Dedicated Worker → main-thread WebSocket, while explicit `dedicated` degrades via Dedicated Worker → SharedWorker → main-thread WebSocket
- With `transferable: true`, ArrayBuffer messages are transmitted via Transferable while the object-message API stays unchanged
- localStorage coordination writes are merged and flushed in batches; heartbeat and route confirmation use exponential backoff
- Existing Topic owners remain stable while alive; visibility changes do not move established subscriptions
- New Topics are assigned to the least-loaded eligible Worker
- Wildcard subscriptions: `chat.*` and `*` patterns match concrete topics at dispatch
- Transport-neutral publication metadata (`messageId`, `timestamp`) with canonical WebSocket/Centrifuge envelopes and legacy frame compatibility
- Optional durable replay retention (`replay.retentionMs`) and deduplication outcome metrics in trace snapshots
- Built-in zero-dependency native WebSocket transport (`createWebSocketDataBus`) for plain-WebSocket servers
- Optional React hooks adapter (`cross-tab-worker-databus/hooks`): StrictMode-safe bus lifecycle, auto-cleanup subscriptions
- Optional Vue 3 composables adapter (`cross-tab-worker-databus/vue`): lifecycle-safe bus, subscription, and status composables
- `pagehide` releases resources automatically; `pageshow` rebuilds the Worker and connection automatically
- Transport reconnect automatically restores the current owner's Topics
- After a tab exits abnormally, automatic migration happens via heartbeat TTL
- Automatically degrades to local mode when BroadcastChannel or localStorage is unavailable
- The persistence layer does not store connection addresses, raw Topic text, or message content

See the [Capabilities Matrix](./docs/capabilities.md) for the full list of implemented, unimplemented, and planned capabilities.

## Installation

```bash
pnpm add cross-tab-worker-databus
```

The core package has zero runtime dependencies. The Centrifuge transport
(`cross-tab-worker-databus/centrifuge`) declares `centrifuge` as an optional
peer dependency — install it only when you use the built-in Centrifuge backend:

```bash
pnpm add cross-tab-worker-databus centrifuge
```

Tabs that only use the local BroadcastChannel data bus (no WebSocket server)
do not need to install `centrifuge` at all.

## Getting Started

```ts
import { createCentrifugeDataBus } from 'cross-tab-worker-databus/centrifuge';

interface ResourceEvent {
  id: string;
  version: number;
  content: unknown;
}

const bus = createCentrifugeDataBus<ResourceEvent>({
  connection: {
    url: getConnectionUrl(),
    options: getConnectionOptions()
  }
});

const unsubscribe = bus.subscribe('resource.changed', ({ data }) => {
  applyResourceEvent(data);
});

await bus.ready();

unsubscribe();
await bus.stop();
```

The application does not need to handle Tab owner, Worker migration, page recovery, or re-subscription after reconnection.

## Browser Demo

The repository includes runnable multi-tab demo pages that showcase real-time data flow between publishing, receiving, cluster routing, Worker sessions, and the server:

```bash
pnpm install
pnpm build
pnpm examples
```

Then open `http://localhost:4173/examples/demo/` in multiple tabs at the same time to see cross-tab data flowing. The demo page uses the public Centrifugo demo endpoint `wss://faye.centrifugal.dev/connection/websocket` by default; the address, Worker mode, and Topics can all be modified in-page. You can also switch to "local broadcast" mode, which does not depend on an external server and demonstrates multi-tab coordination purely through BroadcastChannel.

The demo page includes data-flow animations, an event stream, receive/dispatch latency metrics, and cluster Worker routing status.

## Docs

- [Docs Index](./docs/README.md)
- [Getting Started](./docs/getting-started.md)
- [Configuration](./docs/configuration.md)
- [API Reference](./docs/api.md)
- [Architecture](./docs/architecture.md)
- [Capabilities Matrix](./docs/capabilities.md)
- [Changelog](./CHANGELOG.md)

## API Examples

### Subscribe with lifecycle handling

```ts
const bus = createCentrifugeDataBus<ResourceEvent>({
  connection: { url: 'wss://example.com/ws', options: {} }
});

// Subscribe before connection — queued until ready
const unsub = bus.subscribe('events.created', ({ data }) => {
  console.log('event received:', data);
});

// Monitor connection status
const unsubStatus = bus.onStatus(status => {
  console.log('transport status:', status);
});

// Handle errors
const unsubError = bus.onError(error => {
  console.error('transport error:', error);
});

await bus.ready();

// Later: clean up
unsub();
unsubStatus();
unsubError();
await bus.stop();
```

### Multi-tab cluster with SharedWorker

```ts
import { createCentrifugeDataBus } from 'cross-tab-worker-databus/centrifuge';

const bus = createCentrifugeDataBus<ResourceEvent>({
  connection: {
    url: 'wss://example.com/connection/websocket',
    options: {}
  },
  workerMode: 'auto'  // SharedWorker → Dedicated Worker → local fallback
});

bus.subscribe('resource.changed', ({ data }) => {
  // Data arrives from any tab's owner Worker
  apply(data);
});
```

### Publish and receive

```ts
const publisher = createCentrifugeDataBus<ResourceEvent>({
  connection: { url: getUrl(), options: {} }
});
const receiver = createCentrifugeDataBus<ResourceEvent>({
  connection: { url: getUrl(), options: {} }
});

receiver.subscribe('resource.updated', ({ data }) => {
  console.log('got update:', data);
});

await publisher.ready();
publisher.publish('resource.updated', { id: 'abc', version: 2, content: { title: 'hello' } });
```

### Diagnostics

```ts
const bus = createCentrifugeDataBus<ResourceEvent>({
  connection: { url: getUrl(), options: {} },
  trace: {
    enabled: true,
    sink: event => console.log('trace:', event.type, event)
  }
});

// Snapshot
const snapshot = bus.getClusterSnapshot();
console.log(snapshot.workers, snapshot.routes, snapshot.assignedTopics);
```

## FAQ

**Why is my subscription not receiving messages from the other tab?**
Cross-tab delivery for a topic only has one transport subscription (the owner). The owner fans out received publications to all tabs via BroadcastChannel `EVENT` messages, so if the receiving tab's browser disables BroadcastChannel or storage, it degrades to local-only mode. Check `bus.getStatus()` and `getClusterSnapshot().coordinated`.

**Does every tab open its own WebSocket?**
With the default `dedicated` mode, yes — each tab owns a connection through its own Worker. With `shared` (or `auto` in shared-capable browsers), same-origin tabs reuse one SharedWorker process while each tab's port keeps an independent session. Topic ownership is deduplicated across tabs either way, so popular topics are only subscribed once per cluster.

**What happens when the owning tab crashes?**
Ownership migrates. A graceful exit (pagehide) performs a strict handoff; an uncontrolled crash (killed tab, browser kill) is recovered via the heartbeat TTL — worst case `heartbeatIntervalMs + workerTtlMs` (≈13s with defaults).

**Do I need `centrifuge` installed?**
Only if you use the built-in Centrifuge backend (`cross-tab-worker-databus/centrifuge`). It is an optional peer dependency; the core package has zero runtime dependencies.

**How do I migrate from 0.1.x to 0.2.x?**
`centrifuge` moved from `dependencies` to an optional `peerDependency`. If you use the Centrifuge backend, add it to your own dependencies (`pnpm add centrifuge@^5.5.3`); no code changes are required. See the [0.2.0 changelog](./CHANGELOG.md).

## Development


```bash
pnpm install
pnpm check          # typecheck + unit tests + build
pnpm test:e2e       # Playwright multi-tab browser tests (requires Google Chrome)
pnpm pack --pack-destination /tmp
```

## License

[MIT](./LICENSE)
