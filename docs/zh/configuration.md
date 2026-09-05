> 中文 | [English](../configuration.md)

# 配置说明

## Core DataBus 配置

`CrossTabDataBus<TConfig, TData>` 接收 `CrossTabDataBusOptions<TConfig, TData>`。

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `clusterKey` | `string` | 必填 | 隔离不同连接上下文；不会以原文写入 storage |
| `transport` | `DataBusTransport<TConfig, TData>` | 必填 | 真实连接和订阅实现 |
| `initialConfig` | `TConfig` | 无 | 自动启动时传给 transport |
| `autoStart` | `boolean` | 传入 `initialConfig` 时为 `true` | 是否在创建实例后自动启动 |
| `storagePrefix` | `string` | `cross-tab-worker-databus` | storage key 和 BroadcastChannel 的命名空间 |
| `maxActiveWorkers` | `number` | `3` | 可作为 Topic owner 的最大 Worker 数 |
| `heartbeatIntervalMs` | `number` | `3000` | Worker 心跳间隔 |
| `workerTtlMs` | `number` | `10000` | Worker 失效判断时间 |
| `environment` | `ClusterEnvironment` | 浏览器原生环境 | 测试、嵌入式环境或能力替换使用 |
| `tabId` | `string` | 自动生成 | 高级调试和测试注入，不建议业务设置 |
| `workerId` | `string` | 自动生成 | 高级调试和测试注入，不建议业务设置 |
| `trace` | `DataBusTraceOptions` | 关闭 | 可选诊断事件、消息吞吐和分发延迟聚合，不影响数据传输 |

## 诊断与吞吐指标

trace 默认关闭。启用后，生命周期、连接状态、协调模式和订阅数量变化可以立即输出；高频消息只汇总计数，不逐条打印。

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

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `false` | 总开关 |
| `mode` | `'events' \| 'metrics' \| 'all'` | `'all'` | 仅低频事件、仅聚合指标或两者都输出 |
| `metricsIntervalMs` | `number` | `5000` | 聚合窗口，必须是大于 0 的有限数值 |
| `sink` | `(event) => void` | 必填 | 由接入方决定 console、监控 SDK 或其他出口 |

`message_metrics` 包含窗口时长、接收数、分发数、活跃 Topic 数量，以及接收 → 分发延迟的样本数、平均值、P50、P95 和最大值，并包含同一窗口的 `dedupAccepted` 与 `dedupSuppressed` 计数。延迟按 50ms 桶聚合，不包含单条消息 payload。持久化失败会先输出带 `operation: persistence_cleanup` 的有界 `reliability` 事件，再交给 error handler；`dedup.now` 与 `trace.now` 均可注入，以便确定性测试 TTL、事件时间戳和 metrics 窗口。订阅事件会带 Topic，便于接入方关联 owner 变化；仅 owner transport 的订阅集合实际变化时才输出，幂等 `CONTROL` 重试不会产生重复订阅事件。将 trace 写入 console 或外部监控前，应按业务 Topic 约定进行脱敏。Trace 不包含 URL、凭证、payload 或错误正文。sink 抛错会被隔离，不会中断消息分发，但会向 `console.warn` 输出错误，方便接入方发现诊断配置问题。

启用 `replay.retentionMs` 时，自动 durable cleanup 会在 publication burst 期间合并：复用进行中的清理，并在其完成后应用最新 cutoff。在不改变 retention 边界的前提下，这会限制 IndexedDB 清理事务数量。

`replay.retentionSweepMs` 可选地按周期触发同一清理逻辑。它适合安静 topic 的 durable 旧记录也需要过期的场景；需要同时配置 `retentionMs` 和实现 `clearBefore()` 的持久化适配器。定时器遵循页面可见性和生命周期切换，默认关闭。

`replay.persistenceRetry` 可选地控制瞬时持久化失败的恢复。`maxAttempts` 是总尝试次数（默认 `1`），`backoffMs` 是首次重试前的延迟（默认 `50`）；延迟会指数增长并封顶。最终失败仍沿用现有 `onError` 和 reliability 行为。

启用 trace 后，每次在最终尝试之前发生的重试都会发出有界 `reliability` 事件：`operation: persistence_retry`，并包含 `persistenceOperation`（`load`、`append`、`clear`、`clearTopic` 或 `clearBefore`）和失败的尝试次数。不包含 payload、URL、凭证或错误正文。

WebSocket 二进制帧可能以 `ArrayBuffer` 或浏览器 `Blob` 到达；两者使用相同的紧凑二进制 publication 格式。Blob 转换是异步的，转换失败会通过 transport error handler 报告。

Retry 等待遵循生命周期：`stop()` 和 pagehide 挂起会取消待执行的 retry；之后的 `start()`/pageshow 会在新的生命周期代际中开始新工作。

`dedup.sweepMs` 可选地在 bus started 且可见时执行 TTL 清理，默认关闭；无论是否开启，消息到达时清理和 `maxEntries` 上限仍然生效。

Vue 适配层会串行化 bus 替换，并在 reactive 依赖快速变化时忽略过期的 stop 完成，确保组件始终绑定最新生命周期。

React 适配层同样在 StrictMode 和依赖驱动的重建过程中使用 generation 保护，过期 effect 清理不会清除更新后的 bus。

IndexedDB replay persistence 收到 `versionchange` 时会关闭连接，并在下一次操作时惰性重新打开，从而支持多 tab schema 升级后的恢复。

`pagehide` 时聚合定时器会停止并丢弃未完成窗口，`pageshow` 后以新窗口恢复；永久 `stop()` 会清理定时器。这里节流的只是诊断输出，真实消息接收与分发不会被限速。

### 时间参数约束

- `workerTtlMs` 应至少大于两倍 `heartbeatIntervalMs`。
- TTL 过短会在后台调度抖动时产生误迁移。
- TTL 过长会延迟异常 Tab 的恢复。
- 默认 `3000/10000` 适合一般桌面浏览器实时场景。

### TTL 消息丢失窗口

当 Worker 异常退出（例如 Tab 崩溃）时：

- 其他 Worker 需要等到 `workerTtlMs`（默认 10 000 ms）之后才能检测到其死亡——过期记录会在下一次协调周期中被清理。
- 周期心跳写入 localStorage 时不会触发 BroadcastChannel 通知，因此可能需要一个完整的心跳间隔才能发现过期记录。
- **最坏情况窗口**：最多 `heartbeatIntervalMs + workerTtlMs`（默认约 13 秒）。在此窗口期间，死 Worker 拥有的 Topic 无人服务——发往这些 Topic 的 publication 将丢失。
- **缓解方案**：按比例减小 `heartbeatIntervalMs` 和 `workerTtlMs`（例如 1 s / 4 s）。这会增加存储写入频率，并提高调度抖动时误迁移的风险。

默认 3 s / 10 s 适合一般桌面浏览器实时场景。根据对丢失消息与误迁移率的容忍度进行调整。

### active Worker 数量

`maxActiveWorkers` 限制的是可成为 Topic owner 的 Worker，不限制 transport 建立的连接数。Dedicated Worker 模式下每个 Tab 仍可创建自己的 Worker；SharedWorker 模式下同源 Tab 复用同一个 Worker。

active 集合只在 Topic 需要选择新 owner 时使用。已有 owner Worker 只要仍存活，即使可见性变化后变为 standby 或不再属于当前候选集合，也会继续持有已经建立的 route。

- `1`：连接和订阅最少，但单 owner 负载集中。
- `2-3`：在资源复用和故障恢复之间取得平衡。
- 更大值：适合 Topic 很多且单连接存在服务端限制的场景。

## Centrifuge 配置

`createCentrifugeDataBus<TData>(options)` 的主要配置：

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `connection.url` | `string` | 必填 | Centrifuge 连接地址 |
| `connection.options` | `CentrifugeWorkerConfig` | `{}` | 发送到 Worker 的客户端配置 |
| `clusterKey` | `string` | `connection.url` | 手动隔离逻辑集群 |
| `workerMode` | `'dedicated' \| 'shared' \| 'auto'` | `'dedicated'` | Worker transport 运行模式；`auto` 按 SharedWorker → Dedicated Worker → 本地模式降级，显式 `dedicated` 按 Dedicated Worker → SharedWorker → 本地模式降级 |
| `transferable` | `boolean` | `false` | 开启后 `publish(topic, ArrayBuffer)` 使用 Transferable 传输，接收侧 ArrayBuffer publication 也走转移路径 |
| `heartbeatIntervalMs` | `number` | `10000` | SharedWorker PING 心跳间隔（见下方 SharedWorker 会话回收）；传 `Infinity` 完全禁用心跳。与 Core 集群心跳（默认 3000 ms，通过 localStorage 跟踪 worker 存活）相互独立 |
| `workerFactory` | `() => Worker` | 内置 Worker | 测试或自定义 Worker 加载方式 |
| `sharedWorkerFactory` | `() => SharedWorker` | 内置 SharedWorker | 测试或自定义 SharedWorker 加载方式 |
| 其他 Core 配置 | 对应类型 | Core 默认值 | `storagePrefix`、心跳、TTL 等 |

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

## Worker 模式与降级

`workerMode` 控制 Centrifuge transport 的运行方式：

- `dedicated`（默认）：每个 Tab 创建自己的 Dedicated Worker，兼容性最好。
- `shared`：同源 Tab 复用同一个 SharedWorker；Worker 内为每个连接 port 维护独立的 `CentrifugeSession`，一个 Tab 停止或刷新不会影响其他 Tab 的连接。
- `auto`：运行时选择 SharedWorker，不支持时降级到 Dedicated Worker，最后降级到主线程本地模式。

`auto` 的完整链路为 **SharedWorker → Dedicated Worker → 主线程本地模式**；显式 `shared` 的链路与 `auto` 相同（**SharedWorker → Dedicated Worker → 主线程本地模式**）；显式 `dedicated` 的链路为 **Dedicated Worker → SharedWorker → 主线程本地模式**。

`shared` 模式不会拒绝降级：如果浏览器不支持 `SharedWorker`，它会走与 `auto` 相同的降级链路。`shared` 与 `auto` 的唯一区别是首选顺序——`shared` 始终优先使用 SharedWorker，而 `auto` 执行相同的选择逻辑，但适用于调用方没有强烈偏好时的场景。

`sharedWorkerFactory` 和 `workerFactory` 都未提供时，transport 在启动时检测全局 `SharedWorker` / `Worker` 能力。提供自定义 factory 时，对应后端视为可用，避免在 Node、SSR 或嵌入环境中被全局能力检测误判。各模式都会执行相同的结构化克隆校验，配置和 `publish` 数据必须可结构化克隆。

## 协调通道降级（BroadcastChannel 不可用）

当 `BroadcastChannel` 不可用（部分 WebView、旧浏览器）时，集群通常降级为本地模式：transport 可用，但 Tab 之间不协调 owner。

`createBrowserEnvironment({ channelFallback: 'storage-event' })` 可选择启用基于 localStorage `storage` 事件的降级 `ClusterChannel`，保留跨 Tab 协调能力。该能力为 opt-in，原因是安全权衡：BroadcastChannel 消息仅存在于内存，而降级通道会把协调载荷（含明文 Topic 名称）写入 localStorage 的 `cross-tab-worker-databus:channel:` 键空间——至少短暂落盘，Tab 崩溃后可能长期留存。通道关闭时会清除该键。

## SharedWorker 会话回收

`MessagePort` 没有 `close` 事件，因此 SharedWorker 无法在 Tab 崩溃或关闭时获知（除非收到 `STOP` 消息）。为避免泄漏已死 Tab 的 `CentrifugeSession`（及其 WebSocket），transport 定期向 SharedWorker 发送 **PING 心跳**，SharedWorker 运行一个**回收器**来关闭超过静默超时的端口会话。

- **心跳间隔**：`heartbeatIntervalMs`（默认 `10000` ms）。主线程按此间隔发送 `PING`。传 `Infinity` 完全禁用心跳——仅在确保 SharedWorker 会随 Tab 一起销毁时使用。
- **会话超时**：`3 × heartbeatIntervalMs`（默认 `30000` ms）。超过超时未收到消息的端口会被回收：其会话停止，WebSocket 关闭。这与 Core 集群心跳（默认 `3000` ms，通过 localStorage 跟踪 worker 存活）相互独立——见下方说明。
- **自适应频率**：回收器以所有活动端口中最小的心跳间隔运行，使短心跳端口的会话能被及时回收。当最后一个端口断开时，回收器定时器清除，避免长时间存在的 SharedWorker 在连接爆发间隙运行永久的空循环。
- **先关闭端口再停止会话**：回收端口时，先关闭端口，再停止会话。关闭端口会丢弃会话的 `disconnected` 状态通知（使其不会到达可能仍在运行但缓慢的主线程），并保证已关闭的端口永远无法传递后续消息，从而在回收器追踪之外复活僵尸会话。
- **失败隔离**：回收与 `dispose()` 都用 try-catch 包裹 `target.close()`/`target.stop()`，单个异常端口不会中断本轮回收，也不会让后续死 Tab 无人回收。
- **关闭清理**：SharedWorker 关闭时，`PortReaper.dispose()` 停止定时器并关闭/停止**所有**仍被追踪的会话，确保没有任何 `CentrifugeSession` 或 WebSocket 比 reaper 活得更久。这补充了按端口回收——后者只覆盖 reaper 运行期间静默的端口。

这是从崩溃（未发送 `STOP`）的 Tab 中恢复会话的机制。降低 `heartbeatIntervalMs` 可更快回收死会话，代价是端口上更频繁的 PING 消息。

`heartbeatIntervalMs` 必须为正数或 `Infinity`；`0`、负数或 `NaN` 会导致 transport 构造函数立即抛出 `TypeError`（否则 `setInterval` 会降级为 0ms 忙循环）。

> **两个心跳，不要混淆。** Core 的 `heartbeatIntervalMs`（默认 `3000` ms）是集群心跳——WorkerClusterRuntime 按此间隔向 localStorage 写入存活记录。Centrifuge 的 `heartbeatIntervalMs`（默认 `10000` ms）是文档中所述的 SharedWorker PING 心跳。两者相互独立，都出现在配置项中；Centrifuge 的心跳仅在 `shared` 模式下有意义。

## 二进制消息传输

`transferable: true` 开启 ArrayBuffer 优化路径，不改变对外 API：

```ts
const bus = createCentrifugeDataBus({
  connection: { url: 'wss://example.test/connection/websocket' },
  transferable: true
});

bus.publish('resource.command', binaryBuffer);
```

开启后，`publish(topic, ArrayBuffer)` 在 Worker 传输时使用 `PUBLISH_BIN` 并把 buffer 加入 transfer list，避免 structured clone 复制；Worker 返回的 ArrayBuffer publication 以 `MESSAGE_BIN` 转移回主线程。业务层仍然只看到 `DataBusMessage<TData>`，对象、字符串和数字 payload 继续走原有对象消息路径。未开启时，ArrayBuffer 与普通对象一样按 structured clone 复制。

## Worker 结构化克隆约束

Worker 模式下配置通过 `Worker` / `SharedWorker` 的 `postMessage` 发送，本地模式也执行相同校验，必须可结构化克隆。以下配置不允许直接传入：

- `getToken`
- `getData`
- 自定义 `websocket`
- 自定义 `fetch`
- `eventsource`
- `sockjs`
- `networkEventTarget`
- `ReadableStream` 等运行时对象

传入不可克隆数据时，`CentrifugeWorkerTransport` 会抛出明确的 `TypeError`。

## storage 数据边界

storage 只保存：

- Worker ID、Tab ID、状态、可见性、负载和心跳
- Topic 的不透明 key、owner Worker 和更新时间
- Topic subscriber 的 Tab ID

storage 不保存：

- 连接地址原文
- Topic 原文
- 连接凭证
- publication 数据
- `publish` 数据

注意：BroadcastChannel 协调消息以明文传输 Topic 名称、事件类型和 publication payload（仅存在于内存中）。只有 localStorage 元数据通过 `createOpaqueKey()` 哈希处理。

## 安全与信任模型

协调平面**没有鉴权**。请仅在页面内所有同源脚本均可信时使用本库：

- BroadcastChannel 消息会投递给**每个同源 Tab**,明文传输,该源内任何脚本都能收发;`localStorage` 协调记录同样可被任意同源脚本读写。
- 恶意或异常的同源脚本可以伪造 Worker 记录、劫持 Topic owner、从 BroadcastChannel 读取 Topic 名称与 publication payload、注入发布消息或冒充订阅者。Topic 与 payload 在 BroadcastChannel 上以**明文**传输(仅存在于内存中)——不要在 Topic 名称或协调消息 payload 中放置凭证、token 或 PII(超过服务端本就要下发的范围)。
- `clusterKey` 只提供**隔离,不提供安全**:它只能防止逻辑集群之间的*意外*串扰,无法阻止能读取 `localStorage` 或监听 BroadcastChannel 的脚本——不透明 key 与频道名都由同源派生,可被重新计算,且脚本还可直接读取页面运行时状态。
- `clusterKey` 通过 `createOpaqueKey`(非密码学 128-bit 哈希)派生 storage 前缀与 BroadcastChannel 名称。实践中 `clusterKey` 总是连接 URL 或开发者控制的命名空间,两个不同 `clusterKey` 间的哈希碰撞(~2⁻⁶⁴ 生日界限)不是实际问题。
- 缓解措施:页面内不要加载不受信任的第三方脚本;在独立源上承载协调逻辑;将源的 `localStorage` 与 BroadcastChannel 命名空间视为公开区域。CSP 无法限制同源脚本对 BroadcastChannel 或 localStorage 的访问。

transport 平面(如 Centrifuge WebSocket)有自己的安全模型——token、TLS 和服务端权限——不受上述影响。集群只决定哪个 Tab 持有 transport 订阅,从不把 payload 写入 `localStorage`(payload 经 BroadcastChannel 内存传输或由服务端直发)。

## 集群隔离建议

以下上下文必须使用不同 `clusterKey`：

- 不同服务端连接
- 不同认证身份
- 不同数据权限范围
- 不同协议版本

使用 Centrifuge 工厂时，默认连接地址通常已经可以完成隔离。身份或权限会在同一地址下变化时，应显式提供包含上下文版本但不包含凭证原文的 `clusterKey`。
