# 路线图

0.20.76 正在推进。项目会先持续完成可靠性与协议兼容性的中版本迭代，再进入 1.0.0 稳定性冻结。

## 0.20.76 已完成范围

- 面向无 BroadcastChannel 环境的 opt-in storage-event 协调降级通道，含降级通道上的 owner 选举集成测试，并同步降级文档与能力矩阵。

## 0.20.75 已完成范围

- 单测套件新增热路径性能门禁（宽松阈值防灾难性退化，真实基准仍在 `pnpm bench`）；IndexedDB replay 持久化新增脚本化故障注入，覆盖 invalidate 与恢复错误路径；审计确认 Release workflow 已集成已发布包消费自检。

## 0.20.74 已完成范围

- 可选的 `DataBusTransport.publishBatch`：WebSocket transport 单帧批量发送，demo server 支持批量帧，无批量能力的 transport 自动回退逐条发送；React/Vue 新增 `useCrossTabHealth` 绑定；健康判定纳入 transport 实时状态。

## 0.20.73 已完成范围

- IndexedDB replay 持久化适配器纳入单测（基于 `fake-indexeddb`）：覆盖裁剪策略、批量分组、并发串行化、清理语义与瞬时打开失败恢复。
- 真实浏览器 E2E 新增三 Tab 并发发布突发与整连接重构建（stop/start）重入集群两个场景；architecture 文档新增稳定性不变量参考（中英文）。

## 0.20.72 已完成范围

- 扩展基准矩阵，覆盖 `publishBatch`、wildcard routing、dedup、replay prune、批量持久化与异步 trace sink。
- 长时稳定性加固：补齐 handoff ACK 世代校验、BFCache 往返、恢复耗尽重置、存储写退避恢复与 replay 持久化清理竞态的回归测试；修复反向的 stale-ACK 世代比较与批量 flush 复活清理历史两处缺陷。
- 生产能力：`getHealthSummary()` 就绪判定、`getPersistenceStats()`、diagnostics 中 transport 状态细化（status/suspended），以及构建时注入的 SDK 版本。

## 0.20.71 已完成范围

- 新增可选 `appendBatch` replay 持久化接口；IndexedDB 对发布突发进行事务合并，旧适配器保持兼容。

## 0.20.70 已完成范围

- 在统一 diagnostics 中新增 SDK 版本与 transport/backend 身份，便于支持包与健康面板使用。

## 0.20.69 已完成范围

- 在 cluster snapshot 与 diagnostics 中新增 peer 协议能力发现。当前 runtime 广播协议版本 1；旧 peer 显示为 `null`。

## 0.20.67 已完成范围

- 新增未知协议消息计数与最近类型诊断，并纳入 `getDiagnostics()`，同时保持旧 runtime 安全忽略未知消息。

## 0.20.66 已完成范围

- IndexedDB replay persistence 新增可选 `pruneStrategy` 与 `retentionMs`，与内存 replay 使用一致的裁剪语义。

## 0.20.65 已完成范围

- 新增可选 dedup 自适应 TTL 与 replay `pruneStrategy`（`count`、`age`、`both`），保留旧默认行为。

## 0.20.64 已完成范围

- 新增 trace `asyncSink` 选项，将 sink 投递合并到 microtask，保持事件顺序与错误隔离，并新增回归测试（339 个单测）。

## 0.20.63 已完成范围

- 新增可选 `onUnknownMessage` 钩子；旧 runtime 遇到未来 cluster message variant 时安全忽略，不抛异常，并增加回归测试（338 个单测）。

## 0.20.62 已完成范围

- 新增 `CrossTabDataBus.getDiagnostics()`，整合 status、transportReady、recovery、dedup、replay 用量与 cluster 快照，便于健康检查与运行时观测。

## 0.20.61 已完成范围

- 在每条 `DataBusMessage` 与 cluster `EVENT` 线帧上加入 `originTabId?: string`，让跨 Tab 的 replay 历史能归属到产出的 Tab。
- `WorkerClusterRuntime.broadcastEvent()` 默认把 `originTabId` 设为当前 runtime 的 `tabId`，`CrossTabDataBus.handleTransportMessage` 在广播前 stamp `originTabId = cluster.tabId`，邻居与 IndexedDB 回放的晚加入订阅者都看到一致的归属信息。
- `onEvent` 处理器签名新增第四个 `originTabId?: string` 参数；既有调用点改用 `toMatchObject` 以避免额外参数破坏严格相等。
- 新增 `CrossTabDataBus cross-tab replay consistency contract` 单元测试，覆盖生产端 stamp、本地 handler 一致性、写后晚加入与本地来源回放路径（336 个单测，11 个 e2e 测试）。

## 0.20.60 已完成范围

- 在 `CrossTabDataBus` 与 `WorkerClusterRuntime` 上新增 `publishBatch(topic, items)`，让调用方把多条 item 合并进单次 BroadcastChannel postMessage。每条 item 的 `messageId` / `timestamp` 在传输后保留，dedup / replay / 顺序仍按 item 维度生效；空 batch 为 no-op，单 item batch 直接走 `publish()`。基准用例 `publishBatch / 1000 messages / 10 per call` 为突发路径提供上限参考（332 个单测）。

## 0.20.59 已完成范围

- 扩展 `CrossTabDataBus.getRecoveryStats()`，新增 `generation` 与 `lastSuccessAt`，用于诊断 transport 的完整开启历史。

## 0.20.58 已完成范围

- 把 publish 路径的 route-owner 缓存加上可配置 LRU 上限（默认 256），并在 `WorkerClusterRuntime.getSnapshot()` 上暴露 size/max/hits/misses 诊断信息。
- 修复了一个远程 owner 的 publish 正确性 bug：此前 `wildcardPublishCache` 的 `null` 项会提前 return，导致没有本地 wildcard 订阅的 topic 不再走 route-owner 查找；现在会正确转发到远程 owner。
- 新增 LRU 淘汰、TTL 失效、owner 迁移和远程 owner 命中缓存的单元测试（319 → 321 个单测）。

## 0.20.57 已完成范围

- 新增 warm/cold route-cache publish 基准，便于衡量 owner 路由的性能。

## 0.20.56 已完成范围

- 为 publish 路由引入带 generation 比对的 route-owner 缓存，并在生命周期关闭时清空。

## 0.20.55 已完成范围

- 新增具备生命周期安全失效机制的 wildcard publish 判定缓存；基准结果仍需进一步稳定后再宣称吞吐提升。

## 0.20.53 已完成范围

- 扩展恢复诊断，新增安全且可序列化的 `errorMessage` 摘要。

## 0.20.52 已完成范围

- 扩展 `getRecoveryStats()`，新增 `hasError`，可观测当前仍保留的 transport 错误状态。

## 0.20.51 已完成范围

- 新增公开恢复状态快照 API：`getRecoveryStats()`。

- 新增 owner handoff 后取消订阅覆盖，验证存活 tab 取消后不会重建路由。

- 新增 reconnect 前取消订阅覆盖，验证已移除 topic 不会在恢复后重放。

- 新增多 topic 恢复覆盖，验证 reconnect 后每个 topic 都只恢复一次。

- 新增长时 reconnect flapping 覆盖，验证重放保持有界且无重复。

- 新增重复 worker 能力探测覆盖，验证 auto backend 选择在多次探测中保持确定性。

## 0.20.45 已完成范围

- 新增 WebSocket 多轮 error/restart 覆盖，验证始终只有最新连接保持活跃。

## 0.20.44 已完成范围

- 新增生命周期契约回归，验证旧 WebSocket 的 close/error 回调不会影响重启后的会话。

## 0.20.43 已完成范围

- 新增 WebSocket 多轮 stop/start 清理覆盖，验证订阅集合和旧回调会在连续生命周期切换中清除。

## 0.20.42 已完成范围

- 新增 Dedicated Worker 多轮 stop/start 清理覆盖，验证 STOP 边界会在连续生命周期切换中隔离旧 worker 投递。

## 0.20.41 已完成范围

- 新增 SharedWorker 多轮 stop/start 资源 soak，验证每轮都会释放监听器和 heartbeat 定时器。

## 0.20.40 已完成范围

- 新增 auto worker mode 多轮失败与恢复覆盖，验证持续优先使用 SharedWorker，且旧 port 的消息不会在连续重开后投递到会话。

## 0.20.39 已完成范围

- 新增 Dedicated Worker 多轮失败与恢复覆盖，验证只有最新 worker 可以投递消息。

## 0.20.38 已完成范围

- 新增 SharedWorker 多轮失败与恢复覆盖，验证只有最新 worker port 可以投递消息。

## 0.20.37 已完成范围

- 新增多轮 WebSocket stop/start 替换覆盖，验证多个旧 socket 的迟到回调都不会泄漏到最新会话。

## 0.20.36 已完成范围

- 新增 1,000 条高频 publish burst 回归，验证本地 owner 快路径保持消息顺序且不读取 storage。

## 0.20.35 已完成范围

- 新增 publish 与 receive/dispatch 热路径基准，和 routing、cluster 协调基准一起建立可重复的吞吐基线。

## 0.20.34 已完成范围

- 新增 transport 故障恢复组合回归，覆盖自动重开/重新订阅、replay 历史、重复抑制、持久化 append 边界和晚加入 handler 顺序。

## 0.20.33 已完成范围

- 新增基于 tag 的发布兼容检查，验证公开 exports、ESM/CJS 条件和类型元数据不会被升级移除。

## 0.20.32 已完成范围

- 新增 replay/dedup 组合覆盖：历史 hydration、恢复后实时消息、重复抑制、持久化 append 边界和晚加入 handler 顺序。

## 0.20.31 已完成范围

- WebSocket 在 stop/start 替换连接后按 socket 身份隔离生命周期和消息回调。
- 新增旧连接迟到事件不会进入新会话的回归覆盖。

## 0.20.30 已完成范围

- 将 IndexedDB replay 持久化 E2E 扩展到 BFCache、stop、reload、异步 hydration、有序历史和 replay 标记的连续生命周期组合。

## 0.20.29 已完成范围

- 新增 Dedicated/Shared/auto worker backend 在全部能力组合下的穷举降级矩阵覆盖。

## 0.20.28 已完成范围

- 将打包消费者验证扩展为发布兼容矩阵，覆盖包元数据、ESM/CJS exports、声明文件和全部公开子路径。

## 0.20.27 已完成范围

- 新增真实 Chromium 连续 BFCache/reload/owner handoff soak，验证 reconnect 就绪状态以及多轮生命周期切换中的跨 Tab exactly-once 投递。

## 0.20.26 已完成范围

- 新增 trace 隐私字段、模式隔离、sink 异常、reliability 事件 schema、有界状态和生命周期 metrics 窗口回归覆盖。
- trace reporter 在 stop 后保持静默，必须显式重新 start 才会开启新窗口。

## 0.20.25 已完成范围

- 新增协议兼容性覆盖：旧版与嵌套 WebSocket/Centrifuge publication 帧、未知字段、非法可选元数据和未知 worker 消息。

## 0.20.24 已完成范围

- 新增 replay/dedup 组合长时回归，覆盖 TTL 过期、静默周期 sweep、durable retention 清理、异步 hydration 与定时器停止。

## 0.20.23 已完成范围

- 新增双 Tab BFCache 与 transport error 接管回归，覆盖 owner 接管、返回恢复和无重复消息投递。

## 0.20.22 已完成范围

- 显式 stop/restart 边界会重置恢复尝试与 exhausted 诊断状态，让新会话从干净序列开始。

## 0.20.21 已完成范围

- 同一失败恢复序列中的 exhausted 诊断只发一次，成功重连后会重置。

## 0.20.20 已完成范围

- 自动恢复达到配置的次数上限时会发出 `exhausted` 诊断事件，不再静默停止。

## 0.20.19 已完成范围

- 可通过 `recovery.maxAttempts` 限制自动恢复次数，同时保留显式订阅需求触发恢复的路径。
- 新增次数上限校验与恢复上限序列回归覆盖。

## 0.20.18 已完成范围

- 自动 transport recovery 的冷却时间可通过 `recovery.cooldownMs` 配置。
- 新增配置校验与 fake-timer 边界回归覆盖。

## 0.20.17 已完成范围

- 连续 transport recovery 诊断现在带有单调递增的尝试编号，成功重连后会重置序列。
- 新增多次失败恢复序列的回归覆盖。

## 0.20.16 已完成范围

- transport recovery trace 现在区分 `scheduled`、`succeeded`、`failed` 结果，便于诊断重连失败。
- 新增失败恢复后成功重试的回归覆盖。

## 0.20.15 已完成范围

- 新增 transport 状态抖动覆盖，验证重复 `connected`/`disconnected`/`error` 通知不会造成订阅重复或丢失。

## 0.20.14 已完成范围

- Release 仅在发布后消费者诊断失败时保留明确 summary，不再阻断已经成功的发布；本地验证仍保持严格失败。

## 0.20.13 已完成范围

- 浏览器 CI 失败时自动保留 Playwright report 和 test-results artifact，便于事后定位 runner flaky 问题。

## 0.20.12 已完成范围

- 发布消费者验证在 CI import 失败时输出包目录和 peer 依赖链接诊断，便于定位仅在 runner 出现的问题。

## 0.20.11 已完成范围

- Release 按 tag 串行执行，并始终把 npm 版本、tag 和 commit 写入 GitHub step summary，便于定位 registry 或 workflow 失败。

## 0.20.10 已完成范围

- 新增多 topic 重复 reconnect 回归覆盖，确保恢复期间每个已分配 topic 恰好重放一次，避免 transport 订阅重复或丢失。

## 0.20.9 已完成范围

- 发布包验证同时接受 semver 和带 `v` 的 tag 输入，确保 release 触发检查与本地命令一致。

## 0.20.8 已完成范围

- 发布后验证会在 npm registry 传播期间轮询 tarball，降低刚发布时的误报失败。
- GitHub Release 在发布或跳过发布后，都会验证当前 tag 对应版本的 ESM/CJS 消费者；手动 npm 发布也适用。

## 0.20.7 已完成范围

- 新增 `pnpm verify:published`：从 npm 下载已发布包，并在干净临时消费者中验证主入口、hooks、Vue、Centrifuge 的 ESM/CJS 导入。
- 支持通过 `PUBLISHED_VERSION` 指定版本；未指定时跟随 npm 当前版本。

## 0.20.6 已完成范围

- 新增中英文发布检查清单，覆盖本地验证、打包消费者、打 tag、手动 npm 发布和发布后验证。
- 明确 npm 历史版本不可覆盖；缺失的历史版本必须从对应 git tag 重建。

## 0.20.5 已完成范围

- 新增公开消费者冻结覆盖：主入口、hooks、Vue、Centrifuge 子路径的 ESM 与 CommonJS 双格式消费。
- 校验发布包中的声明文件存在，并包含 replay、dedup 和 publication metadata 等关键类型。

## 0.20.4 已完成范围

- 新增真实 Chromium 多 Tab soak 场景，覆盖重复 fan-out、owner migration、BFCache 往返、reload 恢复和无重复投递。
- 将浏览器生命周期转换串成一个连续会话，能够捕获孤立用例难以发现的 timer 与 route 清理回归。

## 0.20.3 已完成范围

- 新增 React 动态 topic 生命周期覆盖。
- 验证 topic 替换会移除旧订阅后再接收新 topic，且通过 WebSocket hook 链路生效。

## 0.20.2 已完成范围

- 新增协议恢复回归：malformed binary/text frame 之后，合法 WebSocket publication 仍可继续投递。
- 将二进制截断、JSON 解析失败、nested envelope 和错误隔离串成一个兼容性序列验证。

## 0.20.1 已完成范围

- 新增 persistence mutation sequence soak 覆盖：hydration、重试恢复、topic 清理、后续 append 和全量清理。
- 验证串行 persistence 操作在瞬时失败后仍可继续使用。

## 0.20.0 已完成范围

- publication envelope 兼容性已覆盖 legacy、嵌套、fallback topic、原始 payload、metadata 和未知字段帧。
- 缺失或空 topic 会统一拒绝，同时继续支持 transport 提供的 fallback channel。

## 0.19.9 已完成范围

- 新增 dedup 与 replay/persistence 组合回归覆盖。
- 被 dedup 抑制的 publication 不会污染 replay 历史；TTL 到期后同一 message ID 可以再次被接受。

## 0.19.8 已完成范围

- IndexedDB replay adapter 在事务或请求失败后会使缓存连接失效。
- 已关闭或不可用的连接可沿用现有 persistence retry 路径恢复，不需要重建 adapter。

## 0.19.7 已完成范围

- IndexedDB replay adapter 在 open 失败后会丢弃 rejected promise，下一次操作可重新打开并恢复。
- 与既有跨 tab `versionchange` 连接重置行为保持兼容。

## 0.19.6 已完成范围

- IndexedDB replay adapter 遇到跨 tab `versionchange` 时会关闭旧连接，并在下一次操作时重新打开。
- schema 变化后不会继续复用失效数据库连接。

## 0.19.5 已完成范围

- React bus effect 在 StrictMode 和快速依赖切换下使用 generation 保护。
- 过期的异步清理不会覆盖最新的 active bus。

## 0.19.4 已完成范围

- Vue bus 在快速 reactive 依赖切换时使用 generation 保护重建流程。
- 过期的异步生命周期完成不会重新挂回旧 bus 实例。

## 0.19.3 已完成范围

- 新增可选 `dedup.sweepMs`，在安静期间定时删除过期 message ID。
- sweep 定时器遵循 DataBus 生命周期，默认关闭。

## 0.19.2 已完成范围

- `stop()` 和 pagehide 挂起边界会取消待执行的 persistence retry。
- 已取消的 retry 不会再次调用 adapter，也不会被当作持久化失败上报。

## 0.19.1 已完成范围

- WebSocket 二进制 publication 除 `ArrayBuffer` 外，也支持浏览器常见的 `Blob` 帧。
- Blob 转换失败会通过 transport error callback 隔离报告，不会打崩消息回调。

## 0.19.0 已完成范围

- persistence retry 会发出有界、可选开启的 `persistence_retry` reliability 事件，包含操作名和尝试次数。
- 诊断覆盖 hydration、append、全量/Topic 清理以及 retention 清理，不暴露 payload 或错误正文。
- 保持既有重试时序、默认单次尝试、adapter 契约和最终错误处理兼容。

## 0.18.0 已完成范围

- 新增可选 replay persistence retry，支持有限尝试次数和指数退避。
- append、hydration、手动清理、topic 清理和 retention 清理统一使用恢复路径。
- 导出公开 retry 配置类型，同时保持 persistence adapter 契约兼容。

## 0.17.0 已完成范围

- 新增可选的周期性 replay retention sweep，即使没有新 publication 也能清理 durable history。
- sweep 定时器遵循 start/resume 与 pagehide/stop 生命周期边界。
- 补充 fake-timer 覆盖，保护清理调度、销毁和非法配置行为。

## 0.16.0 已完成范围

- publication burst 期间会合并 retention cleanup，并以最新 cutoff 串行执行持久化 mutation。
- WebSocket binary 协议边界新增截断帧和非法帧回归覆盖。
- 继续保留并明确 legacy replay、JSON metadata 和手动清理的兼容保证。

## 0.15.0 已完成范围

- replay retention 会保留没有显式 timestamp 的 legacy 消息，只清理早于 cutoff 且带显式 timestamp 的记录。
- trace 时间戳支持注入 `trace.now`，与已有的 dedup 时钟注入保持一致。
- 补充 replay 清理、诊断和适配器行为的兼容性与生命周期回归覆盖。

## 0.14.0 已完成范围

- Vue composable 在同一个 bus 上切换 reactive topic 时会正确重绑。
- 跨页面 replay mutation 顺序与生命周期保证已写入文档并有回归测试。

## 0.13.0 已完成范围

- IndexedDB replay mutation 按 adapter 串行化，避免并发 append 的读改写丢历史。
- 完整 stop/restart 边界会清空 dedup 状态。
- 补充持久化失败诊断和生命周期回归覆盖。

## 0.12.0 已完成范围

- dedup TTL 支持可注入时钟，生命周期与过期测试不再依赖墙上时间。
- replay 持久化 append、hydration、退订和 retention 清理失败均有结构化诊断。
- publication metadata 做兼容性归一化：只接受非空 ID 与有限 timestamp。
- 补充 legacy、嵌套、fallback topic 和坏 metadata 协议夹具测试。

## 0.20.68 已交付

- 为集群帧和 worker snapshot 增加协议版本元数据，并保持旧版本缺失字段时的兼容处理。

## 0.20.69 候选

1. 增加 peer 能力矩阵，并在 diagnostics 暴露 SDK、后端与 transport 身份；
2. 统一 replay、dedup、trace、recovery 与 cluster 健康指标；
3. 优化 IndexedDB 并发 append 与清理路径；
4. 增加 adaptive dedup、async trace、prune 和长时多 Tab 性能基线。

## 0.13.0 候选

## 更长期候选

1. **Replay 生命周期与留存**：增加持久化 `clear`/`clearTopic`，退订/替换时清理旧历史，并通过 trace 与 error handler 暴露持久化失败；
2. **可靠性诊断**：增加恢复/重试、owner ack、路由迁移结构化事件，元数据有界且默认关闭 trace；
3. **发布去重**：设计并实现可选、有界的 message-ID 窗口，覆盖本地分发、BroadcastChannel、WebSocket 与 replay，默认行为保持不变；
4. **适配层与协议对齐**：统一 React/Vue 生命周期和类型契约，补充二进制帧与恢复语义文档，并增加自定义 transport 兼容夹具；
5. **运维验证**：扩展浏览器和打包消费测试，增加去重/恢复/replay 清理回归基准，Push CI 继续作为发版门禁。

## 发版检查清单

- 更新 `[Unreleased]` 与版本日期；
- 执行 `pnpm check`、`pnpm lint`、`pnpm test:e2e`、`pnpm bench`、`pnpm bench:browser`；
- 从打包 tarball 做 ESM/CJS 消费冒烟验证；
- 推送 tag 后核验 GitHub Release 与 npm `latest` dist-tag。
