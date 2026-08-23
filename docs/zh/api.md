> 中文 | [English](../api.md)

# API 参考

## 包入口

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

业务接入优先使用 `CrossTabDataBus` 或 `createCentrifugeDataBus`。`WorkerClusterRuntime` 属于高级协调 API。

## `CrossTabDataBus<TConfig, TData>`

### constructor

```ts
new CrossTabDataBus<TConfig, TData>(options)
```

创建 DataBus。传入 `initialConfig` 时默认自动启动。

### `start(config)`

```ts
start(config: TConfig): Promise<void>
```

启动集群协调和 transport。首次调用真正启动 transport；启动过程中并发调用共享同一个启动 Promise，不重复创建 transport。启动成功或失败后，内部 gate 会重置：之后再次调用是已启动的空操作（立即 resolve），不会重复启动；`stop()` 之后可重新调用再次启动。

### `ready()`

```ts
ready(): Promise<void>
```

等待当前 transport 的 `start` 完成。自动启动失败时 Promise 会 reject；再次调用可以触发基于 `initialConfig` 的重试。

未传入 `initialConfig` 且未显式调用 `start(config)` 时，`ready()` 返回 rejected Promise 而不是同步抛出，调用方可以统一通过 `.catch` 处理并决定是否显式启动。

`ready()` 不等价于服务端已连接，协议连接状态通过 `onStatus` 获取。

### `subscribe(topic, handler)`

```ts
subscribe(
  topic: string,
  handler: DataBusMessageHandler<TData>
): () => void
```

登记本地订阅并返回释放函数。

- 同一 Topic 的多个 handler 使用引用计数。
- 当前 Tab 第一个 handler 会登记集群订阅。
- 最后一个 handler 释放后，当前 Tab 才退出该 Topic。
- transport 尚未 ready 时订阅自动排队。

### `unsubscribe(topic, handler?)`

```ts
unsubscribe(topic: string, handler?: DataBusMessageHandler<TData>): void
```

传入 handler 时只释放对应回调；省略 handler 时释放当前实例中该 Topic 的全部 handler。

优先使用 `subscribe` 返回的释放函数，避免误删其他模块的回调。

### `publish(topic, data)`

```ts
publish(topic: string, data: unknown): void
```

将发布操作路由到当前 Topic owner；没有有效路由时使用当前 Worker。

发布数据必须满足底层 transport 的序列化约束。SDK 不会在页面暂停期间持久化或延迟重放发布命令。

当 owner 是远端 Tab、且发布控制消息无法投递时（例如 BroadcastChannel 无法克隆 payload），`publish()` 会通过 `onError` 上报失败，而不是静默丢弃。

### `onStatus(handler)`

```ts
onStatus(handler: DataBusStatusHandler): () => void
```

监听 transport 状态。注册后立即收到当前状态。

### `onError(handler)`

```ts
onError(handler: DataBusErrorHandler): () => void
```

监听启动、订阅、退订、发布和 Worker 错误。

### `getStatus()`

```ts
getStatus(): WorkerStatus
```

返回当前状态：`connecting`、`connected`、`disconnected` 或 `error`。

### `getClusterSnapshot()`

返回诊断快照：

```ts
interface WorkerClusterSnapshot {
  coordinated: boolean;
  suspended: boolean;
  currentWorker: WorkerRecord;
  workers: WorkerRecord[];
  /** 路由记录，从 knownTopics 缓存注入明文 topic。 */
  routes: Array<WorkerRoute & { topic: string | null }>;
  subscribedTopics: string[];
  assignedTopics: string[];
  /** 不透明 key → 明文 topic 的映射，用于调试。 */
  knownTopics: Array<{ topicKey: string; topic: string }>;
}
```

快照用于诊断和测试，不应作为业务状态源。

使用 `console.table(snapshot.routes)` 查看所有路由及其明文 topic，或 `snapshot.knownTopics` 关联不透明 key 与 topic。

### `trace`

通过构造配置启用可选诊断：

```ts
trace: {
  enabled: true,
  mode: 'all',
  metricsIntervalMs: 5000,
  sink: (event: DataBusTraceEvent) => report(event)
}
```

低频事件类型包括 `lifecycle`、`status`、`subscription`、`coordination` 和 `error`；高频数据按窗口输出 `message_metrics`，包含接收/分发计数、活跃 Topic 数量和分发延迟聚合（`dispatchSamples`、`dispatchAvgMs`、`dispatchP50Ms`、`dispatchP95Ms`、`dispatchMaxMs`）。所有公开事件都使用固定结构，不包含原始 Topic、消息 payload、连接地址或错误正文。sink 抛错会被隔离，不会中断消息分发，但会向 `console.warn` 输出错误，便于定位诊断配置问题。sink 应尽量避免抛出异常——预期中的错误条件应通过事件数据表达，而不是通过异常上报。

### `stop()`

```ts
stop(): Promise<void>
```

永久销毁当前实例：清理 handler、集群注册、路由、Worker 和 transport。普通页面隐藏和恢复不需要调用。

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

实现要求：

- `subscribe` 和 `unsubscribe` 必须幂等。
- `stop` 后必须允许再次 `start`，用于 BFCache 恢复。
- 收到数据时调用 `handlers.onMessage({ topic, data })`。
- 状态变化时调用 `handlers.onStatus(status)`。
- 异步错误通过 reject 或 `handlers.onError(error)` 上报。

## `createCentrifugeDataBus<TData>(options)`

```ts
createCentrifugeDataBus<TData>(options): CrossTabDataBus<CentrifugeDataBusConfig, TData>
```

创建自动启动的 Centrifuge DataBus。默认：

- `clusterKey = connection.url`
- `workerMode = 'dedicated'`，每个 Tab 使用独立 Dedicated Worker
- 使用包内 `centrifuge.worker.js`
- Worker 名称为 `cross-tab-worker-databus`

SharedWorker 模式使用包内 `centrifuge.shared.worker.js`。`workerMode: 'auto'` 时按 SharedWorker → Dedicated Worker → 本地模式降级。完整配置见 [configuration.md](./configuration.md)。

## `CentrifugeWorkerTransport<TData>`

低层 Centrifuge transport。只有需要自定义 DataBus 组装时才直接创建：

```ts
const transport = new CentrifugeWorkerTransport({
  workerMode: 'auto',
  workerFactory: () => new Worker(customWorkerUrl, { type: 'module' }),
  sharedWorkerFactory: () => new SharedWorker(customSharedWorkerUrl, { type: 'module' })
});
```

可用选项：

- `workerMode`：`'dedicated'`（默认）、`'shared'` 或 `'auto'`；`auto` 的降级链路为 SharedWorker → Dedicated Worker → 本地模式
- `transferable`：`boolean`，默认 `false`；开启后 ArrayBuffer payload 使用 Transferable 传输，对象消息 API 不变
- `heartbeatIntervalMs`：`number`，默认 `10000`；SharedWorker PING 心跳间隔（毫秒）。传 `Infinity` 完全禁用心跳。详见 [配置](./configuration.md#sharedworker-会话回收)
- `workerFactory`：自定义 Dedicated Worker 加载方式
- `sharedWorkerFactory`：自定义 SharedWorker 加载方式

## `WorkerClusterRuntime`

高级 API，负责 Worker 注册、心跳、可见性、路由、BroadcastChannel 协议和迁移。业务模块不应直接操作它。

主要方法：

- `start()` / `stop()`
- `setStatus(status)`
- `subscribe(topic)` / `unsubscribe(topic)`
- `publish(topic, data)`
- `broadcastEvent(eventType, payload)`
- `isAssigned(topic)`
- `isActiveWorker()`
- `hasLocalSubscriber(topic)`
- `getSnapshot()`

## 工具函数

### `createOpaqueKey(value)`

生成稳定的 128-bit 十六进制不透明 key。用于避免把连接或 Topic 原文写入协调元数据；它不是密码学摘要，不应用于密码存储或安全签名。

### `createBrowserEnvironment()`

创建默认浏览器环境适配器，包含 storage、BroadcastChannel、定时器和页面生命周期事件。

### `selectWorkerBackend(mode, availability?)`

按 `WorkerMode` 和能力检测选择实际后端，返回 `'shared' | 'dedicated' | 'local'`：

- `shared` / `auto`：SharedWorker → Dedicated Worker → 本地模式
- `dedicated`（默认）：Dedicated Worker → SharedWorker → 本地模式

`availability` 可显式传入 `worker` / `sharedWorker` 能力标记，用于 SSR、测试或嵌入环境，避免访问不存在的全局对象。

### 路由选择函数

- `selectActiveWorkers`
- `selectLeastLoadedWorker`
- `selectRebalanceTarget`
- `hasActiveOwner`

这些纯函数主要用于测试、诊断和自定义协调策略。
