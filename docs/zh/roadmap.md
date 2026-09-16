# 路线图

0.20.91 已发布。项目会先持续完成可靠性发布，再进入 1.0.0 稳定性冻结。

## 0.20.92 进行中

当前开发线继续验证 predecessor reopen 结算、排队启动就绪与 stop promise 清理等生命周期错误路径。该开发线现已落地十一处修复。第一处让共享 stop gate 先于同步 teardown 前奏安装：从同步 STOP lifecycle trace 事件重入的 `stop()` 会共享同一次 teardown，而不是再调用一次 `transport.stop()`。第二处在 START trace 发出前安装 lifecycle epoch 与 `startPromise`：若同步 trace/status 回调重入 `stop()`，外层 `start()` 会立即停止后续 timer、cluster 与 topic 启动，旧 opening 由 epoch guard 放弃，transport 不会被重新打开。第三处把相同的「先安装 lifecycle、再发同步回调」顺序应用到 `reopenTransport()` 的 CONNECTING 状态通知，使恢复期间重入的 stop 能取消本次 reopen，而不是在 teardown 后重新打开 transport。第四处让同步 RESUME trace 回调内的 stop 同时取消显式 `start()` 与原生 `pageshow` 恢复；`WorkerClusterRuntime` 通过 lifecycle generation 阻止外层 pageshow 在 `onResume` 已停止或暂停 cluster 后再次 `activate()`。此前这些场景都可能留下 `state: stopped` 但 transport 或 cluster 仍活跃的半停止状态。第五处让已经停靠在 recovery gate 上的 transport 操作不再因等待中的自动恢复尝试失败而滞留：`runTransport()` 现在统计停靠操作数，自动尝试失败时若仍有 waiter 会立即发起一次 on-demand reopen，使在 cooldown 期间发出的 `publish()` / `subscribe()` 自身即可驱动恢复，而不必等待之后某个无关操作。demand reopen 自身失败时仍会重新武装 flag 留待后续操作重试，而不会在自身失败上自循环；一旦 reopen 成功，全部 waiter 会按序 flush。cluster-key 隔离保证现在由双 runtime 回归固定：不同租户可独立拥有同一 topic、publication 不会跨命名空间边界、持久化 key 使用不同 opaque hash 且不暴露明文 key。第六处 replay retention 修复会在 suspend/resume 期间旧 cleanup 事务仍在收尾时，把新排队的最新 cutoff 交给新一轮 cleanup，避免它一直滞留到未来某个无关 publication 才被处理。第七处在 `reopenTransport()` 发出同步 CONNECTING 通知前清空 `transportReady`，避免同一 tick 内第二个操作把仍在关闭的旧 transport 误判为可用连接；所有操作都会继续停靠在 opening 上，并在 replacement 打开后按序 flush。第八处让 pagehide suspension 续体具备 epoch 感知：若同步 DISCONNECTED status 回调按公开恢复路径调用 `start()`，旧 hide 续体会被放弃，不会在 replacement 打开后再次停止 transport 并留下错误的 healthy 状态。第九处修复保留 durable hydration 与实时流量的回放顺序：若 `load()` 尚未完成时已有 publication 写入，加载快照会排在实时消息之前，数量裁剪因此保留最新的实时消息，而不会把旧历史误认为更新内容。第十处让 replay hydration 能跨 lifecycle 替换：清除全部、清除单 topic、退订与 cutoff 裁剪会应用到仍在进行的加载快照，避免已清除历史复活；suspend/restart 会取消被取代的 load 并启动新一代 hydration；显式 stop/start 后也会重新加载 durable history，而不是留下空 ring。第十一处补上严格交接的 generation 缺口：`ROUTE_RELEASED` 必须与存储 route 的 generation 精确相等，其他交接轮次的 ACK 不能确认当前 route，也不能提前释放其 `SUBSCRIBE`。


## 0.20.91 已完成范围

可靠性开发线继续补强错误路径覆盖并维护发布门禁。IndexedDB replay 清理现在覆盖 `clear()`、`clearTopic()`、`clearBefore()` 的事务级错误，包括连接失效后的恢复，以及浏览器未提供 transaction error 对象时的领域级 fallback 拒绝信息。WebSocket transport 也会在连接失活后 best-effort 关闭 socket，避免自动恢复遗留死连接；已发布包验证的正常路径经审计确认没有固定等待或多余 registry 往返。Centrifuge token bridge provider 现在绑定到创建它的 client lifecycle，已被替换的 client 无法把迟到凭证请求送入新会话。旧 client 的 subscription 回调与 publish rejection 也已有回归约束，不能修改或上报到替代会话。
DataBus 生命周期审计现在还固定了 failed-reopen 的 stop gate 复用、被取代 initial open 的迟到 rejection 隔离、已退休 transport 迟到的 message/status/error 回调 generation 隔离，以及就绪/恢复契约（`stop()` 后迟到的 `pageshow` 不得重启后台工作、自动恢复再次失败必须通过 `ready()` 暴露、被取消的排队启动不得满足替代重启、排队重启在可用前被挂起必须让 `ready()` reject、旧 recovery timer 不得重开 transport）。本轮审计还发现并修复了一处真实定时器泄漏：`WorkerClusterRuntime.pause()` 在无 channel 时不再排定延迟 `channel.close()`。mutation check 已确认移除对应守卫时每条回归都会失败。本阶段还覆盖 failed-open 后 stop gate 复用、pagehide stop rejection 恢复、replay handler 分发隔离，以及 in-flight recovery reopen 复用；重开守卫已有 mutation 覆盖。

排队 transport 操作审计还固定了：在 initial open 尚未完成时排队的 `subscribe()`，其 rejection 必须恰好通过 `onError` 上报一次且不得成为 unhandled rejection；start gate 放行前不得触碰仍在 opening 的 transport。
DataBus 生命周期审计还固定了 initial `transport.start()` 被 `stop()` 取代后、teardown 等待期间才 reject 的 rejection ownership：原 `start()` 调用方看到自己的失败，`stop()` 仍成功，transport 恰好关闭一次，旧失败不会进入新 lifecycle 的 error ledger。
跨 Tab `EVENT` 边界现在会拒绝不是对象、或缺少字符串 `topic` 的 publication payload，因此一条畸形的同源帧不会再从 BroadcastChannel 监听器抛出并破坏后续投递。未知事件类型保持前向兼容；旧版 payload 会继承帧级 `originTabId`，payload 自带归属优先，两项行为均有回归固定。

## 0.20.90 已完成范围

本开发线修复 0.20.89 tag 首发暴露的发布管线问题，并统一文档中的投递语义。

- 发布门禁传播预算：阻塞式已发布包消费者验证从 24 × 5 s（2 分钟）提升为 48 × 7.5 s（6 分钟）。0.20.89 的 tag 首发发布成功之后仍在该门禁失败，因为 `npm pack` 在旧预算内始终返回 `ETARGET`；真正缺失的包仍会耗尽预算而失败。
- 投递语义：API、架构与能力文档现在一致说明有界的本地 fan-out 保证，并明确 SDK 不提供端到端的 at-least-once 或 exactly-once 投递；中文 API 参考已补充按 bus 可选启用的 `messageId` 去重窗口。
- 发布性能证据：基准趋势文档已基于 23 份归档报告刷新；最近两次运行对比未超过 50% 上限，两种 Worker 模式的单消息发布延迟均有改善。

## 0.20.89 已完成范围

本开发线延续异步回调隔离审计：以下每一项修复都把回调、排队微任务或 Promise 续体绑定到创建它的生命周期 generation，使被取代的会话无法写入其替代者。

- 异步 teardown 与重启边界：已 settle 的 `stop()` gate 不再吞掉后续 teardown（`stop → start → stop` 现在以停止态结束）；`getHealthSummary()` 对正在停止的 bus 报告 `state: 'stopped'`，不再与其已经发出的 `publish()` / `subscribe()` / `ready()` 拒绝语义自相矛盾。
- replay 持久化隔离：微任务排队的 batch flush 与被排队的 retention cleanup 会在 `suspend()` / `stop()` 取代其 generation 后被丢弃，已停止会话的历史无法再写入 durable store。
- durable hydration 取消：在 `suspend()` 或 `stop()` 之后才 resolve 的 `load()` 不再向 teardown 已清空的缓冲区追加数据，并按生命周期取消上报，而不是记为持久化失败。
- trace 会话隔离：已停止的 trace reporter 保持惰性——旧会话排队中的 `asyncSink` 事件被丢弃，显式重启会清除停止标记，使其重新发出生命周期 `start`。
- transport 与 Worker 回调隔离：Centrifuge credential-provider 结果绑定到发起请求的确切 Worker/port/session；`CentrifugeSession` 的异步 client/subscription 回调在 `STOP` 或重新初始化后被忽略；来自已替换 WebSocket 连接的 `Blob` 二进制帧不再被当作新连接的帧派发。
- 回归安全网：seeded lifecycle fuzzer 现在覆盖 1_500 种交织，并断言最后一次显式意图为 `stop()` 的序列会以 `state: 'stopped'` 且无 live transport 结束。

## 0.20.88 已完成范围

- 启动失败恢复现在可重入：transport 在初始 `openTransport()` 尚未结算时同步上报 `error`，调用方可以从 `onStatus('error')` 或 `onError` 回调立即重试。失败 open 会先完成清理，重试建立新的生命周期，旧 rejection 不会重新污染已重置的失败账本。
- 初始 transport open 尚在飞行时反复发生 BFCache `pagehide`/`pageshow`，不再让 bus 永久停留在挂起状态。suspend 只在旧 stop gate 仍代表当前生命周期时复用；否则安装新的串行 stop，使下一次 resume 真正重开 transport。
- 显式 `start()` 现在是完整的 BFCache 恢复路径：除 transport 外还会恢复跨 Tab 协调，并重新启动 `pagehide` 暂停的 trace metrics、dedup 过期清扫与 replay retention 定时工作。

## 0.20.87 已完成范围

- transport 恢复与就绪加固：原生 WebSocket 后端现在遵守 `DataBusTransport.start()` 契约（仅在 `open` 后 resolve，握手失败或超过 `connectTimeoutMs` 时 reject），自动恢复会真正创建替代 socket，`getHealthSummary()` 跟随 live transport 状态而不是 `transportReady` 诊断标记。
- 不再把操作写进已经消失的连接：恢复门会把 `subscribe()` / `publish()` 停放在自动与按需重开之后（包括自动尝试失败但仍保留预算的情况）；在真实连接之后出现的干净 `disconnected` 现在会触发一次按需重开，而不是交给已关闭的 socket；而异步上报连接状态的 worker 型后端仍保有其「尚未连接」窗口，不会被动重开。
- 生命周期与 `ready()` 边界修复：BFCache 挂起期间 `ready()` 会 reject；transport 自身 `stop()` reject 或抛错时 `stop()` 仍能 resolve；一次打开失败在两个恢复账本中只打一次时间戳；运行期 transport 错误会进入恢复账本；被取代的异步打开不再拆除更新的 suspend/resume 转换。
- 适配器与工具链：React/Vue `useCrossTabHealth` 在 `intervalMs` 变化时无需重建 bus 即可生效；`vitest` 及其 coverage-v8 provider 升级到 5.0.1 补丁版。

## 0.20.86 已完成范围

- 加固显式 stop/start 边界的生命周期：排队重启与进行中的 stop 串行化，并会被更新的 stop 取消，可通过 `ready()` 观测；被取代的异步开启不再拆除更新的 suspend/resume 转换；stop 期间调用的 `subscribe()` 与非空 `publish()`/`publishBatch()` 改为通过 `onError` 上报，不再修改 teardown 状态或被静默丢弃。
- 显式 `start()` 在自动恢复预算耗尽后，现在会执行文档所述的手动恢复，同时保留 cluster 状态、订阅与回放历史。
- IndexedDB replay 持久化在事务 abort（包括连接丢失导致的 abort）时结算全部 mutation，串行队列不再永久阻塞；replay AGE 裁剪改为内存与持久化历史共用同一套位置无关策略。
- 配置参考在中英文中完整记录 replay/dedup 公共选项，并新增从声明派生的文档守卫；固定种子属性不变量覆盖 active-worker 选择与 rebalance target。

## 0.20.85 已完成范围

- 新增固定种子的属性测试套件（`tests/property.test.ts`）：针对纯热路径函数与有状态管理器，覆盖有限性/全函数性、与顺序无关的选择、循环安全的大小估算、publication topic/元数据有效性、`serializeError` 可克隆性，以及长时间随机操作序列下的 dedup/replay 上界。
- `effectiveWorkerLoad` 对损坏的存储基础负载保持全函数性——非有限值（JSON `1e999` → `Infinity`）不再泄漏进 owner 选择并重新引入数组顺序依赖。
- `approximatePayloadBytes` 增加深度上界，循环 payload（structured clone 会保留循环）不再使回放字节占用或自适应负载采样栈溢出。
- `serializeError` 始终产出可结构化克隆的结果；不可克隆的 context（函数/Symbol）会被丢弃，而不是让错误上报本身抛出 `DataCloneError`。
- 当 `pruneStrategy: 'age'` 未配置 `retentionMs` 时，回放历史重新受上界约束：内存环与 IndexedDB 记录均应用数量上限。

## 0.20.84 已完成范围

- 发布/CI 门禁由“文档约定”变为强制执行：`pnpm test:coverage`、`pnpm verify:compat`、`pnpm verify:pack` 进入 CI verify job，Release 工作流在发布前重跑 lint + compat + pack，两个 checkout 均拉取完整历史与 tag 以便解析 compat 基线。
- 协调恢复加固：交接 ACK 丢失、owner 崩溃或前任 owner 退出后，均由 worker-TTL 门禁的重新选举恢复，采用单写者与投影负载分摊；每次路由确认 / 迁移 / 恢复都会发出有界的 `reliability` trace 事件。
- 三个真实正确性修复：Vue `useCrossTabDataBus` 卸载泄漏（pending start 可能创建无人拥有的 bus）、自适应 dedup TTL 未在热路径生效，以及 `effectiveWorkerLoad` 会把损坏的存储 load 造成的非有限评分泄漏回 owner 选择。
- 产品 demo 可观测性：事件流渲染 reliability / subscription / coordination trace 事件，混沌开关在真实浏览器中演练丢 ACK 与崩溃恢复路径，配置面板显示当前混沌模式。
- 覆盖与工具链：`ReplayManager` / `DedupManager` 直接测试套件、transport 错误隔离与部分元数据覆盖、vitest 5（基准 API 已迁移）与 eslint 10 lint 配置；TypeScript 7 因 typescript-eslint 未支持而继续递延。

## 0.20.83 已完成范围

- 健康钩子的适配器边界用例、可归档对比的浏览器基准、与当前能力对齐的 README 特性清单。
- 一次大规模内部清理：全部运行时字符串字面量集中到 `utils/constants.ts` 并由之派生字面量类型，回放与去重从 `CrossTabDataBus` 拆分为自包含的 `ReplayManager` / `DedupManager`。
- demo 的「批量 10」publishBatch 按钮与 `/debug/wsstats` 帧计数及单帧 E2E，`asyncSink: true` 投递语义文档，以及与阻塞式发布消费者校验对齐的发布检查清单。

## 0.20.82 已完成范围

- E2E 默认断言上限提升至 20 秒；结构化克隆拒收（Symbol）与 cause 保留覆盖；共享模式会话生命周期经示例服务的连接数端点端到端验证。

## 0.20.81 已完成范围

- 浏览器基准新增 data-bus 热路径矩阵，健康摘要纳入 E2E 端到端断言，storage-event 通道与传输层批量进入 API 文档与能力矩阵。

## 0.20.80 已完成范围

- E2E 可靠性治理：失败 trace/视频与更长保留期、reload 类用例的先收敛后发布模式、符合文档保证的错峰突发模式，以及架构文档中的丢失与恢复矩阵。

## 0.20.79 已完成范围

- 已发布包消费自检成为 release 阻塞门禁（重试预算提升至 24 × 5 秒）；丢失 ACK 交接的恢复链（TTL 清理 + 恢复后重选举）由回归固化。

## 0.20.78 已完成范围

- E2E 逐 Tab 断言真实 transport 后端；延迟关闭不变量由回归测试固化并写入架构文档；getting-started 覆盖健康摘要与协调降级。

## 0.20.77 已完成范围

- 修复无 factory 时静默降级本地会话的缺陷（打包的 Worker 现在真正被使用）；补充默认后端与通道丢失恢复覆盖；demo 展示协调通道诊断与降级开关。

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

## 0.11.0 已完成范围

- 当持久化适配器支持 `clearBefore` 时，通过 `replay.retentionMs` 自动执行持久化回放留存。
- 周期性 trace 指标中加入去重接受/抑制计数。
- 覆盖 WebSocket、Centrifuge、Worker 边界与浏览器 E2E 的 publication metadata 兼容性测试。
- Service Worker transport 决策：在目标浏览器具备稳定的连接生命周期契约前，刻意保持不实现。

## 0.20.68 已交付

- 为集群帧和 worker snapshot 增加协议版本元数据，并保持旧版本缺失字段时的兼容处理。

## 0.20.69 候选

1. ~~增加 peer 能力矩阵，并在 diagnostics 暴露 SDK、后端与 transport 身份。~~ 已交付：`getDiagnostics()` 携带协议版本、未知消息统计、peer 协议版本与 transport 身份；`getHealthSummary()`/`getMetrics()` 现在也会随单一对象输出实时 trace 指标与 sink 状态。
2. ~~统一 replay、dedup、trace、recovery 与 cluster 健康指标。~~ 已交付：`getDiagnostics()` + `getMetrics()` + `getHealthSummary()` 在单一快照中覆盖生命周期、恢复、dedup、replay、持久化、协议、transport、cluster、trace 指标与 sink 背压。
3. ~~优化 IndexedDB 并发 append 与清理路径。~~ 已交付：相邻 `appendBatch` 变更合并为单事务；`clear`/`clearTopic`/`clearBefore` 顺序保持。
4. ~~增加 adaptive dedup、async trace、prune 和长时多 Tab 性能基线。~~ 部分交付：bench 覆盖负载加权评分、`getMetrics`、publishBatch 批次敏感性，以及既有 dedup/async-sink/persistence 用例。

## 0.13.0 候选

1. 冻结公共导出面与 transport 无关的 publication 信封。
2. ~~精确记录 at-least-once 投递与去重保证。~~ 已交付：architecture/API/capability 文档现在明确区分「每条已接受 transport publication 的本地至多一次扇出」与端到端投递，记录 transport/服务端的丢失与重复投递，并说明有界、可选 `messageId` 去重的边界，不再宣称 at-least-once 或 exactly-once。
3. 增加长时浏览器浸泡覆盖：replay 留存、重连、BFCache 与 owner 迁移。
4. 为 1.0 前的协议别名发布迁移指南与弃用策略。

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
