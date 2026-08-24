# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)；变更记录格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

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
