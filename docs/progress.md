## 0.20.92 heartbeat TTL/orphan convergence audit (2026-09-16)

- 状态：审计完成，未发现需要修改的运行时代码缺陷。
- 审计范围：共享 fake clock 下的 worker TTL pruning、orphan subscriber/route cleanup 顺序、dead-owner route recovery、`BatchingStorageWriter` pending delete 与后续同 key write 的覆盖语义，以及 heartbeat/registry nudge 后的 projected-load 收敛。
- 结论：`reconcileWorkers()` 先移除 stale workers，再清理 subscriber，最后清理无 subscriber 的过期 route，确保 route 判断使用最新 tab 集合；dead-owner 仍有 live subscriber 时由 `reconcileSubscriptions()` 立即 re-elect，完全 orphan 的 route 则 TTL 后删除。批写器对同 key 的 pending mutation 采用最后写入覆盖，删除不会被旧 pending write 重新引入；后续 route recovery 会明确写入新 assignment。storage-less 模式也保持本地 route 自洽。
- 验证：`pnpm check`（typecheck、build、35 files / 780 tests）通过；`pnpm lint` 通过；`git diff --check` 通过。
- 风险 / 回滚：本轮仅更新审计记录，不改变 public API、worker protocol、storage schema/key 或线协议。
- 下一项：继续执行发布前验证（E2E、bench、打包兼容性）并修复任何实际失败。
- 更新时间：2026-09-16。

## 0.20.92 role/load recovery and degradation audit (2026-09-16)

- 状态：审计完成，未发现需要修改的运行时代码缺陷；同时补强了中途 storage failure 回归测试的真实装配。
- 审计范围：worker role 刷新与 record 写入、assigned-topic load 更新、stranded multi-topic recovery 的 projected load、无本地 subscriber 的 elected owner liveness、storage retry exhaustion 后的 local/coordinated degradation。
- 结论：reconcile 在每轮先清理孤儿记录再刷新 role；load 以本地 assignedTopics 为准并通过即时 registry nudge 传播；recovery pass 使用 projected loads 防止多个 stranded route 堆叠到同一 survivor，并在 elected owner 没有 local subscription 时由当前协调者直接写 route/发送 SUBSCRIBE，避免永远 stand down。storage writer 失败不会抛穿 cluster 控制面，pending writes 按 key 重试并最终丢弃故障 key，内存 assignment/subscription intent 仍可用。
- 测试改进：修正 `keeps the runtime usable when storage writes start failing mid-session`，让 runtime 构造时真正包装 flaky storage 并保持 ChannelHub 协调；fake timers 驱动 retry，避免假阳性。
- 验证：`pnpm exec vitest run tests/cluster.test.ts tests/routing.test.ts tests/storage-batch.test.ts`（3 files，122/122）；全量 `pnpm test --run`（35 files，780/780）；`pnpm typecheck` 和 `git diff --check` 均通过。
- 风险 / 回滚：本轮不改变 public API、worker protocol 或 storage schema/key；测试修正可独立回滚。
- 下一项：继续审计 worker heartbeat TTL、orphan cleanup 与 route recovery 在共享 fake clock / delayed storage flush 下的收敛性。
- 更新时间：2026-09-16。

## 0.20.92 storage degradation regression harness correction (2026-09-16)

- 状态：已完成测试修复与验证。
- 发现：`keeps the runtime usable when storage writes start failing mid-session` 原测试并未覆盖其声称的故障。runtime 构造时包装的是另一份正常 storage，之后替换 `environment.storage` 不会改变已捕获的 adapter；同时未提供 BroadcastChannel hub 会使 activate 主动降级并丢弃 storage。因此测试即使 storage failure 路径失效也会通过。
- 修复：在构造 runtime 时直接传入 flaky storage 和 ChannelHub，使 `BatchingStorageWriter` 实际包装故障 adapter 且协调模式保持启用；用 fake timers 驱动失败 flush/retry，断言后端确实收到失败写尝试，同时本地 topic assignment 和 subscription intent 继续可用。teardown 前恢复 storage，避免测试遗留 retry timer。
- 变更文件：`tests/cluster.test.ts`、`docs/progress.md`。
- 验证：定向回归 1/1；`pnpm exec vitest run tests/cluster.test.ts tests/routing.test.ts tests/storage-batch.test.ts`（3 files，122/122）；`pnpm typecheck`；`git diff --check` 均通过。
- 风险 / 回滚：仅修正测试装配和断言，不改变运行时代码或 public API。回滚 = revert 本任务提交。
- 下一项：继续审计 role/load 更新与 storage retry exhaustion 后的跨 tab 收敛语义，必要时补充双 runtime 故障回归。
- 更新时间：2026-09-16。

## 0.20.92 storage flush and registry nudge visibility audit (2026-09-16)

- 状态：审计完成，未发现需要修改的实现缺陷。
- 审计范围：`BatchingStorageWriter` 的 pending-read 一致性、microtask coalescing、失败重试与单 timer 约束；cluster 在 route/worker/subscriber 写入后发送 REGISTRY nudge 的顺序；pagehide handoff 的显式 flush、route 持久化可见性与 channel 延迟关闭。
- 结论：handoff 会在发送 ROUTE_RELEASED 前显式 flush 新 route 和删除/更新元数据，随后发送 REGISTRY；pagehide 最后再次 flush 并延迟关闭 channel，避免丢弃排队 ACK。writer 的 pending map 对读取立即可见，失败写入按 key 保留并共享指数退避 timer；clear 会同步取消 pending/retry，避免旧写入继续污染新状态。状态/role/load 变化的 nudge 与周期 heartbeat 分离，避免 heartbeat 引起 REGISTRY storm。
- 验证：`pnpm exec vitest run tests/storage-batch.test.ts tests/cluster.test.ts`（2 files，88/88）；`pnpm test --run` 前轮为 35 files、780/780。
- 风险 / 回滚：本轮仅更新审计记录，不改变 public API、worker protocol、存储 schema/key 或线协议。
- 下一项：继续审计 worker role/load 更新与多 topic recovery 的 projected-load 一致性，以及 storage failure degradation 边界。
- 更新时间：2026-09-16。

## 0.20.92 route handoff ownership across rapid lifecycle transitions (2026-09-16)

- 状态：审计完成，未发现需要修改的实现缺陷。
- 审计范围：pagehide/pageshow 快速交错、延迟或丢失 `ROUTE_RELEASED` ACK、旧 owner 回归、handoff route generation、`handoffFromWorkerId` 与 confirmed marker 的所有权校验。
- 结论：graceful handoff 先持久化新 owner 与递增 generation，再释放旧 transport subscription；新 owner 只有收到来源和 generation 均精确匹配的 ACK 才能确认，延迟 ACK 会被 route marker/generation 拒绝。旧 owner 回归只恢复 subscriber intent，不会夺回 sticky route。ACK 丢失时，只有 previous owner 已不存活且 handoff 超过 worker TTL 才允许单 writer re-election；活跃 previous owner 始终保留严格 no-overlap 语义。快速 pagehide/pageshow 由 lifecycle generation 防止旧回调重新 activate，且回归测试覆盖了 ACK 丢失、多轮 handoff 和页面恢复。
- 验证：`pnpm exec vitest run tests/cluster.test.ts`（75/75）；`pnpm test --run`（35 files，780/780）；此前新增的 re-entrant pagehide regression 也通过。
- 风险 / 回滚：本轮仅更新审计记录，不改变 public API、worker protocol、存储 schema/key 或线协议。
- 下一项：继续审计 storage writer 的 registry nudge、flush 顺序与 pagehide handoff 的持久化可见性边界。
- 更新时间：2026-09-16。

## 0.20.92 re-entrant pageshow re-hide ownership (2026-09-16)

- 状态：已完成实现、回归测试与验证。
- 复现场景：cluster 已因 `pagehide` 暂停，随后 `pageshow` 先把 `suspended` 暂时清为 false，再同步调用 `onResume`。若回调期间文档再次触发 `pagehide`，`pause()` 因 cluster 尚未重新 `started` 而直接返回，导致 runtime 落在 `started: false / suspended: false` 的失活状态；后续真正的 `pageshow` 也不会再激活 cluster。
- 修复：`pause()` 在尚未 started 但 lifecycle listeners 仍安装时保留 `suspended: true`，让重入的 pagehide 成为最新生命周期意图；外层 pageshow 由 generation guard 放弃 activate，下一次 pageshow 可正常恢复协调。
- 新增测试：`tests/cluster.test.ts` — `preserves a pagehide re-entered from onResume for the next pageshow`，覆盖 re-hide 后保持 suspended，以及下一次 pageshow 恢复 channel、协调和 topic assignment。
- 验证：定向回归 1/1；`pnpm exec vitest run tests/cluster.test.ts tests/lifecycle-invariants.test.ts`（2 files，76/76）；`pnpm typecheck`；`git diff --check` 均通过。
- 风险 / 回滚：仅修复 cluster lifecycle 的同步重入状态，不改变 public API、worker protocol、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：继续审计 route handoff 在 pagehide/pageshow 快速交错和延迟 ROUTE_RELEASED ACK 下的 generation ownership。
- 更新时间：2026-09-16。

## 0.20.92 replay persistence cleanup serialization audit (2026-09-16)

- 状态：审计完成，未发现需要修改的实现缺陷。
- 审计范围：retention `clearBefore` coalescing、在途 cleanup 跨 suspend/resume 的所有权、旧 generation 的排队 cutoff、persistence retry backoff 取消，以及新生命周期 cutoff 在旧 cleanup unwind 后的接力。
- 结论：`suspend()` 递增 retry generation、清除旧 cutoff 并停止 sweep；旧 cleanup 只能完成已经发出的后端调用，不能继续消费旧队列。若新生命周期在旧 cleanup 占用单一 slot 时产生 cutoff，finally 会把该 cutoff 交给新 generation 的 cleanup。retry loop 在操作前、操作后和 backoff 后均检查 generation，取消会以 `PersistenceRetryCancelledError` 收口且不会继续重试。
- 验证：`pnpm exec vitest run tests/replay-manager.test.ts tests/data-bus.test.ts`（2 files，229/229），覆盖 suspend 后不运行排队 cleanup、resume 后接力最新 cutoff、retry cancellation、retention timer 停止及 DataBus 生命周期集成。
- 风险 / 回滚：本轮仅更新审计记录，不改变 public API、worker protocol、存储 schema/key 或线协议。
- 下一项：继续审计 cluster pageshow/onResume 同步重入和 route handoff 跨暂停生命周期的所有权边界。
- 更新时间：2026-09-16。

## 0.20.92 RESUME/pageshow and replay hydration audit (2026-09-16)

- 状态：审计完成，未发现需要修改的实现缺陷。
- 审计范围：显式 `start()` 与原生 `pageshow` 的 RESUME trace 同步重入；RESUME 回调触发 `stop()` 后的 cluster/transport 复活；replay hydration 在 `pagehide`、显式恢复、重复 `start()`、clear/unsubscribe 与 live record 交错时的 epoch、retry generation 和缓冲区归属。
- 结论：RESUME trace 发出前捕获 lifecycle epoch，回调返回后再次校验 epoch/stopping，避免旧恢复流程重启 cluster；ReplayManager 在 suspend/reset/clear 时使 hydration epoch 或 retry generation 失效，旧 load 不能覆盖新一代 hydration 或清除后的 buffer；已完成 hydration 在普通 BFCache suspend 中保留，显式 stop 则 reset buffers 并要求下一生命周期重新加载。
- 验证：现有 RESUME/pageshow 重入回归与 hydration 回归均覆盖；此前全量 `pnpm test --run` 为 35 files、779/779。
- 风险 / 回滚：本轮仅更新审计记录，不改变 public API、worker protocol、存储 schema/key 或线协议。
- 下一项：继续审计 replay persistence cleanup 与 suspend/resume、失败重试之间的串行化边界。
- 更新时间：2026-09-16。

## 0.20.92 reopen settlement and recovery gate audit (2026-09-16)

- 状态：审计完成，未发现需要修改的实现缺陷。
- 审计范围：`reopenTransport()` 在同步 `CONNECTING` 回调触发 `stop()`/生命周期 supersession 时的 opening settlement；`createStopPromise()`、`suspendTransport()` 与 `performStop()` 之间的 stop rejection 归档及重复报告；recovery gate waiter 在取消、重建、自动恢复失败和 demand-driven recovery 之间的代际一致性。
- 结论：当前实现先安装 `startPromise` 与 lifecycle epoch，再发送 `CONNECTING`，因此同步回调触发的 stop 能安全取得同一 opening；epoch guard 会在 `transport.start()` 前放弃旧 opening。stop cleanup 通过 `pendingStop` 单一 gate 串行化，只有拥有 stop 调用的路径报告 rejection；recovery waiter 捕获 gate promise 与 cancellation token，gate 重建不会误放行旧 waiter。
- 验证：`pnpm test --run`（35 files，779/779）；既有回归覆盖包括 `lets a stop() from the reconnect CONNECTING callback cancel the reopen`、`stops once when an explicit stop follows a failed-open cleanup`、`reuses a failed-reopen stop gate when the tab hides before cleanup settles`、`reuses an in-flight recovery reopen instead of opening a second transport`。
- 风险 / 回滚：本轮仅更新审计记录，不改变 public API、worker protocol、存储 schema/key 或线协议。
- 下一项：继续审计 `RESUME/pageshow` 同步回调重入与 replay hydration 生命周期交错。
- 更新时间：2026-09-16。

## 0.20.92 stop failure recovery ledger (2026-09-16)

- 状态：已合并（PR #95，rebase merge 至 `main@db45d3a`）。
- 分支 / PR / 合并：`feat/stop-failure-ledger-order` ← `origin/main@fd54e35`；PR #95（https://github.com/Sun1090/cross-tab-worker-databus/pull/95），合并提交 `db45d3a`（`fix(data-bus): retain stop failures in recovery ledger`）。
- 复现场景：`transport.stop()` 被拒绝时，`performStop()` 先经 `reportError()` 将失败写入统一的 `lastFailure` 和 recovery 账本，但 `finally` 随即只清空 `lastError` / `lastErrorAt`。结果是同一个 `getHealthSummary()` 快照同时报告 `lastFailure.message === "transport stop failed"` 与 `recovery.hasError === false`、`errorMessage === null`，违反两个账本共享失败生命周期的文档契约。
- 修复：teardown 不再单独清除 recovery 账本；失败保留在 `lastFailure` 与 recovery 账本中，直到下一次显式 `start()` 调用 `resetFailureState()` 同时清除两者。`stop()` 仍会 resolve，并继续通过 `onError` 报告失败。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 新增测试：扩展 `tests/data-bus.test.ts` 的 `resolves stop() and reports through onError when the transport stop rejects`，断言 stop rejection 后 `recovery.hasError === true`、`errorMessage === "transport stop failed"`，且 `errorAt` 与 `lastFailure.at` 一致。
- Mutation check：保留旧实现时，新断言稳定失败于 `errorAt` / `errorMessage` / `hasError` 与错误账本不一致；恢复修复后定向测试通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts -t "resolves stop\(\) and reports through onError when the transport stop rejects"`（1/1）；`pnpm exec vitest run tests/data-bus.test.ts tests/lifecycle-invariants.test.ts`（2 files，173/173）；`pnpm check`（35 files，779/779，含 typecheck/build/unit）；`pnpm lint`（通过）；`pnpm test:coverage`（35 files，779/779；statements 97.69% / branches 93.99% / functions 98% / lines 98.95%；`data-bus.ts` 97.27% / 95.21% / 95.04% / 98.48%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`pnpm test:e2e`（27/27，45.1s）；`git diff --check`（通过）。PR checks：`analyze`、`verify`、`browser`、CodeQL 全部通过。
- 阻塞：无。
- 风险 / 回滚：仅修复 stop rejection 后两个失败账本的生命周期一致性，不改变 public API、worker protocol、存储 schema/key 或线协议。显式 `start()` 仍是清除边界；若发现 teardown 失败应在后续生命周期中更早清除，回滚 = revert 合并提交 `db45d3a`。
- 下一项：继续审计 `reopenTransport()` 在同步 CONNECTING 回调触发 supersession 时的 opening settlement，以及 duplicate stop-failure reporting / recovery gate waiter 串代边界。
- 更新时间：2026-09-16。

## 0.20.92 manual recovery parked-operation preservation (2026-09-16)

- 状态：已合并（PR #93，rebase merge 至 `main@1f2eed8`）。
- 分支 / PR / 合并：`feat/parked-ops-manual-recovery` ← `origin/main@314adca`；PR #93（https://github.com/Sun1090/cross-tab-worker-databus/pull/93），合并提交 `1f2eed8`（`fix(data-bus): preserve parked operations across manual recovery`）。
- 复现场景：transport 运行期进入 `error` 后自动恢复已调度、recovery gate 关闭，此时 `publish()` 停靠在 gate 上。显式 `start({})` 取代自动 timer，但 replacement transport 的启动也失败；旧实现会在 `resetFailureState()` 中释放 gate，停靠操作的微任务随后看到新的 opening 已开始，却既没有成功 transport 可写，也没有资格继续等待，最终操作被静默丢弃。
- 修复：显式手动重开时调用 `resetFailureState(true)`，取消旧 timer 并重置失败账本，但保留 recovery gate；`cancelScheduledRecovery()` 增加可选的 `releaseGate` 控制。若手动重开成功仍按原路径释放 gate 并回放操作；若手动重开失败，停靠操作继续等待下一次自动或 demand-driven 恢复，不再与被取代的 opening 一起丢失。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/capabilities.md`、`docs/zh/capabilities.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 新增测试：`tests/data-bus.test.ts` — `preserves operations parked on a recovery gate when an explicit start supersedes the automatic attempt`。测试断言 error 后停靠的 publish 不会立即发送，显式 start 失败后仍保留；500 ms 后自动恢复成功且 publish 恰好发送一次。
- Mutation check：将生产修复临时改回 `resetFailureState()` 时，新回归稳定失败于 `expected [] to have a length of 1 but got 0`；恢复修复后通过。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts tests/lifecycle-invariants.test.ts tests/cluster.test.ts`（3 files，247/247）；`pnpm check`（35 files，779/779）；`pnpm lint`（通过）；`pnpm test:coverage` 单独运行（35 files，779/779；statements 97.69% / branches 93.99% / functions 98% / lines 98.95%；`data-bus.ts` 97.28% / 95.21% / 95.04% / 98.49%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`pnpm test:e2e`（27/27）；`git diff --check` 通过。PR checks：`analyze`、`verify`、`browser`、CodeQL 全部通过。
- 阻塞：无。
- 风险 / 回滚：仅调整显式手动恢复与自动 timer 交替时 recovery gate 的生命周期，不改变 public API、worker protocol、存储 schema/key 或线协议。手动重开成功路径行为不变；若手动重开失败，停靠操作会保留而非丢弃。若发现操作被错误保留或重复回放，回滚 = revert 合并提交 `1f2eed8`。
- 下一项：继续审计 failed startup 与异步 stop rejection 的统一账本顺序，以及同步 CONNECTING callback 与 open promise settlement 之间的 supersession；随后检查 duplicate stop-failure reporting 与 recovery gate 串代边界。
- 更新时间：2026-09-16。

## 0.20.92 parked recovery cancellation (2026-09-16)

- 状态：已合并（PR #91，rebase merge 至 `main@8a1c911`）。
- 分支 / PR / 合并：`feat/parked-recovery-cancellation` ← `origin/main@3ea4a90`；PR #91（https://github.com/Sun1090/cross-tab-worker-databus/pull/91），合并提交 `8a1c911`（`fix(data-bus): cancel parked recovery operations on suspend`）。
- 复现场景：transport 运行期进入 `error` 后自动恢复被调度，recovery gate 关闭；此时 `subscribe('topic-2')` 停靠在 gate 上。随后 `pagehide()` 取消 recovery，再立即显式 `start({})`。新生命周期会清除 `suspended` 并在 replacement transport 上重订阅 `topic` 与 `topic-2`，但旧 waiter 的 continuation 稍后仍看到 `stopping === false` / `suspended === false`，于是再次订阅 `topic-2`，产生重复订阅。
- 修复：新增单调 `recoveryCancellationToken`。`runTransport()` 的停靠 waiter 捕获创建时的 token；`beginStop()` 与 `suspendTransport()` 通过 `cancelScheduledRecovery(true)` 在取代恢复周期时递增 token。waiter 释放后除检查 stopping/suspended 外，还必须仍持有当前 token，旧恢复周期中的操作因此被丢弃，不能重放到 replacement transport。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/capabilities.md`、`docs/zh/capabilities.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 新增测试：`tests/data-bus.test.ts` — `drops a parked recovery operation when pagehide and an immediate explicit start supersede it`。测试在 error 后停放第二个订阅，记录重连前调用，然后 pagehide + 显式 start；断言 replacement 连接对 `topic` 与 `topic-2` 各恰好订阅一次。
- Mutation check：仅移除 waiter 中的 `cancellationToken !== this.recoveryCancellationToken` 守卫后，回归稳定失败于 `expected [ 'topic-2', 'topic-2' ] to have a length of 1 but got 2`；恢复修复后定向测试通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts tests/cluster.test.ts tests/lifecycle-invariants.test.ts tests/documentation.test.ts`（4 files，263/263）；`pnpm check`（35 files，778/778）；`pnpm lint`（通过）；`pnpm test:coverage` 单独运行（35 files，778/778；statements 97.69% / branches 93.92% / functions 98% / lines 98.95%，`data-bus.ts` 97.26% / 94.91% / 95.04% / 98.49%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`pnpm test:e2e`（27/27）；`git diff --check` 通过。PR checks：`analyze`、`verify`、`browser`、CodeQL 全部通过。
- 阻塞：无。
- 风险 / 回滚：仅新增内部恢复代次并在 stop/pagehide 取代恢复周期时使停靠 waiter 失效，不改变 public API、worker protocol、storage schema/key 或线协议；正常成功重开、失败后的 demand reopen、预算耗尽与显式重试路径保持不变。若出现恢复期间操作被误丢弃，回滚 = revert 合并提交 `8a1c911`。
- 下一项：继续审计 recovery gate 的 waiter 计数在 gate 被取消又重建时是否可能串代，以及 failed startup 与异步 stop rejection 的统一账本顺序。
- 更新时间：2026-09-16。

## 0.20.92 SUBSCRIBE route binding (2026-09-16)

- 状态：已合并（PR #89，rebase merge 至 `main@82cf127`）。
- 分支 / PR / 合并：`feat/subscribe-route-binding` ← `origin/main@2c36eab`；PR #89（https://github.com/Sun1090/cross-tab-worker-databus/pull/89），合并提交 `82cf127`（`fix(cluster): bind subscribe to current route`）。
- 复现场景：durable route 已指向另一 worker，或当前 route 正等待某个 `handoffFromWorkerId` 的精确 `ROUTE_RELEASED` 时，迟到/重放的定向 `CONTROL/SUBSCRIBE` 仍会被旧实现接受。非 owner 会进入 `assignedTopics` 并订阅 transport；等待交接的 owner 会提前进入 `assignedTopics` 并给 route 盖上 `confirmedAt`，从而在匹配 ACK 到达前重新制造 transport 订阅重叠。
- 修复：`WorkerClusterRuntime.handleControlMessage()` 的 `SUBSCRIBE` 分支现在先绑定 durable route。route 指向其他 worker 时忽略；当前 worker 的 route 带有 `handoffFromWorkerId` 且尚无 `confirmedAt` 时，只有匹配 generation 的 `ROUTE_RELEASED` 能授权；其余正常同 route 订阅路径保持不变。
- 变更文件：`src/core/cluster.ts`、`tests/cluster.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/capabilities.md`、`docs/zh/capabilities.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 新增测试：`tests/cluster.test.ts` — `ignores a stale CONTROL/SUBSCRIBE while a handoff is awaiting ROUTE_RELEASED` 证明迟到 SUBSCRIBE 不增加 assignment/不确认 handoff，随后 matching generation 2 的 `ROUTE_RELEASED` 仍可确认并订阅；`ignores a CONTROL/SUBSCRIBE when the route now names another worker` 证明 route 指向 worker-c 时 worker-b 不获得 ownership，后续 route 回到 worker-b 并收到新 SUBSCRIBE 后仍可正常工作。
- Mutation check：两条回归在旧实现上分别稳定失败于 `expected [...] to not include ...`；绑定 durable route 后通过。
- 验证命令与结果：`pnpm check`（35 files，777/777）；`pnpm lint`（通过）；`pnpm test:coverage`（statements 97.69% / branches 93.91% / functions 98% / lines 98.95%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`pnpm test:e2e`（27/27）；`git diff --check` 通过。PR checks：`analyze`、`verify`、`browser`、CodeQL 全部通过。
- 阻塞：无。
- 风险 / 回滚：只收紧 cluster 对定向 SUBSCRIBE 的准入判定，不改变 public API、消息协议、storage schema/key 或线协议。正常同 route 的 SUBSCRIBE、首次路由和精确 generation 的交接 ACK 路径保持不变。若出现订阅恢复回归，回滚 = revert 合并提交 `82cf127`。
- 下一项：继续审计 recovery 操作跨 `pagehide`/显式 `start()` 的状态归属、失败启动与异步 stop 的错误账本顺序，以及 reopen 回调相邻的剩余竞态。
- 更新时间：2026-09-16。

## 0.20.92 queued restart BFCache guard (2026-09-16)

- 状态：已合并（PR #87，rebase merge 至 `main@ef7b474`）。
- 分支 / PR / 合并：`feat/queued-restart-bfcache-race` ← `origin/main@1ef80b9`；PR #87，合并提交 `ef7b474`（`fix(cluster): keep queued restart suspended in BFCache`）。
- 复现场景：bus 已启动后调用 `stop()`，其异步 `transport.stop()` 仍 pending；随后调用 `start()`，重启被排队在该 stop 之后。在清理窗口内页面进入 BFCache / `visibilityState === 'hidden'` 且触发 `pagehide`。旧的 `WorkerClusterRuntime.stop()` 已同步移除 lifecycle listener，因此排队重启看不到隐藏事件，stop 结算后仍会为后台页面打开新 transport。
- 修复：`WorkerClusterRuntime.start()` 改为先安装 lifecycle listener，再检查 `getVisibilityState()`；若文档已隐藏，只记录 `suspended` 并触发 `onSuspend`，不注册 worker、不创建 channel、不启动 heartbeat。后续 `pageshow` 由已安装的 listener 正常恢复，因此隐藏页面不会被后台重连。
- 变更文件：`src/core/cluster.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `keeps a queued restart suspended when pagehide lands during async stop cleanup`。覆盖 start → async stop → queued start → hidden/pagehide → release stop，断言在页隐藏期间 transport 没有第二次启动、健康状态为 `suspended`、`ready()` reject；随后 `pageshow` 恢复为 healthy，transport 总启动次数恰好为 2。
- Mutation check：回归测试先在旧实现上稳定失败于 `expected 2 to be 1`；加入 visibility guard 后通过。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts tests/cluster.test.ts tests/lifecycle-invariants.test.ts`（243/243）；`pnpm check`（35 files，775/775）；`pnpm lint`（通过）；`pnpm test:coverage`（35 files，775/775；statements 97.68% / branches 93.88% / functions 98% / lines 98.94%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`pnpm test:e2e`（27/27）；`git diff --check` 通过。PR checks：`analyze`、`verify`、`browser`、CodeQL 全部通过。
- 阻塞：无。
- 风险 / 回滚：只改变 cluster 对隐藏文档的首轮启动判定，不改变 public API、消息协议、storage schema/key。正常可见文档启动路径不变；隐藏文档将等待 `pageshow` 或显式 `start()`。回滚 = revert 合并提交 `ef7b474`。
- 下一项：继续审计 `resume` / `reopen` recovery 交错、排队 lifecycle 操作的剩余边界，以及 route ownership / handoff 跨 runtime 的其他竞态。
- 更新时间：2026-09-16。

## 0.20.92 strict route-release generation guard (2026-09-16)

- 状态：已合并（PR #85，rebase merge 至 `main@463a6e6`）。
- 分支 / PR / 合并：`feat/route-release-generation-guard` ← `origin/main@2c84f8a`；PR #85，合并提交 `463a6e6`（`fix(cluster): require exact handoff generation`）。
- 复现场景：当前 route 为 `worker-b`、`generation: 2`、`handoffFromWorkerId: 'worker-a'` 且尚未确认时，投递来自 `worker-a`、但携带 `generation: 3` 的 `ROUTE_RELEASED`。旧实现使用 `message.generation < route.generation`，会把其他交接轮次的迟到/重放 ACK 误当作当前授权：`worker-b` 进入 `assignedTopics`、发送 `SUBSCRIBE`，并给当前 route 盖上 `confirmedAt`，破坏严格交接的无重叠保证。
- 修复：`isStaleRouteRelease()` 改为要求 ACK generation 与当前 route 精确相等；同步修正代码注释与中英文架构文档、capability matrix，使实现和“matching generation”协议一致。
- 变更文件：`src/core/cluster.ts`、`tests/cluster.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/capabilities.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/cluster.test.ts` — `rejects a ROUTE_RELEASED whose generation is newer than the current handoff`，断言不进入 `assignedTopics`、不触发 `SUBSCRIBE`、route 保持 `generation: 2` 且无 `confirmedAt`。
- Mutation check：新增回归在旧 `<` 比较下稳定失败于 `expected [ 'generation-guard' ] to not include 'generation-guard'`；恢复 `!==` 后包含 matching-generation 正常 ACK 路径的 4 条定向用例全部通过。
- 验证命令与结果：`pnpm exec vitest run tests/cluster.test.ts tests/data-bus.test.ts`（241/241）；`pnpm check`（35 files，774/774）；`pnpm lint`；`pnpm test:coverage`（35 files，774/774；statements 97.61% / branches 93.77% / functions 98% / lines 98.94%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`pnpm test:e2e`（27/27）；`git diff --check` 均通过。PR checks：`analyze`、`verify`、`browser`、CodeQL 全部通过。
- 阻塞：无。
- 风险 / 回滚：只收严 `ROUTE_RELEASED` 的授权条件；正常精确 generation 交接不变，不改变 public API、worker protocol 字段、存储 schema/key 或线协议。回滚 = revert 合并提交 `463a6e6`。
- 下一项：继续审计 `resume` / `reopen` recovery 交错、queued start 与 pending stop 的剩余边界，以及 route ownership / handoff 跨 runtime 的其他竞态。
- 更新时间：2026-09-16。

## 0.20.92 replay hydration lifecycle races (2026-09-16)

- 状态：已合并（PR #83，rebase merge 至 `main@88ae3b0`）。
- 分支 / PR / 合并：`feat/replay-hydration-lifecycle-races` ← `origin/main@bf6f369`；PR #83，合并提交 `88ae3b0`（`fix(replay): make hydration replaceable across lifecycle`）。
- 复现场景：durable replay 的异步 `load()` 尚未完成时，若业务调用 `clearReplay()`、`clearReplayTopic()`、退订最后一个 handler 或 `clearReplayBefore()`，旧快照 resolve 后仍会把已清除历史写回内存 ring；显式 stop/start 还会复用已经完成或失败的 constructor hydration，导致重新启动后不再加载 durable history。suspend 后立即 start 时，旧 load 也可能覆盖新一代 hydration。
- 修复：`ReplayManager` 的 hydration 从不可变 constructor promise 改为可替换的 lifecycle operation，并增加 hydration epoch / completion / failure 状态。clearAll、clearTopic、unsubscribe、clearBefore 会在等待中的快照应用 mutation 过滤；suspend/reset 会使旧 load 失效并允许 `start()` 发起新一代 hydration；旧 load 的结果、错误与 finally 均不能清除或覆盖 replacement。clear 操作仍保留原有 retry、错误上报与 rethrow 语义。
- 变更文件：`src/core/replay-manager.ts`、`tests/replay-manager.test.ts`、`CHANGELOG.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 新增测试：`tests/replay-manager.test.ts` — `does not repopulate buffers when hydration resolves after clearAll`、`does not repopulate a cleared topic when hydration resolves later`、`does not repopulate an unsubscribed topic after hydration resolves`、`does not re-add entries pruned by clearBefore while hydration is pending`、`rehydrates when start resumes before an in-flight hydration settles`、`rehydrates durable history after an explicit stop/start cycle`。
- Mutation check：修复前四条 clear/unsubscribe 回归分别观察到已清除 history 被写回；将 `hydrationClearBefore` 快照过滤条件移除后，新增 `clearBefore` 回归稳定收到 `[1, 2]` 而非期望的 `[2]`；恢复生产守卫后定向 57/57 通过。
- 验证命令与结果：`pnpm exec vitest run tests/replay-manager.test.ts`（57/57）；`pnpm check`（35 files，773/773）；`pnpm lint`；`pnpm test:coverage`（35 files，773/773；statements 97.61% / branches 93.77% / functions 98% / lines 98.94%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`pnpm test:e2e`（27/27）；`git diff --check` 均通过。PR checks：`analyze`、`verify`、`browser`、CodeQL 全部通过。
- 阻塞：无。
- 风险 / 回滚：仅调整 replay hydration 生命周期与 mutation 合并，不改变 public API、worker protocol、存储 schema/key 或线协议。无并发 clear/restart 时结果不变；回滚 = revert 合并提交 `88ae3b0`。
- 下一项：继续可靠性审计 `resume` / `reopen` recovery 交错、queued start 与 pending stop 的剩余边界，以及 route handoff / ownership 跨 runtime 竞态。
- 更新时间：2026-09-16。

## 0.20.92 replay hydration ordering (2026-09-16)

- 状态：已合并（PR #81，rebase merge 至 `main@7ce5379`）。
- 分支 / PR / 合并：`feat/replay-hydration-order` ← `origin/main@3a58bd5`；PR #81，合并提交 `7ce5379`（`fix(replay): preserve live order during hydration`）。
- 复现场景：durable replay 的异步 `load()` 尚未完成时，本地已经 `record()` 了一条新 publication。旧 hydration 在 resolve 后把已加载历史追加到现有 live buffer 尾部，使旧历史反而成为“最新”条目；当 `maxPerTopic` 为 1 时，数量裁剪会删除刚产生的实时消息并保留旧历史。
- 修复：`ReplayManager.hydrate()` 先按 topic 收集 durable snapshot，再将它放在 hydration 期间已存在的 live tail 之前，最后统一执行 retention/count pruning。持久历史保持原始顺序，实时消息保持原始顺序，并始终被视为更新的尾部。
- 变更文件：`src/core/replay-manager.ts`、`tests/replay-manager.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/replay-manager.test.ts` — `keeps publications recorded during hydration newer than loaded history`，用延迟 resolve 的 `load()` 在 hydration 期间写入 live 消息，并将上限设为 1，断言 replay 得到 live 消息而不是 durable 旧消息。
- Mutation check：恢复旧的“把 loaded 追加到现有 buffer 后直接 prune”逻辑后，新测试稳定收到 `[1]`（旧历史）并期望 `[2]`（live 消息）；恢复修复后定向 51/51 通过。
- 验证命令与结果：`pnpm check`（35 files，767/767）、`pnpm lint`、`pnpm test:coverage`（35 files，767/767；statements 97.77% / branches 94% / functions 98% / lines 99.04%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：只调整 hydration 合并顺序，不改变 persistence 接口、存储 schema/key、public API 或 wire protocol；正常无并发记录的 hydration 结果不变。回滚 = revert 本任务提交。
- 下一项：继续审计 hydration 在 clear/unsubscribe/suspend/restart 交错下的取消与重新加载语义。
- 更新时间：2026-09-16。

## 0.20.92 stale suspend continuation cancellation (2026-09-16)

- 状态：已合并（PR #79，rebase merge 至 `main@3a58bd5`）。
- 分支 / PR / 合并：`feat/data-bus-suspend-reentrancy` ← `origin/main@fff5317`；PR #79，合并提交 `3a58bd5`（`fix(data-bus): abandon stale suspend on reentrant start`）。
- 复现场景：已连接的数据总线触发 `pagehide` 时，`suspendTransport()` 先同步发布 `DISCONNECTED` 状态，再安排 transport stop。若 `onStatus(DISCONNECTED)` 按公开恢复路径立即调用 `start({})`，新的 opening 会被安装并让 transport 恢复连接；但旧 `suspendTransport()` 调用栈返回后仍继续把 stop 链到该 opening 上，随后关闭刚恢复的 transport。由于 `transportReady` 可能已被新 opening 标记为 true，总线还会错误报告 `healthy`。
- 修复：`suspendTransport()` 记录本次 suspend 的 lifecycle epoch，并在同步 `updateStatus(DISCONNECTED)` 返回后确认它仍拥有 suspend、未进入 stopping 且计划未被显式 start/pageshow 接管；否则立即放弃旧 stop 续体，由更新的生命周期处理 transport。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `lets start() from the suspend status callback supersede the pending hide`，在 `pagehide` 的同步 DISCONNECTED 回调中调用 `start()`，等待完整微任务链后断言 replacement 只启动一次、未被旧 suspend 停止，且健康状态为 `healthy` / `ready` / `suspended: false`。
- Mutation check：修复前回归在排空 stop 续体后稳定观察到 `transport.stopCalls === 1`（预期 0）；加入 epoch/still-suspended guard 后通过，证明旧 hide 续体确实会错误拆除 replacement。
- 验证命令与结果：`pnpm check`（35 files，766/766）、`pnpm lint`、`pnpm test:coverage`（35 files，766/766；statements 97.76% / branches 93.99% / functions 98% / lines 99.04%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅让 suspend 续体在同步状态回调已接管生命周期时退出，不改 public API、worker protocol、存储 schema/key 或线协议；无重入的正常 pagehide 仍按原路径停止 transport。回滚 = revert 本任务提交。
- 下一项：继续审计 `resumeTransport()` / `reopenTransport()` 与恢复 timer、queued start、pending stop 的剩余可达交错。
- 更新时间：2026-09-16。

## 0.20.92 park operations behind every demanded transport reopen (2026-09-16)

- 状态：已合并（PR #77，rebase merge 至 `main@40a2ef0`）。
- 分支 / PR / 合并：`feat/data-bus-reopen-sync-readiness` ← `origin/main@6454d35`；PR #77，合并提交 `40a2ef0`（`fix(data-bus): park operations during demanded reopen`）。
- 复现场景：一个已连接的 transport 先报告 `disconnected`，随后同一 tick 内连续发出两次 `publish()`。第一次操作发现连接已掉线并调用 `reopenTransport()`；该函数同步把状态改为 `CONNECTING`，但 `transportReady` 仍短暂保持 `true`，直到 `openTransport()` 在 microtask 中运行才被清空。第二次操作因此把 `CONNECTING` 误判为仍可用的 transport，绕过 `startPromise` 直接写入已经关闭的连接；随后第一次操作才在 replacement 打开后投递，导致丢失风险和跨连接顺序反转。
- 修复：`reopenTransport()` 在同步发出 `CONNECTING` 回调前先清空 `transportReady`。已在 opening 中排队的操作仍由 `startPromise` 统一放行；同 tick 后续操作会继续停靠，不再触碰旧连接。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `parks every operation behind a demanded reopen instead of writing to the closed connection`，在 clean disconnect 后连续发布 1、2，断言 replacement 打开前没有 transport 写入，且最终仍按 `[1, 2]` 顺序投递。
- Mutation check：修复前新回归稳定观察到 `[{ data: 2 }]` 已写入关闭连接（第一次断言失败）；清空 `transportReady` 后通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts`（168/168）通过；`pnpm check`（35 files，765/765）、`pnpm lint`、`pnpm test:coverage`（35 files，765/765；statements 97.76% / branches 93.98% / functions 98% / lines 99.04%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅调整 `reopenTransport()` 的同步就绪状态与既有 opening gate 配合，不改 public API、worker protocol、存储 schema/key 或线协议；恢复成功后仍由 `openTransport()` 标记 ready 并释放操作。回滚 = revert 本任务提交。
- 下一项：继续审计 manual start/recovery 与 queued-start/pending-stop 交错的同步就绪边界。
- 更新时间：2026-09-16。

## 0.20.92 replay retention cleanup across suspend (2026-09-16)

- 状态：实现与完整验证完成，待提交、推送和 PR。
- 分支 / 基线：`feat/replay-retention-across-suspend` ← `origin/main@0d705e7`。
- 复现场景：`ReplayManager` 的 retention cleanup 正在执行时发生 `suspend()`，旧 cleanup 完成后 resume 并产生新的 cutoff；新 cutoff 会设置 `retentionCutoff`，但因旧 `retentionCleanup` 仍占用单一 in-flight slot 而只能排队等待。旧 cleanup 的 `.finally()` 仅在 generation 未变化时重调度，因此 suspend 已提升 generation 后会直接丢弃新 cutoff，直到未来某次无关记录才可能再次清理。
- 修复：旧 cleanup 在清空 in-flight slot 后，只要仍有 `retentionCutoff` 就交给新一轮 `scheduleRetentionCleanup()`；新一轮使用当前 generation，因此 suspend 取消旧代工作的契约不变，resume 后已排队的最新 cutoff 会继续执行。
- 变更文件：`src/core/replay-manager.ts`、`tests/replay-manager.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/replay-manager.test.ts` — `runs the newest cleanup queued after resume behind an in-flight suspend cleanup`，阻塞旧 cleanup、suspend/resume 后排队新 cutoff，并断言旧事务释放后新 cutoff 仍会执行。
- Mutation check：修复前同一回归稳定得到 `[9000, 9000]` 而非 `[9000, 9000, 10000]`，证明新 cutoff 确实被丢弃；修复后通过。
- 验证命令与结果：`pnpm check`（35 files，764/764）、`pnpm lint`、`pnpm test:coverage`（35 files，764/764；statements 97.76% / branches 93.98% / functions 98% / lines 99.04%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅修改 retention cleanup 的跨 lifecycle 重调度，不改 public API、worker protocol、存储 schema/key 或线协议；suspend 仍会清空 cutoff 并取消旧 generation，不影响已覆盖的「suspend 后不得继续 cleanup」契约。回滚 = revert 本任务提交。
- 下一项：继续审计 replay persistence 在 suspend/resume、失败重试与清理串行化上的剩余可达边界。
- 更新时间：2026-09-16。

## 0.20.92 cluster-key isolation regression (2026-09-16)

- 状态：已合并（PR #75，rebase merge 至 `main@0d705e7`）。
- 分支 / PR / 合并：`feat/cluster-key-isolation-regression` ← `origin/main@5b589ed`；PR #75，合并提交 `0d705e7`（`test(cluster): pin cluster-key isolation`）。
- 覆盖缺口：AGENTS.md 与架构文档承诺不同 `clusterKey` 使用完全隔离的 storage 与 BroadcastChannel 命名空间，但此前没有专门回归同时证明「同 topic 可独立归属」「publication 不跨界」「持久化 key 使用不同 opaque hash 且不含明文」。
- 变更：新增 `tests/cluster.test.ts` 双 runtime 回归，共享 `MemoryStorage` 与 `ChannelHub`，分别以 `tenant-alpha` / `tenant-beta` 启动并订阅同一 topic。断言两边各自拥有该 topic、snapshot 只包含本租户 worker、alpha 的 `publish()` 只到达 alpha 的 control handler，以及所有 storage key 分别位于两个不同的 `createOpaqueKey` 命名空间下且不泄露明文 clusterKey。
- 变更文件：`tests/cluster.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- Mutation check：临时把 beta runtime 的 `clusterKey` 改成 `tenant-alpha` 后，新回归因 beta 不再独立拥有 `shared-topic` 稳定失败；恢复后定向 `tests/cluster.test.ts tests/data-bus.test.ts` 238/238 通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/cluster.test.ts tests/data-bus.test.ts`（238/238）通过；`pnpm check`（35 files，763/763）、`pnpm lint`、`pnpm test:coverage`（35 files，763/763；statements 97.73% / branches 93.88% / functions 98% / lines 99%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅新增测试与文档，不改 runtime、public API、worker protocol、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：继续审计持续增长中的持久化清理生命周期，优先处理 suspend/resume 边界。
- 更新时间：2026-09-16。

## 0.20.92 pending demand recovery after failed automatic attempt (2026-09-16)

- 状态：已合并（PR #74，rebase merge 至 `main@5b589ed`）。
- 分支 / PR / 合并：`feat/data-bus-pending-demand-recovery` ← `origin/main@a2e91c1`；PR #74，合并提交 `5b589ed`（`fix(data-bus): drain operations parked when automatic recovery fails`）。
- 复现场景：transport 运行期报 `error` 后进入自动恢复 cooldown，一个 `publish()` 到达并停在 `recoveryGate`。当随后的自动恢复尝试失败时，`allowDemandRecovery()` 仅把 `recoveryDemandAllowed` 置为 true 并保持 gate 关闭，但已经停靠的 waiter 本身不会被唤醒，也不会有任何后续操作替它触发 demand reopen。该操作因此永久滞留、既不发送也不报错，除非之后恰好又有一次无关的 transport 操作到来。
- 修复：新增 `recoveryWaiters` 计数跟踪停靠在 gate 上的操作，并抽出 `startDemandRecovery()` 作为唯一的一次性 demand reopen 入口。自动尝试失败时调用 `allowDemandRecovery(true)`：若仍有 waiter 停靠，立即发起一次 demand reopen，使已发出的操作自身成为 demand，而不是等待未来某个无关操作。demand reopen 自身失败时以 `allowDemandRecovery()`（`kickParkedWaiters=false`）重新武装 flag，避免在自身失败上自循环，仍保留「后续操作再试一次」的既有契约。成功时 gate 释放，全部 waiter 按 FIFO 顺序 flush。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `retries an operation that was already queued when automatic recovery fails`（停靠操作在自动尝试失败后仍驱动一次 demand reopen 并成功投递）与 `issues a single demand reopen for multiple operations parked behind a failed automatic attempt`（三个停靠操作只触发一次 reopen，全部按序 flush）。
- Mutation check：把自动失败处理回退为 `allowDemandRecovery()`（不 kick 停靠 waiter）后，两条回归均稳定失败（`transport.startCalls` 为 2 而非 3）；恢复修复后通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts tests/cluster.test.ts`（236/236）通过；完整验证见下方门禁清单。
- 阻塞：无。
- 风险 / 回滚：仅新增内部 waiter 计数与一次性 demand reopen helper，不改 public API、worker protocol、存储 schema/key 或线协议；既有 `allowDemandRecovery()`/`runTransport()` 行为与超时/耗尽/挂起释放契约保持。回滚 = revert 本任务提交。
- 下一项：继续审计 recovery gate 与 queued-start/pending-stop 的剩余可执行边界。
- 更新时间：2026-09-16。

## 0.20.92 re-entrant RESUME lifecycle cancellation (2026-09-16)

- 状态：已合并（PR #73，rebase merge 至 `main@a2e91c1`）。
- 分支 / PR / 合并：`feat/data-bus-resume-reentrant-stop` ← `origin/main@4123759`；PR #73，合并提交 `a2e91c1`（`fix(data-bus): honor reentrant stop during resume`）。
- 复现场景：页面处于 BFCache suspension 时，显式 `start({})` 或原生 `pageshow` 进入 resume；同步 RESUME lifecycle trace sink 立即调用 `stop()`。旧实现会在 stop 完成 teardown 后继续重启 dedup/replay，或由外层 `pageshow` 再次 `activate()` cluster，最终可能出现 bus 报告 `stopped`、但 cluster 仍 coordinated 的矛盾状态。
- 修复：`resumeSuspendedResources()` 现在返回本次 resume 是否仍拥有 lifecycle；显式 `start()` 在 RESUME 回调抢占后直接返回 stop gate，并在 `reopenTransport()` 的同步 CONNECTING 边界后再次确认 `stopping`/`suspended` 才恢复 cluster。`WorkerClusterRuntime` 增加内部 lifecycle generation，`stop()`、`pause()`、`start()` 与 `pageshow` 都会推进该代次，外层 `handlePageShow()` 只有在同步 `onResume` 回调返回后仍持有同一代次时才调用 `activate()`。
- 变更文件：`src/core/data-bus.ts`、`src/core/cluster.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `lets a stop() re-entered from the RESUME trace cancel the rest of an explicit resume` 与 `lets a stop() re-entered from the RESUME trace keep pageshow from reactivating the cluster`。两者都断言嵌套 stop 胜出、transport 未重开、最终健康为 stopped/not ready，并检查 cluster 保持未 coordinated、未 suspended。
- Mutation check：仅移除 `handlePageShow()` 的 lifecycle generation guard 时，pageshow 回归会因 `cluster.snapshot.coordinated === true` 稳定失败；恢复 guard 后通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts tests/cluster.test.ts`（235/235）、`pnpm check`（35 files，760/760）、`pnpm lint`、`pnpm test:coverage`（35 files，760/760；statements 97.75% / branches 93.91% / functions 97.99% / lines 98.99%；`data-bus.ts` statements 97.19% / branches 94.72% / functions 95.00% / lines 98.45%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）均通过。
- 阻塞：无。
- 风险 / 回滚：仅增加内部 lifecycle 代次与 resume 有效性返回值，不改 public API、worker protocol、存储 schema/key 或线协议。若发现 BFCache resume 激活顺序回归，回滚 = revert 本任务提交。
- 下一项：提交、推送并创建 PR，等待全部门禁后合并；随后继续审计 queued-start 与 recovery timer 的剩余可执行边界。
- 更新时间：2026-09-16。

## 0.20.92 re-entrant reopen lifecycle ownership (2026-09-16)

- 状态：已合并（PR #72，rebase merge 至 `main@4123759`）。
- 分支 / PR / 合并：`feat/data-bus-reopen-reentrant-stop` ← `origin/main@76616eb`；PR #72。
- 复现场景：transport 运行期报错后，显式 `start()` 进入 `reopenTransport()`；同步 CONNECTING status handler 立即调用 `stop()`。旧实现先发出 CONNECTING，再安装新的 lifecycle epoch 与 `startPromise`，因此 stop 完成 teardown 后 reopen 仍继续注册 opening，并再次调用 `transport.start()`，最终健康状态可同时出现 `started: false` 与 live connected transport。
- 修复：在 `reopenTransport()` 发出 CONNECTING 前递增 lifecycle epoch、创建 epoch-guarded opening 并安装 `startPromise`；同步 status handler 触发 stop/suspend 后立即返回，不再注册旧 lifecycle 的 recovery outcome。stop 现在会等待该 opening，而 epoch guard 在 `transport.start()` 前放弃旧 opening。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `lets a stop() from the reconnect CONNECTING callback cancel the reopen`。断言 stop 胜出、transport 仅启动一次且已停止、最终健康为 stopped/not ready，并验证之后仍可干净重启。
- Mutation check：修复前该测试因 `transport.startCalls` 为 2 而失败；应用 lifecycle 安装顺序修复后通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts tests/cluster.test.ts`（233/233）、`pnpm check`（35 files，758/758）、`pnpm lint`、`pnpm test:coverage`（35 files，758/758；statements 97.75% / branches 93.90% / functions 97.99% / lines 98.99%；`data-bus.ts` statements 97.17% / branches 94.77% / functions 95.00% / lines 98.44%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅调整 `reopenTransport()` 内部 lifecycle 安装与 CONNECTING 通知顺序，不改 public API、worker protocol、存储 schema/key 或线协议。若发现恢复状态通知顺序回归，回滚 = revert 本任务提交。
- 下一项：继续审计 RESUME/pageshow 的同步回调重入边界。
- 更新时间：2026-09-16。

## 0.20.92 re-entrant START lifecycle ownership (2026-09-16)

- 状态：已合并（PR #71，rebase merge 至 `main@76616eb`）。
- 分支 / PR / 合并：`feat/data-bus-reentrant-start` ← `origin/main@3f9a81e`；PR #71。
- 复现场景：trace sink 收到同步 START lifecycle 事件后立即调用 `stop()`；旧实现此时 `startPromise` 与 lifecycle epoch 尚未安装，因此 stop 完成 teardown 后，外层 start 仍继续启动 dedup/replay/cluster，并让 transport 重新进入 `connected`。最终健康摘要同时报告 `state: 'stopped'` 与 `transport.ready: true`。
- 修复：在发出 START trace 前先递增 lifecycle epoch、创建 epoch-guarded opening 并安装 `startPromise`；START、CONNECTING status、`cluster.start()` 与 topic replay 前后都检查当前 lifecycle。同步回调一旦触发 stop/suspend，外层 start 立即停止后续资源启动，旧 opening 在 epoch guard 处被放弃，transport 从未调用 `start()`。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `lets a stop() re-entered from the START trace own a fresh lifecycle` 与 `lets a stop() from the CONNECTING status callback cancel the rest of start`。两者都断言 stop 胜出、transport 从未 start、最终健康为 stopped 且 transport 未 ready，并验证之后仍可干净重启。
- Mutation check：在修复前运行新增测试，因 `transport.startCalls` 为 1 而失败；应用生命周期顺序修复后通过。
- 验证命令与结果：`pnpm check`（35 files，757/757）、`pnpm lint`、`pnpm typecheck`、`pnpm test:coverage`（35 files，757/757；statements 97.78% / branches 93.89% / functions 98.17% / lines 98.99%；`data-bus.ts` statements 97.31% / branches 94.71% / functions 95.79% / lines 98.43%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅调整 `start()` 内部生命周期锁与同步回调之间的顺序，不改 public API、worker protocol、存储 schema/key 或线协议。若发现 trace/status 顺序或启动回归，回滚 = revert 本任务提交。
- 下一项：继续审计 reopen CONNECTING 的同步回调重入边界。
- 更新时间：2026-09-16。

## 0.20.92 re-entrant stop teardown sharing (2026-09-16)

- 状态：已合并（PR #70，rebase merge 至 `main@3f9a81e`）；主分支 CI #35046227249 与 CodeQL #35046227256 全绿。
- 分支 / PR / 合并：`feat/data-bus-reopen-predecessor-rejection` ← `origin/main@d8c51ed`；PR #70。
- 审计目标：验证 explicit `stop()` 期间同步可观测的 trace 回调（STOP lifecycle event）在 `stopPromise` 安装前重入 `stop()` 时，是否会启动第二次 teardown。
- 结论 / 加固：确认为真实缺陷。此前的 `stop()` 先调用 `performStop()` 再赋值 `this.stopPromise`，而 `performStop()` 体内的同步前奏会同步抛出 STOP trace event；trace sink 若在此同步重入 `stop()`，重入调用看到 `stopPromise === null`，于是开始第二次 teardown（`transport.stop()` 被调用两次）。修复方式：把同步前奏抽到 `beginStop()`，在 `stop()` 内先安装一个 deferred 共享 gate（`stopPromise = stopGate`），再执行 `beginStop()` 与 `performStop()`；重入调用现在看到 `stopping && stopPromise`，共享同一个 teardown，`stopGate` 以真实 teardown promise 结算。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `shares one teardown when stop() is re-entered from a trace sink`（断言重入 `stop()` 返回同一 promise、`transport.stopCalls === 1`、仅发出一次 STOP trace、最终 `DISCONNECTED`/`stopped`）。
- Mutation check：把 `stop()`/`performStop()` 恢复为「先 `performStop()` 再赋值 `stopPromise`」的旧实现后，该回归因重入 `stop()` 返回不同 promise 而失败；恢复修复后通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts tests/cluster.test.ts`（230/230）通过；`pnpm check`（35 files，755/755）、`pnpm lint`、`pnpm typecheck`、`pnpm test:coverage`（35 files，755/755；statements 97.84% / branches 93.94% / functions 98.17% / lines 98.99%；`data-bus.ts` statements 97.62% / branches 95.01% / functions 95.79% / lines 98.42%，未覆盖仅剩 new-lifecycle 防御性 reject 分支）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅修改 `stop()` 的 gate 安装顺序与同步前奏抽取，保持单 tick 生效、per-tick 状态翻转、transport stop 失败仍经 `onError` 收敛且 `stop()` 不 reject、并发/重复 `stop()` 共享同一 promise 等契约。不改 public API、worker protocol、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：继续审计 `getQueuedStartReady()` 与 `createStopPromise()` 剩余可达生命周期错误路径。
- 更新时间：2026-09-16。

## 0.20.91 RELEASE_FREEZE (2026-09-16)

- 状态：已发布并完成发布后验证。
- 分支 / 基线：`feat/release-0.20.91` ← `origin/main@f171122`。
- 发布范围：`v0.20.90..f171122` 的 11 个提交，包含跨 Tab `EVENT` 边界加固、WebSocket 连接失败后的 socket 清理、Centrifuge token bridge 生命周期隔离、cluster pause 定时器泄漏修复，以及 DataBus/会话生命周期与回放持久化错误路径回归。
- 版本级别：patch（`0.20.90` → `0.20.91`）；无计划内破坏性 public API、worker protocol、存储 schema/key 或线协议变更。
- 变更文件：`package.json`、`CHANGELOG.md`、`docs/benchmarks.md`、`docs/zh/benchmarks.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 验证命令与结果：`pnpm check`（35 files，754/754）、`pnpm lint`、`pnpm test:coverage`（statements 97.87% / branches 93.94% / functions 98.16% / lines 99.03%）、`pnpm bench`（3 files，25/25）、`pnpm test:e2e`（27/27）、`pnpm bench:browser`、`pnpm bench:compare --fail-above-pct 50`（无指标回退超过 50%）、`pnpm verify:pack`（ESM/CJS root + subpaths）、`pnpm verify:compat`（对 v0.20.90）、公开 registry `pnpm audit`（无已知漏洞）、`npm pack --dry-run --json`（109 files，`docs/progress.md` 未打包）、`git diff --check` 均通过。
- 发布结果：PR [#68](https://github.com/Sun1090/cross-tab-worker-databus/pull/68) 经 rebase merge 到 `main@41f0401`；tag `v0.20.91` 精确指向该 commit；GitHub Release 发布成功（https://github.com/Sun1090/cross-tab-worker-databus/releases/tag/v0.20.91）；Release workflow `35045042690` 全部 job 在 53 秒内成功，npm publish 与阻塞式 published-consumer gate 均通过。
- 发布后 smoke test：`npm view cross-tab-worker-databus version` 返回 `0.20.91`；registry integrity 为 `sha512-Rx4tSFVjpVYVCGjzKlClje2O8ZxruOqgKGU5nDpmtH3n4sNWlXs7m8qly8/L66d9ncMfW+jpLrZdQ1trq5ZHcQ==`；`PUBLISHED_VERSION=0.20.91 pnpm verify:published` 验证已发布 ESM/CJS root 与 public subpath 消费者可导入。
- 阻塞：无。
- 风险 / 回滚：若 0.20.91 发现回归，停止传播、保留 immutable tag，按 patch release 修复；不删除或重写已发布版本。运行时可回退到 `v0.20.90` 或上一兼容版本，存储 schema/key 与 worker protocol 未发生变化。
- 下一项：已由 `0.20.92 re-entrant START lifecycle ownership` 接续，继续覆盖同步可观测回调与 start/stop 锁之间的重入边界。
- 更新时间：2026-09-16。

## 0.20.91 superseded start/stop rejection ownership (2026-09-16)

- 状态：实现与完整验证完成，待提交、推送和 PR。
- 分支 / 基线：`feat/data-bus-superseded-start-stop` ← `origin/main@627a7e9`。
- 审计目标：验证显式 `stop()` 到达时 initial `transport.start()` 仍未 settle，且该已被取代的 opening 在 stop 等待期间 reject 时，错误是否会错误进入新 lifecycle 的 failure ledger，以及 stop 是否仍只关闭 transport 一次。
- 结论 / 加固：生产 `openTransport()` 的 `isCurrentLifecycle()` 守卫与 `performStop()` 的 stop-gate 串行化正确；无需修改运行时。新增回归固定：原 `start()` 调用方收到自己的 rejection，`stop()` 仍成功，`transport.stop()` 恰好调用一次，旧 opening 的失败不会进入 `onError`，健康状态最终为 `stopped`。
- 变更文件：`tests/data-bus.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `keeps stop() successful when a superseded in-flight start rejects`。
- Mutation check：临时移除 `openTransport()` rejection 路径的 `isCurrentLifecycle()` 守卫后，定向测试因旧 start failure 被错误送入 `onError` 而失败；恢复守卫后通过。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts tests/cluster.test.ts`（229/229）通过；`pnpm check`（35 files，754/754）、`pnpm lint`、`pnpm test:coverage`（35 files，754/754；statements 97.87% / branches 93.94% / functions 98.16% / lines 99.03%；`data-bus.ts` statements 97.77% / branches 95.01% / functions 95.72% / lines 98.6%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅测试与文档，不改 runtime、public API、worker protocol、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：提交/合并后继续审计 `reopenTransport()` chaining/settlement、queued-start readiness 等剩余生命周期错误路径。
- 更新时间：2026-09-16。

## 0.20.91 queued transport-operation rejection audit (2026-09-16)

- 状态：已完成并合并（GitHub PR #66，rebase merge 后 main 为 `627a7e9`）。
- 分支 / 基线：`feat/data-bus-run-transport-rejection-audit` ← `origin/main@0344246`。
- 审计目标：验证启动期间排队的 transport 操作（`subscribe()` 在 initial open 尚未 settle 时进入 `runTransport()`）在放行后 reject 时，是否只通过 `onError` 上报一次、是否产生 unhandled rejection，以及失败后监听器/生命周期是否仍可正常停止。
- 结论 / 加固：生产 `runTransport()` 的 `.then(operation, swallow-open-rejection).catch(reportError)` 链路正确；无需修改运行时。新增回归固定“排队操作 reject 恰好上报一次、且没有 `unhandledRejection`”的契约，并让 `data-bus.ts` 的排队操作失败分支获得覆盖。
- 变更文件：`tests/data-bus.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `reports a queued operation rejection once without an unhandled rejection`。测试使用带 gate 的 `start()` 和 reject 的 `subscribe()`，确认操作直到 start 放行前不会写入 transport，放行后错误恰好到达 `onError` 一次，并显式监听 `process.on('unhandledRejection')` 确认没有逃逸拒绝。
- 验证命令与结果：定向 `pnpm exec vitest run tests/data-bus.test.ts tests/cluster.test.ts`（228/228）通过；`pnpm check`（35 files，753/753）、`pnpm lint`、`pnpm test:coverage`（35 files，753/753；statements 97.8% / branches 93.89% / functions 97.98% / lines 99.03%；`data-bus.ts` statements 97.43% / branches 94.75% / functions 94.87% / lines 98.6%，排队操作失败分支已覆盖）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅测试与文档，不改 runtime、public API、worker protocol、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：继续审计 `data-bus.ts` 剩余未覆盖生命周期错误路径（`getQueuedStartReady()` 无 queued start、`reopenTransport()` chaining/settlement、`createStopPromise()` 拒绝收口等），优先补协议/生命周期竞态而不是不可达的类型防御分支。
- 更新时间：2026-09-16。

## 0.20.91 EVENT boundary hardening (2026-09-16)

- 状态：已完成并合并（GitHub PR #65，rebase merge 后 main 为 `0344246`）。
- 分支 / 基线：`feat/data-bus-event-start-audit` ← `origin/main@7e69ae1`。
- 审计目标：验证 `CrossTabDataBus` 的跨 Tab `EVENT` 公共协调边界，覆盖未知事件类型、旧版 `originTabId` 回退、payload 归属优先级，以及畸形 publication 负载是否会影响后续投递。
- 结论 / 修复：发现真实健壮性缺陷——同源 peer 发送 `EVENT/publication` 且 payload 为 `null` 时，`onEvent` 读取 `originTabId` 抛出 `TypeError` 并击穿 BroadcastChannel 监听器。现在边界只接受对象且带字符串 `topic` 的 publication payload；未知 `eventType` 与畸形 payload 均静默忽略，后续合法事件仍可投递。旧帧缺少 payload 级 `originTabId` 时继续继承帧级值，payload 自带归属优先。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`docs/architecture.md`、`docs/zh/architecture.md`、`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `falls back to the frame originTabId for legacy EVENT payloads and prefers payload attribution`、`ignores non-publication and malformed EVENT frames without breaking the listener`。第二个用例在修复前稳定复现 `TypeError: Cannot read properties of null (reading 'originTabId')`，并同时在畸形帧之后注入合法 publication，确认监听器与后续投递仍存活。
- 验证命令与结果：`pnpm check`（35 files，752/752）、`pnpm lint`、`pnpm test:coverage`（35 files，752/752；statements 97.77% / branches 93.89% / functions 97.8% / lines 98.99%）、`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅收窄跨 Tab `EVENT` 的输入校验；合法 `DataBusMessage`、worker protocol、存储 schema/key、public API 与线协议均不变。若需回滚，revert 本任务提交即可。
- 下一项：继续审计 `getQueuedStartReady()`、`reopenTransport()`、`runTransport()` 与 `createStopPromise()` 的剩余未覆盖错误路径；必要时扩展真实故障回归。
- 更新时间：2026-09-16。

## 0.20.91 cluster pause timer + data-bus readiness/recovery contract (2026-09-16)

- 状态：实现与完整验证完成，待提交、推送和 PR。
- 分支 / 基线：`feat/data-bus-readiness-recovery-contract` ← `origin/main@c02b3c6`。
- 审计目标：补强 `CrossTabDataBus` 就绪/恢复契约，并修掉审计过程中暴露的一处真实定时器泄漏：(1) `stop()` 后迟到的 `pageshow` 不得重启后台资源；(2) 自动恢复再次失败时 `ready()` 必须暴露最近一次 transport 错误；(3) 被后续 `stop()` 取消的排队启动，其 readiness gate 不得泄漏给替代重启；(4) 排队重启在变为可用前被 `suspend`，`ready()` 必须 reject；(5) 较新的错误重新排定恢复后，旧 recovery timer 不得再打开 transport；(6) 启动失败清理阶段的 `transport.stop()` rejection 必须被收敛且不污染后续重启。
- 结论 / 加固：生产代码仅一处缺陷——`WorkerClusterRuntime.pause()` 无条件执行 `globalThis.setTimeout(() => channel?.close(), 0)`，即使 `channel === null` 也会留下一个无意义 timer，导致 `stop()` 后仍残留定时任务。现改为仅在 `channel` 非空时排定延迟关闭（无 `setTimeout` 时同步 `close()`）。其余五条契约生产代码已正确，新增回归固定行为。
- 变更文件：`src/core/cluster.ts`、`tests/data-bus.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `does not restart background resources when pageshow arrives after an explicit stop`、`surfaces the last transport error from ready() after automatic recovery fails`、`invalidates a canceled queued-start readiness gate for the replacement restart`、`rejects ready() when a queued restart is suspended before it becomes usable`、`ignores a stale recovery timer when a newer error schedules another attempt`、`contains a stop rejection while cleaning up a failed startup and stays restartable`。
- Mutation check（`/tmp/mutation_check.py`，6/6 全部被检出）：移除 null-channel 关闭守卫、移除 `ready()` 保留 `lastError` 分支、移除 canceled queued-start token 分支、移除 suspended queued-start readiness 守卫、移除 stale recovery timer token 检查、移除 `createStopPromise()` 的 stop rejection 收敛，均使对应回归失败；恢复生产代码后定向 6/6 通过。stale-timer 用例通过注入 `dedup.now` 时钟，使第二个错误越过 cooldown 而不推进 fake timer 时钟，从而把旧 timer 与新 timer 的到期点分离。
- 验证命令与结果：`pnpm exec vitest run tests/cluster.test.ts tests/data-bus.test.ts`（221/221）；`pnpm exec vitest run tests/lifecycle-invariants.test.ts tests/documentation.test.ts tests/workflows.test.ts`（23/23）；`pnpm check`（35 files，746/746）；`pnpm lint`；`pnpm test:coverage`（35 files，746/746；statements 97.63% / branches 93.54% / functions 97.43% / lines 98.9%）；`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：`cluster.ts` 改动仅影响 `pause()` 在无 channel 时的延迟关闭排定，不改 storage schema/key、worker protocol 或公开 API；其余为测试与文档。回滚 = revert 本任务提交。
- 下一项：继续审计 `getQueuedStartReady()` 缓存复用、`reopenTransport()` opening 复用、`createStopPromise()` 其他错误路径与 `data-bus.ts` 未覆盖分支。
- 更新时间：2026-09-16。

## 0.20.91 stale transport callback isolation (2026-09-16)

- 状态：实现与完整验证完成，待提交、推送和 PR。
- 分支 / 基线：`feat/data-bus-reopen-lifecycle-audit` ← `origin/main@34927ed`。
- 审计目标：补强 `CrossTabDataBus` 被替换 transport generation 的回调隔离：旧 `onMessage`、`onStatus`、`onError` 在自动 reopen 后迟到时，不得污染替代 transport 的分发、状态或告警账本。
- 结论 / 加固：生产代码已有正确的 `isCurrentLifecycle()` 守卫，无需修改。新增回归保留首代 handlers，在 BFCache `pagehide`/`pageshow` 触发第二代 transport 并恢复 connected 后，再调用旧 generation 的三类回调；固定旧 publication 不派发、旧 error status 不降级新 transport、旧 error 不进入当前 failure ledger / `onError`。
- 变更文件：`tests/data-bus.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `isolates message and failure callbacks from a replaced transport generation`。
- Mutation check：依次移除 `onMessage`、`onStatus`、`onError` 的 lifecycle guard，测试分别以旧消息被派发、新状态被降级、旧错误进入 `onError` 失败；每次恢复生产守卫后定向 1/1 通过。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts tests/lifecycle-invariants.test.ts`（146/146）；`pnpm check`（35 files，740/740）；`pnpm lint`；`pnpm test:coverage`（35 files，740/740；statements 97.42% / branches 93.20% / functions 97.25% / lines 98.74%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅测试与文档，不改运行时、public export、worker protocol、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：继续审计 queued-start readiness 缓存/未就绪分支、stale recovery timer token、`reopenTransport()` opening 复用与 stop failure settlement 的真实回归。
- 更新时间：2026-09-16。

## 0.20.91 data-bus lifecycle recovery regression coverage (2026-09-16)

- 状态：实现与完整验证完成，待提交、推送和 PR。
- 分支 / 基线：`feat/data-bus-lifecycle-recovery-audit` ← `origin/main@4c966f0`。
- 审计目标：补强 `CrossTabDataBus` 的两条恢复竞态边界：失败的自动 reopen 已拥有异步 stop 时发生 `pagehide`，以及首个 transport open 在被 `pagehide`/`pageshow` 取代后才迟到 reject。
- 结论 / 加固：生产代码已有正确的 lifecycle 守卫，无需修改。新增回归固定两点：suspend 必须复用 failed-reopen 的 pending stop，不能追加第二次 `transport.stop()`；被取代 open 的迟到 rejection 只能结束旧调用方，不能清除或拆除替代生命周期。
- 变更文件：`tests/data-bus.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/data-bus.test.ts` — `reuses a failed-reopen stop gate when the tab hides before cleanup settles`、`ignores a rejected superseded open without clobbering the replacement lifecycle`。
- Mutation check：移除 `openTransport()` 的 stale-lifecycle rejection guard 后，superseded-open 测试失败；将 `suspendTransport()` 的 pending-stop 复用条件改为 false 后，failed-reopen 测试观察到 `transport.stop()` 被调用两次并失败；恢复生产代码后定向 2/2 通过。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts`（144/144）；`pnpm exec vitest run tests/lifecycle-invariants.test.ts`（1/1）；`pnpm check`（35 files，739/739）；`pnpm lint`；`pnpm test:coverage`（35 files，739/739；statements 97.42% / branches 93.15% / functions 97.25% / lines 98.74%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅测试与文档，不改运行时、public export、worker protocol、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：继续审计 `reopenTransport()` 的 opening 复用、queued-start readiness、stale recovery timer token 和 stop failure settlement 分支。
- 更新时间：2026-09-16。

## 0.20.91 centrifuge subscription callback isolation (2026-09-16)

- 状态：回归约束与完整验证完成，待提交、推送和 PR。
- 分支 / 基线：`feat/centrifuge-subscription-lifecycle-isolation` ← `origin/main@3844ace`。
- 审计目标：确认被 `STOP` 取代、随后重新初始化的 Centrifuge client 无法通过 subscription 级 `publication` / `error` / `unsubscribed` 回调污染新会话；同时确认旧 client 的异步 `publish()` rejection 不会越过生命周期边界上报到新会话。
- 结论 / 加固：生产代码已有对应 lifecycle 守卫，无需修改。新增回归测试固定三件事：旧订阅的 publication 不得派发、旧订阅的 error 不得上报、旧订阅的 unsubscribed 不得从新会话中删除同 topic 的替换订阅；重复 `SUBSCRIBE` 后 replacement listener 集合必须保持不变，随后新订阅仍可正常派发。另一个测试让旧 client 的 publish rejection 在新 client 初始化之后才结算，确认错误被静默丢弃。
- 变更文件：`tests/centrifuge-session.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/centrifuge-session.test.ts` — `isolates subscription callbacks when the owning client is replaced`、`suppresses a publish rejection from a replaced client`。
- Mutation check：依次移除 subscription publication guard、subscription error guard、unsubscribed guard 和 publish rejection guard，定向回归分别失败；恢复后 32/32 通过。
- 验证命令与结果：`pnpm exec vitest run tests/centrifuge-session.test.ts`（32/32）；`pnpm check`（35 files，737/737）；`pnpm lint`；`pnpm test:coverage`（35 files，737/737；statements 97.28% / branches 93.04% / functions 97.06% / lines 98.62%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`git diff --check` 均通过。`centrifuge-session.ts` branches 从 91.95% 提升至 95.4%。
- 阻塞：无。
- 风险 / 回滚：仅测试与文档，不改运行时、public export、worker protocol、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：继续检查 `data-bus.ts` 覆盖率未命中的生命周期恢复分支，重点审计 queued-start readiness、canceled restart、reopen 失败清理和 stop failure 路径是否都有真实回归。
- 更新时间：2026-09-16。

## 0.20.91 centrifuge token lifecycle binding (2026-09-16)

- 状态：实现与完整验证完成，待提交、推送和 PR。
- 分支 / 基线：`feat/centrifuge-token-lifecycle-binding` ← `origin/main@904c84f`。
- 复现场景：启用 token bridge 后，Centrifuge client 保存的 `getToken` / `getChannelToken` 闭包在该 client 已被 `STOP` 取代、随后又初始化新 client 时仍可被迟到调用。旧闭包此前在 `requestToken()` 内读取当时的 `this.lifecycle`，因此会把旧 client 的凭证请求送上新 session；加入回归测试后，修复前 Promise 永远等不到响并触发测试超时。
- 根因：token provider 闭包没有绑定创建它的 Centrifuge client lifecycle，lifecycle 校验发生在回调内部、读取的是替换后的会话状态，无法区分迟到调用与当前调用。
- 修复：`src/centrifuge-session.ts` 在创建 bridged provider 时捕获该 client 的 `lifecycle` 并显式传入 `requestToken(kind, lifecycle, channel?)`；若当前 session lifecycle 已变化，在分配 requestId、登记 pending 和发送 `TOKEN_REQUEST` 之前直接 reject。旧 client 因而不能污染重启后的凭证请求或响应表。
- 变更文件：`src/centrifuge-session.ts`、`tests/centrifuge-session.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/centrifuge-session.test.ts` — `rejects credential requests from a client whose lifecycle has ended`。覆盖 STOP 后旧 client 的 `getToken` 被拒绝且不发新请求、重新 INIT 后旧 client 的 `getChannelToken` 仍被拒绝、新 client 的 token round-trip 正常完成。
- 验证命令与结果：`pnpm exec vitest run tests/centrifuge-session.test.ts`（30/30）；`pnpm check`（35 files，735/735）；`pnpm lint`；`pnpm test:coverage`（35 files，735/735；statements 97.22% / branches 92.87% / functions 97.06% / lines 98.62%）；`pnpm exec vitest run tests/documentation.test.ts tests/workflows.test.ts`（22/22）；`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅收紧已失效 Centrifuge client token provider 的行为；当前 client 的请求语义、worker protocol、public export、存储 schema 与线协议均不变。旧 client 本就不应获得新会话凭证，迟到调用现在显式 reject。回滚 = revert 本任务提交。
- 下一项：审计 `CentrifugeSession` 的 `publication`、`error`、`unsubscribed` 订阅级异步回调隔离，补 STOP/reinit 后旧 subscription 污染的回归；随后继续检查 `data-bus.ts` 未覆盖的生命周期恢复分支。
- 更新时间：2026-09-16。

## 0.20.91 websocket error cleanup + published-gate audit (2026-09-16)

- 状态：已完成并合并。
- 分支 / PR / 合并：`feat/websocket-handshake-error-cleanup` ← `origin/main@81492a5`；GitHub PR #58 rebase merge 后 main 为 `904c84f`，提交 `50ee694`。
- 问题：`WebSocketTransport` 在 socket `error` 后立即把连接标记为 inactive，但只对握手超时显式调用 `close()`。若浏览器或注入实现没有紧随 `onerror` 发出 `onclose`，DataBus 自动恢复会跳过关闭已失活的旧连接，导致死 socket 泄漏；握手前错误还会拒绝 `start()` 而不终止半开连接。
- 修复：新增 best-effort `abortSocket()`，统一关闭超时、握手前错误和已连接错误之后的失活 socket；先保持既有 status/handshake failure 语义，再清理连接，且忽略 close 本身与失败握手竞争时的异常。
- 公开包验证审计：工作流已经显式传入 `PUBLISHED_VERSION`，正常路径不会执行额外的 `npm view`；首次 `npm pack` 成功时无固定等待，只有 registry 尚未传播 tarball 时才进入 48 × 7.5 s 退避。未发现应改动的正常路径延迟或多余 registry 往返，因此不修改发布脚本。
- 变更文件：`src/websocket.ts`、`tests/websocket.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：握手前 `error` 会拒绝 `start()`、报告 `error`、关闭 socket 并进入 closed 状态；真实 DataBus 自动恢复用例新增旧 socket 必须关闭一次的断言。
- 验证命令与结果：`pnpm exec vitest run tests/websocket.test.ts`（44/44）；`pnpm check`（35 files，734/734）；`pnpm lint`；`pnpm test:coverage`（35 files，734/734；statements 97.15% / branches 92.82% / functions 97.06% / lines 98.54%）。相比上一任务，branches 从 92.76% 提升至 92.82%，lines 从 98.46% 提升至 98.54%。
- 阻塞：无。
- 风险 / 回滚：改变的是错误后连接清理，不改变 wire protocol、public API 或恢复预算。`error` 后只发送 `close()`；若宿主实现不支持对 CONNECTING socket 调用 close，异常被 best-effort 吞掉并保留原始错误。回滚 = revert 本任务提交。
- 下一项：提交并创建 PR；随后审计 `CentrifugeSession` 在 `STOP`/重新初始化后的 subscription callback 隔离，或继续检查 `data-bus.ts` 生命周期恢复分支。
- 更新时间：2026-09-16。

## 0.20.91 replay persistence transaction errors (2026-09-16)

- 状态：已完成并合并。
- 分支 / PR / 合并：`feat/replay-persistence-error-paths`；GitHub PR #57 rebase merge 后 main 为 `81492a5`。
- 基线：`origin/main@4eaec94`。
- 问题：`createIndexedDbReplayPersistence()` 的 `clear()`、`clearTopic()`、`clearBefore()` 都依赖 `IDBTransaction.onerror` 才能在某些配额/存储故障下拒绝并失效缓存连接；既有测试只覆盖了 `onabort` 和 append 的 `onerror`，这六条关键分支完全未执行。缺少回归时，clear 类操作可能在事务错误后永不 settle 或错误保留死连接。
- 修复 / 加固：新增两组回归测试，分别覆盖三个 clear 类操作在带错误对象的 `transaction.onerror` 下拒绝并 invalidate、禁用故障后同一 adapter 可重新打开并持久化，以及三个操作在 transaction error 无错误对象时返回对应领域 fallback message。无需修改生产代码，现有实现通过新增约束。
- 变更文件：`tests/replay-persistence.test.ts`、`docs/progress.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`。
- 新增测试：`tests/replay-persistence.test.ts` — clear/clearTopic/clearBefore 的事务级错误、连接失效恢复、无错误对象 fallback 共 6 条路径；测试文件从 30 增至 32 个用例。
- 验证命令与结果：`pnpm exec vitest run tests/replay-persistence.test.ts`（32/32）；`pnpm test:coverage`（35 files，733/733；statements 97.08% / branches 92.76% / functions 97.06% / lines 98.46%）。相比 0.20.90 冻结前，branches 从 92.43% 提升至 92.76%；`replay-persistence.ts` branches 从 80.8%（63/78）提升至 88.46%。
- 阻塞：无。
- 风险 / 回滚：仅测试与文档，不改运行时、public export、存储 schema/key 或线协议。回滚 = revert 本任务提交。
- 下一项：完成 `pnpm check`、`pnpm lint`，提交并创建 PR；随后审计 `verify:published` 正常路径是否存在可消除的固定等待或额外 registry 往返。
- 更新时间：2026-09-16。

## 0.20.90 RELEASED (2026-09-16)

- 状态：已正式发布，发布后验证完成。
- PR / 合并：PR #55（`feat/release-0.20.90` → `main`）已以 rebase 方式合并；合并提交 `d194d05 chore(release): prepare 0.20.90`。
- Tag / Release workflow：`v0.20.90` 指向 `d194d05`；Release run `35035368211` 成功（58 秒），完整执行 verify、lint、公开导出兼容、packed consumer smoke、GitHub Release、npm publish、published consumer gate 与验证上下文记录。
- npm 发布结果：`cross-tab-worker-databus@0.20.90` 可从 `https://registry.npmjs.org` 获取；tarball `https://registry.npmjs.org/cross-tab-worker-databus/-/cross-tab-worker-databus-0.20.90.tgz`，integrity `sha512-CqkcnThfTvw6My5t/P9+zbkAmPGa8kQqbGWrDeojOJpV6a581eD6BqyHz+XbJARJf36n9HZ5Q2imwBbwVX6jkw==`。
- 发布后 smoke test：`npm view cross-tab-worker-databus version --registry https://registry.npmjs.org` 返回 `0.20.90`；`PUBLISHED_VERSION=0.20.90 pnpm verify:published` 从真实发布包验证 ESM/CJS root 与全部 subpath 可导入。
- 风险 / 回滚：patch 版无 public export、存储 schema/key 或线协议不兼容变更；npm 版本不可覆盖。若发现严重回归，撤回/移动 tag 并 revert 发布提交，必要时 `npm deprecate cross-tab-worker-databus@0.20.90` 后补发 0.20.91。
- 下一 milestone：0.20.91 继续可靠性审计，优先检查覆盖率未触达的关键分支与优化 `verify:published` 的正常路径等待行为；修复必须带可复现回归测试。
- 更新时间：2026-09-16。

## 0.20.90 RELEASE_FREEZE (2026-09-16)

- 状态：发布前冻结已完成，正式发布结果见上方 `0.20.90 RELEASED` 记录。
- 分支 / 基线：`feat/release-0.20.90` ← `origin/main@c30ef28`；额外测试修复独立提交为 `67a699e test: budget lifecycle fuzzer under coverage`。
- 完成内容：`package.json` 从 0.20.89 升至 0.20.90；将 `[Unreleased]` 固化为 `## [0.20.90] - 2026-09-16`；中英文 roadmap 将 0.20.90 从进行中提升为已完成范围，记录 6 分钟 npm 传播预算、统一投递语义和发布性能证据；中英文 benchmark trend 基于 23 份归档报告刷新。覆盖率发布门暴露 V8 instrumentation 下 1_500-seed lifecycle fuzzer 超过 Vitest 默认 5 秒的问题，保留全部 seed 并给该重负载测试显式 30 秒预算。
- 变更文件（release commit）：`package.json`、`CHANGELOG.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/benchmarks.md`、`docs/zh/benchmarks.md`、`docs/progress.md`；测试预算修复：`tests/lifecycle-invariants.test.ts`。
- 验证命令与结果：`pnpm check`（35 files，731/731）、`pnpm lint`、`pnpm test:coverage`（35 files，731/731；96.97% statements / 92.43% branches / 96.51% functions / 98.46% lines）、`pnpm bench`（25/25）、`pnpm test:e2e`（27/27）、`pnpm bench:browser` ×2 + `pnpm bench:compare --fail-above-pct 50`（OK，无指标超过 50%）、`pnpm verify:pack`、`pnpm verify:compat`（v0.20.89 基线）、`pnpm audit --registry=https://registry.npmjs.org`（clean）、`npm pack --dry-run --json`（109 files）、documentation/workflows guards（22/22）、`git diff --check` 全部通过。
- 阻塞：无；初次并行运行的 coverage 超时已由显式测试预算修复并在空闲状态下复验通过。
- 风险 / 回滚：patch 发布，无 public export、storage schema/key 或线协议变更；`verify:compat` 保持 v0.20.89 公开面。回滚 = 撤回 tag 并 revert release commit；npm 版本不可覆盖，必要时 deprecate 或补发下一 patch。
- 下一项：提交 release freeze，rebase 到 `origin/main`，推送并创建 PR；checks 全绿后 rebase merge，打 `v0.20.90` tag；等待 Release workflow 发布 npm 并执行发布后 `PUBLISHED_VERSION=0.20.90 pnpm verify:published`，随后记录正式发布结果并进入下一可靠性任务。
- 更新时间：2026-09-16。

## 0.20.90 delivery semantics documentation (2026-09-16)

- 状态：已完成并提交，待推送/PR。
- 分支 / commit：`feat/delivery-semantics`；提交 `ac7f6fc`。
- 问题：`docs/architecture.md` 把三道分发关卡描述为「每个 subscriber exactly-once」，与同文件故障转移说明、`docs/capabilities.md` 以及 `docs/api.md` 的边界互相矛盾；中文 API 还漏掉了英文已有的 dedup 边界段落。
- 修复：统一记录真实保证——经过可选 `messageId` 去重门后，每条被接受的 transport publication 只会扇出一次，每个匹配的本地 handler 至多分发一次；transport/服务端仍可能重复或丢失，断连/挂起期间跨 Tab `EVENT` 可能丢失，`dedup` 是按 bus 实例有界、尽力而为并会被 `stop()` 重置，因此 SDK 不保证端到端 at-least-once 或 exactly-once。英文与中文 architecture/API/capabilities 同步，并将 roadmap 0.13.0 候选 #2 标记为已交付。
- 变更文件：`docs/architecture.md`、`docs/zh/architecture.md`、`docs/api.md`、`docs/zh/api.md`、`docs/capabilities.md`、`docs/zh/capabilities.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`CHANGELOG.md`、`tests/documentation.test.ts`、`docs/progress.md`。
- 新增测试：`tests/documentation.test.ts` — 同时断言中英文 architecture 必须包含本地至多一次扇出与端到端不保证 at-least-once/exactly-once 的边界，并禁止旧的 exactly-once per-subscriber 声明回归。
- 验证命令与结果：`pnpm exec vitest run tests/documentation.test.ts`（17/17）、`pnpm check`（35 files，731/731）、`pnpm lint`、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅文档与文档守卫，无运行时、public export、存储 schema 或线协议变化。回滚 = revert `ac7f6fc`。
- 下一项：推送分支并创建 PR；随后继续审计 `ready()` 排队 start 失败后的状态保留与 `initialConfig` 边界，以及 `verify:published` 的正常路径等待优化。
- 更新时间：2026-09-16。

## 0.20.90 release verify budget (2026-09-16)

- 状态：已完成，待提交。
- 分支 / commit：`feat/release-verify-budget`；基线 `origin/main` = `77d5d4c`。
- 复现场景：0.20.89 的 tag 首发 Release workflow（run 35031801806）在 `Publish to npm` 成功之后，`Verify published npm consumers` 仍失败——`npm pack cross-tab-worker-databus@0.20.89` 在旧预算 24 × 5 s（120 s）内始终返回 `ETARGET: No matching version found`。`npm view ...@0.20.89 version` 与本地 `PUBLISHED_VERSION=0.20.89 pnpm verify:published` 随后立即通过，`workflow_dispatch` 重跑全绿，确认是 npm CDN 传播延迟而非产物缺陷。
- 根因：门禁本身正确（已发布包必须能被干净消费者导入），但它把「版本元数据可见」与「tarball 在所有边缘可下载」当成同一时刻；npm 会先提供版本元数据，tarball 仍可能在一段时间内报 `ETARGET`。2 分钟上限对正常传播延迟留白不足，导致一次健康的发布被记为失败发布。
- 修复：`.github/workflows/release.yml` 的阻塞式 published-consumer 预算提升为 `PUBLISHED_VERIFY_ATTEMPTS=48` × `PUBLISHED_VERIFY_DELAY_MS=7500`（2 min → 6 min），并加注释说明 0.20.89 的真实触发；真正缺失或不可导入的包仍会耗尽预算并失败。中英文 release checklist 同步更新该预算与其理由。
- 变更文件：`.github/workflows/release.yml`、`tests/workflows.test.ts`、`docs/release-checklist.md`、`docs/zh/release-checklist.md`、`CHANGELOG.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 新增测试：`tests/workflows.test.ts` — `keeps enough published-consumer retry budget for npm propagation`，断言两个 env 值为正数且总等待不低于 5 分钟下限。mutation check：把 attempts 回退为 24（总 180 s）后该测试以 "only waits 180s; keep at least a 5-minute ceiling" 失败，恢复后通过。
- 验证命令与结果：`pnpm exec vitest run tests/workflows.test.ts`（5/5）、`pnpm check`（35 files，730/730）、`pnpm lint`、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅调整 CI 等待预算与文档，不改变运行时行为、public export 或线协议；最坏情况是一个真正缺失的版本需要 6 分钟才失败。回滚 = revert 该提交并恢复 24 × 5 s。
- 下一项：继续 lifecycle/adapter 异步回调隔离审计；评估 `verify:published` 是否应改为先轮询 `npm view` 再取 tarball 以缩短正常路径等待。
- 更新时间：2026-09-16。

## 0.20.89 RELEASED (2026-09-16)

- 状态：已发布。版本 **0.20.89** 已合并到 `origin/main`，tag 为 `v0.20.89`；npm `latest` 指向该版本，GitHub Release、Release workflow 与已发布包消费者 smoke test 均通过。
- 分支 / PR：`feat/lifecycle-stop-resume-race` → PR #52，rebase merge 并删除远端分支；release commit `8f33fa7`，合并后 main commit `77d5d4c`，tag 指向 `77d5d4c3b5ee41ebc4d31c9b7431faff1340c9fd`。
- 完成内容：版本从 0.20.87 线累积后升至 0.20.89；`[Unreleased]` 固化为 `## [0.20.89] - 2026-09-16`；中英文 roadmap 记录 8 项异步回调隔离修复（stale stop gate 复用、stopping 期间 health verdict、微任务排队 replay batch、retention cleanup、durable hydration 取消、trace 会话边界、Centrifuge credential/session 回调、WebSocket Blob 帧）与 1_500 交织 lifecycle fuzzer 回归安全网。
- 变更文件（release commit）：`package.json`、`CHANGELOG.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 发布结果：GitHub Release <https://github.com/Sun1090/cross-tab-worker-databus/releases/tag/v0.20.89>；tag 首次触发的 Release workflow <https://github.com/Sun1090/cross-tab-worker-databus/actions/runs/35031801806> 在 `Verify published npm consumers` 步骤失败，`workflow_dispatch` 重跑 <https://github.com/Sun1090/cross-tab-worker-databus/actions/runs/35032115955> 全绿；npm 确认 `0.20.89` 为 `latest`，integrity 为 `sha512-PPq/XeH+kIN+szw8blm2gwXRLsbh3HplzOngpc+RP4+h1+xVAvP7qfBWSM5Pv8L5yE9d8hgPQRky79tA37X1Bg==`。
- 验证命令与结果：`pnpm check`（35 files，729/729）、`pnpm lint`、`pnpm test:coverage`（96.97% statements / 92.43% branches / 96.51% functions / 98.46% lines）、`pnpm bench`（25/25）、`pnpm bench:browser` ×2 + `pnpm bench:compare --fail-above-pct 50`（OK）、`pnpm test:e2e`（27/27）、`pnpm verify:pack`、`pnpm verify:compat`、`npm pack --dry-run`（109 files）、`pnpm audit --registry=https://registry.npmjs.org`（clean）、`git diff --check` 均通过；发布后 `PUBLISHED_VERSION=0.20.89 pnpm verify:published`（ESM + CJS consumers verified）。
- 阻塞：无。
- 风险 / 回滚：纯 patch 发布，无 public export、存储 schema/键或线协议变更，`verify:compat` 确认向后兼容。回滚 = 撤回 tag 并 revert release commit；npm 已发布版本不可覆盖，只能 `npm deprecate cross-tab-worker-databus@0.20.89` 或补发下一个 patch。
- 已知问题：`verify:published` 的默认 24 次 × 5 s（120 s）npm CDN 传播预算在本次真实触发不足——publish 已成功但 `npm pack` 在 120 s 内仍报 `ETARGET`。该门禁本身正确，仅传播等待过短，需在下一开发线加固。
- 下一项：进入 0.20.90 开发线——加固 Release 工作流的已发布包消费者传播预算，然后继续 lifecycle/adapter 异步隔离审计与 1.0.0 稳定性冻结准备。
- 更新时间：2026-09-16。

## 0.20.89 RELEASE_FREEZE (2026-09-16)

- 状态：发布前置冻结完成，待提交 → 推送分支 → PR → rebase merge → 打 tag → 触发 Release 工作流。
- 分支：`feat/lifecycle-stop-resume-race`（基线 `origin/main` = `ea80d08`，ahead 17）。
- 完成内容：`package.json` 0.20.88 → 0.20.89；将 `[Unreleased]` 固化为 `## [0.20.89] - 2026-09-16` 并保留新的空 `[Unreleased]`；中英文 roadmap 把「0.20.89 in progress / 进行中」提升为「delivered scope / 已完成范围」。本 patch 发布汇总 8 项异步回调隔离修复（stale stop gate 复用、stopping 期间 health verdict、微任务排队 replay batch、retention cleanup、durable hydration 取消、trace 会话边界、Centrifuge credential/session 回调、WebSocket Blob 帧）以及 1_500 交织的 lifecycle fuzzer 回归安全网。
- 变更文件：`package.json`、`CHANGELOG.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 验证命令与结果：`pnpm check`（35 files，729/729）、`pnpm lint`、`pnpm test:coverage`（96.97% statements / 92.43% branches / 96.51% functions / 98.46% lines）、`pnpm bench`（25/25）、`pnpm bench:browser` ×2 + `pnpm bench:compare --fail-above-pct 50`（OK：无指标回归超过 50%）、`pnpm test:e2e`（27/27）、`pnpm verify:pack`（packed tarball 的 ESM + CJS root 及全部 subpath 可导入）、`pnpm verify:compat`（0.20.89 preserves public exports and type metadata from v0.20.88）、`npm pack --dry-run --json`（109 files / 880 kB packed，仅含预期产物）、`pnpm audit --registry=https://registry.npmjs.org`（No known vulnerabilities）、`git diff --check` 均通过。
- 阻塞：无。本地 `npm whoami` 无凭证，但 0.20.88 已由 Release workflow 用仓库 `NPM_TOKEN` 成功发布，因此发布路径不依赖本地 npm 登录。
- 风险 / 回滚：纯 patch 发布，无 public export、存储 schema/键或线协议变更，`verify:compat` 已确认向后兼容。回滚方式为 revert release commit 并删除/移动 tag；已发布到 npm 的版本不可覆盖，只能 `npm deprecate` 或补发下一个 patch。
- 下一项：提交 release commit，推送分支，创建并 rebase-merge PR；在合并后的 main commit 上打 `v0.20.89` tag 触发 Release 工作流，监控 npm 发布与 GitHub Release，运行 `pnpm verify:published` smoke test，然后回填 `0.20.89 RELEASED` 记录并进入下一 milestone。

## 0.20.89 stale stop gate reuse (2026-09-16)

- 状态：已完成并提交，等待 0.20.89 发布冻结。
- 分支 / commit：`feat/lifecycle-stop-resume-race`；修复提交 `4feed32`。
- 复现场景：`bus.stop()` 在 teardown 完成后立刻 `bus.start({})` 再 `bus.stop()`。第一次 `performStop()` 已跑完并把 `stopping` 置回 false，但清空 `stopPromise` 的 settle handler 还没执行；第二次 `stop()` 命中 `if (this.stopPromise) return this.stopPromise;`，直接返回已 settle 的旧 promise，完全跳过 teardown，bus 停在 `started: true` / `state: 'healthy'`，而调用方以为已停止。
- 根因：`stopPromise` 既是"共享在途 stop 门"又被当作"是否仍在停止中"的判据，但两者的生命周期不同——promise settle 与字段清空之间隔了一个微任务；`stopping` 才是在 `performStop()` finally 中原子翻转的权威信号。
- 修复：`stop()` 的复用条件收紧为 `if (this.stopPromise && this.stopping)`，已 settle 但尚未清空的陈旧门会 fall through 到全新 `performStop()`。随机交织 fuzz（600 seeds × 40 步的 start/stop/ready/pageHide/pageShow/stopGate 组合）在修复前约 2/120 seeds 出现"最终 stop 后仍 started"，修复后 600 seeds 全绿。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/progress.md`。
- 新增测试：`tests/data-bus.test.ts` — `performs a fresh stop when the previous stop gate is settled but not yet cleared`（两轮微任务精确构造 settle-but-not-cleared 窗口，断言最终 `started: false` / `state: 'stopped'` / `transport.ready: false` 且 `transport.stopCalls === 2`）。mutation check 回退该行后最小复现失败（观察到 `started: true`），恢复后通过。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts`（141/141）、`pnpm check`（35 files，728/728）、`pnpm lint`、`pnpm test:coverage`（96.97% statements / 92.42% branches / 96.51% functions / 98.46% lines）、`pnpm build` + `pnpm test:e2e`（27/27）、`pnpm exec vitest run tests/documentation.test.ts`（16/16）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅收紧 `stop()` 的门复用条件；并发 stop 仍在 `stopping` 为 true 时共享同一 promise，语义不变。无 public export、存储 schema、存储键或线协议变更。若出现兼容性回归，可 revert 该修复提交。
- 下一项：继续审计 `ready()` 排队 start 失败后的状态保留与 `initialConfig` 边界，以及最终 stop 后 trace/dedup/replay 定时器与微任务残留。
- 更新时间：2026-09-16。

## 0.20.89 lifecycle fuzzer restart invariant (2026-09-16)

- 状态：已完成，待提交。
- 分支 / commit：`feat/lifecycle-stop-resume-race`；提交待生成。
- 完成内容：`tests/lifecycle-invariants.test.ts` 新增第 4 条不变式——任意交织序列完全 teardown 之后，`start({})` 必须重新达到 `healthy` 且 `ready()` resolve。该检查覆盖「已 settle 的 stop 门到下一次生命周期」的残留交接窗口，与已提交的第 3 条（最后一次意图为 stop 则必须 `state === 'stopped'`）互补。同步把 `docs/roadmap.md` 新增的 0.20.89 in-progress 章节镜像到 `docs/zh/roadmap.md`，满足本地化文档的 h2/列表项计数守卫。
- 变更文件：`tests/lifecycle-invariants.test.ts`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 验证命令与结果：`pnpm exec vitest run tests/lifecycle-invariants.test.ts`（1/1，1_500 seeds）、`pnpm check`（35 files，729/729）通过。
- mutation check：移除 `stop()` 中的 queued-restart 取消逻辑后，fuzzer 在 seed 64/470/686 报出 `expected a stopped bus, got started=true`，确认 fuzzer 对生命周期 barrier 破坏敏感；恢复后通过。第 4 条不变式本身针对的是残留交接窗口，未单独构造可复现的针对性 mutation，保留为低成本的额外安全网。
- 阻塞：无。
- 风险 / 回滚：仅测试与文档；无运行时行为变化。
- 下一项：继续审计 transport/adapter 快速替换时的异步回调隔离，以及 0.20.89 是否达到发布冻结条件。
- 更新时间：2026-09-16。


## 0.20.89 stopping health verdict (2026-09-16)

- 状态：已完成并提交，等待 0.20.89 发布冻结。
- 分支 / commit：`feat/lifecycle-stop-resume-race`；修复提交 `f9fac5d`。
- 复现场景：transport 的 `stop()` 被 `stopGate` 挂起期间，`bus.stop()` 已设置 `stopping = true`，但 `started` 仍为 true、transport 仍上报 `connected`。此时 `getHealthSummary()` 返回 `{ healthy: true, state: 'healthy', transport: { ready: true } }`，而同一时刻 `publish()` 已经通过 `onError` 拒绝、`ready()` 已经 reject——就绪探针会得到与真实可操作性相反的结论。
- 根因：健康判定只看了 `started` / `suspended` / 实时 transport status，没有把 `stopping` 计入。`stopping` 在 `performStop()` 一开始就置位，而 `started` 要在 `finally` 才翻回 false，期间的异步 transport teardown 使窗口可以任意长（取决于 transport 实现）。
- 修复：`getHealthSummary()` 的 state 推导改为 `!this.started || this.stopping ? 'stopped' : ...`。停止期间一律报告 `state: 'stopped'` / `healthy: false`；`started` 与 `transport.status`/`transport.ready` 仍作为诊断字段原样输出。排在 stop 之后的 restart 在真正接管生命周期后自然报告为 `starting`/`healthy`。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`tests/lifecycle-invariants.test.ts`、`CHANGELOG.md`、`docs/api.md`、`docs/zh/api.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/progress.md`。
- 新增测试：`tests/data-bus.test.ts` — `does not report a healthy bus while an explicit stop is still tearing down`（用 `stopGate` 卡住 teardown，断言停止期间 `healthy: false` / `state: 'stopped'`，`started: true` 与 `transport.status: 'connected'` 仍可见，`publish()` 产生 1 条 "is stopping; publish() was not sent" 错误，stop settle 后 `started: false`）。
- 测试强化：`tests/lifecycle-invariants.test.ts` 的 seeded fuzzer 从 400 seeds 提升到 1_500 seeds，并新增第 3 条不变式——序列的最后一次显式生命周期意图为 `stop()` 时，`health.state === 'stopped'`。该断言是健康语义的独立安全网；stale stop gate 的最小复现由 `tests/data-bus.test.ts` 的精确用例承担。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts`（142/142）、`pnpm exec vitest run tests/lifecycle-invariants.test.ts`（1/1，1_500 seeds）、`pnpm check`（35 files，729/729）通过；完整链（lint / coverage / build + e2e / documentation / diff check）见本次提交前的最终验证。全部通过。
- 阻塞：无。
- 风险 / 回滚：只改变 `getHealthSummary()` 在停止窗口内的 `state`/`healthy` 输出，不影响 `started`、`transport`、恢复账本或任何操作语义；停止期间的调用方本来就已被 `publish()`/`subscribe()`/`ready()` 拒绝。外部消费者若曾在 stop 未 settle 时依赖 `healthy: true`，那是本次修复要消除的错误结论。若需回滚，revert 本修复提交即可，无 schema、存储键或线协议变更。
- 下一项：继续审计 transport/adapter 快速替换时异步 subscribe/publish/status 回调的隔离，以及最终 stop 后 trace/dedup/replay 定时器与微任务残留；`docs/roadmap.md` 的 0.20.89 delivered scope 也待补。
- 更新时间：2026-09-16。


## 0.20.89 queued replay batch isolation (2026-09-16)

- 状态：已完成并提交，等待 0.20.89 发布冻结。
- 分支 / commit：`feat/lifecycle-stop-resume-race`；修复提交 `6118815`。
- 复现场景：`ReplayManager.record()` 将 publication 放入 `pendingReplayPersistence` 并排入 `queueMicrotask`。若 `suspend()` 或 `CrossTabDataBus.stop()` 在微任务执行前发生，旧回调会在生命周期切换后才调用 `withPersistenceRetry()`，因此捕获的是新 generation 并继续执行 `appendBatch()`，把已停止会话的历史重新写入 durable store。
- 根因：batch flush 的 generation 不是随队列条目绑定，而是在微任务真正开始时才捕获；`suspend()` 虽然递增 generation、取消已在途 retry 和 retention cleanup，却没有清空尚未启动的待写队列。
- 修复：`src/core/replay-manager.ts` 的 `suspend()` 在递增 generation 的同时清空 `pendingReplayPersistence`。已启动的 backend operation 仍由 generation 校验取消；尚未启动的 flush 则不会越过 teardown 边界。`CHANGELOG.md`、架构、capabilities 与中英文 configuration 文档同步记录该生命周期语义。
- 变更文件：`src/core/replay-manager.ts`、`tests/replay-manager.test.ts`、`tests/stability.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/capabilities.md`、`docs/zh/capabilities.md`、`docs/configuration.md`、`docs/zh/configuration.md`。
- 新增测试：`tests/replay-manager.test.ts` — `drops a queued batch flush when suspend() wins the microtask race`；`tests/stability.test.ts` — `does not flush a queued replay batch after stop begins`。mutation check 回退 `suspend()` 的队列清理后，两处测试均失败（分别观察到 `appendBatchCalls: [1]` 与一次真实 `appendBatch` 调用），恢复后通过。
- 验证命令与结果：`pnpm exec vitest run tests/replay-manager.test.ts tests/stability.test.ts`（64/64）、`pnpm check`（35 files，727/727）、`pnpm lint`、`pnpm test:coverage`（96.97% statements / 92.36% branches / 96.51% functions / 98.46% lines）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅改变生命周期切换时尚未开始的 batch append 语义；按设计，已接受但尚未进入 backend 的写入会随旧会话丢弃，无 public export、存储 schema、存储键或线协议变更。若出现兼容性回归，可 revert `6118815`。
- 下一项：继续审计 `ready()` 排队 start/stop/cancel token 窗口、最终 stop 后 trace/dedup/replay 定时器与微任务残留，以及其他 transport/adapter 快速替换时异步订阅、发布、状态回调的隔离。
- 更新时间：2026-09-16。

## 0.20.89 stop-time async isolation (2026-09-16)

- 状态：已完成并提交，等待 0.20.89 发布冻结。
- 分支 / commit：`feat/lifecycle-stop-resume-race`；修复提交 `cdd6014`、`f53d0e7`、`66a65e0`。
- 复现场景：三组 teardown 窗口可在生命周期结束后继续改变状态。其一，`DataBusTraceReporter.stop()` 只暂停 metrics，没有阻止普通事件；`asyncSink` 中 stop 前排队的微任务仍会在 stop 返回后投递，且 `mode: 'events'` 的 reporter 在 `stop()` 后再次 `start()` 时不会清除 stopped 标记。其二，durable replay 的异步 `load()` 在 `suspend()` / `stop()` 之后成功 resolve，仍会把消息追加进已经被 `performStop()` 清空的 replay buffers。其三，retention cleanup 的 `clearBefore()` 在途时又收到新的 cutoff，随后 `suspend()`，旧循环仍在首个 operation 完成后发出排队的第二次 durable cleanup。
- 根因：trace reporter 的 stopped 状态没有覆盖 `event()`、异步 sink flush 与 event-only restart 路径；DataBus 首次启动/显式重启时又在 reporter `start()` 之前记录 lifecycle `start`，重启后的首事件被 stopped 守卫丢弃。Replay 的 persistence retry generation 只在异步 operation 开始前和 retry delay 后检查，没有在 operation 成功返回后再次校验，导致迟到结果越过 lifecycle 边界。Coalesced retention cleanup 又绕过该 generation，并在 `suspend()` 后继续消费队列。
- 修复：`src/core/trace.ts` 的 `start()` 在 event-only 模式也清除 stopped，`stop()` 丢弃旧会话 pending sink 队列，`event()` 与 metrics 记录/查询均拒绝 stopped 会话；`src/core/data-bus.ts` 调整首次启动和显式恢复的顺序，先开启新 trace 会话再记录 `start` / `resume`。`src/core/replay-manager.ts` 在 `withPersistenceRetry()` 的 operation resolve 后再次比较 generation，迟到成功结果统一转换为 `PersistenceRetryCancelledError`，不会修改 application state；retention cleanup 捕获开始时的 generation，`suspend()` 清除排队 cutoff，旧循环不能继续或重新调度，迟到的 cleanup failure 也不会进入新会话的错误账本。
- 变更文件：`src/core/trace.ts`、`src/core/data-bus.ts`、`src/core/replay-manager.ts`、`tests/trace.test.ts`、`tests/data-bus.test.ts`、`tests/replay-manager.test.ts`、`tests/stability.test.ts`、`CHANGELOG.md`。
- 新增测试：`tests/trace.test.ts` — `stays silent after stop and resets for an explicitly restarted session`；`tests/data-bus.test.ts` — `restarts trace event delivery after an explicit stop`；`tests/replay-manager.test.ts` — `does not repopulate buffers when hydration resolves after suspend`、`does not run a queued cleanup after suspend()`；`tests/stability.test.ts` — `does not repopulate replay buffers when hydration resolves after stop`。三组 mutation check 均确认回退对应守卫后新增测试失败，恢复后通过。
- 验证命令与结果：`pnpm exec vitest run tests/replay-manager.test.ts tests/stability.test.ts tests/data-bus.test.ts`（202/202）、`pnpm check`（35 files，725/725）、`pnpm lint`、`pnpm test:coverage`（96.97% statements / 92.36% branches / 96.51% functions / 98.46% lines）、`pnpm test:e2e`（27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅收紧 teardown 后异步状态写入、retention cleanup 排队与 trace 会话边界，无 public export、存储 schema、存储键或线协议变更。若出现兼容性回归，可分别 revert `cdd6014`、`f53d0e7`、`66a65e0`。
- 下一项：继续审计 stop/suspend 后仍排队的 replay batch/retention 微任务与定时器、`ready()` 排队 start/stop 取消窗口，以及其他 transport/adapter 异步回调跨 runtime 替换的隔离。
- 更新时间：2026-09-16。

## 0.20.89 Centrifuge replacement callback isolation (2026-09-16)

- 状态：已完成并提交，等待 0.20.89 发布冻结。
- 分支 / commit：`feat/lifecycle-stop-resume-race`；修复提交 `d7a4ba7`。
- 复现场景：三处 `stop()` / `start()` 替换窗口均可在旧后端仍持有异步回调时把结果泄漏给新后端。其一，旧 Centrifuge Worker 的异步 `credentialProvider` 仍 pending，替换 Worker 的请求 ID 又从 1 开始；旧 token 完成时会错误回应新 Worker 的同号请求。其二，主线程 local fallback 的旧 `publish()` 在替换 session 后 reject，旧错误会进入新 session 的 `onError`。其三，旧 client 在 `STOP` 与再次 `INIT` 后仍发出 `connected` / `error` / `publication`，会伪装成新 session 的事件。
- 根因：异步回调未绑定创建它的 Worker / port / local session 或 `CentrifugeSession` 生命周期；请求 ID 在重建后复用，使迟到的 token 回复无法仅靠 requestId 区分。local fallback 事件监听器也未在替换时失效，且 `stop()` 与 `init()` 之间没有单调代际标识。
- 修复：`src/centrifuge.ts` 在调用 credential provider 前捕获 `generation`、worker、port 与 local session 身份，异步 resolve/reject 及同步 throw 均只在后端仍为当前实例时回发 `TOKEN_RESPONSE` / `TOKEN_ERROR`。`src/centrifuge-session.ts` 新增生命周期代际：每次 `initialize()` / `stop()` 递增；client 状态、错误、publication 回调、subscription 回调以及 local publish rejection 都捕获创建时代际，只在仍匹配时上报或修改订阅表；`requestToken()` 在注册前也会拒绝已失效代际。
- 变更文件：`src/centrifuge.ts`、`src/centrifuge-session.ts`、`tests/centrifuge.test.ts`、`tests/centrifuge-session.test.ts`、`CHANGELOG.md`。
- 新增测试：`tests/centrifuge.test.ts` — `does not deliver a stale credential reply to a replacement worker`、`converts a synchronously throwing credential provider into TOKEN_ERROR`、`drops a rejected local publish from a replaced session`；`tests/centrifuge-session.test.ts` — `drops events from a stopped client after the session is reinitialized`。mutation check 确认旧实现分别会把 stale token、旧 publish rejection、旧 client 事件泄漏到替换 session，修复后全部通过。
- 验证命令与结果：`pnpm exec vitest run tests/centrifuge.test.ts tests/centrifuge-session.test.ts tests/websocket.test.ts`（130/130）、`pnpm check`（35 files，720/720）、`pnpm lint`、`pnpm test:e2e`（27/27）、`pnpm test:coverage`（96.96% statements / 92.42% branches / 96.51% functions / 98.45% lines）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅收紧 Centrifuge Worker / local session 回调的身份校验，未改变 public export、存储 schema、存储键或线协议。若出现兼容性回归，可 revert `d7a4ba7`。
- 下一项：继续审计 `ready()` 排队 start/stop 与取消启动、最终 stop 后 trace/dedup/replay 定时器残留，以及其他异步发起的订阅/发布回调是否能跨越 runtime 替换窗口。
- 更新时间：2026-09-16。

## 0.20.89 WebSocket Blob stale delivery race (2026-09-16)

- 状态：已完成并提交，等待 0.20.89 发布冻结。
- 分支 / commit：`feat/lifecycle-stop-resume-race`；修复提交 `74c50c0`。
- 复现场景：旧 WebSocket 收到 Blob 二进制帧后执行 `stop()` 并重新 `start()`；旧帧的 `arrayBuffer()` 在新连接与 handlers 安装后才解析完成，修复前会被当作新连接收到的消息分发给新 `onMessage`。
- 根因：`handleMessage()` 对 Blob 的异步转换没有绑定接收时的 socket / handlers；转换完成后的空窗期无法判断连接是否已被替换，转换失败也会通过新 handlers 上报。
- 修复：`src/websocket.ts` 在 Blob 转换前捕获当前 socket 与 handlers，转换完成后仅在三者仍一致且 socket 处于 active 状态时继续解析；失败分支同样受该身份校验保护。旧连接迟到帧和迟到转换错误均被静默丢弃。
- 变更文件：`src/websocket.ts`、`tests/websocket.test.ts`、`CHANGELOG.md`。
- 新增测试：`tests/websocket.test.ts` — `ignores a Blob frame that resolves after the socket is replaced`；mutation check 确认旧实现失败（新 `onMessage` 被错误调用 1 次），修复实现通过。
- 验证命令与结果：`pnpm exec vitest run tests/websocket.test.ts tests/data-bus.test.ts`（182/182）、`pnpm lint`、`pnpm check`（35 files，716/716）、`pnpm test:coverage`（97.17% statements / 92.75% branches / 96.50% functions / 98.51% lines）、`pnpm test:e2e`（27/27）、`pnpm exec vitest run tests/documentation.test.ts`（16/16）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：仅收紧 WebSocket 消息分发身份校验，无 public export、存储 schema 或线协议变更。若出现兼容性回归，可 revert `74c50c0`。
- 下一项：继续审计 Centrifuge / session 的异步回调替换窗口、`ready()` 排队 start/stop 边界和生命周期定时器残留；优先完成可复现验证后再决定 0.20.89 发布范围。
- 更新时间：2026-09-16。

## 0.20.88 RELEASED (2026-09-16)

- 状态：已发布。版本 **0.20.88** 已合并到 `origin/main`，tag 为 `v0.20.88`；npm `latest` 指向该版本，GitHub Release、Release workflow 与已发布包消费者 smoke test 均通过。
- 分支 / PR：`feat/release-0.20.88` → PR #50，rebase merge 并删除远端分支；release commit `22865cf`，合并后 main commit `00813df`，tag 指向 `00813df25a4fa944e952bd51d1f90e003b0ee7ca`。
- 完成内容：版本从 0.20.87 升至 0.20.88；`[Unreleased]` 固化为 `## [0.20.88] - 2026-09-16`；中英文 roadmap 记录 startup retry、BFCache 重复往返与显式 `start()` 完整恢复；此前四项功能进度记录校正为已合并。
- 发布范围：startup 同步 `error` 从 `onStatus` / `onError` 回调重试时隔离旧 opening 并重置失败账本；初始 open 飞行期间重复 BFCache hide/show 恢复；显式 `start()` 恢复 cluster、trace metrics、dedup 与 replay retention 定时工作。
- 迁移：无需迁移。没有删除 public export、改变存储 schema、存储键或线协议；`verify:compat` 确认 v0.20.87 的 exports 与 type metadata 继续存在。
- 发布验证：PR #50 的 analyze / verify / browser / CodeQL 全绿；Release workflow 重新执行 typecheck、build、715/715 单测、lint、compat、packed consumer 与 published consumer 验证并全部通过。
- 发布结果：GitHub Release <https://github.com/Sun1090/cross-tab-worker-databus/releases/tag/v0.20.88>；Release workflow <https://github.com/Sun1090/cross-tab-worker-databus/actions/runs/35024221368>；npm 确认 `0.20.88` 为 `latest`，integrity 为 `sha512-ka4bp+eO3tbGE2IKNa2xp0Xi1TsP+LQE8iR+4Db1PJYvioHdJxa+gU2cay9eGlemKeFKC6Fumyzw0GDoT4Bb+Q==`。
- 部署与 smoke test：这是库包发布，无独立服务部署；Release workflow 的 `Verify published npm consumers` 已通过，本地再次执行 `pnpm verify:published` 验证 npm 上的根入口与 subpath ESM/CJS 消费通过。
- 阻塞：无。
- 风险 / 回滚：npm 版本不可覆盖。发现缺陷时安装方应固定 `0.20.87`，随后发布后续 patch；仓库侧可 revert `00813df`，但不要删除或移动已发布 tag。回滚不涉及存储迁移或线协议。
- 下一 milestone：**0.20.89** —— 继续 lifecycle / `ready()` 边界、superseded async open 与 React/Vue suspend-resume parity 审计，优先寻找可复现的真实竞态或适配器泄漏。
- 更新时间：2026-09-16。

## 0.20.88 RELEASE_FREEZE (2026-09-16)

- 状态：发布前置冻结已完成；最终发布结果见上方 `0.20.88 RELEASED`。
- 分支：`feat/release-0.20.88`（基线 `main` = `0a80b68`）。
- 完成内容：`package.json` 从 0.20.87 升至 0.20.88；将 `[Unreleased]` 提升为 `## [0.20.88] - 2026-09-16` 并保留新的空 `[Unreleased]`；中英文 roadmap 新增 0.20.88 delivered scope；同步校正此前四项 lifecycle 进度记录为已合并/纳入发布状态。
- 发布范围：startup 同步 `error` 期间从 `onStatus` / `onError` 回调重试时隔离旧 opening，并重置失败账本；初始 open 飞行期间重复 BFCache hide/show 不再永久挂起；显式 `start()` 恢复 cluster 及 trace / dedup / replay retention 定时工作。
- 变更文件：`package.json`、`CHANGELOG.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/progress.md`。
- 迁移：无需迁移。没有删除 public export、改变存储 schema、存储键或线协议；`verify:compat` 继续以 `v0.20.87` 为公共面基线。
- 验证命令与结果：`pnpm check`（typecheck + build，35 files，715/715）、`pnpm lint`、`pnpm test:coverage`（97.16% statements / 92.76% branches / 96.50% functions / 98.51% lines）、`pnpm test:e2e`（27/27）、`pnpm verify:compat`（保留 v0.20.87 exports 与 type metadata）、`pnpm verify:pack`（根入口与 subpath 的 ESM/CJS 消费通过）、`pnpm bench`（3 files，25/25）、`pnpm audit --registry=https://registry.npmjs.org`（No known vulnerabilities）均通过；发布提交前再执行 `git diff --check`。
- 阻塞：无。
- 风险 / 回滚：这是 0.20.87 之后的 patch 发布。npm 版本不可覆盖；若发布后发现回归，安装方固定 `0.20.87`，仓库侧 revert release commit，必要时发布后续 patch。变更不涉及已发布存储键或线协议，不需要数据迁移。
- 下一项：原子提交并推送 release 分支，创建并合并 PR，打 `v0.20.88` tag，监控 Release 工作流与 npm 发布结果，执行 `pnpm verify:published` smoke test，然后记录发布结果并进入下一 milestone。
- 更新时间：2026-09-16。

## 0.20.88 startup-failure onStatus retry lifecycle isolation (2026-09-16)

- 状态：已合并到 main 并纳入 0.20.88 发布（lifecycle / BFCache 异步竞态审计第四项）。
- 分支：`feat/lifecycle-audit-4`（基线 `origin/main` = `d158a7a`）。
- 复现场景：首次 transport open 失败并同步上报 `error` 后，调用方在 `onStatus('error')` 回调中同步调用 `bus.start({})` 重试。
- 现象（修复前）：`onStatus` 在 `openTransport()` 完成失败清理之前触发，重试拿到仍指向失败 opening 的 `startPromise`；即使 transport 已切换到可成功启动，`transport.startCalls` 仍停留在 1。排队在旧 opening 后的操作还会捕获旧 rejection，并在重试已重置账本后通过 `runTransport().catch()` 再次写回错误，导致恢复后的 health 仍报 `hasError: true` / 非空 `lastFailure`。
- 根因：同步 `ERROR` status 在 catch 清理前通知用户；`runTransport()` 也把 openTransport 自身上报后的 rejection 当成 operation failure 二次上报。
- 修复：startup 飞行期间同步到达的 `ERROR` 只更新内部 status、cluster 与恢复调度，暂缓用户 `onStatus`；catch 先完成 cluster / transport-ready / failure ledger 清理、清除 `startPromise`，再通知状态和错误 handler。`runTransport()` 消费旧 opening 的 rejection，避免重试成功后被再次记录。新增 `recordError()` / `notifyError()` 拆分，使状态回调重试可以在错误 handler 前重置账本。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/api.md`、`docs/zh/api.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/progress.md`。
- 新增测试：`tests/data-bus.test.ts` — `starts a fresh lifecycle when start() retries from the failure onStatus callback`。使用延迟 stop gate 断言重试不与失败 open 的清理重叠；释放后 `transport.startCalls` 从 1 增至 2，`ready()` resolve，health 为 healthy 且失败账本为空。原 `onError` 回归也补充了相同账本断言。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts tests/documentation.test.ts`（2 files，155/155）、`pnpm check`（typecheck + build，35 files，715/715）、`pnpm lint`、`pnpm test:e2e`（27/27）、`pnpm test:coverage`（97.16% statements、92.76% branches、96.50% functions、98.51% lines）、`pnpm verify:compat`、`pnpm verify:pack`、`pnpm bench`（3 files，25/25）、`pnpm audit --registry=https://registry.npmjs.org`（无已知漏洞）、`git diff --check` 全部通过。本机默认 npmmirror registry 不提供 audit endpoint，改用 npmjs registry 后通过。
- 阻塞：无。
- 风险 / 回滚：仅改变 startup `error` 通知与旧 opening rejection 的内部顺序；真实 open 飞行中的普通并发 start 仍共享同一 Promise。无 public export、存储 schema 或线协议变化。若引入生命周期回归，revert 本 commit 即可。
- 下一项：已由 0.20.88 RELEASE_FREEZE 接续。
- 更新时间：2026-09-16。

## 0.20.88 synchronous start() retry from startup-failure onError (2026-09-16)

- 状态：已合并到 main 并纳入 0.20.88 发布（lifecycle / BFCache 异步竞态审计第四项）。
- 分支：`feat/lifecycle-audit-3`（基线 `origin/main` = `c238b48`）。
- 复现场景：首次 transport open 失败后，调用方在 `onError` 回调中同步调用 `bus.start({})` 重试。
- 现象（修复前）：回调拿到的仍是刚刚失败的同一个 `startPromise`，`transport.startCalls` 始终停留在 1；重试没有开启新生命周期，只会再次抛出同一个启动错误。
- 根因：`openTransport()` 的 catch 在清理失败状态后先调用 `reportError()`，此时 `startPromise` 仍指向正在拒绝的旧 open。`start()` 的并发 open guard 因而返回旧 Promise；随后的 catch 才完成 cluster 清理并重新抛出。
- 修复：`openTransport()` 在通知 `onError` 前先完成初始启动失败所需的 cluster 清理，并清除当前失败的 `startPromise`。回调中的同步 `start()` 因而安装真正的新生命周期，并等待失败 open 的 transport stop gate 后再启动；旧 open 的 settle handler 只会在仍拥有 gate 时清除字段，不会误杀重试。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/api.md`、`docs/zh/api.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/progress.md`。
- 新增测试：`tests/data-bus.test.ts` — `starts a fresh lifecycle when start() retries from the failure onError callback`。使用 stop gate 断言重试不会与失败 open 的清理重叠；修复前 `transport.startCalls` 为 1，修复后 release stop gate 后第二次启动成功，`ready()` 与 health summary 均恢复健康。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts`（138/138）、`pnpm exec vitest run tests/documentation.test.ts`（16/16）、`pnpm check`（35 files，714/714）、`pnpm lint`、`pnpm test:e2e`（27/27）均通过；`git diff --check` 干净。
- 阻塞：无。
- 风险 / 回滚：仅改变失败通知时的内部 gate 顺序；真实 open 飞行中的普通并发 start 仍共享同一 Promise。无 public export、存储 schema 或线协议变化。若引入生命周期回归，revert 本 commit 即可。
- 下一项：已由 0.20.88 RELEASE_FREEZE 接续。
- 更新时间：2026-09-16。

## 0.20.88 explicit start() resumes paused background resources (2026-09-16)

- 状态：已合并到 main 并纳入 0.20.88 发布（lifecycle / BFCache 异步竞态审计第三项）。
- 分支：`feat/lifecycle-audit-3`（基线 `origin/main` = `c238b48`）。
- 复现场景：Tab 启用 replay retention sweep（或 trace metrics / dedup expiry sweep）后执行 `pagehide`，不等待 `pageshow`，直接调用 `bus.start({})` 恢复。
- 现象（修复前）：bus 与 cluster 都能恢复为 `healthy`，transport 也会重新连接，但 `onSuspend()` 在此前已暂停 trace、dedup sweep 与 replay retention sweep；显式 `start()` 只重开了 transport 和 cluster，没有执行 `onResume()` 中的资源恢复，因此 bus 在健康状态下永久不再 flush trace metrics，也不再执行周期性的 dedup/retention 清理。
- 根因：原生恢复路径 `cluster.handlePageShow()` 会先调用 `handlers.onResume()`，再由 `onResume()` 恢复 trace、dedup 与 replay；显式 `start()` 的挂起快速路径绕过了 cluster 的 pageshow 回调，只手工重开 transport 和调用 `cluster.start()`。
- 修复：提取 `resumeSuspendedResources()` 作为统一恢复入口，原生 `onResume()` 与显式 `start()` 的挂起分支共同调用，恢复 trace metrics、dedup expiry sweep 与 replay retention sweep；显式路径仍保持先恢复资源、再安装 transport opening、最后恢复 cluster 的顺序。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/progress.md`。
- 新增测试：`tests/data-bus.test.ts` — `resumes replay retention sweeps when an explicit start() leaves BFCache suspension`。修复前 retention sweep 在显式恢复后推进 1000ms 仍为 0 次调用；修复后按 `retentionSweepMs` 恢复。测试同时断言显式恢复发出 `lifecycle/resume` trace 事件。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts`（137/137）、`pnpm exec vitest run tests/documentation.test.ts`（16/16）、`pnpm check`（35 files，713/713）、`pnpm lint`、`pnpm test:e2e`（27/27）均通过；`git diff --check` 干净。
- 阻塞：无。
- 风险 / 回滚：纯主线程生命周期修复，无 public export / storage schema / 线协议变更。若引入回归，revert 本次 commit 即可。
- 下一项：已由 0.20.88 RELEASE_FREEZE 接续。
- 更新时间：2026-09-16。

## 0.20.88 explicit start() cluster resume after BFCache (2026-09-16)

- 状态：已合并到 main 并纳入 0.20.88 发布（lifecycle / BFCache 异步竞态审计第二项）。
- 分支：`feat/lifecycle-replacement-audit-2`（基线 `origin/main` = `07f53e0`）。
- 复现场景：Tab A 已经 `start()` 并与 Tab B 建立跨 Tab 协调；随后 `pagehide`（bus 与 cluster 同时 suspended）。此时不再等 `pageshow`，直接由调用方显式 `bus.start({})`。
- 现象（修复前）：`bus.getHealthSummary()` 报告 `healthy`、transport `connected`，但 `getClusterSnapshot().suspended` 仍为 `true`；cluster 的 channel listener 已关闭、heartbeat 已停止、`assignedTopics` 已清空，因此所有来自 peer tab 的入站 publication 都被 `cluster.isAssigned()` 丢弃，直到下一次 `pageshow` 才恢复。
- 根因：`start()` 的 `started` 快速路径只清除了 `this.suspended` 并 `reopenTransport()`，而 `pagehide` 是**独立**暂停 cluster 的（`cluster.pause()`），并不会因 transport 重开而自动恢复。
- 修复：`src/core/data-bus.ts` 的 `start()` 在 `started` 分支先记录 `resumingFromSuspend = this.suspended`，完成 `reopenTransport()`（清除 `suspended`、安装 opening）之后再调用 `this.cluster.start()`。这样 cluster 的重订阅流量会排在 transport opening 之后而不是打到已停止的 transport；`cluster.start()` 幂等，非挂起路径为 no-op。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`tests/lifecycle-invariants.test.ts`（新增）、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/api.md`、`docs/zh/api.md`、`docs/progress.md`。
- 新增测试：
  - `tests/data-bus.test.ts` — `resumes cluster coordination when an explicit start() takes a hidden tab out of suspension`（修复前 `getClusterSnapshot().suspended` 断言 `expected true to be false` 失败，修复后通过）。
  - `tests/lifecycle-invariants.test.ts`（新增）— 基于 seeded RNG（400 seeds）的随机化生命周期不变量测试，随机序列覆盖 `hide` / `show` / `error` / `timer` / `publish` / `subscribe` / `disconnect` / `toggleStartFailure` / `start` / `stop` / `flush`，断言 ① `health.suspended === cluster.suspended`、② `intent === 'stopped'` 时 `health.started === false`、③ 非 stopped 且两侧非 suspended 时 `ready()` 必须 resolve 为 `healthy`。对本次修复做了 mutation check（stash 掉 `src/core/data-bus.ts` 修改后测试失败，恢复后通过）。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts`、`pnpm exec vitest run tests/lifecycle-invariants.test.ts` 通过；`pnpm check`（35 files，712/712）通过；`pnpm lint` 干净；`pnpm exec vitest run tests/documentation.test.ts` 通过；`pnpm test:e2e` 27/27 通过；`git diff --check` 干净。
- 阻塞：无。
- 风险 / 回滚：纯主线程生命周期修复，无 public export / storage schema / 线协议变更。若引入回归，revert 本次 commit 即可。
- 下一项：已由 0.20.88 RELEASE_FREEZE 接续。
- 更新时间：2026-09-16。

## 0.20.88 repeated BFCache hide/show during startup (2026-09-16)

- 状态：已合并到 main 并纳入 0.20.88 发布（lifecycle / BFCache 异步竞态审计第一项）。
- 分支：`feat/lifecycle-replacement-audit`（基线 `origin/main` = `8c59c26`）。
- 复现场景：初始 transport 打开尚未完成时连续执行 `pagehide → pageshow → pagehide → pageshow`，修复前最终 `transport.startCalls` 停留在 `1`，恢复未真正重开 transport。
- 根因：`suspendTransport()` 之前只要 `pendingStop` 非空就直接返回。重复 hide/show 后 `startPromise` 可能已经是排队中的 resume opening，而 `pendingStop` 仍是旧 stop gate，二者失去「挂起时相同 promise」的关键不变量；下一次 `pageshow` 复用了已被 lifecycle epoch 淘汰的 opening，bus 永久保持挂起。
- 修复：`suspendTransport()`（`src/core/data-bus.ts`）只在 `pendingStop` 仍代表本次挂起（`startPromise === null || startPromise === pendingStop`）时复用它；否则串行地在当前 `startPromise` / `pendingStop` 之后链式创建新的 `transport.stop()`，恢复 `startPromise === pendingStop` 不变量，使后续 `pageshow` 真正重开 transport。失败 open 的 stop cleanup 仍会被复用，不会重复 `transport.stop()`。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、`docs/architecture.md`、`docs/zh/architecture.md`、`docs/progress.md`。
- 新增测试：`tests/data-bus.test.ts` — `reopens after repeated hide/show cycles that all precede a pending initial open`（修复前 `expected 1 to be 2`，修复后通过）。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts` 135/135 通过；`pnpm check`（34 files，710/710）通过；`pnpm lint` 干净；`pnpm exec vitest run tests/documentation.test.ts` 16/16 通过；`pnpm test:e2e` 27/27 通过；`git diff --check` 干净。
- 阻塞：无。
- 风险 / 回滚：纯主线程生命周期状态机修复，无 public export / storage schema / 线协议变更。若引入回归，可 revert 本次 commit。
- 下一项：已由 0.20.88 RELEASE_FREEZE 接续。
- 更新时间：2026-09-16。

## 0.20.87 RELEASED (2026-09-16)

- 状态：已发布。版本 **0.20.87** 已合并到 `origin/main`，tag 为 `v0.20.87`，npm `latest` 已指向该版本；tag-triggered Release workflow 与已发布包消费者验证均通过。
- 分支 / PR：`chore/0.20.87-release` → PR #44，rebase merge 并删除远端分支；release commit `a58bb5f`，合并后 main commit `e8e8daf`。
- 完成内容：版本从 0.20.86 升至 0.20.87；`[Unreleased]` 提升为 `## [0.20.87] - 2026-09-16`；中英文 roadmap 记录 transport 恢复/就绪、生命周期边界、适配器与 Vitest 更新；发布检查中发现并修复了公共文档中的 scoped 包名守卫失败。
- 发布范围：修复 transport 错误/重连恢复窗口和 clean `disconnected` 后的操作丢失；加固 WebSocket `start()` / `ready()` 握手契约、生命周期与健康摘要；同步 React/Vue health hook 的 `intervalMs` 更新行为。
- 迁移：无需迁移。没有删除 public export、改变存储 schema 或线协议；`verify:compat` 确认 v0.20.86 exports 与 type metadata 继续存在。
- 发布验证：本地 `pnpm check`（34 files，709/709）、lint、coverage（97.18% / 92.42% / 96.66% / 98.63%）、`pnpm bench`（25/25）、E2E（27/27）、两次浏览器基准与 50% 回归门禁、compat、pack、public-registry audit、109 文件 pack 清单和 `git diff --check` 均通过。PR #44 的 analyze / verify / browser / CodeQL 全绿。
- 发布结果：GitHub Release <https://github.com/Sun1090/cross-tab-worker-databus/releases/tag/v0.20.87>；Release workflow <https://github.com/Sun1090/cross-tab-worker-databus/actions/runs/35016769983> 通过；npm 确认 `0.20.87` 存在且 `latest` 指向它，integrity 为 `sha512-AxzsqPOHapJCmZi5GaCDGjqXao2Vq43ix2ggq/sJpWR2ja8hXaXByYABMP6kX4lCrXVyy+FVMwIej0z/lRejrw==`。
- 部署与 smoke test：这是库包发布，无独立服务部署；Release workflow 的 `Verify published npm consumers` 已通过，本地再次执行 `pnpm verify:published` 验证 npm 上的根入口与 subpath ESM/CJS 消费通过。
- 阻塞：无。
- 风险 / 回滚：npm 版本不可覆盖。发现缺陷时安装方应固定 `0.20.86`，随后发布修复版 `0.20.88`；仓库侧可 revert `e8e8daf`，但不要删除或移动已发布 tag。回滚不会影响已发布的跨 Tab 存储键或线协议。
- 下一 milestone：**0.20.88** —— 继续 lifecycle / `ready()` 边界与 replacement-window 发布审计；优先寻找可复现的异步 replacement / suspend / resume / stop 交错失败。
- 更新时间：2026-09-16。

## 0.20.87 RELEASE_FREEZE (2026-09-16)

- 状态：发布候选已准备在 `chore/0.20.87-release`；版本、CHANGELOG、中英文 roadmap 与进度记录已更新，全量发布门禁通过，等待 release commit、PR、tag 与发布工作流。
- 完成内容：`package.json` 从 0.20.86 升至 0.20.87；将 `[Unreleased]` 提升为 `## [0.20.87] - 2026-09-16` 并保留新的空 `[Unreleased]`；中英文 roadmap 新增 0.20.87 delivered scope，同时保留此前的 0.20.86 记录。发布文档初次检查发现 roadmap 中的 scoped 包名触发公共文档守卫，已改为 unprefixed 的 coverage-v8 provider 表述后通过。
- 发布范围：修复 transport 错误/重连恢复窗口中的操作丢失与替换连接语义；修复 clean `disconnected` 后显式操作写入关闭连接的问题；加固 WebSocket `start()` / `ready()` 握手契约、生命周期/`ready()` 边界与健康摘要；同步适配器 `intervalMs` 更新行为，并将 Vitest 与 coverage-v8 provider 升级到 5.0.1。
- 迁移：无。没有删除 public export、改变存储 schema 或线协议；`verify:compat` 确认 v0.20.86 的 exports 与 type metadata 继续存在。
- 验证命令与结果：`pnpm check`（34 files，709/709）、`pnpm lint`、`pnpm test:coverage`（97.18% statements / 92.42% branches / 96.66% functions / 98.63% lines）、`pnpm bench`（3 files，25/25）、`pnpm test:e2e`（27/27）、两次 `pnpm bench:browser` 后 `pnpm bench:compare --fail-above-pct 50` 通过（最大回归 +5.4%）、`pnpm verify:compat`（保留 v0.20.86 公共面）、`pnpm verify:pack`（根入口与 subpath 的 ESM/CJS 消费通过）、`pnpm audit --registry=https://registry.npmjs.org`（No known vulnerabilities）、`npm pack --dry-run --json`（109 files，未包含 `docs/progress.md`，包含 `dist/`）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：这是 0.20.86 之后的 patch 发布；若 release PR 合入前发现问题，修复或放弃 release 分支即可；合入后回滚 revert release commit（必要时再补 patch）。npm 版本不可覆盖，已发布的 0.20.87 只能由后续 patch 取代。
- 下一项：提交并推送 release 分支，创建并合并 PR，打 `v0.20.87` tag，监控 Release 工作流与 npm 发布结果，随后记录发布结果并进入下一 milestone。
- 更新时间：2026-09-16。

## 0.20.87 WebSocket start/ready handshake gate (2026-09-16)

- 状态：已合并。PR #42（`feat/websocket-connect-gate`），合并后 main commit `def6b68`；
  CI analyze / verify / browser / CodeQL 全绿，rebase merge 并删除远端分支。
- 完成内容：让原生 WebSocket transport 真正遵守 `DataBusTransport.start()` 的
  「连接成功后 resolve / 失败时 reject」契约。此前 `start()` 同步返回，socket 仍处于
  `CONNECTING` 时 `createWebSocketDataBus()` 的 `ready()` 就会 resolve；随后立刻
  `publish()` 会被 `sendFrame` 的 not-open 守卫丢弃。现在 `start()` 返回一个握手 gate：
  `onopen` 后才 resolve，握手前 `error`/`close` 则 reject；新增
  `connectTimeoutMs`（默认 30s，`0`/`Infinity` 表示无限等待），超时会报告 `error`、
  reject `start()` 并关闭半开 socket，之后迟到的 `open` 不会复活该尝试。已成功握手的
  socket 原地 close/reopen 仍会重发订阅帧；`stop()` 会 settle 在途 gate，避免拆除挂死。
  连带修正 `getHealthSummary()`：transport 报告 `connected` 的事件会早于 start gate
  settle，因此 health 现在以 live status 判定，而不是要求 `transportReady` 已为 true；
  否则 `useCrossTabHealth({ intervalMs: 0 })` 会被卡在 `starting`/`recovering`。
  `transportReady` 仍保留为诊断字段，窗口期操作会排在在途 start 之后。
- 新增回归测试：`tests/websocket.test.ts` 由 38 增至 42，覆盖 ①`start()` 在 `open`
  前不 settle，②握手超时 reject + `error` 上报 + 迟到 open 被忽略，③握手前 close
  reject 且状态为 `disconnected`，④DataBus 层 `ready()` 在握手完成前保持 pending，
  并且 open 后立即 `publish()` 能发出。变异验证：把 `start()` 回退为立即 resolve 时，
  3 个新契约测试失败；确认测试确实钉住新行为。hooks 集成测试同时覆盖了 connected 后
  事件驱动 health 必须变为 `healthy` 的回归。
- 变更文件：`src/websocket.ts`、`src/core/data-bus.ts`、`tests/websocket.test.ts`、`CHANGELOG.md`、
  `docs/api.md`、`docs/zh/api.md`、`docs/transports.md`、`docs/zh/transports.md`、
  `docs/architecture.md`、`docs/zh/architecture.md`、`docs/progress.md`。
- 验证命令与结果：`pnpm exec vitest run tests/websocket.test.ts`（42/42）、
  `pnpm exec vitest run tests/data-bus.test.ts tests/websocket.test.ts tests/centrifuge.test.ts`
  （229/229）、`pnpm typecheck` 通过。`pnpm check`（34 files，707/707）、`pnpm lint`、
  `pnpm test:coverage`（97.17% statements、92.40% branches、96.66% functions、
  98.62% lines）、`pnpm verify:compat`、`pnpm verify:pack`、`pnpm test:e2e`
  （27/27）、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：这是 transport 启动契约修复；`ready()` 语义随之更严格，调用方若依赖
  「socket 尚未 open 但 ready 已 resolve」的行为会看到更晚的就绪时机，但旧行为会让
  紧随其后的 publish 丢失，属于需要修复的契约违背。超时新增默认可避免握手永久挂起；
  `0`/`Infinity` 保留旧的无超时等待能力。回滚方式：revert 本 commit 即恢复此前
  `start()` 在 `CONNECTING` 阶段提前返回的行为。
- 下一项：继续 lifecycle / `ready()` 边界与 replacement-window 发布审计。
- 更新时间：2026-09-16。

## 0.20.87 clean-disconnected demand reopen (2026-09-16)

- 状态：已合并。PR #43（`feat/disconnected-demand-reopen`），合并后 main commit `8710230`；CI analyze / verify / browser / CodeQL 全绿，rebase merge 并删除远端分支。
- 完成内容：修复干净 `disconnected` 之后的操作丢失。`runTransport()` 原本只把
  `error` 视为「不可用」，因此在 transport 干净 `close`（状态映射为 `disconnected`）
  之后到达的 `subscribe()` / `publish()` 会走 ready 快速路径，被直接写进已关闭的连接；
  WebSocket 后端的 not-open 守卫只能上报丢帧，无法真正发出。现在新增
  `transportHasConnected` 标记（在 transport 首次上报 `connected` 时置位，在
  `openTransport()` 安装新 transport 时清零），快速路径在「曾经 connected 过、当前为
  `disconnected`」时被拒绝，操作落到按需 reopen 分支：clean `disconnected` 仍然不调度
  后台自动恢复（保持既有契约），但下一次显式 transport 操作会驱动一次按需 reopen，并把
  该操作挂在恢复门之后，重开成功后 flush。
  关键取舍：条件不能简单收紧成「必须 `connected`」。worker 型后端
  （`CentrifugeWorkerTransport`）在 worker 创建后即 resolve `start()`，连接状态随后才
  异步上报，因此 `ready()` 之后仍有一段 `disconnected`（尚未连接）的窗口；简单收紧会
  让该窗口内的 publish 触发一次多余的 reopen（终止并重建 worker）。用「是否曾经
  connected」区分「尚未连接」与「已断开的可用连接」，既修掉 WebSocket 丢帧，又保持
  worker 型后端的既有行为。
- 新增回归测试：`tests/data-bus.test.ts` 由 132 增至 134。①「clean `disconnected` 后
  显式操作触发一次重开并 flush」（连接过再断开）；②「resolve `start()` 但尚未上报
  `connected` 的 transport 仍直接收到操作、不触发多余重开」（worker 型窗口）。变异验证：
  去掉「曾经 connected」判定时测试 ① 失败（`expected 1 to be 2`），确认测试钉住新行为；
  测试 ② 防止把条件收得过紧。`tests/centrifuge.test.ts`（55/55）同时作为 worker 型后端
  的集成回归。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、
  `docs/architecture.md`、`docs/zh/architecture.md`、`docs/api.md`、`docs/zh/api.md`、
  `docs/transports.md`、`docs/zh/transports.md`、`docs/progress.md`。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts`（134/134）、
  `pnpm exec vitest run tests/centrifuge.test.ts tests/data-bus.test.ts`（189/189）、
  `pnpm exec vitest run tests/documentation.test.ts tests/data-bus.test.ts`（150/150）、
  `pnpm check`（typecheck + build，34 files，709/709）、`pnpm lint`、`pnpm test:coverage`
  （97.18% statements、92.42% branches、96.66% functions、98.63% lines）、
  `pnpm verify:compat`、`pnpm verify:pack`、`pnpm test:e2e`（27/27）、`git diff --check`
  全部通过。
- 阻塞：无。
- 风险 / 回滚：改动仅限 `runTransport()` 的就绪判定、一个新内部标记与文档，无 public API、
  存储键、schema 或线协议变化。风险点是「曾经 connected 后断开」的判定若过宽会让自愈型
  transport（如 Centrifuge 协议级重连）吃到多余 reopen；因此判定刻意保留「尚未 connected」
  的宽松路径，且只在显式操作到达时才按需重开一次，不引入后台重试循环。回滚方式：revert
  本 commit 即恢复「clean `disconnected` 后操作直接写入已关闭连接」的旧行为。
- 下一项：继续 lifecycle / `ready()` 边界与 replacement-window 发布审计。
- 更新时间：2026-09-16。

## 0.20.87 runtime transport recovery gate (2026-09-16)

- 状态：实现、回归测试与文档已完成，位于 `feat/readiness-transport-status`，
  待 commit。`transportReady` 在 runtime `error` 后**有意保持 true**（`ready()`
  跟踪的是“已安装的 transport”，不等价于协议连接可用）；本轮未采用“ERROR 时清
  `transportReady`”的方案。
- 完成内容：修复 runtime transport `error` 之后的操作语义。此前 `error` 只在
  `transportReady === true` 的情况下调度自动 reopen，冷却窗口内到达的
  `subscribe()` / `publish()` 会走 `runTransport()` 的 ready 快速路径，被写到刚
  刚失败的连接上并丢失。现在 `runTransport()` 增加一个 `recoveryGate`：自动或按需
  reopen 挂起期间，`subscribe()` / `publish()` 会被停放在 gate 上，只有 reopen 成功
  （或 transport 自愈回到 `CONNECTED`）后才释放并继续执行。自动尝试失败后 gate 保持
  关闭但打开 `recoveryDemandAllowed`，让下一个显式操作立即触发一次按需 reopen，而不是
  再等一个冷却周期；被停放的操作为这次成功之后统一 flush。`recovery.maxAttempts`
  耗尽、或 `stop()` / page hide 覆盖当前等待时，gate 会被释放，从而保持既有“显式重试
  路径”和“挂起即丢弃发布”的契约不变。干净的 `disconnected` 依旧**不会**触发 DataBus
  自动 reopen。
- 新增回归测试：`tests/data-bus.test.ts` 由 129 增至 132，新增/覆盖
  ①runtime recovery 冷却期间停放操作，②自动尝试失败后由显式操作驱动立即 reopen，
  ③失败的自动 reopen 之后排队操作一直停放到按需 reopen 成功，④干净 `disconnected`
  不自动 reopen。变异验证：将 `src/core/data-bus.ts` 回退到 HEAD 时 4 个新测试中 2 个
  失败；把 `recoveryDemandAllowed = true` 改成 `false` 时 7 个测试失败，确认新测试确实
  钉住了新行为。
- 变更文件：`src/core/data-bus.ts`、`tests/data-bus.test.ts`、`CHANGELOG.md`、
  `docs/architecture.md`、`docs/zh/architecture.md`、`docs/api.md`、`docs/zh/api.md`、
  `docs/progress.md`。
- 验证命令与结果：`pnpm exec vitest run tests/data-bus.test.ts`（132/132）、
  `pnpm exec vitest run tests/data-bus.test.ts tests/websocket.test.ts tests/centrifuge.test.ts`
  （225/225）、`pnpm exec vitest run tests/documentation.test.ts`（16/16）、
  `pnpm check`（typecheck + build，34 files，703/703）、`pnpm lint`、`pnpm test:coverage`
  （97.16% statements、92.42% branches、96.63% functions、98.68% lines）、
  `pnpm verify:compat`、`pnpm verify:pack`、`pnpm test:e2e`（27/27）、`git diff --check`
  全部通过。
- 阻塞：无。
- 风险 / 回滚：改动仅限 DataBus 内部恢复路径与文档，无 public API、存储键、schema 或
  线协议变化。风险点是 gate 释放时机若遗漏会导致操作挂起；已由“成功释放 / 失败按需 /
  覆盖等待释放 / 未参与恢复的 error 释放”四条路径覆盖。回滚方式：revert 本 commit 即
  恢复旧的“error 后直接调用 transport”的行为。
- 下一项：继续 lifecycle / `ready()` 边界与 replacement-window 发布审计。
- 更新时间：2026-09-16。

## 0.20.87 Vitest patch update and clean-close audit (2026-09-16)

- Status: implementation and verification complete on `feat/vitest-5.0.1`.
- Completed content: updated `vitest` and `@vitest/coverage-v8` from `5.0.0` to the current `5.0.1` patch release, including the lockfile and transitive Rollup patch refresh. The suite still runs under the pinned package-manager workflow with unchanged coverage floors and no source/API changes.
- Audited and intentionally unchanged: a WebSocket clean `close` maps to `disconnected`, while automatic DataBus recovery remains scoped to `error`. This is the documented transport contract (`disconnected` means clean close or intentional suspension; `error` is the recoverable runtime failure signal). DataBus-level reopening is transport-agnostic, so treating every `disconnected` as a failure would also force a redundant reopen around Centrifuge's protocol-level reconnect path. A clean socket close still reopens on explicit `start()`, page restore, or later transport demand as documented.
- Changed files: `package.json`, `pnpm-lock.yaml`, `docs/progress.md`.
- Verification: `pnpm check` (34 files, 699/699), `pnpm lint`, `pnpm test:coverage` (97.18% statements, 92.41% branches, 96.57% functions, 98.65% lines), `pnpm verify:compat`, `pnpm verify:pack`, `pnpm test:e2e` (27/27), and `git diff --check` all pass.
- Blockers: none. No runtime dependency, public API, storage-key, schema, or wire-protocol change.
- Risk / rollback: the patch-level test-runner update can change Vitest diagnostics or coverage internals only; all coverage floors and suites passed. Roll back by restoring `vitest` / `@vitest/coverage-v8` to `5.0.0` and regenerating the lockfile.
- Next: continue the lifecycle/`ready()` boundary and replacement-window publication audit. Updated: 2026-09-16.

## 0.20.87 WebSocket automatic recovery reopen (2026-09-16)

- Status: implementation, regressions, and documentation complete on
  `feat/websocket-recovery-reopen`; atomic code commit `0cddadf`
  (`fix(websocket): reopen after the active socket fails`).
- Completed content: `WebSocketTransport.start()` returned whenever
  `this.socket` was non-null, while `error`/`close` left that reference in
  place. The DataBus recovery timer therefore called `reopenTransport()` but
  never created a new socket, so `createWebSocketDataBus()` could not recover
  after a real connection failure. The transport now tracks `socketActive`,
  replaces an invalid/closed socket on the next `start()`, re-sends the
  retained subscriptions when the replacement opens, and ignores late
  lifecycle/message callbacks from the superseded socket. An `error` followed
  by `close` keeps the `error` status that schedules recovery; a clean close
  still maps to `disconnected`.
- Reproduction: the two new regressions failed against the previous code with
  one socket created after both manual `start()` recovery and a DataBus
  cooldown recovery. Both pass after the fix, including stale message
  isolation and subscription replay.
- Changed files: `src/websocket.ts`, `tests/websocket.test.ts`, `CHANGELOG.md`,
  `docs/api.md`, `docs/zh/api.md`, `docs/transports.md`,
  `docs/zh/transports.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`, `docs/progress.md`.
- Verification: focused `tests/websocket.test.ts` 38/38;
  `tests/websocket.test.ts tests/data-bus.test.ts` 166/166; `pnpm check`
  (699/699 tests, 34 files); `pnpm lint`; `pnpm test:coverage` (97.18%
  statements, 92.41% branches, 96.57% functions, 98.65% lines);
  `pnpm verify:compat`; `pnpm verify:pack`; `pnpm test:e2e` (27/27 browser
  tests); `git diff --check` all pass.
- Blockers: none. No public API shape, storage-key, schema, or wire-protocol
  change.
- Risk / rollback: replacement sockets intentionally invalidate every callback
  from the failed generation, so a transport that relied on late events from an
  errored socket would observe fewer status/message callbacks; that isolation is
  required to keep recovery deterministic. Roll back with `git revert 0cddadf`.
- Next: audit clean-close recovery semantics and replacement-window publish
  behavior, then continue the lifecycle/`ready()` boundary audit. Updated:
  2026-09-16.

# Development Progress

## 0.20.87 React/Vue health interval reactivity (2026-09-16)

- Status: implementation, regressions, and documentation complete on
  `feat/hooks-health-interval-reactivity`; atomic code commit `1bb91ff`
  (`fix(hooks): react to health interval changes`).
- Completed content: `useCrossTabHealth` ignored changes to `intervalMs` unless
  the bus identity changed. React intentionally excluded the options object to
  avoid restarting on inline literals, but also excluded the normalized cadence,
  so switching `1_000 → 0` left the old timer running and positive cadence
  changes kept the previous interval. The React hook now depends on the
  normalized primitive; Vue now watches `[bus, () => options?.intervalMs]` so a
  reactive options object replaces the listener/timer set as well. Neither path
  recreates the bus.
- Reproduction: both new regressions failed against the previous code after
  changing a 1 s poller to `intervalMs: 0` and advancing five seconds: React
  observed 7 health reads where 2 were expected, and Vue observed the same
  stale-timer leak. Both pass with immediate timer replacement after the fix.
- Changed files: `src/hooks.ts`, `src/vue.ts`, `tests/hooks.test.tsx`,
  `tests/vue.test.ts`, `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`,
  `docs/progress.md`.
- Verification: focused adapter suite 23/23; `pnpm check` (696/696 tests, 34
  files); `pnpm lint`; `pnpm test:coverage` (97.17% statements, 92.38% branches,
  96.57% functions, 98.64% lines); `pnpm verify:compat`; `pnpm verify:pack`;
  `git diff --check` all pass.
- Blockers: none. No dependency, storage-key, protocol, or public API shape
  change; the new behavior is covered by additive docs.
- Risk / rollback: React now restarts health listeners when `intervalMs`
  changes, producing one immediate refresh, and Vue reactive cadence changes
  rebuild listeners/timers for the same bus. Consumers that intentionally
  ignored runtime options changes are unaffected unless they mutate the option.
  Roll back with `git revert 1bb91ff`.
- Next: continue the adapter contract audit, then move to the remaining
  `ready()` boundary branches. Updated: 2026-09-16.

## 0.20.87 stop() tolerates a failing transport stop (2026-09-16)

- Status: implementation, regression tests, and docs complete; PR
  `feat/stop-failure-tolerance` (commit `e8d9001`) open and awaiting CI.
- Completed content: `performStop()` awaited `transport.stop()` without a guard,
  so a transport whose `stop()` rejected (or threw synchronously) turned the
  shared `stop()` promise into a rejection. Every consumer of the fire-and-forget
  teardown then saw an unhandled rejection — most visibly the React adapter's
  `void instance.stop()` on unmount and the Vue adapter's `void stop()` in the
  `onBeforeUnmount`/recreate path — even though the `finally` block had already
  destroyed the bus. The failure is now routed through `reportError()`, the same
  ledger/`onError` channel that `suspendTransport()` and `createStopPromise()`
  already use for their stop cleanup, so `stop()` always resolves and the bus is
  still fully torn down. This also makes the internal paths consistent: only the
  explicit `stop()` path propagated a teardown failure.
- Reproduction: `FakeTransport` gained `stopShouldFail`; the new
  `CrossTabDataBus` regression asserted `await expect(bus.stop()).resolves
  .toBeUndefined()` and failed against the previous code with
  `promise rejected "Error: transport stop failed" instead of resolving`. The
  companion React-hooks regression (a `FakeWebSocket.close` that throws during
  unmount) failed before the fix because `lastFailure` stayed `undefined`.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `tests/fakes.ts`, `tests/hooks.test.tsx`, `CHANGELOG.md`, `docs/api.md`,
  `docs/zh/api.md`, `docs/progress.md`.
- Verification: focused regressions fail before and pass after the fix;
  `pnpm test` 694/694 (34 files, +2 tests); `pnpm typecheck`, `pnpm lint`,
  `pnpm build`, `pnpm verify:compat`, `pnpm verify:pack`, and
  `git diff --check` all pass.
- Blockers: none. No storage-key, schema, protocol, or public API shape change.
- Risk / rollback: the only behavior change is that an explicit `stop()` no
  longer rejects when the transport's own teardown fails; the bus state, the
  teardown ordering, and restartability are unchanged, and the failure stays
  observable through `onError` and `getHealthSummary().lastFailure`. Roll back
  with `git revert e8d9001`.
- Audited and intentionally unchanged (2026-09-16):
  - `stop()`'s shared-promise cleanup still clears `this.stopPromise` from both
    the resolve and reject handlers. With the rejection path now unreachable for
    transport-stop failures the reject handler is defensive only, and a repeated
    `stop()` after teardown remains the documented no-op
    (`Promise.resolve()`), including when the first stop reported a failure.
  - A restart queued behind an in-flight `stop()` still runs: `queueStartAfterStop()`
    chains with `.catch(() => undefined)`, so the new fault tolerance does not
    change `stop → start` ordering or the cancellation token behavior.
- Next: React/Vue adapter parity (suspension/recreation races beyond the
  stop-failure path), then the remaining `ready()` boundary branches. Updated:
  2026-09-16.

## 0.20.87 transport failure ledger stamping (2026-09-16)

- Status: merged to `main` as `8adbc11` (`fix(data-bus): stamp a failed transport
  open once`) via **PR #36** (`feat/lifecycle-ledger-consistency`,
  rebase-merged, branch deleted); all checks green (`analyze`, `verify`,
  `browser`, `CodeQL`).
- Completed content: a failed transport open sampled the injected clock twice for
  one failure, so `getRecoveryStats().errorAt` and `getHealthSummary()
  .lastFailure.at` could describe the same failure with two different
  timestamps. The open-failure path now stamps the failure once (through
  `reportError()`) and clears `transportReady` before notifying status/error
  handlers, so a health snapshot taken inside an error callback can never report
  `transport.ready: true` for a transport whose open just failed. A page-hide
  round trip over a still-pending open is now pinned end to end: the superseded
  open settling must neither abort the queued resume nor clear the ready state
  the resume establishes.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/progress.md`.
- Verification: the ledger-stamping regression fails against the previous code
  (`expected 5003 to be 5002` with an advancing clock) and passes after the fix;
  `pnpm exec vitest run tests/data-bus.test.ts` 127/127.
- Blockers: none. No storage-key, schema, or public API shape change.
- Risk / rollback: only diagnostic timestamp equality and the ordering of the
  internal ready flag inside the failure block changed; readiness verdicts and
  recovery pacing are untouched. Roll back with `git revert 43d6d35`.
- Audited and intentionally unchanged (2026-09-16):
  - The unconditional `transportReady = false` at the top of `openTransport()`
    cannot clobber a newer lifecycle. `start()` assigns it synchronously under a
    freshly incremented epoch, and every reopen is *chained* after the previous
    `startPromise`/`pendingStop`, so a newer open can never complete before an
    older (superseded) open body begins. The new page-hide/page-show regression
    exercises the interleaving (async start gate + async stop gate) and confirms
    the newer lifecycle ends `state: 'healthy'`, `transport.ready: true`. The
    epoch guard inside the chain remains the load-bearing protection.
  - `ready()` still resolves while a runtime transport `error`/`disconnected`
    status is being auto-recovered (`transportReady` stays set until the
    recovery open begins). This is deliberate: the documented contract is that
    readiness tracks the installed transport's open, not protocol connectivity
    (`ready()` is explicitly "not equivalent to the server being connected"),
    and the recovery may swap in a healthy transport without a lifecycle
    transition. Clearing the flag on `error` would change `runTransport()` from
    "send to the current transport" to "kick an immediate reopen", bypassing the
    recovery cooldown and risking a retry loop driven by caller traffic. A
    narrow fix (defer transport operations to the scheduled recovery without
    reopening) is a separate design decision, not a drop-in change.
- Next: the stop-time boundary semantics noted below were picked up in the next
  section. Updated: 2026-09-16.

## 0.20.87 runtime transport recovery ledger (2026-09-16)

- Status: implementation, tests, docs, and CI complete; merged to `main` as
  `4417953` (`fix(data-bus): record runtime transport errors in the recovery
  ledger`) via **PR #34** (`feat/recovery-ledger-runtime-errors`, rebase-merged,
  branch deleted).
- Completed content: transport failures reported through runtime `onError` now
  update both the unified `lastFailure` record and the transport recovery
  ledger. Previously a successful open followed by a runtime failure could make
  one `getHealthSummary()` snapshot report `state: 'recovering'` together with
  `recovery.hasError: false`, `errorMessage: null`, and `errorAt: null`.
  Persistence and dispatch failures intentionally remain outside the transport
  recovery ledger; they stay visible through `lastFailure` and, where
  applicable, `getPersistenceStats()`.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `tests/fakes.ts`, `AGENTS.md`, `CHANGELOG.md`, `docs/api.md`,
  `docs/zh/api.md`.
- Verification: the focused regression failed before the fix
  (`recovery.hasError: false`, `errorMessage: null`) and passes after it; a
  companion regression proves handler/dispatch failures do not pollute the
  transport ledger. `pnpm test` 689/689 across 34 files, `pnpm typecheck`,
  `pnpm lint`, `pnpm build`, `pnpm verify:compat`, `pnpm verify:pack`,
  `pnpm test:coverage` 97.17% statements / 92.32% branches / 96.57% functions /
  98.64% lines, and `git diff --check` all pass. PR #34 CI: `verify`, `browser`,
  `analyze`, and CodeQL all passed.
- Blockers: none. No schema migration, storage-key change, or public API shape
  change.
- Risk / rollback: consumers that inspect both health ledgers now see the same
  transport failure consistently; non-transport failures retain prior behavior.
  Roll back with `git revert 4417953`.
- Next: audit stale asynchronous transport opens so an older open cannot clear
  the ready state of a newer lifecycle, then continue React/Vue adapter parity
  and stop-time lifecycle boundary checks. Updated: 2026-09-16.

## 0.20.87 BFCache readiness rejection (2026-09-16)

- Status: implementation, docs, and verification complete; merged to `main` as
  `b03601d` (`fix(data-bus): reject readiness while BFCache-suspended`) via
  **PR #32** (`feat/0.20.87-lifecycle-audit`, rebase-merged, branch deleted).
- Completed content: `ready()` no longer reports a BFCache-suspended bus as
  ready. `pagehide` chains `transport.stop()` and reuses the same promise for
  `startPromise`/`pendingStop` so `reopenTransport()` can tell a stop gate from
  a resume opening; `ready()` fell through to `if (this.startPromise) return
  this.startPromise` and resolved the moment cleanup finished, even though
  `publish()` was being dropped. `ready()` now checks `suspended` after the
  existing `stopping` gate and rejects with a suspended-state error;
  `pageshow`/`reopenTransport()` and an explicit `start()` clear the flag and
  install a real reopen promise. `getHealthSummary()` already reported
  `{ healthy: false, state: 'suspended' }`, so rejection matches that verdict.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`, `docs/progress.md`.
- Verification: the new regression
  (`does not report ready while the tab is BFCache-suspended`) failed before the
  fix; after it, `pnpm exec vitest run tests/data-bus.test.ts` 122/122,
  `pnpm test` 687/687 across 34 files (was 686; +1), `pnpm typecheck`,
  `pnpm lint`, `pnpm build`, `pnpm verify:compat`, `pnpm verify:pack` clean,
  `pnpm test:coverage` 97.16% statements / 92.31% branches / 96.57% functions /
  98.64% lines (no regression), `pnpm test:e2e` 27/27 (including the
  real-browser BFCache round-trip specs), `git diff --check` clean. PR CI:
  `verify`, `analyze`, `browser`, and CodeQL all passed.
- Behavioral contract note: an existing test used `ready()` as a
  wait-for-the-suspend-stop-gate primitive
  (`does not deliver transport operations while suspended during an async
  start`). That is the exact false-readiness confusion being fixed; it now
  asserts the rejection while keeping its publish-drop assertions.
- Blockers: none. No schema migration, storage-key change, or public export
  change.
- Risk / rollback: callers that awaited `ready()` on a hidden tab now receive a
  rejection instead of a resolved promise; the documented contract is that
  `ready()` never reports a transport that cannot carry data. Roll back with
  `git revert b03601d`.
- Next: continue the lifecycle/observability audit. Untouched candidates from
  the coverage map in `src/core/data-bus.ts`: the unconditional
  `transportReady = false` at the top of `openTransport()` (a stale-epoch call
  could in principle clobber a newer ready state), stop-time `subscribe`/
  `publish` ordering, and adapter parity between the React and Vue composables
  for suspend/resume and dependency-change teardown. Updated: 2026-09-16.

Session operating notes: work in local batches (10-20 real tasks), commit locally
during development, push once per completed phase after full local verification,
then check CI and fix failures automatically. If interrupted, resume from here.

## Current phase: v-next observability & parity audit

Phase goal: close real gaps in adapter parity, doc parity (EN/ZH) that drifted,
release-compat coverage for new public API, and demo/observability polish. No
fake tasks; each item is verified locally before being marked done.

## 0.20.86 RELEASED (2026-09-16)

- Status: RELEASED. Version **0.20.86** is merged to `origin/main`, tagged, and published to npm as `latest`; the tag-triggered Release workflow and published-consumer verification both passed.
- Branch/PR: `feat/0.20.86-release` → **PR #30**, merged with `--rebase` (branch deleted); base `79131eb` → release commit `4863640`.
- Completed content: version bumped to 0.20.86; `[Unreleased]` promoted to `[0.20.86] - 2026-09-16`; English and Chinese roadmap sections summarize the delivered lifecycle, replay, and documentation work.
- Release scope: queued-restart start/stop/readiness correctness and stop-time operation errors; replay transaction-abort settlement and unified age pruning; explicit post-exhaustion recovery; public replay/dedup option documentation plus property invariants.
- Migration: none. No public export removal or storage schema change; `verify:compat` confirms the v0.20.85 public surface is preserved.
- Verification: `pnpm check` (686/686, 34 files), lint clean, coverage 97.16% statements / 92.30% branches / 96.57% functions / 98.64% lines, `pnpm bench` 25/25, E2E 27/27, two browser benchmark runs with `bench:compare --fail-above-pct 50` green (largest observed delta +29.4%), compat from v0.20.85 green, packed ESM/CJS consumer green, public-registry audit clean, `npm pack --dry-run` 109 files (no `docs/progress.md`), and `git diff --check` clean.
- Release result: tag `v0.20.86`; GitHub release <https://github.com/Sun1090/cross-tab-worker-databus/releases/tag/v0.20.86>; Release workflow <https://github.com/Sun1090/cross-tab-worker-databus/actions/runs/35000351855> passed; npm verified `0.20.86` with `latest` pointing to it. Post-merge CI run <https://github.com/Sun1090/cross-tab-worker-databus/actions/runs/35000325037> and CodeQL run <https://github.com/Sun1090/cross-tab-worker-databus/actions/runs/35000325051> passed.
- Blockers: none.
- Risk / rollback: npm versions are immutable. If a defect is found, installers can pin `0.20.85`, then publish a corrective `0.20.87` patch; a non-published regression can be reverted with `git revert 4863640`. Do not delete or move the published tag.
- Next milestone: **0.20.87** — in progress; the BFCache readiness rejection above is the first shipped item. Updated: 2026-09-16.

## 0.20.86 canceled restart readiness rejection (2026-09-16)

- Status: implementation and documentation complete on
  `feat/queued-restart-failure-cleanup`; atomic code commit `385d82e`
  (`fix(data-bus): reject readiness for canceled restarts`) plus docs commit
  `4825f00` (`docs: record canceled restart readiness semantics`). The
  four-commit branch checkpoint is ready for PR integration.
- Completed content: `start()` intentionally resolves when a later `stop()`
  cancels a queued restart without opening a transport, but `ready()` returned
  that same promise and therefore reported a stopped bus as ready. `ready()`
  now uses a lazy, cancellation-aware readiness view keyed by the queued
  restart token: successful queued starts resolve normally, startup failures
  still reject with the underlying error, and canceled intents reject with a
  clear lifecycle error while `start()` retains its documented behavior.
  Concurrent `ready()` calls for the same queued intent share the readiness
  promise.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`, `docs/progress.md`.
- Verification: the new regression failed before the fix (readiness resolved
  after the queued restart was canceled) and passes after the full branch
  checkpoint battery: `pnpm check` (686/686 tests, 34 files), `pnpm lint`,
  `pnpm test:coverage` (97.16% statements, 92.30% branches, 96.57% functions,
  98.64% lines), `pnpm test:e2e` (27/27), `pnpm verify:compat`,
  `pnpm verify:pack`, and `git diff --check`.
- Blockers: none. No schema migration, public API shape change, or version bump.
- Risk / rollback: callers that observed `ready()` resolving after a canceled
  restart now receive a rejection and must call `start()` again after the stop
  settles. `start()` semantics are unchanged. Roll back with `git revert
  385d82e` plus the documentation commit.
- Next: push `feat/queued-restart-failure-cleanup`, open and verify the PR
  against `main`, then continue the lifecycle-contract audit with the next
  reproducible failure sequence.

## 0.20.86 failed queued-restart error retention (2026-09-16)

- Status: implementation complete on `feat/queued-restart-failure-cleanup`;
  atomic code commit `f363ccb` (`fix(data-bus): surface queued restart startup
  failures`).
- Completed content: a `start(config)` queued behind an in-flight `stop()` that
  then failed during transport startup cleared `started` as intended, but its
  failed lifecycle promise was no longer available to a later `ready()` call.
  With no `initialConfig`, `ready()` therefore fell through to the generic
  "requires initialConfig" error and hid the real transport failure. The ready
  contract now gives `lastError` precedence when an explicit start failed and no
  configuration is available to retry implicitly.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`, `docs/progress.md`.
- Verification: focused regression passes; `tests/data-bus.test.ts` 121/121;
  `pnpm test` 686/686 (34 files); `pnpm typecheck`; `pnpm lint`; `git diff
  --check`.
- Blockers: none. No schema migration, public API shape change, or version bump;
  the failure remains on the existing `ready()` rejection channel.
- Risk / rollback: callers that previously saw the generic config error now see
  the actual startup failure, and explicit retry behavior is unchanged. Roll
  back with `git revert f363ccb` plus the documentation commit.
- Next: audit readiness after a queued restart is canceled by a newer stop, then
  continue the lifecycle-contract edge sweep.

## 0.20.86 stop-time lifecycle operation rejection (2026-09-16)

- Status: implementation complete on `feat/stop-lifecycle-boundaries`; atomic
  code commit `ecf89c8` (`fix(data-bus): reject lifecycle calls during stop`).
- Completed content: `subscribe()` calls made while an explicit `stop()` was
  settling could mutate `topicHandlers`/`subscribedTopics` after teardown had
  begun. Depending on timing, the handler could be erased by
  `topicHandlers.clear()` while the cluster subscription survived into a later
  restart, or a handler could outlive the intended teardown. The DataBus now
  rejects late subscriptions through `onError` and returns a no-op cleanup
  without mutating either state. `ready()` likewise rejected false readiness
  during teardown instead of resolving against the stopping transport; when
  `start()` has already queued a restart behind that stop, `ready()` still
  follows the queued-start promise because it is the newest lifecycle intent.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`.
- Verification: two focused regressions failed before the fix (late
  `subscribe()` reported no error and left no matching teardown contract;
  `ready()` resolved during the gated stop) and pass after; `pnpm check` (685
  unit tests / 34 files); `pnpm lint`; `pnpm test:coverage` (97.25% statements,
  92.46% branches, 96.55% functions, 98.76% lines); `pnpm test:e2e` 27/27;
  `pnpm verify:compat`; `pnpm verify:pack`; `git diff --check`.
- Blockers: none. No schema migration, version bump, or public API shape change
  (the subscription failure is delivered through the existing `onError`
  channel).
- Risk / rollback: callers that subscribed during teardown now receive an
  error and must wait for `stop()` before restarting; `ready()` no longer
  resolves against a stopping transport. Normal start, suspend/resume,
  queued-restart, and post-stop auto-start behavior are unchanged. Roll back
  with `git revert ecf89c8`.
- Next: push the branch, open a PR, wait for all CI checks, and rebase-merge;
  then add a focused regression for queued-restart failure cleanup and continue
  the lifecycle audit.

## 0.20.86 stop-time publish rejection (2026-09-16)

- Status: implementation complete on `feat/stop-publish-rejection`; atomic code
  commit `517b14e` (`fix(data-bus): reject publishes during stop`).
- Completed content: `publish()` and non-empty `publishBatch()` calls made while
  an explicit `stop()` is still settling used to return successfully without
  routing anything: `cluster.publish()` reached the local `onControl(PUBLISH)`
  path, but `runTransport()` dropped the operation because `stopping` was set.
  The DataBus now checks the teardown gate at the publish boundary and surfaces
  a clear `onError` failure instead; empty batches stay no-ops. Publications
  queued before the stop remain canceled by the stop (latest intent wins), and
  BFCache suspension keeps its documented no-defer semantics.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`.
- Verification: two focused regressions failed before the fix (no error was
  reported for `publish()` or a two-item `publishBatch()` during a gated
  `stop()`) and pass after; `pnpm check` (683 unit tests / 34 files);
  `pnpm lint`; `pnpm test:coverage` (97.25% statements, 92.44% branches,
  96.55% functions, 98.76% lines); `pnpm test:e2e` 27/27; `pnpm verify:compat`;
  `pnpm verify:pack`; `git diff --check`.
- Blockers: none. No schema migration, version bump, or public API shape change
  (the failure is delivered through the existing `onError` channel).
- Risk / rollback: stop-time publications now produce an error callback instead
  of being silently dropped; callers that relied on the old silent behavior
  should wait for `stop()` to settle. Empty batches and suspend behavior are
  unchanged. Roll back with `git revert 517b14e`.
- Next: push the branch, open a PR, wait for all CI checks, rebase-merge, then
  continue the lifecycle audit (stop-time `subscribe()` handler/subscription
  consistency, then queued-restart failure cleanup).

## 0.20.86 stop cancels queued restart (2026-09-16)

- Status: implementation complete on `feat/stop-cancels-queued-restart`; atomic
  code commit `e78be57`
  (`fix(data-bus): cancel queued restart when stop is requested`).
- Completed content: a `start()` queued behind an in-flight explicit `stop()`
  is now invalidated by a later `stop()` instead of being swallowed by the
  already-published `stopPromise`. Each queued restart carries a monotonic
  token; `stop()` records the current token and frees the single queue slot, so
  the queued continuation (which is already chained to the stop promise and
  cannot be un-scheduled) resolves without opening a transport. A `start()`
  issued after the cancellation issues a higher token, so the latest lifecycle
  intent still wins: `stop → start → stop` ends stopped with no extra transport
  open, while `stop → start → stop → start` still ends running. Before the fix
  the second `stop()` returned the in-flight stop promise and the queued restart
  reopened the transport anyway (`transport.startCalls` became 2).
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`.
- Verification: focused regression `cancels a queued restart when stop()
  arrives before it can run` failed before the fix (startCalls 2, expected 1)
  and passes after; the companion `lets a start() issued after a canceling
  stop() queue a fresh restart` guards against over-cancellation; `pnpm check`
  (681 unit tests / 34 files); `pnpm lint`; `pnpm test:coverage` (97.24%
  statements, 92.41% branches, 96.54% functions, 98.76% lines);
  `pnpm test:e2e` 27/27; `pnpm verify:compat`; `pnpm verify:pack`;
  `git diff --check`.
- Blockers: none. No schema migration, version bump, or public API shape change.
- Risk / rollback: the queued continuation still resolves, so `await start()`
  following a canceling `stop()` no longer guarantees a running transport (the
  later `stop()` is the latest intent and `ready()` then rejects). Healthy
  start/stop, suspend/resume, and recovery paths are unchanged. Roll back with
  `git revert e78be57`.
- Next: push the branch, open a PR, wait for all CI checks, rebase-merge, then
  continue the lifecycle audit (stop-time `ready()`/`subscribe()`/`publish()`
  contracts, then queued-restart failure cleanup).

## 0.20.86 superseded transport-open invalidation (2026-09-16)

- Status: implementation complete on `feat/lifecycle-stale-open`; atomic code
  commit `046e2c2`
  (`fix(data-bus): invalidate superseded transport opens`).
- Completed content: asynchronous transport opens now carry a monotonic
  `lifecycleEpoch`. A fresh start, reopen, suspend, or stop invalidates older
  opens; stale message/status/error callbacks are ignored, and a stale failure
  can no longer clear `started`, null the newer `startPromise`, or tear down a
  newer page-hide/pageshow lifecycle. `stop()` now also waits for pending
  opens/reopens even when `started` was already cleared, so a superseded open
  cannot become ready after stop. Regression reproduces the previous race:
  initial async open + pagehide + pageshow + initial failure + stop; before the
  fix `stop()` resolved immediately and the queued reopen could still start.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`.
- Verification: focused regression failed before the fix and passes after;
  `pnpm check` (679 unit tests / 34 files); `pnpm lint`;
  `pnpm test:coverage` (97.23% statements, 92.34% branches, 96.54% functions,
  98.75% lines); `pnpm test:e2e` 27/27; `pnpm verify:compat`;
  `pnpm verify:pack`; `git diff --check`.
- Blockers: none. No schema migration or public API shape change.
- Risk / rollback: lifecycle ownership is now epoch-scoped; healthy
  start/recovery paths retain their existing serialization. Roll back with
  `git revert 046e2c2`.
- Next: push the branch, open a PR, wait for all CI checks, rebase-merge, then
  continue the lifecycle audit (especially queued-start intent when another
  stop arrives before the queued restart runs).

## 0.20.86 start/stop lifecycle serialization (2026-09-16)

- Status: implementation complete on `feat/start-during-stop`; atomic code
  commit `a6e4e49`
  (`fix(data-bus): serialize start with in-flight stop`).
- Completed content: `start()` no longer returns a page-hide cleanup promise
  when an asynchronous `transport.stop()` is still settling. It recognizes the
  `startPromise === pendingStop` lifecycle gate and queues a real reopen behind
  the stop. Explicit `stop()` now publishes a shared in-flight `stopPromise`;
  `start()` received while it settles stores one `queuedStart` and performs a
  fresh lifecycle only after `finally` has cleared the old state. Concurrent
  start/stop calls share their respective promises, and `ready()` follows a
  queued restart instead of observing the old ready state.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`, `docs/architecture.md`,
  `docs/zh/architecture.md`.
- Verification: focused regressions reproduced both prior failures (suspend stop
  did not reopen; explicit stop left the bus stopped after a resolved `start()`)
  and pass after the fix; `pnpm check` (678 unit tests / 34 files);
  `pnpm lint`; `pnpm test:coverage` (97.25% statements, 92.61% branches,
  96.53% functions, 98.75% lines); `pnpm test:e2e` 27/27;
  `pnpm verify:compat`; `pnpm verify:pack`; `git diff --check`.
- Blockers: none. No schema migration or public API shape change.
- Risk / rollback: lifecycle transitions now queue rather than overlap; a
  healthy no-op `start()` and degraded manual recovery are unchanged. Roll back
  with `git revert a6e4e49`.
- Next: push the branch, open a PR, wait for all CI checks, rebase-merge, then
  continue the lifecycle/reliability audit with the next concrete gap.

## 0.20.86 explicit retry after recovery exhaustion (2026-09-15)

- Status: implementation complete on `feat/recovery-error-state`; atomic code
  commit `07f1303`
  (`fix(data-bus): allow explicit retry after recovery exhaustion`).
- Completed content: `CrossTabDataBus.start()` no longer returns a resolved
  no-op when the bus is already started but its transport is down with the
  automatic recovery budget exhausted. It now keeps the cluster,
  subscriptions, and replay buffers intact, resets the unified
  failure/recovery ledger (including stale `errorAt`, persistence counters,
  recovery attempt/exhaustion, and cooldown state), and reopens the transport.
  This matches the public `degraded` recovery contract, which already
  documented explicit `start()` as a manual recovery path.
- Changed files: `src/core/data-bus.ts`, `tests/data-bus.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/zh/api.md`.
- Verification: focused regression reproduced the prior no-op failure and
  passes after the fix; `pnpm check` (676 unit tests / 34 files);
  `pnpm lint`; `pnpm test:coverage` (97.37% statements, 92.89% branches,
  96.88% functions, 98.82% lines); `pnpm test:e2e` 27/27;
  `pnpm verify:compat`; `pnpm verify:pack`; `git diff --check`.
- Blockers: none. No schema migration or public API shape change.
- Risk / rollback: an explicit `start()` call while the transport is down now
  triggers a reopen and resets the failure/recovery ledger instead of being a
  no-op; healthy `start()` calls remain no-ops. Roll back with
  `git revert 07f1303`.
- Next: commit this progress record, push the branch, open a PR, wait for all
  CI checks, rebase-merge, and continue the next reliability/coverage audit.

## 0.20.86 replay persistence abort safety (2026-09-15)

- Status: implementation complete on `feat/replay-persistence-error-coverage`;
  atomic code commit `366b0ce`
  (`fix(replay): settle persistence transactions on abort`).
- Completed content: every IndexedDB replay mutation now settles on
  `transaction.onabort`, including connection-loss aborts that emit no
  preceding request error; without this, the serialized mutation queue could
  remain blocked forever and later appends/clears would never run. `load()`
  now resolves only on `transaction.oncomplete`, so a `getAll` request that
  succeeds before a later abort cannot be reported as a successful read.
  Request/transaction failures with no `error` object use operation-specific
  fallback messages, and grouped batch reads keep the first failure
  authoritative.
- Changed files: `src/core/replay-persistence.ts`,
  `tests/replay-persistence.test.ts`, `CHANGELOG.md`.
- Verification: focused replay persistence suite 30/30; `pnpm check`
  (675 unit tests / 34 files); `pnpm lint`; `pnpm test:coverage` (97.36%
  statements, 92.87% branches, 96.88% functions, 98.82% lines);
  `pnpm test:e2e` 27/27; `pnpm verify:compat`; `pnpm verify:pack`;
  `git diff --check`.
- Blockers: none. No schema migration or public API change.
- Risk / rollback: the change tightens IndexedDB success semantics and makes
  failure paths settle instead of hanging. Roll back with `git revert 366b0ce`.
- Next: push this branch, open a PR, wait for all CI checks, rebase-merge, then
  continue the observability/parity audit with the next concrete coverage or
  reliability gap.

## 0.20.86 replay retention consistency (2026-09-15)

- Status: DONE on `feat/replay-retention-consistency`; atomic code commit
  `a87d8d5` (`fix(replay): unify age pruning across memory and persistence`).
- Completed content: extracted one internal `pruneReplayHistory` policy shared
  by the in-memory rings and IndexedDB adapter; AGE now removes expired
  timestamped entries even when they follow a timestamp-less legacy entry or a
  non-expired entry; hydration applies the configured policy instead of always
  truncating to `maxPerTopic`; timestamp-less legacy entries are count-capped
  under AGE so they cannot grow without bound; timestamped AGE entries remain
  bounded only by `retentionMs`.
- Changed files: `src/core/replay-pruning.ts` (new), `src/core/replay-manager.ts`,
  `src/core/replay-persistence.ts`, `src/core/data-bus.ts`,
  `tests/replay-manager.test.ts`, `tests/replay-persistence.test.ts`,
  `CHANGELOG.md`, `docs/api.md`, `docs/configuration.md`, `docs/zh/api.md`,
  `docs/zh/configuration.md`.
- Verification: focused replay suites 70/70; `pnpm check` (669 unit tests / 34
  files); `pnpm lint`; `pnpm test:coverage` (97.28% statements, 92.66% branches,
  96.81% functions, 98.8% lines); `pnpm test:e2e` 27/27;
  `pnpm verify:compat`; `pnpm verify:pack`; `git diff --check`. The first
  `verify:pack` invocation ran concurrently with the E2E build and read a
  transiently incomplete `dist`; the required serial rerun passed.
- Blockers: none. No schema migration is required.
- Risk / rollback: the intentional compatibility change is that unbounded
  timestamp-less replay history is now capped by `maxPerTopic` under AGE; AGE's
  timestamped entries still ignore the count cap and remain retention-bounded.
  Roll back with `git revert a87d8d5`.
- Next: continue the observability/parity audit; evaluate the existing local
  benchmark-refresh audit branch, then select the next concrete coverage or
  reliability gap.

## 0.20.85 publication confirmed (2026-09-14)

- npm registry now serves `cross-tab-worker-databus@0.20.85`; `latest` points to 0.20.85.
- GitHub Release workflow run `34792598054` passed after a transient npm registry propagation failure on the first attempt.
- Release tag `v0.20.85` is present on `origin`; release verification completed successfully.
- Next milestone: continue 0.20.86 observability/parity audit with a concrete code or test deepening task; do not republish 0.20.85.

## 0.20.86 dependency maintenance (2026-09-15)

- Merged Dependabot PR #18 (`@types/node` 26.5.0 → 26.5.1) after verify, browser, and CodeQL checks passed.
- Rebased the active feature branch onto updated `origin/main` (`0fe251a`).
- No application behavior changes; dependency update is covered by the existing CI gates.
- Next: continue the observability/parity audit with a concrete reliability or coverage improvement.

## 0.20.86 audit checkpoint (2026-09-14)

- Branch: `feat/0.20.86-audit`; working tree verified clean before generated benchmark refresh.
- Verification: `pnpm typecheck`, `pnpm test` (664 tests / 34 files), `pnpm test:coverage` (97.26% statements, 92.71% branches), `pnpm lint`, `pnpm build`, `pnpm test:e2e` (27/27), `pnpm bench` (25/25), `pnpm verify:compat`, and `pnpm verify:pack` all pass.
- `pnpm bench:trend` regenerated English and Chinese benchmark trend reports from 14 archived browser reports.
- No code defects or release-blocking failures found in this audit. The optional `--reporter=text` Vitest invocation is invalid in Vitest 5 (it treats `text` as a custom reporter); the documented `pnpm test:coverage` command remains green. `npm pack --dry-run` produced 0.20.85 with 107 files and no `docs/progress.md`. `pnpm audit --audit-level high` could not run because the configured `registry.npmmirror.com` does not implement the npm audit endpoint; the prior audit record remains clean.
- Next: continue the release-readiness dry run and select a concrete verification/deepening item before the 0.20.86 release decision.

## 0.20.86 line (post-0.20.85, in progress)

- PR #15 (merged): seeded property invariants for `selectActiveWorkers` /
  `selectRebalanceTarget` (subset / max-bound / non-empty / totality).
- PR #16 (merged): documented the full public option surface —
  `replay.pruneStrategy` (was absent), the replay options table
  (`maxPerTopic`, `persistence`, `retentionMs`, `pruneStrategy`,
  `retentionSweepMs`, `persistenceRetry`), and a deduplication options table
  (`maxEntries`, `ttlMs`, `sweepMs`, `now`, `adaptiveTtl`) — in both
  languages, plus a guard deriving the field list from the built declarations
  (mutation-checked). Corrected the `pruneStrategy` JSDoc default (`count`).
- CI infra incident: the CodeQL job on the PR #16 main push failed with
  "improved incremental analysis did not complete successfully" (disk space);
  the analysis itself succeeded and the failure was recorded in the Actions
  cache. Deleted the poisoned `codeql-overlay-status-*` cache entry so the
  next run analyzes without incremental mode. This progress commit re-triggers
  CodeQL on main to confirm.
- Verification (each PR): `pnpm check` (664 unit / 34 files), lint,
  e2e 27/27, `verify:pack`, `git diff --check`; PR checks green.

## 0.20.84 RELEASED to main (tag/publish left to maintainer)

- Status: DONE. Version **0.20.84** merged to `origin/main`.
- Branch/PR: `feat/release-0.20.84` → **PR #11**, merged with `--rebase`
  (branch deleted). base `74c041a` → merge head `1aac9d9`.
- Included tasks: phases 34–53 (release-gate enforcement, stranded-handoff
  recovery hardening, adaptive dedup TTL fix, Vue unmount leak fix,
  `effectiveWorkerLoad` corrupt-load finiteness fix, property suite, demo
  observability/a11y, coverage + toolchain).
- Verification: local full battery on the PR head + green CI on the PR
  (verify incl. coverage/compat/pack + browser + CodeQL). Post-merge CI on
  `1aac9d9` tracked.
- Tag/release: NOT pushed. Per `docs/release-checklist.md` the assistant does
  not run the final npm publish; the maintainer tags/publishes:
  `git tag v0.20.84 && git push origin v0.20.84` (Release workflow creates the
  GitHub release and publishes only when `NPM_TOKEN` is set), then confirms
  `verify:published`.
- Deploy: none. Smoke: local + CI. Rollback: `git revert` the merge commits on
  main, or re-tag from `v0.20.83` (additive/fix-only, safe).
- Next milestone: **0.20.85** (in progress below) — continue reliability/
  robustness hardening and adversarially-test the remaining pure helpers.

## Milestone 0.20.85 — adversarial robustness (release prepared)

- Branch `feat/release-0.20.85` off `origin/main`; version **0.20.85** (patch).
- Merged into the milestone:
  - PR #12 (`feat/payload-depth-hardening`): `approximatePayloadBytes`
    depth-bounded for cyclic/deeply nested payloads; `serializeError` kept
    structured-cloneable for any input.
  - PR #13 (`feat/replay-age-bound`): replay history bounded when
    `pruneStrategy: 'age'` has no `retentionMs` (in-memory + IndexedDB);
    seeded property suite extended to stateful manager invariants.
  - This branch: randomized `BatchingStorageWriter` drain property +
    `parseDataBusPublication` metadata-normalization property; version bump
    (`package.json` 0.20.85, `[Unreleased]` moved to `[0.20.85]`, both
    roadmaps updated with parity).
- Verification (release head): `pnpm check` 661 unit / 34 files; lint; e2e
  27/27; bench; `verify:compat` ("0.20.85 preserves … from v0.20.71");
  `verify:pack` (0.20.85 tgz); audit clean; `npm pack --dry-run` = 0.20.85,
  107 files, no `progress.md`; `git diff --check`.
- Tag/publish: NOT pushed (project policy: the assistant does not run the npm
  publish). Maintainer: `git tag v0.20.85 && git push origin v0.20.85`.
- Next milestone: continue adversarial testing of remaining surfaces
  (transport lifecycles, environment probes) and release when warranted.

## Baseline (2026-09-06, main @ 06dcc25)

- CI green for all prior pushes (last: browser 3m20s + verify 45s after reruns of
  the documented shared-runner handoff flake).
- `pnpm check` (typecheck+build+unit), `pnpm lint`, `pnpm test:e2e` (20 tests),
  `pnpm bench`, `pnpm verify:pack` all green locally.
- Public API additions not yet re-verified against release gates:
  `loadWeighting` / `WorkerThroughputSample.overrunMs` /
  `getMetrics()` / `getDiagnostics().replay.bytes`.

## Task pool (this phase)

1. [x] Adapter parity audit (React vs Vue) — parity confirmed, StrictMode React-only.
2. [x] README feature list (EN+ZH) — added weighting/bridge/diagnostics bullets.
3. [x] Docs EN/ZH parity sweep — zh roadmap gap fixed.
4. [x] verify:pack covers new exports — packed-consumer now smoke-imports full surface.
5. [x] Demo observability — already shipped (diagnostics row + adaptive-weighting e2e).
6. [x] scheduleLagWeight cluster steering test — added (A starved/B healthy, weight 3 → B).
7. [x] getMetrics vs flushed event full-field parity — strengthened trace.test.ts.
8. [x] Release checklist verify:pack/bench gate — already present, confirmed.
9. [x] verify:compat documented in checklist Before-tagging run.
10. [x] CHANGELOG [Unreleased] QA bullet.

## Phase 1 result (pushed 06dcc25..362adef, CI green on first try)

- verify 49s + browser 3m13s (incl. new Bench smoke step). Repo has only ci.yml +
  release.yml (no CodeQL/dependabot/deploy workflows to scan for this push).
- Local verification before push: pnpm check (438 tests), lint, test:e2e (20/20),
  bench, verify:pack all green.

## Phase 2 pool (packaging hygiene + observability polish)

1. [x] Exclude docs/progress.md (internal tracking doc) from the published tarball.
      -> npm ignores do NOT apply to files-allowlisted paths in this npm version
      (verified empirically), so package.json files now enumerates docs files
      explicitly; pack --dry-run: 105 files, hasProgress=false, 18 docs ship.
2. [x] Demo renderConfig shows the loadWeighting active state in the config panel.
      -> New config row: '负载加权' shows 启用（消息/字节/滞后） or 禁用（纯 Topic 数）
      based on the toggle; e2e single-owner + adaptive-weighting still pass.
3. [x] Routing bench: add a scheduleLagWeight variant to the weighted scoring baseline.
      -> tests/bench/routing.bench.ts adds 'selectLeastLoadedWorker / 50 workers /
      weighted + lag' (1.7M ops/s), validating the third score term's cost.
4. [x] approximatePayloadBytes test: explicit DataView (and Uint8Array view) coverage.
      -> tests/routing.test.ts 'binary payloads and views': Uint8Array view,
      DataView over a buffer, Float64Array(4) report their own byteLength.
5. [x] npm pack --dry-run --json audit: confirm only intended files ship.
      -> Done as part of task 1 (105 files, no progress.md, all docs/dist ship).
6. [x] README/Getting-Started: link docs/configuration.md adaptive-weighting anchor
      from the README feature bullet (navigation polish).
      -> README loadWeighting bullet links ./docs/configuration.md#adaptive-owner-weighting.
7. [x] Progress-pad: fold phase-2 changes into CHANGELOG [Unreleased] + this file.
      -> CHANGELOG [Unreleased]: Packaging + Changed bullets added.

## Phase 2 result (pushed 362adef..dd89853, CI green on first try)

- verify 52s + browser 2m33s. Local: check (438), lint, e2e (20/20), bench, verify:pack.
- Shipped: packaging (enumerated docs files, progress.md excluded), demo config-panel
  weighting state, +lag bench baseline, DataView sizing coverage, README weighting link.

## Phase 3 pool (security & release infrastructure)

1. [x] Add .github/workflows/codeql.yml (static analysis on push/PR; javascript-typescript).
2. [x] Add .github/dependabot.yml (weekly npm + GitHub Actions).
3. [x] verify-version-compat: auto-derive baseline from the latest git tag (keep
      COMPAT_BASE_TAG override), so the export contract is checked against the last
      release instead of a fixed v0.20.31. -> [compat] 0.20.83 ... from v0.20.71.
4. [x] Validate new workflow YAMLs (basic structural check) and verify:compat locally.
      -> python yaml.safe_load parses codeql.yml + dependabot.yml; verify:compat green.
5. [x] Fold phase-3 into CHANGELOG [Unreleased] + this file.
      -> CHANGELOG: Security/CI infrastructure bullet (CodeQL + Dependabot +
      verify:compat auto-baseline).

## Phase 3 result (pushed dd89853..d9c8296, CI + CodeQL green)

- CI verify 47s + browser 3m18s; CodeQL run SUCCESS on push (1m35s).
- Dependabot config became active immediately: auto-PRs opened for react/react-dom
  (npm) and github/codeql-action 3→4 (actions). Not merged by this agent; they run
  their own CI on dependabot branches.
- codeql.yml bumped to github/codeql-action@v4 (current major).

## Phase 4 pool (frontier — audit first, then pick verifiable items)

1. [x] Audit npm deps for known vulnerabilities (npm audit) and record result.
      -> 2 high via dev chain (glob<10.5.0, nanoid<3.3.18); fixed with pnpm
      overrides in pnpm-workspace.yaml (pnpm v10 home — the package.json pnpm
      field is ignored); pnpm audit now clean; pnpm check still 438 green.
2. [x] Decide react/react-dom/codeql-action dependabot PRs: verify locally, merge or
      close with reason.
      -> Resolved: #4 codeql-action 3→4 CLOSED (workflow already on v4). Merged:
      #3 @types/node, #1 jsdom 25→30, #6 globals, #5 react — each after verify+CodeQL
      green (browser handoff flake rerun where needed; main CI green after each merge).
      #2 typescript 5.9→6.0 still OPEN: verify passes (TS6 compiles/tests fine), browser
      has failed on the documented shared-runner handoff flake across reruns; a fresh
      dependabot rebase run is in flight. Deferred until green rather than merged red.
3. [x] `verify:published` release-gate parity: confirm the published-consumer path
      exercises the same full-surface smoke import as verify:pack.
      -> verify-published-consumer.mjs now imports the same 12 root functions +
      3 subpaths in ESM/CJS (node --check ok; full run needs a published version).
4. [x] docs/zh release-checklist: mirror the verify:compat + CodeQL/Dependabot notes.
5. [x] CHANGELOG [Unreleased] fold for phase-4 + this file.
      -> Dependency-security + verify:published bullets added.

## Phase 5 (in progress — Dependabot influx + doc parity finishing)

- Merged dependabot PRs (each after verify+CodeQL green; browser handoff flake
  rerun where needed): #1 jsdom 25→30, #3 @types/node, #5 react/react-dom, #6 globals,
  #9 eslint 9→10, #7 esbuild 0.25→0.28, #2 typescript 5.9→6.0, #8 typescript-eslint
  8.69. All merges verified locally (check 439 / lint / e2e-in-isolation green; the
  full-suite e2e handoff failures pass in isolation — known shared-runner + local-load
  flake). #4 codeql-action 3→4 closed (workflow already on v4).
- All dependabot PRs resolved; no open PRs remain.
- Release gates under the major toolchain bumps re-verified: pnpm bench,
  verify:pack, verify:compat (baseline v0.20.71) all green.
- CI: pnpm audit added to the verify job (dependency scan institutionalized);
  release checklists (en+zh) document the audit gate. Final HEAD CI green
  (verify + browser + CodeQL), audit step passes.
- Doc parity: architecture.md + zh gained the adaptive-owner-weighting and
  credential-bridge subsections (committed 2e064a9, documentation test green).
- centrifuge default-factory SSR guards confirmed already covered (stub tests).

## Post-phase-5 genuine fixes (coverage-driven)

- test: bounded dedup eviction path (data-bus.test.ts) — the existing maxEntries:2
  test only tracked two IDs so the FIFO eviction loop never ran; new test overflows
  the set and pins "evicted ID re-delivered, in-set ID still suppressed".
- fix: COORDINATION trace event carried an always-empty routes list (emitted
  synchronously before subscription writes flushed through the batching writer).
  Now emitted after the transport open resolves so routes/roles are settled;
  new test asserts the formatted topicKey@workerId|confirmed=… entries.
- Local verification: 441 unit tests, lint, e2e-in-isolation green.
- bench:browser + bench:compare gate re-verified on the final toolchain (TS6 /
  esbuild 0.28 / eslint 10): databus matrix numbers realistic, no regression
  over 50%. Full e2e 20/20 green.
- docs: CHANGELOG + api.md (en+zh) document the coordination-event fix and its
  settled route list.

## Definitive verification record (2026-09-07, main @ 8b56ebe)

- pnpm audit (public registry): no known vulnerabilities.
- verify:compat: 0.20.83 preserves exports/types from v0.20.71.
- bench (Node smoke) + bench:browser + bench:compare gate: green, no >50% regression.
- pnpm check (441), lint, e2e (20/20), verify:pack (full-surface), npm pack
  (105 files, no progress.md), git diff --check: all green.
- CI + CodeQL green on the final HEAD (after one documented handoff-flake rerun).
- No open PRs; working tree clean.

## Phase 6 (in progress — flake-class fix + bench trend doc)

- Real flake defect found and fixed: the storage-event pagehide-handoff E2E
  polled with HANDOFF_TIMEOUT_MS (60 s) under the default 60 s test timeout —
  its 45 s convergence wait stacked with the handoff poll, so a healthy-but-
  slow run died on the test-level ceiling. Playwright default timeout raised
  to 90 s (covers all stacked budgets) and the test now sets 120 s explicitly.
  Full e2e 20/20 green locally after the fix.
- Bench drift: new `pnpm bench:trend` (scripts/bench-trend.mjs) generates
  docs/benchmarks.md + zh mirror from the archived bench-results/ reports
  (latest/previous/delta + all-time best per metric). Both docs registered in
  the docs indexes and the package files allowlist (npm pack: 107 files, both
  ship; progress.md still excluded). Release checklist (en+zh) gained the
  benchmark-gate step; zh checklist additionally gained the previously missing
  browser-benchmark gate bullet (EN/ZH parity).
- bench:compare --fail-above-pct 50 gate green on the current archive.

## Phase 6 result (pushed 0f94c41..fa10235..27c3af6, CI green on first try)

- fa10235: storage-event handoff timeout-budget fix (90s global + 120s test),
  bench:trend generator + docs/benchmarks.md (en+zh) shipped in the tarball,
  release checklists document the benchmark gate (zh gained the missing bullet).
- 27c3af6: systematic per-test budget audit (scripted) — eight more tests
  stacked explicit 30–45s waits above the ceiling without their own
  test.setTimeout; each now has a worst-case budget. Full e2e 20/20 green.
- CI green on both pushes with zero reruns — first push since the flake was
  documented that needed no handoff-flake rerun, which is itself evidence the
  diagnosis (budget stacking, not runner flake) was correct.
- Local verification at fa10235: 445 unit tests, lint, e2e 20/20, bench,
  verify:compat (v0.20.71 baseline), verify:pack, audit (public registry),
  npm pack dry-run (107 files, benchmarks ship, progress.md excluded),
  git diff --check — all green.

## Phase 7 (coverage-driven gap hunt — in progress)

- Coverage run (445 tests) identified real untested error paths: storage-utils
  82% (all four swallow branches), websocket binary error paths, dedup option
  validation branches, retention-cleanup failure/draining, IndexedDB
  read-request failures.
- New tests (15 added, 445 → 460):
  - tests/storage-utils.test.ts — new fault-injection file (BrokenStorage/
    CorruptStorage doubles); storage-utils now 100% stmts+branches.
  - websocket.test.ts — poisoned-Blob conversion isolation + 16-bit topic-
    length boundary (0x10000 errors with zero sends; exactly 0xffff frames).
  - centrifuge.test.ts — factory-less SSR degradation resolves `local` with
    no error; throwing injected factory surfaces instead of silent degrade.
  - data-bus.test.ts — invalid dedup options (maxEntries/ttlMs/sweepMs/
    adaptiveTtl bounds) throw before construction; failing durable retention
    pass reports once and later flushes still work; queued cutoff drained by
    the cleanup loop. (Discovery: hydration issues its own pre-load
    clearBefore pass at construction — tests now baseline it.)
  - replay-persistence.test.ts — load/clearBefore request-failure paths
    reject + invalidate; fault-proxy tx wrapper now forwards oncomplete/
    onerror (was structurally impossible to drive the clear path before).
- Coverage after: storage-utils 100/100, validation 100/96.55, websocket
  97.19/85 (remaining: SSR guard + default-factory branches unreachable in
  Node), overall 96.31 → 96.79 stmts (vitest-4 accounting includes barrel
  files; raw source numbers improved across the board).
- Security: new GHSA-82fw-gwwq-j7x9 advisory (vitest/@vitest/mocker path
  traversal) failed the audit gate → vitest upgraded 3.2 → 4.1.11 with
  matching @vitest/coverage-v8. Full suite re-verified on the new major:
  typecheck (one explicit-callback typing fix in cluster.test.ts), 460 unit,
  coverage, bench, e2e 20/20, verify:pack, verify:compat, audit clean.
- Full verification: typecheck, 460 unit, lint green.

## Phase 7 result (pushed 6d3e89d..ca05cd6..786812e, CI green on second push)

- ca05cd6: 15 new tests (445 → 460) across storage-utils (new file, 100%
  stmts+branches), websocket binary error paths, centrifuge factory
  degradation, dedup option validation, retention-cleanup failure/draining,
  IndexedDB read-request failures. Plus the GHSA-82fw-gwwq-j7x9 fix: vitest
  3.2 → 4.1.11 (+coverage provider), one mock-typing fix; audit clean.
- First push failed only on the public-docs guard: the CHANGELOG security
  note named two scoped dev packages (@scope/ references are forbidden in
  shipped docs). 786812e rewrote the note without scoped names. The guard
  doing its job — caught it in CI before any release path saw it.
- CI green on 786812e (verify 47s + browser 6m21s + CodeQL).

## Phase 8 (release-checklist dry run on the current toolchain)

- bench:browser run archived (2026-09-09T03:26); bench:compare 50% gate green
  — no metric regressed (dedup -15%, wildcard dispatch -14%, publish -5.5%);
  bench:trend refreshed docs/benchmarks.md (en+zh), committed cb643b2.
- npm pack audit: 107 files (benchmark docs ship, progress.md excluded);
  verify:pack full-surface ESM/CJS smoke green; verify:compat green against
  v0.20.71.
- pnpm audit (public registry): no known vulnerabilities.
- Dependency batch update (minor/patch only, majors deliberately deferred:
  vitest 5 / eslint / typescript majors are not patch-level moves): playwright
  1.63, eslint 10.10, typescript-eslint 8.70, @eslint/js 10.0.1, @types/node
  26.5, centrifuge 5.7.3. Verified: typecheck, 460 unit, lint, build, e2e
  20/20, verify:pack. CI green (verify + browser + CodeQL) on 549cfe8.
- No open dependabot PRs; working tree clean at 549cfe8 + this doc.

## Phase 9 (coverage residuals — error-utils direct unit file)

- tests/error-utils.test.ts (new, 10 tests): stack preservation/omission,
  non-Error shapes (string/object/undefined/number/boolean), context
  reconstruction, round-trip identity. error-utils now 100% stmts+branches;
  470 unit tests.
- environment.ts residual line 131 (storage-event JSON.parse catch) is
  behaviorally exercised by storage-channel.test.ts's malformed-payload test;
  the v8 statement map does not credit the full-suite run (esbuild try/catch
  statement-map artifact) — direct-hit probe confirmed the statement executes.
  Not chased further; the behavior is pinned.
- CI green on 8661f28 (verify + browser + CodeQL).

## Phase 10 (vue composable edge paths)

- Three new vue.test.ts cases (470 → 473): superseded-start cycle stops the
  abandoned bus without mounting it; identical bus+topic sync re-run takes
  the no-op early return (no resubscribe churn); reactive handler swap
  updates latestHandler in place without resubscribing.
- Remaining vue.ts uncovered lines (20: generation-guard continuation that
  only fires when stop() is still pending across a supersede; 45/54:
  defensive watches unreachable through the public API) are documented
  defensive paths — behavior already pinned by the new tests.
- CI green on 0523123 (verify + browser + CodeQL).

## Phase 11 (demo accessibility)

- Status badge is now `role="status" aria-live="polite"` — connection
  transitions are announced to assistive tech.
- The event table gained a visually-hidden caption describing its behavior
  (newest rows on top); the `.visually-hidden` utility joined styles.css.
- The icon-only clear button got an explicit `aria-label`.
- All 20 e2e green (caption is display-concealed, selectors untouched).
- CI green on 8cdfa33.

## Definitive verification record (2026-09-09, main @ 4c9679c + phase-12 battery)

- pnpm check: typecheck + build + 473 unit tests green (26 files).
- lint, e2e 20/20, bench (Node), bench:browser + bench:compare 50% gate,
  verify:pack (full-surface ESM/CJS), verify:compat (v0.20.71 baseline),
  pnpm audit (public registry): no known vulnerabilities, git diff --check.
- npm pack dry-run: 107 files (benchmark docs ship; progress.md excluded).
- CI + CodeQL green on every pushed commit this session (no reruns needed
  since the phase-6 timeout-budget fix).
- Cumulative session output: E2E timeout-budget unstacking (the documented
  flake class eliminated — evidence: three consecutive green browser jobs
  with zero retries), bench trend doc + generator, 28 new unit tests
  (445 → 473) across storage-utils/error-utils/websocket/centrifuge/
  data-bus/replay-persistence/vue, vitest 4.1.11 security upgrade,
  dev-dependency minor/patch batch, demo a11y (live regions + labels).

## Phase 12 (in progress — stranded-handoff root-cause fix)

- CI failure on docs-only HEAD 07d1cf9: multi-tab soak stuck 60 s x3 at
  `demo.spec.ts:380` (`waitForSingleOwner(survivors)` returns 0 holders).
  Trace forensics: the suspended owner shows `lifecycle:suspend` + `已断开`
  (pause() ran), the storage route still names the dead owner's worker, both
  survivors report 0 assigned topics.
- Root cause (real product bug, not runner noise): if the previous owner's
  `ROUTE_RELEASED` never reaches the new owner, the route sits unconfirmed
  with `handoffFromWorkerId` set and a live new owner — and reconcile
  deliberately never retries SUBSCRIBE in that state (strict-handoff
  no-overlap rule), with no deadline. Permanent stall; the 60 s poll and the
  120 s test budget only masked it.
- Fix (`src/core/cluster.ts` reconcileSubscriptions + `isStaleHandoff`
  helper): once the previous owner is gone AND the handoff is older than a
  worker TTL, re-elect a live owner with a fresh generation and a cleared
  handoff marker. The age gate was load-bearing during development: the first
  cut without it broke the four-tab handoff test, because a peer observing a
  just-written (confirmation not yet flushed) route mistook it for stranded.
- Tests (`tests/cluster.test.ts`, +2): stranded-route + dead owner recovers
  after the TTL (gen 3, confirmed, marker cleared, single SUBSCRIBE, stable
  on re-reconcile); same state with the previous owner alive keeps waiting
  (no re-elect, no SUBSCRIBE). Mutation-checked: recovery test fails with
  the src fix reverted. 475 unit tests green.
- Docs: architecture.md + zh rewritten handoff-recovery invariants
  (stranded-handoff subsection; loss-matrix bullet now describes the
  TTL-gated re-election instead of "re-elect when the owner resumes");
  CHANGELOG [Unreleased] gains a Fixed entry (no scoped package names —
  docs-guard safe).

## Phase 12 result (pushed 07d1cf9..548aee8, CI green on first try)

- Local battery before push: check (475 unit), lint, e2e 20/20, bench,
  verify:pack, verify:compat (v0.20.71), audit clean, diff-check.
- CI green: verify + browser + CodeQL on the fix commit — the multi-tab
  soak that failed 60 s x3 on the docs-only HEAD now passes in CI, which
  corroborates the stranded-handoff diagnosis (a pure runner-noise failure
  would not be fixed by a reconcile change).
- Shipped: reconcile TTL-gated re-election of stranded unconfirmed handoffs
  (+2 unit regressions, mutation-checked), architecture EN+ZH invariant
  rewrite, CHANGELOG Fixed entry.

## Phase 13 (release-checklist dry run, post-fix tree)

- bench:browser archived (2026-09-09T08-58); bench:compare 50% gate green
  (all deltas within noise: -4%..+4.8%); bench:trend refreshed (11 reports),
  committed dbf077a.
- npm pack dry-run: 107 files, progress.md excluded — unchanged.
- verify:pack + verify:compat (v0.20.71) green; audit clean.
- verify:published: npm latest is still 0.20.71 (0.20.83 unpublished,
  expected pre-release state); the consumer-verifier path itself was
  verified in earlier phases — nothing new to dry-run until a tag is cut.
- CI green on dbf077a (verify + browser + CodeQL).

## Phase 14 (in progress — handoff-cooperation coverage + test hygiene)

- New cluster regression: old owner still holding a handed-off assignment
  drops it and re-sends ROUTE_RELEASED on reconcile, letting the new owner
  confirm with no re-election churn (generation stays 2). Mutation-checked
  both ways (probe removing the resend fails the test; restore passes).
- Hygiene: crafted stranded-route fixtures now strip `confirmedAt` with
  `delete` instead of rest-spread + `void`.
- 476 unit tests green (475 + 1); typecheck, lint, diff-check green.

## Phase 14 result (pushed 4d8f9d7..7e358cb, CI green on first try)

- CI green: verify + browser + CodeQL. Docs-only follow-ups not needed
  (no shipped-doc changes this round).

## Phase 15 (in progress — wire-loss end-to-end regression + soak repetition)

- New cluster regression drives a REAL pageHide() with the ROUTE_RELEASED
  dropped in transit (hub.send monkey-patch): asserts the handoff route
  genuinely moves to the survivor unconfirmed, the fresh handoff waits, and
  post-TTL reconcile converges with confirmation. Mutation-checked (branch
  disabled → fails; enabled → passes).
- Soak E2E repeated 3x locally green (2.4–7.4 s each) on top of the earlier
  full 20/20 + CI green.
- 477 unit tests green; typecheck, lint, diff-check green.

## Phase 15 result (pushed d5ba840..6ea82ac, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 16 (in progress — post-fix stability evidence)

- Baseline sweep: zero TODO/FIXME/XXX/HACK; audit clean; no secrets;
  no open PRs; outdated = deferred majors only (eslint 10, vitest 5,
  TS 7) + auto-installed centrifuge peer (no package.json entry to bump).
- Full e2e 20/20 locally x2 more (16.5 s, 13.8 s). Cumulative post-fix
  evidence: 4 consecutive local full-suite greens + soak isolation 3/3 +
  green CI browser jobs on every push since the fix, zero retries.

## Phase 17 (in progress — multi-round stranded-handoff soak)

- New cluster soak: 3 consecutive owners each pageHide() with the ACK
  dropped; every round converges on exactly one confirmed holder with the
  marker cleared and a monotonically increasing generation, and a pageshowed
  owner reuses the replacement route instead of taking it back.
- Two test-harness findings fixed in the test (not src): time must advance
  in 1 s heartbeat steps (a single +11 s jump strands peer heartbeats in
  writer pending queues, making live peers look TTL-dead — fake-clock
  artifact), and rounds must pageshow the suspended owner (last-subscriber
  -out legitimately deletes the route by design).
- Noted dynamics (pre-existing class, also present in the crash-recovery
  path): two survivors may re-elect on the same stale view with
  last-writer-wins; the holder's next reconcile self-heals confirmation via
  the normal unconfirmed-route retry — covered by the settle round.
- 478 unit tests green; typecheck, lint, diff-check green.

## Phase 17 result (pushed ccdabd5..484ed4c, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 18 (in progress — coverage residuals round 2)

- port-reaper.test.ts: throwing reap target is isolated — a port whose
  close() throws does not prevent the remaining ports from being reaped on
  the same tick, and the reaper keeps working afterwards (new port lifecycle
  normal). Mutation-checked (catch rethrows → fails; restored → passes).
  (Boundary learned: reap needs age strictly greater than the timeout with
  10 s ticks, so probes use 41 s windows like the existing tests.)
- storage-batch.test.ts: setTimeout fallback when queueMicrotask is absent —
  microtask drain first proves the microtask path was not taken, then the
  macrotask flush lands exactly once. Mutation-checked (forced microtask
  path → fails; restored → passes).
- 480 unit tests green (478 + 2); typecheck, lint, diff-check green.

## Phase 18 result (pushed f8c8735..ea1ebf1, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 19 (in progress — cluster defensive-branch coverage)

- pause()-path orphan prune (`readSubscriberTabIds` duplicate branch):
  new test crafts a ghost subscriber with no worker record and drives a
  real pageHide — the ghost is ignored/removed in pause() itself and the
  route is deleted (no live subscribers) rather than handed off.
  Mutation-checked (branch removed → fails; restored → passes). This also
  documents why the duplicate prune must stay despite reconcile's cleanup
  running first (pause never runs that cleanup).
- Unknown CONTROL action wire-compat: a future-protocol action falls
  through to the generic metadata + onControl dispatch without throwing.
  Mutation-checked (default returns early → fails; restored → passes).
- 482 unit tests green (480 + 2); typecheck, lint, diff-check green.

## Phase 19 result (pushed a31f7da..0a8a76c, CI green on first try)

- CI green: verify + browser + CodeQL.
- Final-tree browser proof: full e2e 20/20 locally (21.8 s) on the closing
  tree (unit-test-only changes since the post-fix 20/20, re-confirmed).
- Coverage residuals triaged to defensive-only: trace.ts:445 unreachable
  (rank ≤ count always for the 0.5/0.95/1 callers), env.ts:131 esbuild
  artifact (behaviorally pinned), hooks/vue/websocket/centrifuge guards
  unreachable through public API in Node, `?? currentRecord` twins
  unreachable (self always present when started).

## Phase 20 (in progress — post-merge surveillance)

- External sweep: no open PRs, audit clean, zero TODO/FIXME, outdated =
  deferred majors only (no actionable patch/minor drift since phase 8).
- Targeted re-verification on the closing tree: cluster + stability unit
  (68 passed), soak e2e in isolation (1 passed), BFCache e2e group in
  isolation (3 passed).

## Phase 21 (in progress — deferred major upgrades, one at a time)

- `@eslint/js` 9 → 10 (completes the eslint 10 upgrade): lint clean with no
  new violations; check (482 unit) green.
- vitest 4 → 5 (+ coverage provider): 482 unit + coverage green on the new
  runner. The major rewrote the benchmarking API (`bench` module-scope
  import removed; now a test-context fixture), which broke `pnpm bench`
  (`bench is not a function` on all 3 files) — migrated all 25 benchmarks
  to `test(name, async ({ bench }) => { await bench(name, fn).run(); })`
  per the official migration guide. Bench suite green with identical
  hot-path numbers; no `benchmark.*` config keys existed to clean up.
- Full battery on the vitest-5 tree: typecheck, lint, e2e 20/20,
  verify:pack, verify:compat (v0.20.71), audit clean, diff-check.

## Phase 23 (TypeScript 7 evaluation — reverted with evidence)

- Installed TS 7.0.2: `tsc` clean and 482 unit green, but `pnpm lint`
  hard-fails — typescript-eslint 8.70 does not support TS 7.0 (upstream
  tracks TS >= 7.1, suggests side-by-side TS 6 API). No available fix
  without dropping the lint gate, so reverted to TS 6; tree clean.
  Deferral is now evidence-based: retry when typescript-eslint supports
  the TS 7 line.

## Phase 24 (in progress — handoff-recovery trace observability)

- Feature: stranded-handoff re-elections now emit `reliability` trace
  events with `operation: 'route_migration_recovery'`, distinct from the
  routine graceful-handoff `route_migration` (new
  `RELIABILITY_OPERATION` key; internal trace payload only, zero public
  export-surface impact — verify:compat green).
- Tests: recovery path pins the new op (and absence of the old one);
  graceful four-tab handoff pins the old op (and absence of the new one).
- Docs: API reference trace section (EN+ZH) + CHANGELOG Added entry.
- 482 unit green; typecheck, lint, verify:compat, diff-check green.

## Phase 24 result (pushed 7e2db21..a203094, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 25 (in progress — demo renders reliability trace events)

- Real gap: the demo trace sink dropped `reliability` events, so the new
  recovery diagnostics (and all migration/retry observability) were
  invisible in the product demo. `handleTraceEvent` now renders them into
  the event feed with Chinese operation labels
  (`reliability:<operation>` + label + bounded details).
- E2E: new test pins the initial route-acknowledgment row (op + label).
  Isolation green (2.1 s); full suite 21/21 green.
- 482 unit green; typecheck, lint green.

## Phase 25 result (pushed 12add67..ba96c63, CI green on first try)

- CI green: verify + browser (21 e2e incl. the new reliability-feed test) + CodeQL.

## Phase 26 (in progress — full low-frequency trace coverage in the demo feed)

- Extended the phase-25 feed work: `subscription` and `coordination`
  trace events now also render as bounded diagnostic rows (action + active
  count; coordinated worker/route counts only — arrays stay out of the
  DOM). The feed now covers every low-frequency trace event type.
- E2E broadened to pin all three diagnostic rows on connect.
- Full suite 21/21 green; typecheck, lint green.

## Phase 26 result (pushed c57ee87..fafd8ce, CI green on first try)

- CI green: verify + browser (21 e2e) + CodeQL.

## Phase 27 (in progress — recovery-op end-to-end sink coverage)

- Data-bus-level test drives two live buses through a real pageHide with
  the ACK dropped: past the TTL the survivor re-elects and the public
  trace sink carries `reliability` / `route_migration_recovery` (and never
  the graceful op) for the topic. Mutation-checked (forwarding cut →
  fails; restored → passes).
- 483 unit tests green (482 + 1); typecheck, lint, diff-check green.

## Phase 27 result (pushed 1ece57c..1634121, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 28 (in progress — single-writer + projected loads for recovery)

- Found via the new distribution test failing: concurrent re-elections
  from divergent cross-tab views ping-ponged generations and dropped
  confirmations (each fresh write is unconfirmed by construction), with
  per-pass SUBSCRIBE churn and topic pile-up. Debug forensics (temporary
  elect/write/confirm/assign logging, removed afterwards) pinned the exact
  interleaving.
- Fix (`src/core/cluster.ts`): single-writer rule (only the elected owner
  writes; peers stand down, views converge on the next flush) + projected
  loads within the pass (mirrors graceful handoff). Standing down stays
  live: bounded by one heartbeat, then all peers agree.
- Process lesson recorded: never restore probes from /tmp snapshots (an
  expired snapshot silently clobbered the rule mid-session and all later
  analysis ran against rule-less code — which itself corroborated the
  rule's necessity). Snapshots purged; src fix committed immediately
  (59d8c33) before further probing.
- Tests: distribution (one topic per survivor, confirmed, markers cleared,
  per-share diagnostics) + multi-round soak convergence; 484 unit, 21 e2e,
  bench, pack, compat, audit, lint, diff-check green.

## Phase 28 result (pushed f8ff90a..59d8c33..e53bf30, CI green)

- Local battery on the fix: 484 unit, 21 e2e, bench, pack, compat,
  audit, lint, diff-check green.
- CI green on the closing HEAD (verify + browser + CodeQL); no
  failures/cancellations outstanding. (The intermediate src-fix push's
  run was superseded by the docs push via concurrency cancel; the
  closing run covers the full tree including the fix.)

## Phase 29 (in progress — single-writer liveness hole)

- Review of the phase-28 rule found a real stall: when the elected owner
  has no local subscription it never reconciles the topic, so universal
  stand-down stalls forever (reachable through ordinary unsubscribe
  timing — unsubscribing drops load, making the unsubscribed tab the
  likely winner). Fix: stand down only when the elected owner is
  subscribed (mapped via subscriber tabIds); otherwise write the route
  and notify it directly, exactly like the handoff and crash paths.
- Regression test pins the unsubscribed-elected-owner recovery end to
  end; mutation-checked (always-stand-down probe fails; restored passes).
- 485 unit green; typecheck, lint, diff-check green.

## Phase 29 result (pushed 7bab502..287656c, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 30 (in progress — browser coverage for stranded-handoff recovery)

- Real gap: the recovery path had zero browser coverage (a 10 s+ stall
  cannot be induced deterministically in-browser). New demo chaos toggle
  (`#dropHandoffAck`) wraps `environment.createChannel` to drop outgoing
  `ROUTE_RELEASED`; the bus, trace, and feed are otherwise untouched, and
  the toggle defaults off so all existing tests are unaffected.
- E2E: pagehide with ACKs dropped on both tabs → survivor converges via
  re-election (~14 s, vs 1–2 s graceful — the timing itself corroborates
  the recovery path, not the ACK path) → feed shows the recovery row →
  delivery resumes exactly once. Isolation green.
- Full-suite note: 3/5 local parallel runs fully green; 2 runs each dropped
  a different single test to 20 s-poll timeouts under parallel load (the
  documented local-load flake class; CI serializes workers:1 with 2
  retries, so gating is unaffected). The longer suite (chaos test ≈16 s)
  adds parallel overlap locally — accepted, same trade the project
  already documents.
- 483 unit green; typecheck, lint green.

## Phase 30 result (pushed dc73b15..bd2dfe1, CI green on first try)

- CI green: verify + browser (22 e2e incl. the chaos recovery test) +
  CodeQL. The serialized CI workers absorb the longer suite without the
  local parallel-load flake.

## Phase 31 (in progress — browser coverage for the crash path)

- Real gap: the crash path (owner dies with no pagehide at all) had only
  unit coverage. A real renderer crash via CDP was evaluated first and
  rejected with evidence: same-origin tabs share the renderer
  (TAB-B-ALIVE: false in the probe), so siblings die too and the survivors
  under test disappear.
- Instead: demo `#simulateCrash` chaos toggle stops all outgoing
  coordination on the armed tab with no pagehide dispatched (channel sends
  + localStorage writes blocked live-gated, reads unaffected). Always
  installed, pass-through when unchecked — the full suite passing proves
  zero regression to existing tests.
- E2E: converge 3 tabs, arm crash on the owner only, survivors re-elect
  after TTL expiry (~13.6 s) and delivery resumes exactly once.
- Full suite 23/23 green locally (24.8 s); typecheck, lint green.

## Phase 31 result (pushed 779a378..cb29413, CI green on first try)

- CI green: verify + browser (23 e2e) + CodeQL.

## Phase 32 (in progress — TS 7.1 probe + bench-engine baseline re-check)

- TypeScript 7.1: only a `next`-tag dev build exists (`7.1.0-dev…`);
  latest stable is still 7.0.2, which typescript-eslint rejects. TS 7
  stays deferred with even stronger evidence; the configured mirror does
  not even carry 7.1 yet. Retry when a stable 7.1 lands alongside
  typescript-eslint support.
- Vitest 5 swapped the bench engine (tinybench 6): re-running
  `bench:browser` to check for a systematic baseline shift (the release
  checklist anticipates a one-time shift on engine changes).

## Phase 32 result (pushed 86fee81..2388d5e, CI green on first try)

- bench:compare 50% gate green on the post-vitest-5 run (all deltas
  within ±10% noise — no engine-shift regression); trend docs refreshed
  (12 reports). CI green: verify + browser + CodeQL.

## Phase 33 (in progress — definitive full battery on the final tree)

- check: typecheck + build + 485 unit green (26 files); lint clean.
- e2e 23/23 green locally; Node bench green; verify:pack full-surface
  green; verify:compat (v0.20.71 baseline) green; audit clean;
  npm pack 107 files without progress.md; diff-check clean.
- bench:browser covered in phase 32 (gate green, trend refreshed).

## Phase 34 (autonomous session — coverage-driven defect hunt + CI gate enforcement)

Method: rather than assume the "feature-complete" state was verified, re-ran
the full battery from a clean install and used per-branch v8 coverage to find
code paths no test reaches, then wrote focused tests there. Every new suite was
mutation-checked (delete the guard under test -> the test must fail).

**Real defect found and fixed** — `src/vue.ts` `useCrossTabDataBus`:
`start()` awaits `stop()` before calling `create()`. An unmount landing inside
that async window ran `stop()` without bumping `lifecycleGeneration`, so the
pending continuation still ran `create()` after the component was gone,
leaving a live bus with no owner to stop it. `onBeforeUnmount` now bumps the
generation. Regression test fails without the fix. (React adapter unaffected:
its `create()` is synchronous inside `useEffect`.)

**Real CI gap found and fixed** — `verify:compat`, `verify:pack`, and the
`vitest.config.ts` coverage thresholds were all documented release gates that
no workflow ran. They could only ever fail after a tag was pushed, or never.
Added to the CI `verify` job and (compat/pack) to the `Release` job. Both
checkouts needed `fetch-depth: 0` + `fetch-tags: true` — `verify:compat`
resolves its baseline from the latest release tag and dies with
"no version tag found" on the default shallow checkout (reproduced locally).
Documented the automated gate set in both release checklists.

**Coverage** (485 -> 541 unit tests, 26 -> 27 files):

| Module | Before (stmt/branch) | After |
|---|---|---|
| `core/replay-manager.ts` | 86.95 / 81.60 | 97.10 / 96.00 |
| `core/replay-persistence.ts` | 84.02 / 66.17 | 93.29 / 72.05 |
| `centrifuge-session.ts` | 92.62 / 88.05 | 98.36 / 94.02 |
| `vue.ts` | 96.55 / 86.66 | 97.72 / 93.33 |
| All files | 94.00 / 88.62 | 95.86 / 90.48 |

New `tests/replay-manager.test.ts` (41 tests) drives the manager directly —
previously it was only exercised transitively through `CrossTabDataBus`, which
left the retention-sweep coalescing, the persistence retry/backoff loop, the
suspend-cancellation path, and the wildcard replay gates unpinned.

**Deps**: react / react-dom / @types/react -> 19.3.0 (dev-only). TypeScript
stays on 6.0.3; 7.0.2 is still rejected by typescript-eslint (phase-32
deferral stands). `pnpm audit` clean.

**Local battery**: install (frozen lockfile), typecheck, lint, build, 541 unit
tests, coverage (95.86 / 90.48 / 95.58 / 97.80 vs 85 / 80 / 90 / 85 floors),
bench (25 cases), verify:compat (baseline v0.20.71), verify:pack — all green,
run in the exact CI order. E2E could not run in this sandbox (the Playwright
Chromium download is network-blocked: ECONNRESET against cdn.playwright.dev);
the `browser` CI job covers it, and no E2E-facing source changed except
`src/vue.ts`, which has no demo/E2E surface.

## Phase 35 (autonomous session, cont. — core-module coverage + routing regression)

Continued the coverage-driven hunt into the two core modules.

`CrossTabDataBus` lifecycle contract edges (5 tests): `ready()` rejecting with
the configuration error when no `initialConfig` exists and resurfacing the
recorded transport failure once the opening settled; `unsubscribe` no-ops for
an unknown topic and an unregistered handler; `stop()` idempotence; and the
third dispatch gate — a two-tab setup where the owner fans out to a peer
subscriber and records the message *discarded*, so its throughput and dispatch
percentiles are not inflated by a message it never handed to a handler.
Mutation-checked (removing the `hasLocalSubscriber` gate fails it).

`WorkerClusterRuntime` publish-routing cache + lifecycle guards (8 tests),
including a two-runtime regression pinning the 0.20.58 correctness fix: a
`null` `wildcardPublishCache` entry means "no local wildcard subscription",
not "owned locally", so a topic owned by a remote worker must still be
forwarded. Note: the obvious mutation (dropping `&& cachedPattern !== null`)
is *equivalent* — `Map.has(null)` is already false — so the probe used was
the semantic one (treat any cached entry as locally-owned), which fails 4
tests including the new one.

| Module | Before (stmt/branch/func) | After |
|---|---|---|
| `core/data-bus.ts` | 94.58 / 89.79 / 90.21 | 95.07 / 90.20 / 90.21 |
| `core/cluster.ts` | 94.30 / 87.50 / 98.79 | 95.95 / 90.21 / **100** |
| All files | 94.00 / 88.62 / 94.37 | **96.29 / 91.19 / 95.78** |

Unit tests 485 -> 554. typecheck, lint, coverage, build all green.

## Phase 34-35 result (PR #10, CI green on first try)

- PR: https://github.com/Sun1090/cross-tab-worker-databus/pull/10
- All four checks green on the first run: `verify`, `browser`, `analyze`,
  `CodeQL`.
- The three newly-wired gate steps each ran and passed in the real runner:
  `Coverage thresholds`, `Public export compatibility`, `Packed consumer
  smoke`. The compat step passing confirms the `fetch-depth: 0` +
  `fetch-tags: true` checkout fix — without it that step aborts with
  "no version tag found".
- `browser` (23 e2e) green, which closes the one gap from the local battery:
  Playwright Chromium could not be downloaded in the dev sandbox (ECONNRESET
  against cdn.playwright.dev), so E2E was verified in CI instead.

## Phase 36 (autonomous session, cont. — worker/transport edge coverage)

Continued down the coverage ranking to the two remaining sub-95% modules.

`PortReaper` (SharedWorker cleanup, 5 tests): untracked-port no-ops for
`setTimeout`/`touch`/`remove` (a STOP or INIT racing a reap must not resurrect
a port), duplicate `remove` plus cadence-timer teardown when the last port
goes, `dispose()` closing and stopping every session and being repeat-safe,
`dispose()` continuing after a target throws (one detached port must not
strand the remaining WebSockets), and the non-finite/non-positive heartbeat
fallback. Three mutations checked, all caught. **97.18 -> 100 statements**,
81.81 -> 90.91 branches, 100 functions.

`WebSocketTransport` (5 tests): empty `publishBatch`, ArrayBuffer items
embedded as byte arrays in a mixed batch, duplicate `start()` reusing the live
socket, and non-string / non-object frames ignored. 92.59 -> 96.29 statements,
85.54 -> 91.56 branches, 100 functions.

Mutation-testing note: two probes turned out **equivalent** rather than
uncaught, and were recorded as such instead of chasing them —
`assignedTopics.has(null)` is already false (phase 35), and the websocket
non-object JSON guard is redundant with `parseDataBusPublication`. Both
remain as defensive depth with the contract pinned by tests.

Cumulative this session: **485 -> 564 unit tests**, all files
94.00 / 88.62 / 94.37 -> **96.53 / 91.70 / 95.78**.

## Phase 37 (autonomous session, cont. — Centrifuge transport edges)

`CentrifugeWorkerTransport` (4 tests, all mutation-checked): duplicate
`start()` reusing the live backend (a second Worker means a second WebSocket),
SharedWorker-level vs port message-decode failures reported as distinct
errors, a `channelToken` request falling back to `getToken` when the provider
lacks `getChannelToken`, and a token request answered with `TOKEN_ERROR`
instead of dropped when no `credentialProvider` exists (a silent drop hangs
the worker's connect indefinitely). 93.12 -> 95.00 statements, 91.08 -> 93.06
branches, 100 functions.

Remaining uncovered lines in `centrifuge.ts` (421/427/442/448) are the
`typeof Worker === 'undefined'` / `typeof SharedWorker === 'undefined'` SSR
guards inside the *default* factory functions. They are unreachable from the
test process without deleting the globals for the whole module graph, and the
degradation behavior they back is already covered through injected factories.
Left deliberately uncovered.

Cumulative this session: **485 -> 568 unit tests**, all files
94.00 / 88.62 / 94.37 / 96.77 -> **96.64 / 91.83 / 95.78 / 98.22**.

### Session summary (phases 34-37)

Two real problems found and fixed, both by coverage-driven probing rather
than by reading the task list:

1. `src/vue.ts` leaked a bus when a component unmounted inside the async
   start window (fixed; regression test).
2. `verify:compat`, `verify:pack`, and the coverage thresholds were
   documented release gates that no workflow ran (wired into CI + Release,
   with the `fetch-tags` checkout fix `verify:compat` requires).

Verified end to end on PR #10: `verify`, `browser` (23 e2e), `analyze`, and
`CodeQL` all green, with the three new gate steps confirmed executing in the
runner.

## Phase 38 (autonomous session, cont. - demo accessibility)

First pass over the UI/a11y area of the brief, which no prior phase had
examined. Audited `examples/demo/index.html` (396 lines) against what
assistive tech can actually perceive.

Already correct: every form control's `label[for=]` resolves to a real
control (`endpointPreset`, `urlInput`, `workerMode`, `topicInput`,
`payloadInput`), `#statusBadge` is already `role="status"` +
`aria-live="polite"`, and the event table already carried a visually-hidden
caption.

Four genuine gaps found and fixed:

1. The run-mode segmented control conveyed its selection **only** through a
   CSS `active` class. Screen readers announced three plain buttons with no
   selected state. Now `role="radiogroup"` + `aria-labelledby`, with
   `role="radio"` / `aria-checked` per button.
2. `demo.js` toggled just the `active` class on click, so the new
   `aria-checked` would have gone stale after the first switch - the handler
   now moves both together. Static ARIA that lies is worse than none.
3. The dangling `<label>run mode</label>` had no form control to label (a
   `<label>` around a button group contributes no accessible name). It became
   a `<span class="field-label" id="modeSwitchLabel">`, with a CSS rule added
   so it renders identically to the real field labels.
4. Both `.state-table`s lacked captions, and all eight `<th>` across the three
   tables lacked `scope="col"`, so cells were announced without their column
   header.

Verification: the assertions were run against the real HTML through jsdom
before and after the fix - **15 violations before, 0 after** - because
Playwright browsers cannot be installed in this sandbox. Three browser E2E
specs in `e2e/demo.spec.ts` encode the same contracts for CI: no unnamed
interactive control, a caption + column scopes on every table, and
`aria-checked` following the selection through an actual mode switch (the
regression guard for gap 2). `pnpm check` (568) and `pnpm lint` green.

Follow-up in the same phase: declaring `role="radio"` without implementing the
radiogroup keyboard pattern would have been a promise the widget did not keep,
so the click handler was refactored into a shared `selectMode()` that also
maintains a **roving tabindex** (one tab stop for the group), with Arrow / Home
/ End navigation where selection follows focus. Buttons also had *no* focus
style at all, making keyboard navigation invisible - added a `:focus-visible`
outline. The state machine was validated in jsdom (wrap-around both
directions, Home/End, click, and the "exactly one tabbable / one checked"
invariant) and pinned by a fourth E2E spec; the browser suite is now 27.

That fourth spec **failed in CI on first run** (commit `ec29397`), which is
exactly what it was for - though the bug was in the assertion, not the app:
`options.locator('[tabindex="0"]')` searches *descendants* of each `.seg`
button, while the roving tabindex lives on the button itself, so the count was
always 0. Fixed to `group.locator('.seg[tabindex="0"]')` in `6ac3a81`; all four
checks green. Lesson for this repo: Playwright's `locator.locator()` is
descendant-scoped - use a compound selector to filter the elements themselves.

Note: CI job logs and run artifacts cannot be downloaded from this sandbox
(the results-receiver and blob endpoints both close with EOF). Diagnosis has to
come from `gh pr checks`, the check-run annotations API, and local reasoning /
jsdom reproduction. Budget an extra CI round trip for browser-only failures.

Confirmed on PR #10 at commit `18ab15d`: all four checks pass and the browser
job's spec count went 23 -> 26, so the new specs really executed in CI rather
than being collected and skipped. (Job log download fails from this sandbox
with an EOF from the results receiver; `npx playwright test --list` locally
corroborates the 26-spec collection.)

## Phase 38 (PR #10 merged — coverage hunt, Vue leak fix, CI gates)

- Reviewed PR #10 (forked from 6a853d3; no conflicts — verified with a real
  trial merge before merging) and ran the full battery on the merged tree,
  including the browser suite the PR author's sandbox could not run.
- Merged as squash `7e65f28` (branch deleted). CI on the merge commit green:
  verify (now running coverage + verify:compat + verify:pack) + browser +
  CodeQL.
- Post-merge local verification: 27 files / 568 unit tests, coverage
  96.64/91.83/95.78/98.22 vs the 85/80/90/85 floors, verify:compat
  (v0.20.71), verify:pack, e2e 27/27, lint, typecheck, pack 107 files
  (no progress.md).
- Shipped from the PR: the Vue `useCrossTabDataBus` unmount leak fix
  (pending `start()` continuation could `create()` a bus after unmount with
  no owner to stop it), the CI enforcement gap (documented-but-unrun
  coverage/compat/pack gates now wired into CI + Release with full-history
  checkouts), replay-manager direct suites, and demo a11y (mode radiogroup
  with roving tabindex/keyboard nav, table captions + column scopes).

## Phase 39 (docs defect: capabilities matrix table corruption + guard)

- Found while auditing doc accuracy after the merge: the capabilities matrix
  in BOTH languages had a 3-cell row ("Optional ArrayBuffer Transferable
  transport") beside a 5-cell row (`publishBatch`), because the Transferable
  description was orphaned onto the following row — the whole matrix
  rendered with shifted columns. Fixed in `docs/capabilities.md` and
  `docs/zh/capabilities.md`.
- New documentation guard: every contiguous markdown table in the shipped
  docs must have a single cell count. Splits on unescaped pipes only, so a
  literal `\|` inside a cell (several config tables use type unions) is not
  mistaken for a separator. Mutation-checked: re-introducing the malformed
  row fails the guard; restoring passes. A full scan found only these two
  tables affected.
- 569 unit tests green (568 + 1 guard); typecheck, lint green.

## Phase 40 (CHANGELOG structure defects + release-notes guards)

- Continued the doc audit: the `[Unreleased]` section had two `### Changed`
  headings (accumulated across sessions), and `[0.20.60]` was an h1 (`#`)
  instead of h2 (`##`). The latter matters — the Release workflow matches
  `## [<version>]` to extract notes, so an h1 version would publish without
  notes (and made its `### Added` look like a duplicate).
- Fixed both, and added two guards to `tests/documentation.test.ts`: no
  repeated `### ` subheading within a CHANGELOG version section, and every
  version heading must be an h2. The first guard actually caught the 0.20.60
  defect before the fix, so both are behaviourally demonstrated.
- 571 unit tests green (569 + 2 guards); typecheck, lint, diff-check green.

## Phase 41 (release workflow ref bug + workflow guards)

- Real release-automation bug: on `workflow_dispatch`, `GITHUB_REF_NAME` is
  the selected branch (`main`), not the `tag` input. The release job used it
  raw, so a manual dispatch would create a GitHub release named `main`,
  derive the npm version from the branch, and extract notes for `main`
  (which fails the section check). Fixed by resolving
  `${ inputs.tag || github.ref_name }` once into a job-level `RELEASE_TAG`
  and using it in every step.
- New `tests/workflows.test.ts`: pins the tag derivation, rejects any raw
  `GITHUB_REF_NAME` in release.yml, sanity-checks every workflow declares
  name/on/jobs and pins actions, and requires `fetch-depth: 0` wherever
  `verify:compat` runs. Mutation-checked (reverting to the raw ref fails).
- 574 unit tests green (571 + 3); typecheck, lint, diff-check green.

## Phase 42 (release-checklist parity with the CI gates)

- The Before-tagging steps lagged the CI gate set: they omitted
  `pnpm test:coverage`, and did not warn that `verify:compat` needs
  `git fetch --tags` in a shallow clone (it resolves the baseline from the
  latest release tag). Updated both languages and pinned parity: a
  documentation test now asserts each checklist documents
  `test:coverage`, `verify:compat`, `verify:pack`, `bench:compare`, and
  the fetch-tags note.
- 575 unit tests green (574 + 1); typecheck, lint, diff-check green.

## Phase 43 (EN/ZH parity defects, adaptive-dedup validation hole, JSDoc dup)

- Continued the doc audit into cross-language drift. Structural comparison of
  every localized pair (h2 count, table-row count, list-item count) found five
  real defects, all in the language that had drifted:
  - `docs/release-checklist.md` (EN) was missing the whole "Security and
    dependency scanning" section (CodeQL + Dependabot) that only the Chinese
    copy carried — EN had 6 h2 sections, ZH 7.
  - `docs/zh/roadmap.md` had lost the `0.11.0` delivered-scope section
    entirely (EN 100 h2, ZH 99), and its `0.13.0` candidates section was
    empty (EN lists four items).
  - `docs/zh/configuration.md` omitted the `recovery.cooldownMs` and
    `recovery.maxAttempts` rows that the EN Core-config table documents
    (39 table rows vs 37).
  - `docs/zh/README.md`'s demo link text was `../..//examples/demo` (doubled
    slash); the target was right, the label was not.
- Five new guards in `tests/documentation.test.ts` pin this class: EN/ZH h2
  parity, table-row parity, list-item parity, no empty section, and every
  shipped doc enumerated in `package.json` `files`. All five mutation-checked
  by reverting the corresponding fix (each fails with a precise message, e.g.
  `docs/zh/configuration.md has a different number of table rows ... expected
  37 to be 39`).
- Real code fix found while reading the dedup path: `assertDedupOptions`
  accepted non-finite `adaptiveTtl` bounds. `NaN <= 0` and `maxMs < NaN` are
  both false, so `{ minMs: NaN, maxMs: 1000 }` (or `maxMs: Infinity`) passed
  construction and left `DedupManager.currentTtl()` returning `NaN`, silently
  disabling expiry rather than failing loudly. Bounds must now be finite
  positive numbers with `minMs <= maxMs`; the existing bounds test gained the
  five non-finite cases.
- Second code-hygiene fix: `BatchingStorageWriter` carried its class JSDoc
  twice (the first a truncated copy), so the first block was dead
  documentation. Removed, with a `tests/regression.test.ts` guard that fails
  when a JSDoc block is stacked on another whose body it prefixes (a file
  header followed by a member doc is deliberately allowed). Mutation-checked:
  re-inserting the duplicate reports
  `src/core/storage-batch.ts:21 duplicates the JSDoc block at line 25`.
- Packaging: `package.json` `files` now also enumerates `README.zh.md` and
  `docs/zh/README.md`, mirroring the already-listed English counterparts.
  Verified with `npm pack --dry-run --json` that npm auto-includes any
  `README*` regardless of `files` (a scratch `docs/zh/_scratch-probe.md` is
  *not* included, so the enumeration guard still has real teeth for
  non-README docs) — recorded so a future reader does not mistake this for a
  missing-file fix.
- 581 unit tests green (575 + 6 new guards); typecheck, lint, build, e2e
  (27/27), verify:pack, `npm pack --dry-run` (107 files, `docs/zh/README.md`
  present, no progress.md) green.
- Sandbox note: this environment cannot run `pnpm` (its global store symlink
  is broken) or the full suite in one shot — vitest spawns 26 forks and the
  jsdom files (hooks/vue) intermittently fail to start, and the `dual-format`
  dist test can time out when the machine is loaded. Run with
  `./node_modules/.bin/vitest run --maxWorkers=1` and re-run the two jsdom
  files separately; all 581 pass. `pnpm` can be replaced by
  `PATH="$PWD/node_modules/.bin:$PATH" node scripts/build.mjs`.

## Phase 44 (deterministic generated benchmark doc + testable generator)

- Found while checking whether the shipped trend doc was stale: regenerating
  `docs/benchmarks.md` on a day with no new archived report produced a diff —
  the stamp was `new Date()`, so the doc changed daily and claimed data it did
  not have. (Running it on 09-12 rewrote the line to "Auto-generated
  2026-09-12" while the newest report was still 09-11.)
- Two real defects in `scripts/bench-trend.mjs`:
  - non-deterministic stamp (above); now derived from the latest report's
    `generatedAt`, falling back to the `browser-<ISO>.json` filename date, so
    regeneration is a no-op diff when nothing new was archived.
  - the generated header claimed "prose is maintained by hand" while the script
    overwrites the entire file — corrected in both the script and both docs.
- Refactored the script so the renderer is a pure exported `buildDocs(entries)`
  (+ `readReports`), with `scripts/bench-trend.d.mts` for type-checked imports
  (the existing `demo-*.d.mts` pattern), and the CLI body behind an
  `import.meta` direct-invocation check.
- New `tests/bench-trend.test.ts` (6 tests): the stamp is the report date and
  never the wall clock (the explicit regression assertion), byte-determinism
  across calls, the report count, delta + all-time-best math in both
  directions, the filename-date fallback, and rejection of a <2-report archive.
  Mutation-checked: restoring `new Date()` fails two tests with
  "expected ... to contain 'Data through 2020-01-02'".
- 587 unit tests green (581 + 6); typecheck, lint, build green.

## Phase 45 (silent benchmark-gate bypass + scripts/ lint coverage)

- Swept the release-critical scripts (they are mostly unguarded). Found a
  real gate defect in `scripts/bench-compare.mjs`, which both release
  checklists invoke as `pnpm bench:compare --fail-above-pct 50`:
  the threshold was `Number(...)`-coerced with no validation, so
  `--fail-above-pct abc` produced `NaN` — and because every `pct > NaN`
  comparison is false, the gate reported
  `[bench] OK: no metric regressed more than NaN%` and exited 0. A typo
  therefore **silently disabled the regression gate**. Now a missing, empty,
  non-numeric, or negative threshold throws.
- Also fixed the adjacent argument-handling wart: passing exactly one report
  path silently compared the two most recent reports instead of erroring.
- Refactored the CLI into validated exported helpers (`parseArgs`,
  `compareReports`, `findRegressions`, `latestReports`) with
  `scripts/bench-compare.d.mts`, plus `tests/bench-compare.test.ts` (8 tests)
  pinning the loud failure, the row pairing, the threshold boundary, the
  near-zero-baseline skip, and the null-threshold off switch. Mutation-checked
  (removing the validation fails the test). Real-CLI smoke: `abc` now exits 1
  with a clear message; `50` still prints `[bench] OK`.
- Second finding: `scripts/` was in the ESLint `ignores` list, so none of the
  release tooling was linted. Removed the ignore and added a Node config block
  (Node globals, `no-console` allowed; browser globals scoped to
  `bench-browser.mjs`, whose Playwright `waitForFunction` callback really runs
  in the page). Enabling it surfaced two genuine findings, both fixed:
  - `verify-version-compat.mjs` threw a new error without attaching the
    original as `cause` (`preserve-caught-error`), discarding the git failure
    detail.
  - `serve-examples.mjs` had a misindented `console.log` in the startup block.
  A guard now fails if `scripts/**` returns to the ignore list.
- 596 unit tests green (587 + 8 + 1); typecheck, lint (now covering scripts),
  build, `verify:compat`, `bench:compare`, idempotent `bench:trend` green.

## Phase 46 (packed-consumer smoke: workspace pollution, temp leak, coverage gap)

- Swept `scripts/verify-packed-consumer.mjs` (run by CI on every push and by the
  release workflow before publish). Three real defects, all confirmed
  empirically before the fix:
  1. **Checkout pollution.** A bare `npm pack` writes
     `cross-tab-worker-databus-0.20.83.tgz` into the repo root — one stale
     archive per version, recreated on every push. Its sibling
     `verify-published-consumer.mjs` already passed `--pack-destination`; this
     one never did. (Confirmed: a `.tgz` was sitting in the root, and its mtime
     advanced on each run.)
  2. **Temp-root leak.** Neither verifier removed its `mkdtempSync` root, so
     every run left ~3.3 MB of unpacked package behind. Five
     `cross-tab-databus-pack-*` dirs had accumulated (~16.5 MB) — one per
     `verify:pack` run.
  3. **Coverage gap.** The smoke swept only a hardcoded
     `['.', './hooks', './vue', './centrifuge']` list, so `./centrifuge.worker`
     and `./centrifuge.shared.worker` — the entry points the built-in Worker
     factory resolves at runtime — were never checked inside the tarball.
- Fixes: pack into the temp root; remove it in a `finally` in both scripts;
  derive the sweep from the packed manifest via a new exported
  `collectExportTargets(manifest)` (+ `assertPackedExports`), keeping the
  dual-format `import`/`require` contract as a separate explicit assertion so
  the intentionally ESM-only worker entries are not mis-flagged. The CLI body is
  now behind an `import.meta` direct-invocation check (the `bench-trend.mjs`
  pattern) with `scripts/verify-packed-consumer.d.mts` for typed imports.
- Guards: new `tests/verify-packed-consumer.test.ts` (9 tests) pins the
  manifest-derived coverage — including the explicit assertion that every key of
  the real `package.json` `exports` is swept, which is the regression itself —
  plus the string-entry flattening, the empty-export rejections, the missing
  worker target, the lost `require` condition, and the real manifest against the
  real `dist`. A new `tests/regression.test.ts` case pins the hygiene
  properties (`--pack-destination`, tarball read back from the temp root,
  `rmSync` inside a `finally` in both verifiers).
- Mutation-checked all three guards: (a) reverting the sweep to the hardcoded
  list fails 4 tests with `export ./centrifuge.worker must be swept by the pack
  smoke`; (b) dropping `--pack-destination` fails with `npm pack must write into
  the temp root`; (c) dropping the `finally` fails with
  `verify-published-consumer.mjs must remove its temp root`. Additionally an
  end-to-end mutation — pointing `./centrifuge.worker` at a missing file and
  running the real CLI against a real tarball — now exits 1 with
  `missing export target ./dist/centrifuge.worker.broken.js for
  ./centrifuge.worker`, which the old hardcoded sweep could not detect at all.
- Post-fix CLI smoke: tarball count 0 and temp-dir count unchanged across a run,
  `[pack] verified ESM/CJS root and subpath consumers` still green.

## Phase 47 (non-finite load scores + unvalidated cluster options)

- Found by auditing the option surface against the docs rather than reading
  prose: `loadWeighting` is a documented, routing-affecting public option with
  **zero** validation anywhere, and the rest of the cluster options were in the
  same state. Reproduced five behaviours against the built bundle first:
  1. `effectiveWorkerLoad` returned `NaN` for a sample with `windowMs: NaN`
     (`NaN <= 0` is false, so it slipped the "non-positive window" guard).
  2. `NaN` for a non-finite weight.
  3. `NaN` for a corrupt sample field (`messageCount`).
  4. **Order-dependent owner selection.** `selectLeastLoadedWorker` compares
     `byLoad !== 0` — true for `NaN` — and `NaN < 0` is false, so the `NaN`
     worker won or lost purely by its array index:
     `[healthy, corrupt] → healthy` but `[corrupt, healthy] → corrupt`. Worker
     order comes from storage listing, so the same cluster could pick different
     owners per tab.
  5. A negative weight inverts the documented policy: `messageRateWeight: -1`
     picked the *loud* worker.
- Fixes:
  - `src/core/routing.ts` — the score is now total. A non-finite `windowMs`
    falls back like a non-positive one, and a non-finite weighted sum falls back
    to the raw topic count, so `NaN` can never reach the comparator.
  - `src/utils/validation.ts` — new `assertLoadWeightingOptions` (weights must be
    non-negative finite) and `assertClusterOptions` (`maxActiveWorkers` and
    `routeOwnerCacheMax` positive safe integers; `heartbeatIntervalMs` and
    `workerTtlMs` positive finite). Called from the `WorkerClusterRuntime`
    constructor, so it covers `CrossTabDataBus` and both transport factories.
    `Infinity` is rejected for the cluster heartbeat (unlike the Centrifuge PING,
    where it legitimately means "disable"): a Worker that never refreshes its
    heartbeat is pruned by its own TTL. A `0`/`NaN` heartbeat would degenerate
    `setInterval` into a 0ms busy loop — the exact hazard the PING guard exists
    for — and a non-positive TTL pruned every peer on the first reconcile.
- Tests: 2 in `tests/routing.test.ts` (never non-finite; same owner regardless of
  input order), 5 in `tests/cluster.test.ts` (one per option group + the
  `loadWeighting` shape), 1 in `tests/data-bus.test.ts` (the same validation
  reached through the public bus, which is how the gap was discovered).
- Mutation-checked all three: removing the `Number.isFinite(weighted)` guard
  fails with `expected NaN to be 4`; removing both NaN guards fails the
  order-independence test with `expected 'healthy' to be 'corrupt'`; removing the
  `assertClusterOptions(options)` call fails all 6 validation tests.
- Docs: both configuration references now state the weight constraint (EN/ZH
  parity preserved).
- 614 unit tests (606 + 8), typecheck, lint, build, verify:compat, verify:pack,
  bench:compare, and 27/27 browser E2E green.

## Phase 48 (the API reference drifted behind the public surface)

- Continued the Phase 47 method — audit the *documented* surface against the
  *actual* one — and pointed it at the API reference. Derived the 19 root
  exports from the built entry point and checked each against `docs/api.md`:
  - `DEFAULT_MAX_ACTIVE_WORKERS`, `approximatePayloadBytes`,
    `effectiveWorkerLoad`, `getOrCreateTabId` were **absent from the API
    reference entirely** (the first three also from every other shipped doc;
    `effectiveWorkerLoad` only appeared in architecture.md).
  - `CrossTabDataBus.publishBatch` — a headline public method — had no entry;
    only the *transport-side* optional `publishBatch?` hook was described. The
    `WorkerClusterRuntime` "Main methods" list omitted it too.
  - Self-correction: an initial heading-only grep suggested `clearReplayTopic`,
    `clearReplayBefore`, `getDedupStats` and `resetDedup` were also missing.
    They are documented as prose paragraphs under `### clearReplay()`, so the
    heading list was the wrong instrument — checked before claiming anything.
- Documented all five in both languages (EN + ZH), including the two
  non-obvious guarantees that were only in the source: `getOrCreateTabId`
  deliberately does **not** reuse the stored value when `window.opener` is
  present (`window.open()` clones the opener's `sessionStorage`, so a blind
  reuse would give two live tabs one identity), and `effectiveWorkerLoad` is
  total — a non-finite window/result falls back to the raw Topic count so owner
  selection stays order-independent.
- New guard in `tests/documentation.test.ts`: derives the export list from
  `dist/index.js` and asserts every name appears in *both* `docs/api.md` and
  `docs/zh/api.md`. A new public export now fails the suite until documented, so
  the reference cannot silently drift behind the code again. Mutation-checked
  (renaming the `DEFAULT_MAX_ACTIVE_WORKERS` heading fails with
  `docs/api.md must document every public root export: expected [ 'DEFAULT_MAX_ACTIVE_WORKERS' ]`).
- EN/ZH structural parity preserved (h2 count, table rows, list items, no empty
  sections) — the new `###` sections and the one mirrored
  `WorkerClusterRuntime` bullet keep both counts equal.

## Phase 49 (the two adapter entries documented for only one adapter each)

- Spotted while reading the sections Phase 48 pointed at: `### useCrossTabHealth`
  sat under `## React Hooks` in English but under `## Vue Composables` in
  Chinese, and `/hooks` and `/vue` export the **same four composable names**
  (`useCrossTabDataBus`, `useCrossTabSubscription`, `useCrossTabStatus`,
  `useCrossTabHealth` — verified against `dist/hooks.d.ts` / `dist/vue.d.ts`).
  So each language documented the health composable for exactly one adapter:
  EN readers never learned `/vue` exports it, ZH readers never learned `/hooks`
  does. The Chinese Vue heading also carried the **React** name
  (`useCrossTabHealth`) over a body describing a Vue `Ref`.
- This class is invisible to the existing parity guards: both languages have the
  same h2 count, the same table rows, and the same list items, so only *where* a
  name lives differs. New guard: split the reference on h2, and require each
  entry's own section to document every export of that entry (derived from the
  built declaration files). It failed on the pre-fix docs with exactly
  `docs/api.md: the /vue section must document every export of that entry:
  expected [ 'useCrossTabHealth' ]` and then, after fixing EN, the Chinese
  equivalent for `/hooks` — i.e. it caught both defects independently.
- Fixes: EN gains `### useVueCrossTabHealth(bus, options?)` in the Vue section;
  ZH gains the React `### useCrossTabHealth(bus, options?)` section and its Vue
  heading is corrected to `useVueCrossTabHealth`, matching the `useVue*`
  aliasing convention that section already uses elsewhere.
- 615 unit tests, typecheck, lint green; EN/ZH structural parity intact.

## Phase 50 (my own Phase 48 guard broke CI — invisible locally)

- CI failed in 22s on both Phase 48 and Phase 49 while every local gate was
  green. Root cause: `pnpm check` is `typecheck && build && test`, so
  `tsc --noEmit` runs against a **fresh checkout with no `dist/`**, and the new
  documentation guard's literal `import('../dist/index.js')` was rejected with
  `TS2307: Cannot find module '../dist/index.js'`. Locally `dist/` already
  existed, so the failure never appeared.
- This is a known trap in this repo — `tests/dual-format.test.ts` carries a
  comment explaining that it builds the specifier as a non-literal
  (`` `../dist/${'index.js'}` ``) precisely so tsc does not statically resolve
  it. The guard now uses the same form.
- Reproduced the CI condition locally by `mv dist dist-hidden && tsc --noEmit`
  (exit 0 after the fix) instead of trusting the local run.
- Added a source-hygiene guard so the trap cannot return silently: no test file
  may use a literal dynamic `import()` of `../dist/`. Mutation-checked — it
  reports `tests/documentation.test.ts:245 statically imports dist — use a
  non-literal specifier`.
- Lesson recorded: after adding any test that touches `dist/`, run the *CI
  sequence* (`tsc --noEmit` **before** the build), not just the test suite.

## Phase 51 (bench-browser: unimportable module + unvalidated env inputs)

- `scripts/bench-browser.mjs` executed the *whole* benchmark at module scope
  (top-level `await` fetch → `spawn` the demo server → `chromium.launch`). No
  test could import its pure parts, and any future tooling that imported it
  would have silently started a server and a browser. Moved the runtime body
  into `main()` behind an `invokedDirectly` guard — the pattern
  `verify-packed-consumer.mjs`, `bench-compare.mjs` and `bench-trend.mjs`
  already used. Verified: `node -e "import('./scripts/bench-browser.mjs')"`
  returns in ~0.44s with no spawn and no browser.
- Its environment inputs were `Number(...)`-coerced with no validation — the
  same defect class as the Phase 45 `bench:compare` gate. Four real failure
  modes, all reproduced:
  - `BENCH_MESSAGES=abc` → `NaN`, the publish loop never ran, and the run died
    on a 30s `waitForFunction` timeout with no hint of the cause.
  - `BENCH_MESSAGES=0` → `perMessageMs` was `0/0` = `NaN`, which
    `JSON.stringify` archives as `null`, poisoning `bench:compare`.
  - `BENCH_MODES=,` → zero modes ran and an empty `results: []` was archived,
    so `bench:compare` had nothing to compare and still reported OK.
  - `PORT=abc` → `http://localhost:NaN/...` and a server that failed to listen.
- Extracted an exported `parseBenchEnv(env = process.env)` + `parseInteger`:
  `PORT` must be an integer in 1..65535, `BENCH_MESSAGES` an integer >= 1,
  `BENCH_MODES` a non-empty subset of `dedicated,shared`. An empty/whitespace
  value still means "use the default" (preserving the old `|| default`
  behaviour); a separators-only list is an error, not an empty run.
- New `tests/bench-browser.test.ts` (7 tests) pins defaults, valid overrides +
  derived URLs, empty-as-absent, and each rejection message.
- Added a source-hygiene guard: a script that is both a `package.json` entry
  point and imported by a test must carry the `invokedDirectly` guard. It
  initially flagged `demo-ws-server.mjs` / `demo-centrifuge-server.mjs`, which
  are pure library modules (exports only, no top-level execution) — the guard
  was narrowed to entry points rather than exempting them by name.
- Mutation-checked twice: reverting `parseInteger` to the raw coercion fails
  exactly the two integer guards; restoring `??` over the empty check fails
  exactly the empty-value test; removing the `invokedDirectly` guard fails the
  hygiene guard with `scripts/bench-browser.mjs runs at import time — gate its
  body behind \`invokedDirectly\``.
- Verification: `tsc --noEmit` (also with `dist/` hidden, the CI condition),
  `eslint .`, and the full suite — **625 tests** (617 + 7 + 1), all green.

## Phase 43 (adopted the neighbor's uncommitted transaction-abort WIP)

- Found uncommitted work in the tree: a `transaction-aborts` fault mode for
  the IndexedDB test double plus two tests (abort rejects + invalidates;
  generic message when `transaction.error` is null). Verified the tests pass
  at runtime, but `pnpm typecheck` failed: the `set onerror` stub calls its
  parameter, which contextually inherits `this: IDBTransaction` and rejects
  a void-receiver call (TS2684). Fixed with a local plain-callback alias.
- Mutation-checked the suite's value: neutering the adapter's
  `transaction.onerror` handler makes both new tests fail (the append hangs
  until timeout — exactly the production failure being pinned); restoring
  passes. 627 unit green; typecheck, lint green.
- Note: the very first post-sync `pnpm check` printed 27 files / 568 tests
  while every later run (5x) shows 32 / 627 green. Unexplained transient;
  recorded here rather than ignored. Ground truth is the repeated 32/627.

## Phase 44 (real defect: adaptive dedup TTL inert on the hot path)

- Found by reading `DedupManager` against its contract: the hot-path
  expiry used the fixed `ttlMs` while the sweep and `getStats()` used the
  adaptive window. A burst shrinking the effective TTL toward `minMs`
  changed nothing where nearly all traffic flows (e.g. 60 s fixed vs
  100 ms effective). One-line fix to expire against `currentTtl()`;
  no behavior change when no adaptive bounds are configured.
- New direct suite `tests/dedup-manager.test.ts` (11 tests, mirrors the
  replay-manager pattern): acceptance/suppression + trace event, TTL
  expiry, FIFO eviction, reset, sweep lifecycle via timer counts, adaptive
  shrink/relax/window-reset. Mutation-checked (fixed TTL restored → the
  adaptive test fails, other 10 pass; fix restored → 11 pass).
- Decided against splitting `getStats()` off a pure TTL computation:
  the window-reset-on-read is provably unobservable from outside (any
  sequence yields identical accept/suppress/stats either way), so changing
  it would be churn, not a fix.
- 638 unit tests green (627 + 11); typecheck, lint, diff-check green.

## Phase 45 (wildcard dead branch, full-teardown coverage, metadata edges)

- Real defect found by reading `cluster.ts` against its own comments: the
  wildcard publish-cache hit guard did `assignedTopics.has(cachedPattern)`,
  but `assignedTopics` is keyed by the opaque topic key while the cached
  value is a plaintext pattern — always false, so the branch was
  unreachable (and the cache's positive value never short-circuited).
  Removed as provably behaviour-preserving (640 tests unchanged) and
  corrected the comment to describe the memoisation as a scan-skip marker.
  cluster.ts statements 95.96 → 96.48, branches 90.21 → 90.50, lines
  97.61 → 98.24.
- Public-API gap: `CrossTabDataBus.unsubscribe(topic)` with NO handler (the
  documented whole-topic teardown) had zero direct coverage — only the
  with-handler and unknown-topic forms were tested, so `handlers.clear()`
  and its n→0 teardown never ran. Added a test pinning: all handlers
  cleared, transport unsubscribe exactly once, per-handler closers become
  no-ops, replay history dropped (no stale replay on re-subscribe), and
  re-subscribe re-establishes the transport subscription. Mutation-checked
  both ways (clear→no-op and skip-replay-cleanup each fail).
- Centrifuge partial metadata envelope: added coverage for messageId-only
  and timestamp-only publishes (the absent key must not be serialised as
  `undefined`). 640 unit tests green (638 + 2); typecheck, lint, e2e 27/27,
  pack, compat green.

## Phase 46 (second dead branch, runtime-guard and error-path coverage)

- Removed a second provably-dead branch: `ReplayManager.schedulePersistenceFlush`'s
  per-message `append` fallback — the only queuer (`record()`) pushes to the
  batch solely when the backend has `appendBatch`, so the fallback can never
  run. Batched append is now unconditional there. 643 unit tests unchanged
  (behaviour-preserving).
- Added error-path coverage with mutation checks: WebSocket binary publish on
  a closed socket reports via `onError` (separate framing path), and
  `assertStructuredCloneable` skips its guard when a runtime lacks
  `structuredClone` (older browsers proceed instead of a spurious TypeError).
- `BatchingStorageWriter` single-retry-timer invariant pinned (flush() cancels
  before re-arming, so it holds independently of scheduleRetry's defensive
  guard — noted in the test rather than claiming that guard).
- Noted for future: `scheduleRetry`'s `retryHandle !== null` guard and
  `scheduleRetentionCleanup`'s `!clearBefore` guard are unreachable given
  their callers' own guards/ordering; left in place as cheap defensive
  redundancy rather than removed.
- Local full e2e initially flaked once (shared-mode session test, 35 s under
  heavy parallel load; passed in 1.6 s in isolation and 27/27 on the re-run) —
  the documented local-load flake class, no source coupling.
- 643 unit green; typecheck, lint, e2e 27/27, pack, compat green.

## Phase 47 (transport error isolation + publication null branch)

- Pinned DataBus transport error isolation: a transport whose `publish`
  throws synchronously (runTransport's inner try/catch) or whose `subscribe`
  rejects (the promise `.catch`) both surface through `onError` and never
  escape the caller. Mutation-checked by deleting the synchronous catch
  (test fails with the raw transport error).
- Pinned `parseDataBusPublication`'s null branch for primitive/null/undefined
  frames with no fallback topic (a transport with no out-of-band channel
  cannot attribute a topic).
- 645 unit tests green; typecheck, lint, diff-check green.

## Phase 48 (release gate: lint before publish)

- The `Release` workflow ran `pnpm check` but not `pnpm lint`, so a version
  tag pointing at a commit that never passed CI's lint job could publish
  unlinted code. Added the lint step, documented it in both release
  checklists, and extended tests/workflows.test.ts to assert the step
  exists (YAML re-validated with PyYAML).
- 646 unit tests green (645 + 1); typecheck, lint, diff-check green.

## Phase 49 (perf-gate variance observation — trend doc not polluted)

- Ran `bench:browser` twice while the dev machine was loaded: the
  round-trip `publish/dedicated` metric moved +49.7% then -3.7% between
  consecutive runs, and the in-page databus microbenchmarks drifted
  ±8–15%. The dedup change from Phase 44 did NOT regress (dedup1000Ms
  moved down), so this is machine-load noise, not a code regression.
- Deliberately did not commit the regenerated `docs/benchmarks.md`: with
  `bench-results/` gitignored the doc is the only record, and enshrining a
  load spike as the new "latest" would mislead. The 50% gate held.
- Finding for future: the two-most-recent-report comparison is sensitive
  to a single noisy run; the databus microbenchmarks are the stable
  signal, the demo round-trip metric is scheduling-dominated. No code
  change made (the 50% ceiling already absorbs it, and changing the
  comparison semantics is a design decision).

## Definitive verification record (2026-09-13, main @ 2b89720 + release dry run)

- `pnpm check`: typecheck + build + 646 unit tests green (33 files).
- `pnpm lint` clean; `pnpm test:e2e` 27/27; `pnpm bench` green.
- `pnpm verify:compat` (baseline v0.20.71) green; `pnpm verify:pack`
  full-surface ESM/CJS green; `pnpm audit` (public registry) clean.
- `npm pack --dry-run`: 107 files, `docs/progress.md` excluded.
- `git diff --check` clean.
- `bench:browser` + `bench:compare --fail-above-pct 50` green (see phase 49
  for the load-variance note); trend doc intentionally not refreshed while
  the machine was loaded.

## Phase 50 (demo chaos visibility + README recovery feature)

- UI gap: a tab dropping handoff ACKs or simulating a crash looked
  identical to a healthy tab. Added a `混沌测试` config row driven by the
  two chaos toggles (`未启用` / `启用（丢弃交接确认、模拟崩溃）`), and asserted
  it in both chaos E2E specs.
- README (en+zh) feature list gained the automatic owner-recovery bullet
  (TTL-gated re-election + the route ack/migration/recovery reliability
  events); the doc parity guard keeps the list-item counts aligned.
- 646 unit green; typecheck, lint, e2e 27/27 green.

## Phase 51 (live chaos gates — fix a mismatch introduced in phase 50)

- The new 混沌测试 config row reads the checkboxes live, but `dropHandoffAck`
  was captured once at bus creation, so toggling it after connect would
  display "启用" while the gate was inactive. Unified both chaos gates into
  one always-installed wrapper that reads the checkboxes at call time
  (transparent when unchecked); the panel can no longer claim an inactive
  mode, and toggling now takes effect immediately. Both chaos E2E specs
  green (13.7 s / 14.0 s); full e2e 27/27; 646 unit green.

## Phase 52 (DataBus stop/reopen edge contracts)

- Pinned four lifecycle/error-path boundaries with regressions in
  `tests/data-bus.test.ts`:
  - an explicit `stop()` after failed-open cleanup reuses the existing stop
    gate and does not issue a second `transport.stop()`;
  - a rejecting page-hide stop is reported through `onError` while the bus
    still reaches a clean suspended state and can reopen on resume;
  - a throwing replay handler is isolated so later history is still delivered
    and the failure is reported through the dispatch-error channel;
  - a second recovery signal arriving while a replacement open is in flight
    reuses that open instead of starting a third transport.
- Mutation check: deleting the in-flight reopen guard in
  `CrossTabDataBus.reopenTransport()` makes the new reuse test fail with
  `startCalls` 3 instead of 2; source restored before verification.
- Verification (2026-09-16, `feat/data-bus-queued-ready-audit` based on
  `c1b0735`): `pnpm check` green (35 files, 750 tests); `pnpm lint` green;
  documentation/workflow contracts 22/22; coverage statements 97.73%,
  branches 93.6%, functions 97.8%, lines 98.98%; `git diff --check` clean.
- No production code changed in this phase; the new tests pin existing
  lifecycle behavior and make future regressions detectable.

## Next candidates (project is feature-complete; future work is verification/deepening)

- Track the browser handoff flake: consider raising HANDOFF_TIMEOUT or moving the
  handoff suite to a dedicated workflow if the shared-runner failure rate stays high.
  -> RESOLVED in phase 6: the storage-event handoff test's budgets stacked past
  the 60s test timeout; global timeout now 90s + explicit 120s there. Remaining
  shared-runner slowness shows up as slower passes, not failures.
- Add a browser benchmark trend doc or CI gate for bench:browser drift.
  -> DONE in phase 6: pnpm bench:trend generates docs/benchmarks.md (en+zh)
  from the bench-results archive; bench:compare gate documented in both
  release checklists. (A CI regression-threshold gate stays deliberately
  local-only: shared-runner timing noise makes numeric CI gates unreliable.)
- Release-readiness: run the full release checklist dry (verify:published needs a
  published version; everything else verified locally).

## Recovery entry

If interrupted: working tree state, current commit, and any in-flight test
outputs are recorded here (see Task pool checkboxes). Resume with:
`pnpm check && pnpm lint && pnpm test:e2e && pnpm bench && pnpm verify:pack`
then continue the next unmarked task. Push only after the phase is locally green.
