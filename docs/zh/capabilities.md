> 中文 | [English](../capabilities.md)

# 能力矩阵

状态说明：`✅ 已实现` 表示当前版本有代码和测试覆盖；`未实现` 表示当前不提供保证；`规划中` 表示已纳入后续设计范围，但未承诺版本。

| 分类 | 能力 | 状态 | 当前行为 / 边界 |
|---|---|---|---|
| 核心 API | 框架无关的 subscribe、unsubscribe、publish 和状态监听 | ✅ 已实现 | 通过 `CrossTabDataBus` 提供统一 API |
| 启动体验 | 创建后自动启动、连接前订阅排队、`ready()` | ✅ 已实现 | 应用无需等待连接即可注册 Topic |
| Tab 内复用 | 同一 Topic 多 handler 引用计数 | ✅ 已实现 | 第一个 handler 注册，最后一个 handler 释放 |
| 跨 Tab 协调 | Worker transport + BroadcastChannel 控制面 | ✅ 已实现 | 每个 Tab 默认使用 Dedicated Worker；SharedWorker 模式下同源 Tab 复用 Worker，Topic owner 跨 Tab 共享 |
| 资源限制 | 最多 3 个活跃 Worker | ✅ 已实现 | 可通过 `maxActiveWorkers` 配置 |
| Topic 路由 | 现有 owner 粘性 + 首次分配负载均衡 | ✅ 已实现 | owner 存活时不修改已有 route；仅新 Topic 或孤儿 Topic 选择负载最低的候选 Worker |
| 订阅可靠性 | 按 Tab 独立的 subscriber 记录 | ✅ 已实现 | 避免多个 Tab 修改同一 subscriber 数组互相覆盖 |
| 订阅可靠性 | owner 确认 + 未确认路由自动重发 | ✅ 已实现 | 控制消息丢失时自动重传，避免存储的 route 被误认为订阅已成功 |
| 页面生命周期 | `pagehide` 时 owner 预转移和 transport 关闭 | ✅ 已实现 | 先持久化新 route 与 Worker 删除，再通知其他 Tab；关闭瞬间控制消息丢失时也能立即收敛 |
| 页面生命周期 | `pageshow`、BFCache 恢复和业务订阅重建 | ✅ 已实现 | 应用无需重新调用 `subscribe` |
| 可见性 | 新 Topic 优先选择可见 Tab | ✅ 已实现 | 前后台切换不迁移已有 route；仅 Topic 需要新 owner 时优先选择可见 Worker |
| 异常恢复 | Worker TTL、过期 owner 迁移和协调缓存清理 | ✅ 已实现 | 回收死 Worker、孤儿 subscriber 和无 subscriber 的过期路由 |
| Transport | 重连后重放 owner Topic | ✅ 已实现 | 断开连接不清除业务 handler 和订阅意图 |
| 降级 | localStorage 或 BroadcastChannel 不可用时本地运行 | ✅ 已实现 | 保留当前 Tab 的连接和订阅能力 |
| Centrifuge | 内置 Dedicated / Shared Worker transport | ✅ 已实现 | 支持 subscribe、unsubscribe、publish、连接状态和错误上报；`auto` 从 SharedWorker → Dedicated Worker → 主线程 WebSocket 降级 |
| 安全边界 | localStorage 使用连接和 Topic 派生不透明 key；BroadcastChannel 协调消息以明文传输 Topic 名称 | ✅ 已实现 | 不持久化 URL、原始 Topic 名称、凭证或 publication payload。BroadcastChannel 协调消息仅存在于内存中，以明文传输 Topic 名称——不会被持久化。 |
| 诊断 | 聚合生命周期事件、吞吐量和分发延迟 | ✅ 已实现 | 默认关闭；默认每 5 秒输出指标，延迟报告样本数、平均值、P50、P95 和最大值 |
| 性能 | 协调元数据批量写入 + 退避重试 | ✅ 已实现 | 心跳、路由和 subscriber 写入合并后在微任务中 flush；失败时指数退避；`pagehide` / `stop()` 同步 flush |
| 性能 | 可选 ArrayBuffer Transferable 传输 | ✅ 已实现 | 开启 `transferable: true` 后，二进制 publish/receive 跳过 structured clone 复制；对象消息 API 不变 |
| 消息语义 | exactly-once 投递 | 未实现 | 正常交接会避免重叠，但异常恢复和 transport/服务端行为仍不提供 exactly-once 保证 |
| 消息语义 | 可插拔的 publication 去重 | 规划中 | 计划支持调用方提供消息 ID 和去重窗口 |
| 认证 | Worker 内异步凭证刷新桥接 | 规划中 | 当前 Worker 配置必须可结构化克隆，不能传递函数 |
| 负载策略 | 按消息速率、字节数或 CPU 自适应加权 | 规划中 | 当前负载仅按 owner Topic 数量计算 |
| 可观测性 | owner 确认延迟、迁移时长和重试次数指标 | 规划中 | 当前 trace 提供状态、生命周期、消息吞吐和分发延迟 |
| 运行时模型 | SharedWorker / Dedicated Worker transport | ✅ 已实现 | `workerMode` 支持 `dedicated`、`shared` 和 `auto`，默认 `dedicated` |
| 运行时模型 | Service Worker transport | 未实现 | 当前不提供使用 Service Worker 承载实时连接 |
| 持久消息 | 跨页面关闭持久化 publication 或发布命令 | 未实现 | SDK 不持久化业务 payload，也不在恢复后重放发布命令 |

## 验收标准

- "已实现"不代表每个浏览器环境都能提供跨 Tab 能力；缺少 localStorage 或 BroadcastChannel 时，按设计降级为本地运行。
- 将 owner 路由写入 storage 不代表订阅已建立。只有 owner 处理 `SUBSCRIBE` 后写入 `confirmedAt` 才表示控制消息已到达；服务端最终订阅状态仍由 transport 负责。
- SDK 保证订阅意图恢复和最终迁移，但不保证迁移窗口内 exactly-once。
