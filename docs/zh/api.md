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

启动集群协调和 transport。首次调用真正启动 transport；打开过程尚未结束时，并发调用共享同一个启动 Promise，不重复创建 transport。对健康且已启动的实例调用是立即 resolve 的空操作。若 transport 已断开，`start()` 作为显式手动恢复：保留 cluster、订阅和 replay 缓冲区，重置失败/恢复账本并重新打开 transport。若显式 `stop()` 尚未完成，`start()` 会在清理之后排队一次全新启动，并返回随重启完成而 settle 的 Promise。该排队重启归属于最近一次生命周期意图：若它在真正执行前又收到 `stop()`，则会被取消（排队 start 的 Promise resolve，但不会打开 transport）；取消之后再调用 `start()` 会以更高令牌重新排队。`stop()` 完成后也可正常再次调用 `start()` 重启。open 失败时，清理和生命周期 gate 会先 settle，再调用启动失败的 `onError` handler；因此在该回调中同步调用 `start()` 重试会在失败 transport 清理完成后开启一次全新尝试，而不是返回同一个已拒绝的 Promise。transport 在 `start()` 仍在飞行时同步上报 `error` 时，两类通知遵循同一契约：内部状态会立即更新，但用户可见的 `onStatus('error')` 会延迟到 `openTransport()` 完成清理、安装失败 transport 的 stop gate、记录失败并清除 `startPromise` 之后。此时从该状态回调或随后启动失败的 `onError` 回调中同步调用 `start()`，都会在清理完成后排队一次全新生命周期；若重试成功，它会开启新的失败账本，原 opening 的 rejection 不会再次写回。

### `ready()`

```ts
ready(): Promise<void>
```

等待当前 transport 的 `start` 完成。自动启动失败时 Promise 会 reject；再次调用可以触发基于 `initialConfig` 的重试。

显式 `stop()` 尚未 settle 时，`ready()` 会 reject，除非此前已有 `start()` 在该 stop 之后排队重启；它绝不会针对正在拆除的 transport 报告 ready。调用方应等待 `stop()` settle，再调用 `start()` 后重新 await `ready()`。

若后续 `stop()` 取消了该排队重启，排队 `start()` Promise 仍按既定语义 resolve 且不会打开 transport，但 `ready()` 会以生命周期错误 reject，而不会把已停止的 bus 报告为 ready。

Tab 处于 BFCache 挂起态时（`pagehide` 之后、`pageshow` 之前），`ready()` 会以挂起态错误 reject。挂起路径会把 `startPromise` 复用为异步 `transport.stop()` 的 gate，若直接返回它，就会针对一个被有意停止的 transport 报告 ready。`pageshow` 或显式 `start()` 会清除挂起标记并安装真正的重开 Promise，此后 `ready()` 会在 transport 就绪后正常 resolve。两条恢复路径都会同时重启协调面：`pagehide` 会独立于 transport 暂停 cluster（关闭 channel、停止 heartbeat 并释放 route 分配），因此显式 `start()` 也会一并恢复 cluster——否则 bus 会报告 transport 健康，而跨 Tab 投递仍被丢弃。

若该排队重启在 transport 启动阶段失败，即使未传入 `initialConfig`，`ready()` 也会以底层启动错误 reject。该失败会保留给显式恢复，而不会被通用的「缺少配置」错误掩盖。

未传入 `initialConfig` 且未显式调用 `start(config)` 时，`ready()` 返回 rejected Promise 而不是同步抛出，调用方可以统一通过 `.catch` 处理并决定是否显式启动。

`ready()` 会在当前 transport 满足其 `start()` 契约时 resolve；它不保证远端服务端已能处理应用流量。内置 WebSocket 后端的 `start()` 会等待 socket 握手：握手前发生 `error`、`close`，或超过 `connectTimeoutMs` 时都会 reject，因此 `ready()` 不会在 socket 仍处于 `CONNECTING` 时报告就绪。协议连接状态仍通过 `onStatus` 获取。

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
- 一条发布只会投递给它的分发开始时已登记的 handler：在 handler 里调用 `subscribe()` 收不到正在分发的这条消息，在 handler 里调用 `unsubscribe()` 仍然会收到——具体 topic 的列表与匹配上的 pattern 都会在第一个 handler 运行之前收集完毕，因此 handler 无法改变一条已在途消息的分发集合。
- transport 尚未 ready 时订阅自动排队；transport 恢复待定时同样如此：订阅会挂在恢复门之后，等重开成功才下发，而不会写入刚刚上报 `error` 的连接。下发的是那一刻**仍然被需要**的订阅：排队期间已被释放的 subscribe 不会发出，排队期间又被重新订阅的释放同样不会发出。
- 显式 `stop()` 尚未 settle 时发起的订阅不会登记：`subscribe()` 通过 `onError` 上报并返回 no-op 释放函数。调用方应等待 `stop()` settle，再调用 `start()` 后重新订阅。
- 通配符订阅：以 `.*` 结尾的 Topic（如 `chat.*`）匹配任意后缀，`*` 匹配全部。pattern 以字面量参与路由、归属与传输订阅；携带匹配的具体 topic（或 pattern 本身）的发布都会投递给通配 handler。匹配规则见下方 `topicMatchesPattern`。
- Topic 必须非空：`subscribe()`、`publish()`、`publishBatch()` 传入 `''` 时会抛出 `TypeError`，且在任何其他副作用之前（不会请求 start，也不会登记 handler）。没有任何 transport 能寻址空 channel，因此对它的订阅永远收不到消息，向它的发布也会被无声丢弃。`''` 自 0.20.96 起每个实例告警一次，自 0.21.0 起直接拒绝——遵循 1.0 前的弃用策略；该守卫与选项校验断言放在一起，空 topic 与非法 `replay.maxPerTopic` 以同样方式失败。`publishBatch('', [])` 同样抛错：非法参数先于空数组 no-op 检查。
- 重放（可选）：构造 bus 时传 `replay: { maxPerTopic }` 开启缓冲，`maxPerTopic` 必须是正安全整数；`subscribe()` 第三个参数传 `{ replay: true | n }` 后，新 handler 会立即收到缓冲历史（最多 `n` 条，受 `maxPerTopic` 上限约束，默认 100），消息带 `message.replayed: true` 标记——晚加入的 handler 不会错过更早的发布。只有被分发过的消息才入缓冲（无本地订阅者的 topic 会被 owner 丢弃）；缓冲仅存内存，该 topic 最后一个 handler 退订时清空。通配订阅会对所有匹配 pattern 的已缓冲 topic 做回放——但 pattern 本身不是一个 topic：它填上的缓冲环仍按具体发布 topic 归档，所以退订 `chat.*` 不会清空其中任何一条（durable 清理会以 `chat.*` 这个键调用，而存储里并没有对应行），重新订阅该 pattern 时仍会回放尚存的缓冲。`maxPerTopic` 限制每条环的深度，不限制宽 pattern 产生的环数量，因此 `*` 或 `prefix.*` 面对无界 topic 空间会让缓冲 map 持续增长，直到你主动约束——用 `clearReplay()` / `clearReplayTopic(topic)` 清理，或用 `retentionMs` 按时间收敛。需要跨 reload/BFCache 持久化时，可传入 `createIndexedDbReplayPersistence({ maxPerTopic })` 创建的 `persistence`；持久化为异步操作，失败会通过 `onError` 报告，不影响实时投递。设置 `retentionMs` 后会清理内存中过期的 producer-timestamped 历史，并通过实现 `clearBefore` 的 adapter 在 hydrate 和追加后清理 durable 历史。设置 `persistenceRetry: { maxAttempts, backoffMs }` 可重试瞬时持久化失败；默认仍保持单次尝试。设置 `pruneStrategy` 为 `'count'`（默认）、`'age'` 或 `'both'`，分别表示按 `maxPerTopic` 截断、按 `retentionMs` 清理带时间戳历史，或两者都应用。`age` 下无时间戳的 legacy 条目会保留，但受 `maxPerTopic` 限制；带时间戳条目由 retention 窗口约束。
  启用 trace 后，重试会发出 `reliability` 事件，包含 `operation: 'persistence_retry'`、有界的 `persistenceOperation` 和 `attempt`。

WebSocket transport 支持以 `ArrayBuffer` 或浏览器 `Blob` 帧接收二进制 publication。
- 持久化 replay store 还可实现 `clearTopic(topic)`；bus 会在该 topic 最后一个 handler 退订时调用——对通配订阅传入的是 pattern 字符串，而它填上的具体 topic 另有归档键，因此不会被清掉（见上文说明）。应用可自行保留 `clear()` 做全量留存清理；`stop()` 会保留 durable history，以支持 reload/BFCache 恢复。

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

在 `stop()` 尚未 settle 时调用 `publish()` 会通过 `onError` 上报且不路由任何消息；消息不会延迟到之后的 start。更早发出、仍排队等待 transport open 的发布会被 stop 取消。

运行期 transport 上报 `error` 后发起的发布同样会挂在恢复门之后，等 transport 重新 ready 再发送，因此不会被写进刚刚失败的连接。若恢复预算耗尽，或等待被 `stop()` / 页面隐藏取代，该发布会按文档丢弃而不是无限期延迟（页面挂起仍保持「不延迟、直接丢弃」语义）。干净的 `disconnected` 不会触发后台 DataBus 自动重开，但也不会再吞掉后续操作：干净关闭后发起的 `subscribe()` / `publish()` 会触发一次按需重开，先挂起等待替代连接就绪，随后再 flush。可显式调用 `start()`（或直接发起操作）来重开。

入站消息可携带调用方/服务端提供的 `messageId`。可通过 `dedup: { maxEntries, ttlMs }` 启用有界重复抑制；每个 bus 实例只会忽略其窗口内的重复 ID。该能力默认关闭且属于尽力而为：它不提供端到端的 at-least-once 或 exactly-once 服务端保证。每条被接受的 transport publication 只会扇出一次，每个匹配的本地 handler 至多分发一次；但 transport/服务端仍可能重复投递或丢失，断连或挂起中的 Tab 也可能错过跨 Tab 事件。测试和自定义时钟宿主可传入 `dedup.now`；读数不是有限数值时会保持在最近一次有限读数上而不是被传播下去，因此对于时钟可能*缺失*（而不只是数值异常）的主机，退化结果是时间静止——过期暂停、自适应窗口保留上次的值——而不是在 `getDedupStats()` 里报出 `NaN`（序列化后是 `null`）且什么都不过期。完整 `stop()` 会清空已记住的 ID 窗口；之后的 `start()` 会开启全新的 dedup 会话。

传入 `options.messageId` 和 `options.timestamp` 后，元数据会穿过跨 Tab 路由、Worker 边界和支持的 transport。服务端必须回显或以其他方式保留它们，入站去重和 replay retention 才能使用。

`DataBusMessage` 与 `DataBusPublication` 暴露相同的可选元数据。
`DataBusPublicationEnvelope<TData>` 是标准 JSON envelope 类型：

```ts
{
  op: 'publication',
  publication: { topic, data, messageId?, timestamp? }
}
```

### `publishBatch(topic, items)`

```ts
publishBatch(
  topic: string,
  items: Array<{ data: unknown; messageId?: string; timestamp?: number }>
): void
```

把多条 item 作为一个工作单元发布到同一个 topic。内置 WebSocket transport 会把整个 batch 打包成**一帧**（`publishBatch` op），而不是逐条一帧；未实现可选钩子 `DataBusTransport.publishBatch` 的 transport 会自动回退逐条 `publish()`，因此两种情况下调用都安全。

每条 item 的 `messageId` 与 `timestamp` 在传输后保留，dedup、replay 与顺序都按 item 维度、以源顺序生效。空 batch 为 no-op；单 item batch 直接委托给 `publish()`。直接操作协调层的调用方可用 `WorkerClusterRuntime` 上的同名方法。

在 `stop()` 尚未 settle 时提交非空 batch 会通过 `onError` 上报且不发送任何内容；空 batch 仍为 no-op。

### `clearReplay()`

```ts
clearReplay(): Promise<void>
```

清空内存 replay 缓冲，并调用持久化适配器可选的 `clear()`。适合留存策略、退出登录或租户切换；普通 `stop()` 仍会保留 durable history。

`clearReplayTopic(topic)` 只清理一个精确 topic。`getDedupStats()` 返回 `enabled`、`tracked`、`accepted`、`suppressed` 四项有界统计，配置了 `dedup.adaptiveTtl` 时还会多一个当前 `ttlMs`；`resetDedup()` 清除已记忆 ID 和计数，不改变 dedup 配置。为测试或非墙上时钟宿主，可额外提供 `dedup.now`；读数不是有限数值时保持在最近一次有限读数上，因此时钟可能缺失的主机退化为时间静止，而不是让统计里出现 `NaN`。完整 `stop()` 会清空已记忆的 ID 窗口，之后 `start()` 会开启新的 dedup 会话。

`clearReplayBefore(timestamp)` 按毫秒时间戳清理带显式 producer timestamp 且早于 cutoff 的记录；实现可选 `clearBefore()` 的持久化适配器由它 `await`，这一路还经过带退避的重试，因此清理不会在同一个任务内同步完成。没有 producer timestamp 的 legacy 消息会为兼容性保留。transport 未提供时间戳时，系统仍会补充 bus timestamp，但该时间戳不会被当作 producer metadata 用于 retention 清理。

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

### `getHealthSummary()`

```ts
getHealthSummary(): DataBusHealthSummary
```

面向仪表盘、就绪探针与支持包的紧凑健康判定。先回答「总线当前是否可用」，再附带解释该结论的失败与恢复上下文：

```ts
interface DataBusHealthSummary {
  healthy: boolean;   // 已启动、未在停止中、未挂起、transport 实时状态为 connected
  state: 'stopped' | 'starting' | 'healthy' | 'recovering' | 'suspended' | 'degraded';
  status: WorkerStatus;
  sdkVersion: string;
  started: boolean;
  suspended: boolean;                       // Tab 隐藏（BFCache）期间为 true
  transport: { name; backend; ready; status };
  recovery: { attempt; exhausted; maxAttempts; generation; lastSuccessAt; hasError; errorMessage; errorAt };
  lastFailure: { source: 'transport' | 'persistence' | 'dispatch'; message: string; at: number } | null;
  persistence: { failures: number; lastFailureAt: number | null; lastErrorMessage: string | null };
  metrics: DataBusMetricsSnapshot | null;   // 实时 trace 窗口；trace 指标未启用时为 null
  trace: { asyncSink: boolean; pendingEvents: number };  // sink 背压可见性
}
```

`state` 语义：`stopped`（未启动，或显式 `stop()` 仍在 teardown）、`starting`（首次连接进行中）、`recovering`（transport 自动恢复进行中）、`suspended`（Tab 隐藏，pageshow 后自动恢复）、`degraded`（自动恢复已耗尽，需要手动 `start()` 或重新 subscribe 触发恢复）、`healthy`。处于 degraded 时再次调用 `start()` 会保留 cluster、订阅和 replay 缓冲区，重置失败/恢复账本后重新打开 transport；subscribe 与 publish 也走同一恢复路径。`lastFailure` 是覆盖全部失败来源的统一账本，每次显式 `start()` 后重置。`healthy` 依据 transport 的实时状态判定，但当显式 `stop()` 仍在进行时一律报告 `stopped`：teardown 期间其余生命周期 API（`publish()`、`subscribe()`、`ready()`）已经拒绝操作，健康判定不能与之矛盾。`transport.ready` 是诊断字段，在 transport 已报告 `connected`、但其 `start()` Promise 尚未 settle 的短暂窗口内可能仍为 `false`，此时操作会排队等待该在途 start，而不会丢失。

### `getMetrics()`

```ts
getMetrics(): DataBusMetricsSnapshot | null
```

对当前 trace 指标窗口的**同步、非破坏性**快照——与周期性 `message_metrics` 事件相同的派生计数（received、dispatched、topics，分发延迟 avg/p50/p95/max，dedup accepted/suppressed），无需 sink 或间隔 flush 即可按需读取。trace 指标未启用（禁用或 events-only 模式）时返回 `null`。

`getDiagnostics().replay` 输出 `{ enabled, topics, messages, bytes }` —— `bytes` 是缓冲 replay 环的近似内存 payload 占用（与自适应负载加权相同的 string/binary/number 尺寸启发式），按需计算，热路径 append 不为此付任何成本。

### `getRecoveryStats()` / `getPersistenceStats()`

```ts
getRecoveryStats(): { attempt; exhausted; maxAttempts; hasError; errorMessage; errorAt; generation; lastSuccessAt }
getPersistenceStats(): { failures; lastFailureAt; lastErrorMessage }
```

`recovery.generation` 在每次 transport 成功打开时递增（首次启动与每次恢复）；`lastSuccessAt` 是该次成功的时间戳（首次成功前为 `null`）。`recovery.hasError` / `errorMessage` / `errorAt` 描述最近一次被保留的 **transport** 失败——无论是 transport 打开失败还是运行期 `onError`——并与统一的 `lastFailure` 账本具有相同的生命周期：恢复成功后最后一次失败仍然可见，只有显式 `start()` 会清除它。非 transport 失败（`persistence`、`dispatch`）不会改动 recovery 账本，仍可通过 `lastFailure`（以及 replay 后端的 `getPersistenceStats()`）观察。同一次 transport 失败只取一次时间戳，因此 `recovery.errorAt` 与该次失败对应的 `lastFailure.at` 相等。持久化计数仅覆盖可选的 replay 持久化后端。

### `getDiagnostics()`

```ts
getDiagnostics(): DataBusDiagnostics
```

完整诊断快照，合并生命周期、transport 身份（`name`、`backend`、实时 `status`、`suspended`）、恢复、dedup、replay、持久化、协议（`version`、`unknownMessages`、`peers`）与集群快照，外加两个仅用于诊断的字段：

- `metrics: DataBusMetricsSnapshot | null` — 当前 trace 指标窗口（吞吐、分发延迟百分位、dedup 结果）；trace 指标未启用（禁用或 events-only 模式）时为 `null`。
- `trace: { asyncSink: boolean; pendingEvents: number }` — sink 投递模式与排队事件深度；`asyncSink: true` 下 `pendingEvents` 持续增长是 sink 背压的第一个信号。

`sdkVersion` 构建时从 `package.json` 注入。只需要就绪结论的调用方应优先使用 `getHealthSummary()`。

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

低频事件类型包括 `lifecycle`、`status`、`subscription`、`coordination`、`reliability` 和 `error`；高频数据按窗口输出 `message_metrics`，包含接收/分发计数、活跃 Topic 数量和分发延迟聚合（`dispatchSamples`、`dispatchAvgMs`、`dispatchP50Ms`、`dispatchP95Ms`、`dispatchMaxMs`），以及去重结果（`dedupAccepted`、`dedupSuppressed`）。路由归属变化通过 `reliability` 事件呈现：优雅交接上报 `operation: 'route_migration'`，而恢复悬挂未确认交接的重选上报 `operation: 'route_migration_recovery'`（前任 owner 已消失且 ACK 始终未到达），便于 trace 消费者区分恢复与常规交接。`coordination` 事件在每次成功 `start()` 后发出一次（自动或按需的 reopen 不会再发出该快照），携带 `coordinated`、`activeWorkers`、`workers`（格式化后的 worker 记录）与 `routes`（`topicKey@workerId|confirmed=…`，反映已收敛的路由列表）。所有公开事件都使用固定结构，其中不会携带消息 payload、连接地址或错误正文。Topic 明文只出现在两种事件里：`subscription` 记录订阅变更，`reliability` 则为涉及具体路由的操作标注该路由（`route_ack`、`route_migration`、`route_migration_recovery`，其余 reliability 操作不带 Topic）；其它事件不含 Topic，`coordination` 使用不可逆的 `topicKey` 而非名称来标识路由。既然这两种事件确实携带 Topic 名称，就应把 trace sink 视为诊断出口：在把事件转发给外部监控前，按业务 Topic 约定脱敏，详见 `configuration.md`。sink 抛错会被隔离，不会中断消息分发，但会向 `console.warn` 输出错误，便于定位诊断配置问题。sink 应尽量避免抛出异常——预期中的错误条件应通过事件数据表达，而不是通过异常上报。

**`asyncSink: true` 的投递语义。** 默认（`false`）下，每条事件同步调用 sink。开启 `asyncSink: true` 后，事件先入内存队列，在**一个微任务批次**中统一投递：任务的第一条事件调度 `queueMicrotask`，在该微任务运行前产生的所有事件（含周期性 `message_metrics` 快照）按 FIFO 顺序一次性送往 sink。这样热路径永远不会因 sink 工作而阻塞。错误隔离与同步模式一致——sink 抛错被捕获并记入 `console.warn`，既不会中断分发，也不会中断批次内其余事件。顺序保证边界：**批次内**顺序是确定的，但投递被推迟到下一个微任务，因此事件不再保证在你的下一行语句执行前可见；批次 flush 之后新产生的事件会落入后续批次。当需要"每条事件在下一行代码前可见"时，请使用默认的同步 sink（或自行合并计数）。

### `stop()`

```ts
stop(): Promise<void>
```

永久销毁当前实例：清理 handler、集群注册、路由、Worker 和 transport。若 transport open/reopen 仍在收敛，`stop()` 会等待它结束并使该结果失效，确保它不会在 stop 后变为 ready。普通页面隐藏和恢复不需要调用。teardown 对故障容错：即使 transport 自身的 `stop()` reject（或同步抛错），`stop()` 仍会在实例销毁完成后 resolve，并通过 `onError` 与统一的 `lastFailure` 记录上报该失败，而不是让 `stop()` 变成 rejected；因此 React / Vue adapter 中 fire-and-forget 的卸载路径不会产生 unhandled rejection。实例之后仍可重新 start。

## `DataBusTransport<TConfig, TData>`

```ts
interface DataBusTransport<TConfig, TData> {
  start(config, handlers): void | Promise<void>;
  subscribe(topic): void | Promise<void>;
  unsubscribe(topic): void | Promise<void>;
  publish(topic, data): void | Promise<void>;
  /** 可选：将多条消息合并为一帧发送。未提供时 DataBus 回退为逐条 `publish`。
   * 每条是 `DataBusPublicationItem` —— `{ data, messageId?, timestamp? }`，已导出。 */
  publishBatch?(topic, items): void | Promise<void>;
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

SharedWorker 模式使用包内 `centrifuge.shared.worker.js`，其 Worker 名称为 `cross-tab-worker-databus-shared`。`workerMode: 'auto'` 时按 SharedWorker → Dedicated Worker → 本地模式降级。完整配置见 [configuration.md](./configuration.md)。

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
- `heartbeatIntervalMs`：`number`，默认 `10000`；SharedWorker PING 心跳间隔（毫秒）。传 `Infinity` 完全禁用心跳，该端口也因此豁免于回收。详见 [配置](./configuration.md#sharedworker-会话回收)
- `workerFactory`：自定义 Dedicated Worker 加载方式
- `sharedWorkerFactory`：自定义 SharedWorker 加载方式

## `createStorageEventChannel(options)`

```ts
createStorageEventChannel(options: {
  name: string;
  storage: StorageLike | null;
  win: StorageEventWindow | null;
}): ClusterChannel | null
```

创建以 localStorage `storage` 事件为载体的 `ClusterChannel`——面向无 BroadcastChannel 环境的协调降级通道。storage 或 storage-event 来源缺失时返回 `null`。在跨 Tab 协调需要的维度上，投递语义跟随 BroadcastChannel（不回显给发送方、消息可 JSON 序列化、关闭后拒绝再写入），但有一处刻意差异：`postMessage` 同样不会派发给通道自己的监听器，所以**同一文档**内创建的两个通道互相看不到，而真正的 BroadcastChannel 是可以的。这个降级通道只关心跨 Tab 投递，该差异由 `tests/storage-channel.test.ts` 的 sibling-channel 用固定住；载荷信封里同时带一个**每通道 sender nonce** 和一个单调序列号，正是这两者共同保证连续相同的消息仍可投递——包括两个 Tab 各自的第一帧都会写入相同的 `seq=1`、否则会被静默抑制的情况。通过 `createBrowserEnvironment({ channelFallback: 'storage-event' })` 启用；安全权衡见 [configuration.md](./configuration.md#协调通道降级broadcastchannel-不可用)。

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

实现 `DataBusTransport`。`start()` 只在 socket 握手完成后 settle：`open` 时 resolve；握手前发生 `error`、`close`，或超过 `connectTimeoutMs` 时 reject。连接生命周期直接映射 DataBus 状态：socket `open` → `connected`，`close` → `disconnected`，`error` → `error`（触发 DataBus 自动恢复）。socket 原地重连时会自动重发订阅；当 bus 在 socket 失败后重新打开时（`error` 触发自动恢复，或 `close` 后显式 `start()` / 页面恢复 / 后续操作），`start()` 会创建替代 socket，并忽略被取代 socket 的迟到生命周期与消息回调（包括超时尝试之后迟到的 `open`）；socket 未打开期间被丢弃的帧通过 `handlers.onError` 上报，替代 socket 打开后自动补发订阅帧。

`WebSocketDataBusConfig` 字段：

- `url` — WebSocket 端点。
- `protocols` — 可选的握手子协议。
- `webSocketFactory` — 可选工厂 `(url, protocols) => WebSocketLike`，用于测试与非浏览器运行时（默认使用全局 `WebSocket`）。
- `connectTimeoutMs` — 可选握手预算（毫秒），默认 `30000`；传 `0` 或 `Infinity` 表示无限等待。超时会通过 `error` 上报并 reject `start()`（也就是 `ready()`），随后关闭半开 socket。

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

创建随组件生命周期存活的 bus：挂载时创建，卸载时停止。StrictMode 安全——effect 双调用会跨**不同实例**走完 create → `stop()` → create，因此它覆盖的是停止路径，而不是 BFCache 路径：页面隐藏走的是 `onSuspend()`，它保留同一个 bus、它的 `topicHandlers` 与 replay 缓冲，恢复时再反转；挂起/恢复的覆盖只能来自真实的 hide/show。返回当前 bus；首次 effect 之前（SSR / 初始渲染）为 `null`。

每次 effect 返回一个全新 bus（内联工厂即可）；需要重建时通过 `deps` 控制。

### `useCrossTabSubscription(bus, topic, handler)`

登记消息 handler 并自动清理。handler 经由 ref 在每次投递时读取，因此内联闭包不会导致重渲染时的重订阅。`bus` 为 `null` 或 transport 未 ready 时自动排队。

### `useCrossTabStatus(bus)`

把 `bus.onStatus()` 镜像为 React 状态，bus 身份变化时同步读取当前值。返回 `'connecting' | 'connected' | 'disconnected' | 'error'`。

### `useCrossTabHealth(bus, options?)`

将 `bus.getHealthSummary()` 镜像为 React 状态（`DataBusHealthSummary | null`）。由于健康摘要是快照而非事件流，该 hook 按间隔轮询（默认 1000 ms；传 `{ intervalMs: 0 }` 可仅依赖事件驱动刷新），并在状态变化与错误发生时立即刷新。修改 `intervalMs` 会替换轮询定时器，但不会重建 bus。bus 创建前返回 `null`。

## Vue Composables（`cross-tab-worker-databus/vue`）

Vue 3.3+ 是可选 peer 依赖；独立入口不会影响核心包。

```ts
const bus = useVueCrossTabDataBus(() => createWebSocketDataBus({ connection: { url } }));
const status = useVueCrossTabStatus(bus);
useVueCrossTabSubscription(bus, 'chat.*', message => console.log(message.data));
```

`useCrossTabDataBus` 返回 Vue `Ref`，在组件挂载时创建 bus、卸载时停止。`useCrossTabSubscription` 接受字符串或 `Ref<string>` topic，在 bus/topic 变化时自动重绑。`useCrossTabStatus` 返回与 `bus.onStatus()` 同步的 `Ref<WorkerStatus>`。

### `useVueCrossTabHealth(bus, options?)`

`useCrossTabHealth` 的 Vue 绑定：将 `bus.getHealthSummary()` 镜像为 Vue `Ref<DataBusHealthSummary | null>`。健康摘要是快照而非事件流，因此该组合式函数按间隔轮询（默认 1000 ms；传 `{ intervalMs: 0 }` 可仅依赖事件驱动刷新），并在状态变化与错误发生时立即刷新。响应式修改 `intervalMs` 会替换轮询定时器，但不会重建 bus。bus 创建前返回 `null`。

## `WorkerClusterRuntime`

高级 API，负责 Worker 注册、心跳、可见性、路由、BroadcastChannel 协议和迁移。业务模块不应直接操作它。

主要方法：

- `start()` / `stop()`
- `setStatus(status)`
- `subscribe(topic)` / `unsubscribe(topic)`
- `publish(topic, data)`
- `publishBatch(topic, items)`
- `broadcastEvent(eventType, payload)`
- `isAssigned(topic)`
- `isActiveWorker()`
- `hasLocalSubscriber(topic)`
- `getSnapshot()`

`stop()` 在本运行时同步调入消费者代码的任意位置都有效——无论是 `handlers.onControl`、`onResume`、`onSuspend` 回调，还是环境适配器的 `createChannel`。在这些位置到来的停止请求会放弃剩余的激活步骤：心跳定时器不会被挂载，那个窗口里构造出的 channel 会被关闭而不是挂上，也不会再有任何东西重新登记这个 Worker，于是一个已停止的运行时既不会以活跃 owner 的身份被对等端看见，也不会响应发给它的控制帧。`stop()` 仍然是幂等的：完成之后再调用不会产生任何改变。

## 工具函数

### `createOpaqueKey(value)`

生成稳定的 128-bit 十六进制不透明 key。用于避免把连接或 Topic 原文写入协调元数据；它不是密码学摘要，不应用于密码存储或安全签名。

### `createBrowserEnvironment()`

创建默认浏览器环境适配器，包含 storage、BroadcastChannel、定时器和页面生命周期事件。

### `getOrCreateTabId(environment, key?)`

返回当前页面/标签页实例的稳定标识：优先从 sessionStorage 读取，首次调用时创建（`tab-<random>`）并写回，因此刷新后的标签页会认领原有 route，而不是被当成一个全新标签页。

存在 `window.opener` 时**刻意不**复用已存储的值：`window.open()` 会把 opener 的 `sessionStorage` 克隆给子页面，盲目复用会让两个存活的标签页共用一个身份。storage 不可用或抛错时改为生成新 ID。

### `selectWorkerBackend(mode, availability?)`

按 `WorkerMode` 和能力检测选择实际后端，返回 `'shared' | 'dedicated' | 'local'`：

- `shared` / `auto`：SharedWorker → Dedicated Worker → 本地模式
- `dedicated`（默认）：Dedicated Worker → SharedWorker → 本地模式

`availability`（`WorkerAvailability`，已导出）可显式传入 `worker` / `sharedWorker` 能力标记，用于 SSR、测试或嵌入环境，避免访问不存在的全局对象。

### `effectiveWorkerLoad(worker, options?)`

最少负载 owner 选择背后的纯打分函数：`worker.load`（拥有的 Topic 数）加上 `options` 中 `loadWeighting` 权重对应的流量与调度滞后项。

打分结果始终是有限值。没有吞吐采样、权重全为 0（未启用）、采样窗口非正或非有限、或加权和为非有限时，都退回原始 Topic 数——非有限分数永远无法正确比较，会让 owner 选择取决于 Worker 数组顺序而非负载。权重含义见 [configuration.md](./configuration.md#自适应-owner-加权)。

### `approximatePayloadBytes(payload)`

低成本估算 payload 的线长，用于自适应负载采样的字节侧，也用于给保留的 replay 缓冲估算体积（`getDiagnostics().replay` 的 `bytes` 按需计算）——因此它并不只在启用自适应路由时运行。它也不是零分配的：对象节点会物化一份 `Object.values`。两种场景下近似值都够用，目标是跨 Worker 的稳定比较，而非精确字节数。

尺寸规则：`null`/`undefined` 与 symbol/function 为 `0`，boolean 为 `4`，number 与 bigint 为 `8`，字符串为长度，`ArrayBuffer` 与 TypedArray 视图为 `byteLength`，数组为 8 字节头部加各元素之和，普通对象为各值之和。

### `DEFAULT_MAX_ACTIVE_WORKERS`

同时拥有 Topic 的 Worker 数上限默认值（`3`）。它限制 fan-out 广度：只有这么多 Worker 有资格成为新 route 的 owner，因此二十个标签页的集群仍会把所有权集中在少数几个上，而不是摊薄。可通过集群选项 `maxActiveWorkers` 覆盖。

### 路由选择函数

- `selectActiveWorkers`
- `selectLeastLoadedWorker`
- `selectRebalanceTarget`
- `hasActiveOwner`
- `isWildcardTopic(pattern)`
- `topicMatchesPattern(pattern, topic)` — 订阅使用的通配匹配：`chat.*` 匹配 `chat.room.1`（按段前缀），`*` 匹配全部

这些纯函数主要用于测试、诊断和自定义协调策略。
