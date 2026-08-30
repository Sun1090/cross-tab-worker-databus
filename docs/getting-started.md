> [中文](./zh/getting-started.md) | English

# Getting Started

## 1. Installation

```bash
pnpm add cross-tab-worker-databus
```

The package provides the following entry points:

- `cross-tab-worker-databus`: the core DataBus and transport interfaces
- `cross-tab-worker-databus/centrifuge`: the built-in Centrifuge Worker transport
- `cross-tab-worker-databus/centrifuge.worker`: the Dedicated Worker build artifact, loaded by default by the built-in factory; typically no need to reference it directly
- `cross-tab-worker-databus/centrifuge.shared.worker`: the SharedWorker build artifact, loaded by default by the built-in factory; typically no need to reference it directly
- `cross-tab-worker-databus/hooks`: optional React hooks adapter (`useCrossTabDataBus`, `useCrossTabSubscription`, `useCrossTabStatus`); React (>= 18) is an optional peer dependency
- `cross-tab-worker-databus` also exports a zero-dependency native `WebSocketTransport` / `createWebSocketDataBus` for servers that speak plain WebSockets

The `cross-tab-worker-databus/centrifuge` entry point relies on the optional peer dependency `centrifuge` (^5.5.3). Install it alongside this package when using the built-in Centrifuge transport: `pnpm add centrifuge`.

## 2. Creating an Instance

It is recommended to create an instance in the application's infrastructure layer and have other modules import it directly. This way, business modules within the same Tab share the Worker, connection, and Topic references.

Both module formats are published: ESM (`import`) and CommonJS (`require` / `dist/cjs`), so CJS bundler configurations and `require()` callers work out of the box.

When consuming the Centrifuge entry as CommonJS in a browser, provide an explicit `workerFactory` (or `sharedWorkerFactory`) if your bundler does not preserve `import.meta.url`; the default module-relative Worker URL is only available in ESM output.

```ts
import { createCentrifugeDataBus } from 'cross-tab-worker-databus/centrifuge';

export interface ResourceEvent {
  id: string;
  version: number;
  content: unknown;
}

export const dataBus = createCentrifugeDataBus<ResourceEvent>({
  connection: {
    url: getConnectionUrl(),
    options: getConnectionOptions()
  }
});
```

`clusterKey` is derived from the connection URL by default. It is only used for cluster isolation and is converted to an opaque key before entering localStorage and as the BroadcastChannel channel name. Note that topic names and event types sent over the BroadcastChannel coordination channel are transmitted in plaintext; only localStorage metadata is obfuscated via hashing.

By default, a Dedicated Worker is used, one Worker per Tab. To have same-origin Tabs reuse a single connection, set `workerMode: 'shared'` or `'auto'`:

```ts
export const dataBus = createCentrifugeDataBus<ResourceEvent>({
  connection: {
    url: getConnectionUrl(),
    options: getConnectionOptions()
  },
  workerMode: 'auto'
});
```

`auto` prefers SharedWorker when available, otherwise falls back to Dedicated Worker, and finally to the main-thread local mode.

## 3. Subscribing

You can subscribe immediately after the instance is created, without waiting for the connection to complete.

```ts
const unsubscribe = dataBus.subscribe('resource.changed', message => {
  applyResourceEvent(message.data);
});
```

When the connection is not yet ready, the SDK saves the subscription intent and executes it after the transport is ready. Multiple handlers for the same Topic use local reference counting, producing only a single cluster subscription.

## 4. Waiting for Connection

Most business logic does not need to call `ready()`. Only wait when subsequent steps must confirm that the Worker has been created and transport's `start` has completed:

```ts
await dataBus.ready();
```

`ready()` does not guarantee that the server has finished authentication; the connection state is determined by the `onStatus` callback.

If the instance was created without `initialConfig` and you call `ready()` before an explicit `start(config)`, the returned Promise rejects instead of throwing; attach `.catch` and retry with `start(config)` when appropriate.

## 5. Publishing

```ts
dataBus.publish('resource.command', {
  action: 'refresh',
  targetId: 'resource-id'
});
```

Only use `publish` when the server protocol allows the client to publish. The SDK does not automatically replay publish operations that were not executed due to page suspension, to avoid side effects from stale commands.

## 6. Status and Errors

```ts
const removeStatusListener = dataBus.onStatus(status => {
  updateConnectionIndicator(status);
});

const removeErrorListener = dataBus.onError(error => {
  reportDataBusError(error);
});
```

Status values:

- `connecting`
- `connected`
- `disconnected`
- `error`

## 7. Cleanup

Release a single module subscription:

```ts
unsubscribe();
```

Fully destroy an instance:

```ts
removeStatusListener();
removeErrorListener();
await dataBus.stop();
```

Normal Tab hiding, entering BFCache, and restoring do not require business logic to call `stop()` or re-subscribe; the SDK handles this automatically.

## 8. Running the Multi-Tab Demo

The repository's `examples/demo` provides a browser demo page where you can see the full flow of messages across Tabs, clusters, Worker sessions, and the server:

```bash
pnpm install
pnpm build
pnpm examples
```

Open `http://localhost:4173/examples/demo/` and open it in multiple browser Tabs at the same time to observe cross-Tab data flow. The page supports:

- Connecting to the public Centrifugo demo address `wss://faye.centrifugal.dev/connection/websocket` by default
- Modifying the WSS address, `workerMode`, Topic, and `transferable` configuration in the page
- Switching to "Local Broadcast" mode, which does not depend on an external server and demonstrates multi-Tab collaboration using only BroadcastChannel
- Data flow animations, event stream, distribution latency metrics, and cluster Worker routing status
- SDK capability, transport configuration, active/standby Worker, and visible/hidden Tab state

When consuming the repository directly through a Git dependency, use a pinned commit. The repository ships `dist` so consumers do not need to build the SDK during installation.

## 9. Explicit Start

When a custom transport's configuration needs to be fetched asynchronously, you can omit `initialConfig` and explicitly start once preparation is complete:

```ts
import { CrossTabDataBus } from 'cross-tab-worker-databus';

const bus = new CrossTabDataBus({
  clusterKey: 'shared-resource-stream',
  transport
});

const config = await loadTransportConfig();
await bus.start(config);
bus.subscribe('resource.changed', handleResourceEvent);
```
