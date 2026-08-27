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

`start()` 接收用户提供的连接配置（无类型 `TConfig`——后端自行定义其形状）和
三个回调。连接状态变化时调 `onStatus`；收到 publication 时调 `onMessage`；
非致命错误调 `onError`（DataBus 有恢复冷却窗口，避免抖动连接死循环重试）。

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
判别联合（`INIT` / `SUBSCRIBE` / `UNSUBSCRIBE` / `PUBLISH` / `STOP`）和一个
Worker 回传的联合（`STATUS` / `MESSAGE` / `ERROR`）。保持结构化克隆安全
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
- **generation 守卫**：创建后端时递增单调计数器；错误处理检查它，使被取代的
  Worker 的迟到错误不会污染新 session。
- **SharedWorker 心跳**：若用 SharedWorker，定期发 PING，让 `PortReaper` 能
  回收死 tab 的 session。

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
