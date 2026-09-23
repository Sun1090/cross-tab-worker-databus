# Transport 后端

> 中文 | [English](../transports.md)

核心包（`cross-tab-worker-databus`）与 transport 无关。它定义了一个
`DataBusTransport` 契约；内置的 Centrifuge 后端是该契约的一个实现，作为可选的
`./centrifuge` subpath 暴露。本文档描述该契约以及如何接入第三方后端（原生
WebSocket、socket.io、SSE 等）。

## `DataBusTransport` 契约

每个后端实现 5 个方法。`subscribe` / `unsubscribe` 必须幂等——DataBus 可能重复
调用，并在重连时回放。

```ts
interface DataBusTransport<TConfig = unknown, TData = unknown> {
  /** 可选的身份/后端标签，经 diagnostics 暴露。 */
  readonly diagnosticsName?: string;
  readonly diagnosticsBackend?: string;
  start(config: TConfig, handlers: DataBusTransportHandlers<TData>): MaybePromise<void>;
  subscribe(topic: string): MaybePromise<void>;
  unsubscribe(topic: string): MaybePromise<void>;
  /** `options` 带上调用方的 `{ messageId, timestamp }`；后端若悄悄丢掉它，
   * 对端就同时失去了去重身份与 producer 时间戳。 */
  publish(topic: string, data: unknown, options?: DataBusPublishOptions): MaybePromise<void>;
  /** 可选：突发时用一帧发多条。没有它，DataBus 会退化成逐条 `publish`。
   * 每条是 `{ data, messageId?, timestamp? }`，即 `publish` 那份元数据的逐条版本。
   * 这个条目类型已作为 `DataBusPublicationItem` 导出：可以直接引用它、按内联结构写，
   * 或按你的后端放宽 `ReadonlyArray`。 */
  publishBatch?(topic: string, items: ReadonlyArray<{ data: unknown; messageId?: string; timestamp?: number }>): MaybePromise<void>;
  stop(): MaybePromise<void>;
}

interface DataBusTransportHandlers<TData = unknown> {
  onMessage: (message: DataBusMessage<TData>) => void;
  onStatus: (status: WorkerStatus) => void;   // 'connecting' | 'connected' | 'disconnected' | 'error'
  onError: (error: unknown) => void;
}
```

`start()` 接收用户提供的连接配置（无类型 `TConfig`——后端自行定义其形状）和
三个回调。连接状态变化时调 `onStatus`；收到 publication 时调 `onMessage`；
非致命错误调 `onError`。只有 `onStatus('error')` 会启动自动恢复——DataBus 用恢复冷却窗口给重开节流，并用 `recovery.maxAttempts` 限定次数，因此抖动连接不会死循环重试。`onError` 只是把失败记入 `getHealthSummary().lastFailure` 并通知订阅者，除此之外不做任何事：只用 `onError` 上报死掉的 socket 的后端，永远不会被重开。

`start()` MUST 在后端真正连接后才 settle 返回的 Promise；尝试失败时必须 reject。
DataBus 把这个 settlement 当作就绪与恢复边界：处于 `CONNECTING` 的 socket 不算
就绪，握手成功前不能释放排队操作。可能长期卡住的后端应自行设置握手超时并 reject。

## 架构分层

```
CrossTabDataBus  ──►  DataBusTransport（你的后端）
                          │
                  ┌───────┴────────┐
                  │ Worker 协议     │   （你的后端的主线程 ↔ worker 消息）
                  └───────┬────────┘
                          │
                     Session 层    （真正的客户端：WebSocket / centrifuge / …）
                          │
                        服务端
```

DataBus 层负责跨 Tab 协调（BroadcastChannel 控制面、localStorage 路由、owner 选举、
故障转移、页面生命周期）。你的 transport 只负责 I/O 路径：连接、订阅、发布、断开。

## 实现一个后端

### 1. 定义你的 Worker 协议

参照 Centrifuge 后端的 `centrifuge-protocol.ts`：一个主线程发给 Worker 的
判别联合（`INIT` / `SUBSCRIBE` / `UNSUBSCRIBE` / `PUBLISH` / `PUBLISH_BIN` /
`PING` / `STOP`，外加回应凭证请求的 `TOKEN_RESPONSE` / `TOKEN_ERROR`）和一个
Worker 回传的联合（`STATUS` / `MESSAGE` / `MESSAGE_BIN` / `ERROR`，外加凭证桥用的
`TOKEN_REQUEST`，以及 SharedWorker 端口被回收时的 `SESSION_REAPED`）。保持结构化克隆安全
（无函数、无类实例——`Error` 必须序列化）。

### 2. 实现 session

一个 session 类持有一个连接，运行在 Worker 内（或作为降级运行在主线程）。
它通过 `handle()` 方法接收协议消息，通过 sink 回传输出。参见
[`centrifuge-session.ts`](../../src/centrifuge-session.ts) 的参考形状：

- `handle(message)` 按 `message.type` 分派。
- `subscribe(topic)` 幂等——对已存在 topic 重复订阅是 no-op。
- `unsubscribe(topic)` 先移除监听器再断开，避免迟到事件复活已重订阅的 topic。
- `stop()` 断开、清理所有订阅、emit `disconnected`。

### 3. 实现 transport

transport 选择后端（SharedWorker / Dedicated Worker / 本地），向它发送协议
消息，并把 Worker 输出路由回 `DataBusTransportHandlers`。参见
[`centrifuge.ts`](../../src/centrifuge.ts) 的参考形状，包括：

- **后端选举**：复用 `worker-mode.ts` 的 `selectWorkerBackend`，使你的后端与
  SDK 其余部分降级行为一致。
- **generation 守卫**：创建后端或停止 transport 时递增单调计数器。参考实现里只有异步凭证桥会比较它，因为 provider 可能在它所应答的 Worker 已经消失之后才 settle。Worker 的 error 处理并不读这个计数器——`stop()` 与 `onWorkerFailed()` 在 generation 前移之前就移除了这些监听器，被取代的后端根本到不了这个对象。只有当你的后端会让某个监听器跨过后端替换继续存活时，才需要自己加这层检查。
- **SharedWorker 心跳**：若用 SharedWorker，定期发 PING，让 `PortReaper` 能
  回收死 tab 的 session，并处理回收器在关闭端口前发出的 `SESSION_REAPED`
  消息。对被饿死但仍存活的 tab 来说，那是唯一能收到的信号（`MessagePort` 没有
  close 事件，向已关闭的端口发送消息什么都不会送达），本 transport 会把它转成
  一次上报的 backend 失败，让恢复流程得以重建 session。

### 4. 作为 subpath 暴露

在 `package.json` 加 `exports` 条目（每个入口一个——主 bundle、dedicated worker、
shared worker）：

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

这保持核心包零依赖：不导入 `./your-backend` 的用户不会把你的客户端库打进 bundle。

### 5. 声明 peer 依赖

将你的客户端库声明为可选 peer 依赖，让消费者自行选择：

```json
{
  "peerDependencies": { "your-client-lib": "^x.y.z" },
  "peerDependenciesMeta": { "your-client-lib": { "optional": true } }
}
```

## 内置：原生 WebSocket 后端

包内自带第二个真实后端 `WebSocketTransport`，以零依赖验证了上述契约。当你的
服务器本身使用 WebSocket、且不需要 Centrifugo 特性时可以直接使用。

```ts
import { createWebSocketDataBus } from 'cross-tab-worker-databus';

const bus = createWebSocketDataBus({
  connection: { url: 'wss://example.test/ws' }
});
```

线协议（JSON 文本帧）：

- client → server：`{"op":"subscribe"|"unsubscribe"|"publish","topic":"...","data":...,"messageId"?:"...","timestamp"?:123}`
- client → server（批量）：`{"op":"publishBatch","topic":"...","items":[{data,...,"messageId"?,"timestamp"?}]}`——一帧携带多条，由服务端拆成一条条 publication 重新扇出。二进制 payload 以字节数组内嵌其中。只有一条的 batch 会改走普通 `publish` 帧，因此只实现 `publish` 的服务端仍能看到旧的单条形状；空批次在发出前就被丢弃。socket 未打开时收到的批次会通过 `handlers.onError` 上报并丢弃。
- server → client：标准 publication 为 `{"op":"publication","publication":{"topic":"...","data":...,"messageId"?:"...","timestamp"?:123}}`；旧的扁平 `{"topic":"...","data":...}` 帧仍然兼容。没有字符串 topic 的帧会被忽略；非法 JSON 通过 `handlers.onError` 上报而不会抛出。
- 自带字符串 `topic` 的 publication 会按**该值**寻址，而不是按它到达的 channel——这正是 server 通过通配 channel（`chat.*`）投递时指明具体 topic 的方式。因此顶层恰好含 `topic` 字段的负载会被重新寻址，若集群中没有任何 Tab 拥有重定向后的 topic，就会被丢弃。Centrifuge 的 channel 通常由客户端库在带外给出，这也是必须在此说明该规则的原因：只有在这条链路上，"topic 本来就写在帧里"这件事才可见。

当 `data` 是 `ArrayBuffer` 时，publish 使用二进制帧：帧头为 `0xc7`，随后是
UTF-8 topic 长度、topic 和 payload。服务器可以原样回显该帧；其他 payload 仍走
JSON 兼容路径。带 metadata 的二进制 publication 使用 JSON 兼容的字节数组
envelope，避免丢失 `messageId` 与 `timestamp`。

Centrifuge session 遵循同一个传输无关契约：不带 metadata 的 payload 保持原始
形状；带 metadata 的 publish 使用 `{ data, messageId?, timestamp? }`，入站还接受
标准嵌套 `DataBusPublicationEnvelope`。

`start()` 只在 `open` 后 resolve；握手前发生 error、close，或超过
`connectTimeoutMs` 时 reject（默认 `30000` ms；`0` / `Infinity` 表示无限等待）。
超时的 socket 会被关闭，该尝试之后迟到的 `open` 会被忽略。

生命周期映射：`open` → `connected`，`close` → `disconnected`，`error` → `error`
（触发 DataBus 自动恢复）。socket 原地重连时自动重发订阅帧。成功的重开既可以
复用同一个 socket 对象，也可以通过工厂创建替代 socket；被取代 socket 的迟到
回调会被忽略，因此失败连接的 close 或 message 不会污染恢复后的连接。干净的
`disconnected` 不会调度后台自动恢复，但下一次 `subscribe()` / `publish()` 会触发
一次按需重开并在其后 flush，因此关闭后的操作不会被写进已关闭的 socket。支持
pattern 的服务器可以以具体 topic 标注发布——见 [api.md](../api.md) 中的通配符订阅。

## 工厂入口


提供一个 `create<Backend>DataBus(options)` 工厂，把 transport 接入
`CrossTabDataBus`，与 `createCentrifugeDataBus` 对称。这是大多数消费者使用的
界面；它应接受连接配置、cluster key（默认为连接 URL），并把 trace /
worker-mode 选项转发给 DataBus。

## transport 不负责的事

- **跨 Tab 路由**：`WorkerClusterRuntime` 决定哪个 tab 拥有 topic。你的 transport
  只在被通知时订阅。
- **重连回放**：DataBus 在重连时回放当前 owner 的 topic；你的 transport 的
  `subscribe` 必须可安全重复调用。
- **publication 扇出**：owner 通过 BroadcastChannel 广播 publication；你的
  transport 只接收并上报。
- **页面生命周期**：DataBus 在 `pagehide` / `pageshow` 时挂起/恢复 transport；
  你的 transport 的 `stop()` 必须干净。
