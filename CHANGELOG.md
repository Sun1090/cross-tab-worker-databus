# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)；变更记录格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

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
