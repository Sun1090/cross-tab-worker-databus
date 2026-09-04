# Changelog

## [0.20.48] - 2026-09-04

### Added

- Added multi-topic recovery coverage proving every topic is restored exactly once after reconnect.

## [0.20.47] - 2026-09-04

### Added

- Added extended reconnect flapping coverage proving replay stays bounded and duplicate-free.

## [0.20.46] - 2026-09-04

### Added

- Added repeated worker capability-probe coverage proving auto backend selection remains deterministic across repeated checks.

## [0.20.45] - 2026-09-04

### Added

- Added repeated WebSocket error/restart coverage proving only the newest connection remains active.

## [0.20.44] - 2026-09-04

### Added

- Added a lifecycle contract regression proving stale WebSocket close/error callbacks cannot affect a restarted session.

## [0.20.43] - 2026-09-04

### Added

- Added repeated WebSocket stop/start cleanup coverage proving subscriptions and stale callbacks are cleared across lifecycle cycles.

## [0.20.42] - 2026-09-04

### Added

- Added repeated Dedicated Worker stop/start cleanup coverage proving STOP boundaries detach stale worker delivery across lifecycle cycles.

## [0.20.41] - 2026-09-04

### Added

- Added repeated SharedWorker stop/start resource-soak coverage proving listeners and heartbeat timers are released after every cycle.

本项目遵循 [Semantic Versioning](https://semver.org/)；变更记录格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [0.20.40] - 2026-09-04

### Added

- Added auto worker-mode repeated failure/recovery coverage proving SharedWorker preference remains stable and stale ports cannot deliver publications after successive reopen cycles.

## [0.20.39] - 2026-09-03

### Added

- Added repeated Dedicated Worker failure/recovery coverage proving stale messages from superseded workers cannot reach the reopened session.

## [0.20.38] - 2026-09-03

### Added

- Added repeated SharedWorker failure/recovery coverage proving stale messages from multiple superseded ports cannot reach the reopened session.

## [0.20.37] - 2026-09-03

### Added

- Added a repeated WebSocket replacement regression proving stale lifecycle/message callbacks from multiple superseded sockets cannot leak into the newest session.

## [0.20.36] - 2026-09-03

### Added

- Added a high-frequency publish regression proving local-owner fast-path publication preserves ordering and avoids storage reads across a 1,000-message burst.

## [0.20.35] - 2026-09-03

### Added

- Added public data-bus hot-path benchmarks for publish and receive/dispatch throughput, complementing routing and cluster coordination baselines.

## [0.20.34] - 2026-09-04

### Added

- Added a transport-recovery regression covering replay history, duplicate suppression, persistence append boundaries, and late-handler ordering after automatic resubscription.

## [0.20.33] - 2026-09-03

### Added

- Added `pnpm verify:compat` to compare the current package manifest with a prior release tag and reject removed public exports, module conditions, or type metadata.

## [0.20.32] - 2026-09-03

### Added

- Added a replay/dedup combination regression covering hydrated history, live delivery after recovery, duplicate suppression, persistence append boundaries, and late-handler replay ordering.

## [0.20.31] - 2026-09-04

### Fixed

- WebSocket transport now isolates stale socket lifecycle and message callbacks after stop/start replacement, preventing late frames from an old connection entering a new session.

### Added

- Added regression coverage for stale-socket isolation during transport replacement.

## [0.20.30] - 2026-09-04

### Added

- Extended the real IndexedDB replay persistence E2E through a BFCache round trip before reload, verifying ordered durable history and asynchronous replay hydration across both lifecycle transitions.

## [0.20.29] - 2026-09-04

### Added

- Added an exhaustive worker backend fallback matrix covering dedicated, shared, and auto preferences across every capability combination.

## [0.20.28] - 2026-09-04

### Added

- Expanded packed-consumer verification into a release compatibility matrix covering package version metadata, dual-format export targets, declaration files, and root/subpath consumers.

## [0.20.27] - 2026-09-04

### Added

- Added a real Chromium long-soak regression covering repeated BFCache pagehide/pageshow cycles, reloads, owner handoff, reconnect readiness, and duplicate-free delivery.

## [0.20.26] - 2026-09-04

### Added

- Added trace diagnostics contract coverage for privacy-safe fields, events/metrics mode isolation, repeated sink failures, reliability schema timestamps, bounded state, and lifecycle metrics windows.

### Fixed

- Stopped trace reporters no longer emit metrics from later manual flushes until explicitly started again.

## [0.20.25] - 2026-09-03

### Added

- Added WebSocket, Centrifuge, and shared publication-parser compatibility coverage for legacy frames, nested envelopes, unknown fields, invalid optional metadata, and unknown worker protocol variants.

## [0.20.24] - 2026-09-03

### Added

- Added a long-running replay/dedup regression covering quiet-period TTL sweeps, re-acceptance after expiry, durable retention cleanup, asynchronous hydration, and lifecycle timer shutdown.

## [0.20.23] - 2026-09-03

### Added

- Added a BFCache + transport-error owner-handoff regression covering recovery, takeover, and duplicate-free delivery across two tabs.

## [0.20.22] - 2026-09-03

### Fixed

- Explicit stop/restart lifecycles now reset recovery attempt and exhaustion state so a new session starts with a fresh diagnostic sequence.

## [0.20.21] - 2026-09-03

### Fixed

- Recovery exhaustion diagnostics are now emitted at most once per failed recovery sequence and reset after a successful reopen.

## [0.20.20] - 2026-09-03

### Added

- Automatic recovery now emits an `exhausted` reliability event when `recovery.maxAttempts` is reached, instead of stopping silently.

## [0.20.19] - 2026-09-03

### Added

- Added optional `recovery.maxAttempts` to cap automatic transport reopen attempts while preserving explicit demand-driven recovery.
- Added validation and regression coverage for capped recovery sequences.

## [0.20.18] - 2026-09-03

### Added

- Added optional `recovery.cooldownMs` to tune automatic transport reopen pacing for different runtime environments.
- Added validation and fake-timer coverage for custom recovery cooldowns.

## [0.20.17] - 2026-09-03

### Added

- Consecutive transport recovery traces now carry monotonic attempt numbers and reset after a successful reopen.
- Added regression coverage for multi-failure recovery sequences.

## [0.20.16] - 2026-09-03

### Added

- Transport recovery trace events now report `scheduled`, `succeeded`, and `failed` outcomes, making reconnect failures diagnosable without exposing payloads or connection details.
- Added regression coverage for failed recovery followed by a successful retry.

## [0.20.15] - 2026-09-03

### Added

- Added transport status-flapping regression coverage to ensure repeated connection state notifications do not duplicate or lose assigned topic subscriptions.

## [0.20.14] - 2026-09-03

### Changed

- Release jobs now preserve published-consumer verification failures as explicit summary diagnostics without marking an otherwise successful publish as failed; local verification remains strict.

## [0.20.13] - 2026-09-03

### Added

- CI now uploads Playwright reports and test results when browser E2E fails, preserving actionable diagnostics for flaky runner failures.

## [0.20.12] - 2026-09-03

### Added

- Published-consumer verification now reports package and optional peer-dependency link context when an import fails on CI.

## [0.20.11] - 2026-09-03

### Added

- Release workflow runs one serialized job per tag and records the exact npm version, tag, and commit in the GitHub step summary for easier failure diagnosis.

## [0.20.10] - 2026-09-02

### Added

- Added reconnect-cycle regression coverage proving every assigned topic is replayed exactly once per transport reconnect.

## [0.20.9] - 2026-09-02

### Fixed

- Published-consumer verification now accepts both npm versions (`0.20.9`) and Git tags (`v0.20.9`) as input.

## [0.20.8] - 2026-09-02

### Added

- Release verification now retries npm tarball resolution to tolerate registry propagation after publication.
- The release workflow always verifies the exact tagged package's ESM and CommonJS consumers after the publish-or-skip step.

## [0.20.7] - 2026-09-02

### Added

- Added published-package consumer verification that downloads the npm version, then imports every public ESM and CommonJS entry point from a clean temporary consumer.
- The verification can target `PUBLISHED_VERSION` explicitly, making release validation independent from the local checkout version.

## [0.20.6] - 2026-09-02

### Added

- Added a release checklist covering local gates, packed-consumer verification, tag creation, and manual npm publication.
- Added migration guidance for pre-0.20 consumers and clarified that historical npm versions are immutable and are not republished from the current tree.

## [0.20.5] - 2026-09-02

### Added

- Added public-consumer freeze coverage for root, hooks, Vue, and Centrifuge subpaths across ESM and CommonJS artifacts.
- Declaration checks now verify the shipped `.d.ts` files and key replay, deduplication, and publication metadata types.

## [0.20.4] - 2026-09-02

### Added

- Added a real Chromium multi-tab soak scenario covering repeated fan-out, owner migration, BFCache round trips, reload recovery, and duplicate-free delivery.
- Browser regression coverage now exercises lifecycle transitions as one continuous session instead of isolated one-shot checks.

## [0.20.3] - 2026-09-02

### Added

- Added React lifecycle coverage for dynamic topic changes.
- Topic replacement now verifies old subscriptions are removed before the new topic is delivered, including end-to-end WebSocket hook wiring.

## [0.20.2] - 2026-09-02

### Added

- Added protocol recovery coverage proving valid WebSocket publications continue after malformed binary and text frames.
- Binary truncation, JSON parse failures, nested envelopes, and error isolation are now exercised as one compatibility sequence.

## [0.20.1] - 2026-09-02

### Added

- Added persistence mutation-sequence soak coverage spanning hydration, retry recovery, topic cleanup, subsequent append, and full cleanup.
- Recovery tests now verify that serialized persistence operations remain usable after transient failures.

## [0.20.0] - 2026-09-02

### Added

- Formalized publication-envelope compatibility coverage across legacy, nested, fallback-topic, primitive payload, metadata, and unknown-field frames.
- Empty or missing topics are rejected consistently while transport-supplied fallback channels remain supported.

## [0.19.9] - 2026-09-02

### Added

- Added regression coverage for deduplication and replay/persistence composition.
- Duplicate publications are verified not to pollute replay history, while IDs can re-enter history after TTL expiry.

## [0.19.8] - 2026-09-02

### Fixed

- IndexedDB replay persistence now invalidates cached connections after transaction creation or request failures.
- Closed or otherwise unusable connections can recover through the existing persistence retry path without recreating the adapter.

## [0.19.7] - 2026-09-02

### Fixed

- IndexedDB replay persistence no longer permanently caches a rejected `open()` promise after transient initialization failures.
- Subsequent persistence operations can reopen the database and recover without recreating the adapter.

## [0.19.6] - 2026-09-02

### Fixed

- IndexedDB replay persistence now handles cross-tab `versionchange` events by closing stale connections and reopening on the next operation.
- Multi-tab schema changes no longer leave the adapter permanently bound to an invalid connection.

## [0.19.5] - 2026-09-02

### Fixed

- React `useCrossTabDataBus` now ignores stale effect generations during rapid dependency changes.
- Superseded asynchronous cleanup can no longer clear or overwrite the newest bus lifecycle.

## [0.19.4] - 2026-09-02

### Fixed

- Vue `useCrossTabDataBus` now guards against stale asynchronous stop/start completions during rapid reactive dependency changes.
- A superseded lifecycle no longer resurrects an obsolete bus instance after a newer dependency update.

## [0.19.3] - 2026-09-02

### Added

- Added optional `dedup.sweepMs` for periodic expiry cleanup during quiet periods.
- Dedup sweep timers follow start/resume and pagehide/stop lifecycle boundaries.

## [0.19.2] - 2026-09-02

### Fixed

- Pending persistence retries are cancelled across `stop()` and pagehide suspension boundaries.
- Lifecycle-cancelled retries no longer emit persistence errors or start another adapter attempt.

## [0.19.1] - 2026-09-01

### Fixed

- WebSocket transport now accepts browser `Blob` binary frames and decodes them through the existing ArrayBuffer protocol path.
- Blob conversion failures are isolated through the transport error handler without crashing the message callback.

## [0.19.0] - 2026-09-01

### Added

- Persistence retry now emits opt-in `reliability` trace events with the bounded operation name and retry attempt.
- Retry diagnostics cover `load`, `append`, `clear`, `clearTopic`, and `clearBefore` without exposing payloads or error bodies.

### Compatibility

- Tracing remains disabled by default; retry timing, adapter contracts, and final error behavior are unchanged.

## [0.18.0] - 2026-09-01

### Added

- Added opt-in `replay.persistenceRetry` with bounded attempts and exponential backoff for transient persistence failures.
- Replay append, hydrate, clear, topic cleanup, and retention cleanup now share the same retry policy.
- Exported `DataBusPersistenceRetryOptions` for typed configuration.

### Compatibility

- The default retry policy is one attempt, preserving existing persistence behavior and error timing.
- Persistence adapters remain unchanged; retry orchestration stays in `CrossTabDataBus`.

## [0.17.0] - 2026-09-01

### Added

- Added optional `replay.retentionSweepMs` for periodic durable replay retention cleanup when no new publications arrive.
- Retention sweeps follow the DataBus lifecycle: start/resume enables the timer, while pagehide/stop disables it.
- Added fake-clock lifecycle coverage for timer cleanup and invalid sweep intervals.

### Compatibility

- `retentionSweepMs` is opt-in and has no effect without both `retentionMs` and a persistence adapter implementing `clearBefore()`.
- Existing publication-triggered cleanup, manual cleanup, and replay persistence contracts remain unchanged.

## [0.16.0] - 2026-09-01

### Added

- Replay retention cleanup is coalesced during publication bursts; the newest cutoff wins while cleanup mutations remain serialized.
- WebSocket binary-frame compatibility coverage now verifies truncated, invalid-magic, and incomplete-header frames are ignored safely.

### Compatibility

- Retention cleanup remains opt-in through `replay.retentionMs`; manual `clearReplayBefore()` behavior is unchanged.
- Existing JSON, nested publication-envelope, and legacy binary payload formats remain supported.

## [0.15.0] - 2026-09-01

### Fixed

- Replay retention now preserves legacy messages that do not carry an explicit producer timestamp; only timestamped messages older than the cutoff are removed.

### Added

- Trace event timestamps accept an injectable `trace.now` clock for deterministic lifecycle and metrics tests.
- Added compatibility coverage for timestamp-less replay cleanup and injected trace clocks.

### Compatibility

- Existing `DataBusTraceOptions` and replay persistence adapters remain source-compatible; wall-clock behavior remains the default.

## [0.14.0] - 2026-09-01

### Fixed

- Vue `useCrossTabSubscription` now rebinds when a reactive topic changes on the same bus instance.

### Added

- Vue topic-switch lifecycle regression coverage.
- Release scope documents cross-page replay mutation ordering and adapter parity guarantees.

## [0.13.0] - 2026-09-01

### Added

- IndexedDB replay mutations are serialized per adapter instance, preventing concurrent append read-modify-write races from losing history.
- Dedup memory is reset as part of a full stop lifecycle, so a restarted bus begins with a clean delivery window.
- Added persistence-failure diagnostics and lifecycle regression coverage.

## [0.12.0] - 2026-09-01

### Added

- Deduplication TTL now accepts an injectable `dedup.now` clock for deterministic tests and host runtimes without a wall-clock dependency.
- Persistence failures in replay append/cleanup paths emit bounded `persistence_cleanup` reliability diagnostics before reaching error handlers.
- Publication parsing now accepts only non-empty message IDs and finite timestamps, while preserving legacy payload compatibility.
- Added protocol compatibility tests for legacy, nested, fallback-topic, and malformed metadata frames.

### Compatibility

- `dedup.now` is optional and existing configurations keep wall-clock behavior.
- Invalid metadata is ignored instead of poisoning a publication; the topic and payload remain deliverable.

## [0.11.0] - 2026-09-01

### Added

- Automatic durable replay retention via `replay.retentionMs` when a persistence adapter supports `clearBefore`.
- Deduplication accepted/suppressed counters in periodic `message_metrics` trace snapshots.
- Service Worker runtime boundary documented as intentionally deferred pending stable browser lifetime semantics.

### Compatibility

- Existing replay adapters remain valid; `retentionMs` is ignored when an adapter does not implement `clearBefore`.
- Existing trace consumers can continue reading the original metrics fields; dedup counters are additive.

## [0.10.0] - 2026-09-01

### Added

- Formal transport-neutral publication metadata types (`DataBusPublication`, `DataBusPublicationMetadata`, and `DataBusPublicationEnvelope`).
- Publication metadata (`messageId` and `timestamp`) now traverses cluster controls, Centrifuge Worker boundaries, and WebSocket publish frames.
- Demo WebSocket server emits the canonical nested publication envelope and preserves caller metadata; real-browser contract coverage added.

### Compatibility

- Flat WebSocket publication frames remain accepted.
- Existing payloads without metadata retain their legacy shape.

## [0.9.0] - 2026-09-01

### Added

- Dedup runtime statistics (`getDedupStats`) and reset API (`resetDedup`).
- Replay retention APIs: `clearReplayTopic` and `clearReplayBefore`; IndexedDB supports optional time-based pruning.
- Forward-compatible WebSocket publication envelope parsing with timestamp and message ID metadata.

## [0.4.0] - 2026-08-30

### Added

- 消息重放（有界本地历史）：`replay: { maxPerTopic }` 选项 + `subscribe(topic, handler, { replay: true | n })`，晚加入的 handler 立即收到缓冲历史（`message.replayed: true` 标记）；仅缓冲已分发消息，内存环形队列，最后一位 handler 退订即清空；通配订阅跨匹配 topic 回放。
- 性能基准套件：`pnpm bench`（routing 纯函数 / cluster 协调 / 通配匹配共 8 项基线）。
- e2e：二进制发布按钮 × WebSocket 后端跨 Tab 往返。

### Changed

- 校验 `replay.maxPerTopic` 必须为正安全整数，并从根入口导出 `DataBusReplayOptions`。
- CJS 产物在无法解析模块相对 Worker URL 时抛出可操作的错误信息，并补充使用说明。

- BFCache e2e 在 `pageshow` 后等待 transport 恢复完成，避免把合法的异步恢复窗口误判为重复投递。

## [0.8.0] - 2026-08-31

### Added

- 0.8.0 development: optional `publish(topic, data, { messageId })` metadata now propagates through cluster routing and supported transports.
- Explicit `bus.clearReplay()` retention cleanup for in-memory and durable replay stores.
- Dedup suppression is observable through reliability trace events (`dedup_suppressed`).

## [0.7.0] - 2026-08-31

### Added

- Replay persistence lifecycle cleanup (`clear` / `clearTopic`) with stale-history removal on unsubscribe.
- Opt-in reliability diagnostics for recovery retries, owner acknowledgments, and route migrations.
- Bounded, opt-in publication deduplication with caller-supplied message IDs.
- React/Vue and custom-transport compatibility fixtures plus browser/package regression coverage.

### Implemented in the current 0.7.0 worktree

- Replay persistence now supports optional `clear()` and `clearTopic()` lifecycle hooks; `CrossTabDataBus` invokes them on stop and final topic unsubscribe.
- Trace exports bounded `reliability` events for transport recovery attempts, route acknowledgments, and graceful route migrations.
- `DataBusMessage.messageId` plus opt-in `dedup: { maxEntries, ttlMs }` suppresses duplicate inbound publications with bounded memory.

## [0.6.0] - 2026-08-31

### Changed

- `publish()` 在当前 Worker 已同步持有 topic owner assignment 时走本地快路径，避免每条消息重复扫描 worker/route storage；跨 Tab 路由仍保留原有存储校验。
- 新增独立 `./vue` 入口，提供 `useCrossTabDataBus`、`useCrossTabSubscription` 和 `useCrossTabStatus`；Vue 3 作为可选 peer dependency，不影响核心入口。
- WebSocketTransport 与内置 demo 支持 `ArrayBuffer` 二进制帧往返；JSON payload 协议保持兼容。

## [0.5.0] - 2026-08-31

### Added

- 真实浏览器发布基准入口：`pnpm bench:browser`，在本地 Centrifuge 演示服务上用两个真实标签页分别测 dedicated/shared Worker 的跨 Tab 发布耗时。
- 可选 replay 持久化契约与 IndexedDB 实现：`createIndexedDbReplayPersistence({ maxPerTopic })`；默认仍为纯内存，持久化失败通过错误处理器报告。
- E2E：新增真实 Chrome reload 场景，验证 IndexedDB replay 历史在页面重建后恢复（总计 8 项 E2E）。

### Notes

- 当前基准包含页面点击、JSON 序列化、Worker/Storage/BroadcastChannel、服务端回显和接收端渲染，结果用于端到端回归趋势，不等同于核心 `publish()` 微基准。
- 2026-08-31 本机 Chrome 100 条消息采样：dedicated 约 34.03 ms/条，shared 约 33.89 ms/条；两者接近，暂不据此改动 publish 路径，避免在缺少核心 profile 时引入陈旧路由缓存。

## [0.3.0] - 2026-08-29

### Added

- 双格式发布：新增 CJS 构建（`dist/cjs/*.cjs`），`exports` 增加 `require` 条件，CommonJS 消费者（`require()`、CJS bundler 配置）可直接使用；新增构建产物冒烟测试（`pnpm check` 先构建后测试）。
- 原生 WebSocket 传输后端：`WebSocketTransport` + `createWebSocketDataBus`（零依赖，极简 JSON 帧协议），验证 `DataBusTransport` 多后端抽象；含 9 个单元测试。
- Topic 通配符订阅：`chat.*` 后缀通配与 `*` 全匹配。pattern 以字面量参与路由/归属/传输订阅（服务器需支持 channel pattern 并以具体 topic 标注发布，或直接以 pattern 标注）；dispatch 侧新增通配匹配——owner 门（`isAssigned`）、本地订阅门（`hasLocalSubscriber`）与 handler 分发均按 pattern 匹配具体 topic。新增纯函数 `isWildcardTopic` / `topicMatchesPattern` 与 10 个相关测试。
- React hooks 适配层：独立入口 `cross-tab-worker-databus/hooks`，导出 `useCrossTabDataBus`（StrictMode 安全的 bus 生命周期）、`useCrossTabSubscription`（handler 经 ref 读取，内联闭包不重订阅）、`useCrossTabStatus`；React（>=18）为可选 peer 依赖；jsdom 渲染测试 3 个。
- 示例与演示服务器：demo 页新增「WebSocket」后端模式（连接内置 `/ws/demo` 演示服务器，支持 pattern 订阅与发布回显）；新增 `scripts/demo-ws-server.mjs` 与 12 个契约测试；新增 WebSocket 后端跨 Tab 收发 e2e（全套 6 个）。

### Changed

- `main` 字段指向 CJS 入口（`./dist/cjs/index.cjs`），`module`/`exports.import` 仍为 ESM；worker 入口保持 ESM module worker 不变。

## [0.2.1] - 2026-08-29

### Added

- 发布自动化：tag 触发的 GitHub Actions release workflow（typecheck + 单测 + build 门禁 → 从 CHANGELOG 抽取版本说明创建 GitHub Release → `npm publish --provenance`）。
- 测试基建：ESLint（typescript-eslint flat config，含 `lint` 脚本）、Vitest 覆盖率（`pnpm test:coverage`，阈值 statements 85 / branches 80 / functions 90 / lines 85）、`.editorconfig`。
- 51 个新单元测试（137 → 188）：`CentrifugeSession` 协议分支（UNSUBSCRIBE、server-side publication、错误序列化）、浏览器环境适配层（`createBrowserEnvironment`/`getOrCreateTabId`/`canUseStorage`）、trace 上限截断与 sink 异常隔离、cluster 健壮性（损坏 JSON、存储写失败、TTL 清理、handoff UNSUBSCRIBE 短路、路由抢占 reconcile）、routing/storage-batch/port-reaper 边界分支、`CentrifugeWorkerTransport` 边界路径。
- 1 个新 E2E：BFCache 往返（pagehide 交接 + pageshow 恢复后双向收发）。
- React 18 使用示例（`examples/react`，StrictMode 安全的 bus 生命周期）；示例服务器支持 `.jsx`。
- README（中英）FAQ 与 0.1 → 0.2 迁移说明。

### Changed

- 包导出加固：`./centrifuge.worker` / `./centrifuge.shared.worker` 补 `types` 条件（指向 `dist/workers/*.d.ts`）；新增 `sideEffects` 白名单保护 worker 产物不被 tree-shake；`prepublishOnly` 门禁（`pnpm check`）。
- tsconfig 追加严格开关：`noFallthroughCasesInSwitch`、`noImplicitOverride`、`allowUnreachableCode: false`（零代码改动通过）。
- 测试总覆盖率：语句 89.9% → 96.6%，分支 86.3% → 90.9%（environment 32.9% → 100%，centrifuge-session 77.8% → 100%）。

### Fixed

- 清理 18 处 ESLint 违规：未使用变量/导入、注释中的 U+202F 不规则空白。
- `scripts/serve-examples.mjs` 之前不识别 `.jsx` MIME 导致模块脚本被拒（随新示例修复）。

## [0.2.0] - 2026-08-27

### Changed

- `centrifuge` 从 `dependencies` 改为 optional `peerDependencies`：仅在使用内置 Centrifuge 后端时需要安装，核心包零运行时依赖。
- `CentrifugeSession.handle()` 由连续 `if` 改为 `switch` + `default`，未知消息类型静默忽略，为未来协议扩展留出兼容余地。
- `routing.ts` 的 workerId 平局处理由 `localeCompare` 改为数值比较，消除宿主 locale 对路由确定性的影响。
- `port-reaper.ts` 提取 `computeMinHeartbeat()` 方法，reap 迭代改用 `Array.from` 快照，reaper 节奏计算与计时器逻辑解耦。
- `centrifuge-protocol.ts` 新增 `DEFAULT_SESSION_TIMEOUT_MS` 派生常量，消除 `port-reaper` 中重复的字面量计算。
- `CentrifugeWorkerTransport` 提取 `buildInitInput()` 与 `postToPortLike()` helper，消除 `start()`/`post()` 中的重复构造逻辑。
- `cluster.ts` 提取 `readAllByPrefix()` helper，统一 `readWorkers`/`cleanupOrphanedRoutes`/`cleanupOrphanedSubscribers`/`getSnapshot` 的 listKeys+readJson 循环；删除无调用点的 `listKeysSafe`。
- `cluster.ts` 提取 `buildLocalRoute()`，将 `readRoute` 的无 storage 降级分支独立命名并补文档；`readSubscriberTabIds` 同类分支拆为多行可读形式。
- `cluster.ts` 提取 `sendRouteReleased()` helper，消除三处 `ROUTE_RELEASED` 消息构造的重复；`handoffAssignedTopics` 的 generation 计算复用单次求值；`reconcileAssignedTopics` 去除同一 topicKey 的二次 `readRoute` 调用。
- `cluster.ts` `releaseSubscription` 返回 topicKey，`unsubscribe` 复用而非重新哈希；`handleMessage`/`handleControlMessage`/`sendControl` 连续 `if` 改 `switch`；`getSnapshot` 的序列化改用 `Array.from`。
- `data-bus.ts` `onControl` 连续 `if` 改 `switch`；提取 `invokeHandlers()` 统一 dispatch/status/error 三处 handler 遍历的 try-catch 隔离；提取 `formatWorkerTrace`/`formatRouteTrace` 格式化函数。
- `trace.ts` 提取 `metricsActive` getter，统一四个 record/flush 方法的守卫表达式。
- `cluster.ts` 提取 `routeOwnerIsLive()` 与 `isActiveAmong()`，消除 subscribe/publish 和 isActiveWorker/refreshRole 中的重复 route+workers.some / selectActiveWorkers+some 模式。
- `cluster.ts` 提取 `isStaleRouteRelease()`，命名 handleRouteReleasedMessage 的守卫条件。
- `cluster.ts` `activate()` 合并两个分支的 rememberTopic 调用为单循环；`handoffAssignedTopics` 去掉同一 topicKey 的二次 readRoute。
- `cluster.ts` `readSubscriberTabIds` 改用 `readAllByPrefix` + `Array.from`；`getSnapshot` 序列化改用 `Array.from` + mapping callback。
- `data-bus.ts` 提取 `formatWorkerTrace`/`formatRouteTrace` 格式化函数；`invokeHandlers` 的 label 参数改为联合类型字面量而非自由字符串。
- 多处 JSDoc/注释补全：writeRecord notify 参数、activate channel 判空、reconcileWorkers cleanup 顺序、rememberTopic eviction break、suspendTransport pendingStop 守卫、reopenTransport startPromise 检查、trace flushNow 条件、storage-batch flush break / scheduleFlush 降级 / scheduleRetry、port-reaper 各方法守卫、centrifuge assertHeartbeatInterval/assertStructuredCloneable/deserializeWorkerError、environment canUseStorage。

### Documentation (JSDoc 全覆盖)

- `hash.ts` 提取 seed/prime/avalanche 常量与 `avalancheMix()` 函数，补非 ASCII 字符处理注释。
- `types.ts` 全部类型（WorkerRecord/WorkerRoute/WorkerClusterMessage/DataBusTransport/DataBusMessage/handler 别名）字段级 JSDoc 补全。
- `centrifuge-protocol.ts` 全部协议变体（WorkerUnsafeOption/CentrifugeWorkerConfig/CentrifugeWorkerInput 各变体/CentrifugeWorkerOutput 各变体/SerializedWorkerError）JSDoc 补全。
- `worker-mode.ts` WorkerMode/WorkerBackend/WorkerAvailability/selectWorkerBackend JSDoc 补全。
- `routing.ts` DEFAULT_MAX_ACTIVE_WORKERS/selectLeastLoadedWorker JSDoc 增强。
- `storage-batch.ts` INITIAL/MAX_RETRY 常量 + BatchingStorageWriter 类 + pendingSize getter JSDoc 补全。
- `trace.ts` normalizeInterval/roundMs JSDoc 补全。
- `environment.ts` ClusterEnvironment 各字段 + canUseStorage JSDoc 补全。
- `cluster.ts` readJson/writeJson/WorkerClusterOptions 各字段 JSDoc 补全。
- `data-bus.ts` PUBLICATION_EVENT/getStatus/getClusterSnapshot/CrossTabDataBusOptions JSDoc 补全。
- `centrifuge.ts` handleOutput/onWorkerFailed JSDoc 补全。

### Documentation

- 架构运行时图（中英）补全 `BatchingStorageWriter`、`PortReaper`、`CentrifugeSession`、`CentrifugeWorkerTransport` 节点，与代码结构对齐。
- `AGENTS.md` 目录注释明确列出每个测试文件职责。
- `README`（中英）补充 `centrifuge` 为可选 peer 依赖的安装说明。
- `trace.ts`、`environment.ts` 补充 JSDoc：trace 模式与选项字段含义、SSR 场景的 storage/ BroadcastChannel 检测说明。

## [0.1.2] - 2026-08-24

### Fixed

- `BatchingStorageWriter` 在结构性写失败（如某 key 让底层 storage 持续抛错）时不再无限重试：每个 key 最多重试 5 次后丢弃并 `console.warn`，避免协调平面永久卡住。
- `PortReaper.setTimeout` 校验 `heartbeatIntervalMs` 为有限正数，`0`/`NaN`/负数回退默认值，防止 reaper 退化为忙循环或沉睡。
- `CentrifugeSession.unsubscribe` 先移除 subscription 监听器再退订，避免迟到的 `unsubscribed` 事件删除重订阅后的 subscription（幽灵订阅竞态）。
- `rememberTopic` FIFO 淘汰改为向前扫描首个非 own 条目，`knownTopics` 在有非 own 条目时真正不超 `MAX_KNOWN_TOPICS` 上限。
- `DataBusTraceReporter.pause()` 清零 `intervalStartedAt`，避免 stop 后手动 flush 算出异常大的 `durationMs`。

### Documentation

- 架构文档（中英）补充 transport 层 client 级与 subscription 级 publication 去重说明。
- 配置文档（中英）补充 SharedWorker reaper 的失败隔离与关闭清理行为。

## [0.1.1] - 2026-08-24

### Fixed

- 防止 centrifuge 客户端级 `publication` 与 subscription 级监听重复派发同一消息：client 级现在跳过已有 subscription 的 topic，仅处理 server-side subscription 的 publication。
- `PortReaper.dispose()` 关闭并停止所有追踪中的 session，避免 SharedWorker 关闭时遗留 WebSocket 连接。
- `PortReaper.reap()` 对 `target.close()`/`target.stop()` 加 try-catch，单个异常 port 不再瘫痪后续死 tab 的回收。

## [0.1.0] - 2026-08-24

首次公开发布。

### Added

- 框架无关的跨标签页发布/订阅数据总线，通过 BroadcastChannel 在同源标签页间分发消息
- Dedicated Worker / Shared Worker / 本地线程三档 transport 后端，`auto` 模式自动降级
- 基于 localStorage + BroadcastChannel 的 Worker 集群协调：粘性 Topic owner 路由、新 Topic 负载均衡、owner 崩溃 failover、`pagehide` 优雅交接
- 内置 Centrifuge WebSocket transport，连接、订阅、token 刷新、二进制数据均在 Worker 内处理，不阻塞主线程
- ArrayBuffer Transferable 支持，零拷贝传输二进制 publication
- 本地 handler 引用计数与订阅排队：连接期间订阅不丢失，去重 transport subscribe 调用
- 可选结构化 trace：生命周期、连接状态、协调快照、订阅事件，以及分桶延迟直方图（P50/P95/Max）与吞吐聚合指标
- localStorage 写入合并与指数退避重试，协调元数据写入移出热路径
- 连接 URL 与 Topic 通过 128 位非加密哈希转为不透明 key，明文不落入 localStorage 键名
- SharedWorker 端口回收器：主线程 PING 心跳 + 静默超时回收，崩溃 Tab 未发 STOP 也不泄漏 session
- 优雅降级：localStorage/BroadcastChannel 不可用时退化为本地单 Tab 模式

### Documentation

- 英文与中文文档：架构、API 参考、配置、快速上手、能力矩阵
- 多标签页浏览器演示页，可视化数据流、延迟指标与集群路由状态
