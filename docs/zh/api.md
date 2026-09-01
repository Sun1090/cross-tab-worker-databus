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
- 通配符订阅：以 `.*` 结尾的 Topic（如 `chat.*`）匹配任意后缀，`*` 匹配全部。pattern 以字面量参与路由、归属与传输订阅；携带匹配的具体 topic（或 pattern 本身）的发布都会投递给通配 handler。匹配规则见下方 `topicMatchesPattern`。
- 重放（可选）：构造 bus 时传 `replay: { maxPerTopic }` 开启缓冲，`maxPerTopic` 必须是正安全整数；`subscribe()` 第三个参数传 `{ replay: true | n }` 后，新 handler 会立即收到缓冲历史（最多 `n` 条，受 `maxPerTopic` 上限约束，默认 100），消息带 `message.replayed: true` 标记——晚加入的 handler 不会错过更早的发布。只有被分发过的消息才入缓冲（无本地订阅者的 topic 会被 owner 丢弃）；缓冲仅存内存，该 topic 最后一个 handler 退订时清空。通配订阅会对所有匹配 pattern 的已缓冲 topic 做回放。需要跨 reload/BFCache 持久化时，可传入 `createIndexedDbReplayPersistence({ maxPerTopic })` 创建的 `persistence`；持久化为异步操作，失败会通过 `onError` 报告，不影响实时投递。设置 `retentionMs` 后，如果 adapter 支持 `clearBefore`，会在 hydrate 和追加后自动清理过期历史。设置 `persistenceRetry: { maxAttempts, backoffMs }` 可重试瞬时持久化失败；默认仍保持单次尝试。
  启用 trace 后，重试会发出 `reliability` 事件，包含 `operation: 'persistence_retry'`、有界的 `persistenceOperation` 和 `attempt`。

WebSocket transport 支持以 `ArrayBuffer` 或浏览器 `Blob` 帧接收二进制 publication。
- 持久化 replay store 还可实现 `clearTopic(topic)`；bus 会在最后一个 handler 退订时调用。应用可自行保留 `clear()` 做全量留存清理；`stop()` 会保留 durable history，以支持 reload/BFCache 恢复。

### `unsubscribe(topic, handler?)`

```ts
unsubscribe(topic: string, handler?: DataBusMessageHandler<TData>): void
```

传入 handler 时只释放对应回调；省略 handler 时释放当前实例中该 Topic 的全部 handler。

优先使用 `subscribe` 返回的释放函数，避免误删其他模块的回调。

### `publish(topic, data, options?)`

```ts
publish(
  topic: string,
  data: unknown,
  options?: { messageId?: string; timestamp?: number }
): void
```

将发布操作路由到当前 Topic owner；没有有效路由时使用当前 Worker。

发布数据必须满足底层 transport 的序列化约束。SDK 不会在页面暂停期间持久化或延迟重放发布命令。

当 owner 是远端 Tab、且发布控制消息无法投递时（例如 BroadcastChannel 无法克隆 payload），`publish()` 会通过 `onError` 上报失败，而不是静默丢弃。

传入 `options.messageId` 和 `options.timestamp` 后，元数据会穿过跨 Tab 路由、Worker 边界和支持的 transport。服务端必须回显或以其他方式保留它们，入站去重和 replay retention 才能使用。

`DataBusMessage` 与 `DataBusPublication` 暴露相同的可选元数据。
`DataBusPublicationEnvelope<TData>` 是标准 JSON envelope 类型：

```ts
{
  op: 'publication',
  publication: { topic, data, messageId?, timestamp? }
}
```

### `clearReplay()`

```ts
clearReplay(): Promise<void>
```

清空内存 replay 缓冲，并调用持久化适配器可选的 `clear()`。适合留存策略、退出登录或租户切换；普通 `stop()` 仍会保留 durable history。

`clearReplayTopic(topic)` 只清理一个精确 topic。`getDedupStats()` 返回 `enabled`、`tracked`、`accepted`、`suppressed` 四项有界统计；`resetDedup()` 清除已记忆 ID 和计数，不改变 dedup 配置。为测试或非墙上时钟宿主，可额外提供 `dedup.now`。完整 `stop()` 会清空已记忆的 ID 窗口，之后 `start()` 会开启新的 dedup 会话。

`clearReplayBefore(timestamp)` 按毫秒时间戳清理带显式 producer timestamp 且早于 cutoff 的记录；实现可选 `clearBefore()` 的持久化适配器会同步执行该清理。没有 producer timestamp 的 legacy 消息会为兼容性保留。transport 未提供时间戳时，系统仍会补充 bus timestamp，但该时间戳不会被当作 producer metadata 用于 retention 清理。

启用自动 retention 时，如果持久化清理正在进行，后续清理请求会合并，完成后再应用最新 cutoff。

设置 `replay.retentionSweepMs` 后，即使没有新 publication 也会周期性应用 retention cutoff。sweep 只在 bus started 且页面可见时运行；pagehide 时暂停，`stop()` 后永久停止。

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

低频事件类型包括 `lifecycle`、`status`、`subscription`、`coordination` 和 `error`；高频数据按窗口输出 `message_metrics`，包含接收/分发计数、活跃 Topic 数量和分发延迟聚合（`dispatchSamples`、`dispatchAvgMs`、`dispatchP50Ms`、`dispatchP95Ms`、`dispatchMaxMs`），以及去重结果（`dedupAccepted`、`dedupSuppressed`）。所有公开事件都使用固定结构，不包含原始 Topic、消息 payload、连接地址或错误正文。sink 抛错会被隔离，不会中断消息分发，但会向 `console.warn` 输出错误，便于定位诊断配置问题。sink 应尽量避免抛出异常——预期中的错误条件应通过事件数据表达，而不是通过异常上报。

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

## WebSocket 传输后端

基于原生 WebSocket 的零依赖传输。任何实现下列 JSON 帧协议的服务器都能驱动与 Centrifuge 后端相同的跨 Tab 集群栈（owner 去重、粘性路由、故障转移）。

### `createWebSocketDataBus<TData>(options)`

```ts
createWebSocketDataBus<TData>(options): CrossTabDataBus<WebSocketDataBusConfig, TData>
```

创建自动启动的 WebSocket DataBus。默认值：`clusterKey = connection.url`。

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

实现 `DataBusTransport`。连接生命周期直接映射 DataBus 状态：socket `open` → `connected`，`close` → `disconnected`，`error` → `error`（触发 DataBus 自动恢复）。socket 原地重连时会自动重发订阅；socket 未打开期间被丢弃的帧通过 `handlers.onError` 上报，重开后自动补发订阅帧。

`WebSocketDataBusConfig` 字段：

- `url` — WebSocket 端点。
- `protocols` — 可选的握手子协议。
- `webSocketFactory` — 可选工厂 `(url, protocols) => WebSocketLike`，用于测试与非浏览器运行时（默认使用全局 `WebSocket`）。

### 线协议

JSON 文本帧：

- client → server：`{"op":"subscribe"|"unsubscribe"|"publish","topic":"...","data":...,"messageId"?:...,"timestamp"?:...}`
- server → client（标准）：`{"op":"publication","publication":{"topic":"...","data":...,"messageId"?:...,"timestamp"?:...}}`
- server → client（旧格式，继续兼容）：`{"topic":"...","data":...}`

没有字符串 publication `topic` 的帧会被忽略；非法 JSON 通过 `handlers.onError` 上报而不会抛出。

支持 pattern 的服务器建议以具体 topic 标注发布；以 pattern 本身标注的发布走精确匹配路径投递。

## React Hooks（`cross-tab-worker-databus/hooks`）

React（>= 18）是可选 peer 依赖；独立入口保证非 React 消费者不会加载它。

### `useCrossTabDataBus(create, deps?)`

创建随组件生命周期存活的 bus：挂载时创建，卸载时停止。StrictMode 安全——effect 双调用走的是与 BFCache 挂起/恢复相同的停止/重建路径。返回当前 bus；首次 effect 之前（SSR / 初始渲染）为 `null`。

每次 effect 返回一个全新 bus（内联工厂即可）；需要重建时通过 `deps` 控制。

### `useCrossTabSubscription(bus, topic, handler)`

登记消息 handler 并自动清理。handler 经由 ref 在每次投递时读取，因此内联闭包不会导致重渲染时的重订阅。`bus` 为 `null` 或 transport 未 ready 时自动排队。

### `useCrossTabStatus(bus)`

把 `bus.onStatus()` 镜像为 React 状态，bus 身份变化时同步读取当前值。返回 `'connecting' | 'connected' | 'disconnected' | 'error'`。

## Vue Composables（`cross-tab-worker-databus/vue`）

Vue 3.3+ 是可选 peer 依赖；独立入口不会影响核心包。

```ts
const bus = useVueCrossTabDataBus(() => createWebSocketDataBus({ connection: { url } }));
const status = useVueCrossTabStatus(bus);
useVueCrossTabSubscription(bus, 'chat.*', message => console.log(message.data));
```

`useCrossTabDataBus` 返回 Vue `Ref`，在组件挂载时创建 bus、卸载时停止。`useCrossTabSubscription` 接受字符串或 `Ref<string>` topic，在 bus/topic 变化时自动重绑。`useCrossTabStatus` 返回与 `bus.onStatus()` 同步的 `Ref<WorkerStatus>`。

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
- `isWildcardTopic(pattern)`
- `topicMatchesPattern(pattern, topic)` — 订阅使用的通配匹配：`chat.*` 匹配 `chat.room.1`（按段前缀），`*` 匹配全部

这些纯函数主要用于测试、诊断和自定义协调策略。
