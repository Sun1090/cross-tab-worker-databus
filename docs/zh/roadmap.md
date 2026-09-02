# 路线图

0.19.0 正在推进。项目会先持续完成可靠性与协议兼容性的中版本迭代，再进入 1.0.0 稳定性冻结。

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
