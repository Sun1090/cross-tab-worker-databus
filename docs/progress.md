## 0.21 roadmap 0.13.0 candidates closure (2026-09-20)

- 状态：已完成（roadmap 0.13.0 候选全部关闭）。
- 依据：候选 1（冻结公共导出面 + transport 无关信封）由根导出面回归、tag 间 `verify:compat`、协议 fixture 覆盖；候选 3（长时浏览器浸泡）由真实 Chromium 多 Tab 浸泡与重复 BFCache/reload/owner-handoff 场景覆盖；候选 4（迁移指南与弃用策略）由发布清单策略 + 两语言 getting-started「Upgrading & Deprecation」+ legacy 帧一小版本兼容 + `getDiagnostics().protocol` 组成。
- 变更：`docs/roadmap.md`、`docs/zh/roadmap.md` 将 0.13.0 候选 1/3/4 标记为已交付（保持列表项数与结构一致，通过双语 parity 护栏）。
- 验证：`pnpm exec vitest run tests/documentation.test.ts`（17/17）通过。
- 风险 / 回滚：仅文档；回滚 = revert 本任务提交。
- 下一项：roadmap 公开候选已全部交付；后续仅剩常规依赖/安全巡检与 typescript-eslint 就绪后的 TypeScript 7 评估。
- 更新时间：2026-09-20。

## 0.21 dependency patch refresh (2026-09-20)

- 状态：已完成。
- 变更：`@types/node` `^26.6.1` → `^26.6.2`；将 `centrifuge` 加入 devDependencies 并固定为 `^5.7.4`（此前仅为 optional peer，与 `react`/`vue` 的 peer+dev 模式不一致；dev 固定后可针对最新 patch 运行测试），锁文件由 5.7.0 升到 5.7.4。
- 未变更：TypeScript `^6.0.3` 保持——7.0.2 仍受 typescript-eslint 支持矩阵阻塞；`centrifuge` peer 范围保持 `^5.5.3`，对下游完全兼容。
- 验证：`pnpm check`（37 files / 825 tests）、`pnpm lint`、`pnpm test:e2e` 27/27、`pnpm verify:compat`、`pnpm verify:pack`、`pnpm audit`（无已知漏洞）均通过。
- 风险 / 回滚：patch 级升级；回滚 = revert 本任务提交并重装。
- 下一项：在 typescript-eslint 支持后评估 TypeScript 7；继续常规依赖与安全巡检。
- 更新时间：2026-09-20。

## 0.21 benchmark coverage for adaptive dedup, pruning, multi-tab (2026-09-20)

- 状态：已完成（关闭 roadmap 0.20.69 候选 4 剩余项）。
- 变更：`tests/bench/data-bus.bench.ts` 新增 adaptive dedup（推进时钟驱动自适应速率窗口）与 age 策略 replay prune 两个基線；`tests/bench/cluster.bench.ts` 新增双 worker 跨 Tab fan-out 基線（共享 `MemoryStorage` + `ChannelHub`，owner publish → peer EVENT 同步 fan-out）。
- 文档：`docs/roadmap.md`、`docs/zh/roadmap.md` 将 0.20.69 候选 4 由“部分交付”更新为“已交付”，列入 adaptive dedup、age prune、双 worker fan-out。
- 验证：`pnpm bench`（3 files / 28 tests）、`pnpm typecheck`、`pnpm lint`、`git diff --check` 通过。
- 风险 / 回滚：仅基准与文档；回滚 = revert 本任务提交。
- 下一项：继续跟踪依赖升级（`@types/node` 26.6.2、`centrifuge` 5.7.4），TypeScript 7 仍受 typescript-eslint 阻塞。
- 更新时间：2026-09-20。

## 0.21 storage-event close isolation (2026-09-20)

- 状态：已完成回归（无 runtime 行为改动）。
- 覆盖：一个 channel `close()` 会清除共享 channel key（浏览器会触发 newValue 为 null 的 storage 事件，`onStorage` 已忽略），回归验证它不影响其余 tab 之间的投递；同时验证 `close()` 幂等（重复调用不抛错、不重复清理）。
- 覆盖（同批）：混合版本 envelope 兼容——缺少 `senderId` 的旧版 peer 帧（仅含 `seq` + `message`）仍被解析并投递，保证跨版本 tab 兼容。
- 变更文件：`tests/storage-channel.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/storage-channel.test.ts`（15/15）、`pnpm check`（37 files / 825 tests）、`pnpm lint`、`git diff --check` 通过。
- 风险 / 回滚：仅测试；回滚 = revert 本任务提交。
- 下一项：继续审计 storage-event channel 在 pagehide 期间写入与 close 的交错。
- 更新时间：2026-09-20。

## 0.21 storage-event same-document boundary (2026-09-20)

- 状态：已完成文档与回归（无 runtime 行为改动）。
- 边界：storage 事件只在其他 document 派发，因此同一 document 内共享同一 `clusterKey` 的两个 bus runtime 不会经降级通道交换 channel 帧；它们仍通过共享 localStorage 协调记录与 reconcile 循环收敛（上界为一个心跳间隔）。
- 变更：`docs/configuration.md` 与 `docs/zh/configuration.md` 明确该边界与规避方式（每个 runtime 使用不同 `clusterKey`，或保留 BroadcastChannel）；`tests/storage-channel.test.ts` 新增同 document 兄弟 channel 不投递的回归（同时防止未来误加同 document 派发导致双投递）。
- 验证：`pnpm check`（37 files / 823 tests）、`pnpm typecheck`、`pnpm lint`、`git diff --check` 均通过。
- 风险 / 回滚：仅文档与测试；回滚 = revert 本任务提交。
- 下一项：审计 `close()` 清除共享 channel key 与并发写入的交互时机。
- 更新时间：2026-09-20。

## 0.21 storage-event write-failure containment (2026-09-20)

- 状态：已完成故障注入回归与验证（无生产代码改动）。
- 覆盖：storage-event fallback 的 `postMessage` 在 localStorage 写入被拒（quota/security/private mode）时必须上抛——`WorkerClusterRuntime.send()` 依赖该异常把帧报告为未投递（`publish()` 返回 false），而不是让一个丢帧看起来像成功。
- 测试：`StorageEventHub` 新增 `failWrites` 故障注入（下一次写入抛 `QuotaExceededError`）。channel 级回归验证失败帧不达 peer 且随后写入恢复；cluster 级回归验证非 owner `publish()` 在写入失败时返回 false 且不抛出、写入恢复后返回 true。
- 变更文件：`tests/storage-channel.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/storage-channel.test.ts`（12/12）、`pnpm check`（37 files / 822 tests）、`pnpm typecheck`、`pnpm lint`、`git diff --check` 均通过；变异校验：删除 `cluster.send()` 的 try/catch 后 cluster 回归失败。
- 风险 / 回滚：仅测试与故障注入，无 runtime 行为变化；回滚 = revert 本任务提交。
- 下一项：继续审计 storage-event close 后的关闭竞态与同文档多 runtime 隔离。
- 更新时间：2026-09-20。

## 0.21 storage-event listener isolation (2026-09-19)

- 状态：已完成实现、回归测试与验证。
- 缺陷：storage-event fallback 在单个 channel 上依次调用 listeners；任一 consumer 抛错会中断循环，使后续 consumer 丢失同一 frame，与 EventTarget 的 listener 隔离语义不一致。
- 修复：逐 listener 隔离异常，失败 consumer 不再阻断其余订阅者。
- 测试：首个 listener 主动抛错，验证后注册的 listener 仍收到完整 REGISTRY frame。
- 变更文件：`src/core/environment.ts`、`tests/storage-channel.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/storage-channel.test.ts`（10/10）、`pnpm typecheck`、`pnpm check`（37 files / 820 tests）、`pnpm lint`、`git diff --check` 均通过。
- 风险 / 回滚：仅隔离 opt-in storage-event channel 的 consumer 异常；正常 dispatch 与 BroadcastChannel 路径不变。回滚 = revert 本任务提交。
- 下一项：完成门禁、原子提交并通过 PR/CI 合入。
- 更新时间：2026-09-19。

## 0.21 storage-event sender collision hardening (2026-09-19)

- 状态：已完成实现、故障回归与验证。
- 缺陷：storage-event fallback 仅用每个 sender 自增的 `seq` 区分写入；两个 tab 的首帧均为 `seq=1`，若 payload 相同就会写出完全相同的 localStorage value，浏览器按 Web Storage 语义抑制第二次 storage event。
- 修复：channel envelope 新增每个 channel 实例的随机 `senderId`，与 `seq` 共同保证跨 tab 的相同帧仍改变存储值。
- 测试：StorageEventHub 现在真实模拟 same-value `setItem` 不派发事件；新增两个 writer 各自首发相同 frame、第三个 observer 必须收到两次的回归。
- 变更文件：`src/core/environment.ts`、`tests/storage-channel.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/storage-channel.test.ts`（9/9）、`pnpm typecheck`、`git diff --check` 均通过。
- 风险 / 回滚：只改变 opt-in storage-event fallback 的内部 envelope；接收端仍读取同一 `message` 字段，BroadcastChannel 与协调存储格式不变。回滚 = revert 本任务提交。
- 下一项：运行全量门禁并通过 PR/CI 合入；继续审计 storage-event close/exception 与多 runtime 隔离。
- 更新时间：2026-09-19。

## 0.20.93 release completed (2026-09-19)

- Milestone / 版本：`0.20.93` patch reliability release。
- 状态：已发布；release workflow、npm publish 与发布后 consumer smoke 全部成功。
- 分支 / commit：release PR #113 squash 合入 `d7d67d3`；tag `v0.20.93` 精确指向该提交。
- 完成内容：发布 package compatibility gate、storage/environment degradation、稳定 tab identity、teardown retry cleanup 与开发工具链 patch 更新。
- 发布结果：GitHub Release `v0.20.93`；npm `cross-tab-worker-databus@0.20.93`；Release workflow run `35407094756` 成功。
- 验证：PR #113 的 verify、browser、CodeQL 全绿；release workflow 全绿；`npm view cross-tab-worker-databus@0.20.93 version --registry=https://registry.npmjs.org` 返回 `0.20.93`；`PUBLISHED_VERSION=0.20.93 pnpm verify:published` 通过 ESM/CJS consumer smoke。
- 阻塞：无。
- 风险 / 回滚：tag 不移动、不复用；若发现发布缺陷，使用后续 patch 修复。runtime 无 schema migration，消费者可固定回 `0.20.92`。
- 下一项：进入下一 reliability milestone，继续审计 storage-event fallback 的 postMessage 写入异常与 lifecycle 收敛。
- 更新时间：2026-09-19。

## 0.20.93 release freeze (2026-09-19)

- Milestone / 版本：`0.20.93` patch reliability release。
- 状态：`RELEASE_FREEZE`；版本、release notes 与全量本地发布门禁均已完成，待 release PR/CI。
- 分支 / commit：`feat/release-0.20.93`；基线 `32e8f1e`。
- 完成内容：汇总 package compatibility gate、storage capability/degradation、稳定 tab identity、teardown retry cleanup 与开发工具链 patch 更新。
- 变更文件：`package.json`、`CHANGELOG.md`、`docs/roadmap.md`、`docs/zh/roadmap.md`、`docs/benchmarks.md`、`docs/zh/benchmarks.md`、`docs/progress.md`。
- 验证：`pnpm check`（37 files / 818 tests）、`pnpm lint`、`pnpm test:coverage`（97.71% statements / 93.97% branches）、`pnpm bench`（3 files / 25 benchmarks）、`pnpm test:e2e`（27/27）、两次 `pnpm bench:browser`、`pnpm bench:compare --fail-above-pct 50`、`pnpm bench:trend`、`pnpm verify:pack`、`pnpm verify:compat`、`pnpm audit --registry=https://registry.npmjs.org`（无已知漏洞）、`npm pack --dry-run --json`、`RELEASE_TAG=v0.20.93 node scripts/verify-release-version.mjs`、`git diff --check` 均通过。
- 阻塞：无。
- 风险 / 回滚：patch release 不改变 public API；如发布门禁失败则在当前 feature branch 修复，不创建或移动 tag。发布后回滚采用后续 patch，不复用 `v0.20.93`。
- 下一项：提交 release commit，创建 PR，等待 CI 后 squash 合入并从精确 main commit 创建不可变 `v0.20.93` tag。
- 更新时间：2026-09-19。

## 0.21 development dependency refresh (2026-09-19)

- 状态：已完成依赖更新与全量本地验证。
- 更新：`@types/node 26.5.1 → 26.6.1`、`eslint 10.10.0 → 10.11.0`、`jsdom 30.0.1 → 30.1.0`、`vue 3.5.42 → 3.5.43`；TypeScript 7 属于 major，当前不纳入本轮 patch/minor refresh。
- 变更文件：`package.json`、`pnpm-lock.yaml`、`docs/progress.md`。
- 验证：`pnpm check`（37 files / 818 tests）；`pnpm lint`；`pnpm audit --registry=https://registry.npmjs.org --audit-level high`（无已知漏洞）；`git diff --check` 均通过。
- 风险 / 回滚：仅开发/测试依赖，不改变发布包 runtime dependencies 或 public API；CI 使用 Node 22，更新后的 jsdom engine 满足。回滚 = revert 本任务提交。
- 下一项：通过 CI/浏览器门禁后合入；继续 lifecycle/adapter 异步隔离审计，不单独触发发布。
- 更新时间：2026-09-19。

## 0.21 cluster teardown retry regression (2026-09-19)

- 状态：已完成 cluster 级故障注入与验证。
- 覆盖：runtime 正常启动并持久化后，将底层 `removeItem` 切换为持续 `SecurityError`；pagehide 最终 flush 确实失败，但推进 10 秒 timer 不再产生任何 storage retry。
- 恢复：恢复 adapter 后 pageshow 可重新进入 coordinated 状态并正常 stop，证明 teardown reset 不会污染下一 lifecycle。
- 变更文件：`tests/cluster.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/cluster.test.ts`（77/77）；`pnpm typecheck`；`git diff --check` 均通过。
- 风险 / 回滚：仅新增故障回归，不改变 runtime；回滚 = revert 本任务提交。
- 下一项：审计 storage-event fallback 的 postMessage 写入异常是否会破坏 cluster control dispatch 或 lifecycle 收敛。
- 更新时间：2026-09-19。

## 0.21 storage retry teardown cleanup (2026-09-19)

- 状态：已完成实现、回归测试与验证。
- 缺陷：cluster pagehide/stop 的最终 best-effort storage flush 若失败，会由 `BatchingStorageWriter` 启动 retry timer；runtime 已停止协调后仍遗留后台写入与 backoff 状态。
- 修复：新增不触碰持久化数据的 `discardPending()`，清除 queued mutations、retry timer/counters 与 backoff；pause 在最终 flush/registry 通知后调用。失败清理仍由既有 worker/subscriber TTL 收敛。
- 测试：故障注入永久 quota failure，验证 teardown discard 清空 pending 与 timer、保留已持久化数据。
- 变更文件：`src/core/storage-batch.ts`、`src/core/cluster.ts`、`tests/storage-batch.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/storage-batch.test.ts tests/cluster.test.ts`（91/91）；`pnpm typecheck`；`git diff --check` 均通过。
- 风险 / 回滚：仅停止 runtime teardown 后的失败重试；正常成功 flush 不变，遗留 metadata 仍按 TTL 清理。回滚 = revert 本任务提交。
- 下一项：增加 cluster 级 pagehide/stop 故障注入，验证 adapter 持续失败时 restart 不继承旧 retry/backoff。
- 更新时间：2026-09-19。

## 0.21 stable in-memory tab identity fallback (2026-09-19)

- 状态：已完成实现、回归测试与验证。
- 缺陷：`getOrCreateTabId()` 在 sessionStorage 缺失、持续抛错或写入后不可读时，每次调用都会生成不同 ID；同一 document 创建多个 bus runtime 会被误认为不同 tab，破坏 subscriber 清理与 tab-scoped 协调语义。
- 修复：模块级缓存已签发的 tab ID；正常 storage 读取、首次创建和异常 fallback 均同步缓存，后续调用在 storage 不可用或值缺失时复用同一 document identity。opener clone 的首次再生规则保持不变。
- 测试：新增 write-only sessionStorage 与持续抛错 adapter 的重复调用回归，验证 random ID 只生成一次。
- 变更文件：`src/core/environment.ts`、`tests/environment.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/environment.test.ts tests/cluster.test.ts`（98/98）；`pnpm typecheck`；`git diff --check` 均通过。
- 风险 / 回滚：缓存仅限当前 JS document/module 实例，不跨 tab；正常 sessionStorage 与 opener clone 行为不变。回滚 = revert 本任务提交。
- 下一项：审计 cluster teardown/pagehide 在 storage flush 持续失败时是否遗留 retry timer，并验证 restart 收敛。
- 更新时间：2026-09-19。

## 0.21 channel-construction failure degradation (2026-09-19)

- 状态：已完成实现、回归测试与验证。
- 缺陷：`WorkerClusterRuntime.activate()` 直接调用自定义 environment 的 `createChannel()`；同步抛错会让 `start()` 向外失败，并遗留 `started = true` 的半激活状态，与注释和既有 local-mode 降级契约不符。
- 修复：捕获 channel construction 异常并按 unavailable channel 处理，关闭协调 storage，继续使用本地 owner/control 路径。
- 测试：故障注入 `createChannel()` 抛 `SecurityError`，验证 start 不抛、snapshot 为非协调模式、本地订阅正常、无 registry metadata 写入且 stop 可完成。
- 变更文件：`src/core/cluster.ts`、`tests/cluster.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/cluster.test.ts`（76/76）；`pnpm typecheck`；`git diff --check` 均通过。
- 风险 / 回滚：仅将同步 channel capability failure 收敛到已有 local-mode；正常 channel 与 storage 协调路径不变。回滚 = revert 本任务提交。
- 下一项：审计 `getOrCreateTabId()` 的 sessionStorage read-back/复制 opener 边界，以及 teardown 时失败 storage flush 的 retry 生命周期。
- 更新时间：2026-09-19。

## 0.21 storage capability round-trip probe (2026-09-18)

- 状态：已完成实现、回归测试与验证。
- 缺陷：`canUseStorage()` 文档声明执行 write-read-delete，但实现只 write-delete；接受写入却无法读回的受限/异常 adapter 会被误判为可协调，随后 cluster 在不可读 registry 上运行。
- 修复：probe 写入后必须精确读回 sentinel，再删除 probe；read mismatch、read throw、delete throw 均降级为 storage unavailable。
- 测试：新增 write-only adapter、读取抛错、删除抛错三类故障注入；正常 round-trip 仍清除 probe。
- 变更文件：`src/core/environment.ts`、`tests/environment.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/environment.test.ts tests/cluster.test.ts`（95/95）；`pnpm typecheck`；`git diff --check` 均通过。
- 风险 / 回滚：只会让不满足完整 Storage 契约的环境更早进入既有 local-mode 降级路径；正常 browser storage 行为不变。回滚 = revert 本任务提交。
- 下一项：继续验证 probe 失败后的 cluster/channel 降级不会残留协调写入，并审计 sessionStorage tab-id 的同类 read-back 边界。
- 更新时间：2026-09-18。

## 0.21 storage clear failure cleanup (2026-09-18)

- 状态：已完成实现、回归测试与验证。
- 缺陷：`BatchingStorageWriter.clear()` 在底层 storage adapter 的 `clear()` 抛错前尚未取消 retry timer/计数，失败清理会遗留后台 timer 和升高的 backoff 状态。
- 修复：先清空 pending 状态、取消 timer、清除 retry counters 并重置 backoff，再调用可能抛错的 adapter clear；adapter 错误仍按原语义向调用者传播。
- 测试：故障注入 `setItem` 持续失败并让 `clear` 抛 `SecurityError`，验证 pending 与 timer 均被清理，后续写入从 50ms 初始 backoff 重新开始。
- 变更文件：`src/core/storage-batch.ts`、`tests/storage-batch.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/storage-batch.test.ts`（14/14）；`pnpm typecheck`；`git diff --check` 均通过。
- 风险 / 回滚：仅改变 adapter clear 失败时的内部清理顺序；错误仍抛出，正常路径行为不变。回滚 = revert 本任务提交。
- 下一项：继续审计 storage adapter remove/clear 异常与 cluster teardown/restart 的 timer、pending metadata 收敛。
- 更新时间：2026-09-18。

## 0.21 recursive export-condition compatibility gate (2026-09-18)

- 状态：已完成实现、回归测试与验证。
- 修复：export compatibility 检查改为递归遍历既有 condition tree，除标准 `types`/`import`/`require`/`default` 外，也保护 custom condition 与嵌套条件；嵌套无条件 target 改为 import-only object 同样会失败。
- 测试：新增 custom `browser` condition 删除、嵌套 `node.require` 删除、嵌套 string → import-only object 三类真实 Git baseline 回归。
- 变更文件：`scripts/verify-version-compat.mjs`、`tests/version-compat.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/version-compat.test.ts`（18/18）；`pnpm typecheck`；`pnpm verify:compat`；`git diff --check` 均通过。
- 风险 / 回滚：门禁对既有自定义条件执行更严格的向后兼容约束，但不改变 runtime 或当前发布包；回滚 = revert 本任务提交。
- 下一项：结束本轮 package gate 深挖，转回 cluster lifecycle/recovery 的运行时故障注入与收敛审计。
- 更新时间：2026-09-18。

## 0.21 fallback-array export compatibility gate (2026-09-18)

- 状态：已完成实现、回归测试与验证。
- 修复：兼容性门禁现在识别 package `exports` 的 fallback array；既有无条件 string/array target 迁移后必须仍有可解析的无条件路径，空数组或 import-only conditional object 会被拒绝。
- 测试：覆盖 string → 非空 fallback array 的兼容迁移、string → 空数组，以及 array → import-only object 的破坏性迁移。
- 变更文件：`scripts/verify-version-compat.mjs`、`tests/version-compat.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/version-compat.test.ts`（15/15）；`pnpm typecheck`；`pnpm verify:compat`；`git diff --check` 均通过。
- 风险 / 回滚：仅强化发布前门禁；不改变 runtime、当前 package exports 或 public API。回滚 = revert 本任务提交。
- 下一项：审计嵌套 conditional/fallback export 的递归兼容性，然后回到 cluster lifecycle/recovery 故障注入。
- 更新时间：2026-09-18。

## 0.21 unconditional export compatibility gate (2026-09-18)

- 状态：已完成实现、回归测试与验证。
- 修复：版本兼容性门禁把字符串 export 视为无条件 target；当后续版本改为 conditional object 时，必须保留非空 `default`，避免 import-only 映射静默移除 CommonJS 或未知条件消费者的入口。
- 测试：覆盖 string → `{ import, default }` 的兼容迁移，以及 string → `{ import }` 的破坏性迁移拒绝。
- 变更文件：`scripts/verify-version-compat.mjs`、`tests/version-compat.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/version-compat.test.ts`（12/12）；`pnpm typecheck`；`pnpm verify:compat`；`git diff --check` 均通过。
- 风险 / 回滚：仅强化发布前门禁，不改变 runtime、public API 或 package 当前 exports；回滚 = revert 本任务提交。
- 下一项：继续审计 export 数组与嵌套 conditional target 的兼容语义，再转回 cluster lifecycle/recovery 深度回归。
- 更新时间：2026-09-18。

## 0.21 package metadata compatibility gate (2026-09-18)

- 状态：已完成实现、回归测试与验证。
- 修复：版本兼容性门禁现在不仅拒绝删除或置空 `types` / `typesVersions`，也拒绝将既有 metadata 容器从对象改成标量或反向改变形状，避免 TypeScript 解析契约被静默破坏。
- 测试：新增 `typesVersions` 对象→标量和 `types` 标量→对象的真实临时 Git 仓库回归。
- 变更文件：`scripts/verify-version-compat.mjs`、`tests/version-compat.test.ts`、`docs/progress.md`。
- 验证：`pnpm exec vitest run tests/version-compat.test.ts`（9/9）；`pnpm typecheck`；`pnpm verify:compat`；`git diff --check` 均通过。
- 风险 / 回滚：仅扩大发布前兼容性门禁，不改变运行时 API；回滚 = revert 本任务提交。
- 下一项：继续检查 0.21 reliability/deepening 的未覆盖边界，并在累计变更达到发布阈值前保持独立原子提交。
- 更新时间：2026-09-18。

## 0.20.92 published / compatibility follow-up (2026-09-18)

- 状态：接手中断变基后恢复干净 feature 分支；仅回放下一阶段修复，未重复回放 PR #97 已 squash 的旧提交。冲突现场备份在 `/tmp/databus-progress-rebase-conflict-20260918.md`，原提交保留于 `codex/backup-compat-before-rebase-20260918`。
- 发布：PR #97 全部 CI 成功并合入 `c31ae25`；远端不可变 `v0.20.92` 指向该提交，Release run `35284238208` 已 success。npm 0.20.92 可见，本地 `PUBLISHED_VERSION=0.20.92 PUBLISHED_VERIFY_ATTEMPTS=2 pnpm verify:published` ESM/CJS smoke 成功。部署为 npm package，无独立服务部署。
- 下一阶段：`feat/compat-export-gates` / PR #98；已有修复重定位为 `8f4aee3`，与 release tag 严格分离。全量 `pnpm check` 37 files / 798 tests 通过，lint/typecheck/compat 通过；发布后在 `main@6cc17ec` 再次完成 check、lint、public-registry audit 与 published consumer smoke。
- 新缺陷与修复：新增两个 CLI 用例证明顶层 types/typesVersions 从有效值变 null 仍被放过；修正 package metadata 检查，保持缺字段检测，新增 2 项从红变绿。
- 变更文件：scripts/verify-version-compat.mjs、tests/version-compat.test.ts、CHANGELOG.md、本文件。
- 验证：定向测试 7/7；typecheck、lint、verify:compat、diff-check 成功。
- 风险 / 回滚：仅 CI gate，无 runtime/API/storage 变化；修复可独立 revert；发布消费者可固定 0.20.91，不移动 0.20.92 tag。
- 阻塞：无；PR #98 已全绿 squash 合入 `45134c3`。下一项：进入 0.21 reliability/deepening 任务池；不为单项 tooling 修复重新发布 0.20.92。
- 更新时间：2026-09-18 Asia/Shanghai。

## Next milestone — public export gate correctness (completed 2026-09-18)

- 状态：实现完成，独立于冻结的 0.20.92 发布；不为单项 tooling 修复立即发布新版本。
- 分支：`feat/compat-export-gates`；PR #98 已全绿 squash 合入 `45134c3`。
- 缺陷证据：临时 Git 仓库真实运行兼容性 CLI，原实现 5 项测试中 4 项失败；错误放过 conditional export 变 string、public export 变 null、worker default 被删除、types target 变 null。
- 修复：显式拒绝禁用已有导出，检查非空条件对象，加入 default 条件；保留新增导出与更改目标文件名的兼容行为。
- 文件：scripts/verify-version-compat.mjs、tests/version-compat.test.ts、CHANGELOG.md、本文件。
- 验证：修复后定向 5/5 通过；lint、typecheck、真实 package verify:compat、diff-check 通过（上一轮定向验证）。提交前再次运行同组检查。
- 风险 / 回滚：只改变 CI/release gate，不改运行时、API、协议或 storage；可独立 revert。该门禁仍是 metadata 校验，不宣称完整 TypeScript 语义兼容性证明。
- 阻塞：无；本机未配置 tag 签名，不伪造签名，按项目既有版本 tag 流程发布。
- 下一项：合入此原子修复；0.20.92 从 c31ae25 精确 tag 发布并做 published consumer smoke；继续检查 export 条件边界。
- 更新时间：2026-09-18 Asia/Shanghai。

## 0.20.92 RELEASE_FREEZE — local gates complete (2026-09-18)

- 状态：本地必需门禁全部通过，待 PR CI / squash 合入 / 精确 tag / 发布消费者验证；未宣称已发布。
- 分支 / commit：`feat/release-0.20.92`；发布门禁修复 `97dc681`，本条随 release preparation commit。
- 完成：791 单测（36 文件），类型 / build / lint；coverage 97.69% statements、93.95% branches、98% functions、98.95% lines；27/27 browser E2E；25/25 microbenchmark；packed consumer ESM/CJS；compat 对 v0.20.91；依赖 audit 无已知漏洞。
- Browser benchmark：两次运行均成功，七项指标全部在 50% 回归阈值内。未用微基准替换真实 browser 测量。报告存于本地 ignored `bench-results/browser-2026-09-17T22-45-{14-110,31-009}Z.json`。
- 打包：`npm pack --dry-run --json` 109 files，无 src/tests/scripts/.github/progress 私有文件；`RELEASE_TAG=v0.20.92 node scripts/verify-release-version.mjs` 通过。
- 变更：package.json 版本草稿定稿，CHANGELOG 更新实际日期与门禁修复，双语 roadmap 保持真实冻结状态。
- 阻塞：无。后续不重复全量本地验证，只有新代码或失败证据才追加定向验证。
- 风险 / migration / rollback：patch 无公共 API、worker 协议或 storage schema 变更；消费者可固定回 0.20.91。tag 不移动，发布产物修复使用新 patch。
- 下一项：fetch/rebase、提交 feature branch PR、等待 CI 并 squash 合入；随后精确 tag 发布和 npm consumer smoke。下一 milestone 检查兼容性验证器的 export 条件边界。
- 更新时间：2026-09-18 Asia/Shanghai。

## 0.20.92 RELEASE_FREEZE — version identity gate (2026-09-18)

- 状态：完成发布身份校验修复；0.20.92 仍未发布，现有 package/CHANGELOG/roadmap 发布草稿保留，等待全量门禁与 PR。
- 分支 / 基线：`feat/release-0.20.92` / `e4d9343`；本条随原子修复提交，准确提交可用 `git log --grep="validate release tag"` 查询。
- 完成：发布工作流在任何 release/publish 操作之前校验 tag 与 package 版本严格一致，并要求唯一非空 CHANGELOG 章节；新增真实子进程回归用例。中英文清单改为功能分支 PR、精确 tag 推送和不可变发布 tag，不再建议直接推送 main 或重用坏产物的 tag。
- 变更文件：`.github/workflows/release.yml`、`scripts/verify-release-version.mjs`、`tests/release-version.test.ts`、`tests/workflows.test.ts`、`docs/release-checklist.md`、`docs/zh/release-checklist.md`、本文件。
- 验证：基线 `pnpm check` 780/780；`pnpm lint`、public-registry `pnpm audit` 通过；修复后 release/workflow/documentation 定向测试 33/33，lint、typecheck、diff-check 通过。远端最近 CI/CodeQL 均成功，无打开 PR 或 milestone。
- 阻塞：无。
- 风险 / 回滚：只影响发布前验证，不改 runtime/API/storage；误拒绝时修正校验后重跑不变 tag，产物缺陷使用新的 patch，不移动已发布 tag。
- 下一项：全量 coverage、E2E、benchmark、compat 和 packed consumer 门禁，再完成 0.20.92 发布。
- 更新时间：2026-09-18 Asia/Shanghai。

## 0.20.92 release-readiness verification continuation (2026-09-16)

- 状态：发布前验证继续通过，未触发停止条件。
- 验证：`pnpm test:e2e`（27/27，含 crash TTL、BFCache、SharedWorker、storage-event fallback、replay persistence、WebSocket、a11y）；`pnpm bench`（3 files，25/25）；`pnpm verify:pack`（ESM/CJS root 与 subpath consumer）；`pnpm verify:compat`（0.20.92 对 0.20.91 的 public exports/type metadata 兼容）。
- 结果：未发现新的功能、打包或兼容性回归；npm 环境仅报告现有配置弃用 warning，不影响验证结果。
- 风险 / 回滚：本轮不改变运行时代码、public API 或发布产物来源。
- 下一项：继续检查发布清单中剩余可执行验证与仓库状态，发现失败立即修复。
- 更新时间：2026-09-16。

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

## Phase 53 (test-integrity audit: gates that could not fail)

- Milestone: 0.20.x reliability line (post-0.20.93), status complete on branch
  `fix/test-timeout-headroom` (based on `7011d6d`, direct follow-ups on `main`).
- Started from a real failure, not a hypothesis: the first full `pnpm test` of
  the session produced **11 timeout failures across 4 files** while every one of
  those tests passed in isolation. Root cause is budget, not behavior: the
  package/compat gates spawn 4 `git` + 1 `node` subprocess per case (18 cases,
  worst 1.7s unloaded) against vitest's 5000ms default, and the seeded lifecycle
  fuzzer measured **13.2s idle / 29.6s under load / 33.7s under load + V8
  coverage** against its own explicit 30s budget — i.e. the release gate
  (`pnpm test:coverage`, which doubles that runtime by design) was already
  overrunning it. Unit `testTimeout` is now 15s and the fuzzer's explicit budget
  120s; the same loaded run that had failed is green (37 files, 825→832 tests).
- Then audited uncovered lines for the "test that cannot fail" class, and found
  five, each mutation-checked:
  1. `tests/cluster.test.ts` "evicts the oldest route owner cache entry once the
     cap is reached" never subscribed, so every publish took the `assignedTopics`
     fast path, `resolvePublishTarget()` never ran, the cache stayed empty, and
     the size assertion held with the eviction loop deleted outright (verified).
     Rewritten to drive three peer-owned topics from a second runtime with
     `routeOwnerCacheMax: 2`, asserting exact size/hits/misses and LRU order —
     it fails both when eviction is disabled (size 3) and when the recency touch
     is removed (a FIFO evict drops the wrong entry).
  2. `replay-manager` `start()`'s failed-hydration latch reset had no pin:
     deleting the latch passed the whole suite, which is exactly the bug that
     leaves durable history unloaded for the lifetime of an instance after one
     transient store error plus a BFCache resume (suspend/start never calls
     `resetBuffers()`).
  3. The receiver's metadata-less branch of an unpacked remote batch was
     unasserted, while plain `publishBatch` items are the common case; deleting
     it silently dropped one of four messages.
  4. `validation.ts` `replay.maxPerTopic` and `replay.pruneStrategy` had no
     assertion anywhere (siblings in the same block are pinned, `adaptiveTtl`
     is): a typo'd strategy would fall through to count pruning silently.
  5. `error-utils` `serializeError`'s no-`structuredClone` runtime branch (the
     twin of the `assertStructuredCloneable` guard pinned in phase 46).
  6. `CentrifugeSession`'s connection-level `state`/`disconnected` lifecycle
     guards were unpinned although 0.20.89 claims client-callback isolation was
     closed, and the credential provider's *async rejection* reply (a token
     endpoint returning 500) was untested; without that reply the Worker waits
     for a `TOKEN_RESPONSE` that never comes.
- Real source change (1): `src/vue.ts` registered `watch(() => handler, …)` on a
  parameter binding that cannot change, so it was a permanently inert reactive
  effect that also implied the composable supported swapping handlers; the
  subscription now passes the handler directly. The surviving same-target guard
  in that composable was unpinned, and without it changing `bus` and `topic` in
  one tick tore down and re-created a subscription that had just been
  established (route release + re-election for a rebind that already happened).
- Deliberately NOT changed after reachability analysis (documented rather than
  padded): `centrifuge.ts` 339/354/359/364 (heartbeat double-arm and the
  stale-backend error guards — every path that changes `generation` detaches or
  terminates the old backend's listeners first), `hooks.ts` 45 (a re-entrancy
  guard whose body would in fact leak the created bus, but which React's effect
  scheduling makes unreachable), `replay-persistence.ts` 208/244/268/292
  (`settled` re-entry guards; the real protection is the `current === db` check
  in `invalidate()`), `trace.ts` 449 (percentile bucket ceiling fallback,
  unreachable because `sampleCount` is the bucket total), `cluster.ts` 296/816/
  990/1245 and `data-bus.ts`'s defensive guards.
- Changed files: `vitest.config.ts`, `src/vue.ts`, `tests/cluster.test.ts`,
  `tests/centrifuge-session.test.ts`, `tests/centrifuge.test.ts`,
  `tests/data-bus.test.ts`, `tests/error-utils.test.ts`,
  `tests/lifecycle-invariants.test.ts`, `tests/replay-manager.test.ts`,
  `tests/vue.test.ts`.
- Verification (2026-09-21/22): `pnpm typecheck` green; `pnpm lint` green;
  `npx vitest run` 37 files / **832 tests** green, and green a second time under
  an artificial load (8 spinning CPUs, load average 350+) both with and without
  `--coverage`; `pnpm test:e2e` 27/27 (1.2m); `pnpm bench`, `pnpm verify:pack`,
  `pnpm verify:compat` green; `git diff --check` clean.
- Blocker, external: the GitHub API is unreachable from this network
  (`api.github.com` → `unexpected EOF`, GraphQL → connection reset), so CI status
  and PR creation cannot be verified right now. Push/PR retried below.
- Risk/rollback: low. One production line-count change in an optional-peer
  adapter (behavior-preserving; the mutation check proves the guard that remains
  is load-bearing) plus test/config budgets. Rollback = revert the branch's
  commits individually.
- Next: continue the same audit against `data-bus.ts`'s remaining defensive
  branches and the IndexedDB adapter's open-failure path, then decide whether the
  accumulated test-integrity work warrants a patch release on its own.
- Update date: 2026-09-22.

## Phase 54 (WebSocket handshake gate + batch frame pins)

- `WebSocketTransport.start()` documented that a second call while the handshake
  is pending shares the in-flight gate; nothing asserted it. Disabling the reuse
  branch opened a **second socket and left the first, still connecting, unclosed**
  (a leaked connection the transport no longer owns). Pinned with promise
  identity + socket-count assertions.
- Extended the single-item `publishBatch` delegation pin from the messageId-only
  shape to timestamp-only and metadata-free, so an absent key cannot start
  serialising as `undefined`.
- Verified by mutation (disabling gate reuse; disabling the single-item
  delegation) and merged as #125. 833 unit tests green.

## Phase 55 (advisory gates made real)

- Coverage floors were 85/80/90/85 against a measured 98.13/94.59/98.17/99.19,
  so the `verify` job's threshold step could not fail for anything short of a
  ten-point collapse. Raised to 96/92/96/97 with the CI comment and both release
  checklists updated (#126); CI's `verify` passed against the new floors in 1m28s
  and `pnpm test:coverage` passes locally.
- Fixed a shipped-doc defect found while refreshing the benchmark trend for this
  release: `bench-trend.mjs` computed "All-time best" as a minimum over the
  entire archive, but the in-page matrix changed measurement semantics twice in
  early September 2026 (no-op runs, then `publishBatch` without a server echo)
  and reports carry no harness version, so `docs/benchmarks.md` published
  `dedup ×1000 = 0 ms` and `wildcard dispatch = 0.1 ms` as records beside 25 ms
  and 6 ms latest values. The column is now the best of the last 5 reports, both
  languages say so, and a new test pins that a stale report outside the window
  cannot set it (#127).
- Measured, not assumed: five consecutive `pnpm bench:browser` runs today gave
  dedup1000Ms = 12.7 / 25.6 / 10.1 / 25.3 / 25.5 ms and trace+publish =
  4.6 / 7.5 / 4.8 / 7.5 / 7.5, while wildcard/publishBatch stayed within
  ±10%. Two metrics therefore flip between a fast and a slow mode ~2x run to
  run with no code change, which is why one pair tripped the 50% ceiling and the
  next pair (25.3 → 25.5) passed it. The archive confirms the same spread since
  2026-09-15 (11.7–28.9 ms), so this is runner behaviour, not a regression from
  any change in this line. Follow-up candidate: give `bench:compare` a
  median-of-N baseline instead of the single previous report, which lowers false
  alarms and increases sensitivity to a real shift at the same time.
- Nothing else was padded: the remaining uncovered lines were checked for
  reachability first and left alone (`websocket.ts` 147's cleared-timer guard,
  `port-reaper.ts` 148/149 — its three maps are only ever mutated together,
  `cluster.ts` 296 — `pause()` always clears `started` before `suspended` is
  observable, `storage-batch.ts` 85 — `length` and `key()` share `keys()`,
  `trace.ts` 449, `hooks.ts` 45, and the IDB `settled` re-entry guards).

## Release 0.20.94 (2026-09-22)

- Milestone: 0.20.x reliability line, patch bump from 0.20.93 — one production
  adapter fix plus gate/test integrity, no API or protocol change.
- Branch `chore/release-0.20.94` from main @ `f506dfe`.
- Scope delivered since v0.20.93: #124 (phase 53), #125 (phase 54),
  #126 (coverage floors), #127 (benchmark trend doc).
- Changed files in the release commit: `package.json`, `CHANGELOG.md`,
  `docs/roadmap.md`, `docs/zh/roadmap.md`, `docs/progress.md`.
- Verification: see the gate transcript below (check / lint / test:coverage /
  bench / test:e2e / bench:browser + compare / verify:pack / verify:compat /
  audit / `npm pack --dry-run`), plus `node scripts/verify-release-version.mjs`
  with `RELEASE_TAG=v0.20.94`.
- Release mechanics: commit `0b31ac8` → PR #128 (verify 1m34s / analyze 1m6s /
  browser 2m7s all green) → squash merged as `9b8f889` → annotated tag
  `v0.20.94` pushed at that exact commit; the topic branch and its remote were
  deleted immediately.
- Release workflow outcome (run 35631119188, watched with `--exit-status`): lint
  plus `verify:compat` / `verify:pack` re-run, GitHub release created from the
  CHANGELOG section, **Publish to npm ✓**, **Verify published npm consumers ✓**
  (the blocking consumer gate), verification context recorded.
- Post-release smoke test: `npm view cross-tab-worker-databus dist-tags`
  reports `latest: 0.20.94`.
- Risk / rollback: patch-level, behavior-preserving for consumers. Rollback is a
  forward fix — npm versions are immutable, so a defect ships as 0.20.95; the
  tag is never moved or reused.
- Next: the median-of-N benchmark baseline landed right after this release
  (see Phase 56); after it, the TypeScript 6 → 7 devDependency major is the only
  outstanding dependency update.
- Update date: 2026-09-22.

## Phase 56 (benchmark gate could fail with no code change)

- While cutting 0.20.94 the documented performance gate tripped:
  `bench:compare --fail-above-pct 50` reported `dedup1000Ms +101.6%` between two
  consecutive runs. It was not a regression — five consecutive runs of identical
  code measured 12.7 / 25.6 / 10.1 / 25.3 / 25.5 ms for that metric (and
  4.6 / 7.5 / 4.8 / 7.5 / 7.5 for `traceAndPublish1000Ms`) while
  wildcard/publishBatch stayed within ±10%, and the archive shows the same
  11.7–28.9 ms spread since 2026-09-15. Two in-page metrics alternate between a
  fast and a slow mode on this machine, so comparing the newest report with the
  **single previous one** made the gate a coin flip.
- `bench:compare` now compares the newest report against the per-metric median of
  up to the five preceding archived reports. A median baseline both removes the
  false alarm and *increases* sensitivity to a real shift, since a genuine
  regression is measured against typical recent runs rather than whatever the
  last run happened to be. Naming two report paths still performs a direct A/B.
- Six new cases in `tests/bench-compare.test.ts` pin the median (odd/even,
  unsorted), the noise case, a sustained doubling that must still fail, the
  five-report window, the missing-sample skip, and the two-report degeneration.
  Mutation check: narrowing the window to the single previous report fails three
  of them.
- Verified against real data (`node scripts/bench-compare.mjs --fail-above-pct 50`
  on the 36-report archive), then typecheck, lint, and 840 unit tests green. Both
  release checklists and the generated trend-doc prose updated in both languages.

## Phase 57 (vacuous negative assertion in the storage-event channel)

- `tests/storage-channel.test.ts` → 'ignores malformed payloads and foreign
  keys' queued three `setItem` calls in one tick. `StorageEventHub.dispatch`
  reads the value *currently* stored under the key, so all three microtasks
  delivered the last write: the `'{broken json'` payload never reached the
  listener, and the `JSON.parse` guard at `src/core/environment.ts:133` was
  never executed.
- Proof it was decorative: replacing `catch { return; }` with
  `catch { throw new Error('MUTANT'); }` left all 15 tests passing and
  `vitest run` exiting **0**.
- The case now settles after each write, asserts each rejection separately
  with a message naming the invariant, and ends with a `postMessage` that must
  still be delivered — containment, not a one-way listener shutdown. Same
  mutant is killed (exit 1, line 133 covered).
- Verified: typecheck, lint, 840 unit tests, and the full CI gate set green.
  Shipped as PR #130 (squash commit `7906253`); no production code changed.

## Phase 58 (the storage-event fallback wiring had an assertion that could not fail)

- `tests/storage-channel.test.ts` → 'returns a storage-event channel when the
  fallback is enabled' read:
  `if (channel) expect(typeof channel.postMessage).toBe('function'); else expect(channel).toBeNull();`
  Both legs of the union were accepted, so **no value of `channel` could fail
  the case** — and in bare Node `channel` was always `null`, so the browser path
  the test names (and `docs/getting-started.md` documents as
  `environment: createBrowserEnvironment({ channelFallback: 'storage-event' })`)
  had never been executed by any test.
- Rewritten with a stubbed window that exposes `localStorage` plus an
  `addEventListener` set, which is what the fallback needs and what the
  documented usage provides. It now asserts the wiring rather than the type:
  the channel is non-null, the envelope lands in **window.localStorage** under
  `cross-tab-worker-databus:channel:<name>`, a `storage` event from the window
  delivers it to listeners, and `close()` detaches the listener and removes the
  key.
- Added the complementary degradation case: a window with `localStorage` but no
  event source yields `null`, so the runtime falls back to local mode instead
  of building a channel that can never fire.
- Mutation evidence. Each row is a mutation of `src/core/environment.ts` and the
  exit code of `npx vitest run tests/storage-channel.test.ts` before / after this
  change:

  | Mutant | Old case | New case |
  |---|---|---|
  | fallback passes `win: null` | survives (0) | killed (1) |
  | envelope routed to `sessionStorage` | survives (0) | killed (1) |
  | `channelFallback` option ignored | survives (0) | killed (1) |
  | `close()` skips `removeEventListener` | survives (0) | killed (1) |
  | `typeof window.addEventListener` guard removed | n/a | killed (1) |

- `src/core/environment.ts` is now at 100% statements / branches / functions /
  lines; whole-suite branch coverage 94.64% → 94.69%. Verified with typecheck,
  lint, and 841 unit tests.

## Phase 59 (storage-batch: an unreachable guard, and two enumeration contracts with no test)

- `src/core/storage-batch.ts` was the weakest file in `src/core` for branch
  coverage (86.66%). Four uncovered branches, three distinct findings:
- **A provably unreachable guard.** `scheduleRetry()` opened with
  `if (this.retryHandle !== null) return;` and a comment claiming "the guard
  ensures only one retry is in flight at a time; subsequent scheduleRetry calls
  during the wait are no-ops". Its true leg had never been taken in any run of
  the suite, and it cannot be: `scheduleRetry` has exactly one call site, inside
  `flush()`, which calls `cancelRetry()` on entry and `break`s right after
  re-arming — so `retryHandle` is always `null` there. The real mechanism was
  already pinned by 'keeps at most one retry timer pending while writes keep
  failing', whose own comment conceded the guard was not what it tested. Removed
  the dead branch and made the comment describe the invariant that actually
  holds.
- **`key(index)` had no out-of-range pin.** `this.keys()[index] ?? null` was only
  ever exercised in range. `storage-utils`' `listKeys`/`readAllByPrefix` loop
  `for (index < length)` and rely on the specified `null` past the end, so
  dropping the coercion (`undefined`) is a real consumer-visible break. Pinned,
  including that a pending write extends the enumerable range before it flushes.
- **`keys()` had no null-slot pin.** `if (key !== null) keys.add(key)` never saw
  a storage that reports a length it no longer backs — possible for an injected
  `StorageLike` adapter racing a clear. Pinned that the null slot is dropped
  rather than becoming an enumerable entry.
- **The give-up warning had no console-less pin.** The `typeof console.warn ===
  'function'` guard's false leg was uncovered; a webview shell with a stripped
  `console` must still drop the doomed key, not throw inside a timer callback.
  Pinned with `console` stubbed to `{ log }`.
- Mutation evidence, `npx vitest run tests/storage-batch.test.ts` exit code:
  `?? null` coercion removed → 1 (2 cases fail); `if (key !== null)` dropped → 1
  (1 case); the console guard forced true → 1 (`TypeError: console.warn is not a
  function`). All three new cases fail their mutant; the suite is green with the
  dead guard deleted, which is the proof it was dead.
- Two cases ('schedules a single retry timer…' and 'keeps at most one retry
  timer…') also sat **outside** their `describe` because a `});` closed it early;
  regrouped. They still ran, so their assertions were real — but they no longer
  report under the file's suite.
- `src/core/storage-batch.ts` is now 100% on all four metrics; whole-suite
  branches 94.69% → 94.89%. Verified with typecheck, lint, and 844 unit tests.

## Phase 60 (a Vitest matcher hole, and the dedup sweep that expired everything)

- **`await expect(promise).rejects.toThrow('message')` passes when the rejection
  reason is `null` or `undefined`.** Verified directly on the pinned Vitest 5:
  rejecting with `null`, `undefined`, a string, or a `{ message }` object
  satisfied `.toThrow('anything at all')`. When the reason *is* an `Error` the
  message is checked properly, so this is a narrow hole — but it swallows
  exactly the bug class that the `reason ?? new Error(...)` fallbacks in
  `src/core/replay-persistence.ts` exist to prevent.
- Consequence: the six "falls back to a generic message …" cases in
  `tests/replay-persistence.test.ts` could not fail. Mutation proof — deleting
  the fallback so the adapter rejects with the raw `null` (`fail(transaction.error
  as Error)` etc.): the open-failure, load-request, load-abort and clear-abort
  mutants all exited **0** under `rejects.toThrow`, and **1** under the new
  helper.
- Added `expectRejectionMessage()` to `tests/fakes.ts` (asserts the reason is an
  `Error` instance *and* carries the message) and converted the fallback-message
  assertions to it, plus the missing load-path case: a read-only transaction that
  aborts with `transaction.error === null` must reject with
  `'Failed to load replay history.'`, which also closed the last uncovered
  fallback leg on that path.
- Left `rejects.toThrow` where the test itself constructs the rejection value
  (`new Error('request failed')`, `new DOMException('The connection is closed.')`)
  — there the message can only come from propagation, so the assertion is real.
  Note `DOMException` is not an `Error` subclass, which is another reason those
  sites must not use the helper.
- Recorded the convention in `AGENTS.md` (test-utility table + testing
  conventions) so future tests do not reintroduce the decorative assertion.
- **Dedup sweep gap.** `DedupManager.pruneExpired()`'s "not yet expired" leg had
  never run: every sweep in the suite saw a map whose entries were all stale, so
  nothing pinned that a sweep keeps recent IDs. A sweep that expired everything
  would turn duplicate re-deliveries into second acceptances — the exact failure
  dedup exists to prevent — and the whole suite stayed green. New case pins the
  partial expiry (tracked 2 → 1, the quiet ID re-accepted, the recent one still
  suppressed); mutant `timestamp < cutoff` → unconditional delete: old suite
  exit 0, new suite exit 1.
- `DedupManager.isDuplicate()`'s FIFO eviction loop carried
  `if (oldest === undefined) break;`, unreachable because `size > maxEntries`
  implies a non-empty map. Rewritten as a `for...of` over the key iterator with
  the bound checked at the top of the loop: same semantics, no dead branch, no
  non-null assertion. Off-by-one (`<=` → `<`) and never-evict mutants fail the
  suite before and after, so the restructure preserved the existing pins.

## Phase 61 (Centrifuge: a guard that cannot fire, and the stale-failure path that could)

- **Three unreachable guards removed.** `handleWorkerError`, `handlePortError`
  and `handleSharedWorkerError` each opened with
  `if (this.generation !== this.backendGeneration) return;`, and the
  `onWorkerFailed` doc claimed "late errors from a superseded Worker are
  silently dropped" by it. Neither holds:
  - `generation` and `backendGeneration` are only ever unequal inside `stop()`,
    between the `this.generation++` and `resetBackend()` — and `stop()` removes
    the Worker/port/SharedWorker listeners before it bumps anything, so no
    handler can observe that window. `start()` returns early when a backend is
    live, so a second start cannot leave two backends' listeners attached either.
  - The comparison is between two scalars on `this`, so it could not tell *which*
    Worker fired anyway.
  Containment comes from the listener removal, which the suite already pinned for
  the dedicated backend. Deleted the guards and the now write-only
  `backendGeneration` field, and rewrote both comments to name the real
  mechanism.
- **Pinned the mechanism that replaced them.** New case
  'ignores SharedWorker error and decode events from a superseded backend'
  covers the port-level `messageerror` and the SharedWorker-level `error` after a
  stop/start, and asserts the replacement still reports its own failure. The
  `stop()`-keeps-listeners mutant was already caught by the old suite and stays
  caught. Renamed the describe from 'backend generation guard' — it described the
  removed mechanism — to 'superseded backend containment'.
- **The reachable stale-callback path had no pin.** `resolveTokenRequest`'s
  success arm was covered by 'does not deliver a stale credential reply to a
  replacement worker'; its **rejection** arm (`if (!isCurrentBackend()) return;`
  before posting `TOKEN_ERROR`) was not, so a late provider failure could post an
  error onto a session that never asked. Mirror case added; deleting the guard is
  killed by it (old suite exit 0 → new suite exit 1).
- `centrifuge.ts` remaining uncovered statements are the two default-factory SSR
  throws (444/465) and their `new URL` catch arms (450/471). They are
  unreachable from the unit suite: `start()` only selects a Worker backend when
  `typeof Worker !== 'undefined'` (or a factory is injected), which is exactly
  the condition the throw tests, and `selectWorkerBackend` degrades to the local
  session rather than calling the default factory when the capability is missing.
  Recorded rather than padded.
- Whole-suite branches 95.05% → 95.24%, statements 98.23% → 98.35%. Verified
  with typecheck, lint, build, and 848 unit tests.

## Phase 62 (React adapter: a test named after a guard it never reached)

- `tests/hooks.test.tsx` → 'does not let a superseded effect clear the newest
  bus during rapid dependency changes' discarded the hook's return value
  (`useCrossTabDataBus(() => buses[index++], [tick])`), so nothing it asserted
  involved the bus identity or the generation comparison its title describes.
  `src/hooks.ts`'s mismatch arms (`45` and `49:1`) stayed uncovered — React runs
  an effect's cleanup before its next invocation for the same hook, and nothing
  between `const generation = ++ref.current` and the comparison yields, so no
  component can reach them. The idiom is for effect bodies that `await`.
- Replaced it with 'stops the previous bus and publishes the newest one across
  dependency changes', which renders the returned value and asserts the
  observable contract: the first run exposes `buses[0]`, a dep change stops
  `buses[0]` exactly once, leaves `buses[1]` alone, publishes `buses[1]` as the
  current bus, and unmount stops it. Mutation check — change `setBus(instance)`
  to `if (!bus) setBus(instance)` so the hook keeps handing back a stopped bus:
  the old case exits **0**, the new one **1**.
- Deleted the dead `lifecycleGeneration` ref and both comparisons (behaviour
  identical for the reasons above) and left a comment naming the React ordering
  it relied on. `docs/configuration.md:90` and its zh counterpart claimed the
  React adapter "applies the same generation guard … so stale effect cleanup
  cannot clear a newer bus"; that described the removed code, and it is now
  replaced with the accurate statement. The Vue adapter's guard (vue.ts:18-20)
  *is* load-bearing — its body awaits a stop — and its doc paragraph is
  untouched.
- Added 'attaches a rejection handler to ready() …'. `src/hooks.ts`'s
  `.catch(() => {})` was the last uncovered function in the file, and the first
  two attempts at pinning it were themselves decorative: neither an unhandled
  rejection failing the run, nor a `process.on('unhandledRejection')` listener,
  observes the leak under Vitest's jsdom runner (both survived the mutant that
  deletes the `.catch`). The case now hands `ready()` a thenable that records
  whether a rejection handler was attached and invokes it, so removing
  `.catch(() => {})` fails with `ready() must be given a rejection handler:
  expected false to be true`. hooks.ts is now 100% on all four metrics.
- `src/core/cluster.ts`'s route-owner LRU carried the same unreachable
  `if (oldest === undefined) break;` that Phase 60 removed from
  `DedupManager` — `size > routeOwnerCacheMax` implies a non-empty map. Rewritten
  as a `for...of` over the key iterator with the bound checked at the top; the
  over-evict and never-evict mutants fail the suite before and after.
- Deliberately kept: `activate()`'s `if (this.started) return;` (line 296) and
  `pause()`'s counterpart. Neither is reachable today — `start()` guards itself
  and `handlePageShow` cancels via the lifecycle generation before re-activating
  — but unlike the removed set, each states exactly the invariant it protects and
  would still hold if a third call site appeared. Recorded rather than churned.
- Whole-suite functions 98.17% → 98.36%. Verified with typecheck, lint, build,
  and 849 unit tests.

## Release 0.20.95 (2026-09-22)

- Version `0.20.95` (patch). Release commit on `main`: `b1dbc72`
  (`chore(release): prepare 0.20.95 (#136)`, PR #136 squash-merged). Annotated
  tag `v0.20.95` pushed at that exact commit; Release workflow run
  `35642947419` finished with conclusion `success`.
- Scope: the test-integrity run since 0.20.94 — Phases 57-63, PRs #130-#137.
  Unreachable defensive branches removed from `BatchingStorageWriter`,
  `DedupManager`, `WorkerClusterRuntime` and `CentrifugeWorkerTransport`; the
  React adapter's unreachable lifecycle generation ref removed; the Vitest
  `rejects.toThrow` nullish-reason hole closed with `expectRejectionMessage()`;
  ten behaviors given mutation-verified regressions.
- Verification before tagging, all green: `pnpm check`, `pnpm lint`,
  `pnpm test:coverage` (849 tests; 98.42 / 95.38 / 98.36 / 99.22 against floors
  96 / 92 / 96 / 97), `pnpm bench` (28 hot-path cases), `pnpm test:e2e` (27
  passed), `pnpm verify:pack`, `pnpm verify:compat` (`0.20.95 preserves public
  exports and type metadata from v0.20.94`),
  `pnpm audit --registry=https://registry.npmjs.org` (no known vulnerabilities),
  `git diff --check`, and `npm pack --dry-run --json` (109 files: dist, docs,
  READMEs, CHANGELOG, LICENSE — no `docs/progress.md`, no tests, no bench
  archive).
- Benchmark gate: the first attempt failed at `publish/dedicated/perMessageMs
  +75.7%`. Investigated rather than waved off — identical code measured 49.86 ms
  then 71.07 ms on consecutive runs while `dedup1000Ms` and
  `traceAndPublish1000Ms` *improved* 42% and 31% in the same report, and a
  micro-benchmark of the only hot paths touched (the bounded-map eviction
  rewrites) measured 80–86 ns/op for all three loop variants, inside that
  variant's own run-to-run variance. Two further runs gave 49.4 ms and the gate
  reported `OK`. Recorded in both release checklists.
- Workflow steps, each `success`: validate release version and notes, verify,
  lint, public export compatibility, packed consumer smoke, extract changelog,
  create GitHub release, **publish to npm**, **verify published npm consumers**,
  record release verification context.
- Smoke test after publishing: the public registry lists `0.20.95` with
  `dist-tags.latest = 0.20.95`, and an independent local repeat of the
  published-consumer gate reported
  `[npm] verified published cross-tab-worker-databus@0.20.95 ESM/CJS consumers`.
- Rollback: npm versions are immutable, so a defect ships as `0.20.96` and the
  tag is never moved or reused; `0.20.94` remains published for consumers that
  need to pin back.
- Update date: 2026-09-22.

## Phase 63 (a documented option nobody tested, and a route contract with no case)

- `docs/api.md:412` and `docs/transports.md:164` both promise `connectTimeoutMs`
  "`0` or `Infinity` waits indefinitely", and `src/websocket.ts:145`'s
  `Number.isFinite(timeoutMs) && timeoutMs > 0` guard had never taken its false
  leg — no test ever disabled the handshake budget. Added
  'waits indefinitely when the handshake budget is 0 or Infinity': it advances
  the fake clock an hour, asserts no `error` status and no close, then opens and
  expects `start()` to resolve. Mutating the guard to `if (true)` — which arms a
  `0 ms`/`Infinity ms` timer — leaves the existing suite green (exit 0) and fails
  the new case (exit 1).
- `WorkerClusterRuntime` had no case combining "owns a topic nobody else
  subscribes to" with a `pagehide`. The existing pagehide tests all subscribe on
  both tabs. Added 'keeps a tab's private topic from migrating to a peer on
  pagehide': the shared topic migrates (one route record, `worker-b`,
  `handoffFromWorkerId: worker-a`, generation bumped) and the private one leaves
  no record behind.
- Investigated the handoff guard at `cluster.ts:482-485` (drop the route when no
  remaining tab subscribes). Deleting it keeps the whole cluster and data-bus
  suite green, and the new case passes either way: `pause()` releases local
  subscriptions *before* `handoffAssignedTopics()` runs, so
  `releaseSubscription()`'s own no-subscribers branch has already removed the
  record and the handoff loop then skips it at `previous?.workerId !==
  this.workerId`. Kept as a durable-storage guard (another tab can drop the last
  subscriber record between a read and a write) and the new test is named after
  the contract rather than that branch, since either path satisfies it.
- 851 unit tests, typecheck, and lint green.
## Phase 64 (trace: a console-less containment pin, and an option the type already forbids)

- Added 'still contains a throwing sink when the runtime has no console.warn'.
  Sink-error isolation is documented (`docs/api.md`: a throwing sink never
  interrupts dispatch but is reported through `console.warn`), and the guard's
  false leg — a webview shell that strips `console.warn` — had never run. Forcing
  the guard to `if (true)` fails the new case; the existing suite passes either
  way.
- Attempted the sibling pin for `trace.ts:211`'s default no-op sink and the type
  checker rejected it: `sink` is a **required** member of `DataBusTraceOptions`
  and `docs/configuration.md:49` documents it as Required, so
  `new DataBusTraceReporter({ enabled: true })` is not a supported call. The
  default arm is therefore reachable only from untyped JavaScript, where it
  keeps every emission from throwing inside `emitSync` and being swallowed as a
  phantom "sink threw" warning. Kept the constructor default, dropped the test,
  and recorded the reachability here instead of writing a cast to fake coverage.
- Whole-suite numbers after the phase: statements 98.42%, branches 95.49%,
  functions 98.36%, lines 99.22% across 852 tests.

## Phase 65 (audit follow-ups that did not become tests, and the remaining uncovered set)

- **Shared suspend-stop gate — investigated, not shipped.** `data-bus.ts:1174-1175`
  (`performStop` awaiting an existing `pendingStop` instead of calling
  `transport.stop()` again) still reads as uncovered, so a
  pagehide→explicit-`stop()` case with a gated transport was written. It does
  detect the mutation (`expected 2 to be 1`), but so do three existing cases —
  including 'stops once when an explicit stop follows a failed-open cleanup',
  which is the same contract — and adding the new case left `1175` still reported
  uncovered, i.e. the remaining line difference is a v8 statement-attribution
  artifact rather than a real gap. The test was dropped rather than shipped as a
  fourth pin of a covered contract, and nothing in this paragraph should be read
  as a claim that the branch is untested: it is tested.
- **`docs/configuration.md:49` documents `trace.sink` as Required** and the type
  agrees, so `trace.ts:211`'s `?? (() => undefined)` default is reachable only
  from untyped callers (see Phase 64). Confirmed there is no documentation
  promising `trace: { enabled: true }` without a sink anywhere in en/zh, so the
  docs and the type are consistent and nothing needs changing.
- **TypeScript 7 re-check (roadmap candidate 6), 2026-09-22:** still blocked
  upstream — `typescript-eslint` publishes `8.70.1` with peer
  `typescript >=4.8.4 <6.1.0` while `typescript` is at `7.0.2`. Installing 7
  breaks the lint gate before it breaks our own types, so the note stands.
- Repository hygiene verified at this point: no open issues, no open PRs other
  than the one carrying this entry, no `TODO`/`FIXME`/`XXX`/`HACK` markers
  anywhere in `src`, `scripts`, `examples`, `e2e`, or `tests`, and no stale local
  or remote topic branches.
- **Remaining uncovered set, for the next pass.** Everything below was reached in
  this audit and classified; the list is the starting point, not a to-do:
  - `centrifuge.ts:444/450/465/471` — the default Worker/SharedWorker factories'
    "no implementation" throws and their `new URL` catch arms. Unreachable from a
    unit run: `start()` only selects a Worker backend when the global exists (or a
    factory is injected), and `selectWorkerBackend` degrades to the local session
    instead of calling the default factory.
  - `data-bus.ts:529/803` — public-looking rejections behind an `if (x !== null)`
    that the caller already tested; `552/556/665/1140-1141/1525/1541/1560/
    1576-1577` — queue/gate re-entry arms dominated by an earlier check on the
    same lifecycle epoch.
  - `replay-manager.ts:411/419/420/466/483/525` — the `retryGeneration`
    re-checks after each `await`; 525 in particular is dominated by the catch's
    own generation test two lines below, so it cannot fire first.
  - `replay-persistence.ts:49/208/244/268/292` and legs of `43/45/177/188` — the
    `settled` latches and `invalidate()` re-entry arms. Reachable only if an
    IndexedDB request errors *and* its transaction then aborts; the scripted fake
    fires one or the other, never both, so pinning them needs a new fake mode
    rather than a new assertion.
  - `cluster.ts:397` (no `globalThis.setTimeout` in the runtime), `879`, `921`,
    `990`, `1245`; `websocket.ts:147/414`; `port-reaper.ts:119/148/149`;
    `trace.ts:449`; `version.ts:12`; `validation.ts:65`.
  - `dedup-manager` and `storage-batch` and `environment` and `hooks` have no
    remaining uncovered lines.

## Phase 66 (dependency sweep: one refresh, two deliberate non-updates)

- **Status:** complete. Branch `chore/deps-refresh-typescript-eslint`, commit `5257ff8`.
- **Changed:** `package.json` + `pnpm-lock.yaml` — `typescript-eslint`
  `8.70.0` → `8.70.1` (the only actionable row in `pnpm outdated`).
- **Deliberately not changed**, each checked rather than assumed:
  - `typescript` stays at `6.0.3` — `7.0.2` exists but `typescript-eslint`
    (even at `8.70.1`) still declares peer `typescript >=4.8.4 <6.1.0`, so the
    lint gate would break before our own types did. Roadmap candidate 6 stays open.
  - The `pnpm-workspace.yaml` overrides need no bump: `nanoid` resolves to
    `3.3.19` and the `glob ^10.5.0` override targets a package that is not in
    the installed tree at all.
  - `packageManager: pnpm@10.14.0` is a deliberate pin, not a stale constraint.
- **Verification:** `pnpm lint` clean, `pnpm typecheck` clean,
  `npx vitest run` → 37 files / 852 tests passed, and
  `pnpm audit --registry=https://registry.npmjs.org` → no known vulnerabilities.
  No source, test or documentation file is touched by this change, so the
  coverage floors and the compat/pack gates are unaffected by construction.
- **Risks / rollback:** patch-level dev dependency; rollback = revert this
  commit and reinstall.
- **Next:** re-inspect the remaining uncovered ledger from Phase 65 for anything
  that yields an observable mutation, and re-check the `typescript-eslint` peer
  ceiling before any future TypeScript 7 attempt.
- **Updated:** 2026-09-22.

## Phase 67 (two coordination-release paths that no test had ever driven)

- **Status:** complete. Branch `test/cluster-dead-route-handoff`.
- **What was wrong.** Phase 65 listed `cluster.ts:483-484` as "dominated by
  `releaseSubscription`, kept as a defensive guard". That classification was
  wrong, and chasing it turned up a second, bigger gap: `branchMap` showed
  `if (this.releaseHandoffOnUnsubscribe(message)) return;` at `cluster.ts:878`
  with counts `[1, 0]` — every `CONTROL/UNSUBSCRIBE` any test had ever delivered
  was a *handoff* release, so the owner's ordinary "the last subscriber left"
  path had never run at all.
- **Pin 1 — `deletes an unserved route when the owner leaves with no subscriber
  to hand to`** (`cluster.ts:482-485`). A owns a route, B is its only other
  subscriber and dies without releasing, C is healthy but never subscribed. The
  departing owner must delete the route rather than migrate it onto C.

  | Mutation | Result |
  |---|---|
  | guard block deleted | `expected [ { workerId: 'worker-c', … } ] to deeply equal []` — the route is migrated to a peer with no subscriber |

  B is deliberately placed on a second `ChannelHub`: it shares storage (so its
  records are the residue the handoff must sort out) but cannot hear A's
  teardown nudge, which models a frozen/killed tab. With a shared hub B
  re-elects the route in its own reconcile and the final storage state is
  identical with or without the guard — the first draft of this test passed
  under the mutation for exactly that reason.
- **Pin 2 — `releases ownership and the transport subscription when the last
  remote subscriber leaves`** (`cluster.ts:878-879` fall-through). The owning
  Worker must drop `assignedTopics` *and* dispatch `UNSUBSCRIBE` to its
  transport when the last subscriber's control message arrives.

  | Mutation | Result |
  |---|---|
  | `releaseHandoffOnUnsubscribe(message); return;` (never fall through) | `expected "vi.fn()" to be called with arguments: [ 'UNSUBSCRIBE', 'topic', undefined ]` |
  | `assignedTopics.delete()` moved below the handoff check | `expected true to be false` (the owner keeps a topic nobody subscribes to) |
- **Second decorative draft, caught before it shipped:** the handoff test also
  initially lacked an `await` after `runtimeC.start()`, so C's worker record was
  still in the batching writer and `activeWorkers` was empty — without the guard
  the loop fell into `if (!owner) continue` and the observable difference
  vanished. Both drafts were verified to fail under mutation before either was
  kept.
- **Docs:** `docs/architecture.md` and `docs/zh/architecture.md` gain the
  **Unserved route drop** and **Last-subscriber release** invariants (the
  failover section previously described only the migrating side).
- **Verification:** `pnpm check` (37 files / 854 tests), `pnpm lint`,
  `pnpm test:coverage` (floors hold; `cluster.ts` branch 92.57% → 93.63%, now
  one uncovered line: `397`), `tests/documentation.test.ts` 17/17,
  `git diff --check` clean.
- **Ledger correction.** `cluster.ts:483-484` and `879` are closed. Remaining
  in `cluster.ts`: `397` (a runtime with no `globalThis.setTimeout`, which the
  fake environment cannot produce without stubbing a global the module captured
  at import), and the now provably-unreachable `if (!owner) continue` at `491`
  (`subscribers.length > 0` ⇒ `remainingWorkers` non-empty ⇒
  `selectActiveWorkers` never returns an empty array for non-empty input). It
  stays because `selectLeastLoadedWorker` is typed `WorkerRecord | undefined`;
  deleting it would need a cast, and `previous?.generation ?? 0` at `493` is
  kept for the same legacy-record reason the read paths keep it.
- **Risks / rollback:** tests and documentation only; rollback = revert the
  commit.
- **Next:** keep working the Phase 65 ledger for anything that fails under
  mutation.
- **Updated:** 2026-09-22.

## Phase 68 (the cancelled retention sweep, and the replay-manager legs that are actually dominated)

- **Status:** complete. Branch `test/replay-cancelled-sweep-silence`.
- **Pin — `reports nothing when a suspend cancels the sweep it had already
  issued`** (`replay-manager.ts:496`). The retention loop swallows a rejection
  once the retry generation has moved on. The leg had zero counts, so the
  suppression was untested — and this is the one persistence-cancellation path
  whose failure is *not* covered by a nearby check, because the pass reports
  through the injected `onPersistenceError` sink directly.

  | Mutation | Result |
  |---|---|
  | `if (generation === this.retryGeneration) …` → report unconditionally | `expected [ …(1) ] to deeply equal []` |

  The pass is left in flight by replacing `clearBefore` with a promise the test
  rejects itself, after the startup prune has settled. The pair test
  ('reports a sweep failure without stopping the loop') pins the opposite leg, so
  the two together pin the condition rather than one outcome.
- **Pin — `drops a hydrated snapshot that a buffer reset had already superseded`**
  (`replay-manager.ts:420`). `resetBuffers()` bumps the hydration epoch *without*
  touching the retry generation, so an in-flight `load()` still looks current by
  generation while belonging to a dead snapshot. Merging it repopulates exactly
  what the reset cleared and marks hydration complete for the session that should
  replace it.

  | Mutation | Result |
  |---|---|
  | `if (epoch !== this.hydrationEpoch) return;` deleted | `expected { enabled: true, topics: 1, … } to match object { topics: 0, messages: 0 }` — the superseded snapshot is back in the rings |
- **Ledger closed for `replay-manager.ts`.** Phase 65 recorded the remaining
  zero-count legs as "re-checks after each `await`" without proving domination.
  They are now proven, each by the mutation that would have to happen first:
  - `419` (`generation !== retryGeneration` after `load()`) — `load()` is called
    through `withPersistenceRetry`, whose own post-operation check (`530`) throws
    for exactly the same condition before `hydrate()` ever sees the result. Proved
    by deleting `419`: a third draft test that watched the reported cancellation
    stayed green, i.e. it duplicated the existing
    'suspend() cancels an in-flight retry' pin, so it was dropped rather than
    shipped as decoration.
  - `410` (`!this.buffers || !this.persistence`) — `hydrate()` is reached only
    from the guarded `ensureHydrated()` path, which returns before this when no
    persistence backend exists.
  - `466` — the hydration catch reports a cancelled generation at `458` first, so
    the epoch arm below it needs a bump that leaves the generation alone *and* an
    operation that fails rather than resolving; the only epoch-only bump
    (`resetBuffers`) also clears `hydration`, and the retry wrapper cancels the
    in-flight failure the same way `419` is cancelled. Left in place as the
    belt-and-braces guard it is documented to be.
  - `483` (`!this.persistence?.clearBefore`) — the scheduling callers
    (`156`, `290`, `415`) test that capability first.
  - `525` (top-of-loop generation check) — `544` throws on the same condition
    before the loop can re-enter, so the guard cannot fire first.
- **Incident while verifying:** one mutation command carried a stray
  `cp /tmp/rm.bak src/core/cluster.ts`, overwriting the cluster source with the
  replay-manager backup. It was caught by `git diff --stat src/` immediately after
  the run, restored with `git checkout -- src/core/cluster.ts`, and re-verified
  (80/80 cluster tests, full suite below). No commit ever contained it.
- **Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test:coverage` —
  37 files / 856 tests, floors hold; `replay-manager.ts` branch
  93.93% → 95.15% and all-files branch 95.69% → 95.80%, with only the dominated
  legs listed above left. `cluster.ts` reported its post-#141 numbers unchanged
  (98.93 / 93.63), which is also the check that the restore above was complete.
- **Risks / rollback:** test only; rollback = revert the commit.
- **Next:** the same leg-triage for `data-bus.ts` (`528/621/802/1291` carry
  behaviour, not just defensiveness) and `websocket.ts:411`.
- **Updated:** 2026-09-22.

## Phase 69 (the default WebSocket path, and ready() swallowing the real error)

- **Status:** complete. Branch `test/websocket-default-factory`.
- **Pin — `resolves the platform WebSocket constructor when no factory is
  injected`** (`websocket.ts:414`). Every other WebSocket test injects
  `webSocketFactory`, so the default resolution — the branch a real browser
  takes — had only ever run its *failure* arm (`typeof WebSocket === 'undefined'`
  has counts `[1, 0]`, i.e. the happy path never did).

  | Mutation | Result |
  |---|---|
  | `new WebSocket(url, protocols)` → `new WebSocket(url)` | the recorded constructor args no longer match — subprotocol negotiation is silently gone |
- **Pin — `surfaces the recorded transport error from ready() once recovery is
  spent`** (`data-bus.ts:802`). The docs promise callers can tell a transient
  retry from a dead transport, but the leg that returns `this.lastError` had never
  run: every existing failure test still had a `startPromise` in flight, so
  `ready()` resolved/rejected through an earlier arm. Driving recovery to
  exhaustion (`maxAttempts: 1`, three `error` status flips past the cooldown)
  reaches it.

  | Mutation | Result |
  |---|---|
  | `if (this.lastError !== null) return Promise.reject(this.lastError);` deleted | `expected 'Transport is not ready and no start o…' to contain 'Transport failed during startup.'` |
- **Ledger correction.** Phase 65 dismissed `529/803` as "public-looking
  rejections behind an `if (x !== null)` that the caller already tested". For
  `528/529` that is right and now proven: `ready()` checks `if (this.queuedStart)`
  at `769` and `getQueuedStartReady()` re-reads the same field with no `await`
  between, so its rejection is unreachable. For `802` it was wrong — that leg is
  reachable, observable, and was untested (above).
- **Still open from the leg triage:** `data-bus.ts:621` (`startDemandRecovery`'s
  status/suspended/stopping guard) — both callers reach it with the demand token
  armed, and no interleaving in the suite has yet produced a stale demand. Needs
  an explicit "transport recovered underneath a parked waiter" construction, not
  a guess; left for the next pass rather than written up as dominated.
- **Verification:** `pnpm check` (37 files / 858 tests), `pnpm lint`,
  `pnpm test:coverage` — floors hold; `websocket.ts` lines 100% / branch
  95.12% → 95.93%, all-files branch 95.80% → 95.85%. Mutant backups were kept
  under per-file names (`/tmp/websocket.bak`, `/tmp/data-bus.bak`) after the
  Phase 68 mix-up, and `git diff --stat src/` was confirmed empty before each
  commit.
- **Risks / rollback:** tests only; rollback = revert the commits.
- **Next:** the `data-bus.ts:621` stale-demand construction, then
  `centrifuge-session.ts:219` (empty-topic drop, documented but never exercised).
- **Updated:** 2026-09-22.

## Phase 70 (negative results: the stale-demand guard, and the empty-topic drop)

- **`data-bus.ts:621` — attempted, not shipped.** The guard is
  `startDemandRecovery()`'s "demand is stale" check: a failed automatic attempt
  arms demand recovery, and the next transport operation reopens instead of
  waiting. The uncovered leg is the case where the transport has meanwhile
  reported a non-error status, so the reopen must not happen. Built it: error →
  automatic attempt fails (`getRecoveryStats().attempt === 2`, gate closed,
  demand armed) → `setStatus('disconnected')` → `bus.publish(...)`. It does park
  and it does bump `transport.startCalls` — but the publish path reopens the
  transport through its own route, so the same increment happens whether or not
  `621` returns early. The draft could not distinguish its mutant, so it was
  deleted instead of shipping an assertion that cannot fail; the guard stays
  unexercised and is recorded here as unsolved rather than dominated.
- **`centrifuge-session.ts:219` — a missing input check, not a missing test.**
  Both `postPublication` call sites already exclude an empty topic (`137`
  explicitly, `169` by capturing the topic it subscribed with), so the drop leg
  can only be reached by feeding a `SUBSCRIBE` frame with `topic: ''` — which no
  in-repo producer emits. Making that state impossible at the boundary (rejecting
  an empty topic when the frame is read) is a behaviour change to the worker
  protocol, not coverage, so it is left as a deliberate design question.
- **Risks / rollback:** documentation only; both drafts were reverted
  (`git checkout -- tests/data-bus.test.ts`), and the two committed pins from
  Phase 69 were confirmed present afterwards (174 data-bus tests, 858 total).
- **Next:** PR #143 to green + merge, then the remaining zero-count legs in
  `cluster.ts` (`355`, `360`, `582`, `1347`) and `port-reaper.ts:119`.
- **Updated:** 2026-09-22.

## Phase 71 (a batch could be captured by an unrelated wildcard — and the mutant that nearly proved it wrong)

- **Status:** complete. Branch `test/websocket-default-factory`.
- **Pin — `does not let an unrelated owned pattern capture a batch for a remote
  topic`** (`cluster.ts:582`). `publishBatch()`'s wildcard probe walks every
  pattern the worker owns; A owns `chat.*`, B owns `metrics.cpu`. Dropping
  `topicMatchesPattern` from that condition lets A's first owned pattern win, so
  the batch is dispatched locally and never reaches its owner.
- Phase 65 had this leg as "defensive"; it is the only place the batch path
  consults the matcher, and the pre-existing wildcard tests all use
  single-item `publish()`, which runs the *other* copy of the block (`541`).

  | Mutation | Result |
  |---|---|
  | matcher dropped from **both** probe blocks | `expected [] to have a length of 2 but got +0` — A keeps both `PUBLISH` frames, B receives none |
- **How nearly this was recorded as a negative result:** the first mutation
  attempt used a non-global `perl -0pi -e 's/…/…/'`, which edited only the
  `publish()` twin. The test stayed green, the draft was about to be deleted as
  decoration, and the `console.log` probe that finally explained it needed two
  tries because its anchor indentation was wrong (a substitution that matches
  nothing reports success). Restored with `git checkout -- src/core/cluster.ts`
  each time; `git diff --stat src/` is empty before this commit. The lesson —
  verify the mutant landed before trusting a green result — is now written into
  `AGENTS.md` next to the two ChannelHub traps from Phase 67.
- **Verification:** `pnpm check` (37 files / 859 tests), `pnpm lint`,
  `pnpm test:coverage` — floors hold; `cluster.ts` branch 93.63% → 93.89%
  (still one uncovered line, `397`), all-files branch 95.85% → 95.90%.
- **Risks / rollback:** one test plus documentation; rollback = revert.
- **Next:** merge PR #143, then `port-reaper.ts:119` and `trace.ts:449`.
- **Updated:** 2026-09-22.

## Phase 72 (a binary publication could lose its dedup ID)

- **Status:** complete. Branch `test/websocket-default-factory`.
- **Gap found by the line ledger.** `websocket.ts:339` was still listed uncovered
  although a test named 'propagates complete publication metadata in JSON and
  metadata-bearing binary frames' existed: that test only ever sent a
  *timestamp* on the binary frame, so the `messageId` arm of the JSON envelope —
  the field the comment at `333` exists to protect — had never run.
- **Pin:** extended the test with a binary publish carrying only `messageId`, and
  one carrying both fields.

  | Mutation | Result |
  |---|---|
  | `...(messageId === undefined ? {} : { messageId })` deleted from the binary envelope | `expected '{"op":"publish","topic":"market.bin",…' to be …` — the frame ships without its dedup ID |
- **Lesson for the ledger:** an uncovered *line* inside a multi-field object
  literal means the field is untested even when a test with the right name
  covers the neighbouring line.
- **Verification:** `pnpm check` (37 files / 859 tests), `pnpm lint`,
  `pnpm test:coverage` — floors hold; `websocket.ts` branch 95.93% → 97.56%,
  all-files branch 95.90% → 96.01%. Still uncovered there: `113`, `147`, `379`
  (the superseded-socket arms, each already analysed in the Phase 61 note).
- **Risks / rollback:** test only.
- **Updated:** 2026-09-22.

## Phase 73 (the Vue adapter's unhandled-rejection path)

- **Status:** complete. Branch `test/vue-ready-rejection`.
- **Gap.** `vue.ts` was the only adapter with an uncovered *function*: the
  `catch(() => {})` on `void next.ready().catch(…)` at `vue.ts:24`. The React
  twin has been pinned since phase 62, so the two adapters had silently different
  guarantees for the same idiom.
- **Pin — `contains a rejected ready() on the bus it publishes`.** A thenable
  records whether a rejection handler was installed, then rejects through it, so
  the assertion is about the handler existing rather than about a promise nobody
  observes.

  | Mutation | Result |
  |---|---|
  | `.catch(() => {})` deleted from `vue.ts:24` | `expected false to be true` — no rejection handler was installed |

  (`typeof handler === 'function'` in the assertion is there so the recording is
  about a *usable* handler; only the deletion above was verified by mutation.)
- **Verification:** `npx vitest run` 37 files / 860 tests, `pnpm typecheck`,
  `pnpm lint`; `pnpm test:coverage` — `vue.ts` now 100% on statements, branches,
  functions and lines (was 94.44% functions), matching `hooks.ts`; floors hold.
- **Note on the branch order:** this work was verified against main after #143
  merged, so the numbering continues from phase 72.
- **Risks / rollback:** test only; rollback = revert the commit.
- **Next:** sync `main`, then continue the ledger (`centrifuge.ts:286`,
  `port-reaper.ts:119`, `data-bus.ts` remaining legs).
- **Updated:** 2026-09-22.

## Phase 74 (why no release, and the first deprecation cycle)

- **Release decision: deferred.** `git diff v0.20.95..HEAD -- src/` is empty:
  phases 63-73 changed tests, documentation and a dev dependency only, so the
  published artifact would be byte-identical apart from the version string. A
  release now is npm churn with no consumer benefit, so 0.20.96 waits until there
  is a runtime change to ship. Task entries for the freeze were closed rather than
  left dangling, and this record is the reason.
- **The ledger sweep is done.** Every remaining zero-count `if` leg in `src` is
  now classified by proof rather than assumption: dominated
  (`replay-manager` `410/419/466/483/525`, `data-bus` `528`, `cluster` `491`),
  unreachable-by-construction (`centrifuge` `341` — `start()` returns early when a
  backend exists and every teardown path calls `clearHeartbeat()`; `centrifuge`
  `286`'s synchronous arm — the provider cannot swap the backend before throwing),
  or a missing boundary check rather than a missing test (`centrifuge-session`
  `219`, which motivated the work below).
- **New: the empty-topic deprecation cycle.** `bus.subscribe('')` was verified to
  be accepted end-to-end today: the opaque route/subscriber records are written and
  `transport.subscribe('')` is issued for a channel no transport can address, so
  the subscription silently never fires. `CrossTabDataBus` now warns once per
  instance (latch `emptyTopicWarned`, called from `subscribe`/`publish`/
  `publishBatch`) and changes no behavior; `docs/api.md` + `docs/zh/api.md`
  document the contract and `CHANGELOG.md` gains the first `### Deprecated`
  section, which is what makes the next release worth cutting.
- **Mutations run against the new code:**

  | Mutation | Result |
  |---|---|
  | all three `warnEmptyTopic` call sites removed | `expected \"warn\" to be called 1 times, but got 0 times` |
  | the `emptyTopicWarned` latch removed | `expected \"warn\" to be called 1 times, but got 4 times` |
- **Two drafts dropped as decorative before commit:** a WebSocket stale-handshake-
  budget case (`start()` shares the in-flight gate instead of replacing the socket,
  so `websocket.ts:147`'s stale arm has no reachable construction) and a Blob
  decode-failure case that passed with its guard deleted, because stopping the
  transport removes the handler pair the mutant reports through. Both are recorded
  here instead of shipped.
- **Verification:** `pnpm check`, `pnpm lint`, `pnpm test:coverage` with the new
  test — numbers recorded in the commit.
- **Risks / rollback:** additive warning plus docs; rollback = revert the commit.
  Callers that treat `console.warn` output as an error condition would notice the
  new line, but only for input that already could not work.
- **Next:** with the deprecation shipped, cut 0.20.96 through the full checklist.
- **Updated:** 2026-09-22.

## Release 0.20.96 freeze (2026-09-22)

- **Version / status:** 0.20.96, frozen on branch `chore/release-0.20.96`
  (from main at `7e73273`, the merge of #145). Release content is the
  empty-topic deprecation cycle plus the phases 63-74 verification sweep; the
  artifact differs from 0.20.95 only by `src/core/data-bus.ts`.
- **Completed work:** version bump; `## [0.20.96] - 2026-09-22` CHANGELOG
  section (first `### Deprecated` entry in this project); `## 0.20.96 delivered
  scope` added to both roadmap files with the release line updated; benchmark
  trend docs regenerated from the 42-report archive.
- **Changed files:** `package.json`, `CHANGELOG.md`, `docs/roadmap.md`,
  `docs/zh/roadmap.md`, `docs/benchmarks.md`, `docs/zh/benchmarks.md`,
  `docs/progress.md`.
- **Verification (all run locally on this branch):**
  `pnpm check` → typecheck + build + 37 files / 861 tests;
  `pnpm lint` → clean; `pnpm test:coverage` → floors hold (98.62 / 96.02 /
  98.54 / 99.38 measured against 96 / 92 / 96 / 97);
  `pnpm bench` → 3 files / 28 baselines;
  `pnpm test:e2e` → 27/27 in real Chromium, including the BFCache and
  dropped-ACK handoff cases;
  `pnpm bench:browser` twice → `pnpm bench:compare --fail-above-pct 50` →
  `OK: no metric regressed more than 50%` (worst `traceAndPublish1000Ms`
  +44.9%, `publish/shared/perMessageMs` +31.3%, `publish/dedicated` improved
  6.2%; the known bimodal hot-path metrics measured 24.3 ms then 15.3 ms for
  `dedup1000Ms` across the two runs);
  `pnpm verify:compat` → `0.20.96 preserves public exports and type metadata
  from v0.20.95`; `pnpm verify:pack` → ESM/CJS root and every subpath import
  from `cross-tab-worker-databus-0.20.96.tgz`;
  `pnpm audit --registry=https://registry.npmjs.org` → no known vulnerabilities;
  `npm pack --dry-run --json` → 109 files, 912 kB unpacked, dist + shipped docs
  only (no `tests/`, `e2e/`, `scripts/`, `docs/progress.md`);
  `git diff --check` → clean.
- **Migration / rollback check:** no public export, subpath, type field or
  protocol frame changed. The only behavioral change is additive: a
  `console.warn` on empty-topic calls, with the removal planned for a later
  minor per the deprecation policy. Rollback = revert the release commit and
  never move a published tag.
- **Blockers:** none. Publishing happens through the tag-triggered Release
  workflow (`NPM_TOKEN`); the repository does not publish from the assistant.
- **Next:** merge this PR, tag the exact merged commit as `v0.20.96`, push only
  the tag, and watch the Release workflow through the blocking
  `verify:published` gate.
- **Updated:** 2026-09-22.

## Release 0.20.96 completed (2026-09-22)

- Version `0.20.96` published. Release commit on `main`: `ba9c07f`
  (`chore(release): prepare 0.20.96 (#146)`, PR #146 squash-merged). Annotated
  tag `v0.20.96` (object `fc3fe05`, dereferencing to exactly that commit) pushed
  as the only ref; local and remote tag objects match, and the tag has not been
  moved since.
- Scope: everything since `v0.20.95` — Phases 63-74, PRs #137-#146. Eleven
  behaviors that no test could previously detect were given mutation-verified
  regressions (opt-out handshake budget, private-topic handoff rule, trace sink
  containment without `console.warn`, unserved-route handoff drop,
  last-subscriber transport release, cancelled retention sweep, superseded
  hydration snapshot, default `WebSocket` construction, `ready()`'s recorded
  recovery error, unrelated-wildcard batch capture, Vue `ready()` rejection
  containment); one documented boundary gap was closed (empty topic now warns
  once per bus), and `typescript-eslint` moved to 8.70.1. The published artifact
  differs from `0.20.95` by `src/core/data-bus.ts` only (+20 lines).
- Release workflow run `35660663344` → job `release :: success` in 5m51s, with
  every named step green: validate release version and notes, install
  dependencies, verify (typecheck +
  build + unit tests), lint, public export compatibility, packed consumer smoke,
  extract changelog, create GitHub release, **publish to npm**, **verify
  published npm consumers** (the blocking gate), record release verification
  context.
- Smoke test after publishing: `npm view cross-tab-worker-databus version
  dist-tags.latest` → `version = '0.20.96'`, `dist-tags.latest = '0.20.96'`, and
  the registry version list ends `"0.20.94", "0.20.95", "0.20.96"`.
- Rollback: npm versions are immutable, so a defect ships as `0.20.97` and
  `v0.20.96` is never moved or reused; `0.20.95` stays published for consumers
  that need to pin back. The only new user-visible behavior is a `console.warn`,
  which a consumer can silence by passing a non-empty topic.
- Follow-up now owned by a later minor: turn the empty-topic warning into a
  `TypeError` at `subscribe()` / `publish()` / `publishBatch()`, called out in
  that release's CHANGELOG per the deprecation policy.
- Record correction shipped with this entry (PR #147): the published `0.20.96`
  CHANGELOG line enumerated seven of the eleven mutation-verified behaviors in
  its range. The released section is left untouched — the tarball is immutable —
  and the four missing pins are named in a new `Unreleased → Docs` note, while
  both roadmap delivered-scope sections now list all eleven.
- Update date: 2026-09-22.

## Phase 75 (a fuzz harness for the promise no test checked between tabs)

- `lifecycle-invariants.test.ts` fuzzes one bus. Every multi-tab scenario before
  this one picked its ordering by hand. The bug class in between the tabs — two
  transports subscribing a topic, so every handler fires twice, or none
  subscribing it, so the topic goes silent while all three tabs look healthy —
  had no exploration behind it. `tests/coordination-invariants.test.ts` now
  drives three buses over one `MemoryStorage` + `ChannelHub` through random
  sub/unsub/publish/hide/show/stop/start/heartbeat/dropped-frame sequences plus
  forged `CONTROL/SUBSCRIBE` frames, lets them settle for twelve heartbeats,
  then asserts three arms: one owner and one transport holder and the same tab
  for every live topic; no owner, holder or route record for a topic nobody
  subscribes; and exactly-once fan-out when the owner's transport delivers.
- First run failed six seeds, all of them the harness's fault: `stop()` clears
  `topicHandlers`, so a restarted tab is subscribed to nothing and the model has
  to forget its own subscriptions on a stop. Fixed in the model, not the code —
  5,000 seeds green afterwards (9.0s idle; coverage doubles it), and the whole
  suite is 38 files / 862 tests.
- Mutation evidence (each applied alone, `src/` restored and verified empty
  after every run): dropping `transport.unsubscribe` kills arm 2 (six stale
  holders), dropping `transport.subscribe` kills arm 1, duplicating the exact-
  topic `invokeHandlers` kills arm 3, never pruning orphan routes kills arm 2,
  and emptying `reconcileAssignedTopics`' sweep kills arms 1 and 2 together.
- Three guards survive the harness, and that is the finding worth keeping:
  `handleControlMessage`'s "the durable route authorizes SUBSCRIBE" check, the
  route write in `subscribe()`, and `subscribe()`'s ownership return value.
  Removing any of them corrupts ownership transiently and the reconcile sweep
  repairs it before quiescence — verified with the forged frames removed too, so
  the repair, not the frame shape, is what hides them. Two earlier draft arms —
  "no route names a worker outside the registry", and separate owner-vs-holder
  and route-vs-owner comparisons — were deleted after no mutation of any kind
  could make them fail; the surviving check is the single composite condition.
- Docs: `docs/architecture.md` (en + zh) gains the **Assignment drift repair**
  invariant; `AGENTS.md` records the third reason a mutation survives (the
  sweep repairs it), the harness's model-of-retention trap, and that
  `mulberry32()` / `flushMicrotasks()` now live in `tests/fakes.ts` — both
  existing fuzzers import them instead of carrying private copies.
- Changed files: `tests/coordination-invariants.test.ts` (new), `tests/fakes.ts`,
  `tests/lifecycle-invariants.test.ts`, `tests/property.test.ts`, `AGENTS.md`,
  `docs/architecture.md`, `docs/zh/architecture.md`, `CHANGELOG.md`,
  `docs/progress.md`. No `src/` change.
- Verification: `pnpm typecheck` clean; `pnpm check` → 38 files / 862 tests;
  `pnpm lint` clean; `pnpm test:coverage` → 98.62 / 96.02 / 98.54 / 99.38
  (unchanged against the 96 / 92 / 96 / 97 floors); `git diff --check` clean.
- Risks / rollback: test-only; a false failure would be a harness bug, and every
  seed is reproducible from its `seed=` line. Rollback = delete the file.
- Next: open this as a docs/test PR, then the remaining `data-bus.ts:621`
  stale-demand construction and `centrifuge.ts:286` synchronous arm.
- Updated: 2026-09-22.

## Phase 76 (the Vue adapter finally runs in a browser, and the test that found no bug)

- `examples/vue/` is a runnable page for `cross-tab-worker-databus/vue`. It
  mounts the real adapter (`useCrossTabDataBus` / `useCrossTabStatus` /
  `useCrossTabSubscription`) against the bundled demo Centrifugo endpoint, and
  the Vue runtime comes from the local `node_modules` install, so the page needs
  no network access and can be driven from CI. `examples/react` hand-rolls its
  own effect/subscribe/status wiring to show the core API, so before this the
  shipped adapters had no page that used them, and the Vue entry had never run
  outside jsdom.
- `e2e/adapters.spec.ts` drives it in real Chromium tabs: two tabs publish and
  receive through the composables; a reactive topic change re-attaches the
  subscription, and once every tab has left the old channel the demo server
  reports zero subscribers on it (the last-subscriber release, seen from the
  server side); and a publication still crosses tabs after the owning tab
  closes. `openVueTab` gates on "exactly one server-side subscriber", which is
  the same invariant the coordination fuzzer asserts against `FakeTransport`.
- `scripts/serve-examples.mjs` gained `/debug/channels` for that gate: it
  reports the Centrifugo hub's per-channel subscriber counts. A cluster
  snapshot shows the *client's intent* a round trip before the subscribe frame
  lands, and delivery is at-most-once, so a test that publishes on the snapshot
  can lose the message for a reason that has nothing to do with what it claims.
- **The three failing tests were my fault, and the reason is worth
  documenting.** The probe payloads were shaped `{"topic":"moved"}`, and
  `parseDataBusPublication` lets a payload's own string `topic` override the
  channel it arrived on — by design, because that is how a server delivers
  through a wildcard channel and still names the concrete topic. The
  publication was therefore re-addressed to `moved`, which no tab owned, and
  dropped: the owner's main thread logged `assigned=false local=false` and both
  tabs sat empty. Confirmed by instrumenting `handleTransportMessage`, running
  the real page, and reading the worker-side Centrifuge debug log (the
  subscription was `subscribed` and the server did push to it). No product bug,
  so no src change; the payload shapes were fixed instead.
- Docs: `docs/transports.md` (en + zh) now states the re-addressing rule and its
  consequence for application data that happens to carry a top-level `topic`;
  `AGENTS.md` lists the new spec and points the quick reference at both adapter
  example pages.
- Changed files: `examples/vue/index.html`, `examples/vue/main.js` (new),
  `e2e/adapters.spec.ts` (new), `scripts/serve-examples.mjs`, `AGENTS.md`,
  `docs/transports.md`, `docs/zh/transports.md`, `CHANGELOG.md`,
  `docs/progress.md`. No `src/` change.
- Verification: `pnpm check` → 38 files / 862 tests; `pnpm lint` clean;
  `pnpm test:e2e` → **30 passed** (was 27) in real Chromium, including the three
  new adapter cases; `git diff --check` clean.
- Risks / rollback: example and tests only. The new e2e cases depend on
  `/debug/channels`, which is additive to the dev-only examples server and
  excluded from the published package. Rollback = delete `examples/vue/`,
  `e2e/adapters.spec.ts`, and revert the server/doc diffs.
- Next: commit, PR, then the remaining coverage ledger items
  (`data-bus.ts:621` stale-demand construction, `centrifuge.ts:286`).
- Updated: 2026-09-22.

## Phase 77 (the fuzz budget that was reading a fake clock)

- Main is green, and that hid a landmine. PR #150's `verify` job failed inside
  `pnpm check` with `Error: Test timed out in 120000ms` on
  `tests/coordination-invariants.test.ts`, which the runner reported as
  **553,490ms**: the sweep bought depth with a seed count, so `#148` passing on
  main was luck rather than a green test. The first diagnosis — runner load — was
  only half right, and the phase records both halves because the wrong one was
  committed first.
- **The mechanism.** The budget compared `Date.now()` against a baseline taken
  at test start, while this suite fakes `Date` in nearly every file and the two
  fuzzers advance it ~45 simulated seconds per seed. A faked clock that outlives
  the file that installed it (vitest reuses a worker across files) poisons that
  arithmetic in either direction, which is exactly what the three measurements
  said: the same file stopped at its floor after **16.4s** in one full coverage
  run, ran to its 60s budget in **60.2s** alone, and burned **539s** on CI never
  breaking at all. Reproduced locally with `--coverage`, so the fix was decided
  on evidence rather than on a retry.
- **The fix is in two layers**, because either alone leaves the other live:
  `tests/setup.ts` restores real timers after *every* test in every file (the
  per-file `afterEach` hooks only covered the describes that declared them), and
  both fuzzers budget on `performance.now()` — not in vitest's default fake set,
  and no test here passes a custom `toFake` — so a future leak cannot move their
  depth again. `Date` stays fake inside the sweep on purpose: that is the
  cluster's clock, and 60 real seconds is now the only thing that bounds it.
- Depth is bounded explicitly: `MAX_SEEDS` cap, per-seed budget check, an
  asserted `MIN_SEEDS` floor so a slow runner cannot "pass" on a handful of
  interleavings, and a log line whenever the sweep truncates — that line is what
  turns "CI explored 12 seeds" from a mystery into a log entry. The floor comes
  from measured mutant **kill depth**: the heaviest mutant this harness was
  proved against (an emptied `reconcileAssignedTopics` sweep) fails at **seed
  12**, so 100 keeps 8x the depth that detects a regression.
- Both new arms were proved live, not added as decoration: `MAX_SEEDS = 50`
  fails with `explored only 50 seeds`, and an 8s budget truncates the sweep at
  the floor with the invariant assertions still passing. After the leak fix the
  same full coverage run reports no truncation at all — the sweep completes.
- **Perf gates: same class, different fix.** One full-suite run also took two of
  the five `tests/perf-gate.test.ts` ceilings down (2079ms against 1000ms,
  2955ms against 2500ms) while the file passed on its own. Fastest-of-3 repeats
  helped but did not save it — a contended coverage run still failed one gate
  with the *best* repeat at 7.4s of a 1s ceiling — so absolute-millisecond gates
  now run as their own sequential step (`pnpm test:perf`, wired into
  `pnpm check`, excluded from `pnpm test` and `pnpm test:coverage` via a config
  flag). Verified the ceiling kept its teeth: a quadratic
  `selectLeastLoadedWorker` trips it at 13,630ms on its best repeat, while a
  50-object-spread-per-call mutant passes both ways — the honest measure of how
  much headroom a 4–20x ceiling actually leaves.
- Changed files: `tests/setup.ts` (new), `vitest.config.ts`, `package.json`
  (`test:perf`, `check`), `tests/coordination-invariants.test.ts`,
  `tests/lifecycle-invariants.test.ts`, `tests/perf-gate.test.ts`, `AGENTS.md`
  (quick reference + the budget/clock/gate conventions), `CHANGELOG.md`,
  `docs/progress.md`. No `src/` change.
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` →
  37 files / **857 tests passed**, `pnpm test:perf` → 5 passed, `pnpm
  test:coverage` → 98.62 / 96.02 / 98.54 / 99.38 against floors
  96 / 92 / 96 / 97 — byte-identical to the run that included the perf file, so
  moving it cost no `src/` coverage.
- Risks / rollback: test and config only. The floor can fail loudly if a runner
  cannot reach 100 seeds in 60s, which is the intended signal (the gate's
  environment degraded), and the truncation line says so. A global
  `afterEach(useRealTimers)` could in principle break a test that expects fake
  timers to survive a hook; none does (`pnpm test` is green). Rollback = revert
  the commits.
- Next: #150 is closed (its premise was wrong — see Phase 78 on
  `test/credential-sync-guard-pin`), then rebase and land
  `test/cjs-default-worker-url`.
- Updated: 2026-09-22.

## Phase 78 (the guard PR called dead was a page error waiting to happen)

- PR #150 proposed deleting `resolveTokenRequest`'s `isCurrentBackend()` check in
  the synchronous `catch`, on the reasoning that nothing between the backend
  capture and the `post()` yields, so the check could only ever read true. The
  reasoning misses that the code between them is **application code**: a
  `credentialProvider` is free to call `stop()` before it throws. Built that
  case and it is not dead — `stop()` clears the backend, `post()` then reaches
  its "start() must be called first" branch, and the throw escapes the Worker
  `message` listener, which in a page is an uncaught error rather than a
  contained connection failure.
- So #150 closes and this branch keeps the guard and pins it:
  `tests/centrifuge.test.ts` now has
  *drops a synchronous credential failure when the provider takes the transport
  down first*, asserting no throw escapes the listener, no `TOKEN_ERROR` reaches
  the terminated Worker, and — as the premise, so the case cannot pass because
  the provider never reached `stop()` — that `diagnosticsBackend` is back to
  `uninitialized` and `STOP` is the last frame the Worker sees. Deleting the
  guard fails it with `Error: CentrifugeWorkerTransport.start() must be called
  first.`, verified by mutation, so the assertion is the regression and not
  decoration.
- The classification is the part worth keeping: this project has removed several
  zero-count legs as unreachable, and correctly so (`selectWorkerBackend` cannot
  return a Worker backend when the corresponding global is absent — the parked
  `typeof Worker` removals stay that way). The difference is whether anything
  other than library code runs inside the guarded window. `AGENTS.md` now says
  that out loud, because the same reasoning will be applied to the next such leg.
- Coverage is unchanged in statements/lines/functions; **branch coverage rose
  96.02 → 96.07**, because the test now takes the guard's false branch instead of
  that branch being deleted. The uplift PR #150 claimed for removing the check is
  therefore available without removing it — which is the whole argument, in one
  number.
- **Correction to Phase 77's account**, from this branch's CI run of the merged
  fix: the green run logs no truncation at all and times the sweeps at
  19.1s (coordination) and 1.7s (lifecycle) on the same runner that previously
  spent 539s on the same 5,000 seeds. So the poisoned clock did not merely
  mis-time the budget, it made the work itself ~28x slower — consistent with the
  leftover fake clock feeding `advanceTimersByTimeAsync`, but that mechanism was
  not proven and is recorded as unproven rather than explained away. What the
  numbers do establish: the two-layer fix removed both the timeout and the
  slowdown, and the depth floor is not what CI is near.
- Changed files: `src/centrifuge.ts` (comment only — the guard is unchanged),
  `tests/centrifuge.test.ts`, `AGENTS.md`, `CHANGELOG.md`, `docs/progress.md`.
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` →
  37 files / **858 tests passed**, `pnpm test:perf` → 5 passed,
  `pnpm test:coverage` → 98.62 / 96.07 / 98.54 / 99.38 against floors
  96 / 92 / 96 / 97. Mutation: with the check deleted, the new case fails with
  `Error: CentrifugeWorkerTransport.start() must be called first.`
- Risks / rollback: no behavior change on this branch, so rollback is a revert.
  The risk being retired is the opposite one: #150 as written would have shipped
  a real regression, which is why it closes rather than merging with tests added.
- Next: rebase `test/cjs-default-worker-url` (whose default-Worker guards really
  are dominated by the tested selector) onto this and land it, then 0.20.97.
- Updated: 2026-09-22.

## Phase 79 (the CJS bundle cannot resolve a Worker URL, and two guards that could never fire)

- `tests/dual-format.test.ts` now pins a failure mode only the shipped artifacts
  have: esbuild shims `import.meta` to `{}` in the CommonJS bundle, so
  `new URL('./centrifuge.worker.js', import.meta.url)` throws there and the
  default Worker can never be constructed from `require()`. The case asserts the
  *actionable* message ("provide workerFactory explicitly") on the CJS artifact
  and, in the same test, drives the ESM artifact with a stubbed `Worker` /
  `SharedWorker` and asserts both default Workers are resolved and constructed —
  the pairing is what ties the failure to the module format rather than to a
  wrong filename. Both arms are mutation-verified: deleting either `catch` fails
  the case with the raw `TypeError: Invalid URL` the message exists to replace.
  This closes the `centrifuge.ts` ledger item the coverage phases kept deferring
  as "CJS-format path, unreachable from an ESM test process".
- Two unreachable defensive branches removed with it: the `typeof Worker` /
  `typeof SharedWorker` throws in `createDefaultWorker` and
  `createDefaultSharedWorker`. `start()` asks `selectWorkerBackend` with
  `worker: workerFactory !== undefined || typeof Worker !== 'undefined'`, the
  selector never returns a backend its availability flags deny, and the factories
  are only reached for a backend it returned — so the throw's condition is
  already established false by the caller. The degradation is pinned *where it is
  decided*: `tests/worker-mode.test.ts` on the selector, and the transport-level
  "falls back to the local session when the platform lacks both Worker APIs" case
  on the outcome.
- **The contrast with the credential guard (next phase) is the part worth
  keeping.** Both looked like dead legs, and the difference was not style: a
  provider `catch` can be reached with a stale backend because application code
  runs inside the guarded window, whereas here nothing runs between the
  availability check and the call — not a callback, not an await — so no
  re-entry can invalidate the fact. Delete one, pin the other; say which in the
  code so the next reader does not infer the rule from the wrong example.
- Residual `centrifuge.ts` uncovered lines after this change: 457 and 477, both
  inside the `catch` that builds the CJS-format message — unreachable from an
  ESM test process and reachable from the CJS one, which is exactly the case
  added above; they read as uncovered because the CJS artifact is loaded from
  `dist/`, outside the `src/**` coverage include.
- Changed files: `src/centrifuge.ts`, `tests/dual-format.test.ts`,
  `CHANGELOG.md`, `docs/progress.md`.
- Verification (after rebasing onto the CI-budget fix and the credential pin, so
  the fuzzers are bounded): `pnpm typecheck`, `pnpm lint`, `pnpm build`,
  `pnpm test` → 37 files / **859 tests passed**, `pnpm test:perf` → 5 passed,
  `pnpm test:coverage` → 98.68 / 96.17 / 98.54 / 99.46 against floors
  96 / 92 / 96 / 97 — up from `main`'s 98.62 / 96.02 / 98.54 / 99.38 on every
  metric the removal touches.
- Risks / rollback: no behavior change for any reachable runtime; rollback =
  revert the two commits (the test and the removal are separate).
- Next: land this after #152, then 0.20.97 with the CI fix, the Vue example, the
  coordination fuzzer, the credential pin and this removal in its range.
- Updated: 2026-09-22.

## Release 0.20.97 prepared (2026-09-22)

- Version: `0.20.96` → `0.20.97` (patch). Branch `release/0.20.97` off
  `main@704b6d1`; range `v0.20.96..704b6d1` is PRs #147-#153.
- **Why this is worth cutting.** The shipped `src/` artifact differs from
  `0.20.96` by `centrifuge.ts` only — two unreachable `typeof Worker` /
  `typeof SharedWorker` throws removed and comments recording which guard is
  load-bearing. No public export changed (`verify:compat` green against the
  `v0.20.96` baseline), no observable behavior changed, and the release carries
  the Vue adapter's first real-browser coverage, the between-tabs coordination
  fuzzer, and the fix that makes the release gate deterministic.
- Freeze checklist, run on this branch: `pnpm check` → typecheck + build +
  37 files / 859 tests + `pnpm test:perf` 5 tests; `pnpm lint` clean;
  `pnpm test:coverage` → 98.68 / 96.17 / 98.54 / 99.46 against floors
  96 / 92 / 96 / 97; `pnpm bench` green; `pnpm test:e2e` → **30 passed** in real
  Chromium (the three `adapters.spec.ts` cases included); `pnpm bench:browser`
  twice then `pnpm bench:compare --fail-above-pct 50` → "no metric regressed more
  than 50%" (largest move `dedup1000Ms` +8.8%, `publishBatch1000Ms` +11.9%,
  `traceAndPublish1000Ms` −9.5% — inside the documented alternating-mode spread);
  `pnpm bench:trend` regenerated both `docs/benchmarks.md` from 44 archived
  reports; `pnpm verify:compat` and `pnpm verify:pack` green (the packed
  `cross-tab-worker-databus-0.20.97.tgz` imports as ESM and CJS at the root and
  every subpath); public-registry `pnpm audit --audit-level high` → "No known
  vulnerabilities found"; `git diff --check` clean.
- Prepare commit contents: `package.json` version, `CHANGELOG.md` (`Unreleased`
  → `## [0.20.97] - 2026-09-22`), `docs/roadmap.md` + `docs/zh/roadmap.md`
  delivered scope, both `docs/benchmarks.md`, this entry, and one doc addition
  that belonged with the release: `docs/getting-started.md` (en + zh) now names
  the `/examples/react/` and `/examples/vue/` adapter pages that ship beside the
  demo, which nothing outside `AGENTS.md` did before.
- Risks / rollback: the runtime delta is dead-code removal, so the defect class
  this release could introduce is "a branch that was reachable after all". The
  reachability argument is recorded in the code and pinned by the two tests in
  #152/#153 rather than asserted in prose. npm versions are immutable: a defect
  ships as `0.20.98`, and `v0.20.97` is never moved or reused.
- Next after publish: the deferred minor that turns the empty-topic `console.warn`
  into a `TypeError` at the public boundary (policy-owned, its own release
  section and doc updates), then a re-check of the `typescript-eslint` peer
  ceiling for TypeScript 7.
- Updated: 2026-09-22.

## Release 0.20.97 completed (2026-09-22)

- Version: `0.20.97` published. PR #154 squash-merged into `main` as `4abe7d9`,
  tag `v0.20.97` pushed at that exact commit, and the `Release` workflow run
  `35680947257` finished with **every step green** in 6m22s — `pnpm check`,
  `pnpm lint`, `verify:compat` (baseline `v0.20.96`), `verify:pack`, the npm
  publish, and the blocking `verify:published` consumer check.
- Registry state after publish: `npm view cross-tab-worker-databus version
  dist-tags.latest` → `0.20.97` / `0.20.97`, so `latest` moved with the release
  rather than lagging behind it.
- Branch hygiene: `release/0.20.97` remote branch deleted after the merge and
  tracking refs pruned, per the rule that a topic branch is PR transport and
  not storage.
- Risk / rollback: none outstanding. npm versions are immutable, so a defect
  found later ships as a new version and `v0.20.97` is never moved or reused.
- Next: close the empty-topic deprecation cycle opened in `0.20.96` (phase 80),
  which is the removal step the policy calls for and therefore a minor.
- Updated: 2026-09-22.

## Phase 80 (the empty topic stops being accepted, and what the pages did without a fallback)

- Version: `0.21.0` (minor — this is a removal, not an addition). Branch
  `feat/reject-empty-topic` off `main@4abe7d9`.
- **What shipped.** `subscribe("")`, `publish("")` and `publishBatch("")` throw a
  `TypeError` where `0.20.96` warned once per bus: the cycle the pre-1.0 policy
  requires is complete, and `warnEmptyTopic` plus its per-instance latch are
  gone. The new `assertPublicTopic` sits in `src/utils/validation.ts` with the
  option guards and runs as the first statement of all three methods, so a
  rejected call starts no transport, registers no handler and writes no route
  record for a channel nothing can address.
- **The ordering finding that decided the test split.** `publishBatch` delegates a
  one-item batch to `publish()`, so *every* empty-topic batch call is still
  refused even with its own guard deleted — only `publishBatch("", [])`, which
  would otherwise take the documented empty-array no-op, distinguishes a guard
  above that return from one below it. It therefore has its own `it()`, and each
  message names the operation the caller used for the same reason.
- Mutation evidence, each killing a distinct arm (five mutants, all dead):
  guard deleted from `subscribe` → `expected function to throw an error, but it
  didn't`; from `publish` → `expected [Function] to throw an error`; from
  `publishBatch` → `expected … to throw error including
  'CrossTabDataBus.publishBatch("")' but got 'CrossTabDataBus.publish("")'`, the
  delegation showing through; guard moved below the no-op → **both** tests fail,
  the second with a plain "to throw an error" and nothing else; `assertPublicTopic`
  made a no-op → the first probe fails.
- **The example pages were the exposure, not the bus.** Their topic boxes feed a
  reactive (demo: re-applied) subscription, so with `""` now rejected the page has
  to resolve the fallback itself; `examples/react` and `examples/vue` gained
  `input.trim() || <default>`, which `examples/demo` already had.
- **What "without the fallback" actually looks like, measured rather than
  assumed.** Driving the Vue page with the guard removed produced
  `pageerror: TypeError: CrossTabDataBus.subscribe("") addresses a channel no
  transport can route` while `#topicBadge` kept rendering the *previous* topic —
  the tab looks healthy and is deaf. On the demo page, `applyConnection()` caught
  the throw and left the tab on 错误 with an event-feed row that never mentions
  the field the user emptied. Both are now pinned in real Chromium
  (`e2e/adapters.spec.ts`, `e2e/demo.spec.ts`), and each arm of the guard kills a
  different mutant: `computed(() => topicInput)` fails the whitespace arm, `??`
  instead of `||` fails the raw-empty arm, and dropping `demo.js`'s guard fails at
  `#configTopic` staying on the previous topic.
- **Docs defect found on the way.** `docs/getting-started.md` (en + zh) said the
  browser suite covers "the adapter pages". It covers the Vue page only:
  `examples/react` loads React from `esm.sh`, so it cannot load on a CI runner
  without network, and it hand-wires the demo page's pattern rather than using the
  shipped React adapter. The paragraph now states which page is driven and why the
  other is not, which also puts the React page's fallback on the record as the one
  path in this change verified by hand.
- Changed files: `src/utils/validation.ts`, `src/core/data-bus.ts`,
  `tests/data-bus.test.ts`, `e2e/adapters.spec.ts`, `e2e/demo.spec.ts`,
  `examples/react/main.jsx`, `examples/vue/main.js`, `docs/api.md`,
  `docs/zh/api.md`, `docs/getting-started.md`, `docs/zh/getting-started.md`,
  `CHANGELOG.md`, `package.json`, both `docs/roadmap.md`, both
  `docs/benchmarks.md` (regenerated), this file.
- Verification: `pnpm check` → typecheck + build + 37 files / **860 tests** +
  `pnpm test:perf` 5 tests; `pnpm lint` clean; `pnpm test:coverage` →
  98.68 / 96.16 / 98.54 / 99.45 against floors 96 / 92 / 96 / 97;
  `pnpm test:e2e` → **32 passed** (the two new cases included); `pnpm bench`
  28/28; `pnpm bench:browser` twice then `bench:compare --fail-above-pct 50` →
  "no metric regressed more than 50%" (largest move `publish/shared/perMessageMs`
  +16.3%, inside the documented alternating-mode spread); `pnpm bench:trend`
  regenerated both trend docs from 46 reports; `pnpm verify:compat` → "0.21.0
  preserves public exports and type metadata from v0.20.97" (the export surface is
  unchanged — this is a behavior removal, which the gate cannot see, hence the
  CHANGELOG call-out); `pnpm verify:pack` green on
  `cross-tab-worker-databus-0.21.0.tgz`; `tests/documentation.test.ts` 17/17 with
  the en/zh list-item parity intact; public-registry `pnpm audit --audit-level
  high` → no known vulnerabilities; `npm pack --dry-run --json` → 109 files,
  3.6 MB, nothing unintended; `git diff --check` clean.
- Blockers: none. Risks / rollback: a consumer calling the three methods with a
  value that is empty at runtime now gets a `TypeError` instead of a warning —
  that is the intended break, announced one minor earlier and migration-shaped in
  the upgrading guide (`input.trim() || 'demo.flow'`). npm versions are immutable:
  a defect ships as `0.21.1`, `v0.21.0` is never moved.
- Next: publish `0.21.0`, then serve the React example's React locally (esbuild is
  already a devDependency) so the last hand-wired adapter page gains browser
  coverage and the example stops depending on a CDN; afterwards the
  `typescript-eslint` peer ceiling for TypeScript 7 stays the only external block.
- Updated: 2026-09-22.

## Release 0.21.0 prepared (2026-09-22)

- Version: `0.20.97` → `0.21.0` (minor, as the deprecation policy requires for a
  removal). Branch `feat/reject-empty-topic` off `main@4abe7d9`.
- **Why this is worth a minor rather than a patch.** It is the second half of the
  project's first deprecation cycle: `0.20.96` warned, this refuses. The public
  export surface is byte-for-byte compatible (`verify:compat` green against
  `v0.20.97`) — the change is in what three existing methods accept, which no
  export-shape gate can see. The CHANGELOG leads with a `### Breaking` section
  that names the call sites, the reason, the migration and the
  `publishBatch("", [])` edge case.
- Freeze checklist: the full set is recorded in the phase 80 verification bullet
  above and was run on this branch at this commit; the release adds only
  `package.json`, `CHANGELOG.md`, both roadmaps, both generated
  `docs/benchmarks.md` and these entries.
- Risks / rollback: the runtime delta is one string comparison per public call on
  the hot path, plus the pages' fallback. `publish/shared/perMessageMs` moved
  +16.3% against the median baseline, which is inside the spread two identical
  runs of unchanged code have shown (49.9 ms then 71.1 ms), and no metric came
  near the 50% gate. A defect ships as `0.21.1`; `v0.21.0` is never moved.
- Next after publish: local React for `examples/react` so its adapter page is
  driven in a browser too, then the standing dependency/security patrol.
- Updated: 2026-09-22.

## Release 0.21.0 completed (2026-09-22)

- Version: `0.21.0` published. PR #155 squash-merged into `main` as `49e77a7`,
  tag `v0.21.0` pushed at that exact commit, `Release` workflow run
  `35685211626` **success** (its `release` job green end to end, including the
  blocking `verify:published` consumer gate), GitHub release `v0.21.0` published
  from the CHANGELOG section.
- Registry state: `npm view cross-tab-worker-databus version dist-tags.latest` →
  `0.21.0` / `0.21.0`, and the registry time list ends
  `"0.20.96", "0.20.97", "0.21.0"` — the first **minor** of this release series
  and the first removal the project has shipped.
- Branch hygiene: `feat/reject-empty-topic` deleted with the merge
  (`--delete-branch`), `git ls-remote --heads` shows only `main`.
- What the release actually changed for a consumer: three public methods now
  reject `""`. No export moved, no other behavior moved, and the pre-1.0 policy's
  own paper trail (warn in `0.20.96`, remove in `0.21.0`, call it out in that
  CHANGELOG) is what the breaking section documents.
- Follow-up found after publish: the `0.21.0` CHANGELOG text named the React
  adapter `cross-tab-worker-databus/react`, which is not an export this package
  has — it is `cross-tab-worker-databus/hooks`. Published release notes are not
  rewritten, so the correction is recorded in the current `Unreleased` section
  (phase 81 found it while the same sentence was being updated for real).
- Risk / rollback: none outstanding. npm versions are immutable; a defect ships
  as `0.21.1` and `v0.21.0` is never moved or reused.
- Updated: 2026-09-22.

## Phase 81 (the React example stops needing a network, and so its page gets tests)

- Version: unreleased work on `feat/local-react-example`, off the tagged
  `v0.21.0` commit `49e77a7`. Target: a patch release (`0.21.1`) — no public
  surface and no library behavior changes; everything is example, test and docs.
- **Why it was worth doing.** Phase 80 left one edited code path verified by hand
  instead of by a gate: `examples/react` resolves its topic fallback in a React
  effect, and nothing in CI could load that page at all, because React itself came
  from `esm.sh`. That also pinned the page to React 18 while `tests/hooks.test.tsx`
  exercises React 19 — the example was demonstrating an older framework version
  than the one under test.
- **What it took.** React ships no browser ESM build (`react/index.js` is
  `module.exports = require('./cjs/react.development.js')`), so `pnpm build:examples`
  bundles `react` + `react-dom/client` with esbuild into one vendor module that the
  import map points at twice. Twice on purpose: two vendor files would give the page
  two Reacts, and react-dom's reconciler differing from the imported `react` fails
  every hook with "Invalid hook call". The first attempt used `export * from 'react'`
  and exported **nothing but** `createRoot` — an export-star over a CJS module whose
  shape is a runtime reassignment has no static names to forward. Caught by importing
  the bundle in node and checking each name, not by a browser test failing.
- **Page changes to make it drivable.** `examples/react` gained the ids the Vue page
  already had (`#statusBadge`, `#topicBadge`, `#topicInput`, `#draftInput`,
  `#publishButton`, `#messageList`, `#receivedCount`), a `?topic=` override, a topic
  badge, and the `window.__reactBus` diagnostics hook. `e2e/adapters.spec.ts` then
  runs one set of four cases against both pages, parameterized by the page's url,
  hook name and fallback topic: fan-out, reactive rebind that leaves the old channel
  with zero server subscribers, delivery after the owning tab closes, and the
  cleared-topic-box fallback with both arms of the guard probed.
- Verification: all four React cases pass (`pnpm exec playwright test --grep "react
  example page"`, 29.3s for 4 tests in parallel), and the fallback case was
  mutation-checked the same way the Vue one was — `topic = topicInput` (no
  `trim()`, no fallback) fails with `unexpected value "  Topic:    "` and passes
  again in 1.0s once restored. `pnpm typecheck` and `pnpm lint` clean;
  `node scripts/build-example-vendor.mjs` output verified in node for all 9 names
  the page imports, with `version` reporting the installed `19.3.0`.
- Changed files: `scripts/build-example-vendor.mjs` (new), `package.json`
  (`build:examples`, wired into `examples` and `test:e2e`), `.gitignore`
  (`examples/react/vendor/`), `examples/react/index.html`, `examples/react/main.jsx`,
  `e2e/adapters.spec.ts`, `docs/getting-started.md`, `docs/zh/getting-started.md`,
  `AGENTS.md` (quick-reference row), `CHANGELOG.md`, this file.
- Blockers: none. Risks / rollback: dev-only surface — the packed `dist/` is
  untouched, so the shipped artifact is byte-identical to `0.21.0` apart from
  version metadata. A defect in the vendor bundle breaks only the example page and
  its four browser tests.
- Next: full gate set on this branch (`pnpm check`, `pnpm test:coverage`,
  `pnpm test:e2e`, `verify:compat`, `verify:pack`), then the `0.21.1` prepare and
  publish; the `typescript-eslint` peer ceiling for TypeScript 7 stays the only
  external blocker.
- Updated: 2026-09-22.

## Release 0.21.1 prepared (2026-09-22)

- Version: `0.21.0` → `0.21.1` (patch). Branch `feat/local-react-example` off
  `v0.21.0` (`49e77a7`); commits `ef79b73` (example + browser suite + docs),
  `c9b4b89` (progress log), this one.
- **Why cut a release for work that touches no library code.** `scripts/build.mjs`
  injects `__SDK_VERSION__` from `package.json`, so the version `getDiagnostics()`
  reports is part of the artifact: leaving this work unreleased would keep
  shipping `0.21.0` while the repository moved on. It also retires the one
  hand-verified path phase 80 left behind.
- Freeze checklist, run on this branch: `pnpm check` → typecheck + build + 37
  files / 860 tests + 5 perf gates; `pnpm lint` clean; `pnpm test:coverage` →
  98.68 / 96.16 / 98.54 / 99.45, **identical to 0.21.0** because `src/` did not
  move; `pnpm test:e2e` → **36 passed** (up from 32: the four React cases);
  `pnpm bench` 28/28; `pnpm verify:compat` green against `v0.20.97`;
  `pnpm verify:pack` green; public-registry `pnpm audit --audit-level high` clean;
  `git diff --check` clean; `tests/documentation.test.ts` 17/17 with en/zh
  list-item parity intact.
- **The browser-bench gate failed once and the second run explained it.**
  `bench:compare --fail-above-pct 50` reported
  `publish/shared/perMessageMs 37.1 → 66.7 (+79.8%)` with every other metric flat
  or improved (−2.9%, 0.0%, −0.7%, −3.6%) — the single-metric-up-everything-else-
  down shape the release checklist already documents as this metric's noise mode.
  The next run of the same tree came in at 38.8 ms and every metric improved or held
  (gate OK). No library file changed on this branch, so no regression was available
  to find; `pnpm bench:trend` regenerated both trend docs from 49 reports.
- Prepare commit contents: `package.json` version, `CHANGELOG.md` (`Unreleased` →
  `## [0.21.1]`), `docs/roadmap.md` + `docs/zh/roadmap.md` delivered scope, both
  `docs/benchmarks.md`, this entry.
- Risks / rollback: dev-only surface plus the injected version string. If the vendor
  bundle were defective, only `examples/react` and its four browser cases would
  break; `dist/` is untouched. npm is immutable — a defect ships as `0.21.2` and
  `v0.21.1` is never moved.
- Next after publish: the standing dependency/security patrol, and the
  `typescript-eslint` peer-range re-check that gates TypeScript 7.
- Updated: 2026-09-22.

## Release 0.21.1 completed (2026-09-22)

- Version: `0.21.1` published. PR #156 squash-merged as `c9f7b51`, tag `v0.21.1`
  pushed at that commit, `Release` workflow run `35687174160` **success**,
  `npm view … version dist-tags.latest` → `0.21.1` / `0.21.1`.
- CI proved the point of the change independently: the `browser` job drove
  `examples/react` with no path to `esm.sh` (36 e2e cases green, job 3m37s against
  2m13s before the four React cases existed).
- Branch hygiene: `feat/local-react-example` deleted with the merge;
  `git ls-remote --heads` lists only `main`.
- Updated: 2026-09-22.

## Phase 82 (one absorb that no assignment can reach)

- Version: `0.21.2` (patch). Branch `test/data-bus-lifecycle-ledger` off
  `v0.21.1` (`c9f7b51`).
- **What and why.** Re-measured the `data-bus.ts` zero-count ledger from the
  coverage JSON rather than from memory: `performStop()`'s
  `pendingStop.catch(() => undefined)` was an uncovered function. `pendingStop` is
  assigned non-null in exactly two places — `openTransport`'s failure path via
  `createStopPromise()`, and `suspendTransport()`'s stop chained behind the
  in-flight open — and both chains end in a terminal
  `.catch(error => this.reportError(error))` that resolves, so the absorb cannot
  fire and the failure is already recorded where it is produced. Deleted, with the
  enumeration written into the comment so the claim is checkable rather than
  asserted.
- **The neighbour that stays, and the asymmetry that decided it.** One line above,
  `startPromise?.catch(() => undefined)` is covered and load-bearing: `startPromise`
  holds the opening whose rejection `ready()` reports to its caller. Deleting the
  `pendingStop` absorb also fails *safe* — a future third assignment site that
  rejected would route to the outer `catch` and be reported twice, not surface as
  an unhandled rejection. Both verdicts plus the method are now an `AGENTS.md`
  convention next to the existing synchronous-`catch` rule.
- **Deliberately not churned.** The other 19 zero-count arms in this file were
  read and left standing this pass, because classifying them needs their callers
  enumerated and several are "always true" guards whose dominance argument is not
  yet proven (e.g. `branch@1544` in `reopenTransport`, `branch@1242`'s
  `originTabId === undefined` leg, the `[N,0]` `pendingStop` identity checks). An
  unproven deletion is how 0.20.97's PR #150 nearly shipped a page error; the
  ledger stays open on purpose.
- Changed files: `src/core/data-bus.ts`, `AGENTS.md`, `CHANGELOG.md`,
  `package.json`, both `docs/roadmap.md`, this file.
- Verification: `pnpm check` → 37 files / 860 tests + 5 perf gates; `pnpm lint`
  clean; `pnpm test:coverage` → 98.71 / 96.16 / 98.72 / 99.45 (functions
  98.54 → 98.72, statements 98.68 → 98.71, branches and lines unmoved, no test
  deleted); `pnpm test:e2e` → 36 passed; per-file re-measure confirms
  `fn@1186` is gone from the uncovered list (115/120 functions, was 114/120).
- Blockers: none. Risks / rollback: the deleted expression had no reachable input,
  and the browser suite still exercises `performStop()` through real teardowns.
  npm is immutable — a defect ships as `0.21.3`, `v0.21.2` is never moved.
- Next: the remaining `data-bus.ts` arms (start with `branch@1544` and the
  `pendingStop` identity checks), then the standing dependency/security patrol.
- Updated: 2026-09-22.

## Release 0.21.2 prepared (2026-09-22)

- Version: `0.21.1` → `0.21.2` (patch: a dominated branch removed, nothing
  observable moved). Same branch and commits as phase 82.
- Freeze checklist: the set recorded in phase 82's verification bullet, run on this
  commit; `verify:compat` green against `v0.21.1` by construction (no export
  changed), `verify:pack` green, `tests/documentation.test.ts` 17/17 with en/zh
  list-item parity intact, `npm pack --dry-run --json` listing unchanged (109 files),
  `git diff --check` clean, public-registry audit clean.
- Next after publish: continue the `data-bus.ts` ledger, then reassess whether any
  executable work remains beyond dependency tracking.
- Updated: 2026-09-22.

## Phase 83 (jsdom refresh, and the one arm that must not be decorated)

- Version: unreleased work on `chore/jsdom-30.1.1`, rebased onto `v0.21.2`
  (`a10d2ae`). Rides into the next release; a devDependency patch alone is not a
  release reason.
- `jsdom` `30.1.0` → `30.1.1` (`1293bfd`), the only actionable line in
  `pnpm outdated` — TypeScript `7.0.2` stays fenced by the `typescript-eslint`
  peer range, as recorded since 0.20.96. Verified by the two jsdom suites
  (`tests/hooks.test.tsx`, `tests/vue.test.ts`, 26 tests) and the full
  `pnpm check` (860 tests), `pnpm lint` clean, public-registry audit clean.
- **The `reopenTransport` guard, classified instead of "covered".** Phase 82 left
  `if (this.stopping || this.activeConfig === undefined) return` at 0 of 5041. The
  first disjunct is redundant by construction — every caller re-checks `stopping`
  or cancels the path (`resumeSuspendedResources()` both arms,
  `startDemandRecovery()`'s gate, `runTransport()`'s demand reopen, and
  `beginStop()` cancelling the recovery timer synchronously). The second is not
  re-checked anywhere and is the only thing between a future caller and
  `transport.start(undefined)`, so it stays and now says so in the source.
- **A decorative test was written, caught and deleted.** The obvious probe —
  pageHide, `stop()`, then pageShow — passes with the disjunct deleted outright,
  because `cluster.stop()` removes the visibility listener and bumps
  `lifecycleGeneration`, so the resume path is gone before the check matters. That
  experiment is the evidence for the classification and the reason no test is
  claimed here: a probe that survives its own deletion is not coverage, and it is
  what the next agent would otherwise mistake for one.
- Changed files: `package.json`, `pnpm-lock.yaml`, `src/core/data-bus.ts`
  (comment only), this file.
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test` → 37 files / 860 tests,
  `pnpm test:coverage` → 98.71 / 96.16 / 98.72 / 99.45, unchanged (no runtime
  statement moved).
- Blockers: none. Risks / rollback: dependency + comment; revert is
  `git revert` of the two commits with no consumer impact.
- Next: the `data-bus.ts` ledger is *not* closed — 1545, 1186 and 1150 are now
  classified, and roughly nineteen zero-count arms remain, each needing the same
  call-site enumeration before it is called dominated or written off. Then the
  standing dependency/security patrol.
- Updated: 2026-09-22.

## Release 0.21.2 completed (2026-09-22)

- Version: `0.21.2` published. PR #157 squash-merged as `a10d2ae`, tag `v0.21.2`
  pushed at that exact commit, `Release` run `35688512897` green through the
  publish and the blocking `verify:published` consumer gate;
  `npm view … version dist-tags.latest` → `0.21.2` / `0.21.2`.
- Branch hygiene: `test/data-bus-lifecycle-ledger` deleted with the merge;
  `git ls-remote --heads` lists only `main`.
- What shipped: one dominated `.catch` removed from `performStop()`, its neighbour
  kept with the reason, and the method for telling them apart recorded in
  `AGENTS.md`. No export, protocol or observable behavior changed; whole-suite
  function coverage 98.54% → 98.72%.
- Risk / rollback: npm is immutable, so a defect ships as `0.21.3` and `v0.21.2`
  is never moved or reused; the previous release (`0.21.1`) remains installable for
  anyone who needs to pin back.
- Next in flight: PR #158 (`chore/jsdom-30.1.1`) — the jsdom 30.1.1 refresh and the
  `reopenTransport` guard classification, which rides into the next release.
- Updated: 2026-09-22.

## Phase 84 / Release 0.21.3 prepared (2026-09-22)

- Version: `0.21.2` → `0.21.3` (patch). Branch `refactor/dead-absorbers` off
  `main@b0354e4`; the code commit is `ebbb61b`.
- **Done.** Two more absorbed rejections deleted, both dominated by an
  enumeration of assignment sites rather than by a guess: `queueStartAfterStop()`
  swallowed `stopPromise` (single non-null assignment — `stop()`'s gate, resolved
  from both settle arms, which is exactly why `stop()` never rejects), and
  `openTransport()` swallowed its `before` argument (`Promise.resolve()` from
  `reopenTransport()`, or `pendingStop`, whose every non-null chain ends in a
  terminal `.catch(reportError)`). The premises are in the comments at the two
  call sites.
- Files: `src/core/data-bus.ts`, `package.json`, `CHANGELOG.md`,
  `docs/roadmap.md`, `docs/zh/roadmap.md`, this file.
- Verification: `pnpm typecheck` and `pnpm lint` clean; `pnpm test` → 37 files /
  860 tests; `pnpm test:e2e` → 36 passed; per-file function coverage
  115/120 → 115/118, three uncovered handlers left in the module (one kept on
  purpose as `performStop()`'s unhandled-rejection backstop, two still owed a
  call-site enumeration).
- Risks / rollback: like 0.21.2 the runtime delta is dead-code removal, so the
  only defect class it can introduce is a branch that was reachable after all —
  and here the reachability argument is a two-site enumeration written next to the
  code, not a prose claim. npm is immutable: a defect ships as `0.21.4`;
  `v0.21.3` is never moved, and `0.21.2`/`0.21.1` stay installable to pin back.
- Next: the remaining `data-bus.ts` handlers (`1576`, `1595` superseded-open and
  reopen-failure arms) plus the zero-count branches in the other modules; then the
  standing dependency/security patrol.
- Updated: 2026-09-22.

## Phase 85 / Release 0.21.3 completed, and a harness claim that was false

- Version: `0.21.3` published — PR #159 squash-merged as `ea526c2`, tag `v0.21.3`
  at that commit, branch deleted with the merge. Its first `verify` run failed and
  the identical re-run passed, which is what led to the finding below.
- **The re-run was not the end of it.** `tests/coordination-invariants.test.ts`
  spent 525s on that runner (16.0s locally, same code) and blew its 120s test
  timeout. Retrying hides it; the cause is that the sweep's wall-clock budget is
  read from `performance.now()`, and the claim in `AGENTS.md` that `performance` is
  outside Vitest's default fake set is **wrong on the pinned Vitest 5**: with the
  budget forced to 2.5s the sweep reported "out of budget" after 48 ms of real
  time, because each seed advances the faked timers ~45 simulated seconds.
- **Why the obvious fix is not obvious.** Removing the `completed >= MIN_SEEDS`
  conjunct and checking the budget per operation — the change that looks correct —
  truncates the sweep at 3 seeds and fails the floor locally, because the clock it
  compares against is the faked one. So the conjunct is currently the only thing
  keeping the budget from firing immediately, and the real fix has to bind a
  monotonic clock at module load (before any `vi.useFakeTimers()`) first.
- Status: partially done. Shipped — the falsified claim corrected in `AGENTS.md`
  with the measurement that disproved it. Open — a real-clock budget plus operation
  granularity in both seeded fuzzers, with the floor re-derived from the depth that
  actually detects a regression (the heaviest known mutant dies at seed 12).
- Verification of this entry: `git status` clean after reverting the experimental
  harness edit (no behavior was shipped from it), the committed suite still green
  (`pnpm test` 37 files / 860 tests on `ea526c2`).
- Next: implement the real-clock budget on a branch of its own, then re-derive
  `MIN_SEEDS`, then return to the `data-bus.ts` handler ledger (1576/1595 arms).
- Updated: 2026-09-22.

## Phase 86 / The fuzz budget's clock, made immune instead of accidentally right

- Version: no release — `src/` is untouched, so `dist/` and npm are unaffected. Branch
  `fix/fuzz-budget-clock`, test-infrastructure and documentation only.
- **The claim in Phase 85 was only half right, and the half matters.** It recorded that
  `performance.now()` moves under fake timers and that the budget therefore could not be
  trusted. Both clocks were then measured separately, inside and outside a fake window:
  - *inside* a window advanced 60 simulated seconds: global `performance.now()` returned
    60000, `process.hrtime.bigint()` moved 60000, `Date.now()` moved — and
    `node:perf_hooks`' `performance` read **216ms of real time**. It reported
    `performance !== nodePerformance`, which explains why: Vitest shadows the *global
    binding*, so the module's own object is never touched.
  - *between* windows (the top of a seed loop, right after that seed's `useRealTimers()`):
    20 iterations of 45 simulated seconds each produced live reads of 0, 2, 2, 4 … 10ms
    against 11ms real.
  So the committed per-seed budget was never broken — it reads a restored clock. What broke
  in Phase 85's experiment was the *per-operation* variant, which reads inside the window.
  A correct-by-placement invariant is one refactor away from being wrong, so the immunity now
  comes from the source.
- Completed: `realNowMs()` in `tests/fakes.ts` (backed by `node:perf_hooks`), used by both
  seeded fuzzers' budgets and their truncation log lines, and by `bestOfMs` in
  `tests/perf-gate.test.ts` — a gate on absolute milliseconds must not be able to read
  simulated time, because a faked `performance.now()` would make a 200k-iteration loop
  measure ~0 and pass every ceiling without running anything.
- Pinned: `budgets on a clock that fake timers cannot move` asserts `realNowMs()` stays under
  5s across a 60-second fake advance. Mutation-checked: pointing the helper at the global
  `performance.now()` fails it with `expected 60000 to be less than 5000`, so the pin has
  teeth rather than merely documenting intent.
- Documentation corrected to match the measurements: the `AGENTS.md` testing bullet now names
  `realNowMs()` as the budget clock and states why a live `performance.now()` is unsafe *in a
  window* but not unsafe *between* them; `tests/setup.ts`'s header no longer claims the
  fuzzers use a clock no test fakes (that sentence was the error Phase 85 half-fixed).
- Also measured while sizing this: the sweep is nowhere near its budget on healthy hardware —
  5,000 seeds cost 58.7s locally without instrumentation, 19s in CI's `test` step and 27.6s in
  its coverage step, with no `stopped at` line in any of those logs. The 164ms-per-seed figure
  that motivated the floor came from a loaded local coverage run, i.e. the budget is a fuse for
  a degraded runner, not a routine cost cap. The `coordination-invariants` constant comment now
  states those numbers instead of the single 66s estimate it carried.
- Changed files: `tests/fakes.ts`, `tests/coordination-invariants.test.ts`,
  `tests/lifecycle-invariants.test.ts`, `tests/perf-gate.test.ts`, `tests/setup.ts`,
  `AGENTS.md`, `docs/progress.md`.
- Verification: `pnpm lint` clean; `pnpm typecheck` clean; `pnpm check` green (37 files /
  861 tests in 55.3s; coordination 53.3s over 2 tests, lifecycle 29.9s; `pnpm test:perf`
  5 gates in 1.5s on the new clock). The scratch probe file used for the measurements (run
  three times, once per question) was deleted and never committed.
- Risk / rollback: no shipped code changes, so a revert is a `git revert` of one commit with no
  migration and no version consequence. The only behavioural risk is a fuzzer that stops
  earlier or later than before — it does not: both budgets keep the same 60s ceiling, the same
  `MAX_SEEDS` caps and the same floors, and neither sweep changed which arm stops it (seed
  count, not the fuse, on hardware this size).
- Next: `typescript` 6.0.3 → 7.0.2 is the only package behind (`pnpm outdated`); try the
  compiler major on its own branch, then back to the `data-bus.ts` handler ledger (`1576`
  trace-attempt arms, `1601` superseded-opening guard).
- Updated: 2026-09-22.

## Phase 87 / Two recovery-ledger legs in `data-bus.ts`, and a test that was deleted for being decoration

- Version: no release — the only `src/` change is a comment. The shipped JS is
  unaffected by it (the comment text appears only in `dist/*.js.map`, never in a
  chunk), so this phase changes what is *proved* about the code, not the code.
- Branch `test/data-bus-reopen-arms`, rebased on `ca44401` (Phase 86's merge).
- Closed two ledger legs, both in the diagnostics the roadmap bills as a shipped
  capability ("structured recovery/retry events"):
  1. `getRecoveryStats().errorMessage` and `getHealthSummary().lastFailure.message`
     render a non-`Error` failure through `String(error)`. A Worker or a hand-written
     transport may report a bare string, and reading `.message` off one does not throw
     — it yields `undefined`, so the ledger kept the failure and lost the explanation.
     Two separate render expressions, so both are asserted in one test.
  2. `reopenTransport()`'s rejection handler drops its `failed` reliability event once
     a newer lifecycle owns the bus. The path is real and re-entrant: a failing reopen
     publishes `ERROR` from its own teardown *before* its rejection settles, so an
     application that retries from that callback has already bumped the lifecycle epoch
     when the handler runs. Reporting anyway would place a recovery failure *after* the
     start that replaced it — the one ordering a trace reader cannot reinterpret.
- Coverage-verified, not assumed: those three lines (990, 1378, 1619) read zero counts
  before and non-zero after, and the whole-`data-bus.ts` ledger went 21 → 18 entries.
  Suite coverage moved 98.78 / 96.16 → 98.81 / 96.31 (statements / branches).
- Mutation-checked, one mutant at a time, `src/` verified clean afterwards:
  `String(error)` → `''` fails the `lastFailure` assertion; `String(this.lastError)` →
  `null` fails the recovery-stats assertion; deleting the epoch `return` produces an
  unexpected `outcome: "failed"` event. Each kill was confirmed to hit the intended leg —
  the third mutant is textually identical in the sibling success handler, so the patch was
  checked to remove exactly one line (`@@ -1619 +1618,0 @@`).
- **A test written, measured, and dropped.** A first draft pinned
  `reopenTransport`'s superseded-opening guard (1601-1603) from the *automatic recovery*
  caller. Measurement says the existing `reconnect CONNECTING` test already executes that
  body (statement counts 1/1/1 with only that test selected), so the new test would have
  been decoration over an already-covered leg; it was deleted rather than shipped, and the
  effort went to the rejection-handler leg instead, which no test reached.
- Verification: `pnpm check` green (37 files / 862 tests on the pre-rebase tree, 863 after
  rebase, `pnpm test:perf` 5 gates), `pnpm lint` clean, `pnpm test:coverage` green with the
  thresholds in `vitest.config.ts` (96/92/96/97) unmodified.
- Changed files: `src/core/data-bus.ts` (comment), `tests/data-bus.test.ts`,
  `docs/progress.md`.
- Risk / rollback: revert of one commit; no shipped-code change, no migration.
- Next: the adapter handoff E2E (task from the Phase 86 note) — `e2e/adapters.spec.ts:171`
  failed 3/3 attempts on two consecutive runners (main's push `35691812563` and PR #161's
  `35692895267`) and passed 8/8 locally under 4 workers and on #161's re-run. The test
  closes the owner and publishes *once* from a third tab, then waits 60s: publications are
  at-most-once, so one issued while the sender still routes to the dead worker is lost for
  good and no wait can recover it. Then back to the `data-bus.ts` ledger (18 entries left).
- Updated: 2026-09-22.

## Phase 88 / The adapter handoff E2E: one race made a precondition, and a name collision found while proving it

- Version: no release — `src/`, `dist/` and the published surface are untouched. Branch
  `fix/e2e-handoff-race`.
- **What the CI failure actually was.** `e2e/adapters.spec.ts` "keeps delivering after the tab
  that owned the topic closes" failed 3/3 attempts on two consecutive runs (main's push
  `35691812563`, PR #161's `35692895267`) with one signature: after `owner.close()`, the
  survivor's list stayed at `["{\"tag\":\"before-close\"}"]` for the entire 60s poll, while the
  React twin of the same test passed in ~1.2s *in the same job* and every `demo.spec` handoff
  case passed. #161's re-run passed unchanged. That bimodality — pass in a second, or never —
  is what at-most-once delivery predicts: the test closed the owner and published **once** from
  a third tab, so if that tab still addressed the departed worker the CONTROL frame had no
  receiver and no waiting could bring that publication back. The 60s ceiling was never the
  problem; the publish was unrescuable before the poll started.
- Fix: the sender's own cluster view becomes a precondition the test waits for instead of a race
  it must win. Both example pages already expose the bus (`examples/vue/main.js:56`,
  `examples/react/main.jsx:44`), so the test reads the worker ids *that tab* would relay to
  before the close, asserts it names exactly one, closes the owner, waits until none of them
  survives, checks the channel is held again, and only then publishes. A sender whose route never
  recovers still fails — that is the property under test — but it now fails on the precondition,
  naming the tab and the worker id, rather than on a delivery that was never going to arrive.
- **A second defect, found by trying to reproduce the first.** Running the spec with
  `--repeat-each=3 --workers=4` failed 2/6 — not on the handoff, but inside `openTab`, with
  `serverSubscribers(topic)` pinned at 2 for the full 30s. Topic names came from `Date.now()`
  alone, and `playwright.config.ts` runs `fullyParallel: true` off CI, so two concurrent
  instances of the same case derived the same name, shared one channel, and made a
  server-wide count of one impossible for two *correct* clusters. The "exactly one tab holds
  this topic" assertion was measuring two topics' worth of tabs.
- Fixed for both specs: `uniqueTopic()` in `e2e/topics.ts` mixes worker index, retry count, a
  per-process sequence counter and the timestamp, replacing all 29 name sites (4 adapter, 25
  demo). A/B on the exact command that failed: 6/6 then 16/16 passing at `--workers=4`.
- Not reproduced, and recorded as such: the original CI symptom did not appear locally under an
  injected load (`pnpm test:coverage` alongside `--workers=1`), where old and new code both
  passed 12/12. The mechanism argument and the failure signature carry the diagnosis; the
  precondition carries the fix, and it is the shape that is correct regardless of what the
  runner was doing.
- Changed files: `e2e/topics.ts` (new), `e2e/adapters.spec.ts`, `e2e/demo.spec.ts`,
  `docs/progress.md`. Three scratch probe specs used to characterize the states were run and
  deleted; none was committed.
- Verification: `pnpm typecheck` and `pnpm lint` clean; `pnpm test` 37 files / 861 tests;
  `pnpm test:e2e` 36 passed in 40.5s; `pnpm playwright test e2e/adapters.spec.ts
  --repeat-each=4 --workers=4` 16 passed.
- Risk / rollback: revert of one commit; test-only, no shipped-code or artifact change.
- Next: the `data-bus.ts` ledger (18 entries after Phase 87), then the standing dependency and
  security patrol.
- Updated: 2026-09-22.

## Phase 89 / A transport frame that already names its producer keeps that producer

- Version: no release — the `src/` change is a comment, so `dist/` is unaffected.
  Branch `test/ledger-origin-stamp`.
- Closed the `handleTransportMessage` ternary leg at `src/core/data-bus.ts:1250`: a frame
  arriving from the transport with `originTabId` already set is passed through unchanged, and
  only an unstamped one is stamped with this tab's id. `DataBusTransport` is a public extension
  point, so a proxying or replaying transport legitimately delivers someone else's publication;
  re-stamping it attributes that publication to the receiving tab, and both downstream consumers
  — the neighbour's `EVENT` fan-out and the replay history — inherit the misattribution. Nothing
  in the suite had ever produced that shape: `FakeTransport.emit()` built frames without the
  field, so the arm read zero across 863 tests.
- `FakeTransport.emit` gained an optional trailing `originTabId`, and the new test asserts it
  survives on *both* tabs, which is what makes the pin about the guarantee rather than about the
  branch: the local handler and the neighbour must agree on who produced it.
- Mutation-checked: collapsing the ternary to always-stamp fails with
  `AssertionError: expected 'tab-a' to be 'tab-remote'`, and `src/` was verified clean after.
- Ledger movement for `data-bus.ts`: **18 → 17** zero entries; suite branches
  96.31 → 96.36, statements 98.81, functions 99.08, lines 99.53.
- Changed files: `src/core/data-bus.ts` (comment), `tests/data-bus.test.ts`, `tests/fakes.ts`,
  `docs/progress.md`.
- Verification: `pnpm check` green (37 files, `pnpm test:perf` included), `pnpm lint` clean,
  `pnpm test:coverage` green against the unmodified floors; `tests/data-bus.test.ts` alone is
  179 tests.
- Risk / rollback: one commit; test-and-comment only, no shipped-code change.
- Next on this ledger: the ready-during-teardown leg (`ready()` with no operation in flight and
  no recorded error falls through to the generic rejection at 810), the never-invoked rejection
  swallows at 1583/1602, and `cluster.ts:397`.
- Updated: 2026-09-22.

## Phase 90 / `ready()`'s final rejection classified as unreachable-by-construction

- Version: no release — comment-only `src/` change; `pnpm build` and `pnpm typecheck` clean.
  Branch `docs/ledger-ready-fallthrough`.
- The last `return` of `ready()` (the generic "Transport is not ready and no start operation is
  in flight") had never executed. Rather than invent a scenario to score it, it is now classified
  with the enumeration that shows no state reaches it: it needs `started && !transportReady &&
  !suspended` with `startPromise` null **and** `lastError` null, and `transportReady = false` is
  written in exactly four places — `openTransport`'s entry (an opening owns the gate, returned one
  check earlier), its failure path (`recordError` runs before that gate is cleared, so the
  preceding line rejects with the real reason), `performStop`'s finally (which clears `started`
  too, so `ensureStarted` has already installed a fresh opening or thrown for want of an
  `initialConfig`), and `reopenTransport` (which assigns its opening synchronously first).
- Why it stays instead of becoming an assertion: it is the final return on a promise every caller
  awaits. A future path that cleared the ready flag without recording a failure or installing an
  opening would otherwise fall off the end and have `ready()` **resolve** on a dead transport —
  the one failure mode here that no caller could detect. Recorded in the source with the
  classification, per the standing convention that each zero-count leg says which kind it is
  (dominated / unreachable-by-construction / reachable-through-application-re-entry), because that
  is what decides whether deleting it is a cleanup or a regression.
- Ledger: the entry stays a zero count by design and is no longer open work. `data-bus.ts` had 17
  entries before this phase; the count is unchanged, one is now closed as classified rather than
  covered.
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm build` green.
- Risk / rollback: comment and progress log only; `git revert`, no artifact consequence.
- Next: `cluster.ts:397`, the never-invoked rejection swallows at `data-bus.ts` 1583/1602, then the
  remaining module legs (`replay-manager` 411, `replay-persistence` 49, `trace` 449,
  `centrifuge` 457/477, `centrifuge-session` 219, `websocket` 113/147/379, `version` 12).
- Updated: 2026-09-22.

## Phase 91 / The timerless channel close, and a hub seam that tells deferred from skipped

- Version: no release — `src/` is unchanged; this is a test plus a test-only seam.
  Branch `test/cluster-close-fallback`.
- Pinned the last uncovered line in `cluster.ts`: the `else` arm of the channel close at
  `stopTeardown()`'s tail. The normal path defers `channel.close()` by one task so a handoff's
  `ROUTE_RELEASED` can flush first; the fallback closes it immediately on a host with no
  `setTimeout`. Nothing in the suite ever ran the fallback, so the *only* path that guarantees the
  channel is released on such a host was untested — and a skipped close there is not a cosmetic
  leak: the hub keeps the channel in its registry and keeps routing frames to a torn-down session.
- New seam: `ChannelHub.liveChannelCount(name)` in `tests/fakes.ts`. A closed channel leaves the
  hub's set, so this is what lets a test distinguish "the close is deferred" from "the close never
  happens" — before it, the only observable was that frames stopped arriving, which a deferred
  close also produces one task later.
- Mutation-checked: replacing the fallback body with a no-op fails the new test with
  `AssertionError: expected 1 to be 0` (the channel still live after `stop()`); `src/` verified
  clean afterwards.
- Ledger, at line granularity: `cluster.ts` showed exactly one uncovered line (`397`) in every
  coverage run of this session and now shows none — its `Lines` moved 99.79% → **100%** and
  `Branches` 93.89% → 94.16%. Whole-suite: 98.84 / 96.42 / 99.08 / 99.57 over 37 files / 865
  tests.
- Not "closed", and the distinction matters for the next pass: at *arm* granularity `cluster.ts`
  still carries 19 zero-count branch arms — `?? this.currentRecord` owner-selection fallbacks,
  `...(x !== undefined ? { x } : {})` spreads, `typeof unknown.type === 'string'` guards. Those are
  a different tier of the ledger from an uncovered line, and they were never baselined here, so
  this phase records the line tier only. `data-bus.ts` stands at 17 zero entries on the same
  arm-level script (16 open plus the one classified in Phase 90).
- Changed files: `tests/cluster.test.ts`, `tests/fakes.ts`, `docs/progress.md`.
- Verification: `pnpm typecheck` clean, the new test green in isolation, full gates re-run before
  the PR.
- Risk / rollback: test-only; `git revert`, no artifact consequence.
- Next: the never-invoked rejection swallows at `data-bus.ts` 1583/1602 (classify or construct),
  then `replay-manager` 411, `replay-persistence` 49, `trace` 449, `centrifuge` 457/477,
  `centrifuge-session` 219, `websocket` 113/147/379, `version` 12.
- Updated: 2026-09-22.

## Phase 92 / Two `centrifuge.ts` arms are pinned through dist, which the src-only report cannot see

- Version: no release — comments and documentation only; `dist/` behaviour is untouched.
  Branch `docs/coverage-dist-blindspot-v2` — the first roll of this branch (`docs/coverage-dist-blindspot`)
  was left un-PR'd and went into conflict with `main` while it waited, exactly the append-only
  collision Phase 91's successor recorded: a phase entry inserted before `## Next candidates` meets
  another phase entry at the same spot. `gh pr update-branch --rebase` cannot help a branch with no
  PR, and resolving it in place would need a force-push, so the commit was cherry-picked onto current
  `main` and the two entries kept side by side.
- `src/centrifuge.ts`'s two `catch` arms (the `new URL('./centrifuge.worker.js', import.meta.url)`
  / SharedWorker twins) read zero in `pnpm test:coverage`, and both are **false positives of the
  report, not gaps in the suite**: `coverage.include` is `src/**`, while the only environment where
  that specifier genuinely fails is the CommonJS bundle, which the tests reach as
  `dist/cjs/centrifuge.cjs`. `tests/dual-format.test.ts:103` drives both halves — the actionable
  "default Centrifuge Worker URL is unavailable" message under CJS, a constructed `Worker` under
  ESM — so the leg is exercised and simply unattributable.
- Recorded where it will be found: at each site, with the test name, as "pinned through dist", and
  in `AGENTS.md`'s testing conventions so the next ledger pass checks for a dist-level driver before
  hunting a zero count — plus the second finding of this session's sweep, that an uncovered **line**
  and a line carrying zero-count **branch arms** are different claims (`cluster.ts` reached 100%
  lines and still holds 19 zero arms), so "module closed" has to name its tier.
- Changed files: `src/centrifuge.ts` (comments), `AGENTS.md`, `docs/progress.md`.
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm build` green; `tests/dual-format.test.ts`
  re-read to confirm it asserts the message rather than merely an error being thrown.
- Risk / rollback: comment/doc only; `git revert`.
- Next: the never-invoked rejection swallows at `data-bus.ts` 1583/1602, then the arm tiers of
  `replay-manager`, `replay-persistence`, `trace`, `websocket`, `centrifuge-session`, and
  `version.ts:12` (whose `typeof __SDK_VERSION__ === 'string'` guard is injected by every build).
- Updated: 2026-09-22.

## Phase 93 / 0.21.4 — the failure recorder could fail

- Version: **0.21.4** (patch, released). Branch `fix/failure-record-totality`.
- Opened as a ledger pass on the three never-invoked rejection swallows in
  `reopenTransport()`. Before touching them I re-read the premise those legs and
  `performStop()`'s comment rest on — "every non-null `pendingStop` chain ends in a
  terminal `.catch(error => this.reportError(error))`, therefore resolves" — and the
  last step is an assumption, not a fact: `.catch(handler)` produces a *rejected*
  promise when `handler` throws, and `recordError()` rendered the reason with
  `String(error)`. `String(Object.create(null))` throws
  `TypeError: Cannot convert object to primitive value`, and `DataBusTransport` is a
  public, application-implemented port that may reject with any value. So the leg I
  went in to classify was reachable, and reachable through two released versions'
  deletions of the absorbers that would have hidden it.
- Shipped consequence, not just a smell: after an open fails and its cleanup
  `stop()` *also* fails with such a value, `pendingStop` rejects, `start()`'s chained
  `.then()` is skipped, `transport.start()` is never reached, and the retry surfaces
  `TypeError: Cannot convert object to primitive value` — a message about the
  formatter's limits instead of about the caller's transport. Reproduced first, red,
  with the stack landing on `recordError` ← `reportError` ← `createStopPromise`.
- Fix: `describeFailure()` in `src/utils/error-utils.ts` (the module whose existing
  `serializeError()` already sidesteps this), total over the `Error` branch as well as
  the coercion, so a throwing `message` getter is covered too. Wired into both
  `recordError()` and `getRecoveryStats()` — the second was the worse one, because
  `getHealthSummary()` calls it, so the outage-explaining probe threw during an
  outage. Same shape fixed one layer out in `assertPositiveSafeInteger()`,
  `assertPruneStrategy()` (where the coercion *is* the membership test) and
  `assertHeartbeatInterval()`.
- Tests: 6 new. Two in `data-bus.test.ts` (reporter/renderer totality; the
  double-failed-open retry actually reopening), three in `error-utils.test.ts`
  (coercion shapes, the unstringifiable case, the throwing-`message`-getter case),
  one in `centrifuge.test.ts` (the heartbeat validator's message). New seam
  `FakeTransport.stopRejection`, because `stopShouldFail` can only fail with a real
  `Error` and the *reason* is the thing under test here.
- Why `toThrow(TypeError)` was never going to catch this: the formatter's error is
  also a `TypeError`. The new validator assertion checks the message text, and the
  `error-utils` test asserts `String(...)` itself throws for the same input to prove
  the case is the one that breaks a bare type assertion. Recorded in `AGENTS.md`.
- Mutation-checked, four mutants, all killed: dropping `describeFailure`'s guard kills
  3 tests; reverting only the `getRecoveryStats()` call site kills exactly the
  totality test (so the read side is independently load-bearing, not carried by the
  write side); reverting only `recordError()` kills 2 including the reopen test (the
  premise's own leg); reverting all three validator sites kills both validator tests.
  `src/` verified clean after each; `git diff --stat` inspected because two of these
  are `/g`-style multi-site edits.
- Ledger, at the tier it belongs to: `src/utils/error-utils.ts` is now clear at
  **both** tiers — 0 uncovered lines, 0 uncovered branch arms, 0 uncovered functions.
  `src/core/data-bus.ts` still shows 17 uncovered branch arms after this change, and
  that is expected rather than a miss: the two coercions it lost were ternaries whose
  arms were both already taken, so the fix moved statements and functions, not arms.
  Whole suite 98.85 / 96.41 / 99.08 / 99.57 over 37 files / 871 tests, against
  unchanged ceilings (96 / 92 / 96 / 97).
- Changed files: `src/utils/error-utils.ts`, `src/core/data-bus.ts`,
  `src/utils/validation.ts`, `tests/error-utils.test.ts`, `tests/data-bus.test.ts`,
  `tests/centrifuge.test.ts`, `tests/fakes.ts`, `AGENTS.md`, `CHANGELOG.md`,
  `docs/roadmap.md`, `docs/zh/roadmap.md`, `docs/progress.md`, `package.json`.
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (871),
  `pnpm test:perf` (5 gates), `pnpm test:coverage` green; `pnpm verify:pack` and
  `pnpm verify:compat` against the previous tag; browser E2E in CI.
- Risk / rollback: the only behavior change is the *text* of a failure message for
  values that previously threw (`[unstringifiable object]`), plus validators that now
  report the option instead of throwing. No export, protocol or storage change.
  `git revert` the release commit and drop the tag.
- Next: back to the three `reopenTransport()`/`performStop()` absorbers this pass
  started on — with `reportError` now total, `pending.catch(() => undefined)` at the
  top of `reopenTransport` has a genuine domination proof, so it is either deletable
  on the same method as 0.21.2/0.21.3 or owed a pin; then the arm tiers of
  `replay-manager`, `replay-persistence`, `trace`, `websocket`, `centrifuge-session`,
  and `version.ts:12`.
- Updated: 2026-09-22.

## Phase 94 / The fuse that could not fire, and a clock pinned in only one direction

- Version: no release — harness and documentation only; `src/` is untouched.
  Branch `fix/fuzz-fuse-not-gated`.
- Opened as an investigation, not a plan: `main`'s CI `verify` went red
  (`coordination-invariants`, 1,046/5,000 seeds after 509s, failing with a bare
  `Test timed out in 120000ms` and **no invariant violation anywhere in the log**), and
  the same signature had just burned PR #170 twice (its original run and a re-run). That
  PR was then exonerated by
  evidence rather than by assumption: `main` at 0.21.4 fails identically and does not
  contain #170's change.
- Two independent defects, both in the harness, both reachable from the log:
  1. **The fuse was gated on the depth floor.** `if (completed >= MIN_SEEDS && elapsed
     > BUDGET) break` cannot fire on a runner too slow to clear 100 seeds inside the
     budget — which is precisely the situation the budget exists for, so the sweep ran as
     long as the host was slow. Demonstrated by setting `SEED_BUDGET_MS = 0`: the gated
     form still ran 100 seeds and **passed**; the unconditional form stops at once and
     fails with `explored only 0 seeds`. The floor is preserved as an assertion, so a slow
     runner still cannot pass on a handful of interleavings — it now says so in ~60s
     instead of ~8 minutes.
  2. **The budget clock had one source whose immunity was contextual.** `realNowMs()`
     trusted `node:perf_hooks`, which survives fake timers only because the global binding
     and that export are different objects in some contexts — a worker thread makes them
     the same object, so a `toFake` list containing `performance` freezes the budget at 0
     elapsed. Measured by blocking 250ms of real time inside a fake window with
     `Atomics.wait`: `node:perf_hooks` 260, `process.uptime()` 260, global
     `performance.now()` 0, `Date.now()` 0, `process.hrtime.bigint()` 0. Now the max of
     the two immune sources.
- The pin that was supposed to guarantee #2 asserted only the harmless direction: "60
  simulated seconds must not cost 60 measured ones" passes trivially when the clock is
  frozen. It now also requires real blocked time inside a window to still measure as
  having passed. Verified against a constant-returning mutant — **passes** the original
  assertion, fails only the new one, which is the proof that the old pin was vacuous
  exactly where it mattered.
- Also records the slowest seed beside the truncation depth. A fuse sampled between
  iterations cannot bound an iteration, and a seed wedged on an `await` that needs a timer
  the fake clock never advances was previously visible only as an unexplained total.
- **What is deliberately NOT claimed:** none of this establishes why that runner spends
  ~460ms per seed where every local run — including one under twelve competing busy
  loops — spends under 2ms, and the identical 1,046 across runs says deterministic while
  a single-seed local run of seed 1046 finished in 153ms. The change makes the fuse able
  to fire and the depth reached legible; the root cause stays open, and CI on this branch
  is the experiment that decides whether the bounded behaviour is what was needed.
- Result of that experiment, recorded honestly as **inconclusive**: this branch's `verify`
  passed, but the sweep completed all 5,000 seeds and printed no truncation line — the
  runner was fast, so the repaired fuse was never exercised. The pass shows no regression,
  not a fix in action. What the fix *is* proven by is the local control: at budget 0 the
  gated form passes on 100 seeds and the unconditional form stops at once, and a
  constant-returning clock fails only the new freeze assertion. Under the original starved
  conditions the repaired clock+pair should now break at ~60s having explored ~130 seeds
  — above the 100 floor, so bounded *and* green — but that combination has not been
  observed yet, and a future starved run is the real test of it.
- Followed up with the missing half locally: with the budget dropped to 250ms under six
  competing busy loops, the fuse fired — `stopped at 3/5000 seeds after 349ms (slowest
  seed 258ms)` — and the test failed loudly on `explored only 3 seeds`. That is the designed
  behaviour end to end (bounded, attributed, and loud), and note it is the *pass* condition
  that differs from CI: under that load each seed cost ~116ms against ~1.8ms unloaded, so
  250ms bought only 3 seeds, whereas CI's 60s buys ~130 and clears the floor. The load
  sensitivity is also the first local hint of the mechanism behind CI's 460ms seeds, so the
  root cause is narrower than before but still not closed.
- Next: #170 rebased onto this (its Phase entry became 95) and re-run on the fixed harness;
  then the deferred `data-bus.ts` arm work — `queuedStart`/`getQueuedStartReady` (529/553),
  `switch#3` default (334), and the `stopPromise ?? Promise.resolve()` fallbacks (451/558).
  One of those has since been pinned on a branch still awaiting its own PR: the 451 fallback
  is reachable through a trace sink that re-enters `start()`, so it is a live arm rather
  than decoration.
- Two process notes, both self-inflicted and worth keeping: the first draft of the clock
  pin busy-waited on `Date.now()`, which is frozen inside the window, so it never
  terminated and hung the run — hence `blockRealTimeMs()`; and a `git checkout
  tests/fakes.ts` on a tree with uncommitted edits to that same file discarded them, so
  restoration here was done from a `cp` copy.
- Changed files: `tests/fakes.ts`, `tests/coordination-invariants.test.ts`,
  `tests/lifecycle-invariants.test.ts`, `AGENTS.md`, `CHANGELOG.md`, `docs/progress.md`.
- Verification: `pnpm typecheck`, `pnpm lint`, `npx vitest run` (37 files / 871 tests),
  `pnpm test:perf` (5 gates), fuzzer re-run under load, both mutants above.
- Risk / rollback: harness-only; `git revert` either commit independently.
- Next: watch this branch's CI as the experiment; then re-run #170 on top of the fixed
  fuse and merge it (its Phase entry needs renumbering to keep the log ordered).
- Updated: 2026-09-22.

## Phase 95 / Three verdicts that all look like "uncovered": dominated, only-handler, and running-but-redundant

- Version: no release — recorded under `## [Unreleased]`, deliberately not cut, per the cadence
  rule that a single cleanup does not earn a version. Branch `refactor/dominated-reopen-absorbers`,
  based on `7b2c322` (0.21.4) and rebased onto `5b6c688` (#171) after that landed; the rebase
  collided with Phase 94 only at the `## Next candidates` append anchor, in `CHANGELOG.md` and
  here, and both sides were kept (this entry renumbered 94 → 95, since it landed second).
- This is the pass Phase 93 deferred: the never-invoked rejection swallows in `reopenTransport()`.
  Finished with one handler deleted and the other two re-labelled, because they turned out to be
  three different kinds of leg.
- Deleted: the trailing `void opening.catch(() => undefined)` after `opening.then(f, g)`. The proof
  is Promise semantics, not an assignment enumeration — passing `onRejected` to `.then` registers
  *that* as a handler of `opening`, so `opening` can never be an unhandled rejection on that path,
  whatever it rejects with. Chosen over an enumeration-style argument deliberately: 0.21.2/0.21.3
  deleted two legs on enumeration proofs and 0.21.4 then found the enumeration's last step
  (".catch(handler) resolves") was false whenever `handler` throws, so a proof that never mentions a
  handler is the sturdier one here.
- Kept, and now labelled as the guard it is: the early-return arm's `void opening.catch(...)`. That
  arm returns before any `.then(f, g)` is installed and `resumeTransport()` calls with `void`, so
  this swallow is the only handler the opening ever receives on that path. Uncovered, load-bearing,
  not a gap.
- Kept, dominated, with the cost of deletion measured: the `pending.catch(() => undefined)` at the
  top of the method. `pending` provably resolves (the `startPromise !== this.pendingStop` guard above
  returned for every other in-flight opening; `pendingStop`'s two sites now genuinely end in a
  resolving `.catch(reportError)`, which is what 0.21.4 bought). Measured both ways: forcing `pending`
  to reject fails exactly one test — "reopens after repeated hide/show cycles that all precede a
  pending initial open" — *with and without* the guard, so no assertion protects the premise. Deletion
  is still refused on the shape of the failure: with the absorb a superseded resume reopens anyway,
  without it the skipped `.then()` leaves the bus silently closed after a pageshow. "Degraded" versus
  "stuck" is the tie-breaker, and the measurement is written into the comment so the next reader does
  not re-run it.
- A claim corrected before it shipped, because it would have been the easy kind of wrong: this change
  moves **no** coverage number. The deleted handler was not among `data-bus.ts`'s three uncovered
  functions — its callback executed in existing tests, which is exactly why it read as covered. The
  module stays at 3 uncovered functions and 17 uncovered branch arms; what was removed was a handler
  that ran and could not matter. `AGENTS.md` now separates the three verdicts (dominated /
  only-handler / executing-but-redundant) so "uncovered" stops standing in for all of them.
- Also fixed: `reopenTransport()`'s `activeConfig` guard still pointed at `performStop()`'s absorber
  as its contrast, and that absorber was deleted in 0.21.2 — a cross-reference to code that no longer
  exists. It now contrasts with the live absorb eleven lines below, which is the comparison that
  actually illustrates the difference.
- Changed files: `src/core/data-bus.ts`, `AGENTS.md`, `CHANGELOG.md`, `docs/progress.md`.
- Verification: `pnpm typecheck` clean, `pnpm lint` clean, full suite green after the deletion
  (37 files / 871 tests, no unhandled rejection reported by Vitest), `pnpm test:coverage` re-measured
  to confirm the tier claim rather than assume it.
- Risk / rollback: one redundant handler removed, two comments rewritten; `git revert`, no artifact
  consequence. The deletion's safety rests on `.then(f, g)` keeping its `onRejected` — flagged in the
  comment so a future edit that drops `g` knows to reinstate the swallow.
- Next: `data-bus.ts`'s remaining zero arms are now all classified or owed a construction — the
  `queuedStart`/`getQueuedStartReady` pair (529/553), `switch#3` default (334), and the
  `stopPromise ?? Promise.resolve()` fallbacks (451/557), which are the same "dominated by an
  enumeration" shape and should be argued with the Promise-semantics style where possible. Then the
  arm tiers of `replay-manager`, `replay-persistence`, `trace`, `websocket`, `centrifuge-session`,
  `version.ts:12`.
- Updated: 2026-09-22.

## Phase 96 / A live arm that only a re-entered `start()` exposes, and the shape it protects

- Version: no release — recorded under `## [Unreleased]`. Branch
  `test/resume-superseded-return-arm`, based on `7b2c322` (0.21.4) and rebased onto `7ed304a`
  (#172) after that landed; the rebase was clean in the source and only the two append anchors
  (`CHANGELOG.md`, here) needed the usual both-sides-kept handling.
- The first of Phase 95's owed arms. `start()`'s superseded-resume guard returns
  `this.stopPromise ?? Promise.resolve()`, and the right operand had never executed in a test:
  reaching that line needs `resumeSuspendedResources()` to return false, and the two ways it can
  return false assign `stopPromise` differently. A re-entered `stop()` sets it (the sink of the
  RESUME trace event calls `stop()` — that leg was already covered); a re-entered `start()` bumps
  the lifecycle epoch with no stop in flight at all, leaving `stopPromise` null. So the fallback
  was not decoration, it was an untested live arm.
- Construction: a RESUME sink that calls `bus.start({})` once, nested inside a resume from
  suspension, then asserts the *outer* `start()` still returns a promise, that the nested open is
  the only transport open, and that the resume sink is entered twice. Everything but the return
  shape holds either way, which is the point — the assertion that carries the pin is
  `expect(outer).toBeInstanceOf(Promise)`.
- Teeth verified by mutation, not by reasoning: `return this.stopPromise!` fails exactly that
  assertion with `expected null to be an instance of Promise`. The mutant is interesting because it
  breaks no state invariant at all — it hands a caller a `null` where `start()` promises
  `Promise<void>`, so the failure surfaces as `TypeError: Cannot read properties of null (reading
  'then')` in application code. A guard whose deletion is only visible in the caller's stack.
- The number is re-measured rather than inherited: `data-bus.ts` goes 17 → 16 uncovered branch
  arms, whole-suite 98.84 / 96.46 / 99.08 / 99.57 over 37 files / 872 tests against unchanged
  ceilings of 96 / 92 / 96 / 97. Inheriting Phase 95's "17" would have been wrong in principle even
  though it happens to be the right baseline, because #172 edited the same file in between; the
  counter reads `coverage-final.json`'s per-arm counts directly, so it also names the line
  (457, `[2,1]`) instead of just the total. Note line 564 is the *other*
  `?? Promise.resolve()` in the same file and is still `[86,0]` — same spelling, different arm,
  which is why the grep for this pattern returns two hits and only one of them closed.
- Changed files: `src/core/data-bus.ts` (comment only), `tests/data-bus.test.ts`, `CHANGELOG.md`,
  `docs/progress.md`.
- Verification: `pnpm typecheck` clean, `pnpm test:coverage` green as above, mutation checked.
- Risk / rollback: no behaviour change — a test plus a comment that names the re-entry it pins.
  `git revert`, no artifact consequence.
- Next: `data-bus.ts`'s remaining 16 arms. `564`'s right operand (`queuedStart`'s gate) and the
  `509/535/559` if-arms come next, then `switch` default (324), then the arm tiers of
  `replay-manager`, `replay-persistence`, `trace`, `websocket`, `centrifuge-session`, `version.ts:12`.
- Updated: 2026-09-22.

## Phase 97 / A comment said "never rejects"; the arm it dismissed is the only thing that settles `stop()`

- Version: no release — recorded under `## [Unreleased]`. Branch
  `test/teardown-gate-rejection-arm`, based directly on `f88de7c` (#173) after that merged, so no
  rebase was needed this time; the previous phase's two commits dropped out of the rebase as
  "patch contents already upstream", which is the squash-merge workflow behaving.
- Phase 96's next item was `data-bus.ts`'s remaining 16 arms. The one that turned out to matter was
  not an arm at all but the *prose* that had made it look harmless: `createStopPromise()` chained
  `performStop()` to the public gate with `.then(f, g)` and commented that `performStop()` "never
  rejects, so the gate resolves in both branches". Both branches resolving is exactly why the
  rejection arm looked like filler, and the arm had never executed — its two branches were among the
  17 uncovered legs this ledger started from.
- The claim is false, and the chain that breaks it is four links long: `performStop()`'s `catch` calls
  `reportError()` → `notifyError()` → `invokeHandlers(errorHandlers, …, ERROR_HANDLER)`, which absorbs
  a throwing error subscriber *only* by writing to `console.warn`. A subscriber that throws and a
  `console.warn` that throws therefore escape the `catch`, and the async function rejects after its
  `finally` has already completed the teardown. Nothing else can then wake a caller of
  `await bus.stop()` — the transport shutdown is finished, `stopping` is already false — so
  `resolveGate()` in that arm is the only thing that settles the public contract. The construction is
  the test; the assertion is that the stop settles at all.
- Failure mode chosen deliberately: a never-settling promise has no end-state assertion. The test
  races the stop against a 250ms real-timer watchdog and asserts the verdict string, so deleting
  `resolveGate()` from the arm fails as `expected 'hung' to be 'settled'` in a quarter of a second
  instead of as a Vitest timeout that names nothing. Checked by mutation (`// MUTANT-a`), and the
  mutant diff was read back before running to confirm the intended arm was the one edited — the two
  arms are textually identical, which is the duplicated-guard trap `AGENTS.md` already warns about.
- The same mutation run split the arm's two statements, which is the part worth keeping: deleting the
  co-located `if (this.stopPromise === stopGate) this.stopPromise = null;` leaves all 184 tests in
  `tests/data-bus.test.ts` passing. So one statement is a contract and its neighbour is defensive —
  for the reason `stop()`'s own comment gives (`stopping` is authoritative, a settled gate is stale and
  must fall through to a fresh teardown). The source comment now says which is which, and says it was
  measured.
- Numbers, re-measured rather than inherited: `data-bus.ts` 16 → 15 uncovered branch arms and — the
  first movement at that tier in this ledger — 3 → 2 uncovered functions, because what closed is a
  handler function that had never been entered. Module 97.9 / 96.32 / 97.43 / 98.86 → 98.38 / 96.55 /
  98.29 / 99.24; whole-suite 98.94 / 96.52 / 99.26 / 99.65 over 37 files / 873 tests against
  unchanged ceilings. The leftover at line 1198 is now the *fall-through* arm: a teardown whose gate
  had already been replaced by a newer stop.
- Also done while waiting on CI: the branch audit `AGENTS.md` requires before starting new work. No
  open PRs and no remote topic branches existed; nine local branches (`docs/coverage-dist-blindspot`,
  `…-v2`, `docs/ledger-ready-fallthrough`, `fix/e2e-handoff-race`, `fix/failure-record-totality`,
  `fix/fuzz-budget-clock`, `scratch/rebase-preview`, `test/data-bus-reopen-arms`,
  `test/ledger-origin-stamp`) were each matched to the landed squash commit carrying their subject and
  PR number, so all nine were removed. Their tip SHAs are in `/tmp/stale-branch-tips.txt` and in the
  reflog; `git branch` is now `main` plus the branch in flight.
- Changed files: `src/core/data-bus.ts` (comment), `tests/data-bus.test.ts`, `AGENTS.md`,
  `CHANGELOG.md`, `docs/progress.md`.
- Verification: `pnpm typecheck` clean, `pnpm lint` clean, targeted run green, mutation checks as
  above, `pnpm test:coverage` re-measured for the tier claims.
- Risk / rollback: no behaviour change; one test and one comment. `git revert`, no artifact
  consequence. If a future change makes `performStop()` genuinely total again, this arm goes back to
  being defensive — the comment names the chain to re-check rather than asserting impossibility.
- Next: 15 arms left in `data-bus.ts`. Four are already classified in prose and should not be hunted
  (820's fall-through, 1617's guard, and the dominated-by-call-site pair 535/559); `564`'s right
  operand needs `stopping` true with `stopPromise` null, which the assignment enumeration says is
  reachable only through a re-entrant `start()` inside `cluster.stop()`. Constructible and worth a
  test: `509`'s loop break, `631`'s demand-recovery bail-out, the suspend-mid-open family
  (`694`, `723`, `747`), `1368`'s second exhaustion, `1513`'s missing-console leg, `1693`, and
  `324`'s switch default. Then the other modules' arm tiers.
- Updated: 2026-09-22.

## Phase 98 / Two conditions in `openTransport()` that the lifecycle epoch already decided

- Version: no release — recorded under `## [Unreleased]`. Branch `test/suspend-mid-open-arms`, off
  `024879a` (#174); the rebase collided with Phase 97 at the `### Changed` append anchor of
  `CHANGELOG.md` — the collision this file's append-at-`## Next candidates` convention predicts — and
  both bullets were kept, this one first.
- Phase 97's "next" list split the remaining 15 arms into classified, constructible, and
  enumeration-needed. This pass took the two that a *comment* claimed were reachable: `openTransport()`'s
  `if (this.pendingStop === chainedPendingStop) this.pendingStop = null;`, whose comment said "a stop
  created concurrently (e.g. by `suspendTransport()`) is a different promise and must stay visible",
  and the `if (!this.suspended && !this.stopping) { … }` ready-flag guard below it, which had no
  explanation at all. Both claims describe states that this continuation cannot observe.
- The proof is one enumeration plus one invariant. `pendingStop` is written in four places (this line,
  the failed-open cleanup, `performStop()`'s finally, `suspendTransport()`'s chained stop); of those,
  the three that could change it mid-flight each run behind a `lifecycleEpoch` increment —
  `beginStop()` bumps before `stopping = true`, `suspendTransport()` bumps before `suspended = true`,
  and the failed-open write belongs to this same promise chain, strictly after the continuation being
  guarded. Epochs only increase, so an opening that is *still current* at that point has seen none of
  them. Same reasoning kills the second guard's false arm.
- So neither check is a coverage gap, and neither was deleted: the failure modes are asymmetric, which
  is the test Phase 95 established for keeping a dominated leg. Making the clear unconditional depends
  on the invariant holding forever, and the first future transition that suspends without superseding
  would then drop a live `pendingStop` and let `stop()` issue a second `transport.stop()`; dropping the
  ready-guard would mark a hidden transport ready. Each comment now carries the enumeration, so the
  next reader can check the premise instead of re-deriving it — and can see that the guards are there
  for the day the premise breaks.
- Zero coverage movement, measured rather than assumed: `data-bus.ts` stays at 15 uncovered branch arms
  and 2 uncovered functions, 37 files / 873 tests green, `pnpm typecheck` and `pnpm lint` clean. This
  is the third consecutive pass whose justification is a proof rather than a number, which is worth
  stating precisely because a comment-only change is the easiest kind to sell as progress.
- Changed files: `src/core/data-bus.ts` (comments), `CHANGELOG.md`, `docs/progress.md`.
- Risk / rollback: no behaviour change; `git revert`, no artifact consequence.
- Next: the constructible list. Line numbers in this file's *earlier* entries drift with every comment
  edit — this pass moved two of them by 13 lines each — so the ledger below is written against a fresh
  read of `coverage/coverage-final.json`, which is the only authoritative source for the current
  positions. Cheapest real gaps first: the missing-`console.warn` leg (now 1537, the error-handler
  isolation path with nowhere to log) and the second exhaustion (now 1392, the exhausted-trace event
  firing twice), then `startDemandRecovery()`'s bail-out (631), the re-subscribe loop's break (509),
  the failed-open reuse of an existing `pendingStop` (771), `reopenTransport()`'s gate clear (1717),
  and the `onControl` switch default (324). `564`'s right operand needs `stopping` true with
  `stopPromise` null, which the same epoch argument says arrives only through a re-entrant `start()`
  inside `cluster.stop()`; `535`/`559` are dominated by their single guarded call sites and want the
  enumeration, not a test.
- Updated: 2026-09-22.

## Phase 99 / The isolation leg that has nowhere to log — and the vacuity theory that measurement killed

- Version: no release — recorded under `## [Unreleased]`. Branch `test/reporting-fallback-arms`, off
  `024879a` (#174). Two parallel branches were open against `data-bus.ts` at once; the other one
  (`test/suspend-mid-open-arms`, Phase 98) merged first as #175, and rebasing this branch onto it
  collided at both append anchors — the `### Coverage` list and `## Next candidates` — exactly as the
  convention predicts. Both sides were kept in each file, this phase's entry going second.
- Pinned: the second conjunct of `invokeHandlers()`' logging guard. A throwing error subscriber is
  contained by `console.warn`; with a console that has no `warn`, an unguarded call raises
  `TypeError: console.warn is not a function` from inside the containment itself — through
  `reportError()`, out of the dispatch loop, into the transport's message callback. The new test
  stubs such a console, asserts a publication dispatch does not throw, and asserts the dispatch
  failure still lands in the ledger with its own message rather than the formatter's. Mutation
  (dropping the conjunct) fails it as
  `expected [Function] to not throw an error but 'TypeError: console.warn is not a func…' was thrown`.
- `data-bus.ts` 15 uncovered branch arms → 14; functions stay at 2; whole-suite branch 96.52 → 96.57
  with statements/functions/lines unchanged, 37 files / 874 tests.
- The phase's other target failed, and that is the more instructive half. The hypothesis was that
  `caps automatic recovery attempts` reaches its "still exactly one `exhausted` event" assertion
  vacuously, because its environment clock is a constant and so the recovery cooldown must swallow
  every attempt after the first. Acting on it, I rewrote the test to advance the clock — with a
  comment asserting the old one had driven a single scheduled attempt. Then measured it, against a
  scratch copy of the *unmodified* test: frozen clock, `attempt: 3`, `startCalls: 3`, one `exhausted`
  event. The old test does what it looks like it does; the comment I had written for it was false, and
  so was the premise for the change. The rewrite went back out (the file was rebuilt from `HEAD` plus
  the new test, rather than by checking paths out under a dirty tree) and `AGENTS.md` gained the rule:
  measure a vacuity theory against the unmodified test before rewriting on account of it, because the
  rewrite carries a comment the next reader will trust.
- What remains true and recorded: the one-shot `if (!this.recoveryExhausted)` guard's false arm has no
  construction yet. A fourth `setStatus('error')` does not advance the attempt counter at all, and
  making the guard unconditional emits no second event, so nothing currently depends on that leg in
  either direction. Kept as an open item, not relabelled "dominated" to close it.
- Changed files: `tests/data-bus.test.ts`, `AGENTS.md`, `CHANGELOG.md`, `docs/progress.md`. No source
  change this time.
- Verification: `pnpm typecheck` and `pnpm lint` clean, `npx vitest run tests/data-bus.test.ts` 185
  passed, `pnpm test:coverage` re-measured for the tier numbers, mutation checked both ways.
- Risk / rollback: test and docs only; `git revert`, no artifact consequence.
- Next: 14 arms. The remaining constructible candidates from Phase 98's ledger, in the order that
  ledger lists them (demand-recovery bail-out, re-subscribe loop break, failed-open reuse of an
  existing `pendingStop`, `reopenTransport()`'s gate clear, the `onControl` switch default), plus the
  enumerations for `535`/`559`. Phase 98's epoch-invariant classification is already on `main` (#175).
- Updated: 2026-09-22.

## Phase 100 / A fuse that cannot report the failure it was built for

- Version: no release — recorded under `## [Unreleased]`. Branch `test/fuzz-progress-logging`, off
  `7456c78` (#175).
- Trigger: `verify` on #177 (the no-console pin, Phase 99's work rebased onto #175) failed with
  `Error: Test timed out in 120000ms` in `tests/coordination-invariants.test.ts`, with the job's suite
  duration at 331s against ~52s locally. The branch contains no source change and no harness change;
  the identical content passed `verify` 13 minutes earlier as #176, so the failure is runner load, not
  diff. It is still a hole worth closing, because of what the log *could not* say.
- The hole: Phase 94's truncation diagnostics (`stopped at N/5000 seeds after Xms (slowest seed Yms)`)
  sit after the loop. A test killed by the ceiling never reaches them, so the one event they were
  written to explain is precisely the event where they are absent, and the log distinguishes nothing —
  "a runner this slow needs a smaller budget" and "one seed wedged on an `await` that needs a timer the
  fake clock never advances" both print as a bare timeout, and they want opposite fixes.
- Change: both seeded fuzzers now print `starting seed N at <elapsed>ms (depth D)` for the first five
  seeds and every fiftieth thereafter. Sampled from a full local run: the sequence advances, so the
  heartbeat is proof of progress and its absence is proof of a wedge. Cost is one string every 50
  iterations; `AGENTS.md` gains the rule.
- Deferred deliberately: lowering `SEED_BUDGET_MS` or raising the per-test ceiling. Neither is
  justified yet, because the two candidate causes need different responses and the current data cannot
  tell them apart — which is the thing this change settles for the *next* occurrence rather than
  guessing at this one.
- Changed files: `tests/coordination-invariants.test.ts`, `tests/lifecycle-invariants.test.ts`,
  `AGENTS.md`, `CHANGELOG.md`, `docs/progress.md`.
- Verification: `pnpm typecheck` and `pnpm lint` clean, full suite 37 files / 873 tests green, both
  harnesses observed emitting the new lines.
- Risk / rollback: diagnostics only; `git revert`.
- Next: #177 needs a re-run of its failed `verify` job — the rerun request itself died on the same
  degraded GitHub API path (`unexpected EOF`) three times, so retry when connectivity recovers, then
  squash-merge it before this branch lands (both touch `AGENTS.md`/`CHANGELOG.md`/`docs/progress.md`).
- Updated: 2026-09-22.

## Phase 101 / Two queued-start guards that their own callers had already answered

- Version: no release — `## [Unreleased]`. Branch `test/queued-start-guard-enumerations`, rebased
  onto `1c24c49` (#177 + #178) before measurement.
- Closes the ledger's "want the enumeration, not a test" items. `getQueuedStartReady()`'s
  `if (!queued) return Promise.reject('No queued start is in flight.')` and
  `queueStartAfterStop()`'s `if (this.queuedStart) return this.queuedStart;` are each preceded, by
  their only caller, by the *same* test on the same field, synchronously and with no user code in
  between: `ready()` guards `if (this.queuedStart)` before calling the first, and `start()` returns
  `this.queuedStart` one statement before calling the second. Neither arm can be taken.
- Both kept, on the asymmetry rule rather than on inertia: deleting the first swaps a documented
  rejection for `TypeError: Cannot read properties of null` the moment a second caller appears, and
  deleting the second breaks "exactly one queued restart per stop", which is the behaviour the line
  is a statement of. Comments now name the call site that dominates each, so a future caller is
  written against the enumeration instead of rediscovering it.
- Measured, not asserted: `data-bus.ts` holds at 14 uncovered branch arms / 2 uncovered functions and
  the suite at 37 files / 874 tests, identical to `main`. Comments only.
- Changed files: `src/core/data-bus.ts`, `CHANGELOG.md`, `docs/progress.md`.
- Verification: `pnpm typecheck`, `pnpm lint`, `npx vitest run --coverage` all clean.
- Risk / rollback: none behavioural; `git revert`.
- Next: 14 arms, of which the remaining honest targets are the demand-recovery bail-out under
  suspension (needs a failed automatic reopen, then a hide, then an operation — the contract being
  that hiding does not burn the one-shot demand token), the re-subscribe loop's break, the failed-open
  reuse of an existing `pendingStop`, `reopenTransport()`'s rejection-arm gate clear, and the
  `onControl` switch default. Then the other modules' arm tiers.
- Updated: 2026-09-22.

## Phase 102 / The cluster's unknown-verb arm was not defensive — it was load-bearing

- Version: no release — `## [Unreleased]`. Branch `test/unknown-control-action`, off `cc4d46e` (#179).
- Phase 101's ledger listed the `onControl` switch's `default:` as "constructible, maybe". Reading the
  receiving side first turned it from a defensive leg into a real one: the cluster's channel is an
  unauthenticated `BroadcastChannel`, and `handleControlMessage` validates the *target*
  (`message.targetWorkerId !== this.workerId` returns) but not the *action* — its own `switch` ends in
  a `default: break` that falls through to `this.handlers.onControl(message.action, …)`, and then runs
  `updateLoad()` because the verb is not `PUBLISH`. So the DataBus handler's `default: break` is the
  only place a frame saying `DESTROY` can be refused.
- Test: one bus on a shared `ChannelHub`, forge a `CONTROL` frame for its own `workerId` (read back from
  `getClusterSnapshot().workers`, not guessed) with an action outside the union, flush, and assert the
  publication handler never ran, the transport's subscribe/unsubscribe/publish call logs are unchanged,
  and the bus still reports `healthy: true`.
- Teeth by mutation, because an assertion of *inaction* is easy to write vacuously: replacing the
  handler's `default: break` with `default: this.unsubscribeTransport(topic)` fails the new test as
  `expected [ 'topic' ] to deeply equal []`. The source was restored from a copy rather than by
  checking out a dirty path.
- Ledger: `data-bus.ts` 14 → 13 uncovered branch arms, suite 37 files / 875 tests, `pnpm typecheck`
  clean after one `noUncheckedIndexedAccess` fix on `workers[0]` (the first version of the test did not
  compile — caught by the gate, not by the run).
- Changed files: `tests/data-bus.test.ts`, `CHANGELOG.md`, `docs/progress.md`. No source change.
- Verification: `pnpm typecheck`, `pnpm lint`, `npx vitest run --coverage` all clean; mutation checked.
- Risk / rollback: test and docs only; `git revert`.
- Next: 13 arms. Remaining constructible: `startDemandRecovery()`'s bail-out under suspension, the
  re-subscribe loop's break, the failed-open reuse of an existing `pendingStop`, the recovery timer's
  productive path (worth re-deriving which arm that is before hunting it), and
  `reopenTransport()`'s rejection-arm gate clear. Also worth a look: whether *other* fields of a
  received frame are trusted the way `action` is — this pass found the target checked and the verb not,
  and the same question applies to `topicKey` versus `topic`.
- Updated: 2026-09-22.

## Phase 103 / A forged control frame could rename the channel an owner subscribes

- Version: behaviour change, so the next patch release is now owed (see
  `project-release-held-at-0-21-4`). Branch `fix/control-frame-key-consistency`, off `5650274` (#180).
- Phase 102's follow-up question — which fields of a received frame are trusted — had a real answer.
  `handleControlMessage` validated `targetWorkerId` and, for `SUBSCRIBE`, the durable route named by
  `message.topicKey`; everything else it acted on came from the frame, including `message.topic`, which
  is what `rememberTopic()`, `assignedTopics`, and the transport subscription are named by. Since
  `topicKey` is `createOpaqueKey(topic)`, a `BroadcastChannel` post carrying a *real* key next to an
  *arbitrary* topic passed the authorization that was keyed by the key and then substituted the
  plaintext. Same-origin, no credentials, one frame.
- Fix is the invariant, not a denylist: a control frame is dropped unless
  `createOpaqueKey(message.topic) === message.topicKey`. Senders already satisfy it by construction —
  `cluster.ts` computes the key from the topic in both places a frame is built — which is what makes
  the check safe to apply to every action rather than to `SUBSCRIBE` alone.
- Verified in both directions. With the guard the new test passes; with the source restored to `HEAD`
  it fails as `expected "vi.fn()" to not be called at all, but actually been called 1 times`, so the
  hole is demonstrated rather than argued. Whole suite green with it in place — 37 files / 876 tests,
  `pnpm typecheck` and `pnpm lint` clean — including the coordination fuzzer, which forges frames
  deliberately, and the legacy-protocol tests, which omit `protocolVersion` but never the key/topic
  pairing. Coverage moved up rather than down: whole-suite 98.94 / 96.57 / 99.26 / 99.65 →
  98.98 / 96.63 / 99.26 / 99.69, `cluster.ts` branches 94.16 → 94.22.
- Changed files: `src/core/cluster.ts`, `tests/cluster.test.ts`, `AGENTS.md` (the protocol section now
  states the two invariants a receiver checks and asks the next field-adder which one it belongs to),
  `CHANGELOG.md`, `docs/progress.md`.
- Risk / rollback: a conforming peer cannot be broken by the check unless it builds keys some other
  way, and nothing in this repository or the packed ESM/CJS artifacts does; `git revert` is the
  rollback and there is no storage or wire-format migration.
- Next: cut the patch release this earns (version → CHANGELOG → notes → full freeze → tag → publish →
  `verify:published`), then resume the 13-arm ledger with the same "what does the receiver trust"
  question applied to the `EVENT` fan-out path and to `message.items` in batched `PUBLISH`.
- Updated: 2026-09-22.

## Phase 104 / The EVENT path was audited for the same hole and left alone, on purpose

- Version: no code change; documents a decision so it is not re-litigated. Branch
  `docs/event-trust-boundary`, off `c1330b1` (#181).
- Phase 103's fix raised the obvious follow-up: `handleMessage` forwards an `EVENT` frame's
  `eventType`, `payload`, `sourceWorkerId` and `originTabId` to `handlers.onEvent` with no route or key
  check, so is that the same substitution hole one layer up? It is not, and the reason is worth more
  than the answer. `CrossTabDataBus`'s handler validates `eventType === PUBLICATION_EVENT` and the
  minimum payload shape (an object with a string `topic`) — deliberately lax, so a peer on another SDK
  version cannot throw from inside the channel listener and break subsequent delivery — and then hands
  the publication to `dispatch()`, whose reach is bounded by the receiving tab's own
  `topicHandlers` map plus the wildcard patterns it registered, and only once
  `cluster.hasLocalSubscriber(message.topic)` passes; `dispatch()` also records the publication into
  that topic's replay ring buffer, which is the one piece of durable-ish state this path can write.
- So the blast radius of a forged `EVENT` is "a same-origin script delivers a publication to a topic
  this tab already subscribes to", which is strictly weaker than what that script can already do by
  calling the page's own bus. The forged `CONTROL` frame was different in kind, not in degree: it wrote
  shared coordination state — `assignedTopics`, the durable route confirmation, the transport
  subscription name — that *other* tabs then observe, which is exactly what the route check exists to
  authorize.
- Consequence recorded in `AGENTS.md`: do not "harden" `EVENT` with an `isAssigned`/route gate. It would
  buy nothing against the same-origin threat and would break the older/newer peers that the shape-only
  check tolerates. The paragraph names the one change that would reopen the question — `EVENT` payloads
  gaining the ability to mutate state beyond invoking local handlers.
- Changed files: `AGENTS.md`, `docs/progress.md`. No source or test change, so no verification beyond
  `pnpm lint` and reading the diff; nothing to measure.
- Risk / rollback: documentation only; `git revert`.
- Next: the owed 0.21.5 patch release (see Phase 103), then the 13-arm ledger with the
  "what does the receiver trust" question applied to batched `PUBLISH` `message.items`, where each item
  carries its own metadata and the frame-level key check only sees the outer `topic`.
- Updated: 2026-09-22.

## Phase 105 / 0.21.5 — the release the control-frame fix earned

- Version: **0.21.5** (patch — one behaviour change, no public API change). Branch `release/0.21.5`,
  squash-merged as `701b531`; tag `v0.21.5` on that exact commit. Status: **published** — GitHub release
  live, npm `latest` is 0.21.5, and the `Release` workflow's blocking published-consumer step is green.
- Trigger: #181 changed runtime behaviour (incoming control frames are now dropped unless
  `createOpaqueKey(topic) === topicKey`), which is the condition Phase 103 recorded for cutting a patch.
  Everything else in the range since 0.21.4 is test-only, comment-only, or harness work.
- Milestone contents: the protocol substitution fix; the `stop()` hang contract that its own comment
  had ruled impossible; the missing-`console.warn` leg of the error-reporting path; fuzz-fuse,
  two-direction clock pin, and in-sweep progress heartbeat; three legs classified by enumeration
  instead of hunted; `AGENTS.md`'s new protocol section stating which frame fields a receiver checks
  and why `EVENT` is deliberately not held to the `CONTROL` standard.
- Changed files: `package.json`, `CHANGELOG.md`, `docs/roadmap.md`, `docs/zh/roadmap.md`,
  `docs/progress.md`.
- Verification: `pnpm check` (typecheck + build + 37 files / 876 tests + 5 perf gates) clean; `pnpm lint`
  clean; `git diff --check` clean; `pnpm test:coverage` 98.98 / 96.63 / 99.26 / 99.69 over 876 tests,
  above the 96 / 92 / 96 / 97 floors; `pnpm verify:compat` reports "0.21.5 preserves public exports and
  type metadata from v0.21.4"; `pnpm verify:pack` imports root and every subpath in ESM and CJS from the
  packed tarball; `pnpm audit --registry=https://registry.npmjs.org` reports no known vulnerabilities;
  `npm pack --dry-run --json` lists 109 entries for 0.21.5.
- The one gate that needed adjudication: `pnpm test:e2e` failed twice, both on
  `demo.spec.ts › shared-mode session closes server-side when a tab closes`, the second time after
  33.9s against an 11.2s pass. Investigated rather than waved through: the CONTROL senders are two
  sites in `cluster.ts` and both derive `topicKey` from the same topic, so no shipped path can emit the
  mismatch the guard now drops; the test passes in isolation and then the whole suite passed 36/36 in
  51.9s on an idle machine, and CI's `browser` job had already gone green on #181 and #182 with the
  guard in place. Conclusion: loaded-runner contention on a polling assertion, recorded because the
  alternative reading — that the frame guard broke shared-worker session teardown — is the kind of
  claim that has to be excluded with evidence, not by preference.
- Deliberately skipped: `pnpm bench:browser` / `bench:compare` (local-only per the checklist, and its
  own notes document the fast/slow bimodality that makes a single run uninformative). `pnpm bench`
  output was not captured locally; CI's verify job runs it, and that is the gate being relied on.
  The added cost is one 128-bit hash per received control frame, which is not a path these benchmarks
  measure.
- Risks / rollback: the guard is stricter than the previous behaviour, so a peer that constructed a
  mismatched pair would now be ignored — no such sender exists in this repository, in the packed
  artifacts, or in the E2E examples, and mixed-version peers are covered by the E2E and the
  legacy-protocol unit tests. Rollback is reverting the release commit and re-tagging; no storage or
  wire-format migration is involved, and no published version is ever moved or reused.
- Release outcome: PR #183 squash-merged into `main` as `701b531`, `v0.21.5` tagged on that exact commit
  and pushed alone (no direct `main` push, no force-push, no merge commit), release branch deleted both
  sides. `Release` run 35736169241 finished `success` with every named step green, including the blocking
  `Verify published npm consumers` — the published artifact, not just the built tree, imports cleanly.
  GitHub release live at `/releases/tag/v0.21.5` (published 2026-09-22T13:51:15Z, not a draft);
  `npm view cross-tab-worker-databus version` → `0.21.5` with `dist-tags.latest` → `0.21.5`. Repeated the
  consumer check by hand against the registry tarball
  (`PUBLISHED_VERSION=0.21.5 pnpm verify:published`) → "verified published
  cross-tab-worker-databus@0.21.5 ESM/CJS consumers", so the smoke test is first-hand and not only a CI
  green check.
- Next: resume the 13-arm ledger (task #22) and the batched-`PUBLISH` `message.items` question that
  Phase 104 left open — each item carries its own metadata while the frame-level key check added in
  Phase 103 only sees the outer `topic`.
- Updated: 2026-09-22.

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
  -> DONE for 0.20.96: the checklist ran end to end against the real publish,
  including the previously unrunnable `verify:published` gate (Release run
  35660663344, every named step green).

## Recovery entry

If interrupted: working tree state, current commit, and any in-flight test
outputs are recorded here (see Task pool checkboxes). Resume with:
`pnpm check && pnpm lint && pnpm test:e2e && pnpm bench && pnpm verify:pack`
then continue the next unmarked task. Push only after the phase is locally green.
