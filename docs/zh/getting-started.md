> 中文 | [English](../getting-started.md)

# 快速接入

## 1. 安装

```bash
pnpm add cross-tab-worker-databus
```

包提供以下入口：

- `cross-tab-worker-databus`：核心 DataBus 和 transport 接口
- `cross-tab-worker-databus/centrifuge`：内置 Centrifuge Worker transport
- `cross-tab-worker-databus/centrifuge.worker`：Dedicated Worker 构建产物，默认由内置 factory 加载，通常无需直接引用
- `cross-tab-worker-databus/centrifuge.shared.worker`：SharedWorker 构建产物，默认由内置 factory 加载，通常无需直接引用
- `cross-tab-worker-databus/hooks`：可选的 React hooks 适配层（`useCrossTabDataBus`、`useCrossTabSubscription`、`useCrossTabStatus`）；React（>= 18）为可选 peer 依赖
- `cross-tab-worker-databus` 同时导出零依赖的原生 `WebSocketTransport` / `createWebSocketDataBus`，适用于本身使用 WebSocket 的服务器

`cross-tab-worker-databus/centrifuge` 入口依赖可选 peer dependency `centrifuge`（^5.5.3）。使用内置 Centrifuge transport 时请一并安装：`pnpm add centrifuge`。

## 2. 创建实例

建议在应用基础设施层创建一个实例，其他模块直接导入。这样同一 Tab 内的业务模块会共享 Worker、连接和 Topic 引用。

包同时发布 ESM 与 CommonJS 双格式：`import` 与 `require()`（`dist/cjs`）均可直接使用，CJS bundler 配置无需额外处理。

在浏览器中以 CommonJS 使用 Centrifuge 入口时，如果 bundler 不保留 `import.meta.url`，请显式提供 `workerFactory`（或 `sharedWorkerFactory`）；默认的模块相对 Worker URL 仅在 ESM 产物中可用。

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

`clusterKey` 默认由连接地址派生。它只用于集群隔离，进入 localStorage 和 BroadcastChannel 通道名称前会转换为不透明 key。请注意，通过 BroadcastChannel 协调通道发送的 Topic 名称和事件类型以明文传输；仅 localStorage 元数据通过哈希进行混淆。

默认使用 Dedicated Worker，每个 Tab 一个 Worker。希望同源 Tab 复用同一个连接时，设置 `workerMode: 'shared'` 或 `'auto'`：

```ts
export const dataBus = createCentrifugeDataBus<ResourceEvent>({
  connection: {
    url: getConnectionUrl(),
    options: getConnectionOptions()
  },
  workerMode: 'auto'
});
```

`auto` 在 SharedWorker 可用时优先使用，否则降级到 Dedicated Worker，最后使用主线程本地模式。

## 3. 订阅

实例创建后可以立即订阅，不必等待连接完成。

```ts
const unsubscribe = dataBus.subscribe('resource.changed', message => {
  applyResourceEvent(message.data);
});
```

连接尚未准备好时，SDK 会保存订阅意图并在 transport ready 后执行。相同 Topic 的多个 handler 使用本地引用计数，只产生一次集群订阅。

## 4. 等待连接

多数业务不需要调用 `ready()`。只有后续流程必须确认 Worker 已创建、transport 的 `start` 已完成时才等待：

```ts
await dataBus.ready();
```

`ready()` 不表示服务端一定已完成认证；连接状态以 `onStatus` 回调为准。

如果实例创建时没有传入 `initialConfig`，且在显式 `start(config)` 之前调用 `ready()`，返回的 Promise 会 reject 而不是同步抛出；请通过 `.catch` 处理，并在合适的时机用 `start(config)` 重试。

## 5. 发布

```ts
dataBus.publish('resource.command', {
  action: 'refresh',
  targetId: 'resource-id'
});
```

只有服务端协议允许客户端发布时才使用 `publish`。SDK 不会自动重放因页面暂停而未执行的发布操作，避免过期命令产生副作用。

## 6. 状态和错误

```ts
const removeStatusListener = dataBus.onStatus(status => {
  updateConnectionIndicator(status);
});

const removeErrorListener = dataBus.onError(error => {
  reportDataBusError(error);
});
```

状态值：

- `connecting`
- `connected`
- `disconnected`
- `error`

## 7. 清理

释放单个模块订阅：

```ts
unsubscribe();
```

彻底销毁实例：

```ts
removeStatusListener();
removeErrorListener();
await dataBus.stop();
```

正常的 Tab 隐藏、进入 BFCache 和恢复不需要业务调用 `stop()` 或重新订阅，SDK 会自动处理。

## 8. 运行多标签演示

仓库的 `examples/demo` 提供了一个浏览器演示页，可以看到消息在标签页、集群、Worker 会话和服务器之间的完整流向：

```bash
pnpm install
pnpm build
pnpm examples
```

打开 `http://localhost:4173/examples/demo/`，在多个浏览器标签页中同时打开即可观察跨 Tab 数据流转。页面支持：

- 默认连接公共 Centrifugo 演示地址 `wss://faye.centrifugal.dev/connection/websocket`
- 在页面内修改 WSS 地址、`workerMode`、Topic 和 `transferable` 配置
- 切换到"本地广播"模式，不依赖外部服务器，仅用 BroadcastChannel 演示多标签协同
- 数据流动画、事件流、分发延迟指标和集群 Worker 路由状态
- SDK 能力、transport 配置、活跃/等待 Worker 与可见/隐藏 Tab 状态

通过 Git 依赖直接接入仓库时，应固定到具体 commit。仓库随代码提供 `dist`，消费方安装时无需构建 SDK。

## 9. 显式启动

自定义 transport 的配置需要异步获取时，可以不传 `initialConfig`，准备完成后显式启动：

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
