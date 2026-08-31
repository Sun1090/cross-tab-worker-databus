# 路线图

0.5.0 已发布。下一阶段按 0.6.0 候选推进，先处理可用基准直接验证的 publish 路径优化，不改变公开 transport 契约。

## 0.6.0 候选

1. **publish 路径 profile 与优化**：继续拆分路由、存储和 transport 开销；0.6.0 首批加入 owner 本地 publish 的同步快路径；
2. **Vue composable**：复制 React hooks 的生命周期与订阅语义，Vue 仍保持可选依赖。（适配层已实现，后续补契约覆盖与示例）；
3. **二进制 demo 真链路**：让 WebSocket demo 端到端覆盖真实 `ArrayBuffer` 帧，同时保留仅支持 JSON 服务端的 base64 fallback；
4. **Push CI 浏览器门禁**：push 时运行 Playwright，CI 使用安装的 Chromium 作为 Chrome fallback，贡献者本地仍可手动执行。（workflow 已实现）；
5. **运维完善**：补充 IndexedDB replay 留存/清理说明，并为持久化配额失败增加诊断。

## 发版检查清单

- 更新 `[Unreleased]` 与版本日期；
- 执行 `pnpm check`、`pnpm lint`、`pnpm test:e2e`、`pnpm bench`、`pnpm bench:browser`；
- 从打包 tarball 做 ESM/CJS 消费冒烟验证；
- 推送 tag 后核验 GitHub Release 与 npm `latest` dist-tag。
