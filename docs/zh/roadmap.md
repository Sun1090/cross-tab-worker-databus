# 路线图

0.4.0 已发布。下一阶段统一按 0.5.0 候选推进，让性能、持久化和兼容性说明一起落地。

## 0.5.0 候选

1. **publish 路径 profile 与优化**：结合 `pnpm bench` 和 `pnpm bench:browser`，先拆分 storage batching、路由和页面/服务端开销，再决定是否优化；
2. **重放持久化**：增加 IndexedDB 历史适配器，支持 reload 与 BFCache 会话间恢复；保留纯内存重放作为零依赖默认；
3. **Vue composable**：复制 React hooks 的生命周期与订阅语义，Vue 仍保持可选依赖；
4. **二进制 demo 真链路**：让 WebSocket demo 端到端覆盖真实 `ArrayBuffer` 帧，同时保留仅支持 JSON 服务端的 base64 fallback；
5. **Push CI 浏览器门禁**：环境提供 Chrome 时在 push 上运行 Playwright，贡献者本地仍可手动执行。

## 发版检查清单

- 更新 `[Unreleased]` 与版本日期；
- 执行 `pnpm check`、`pnpm lint`、`pnpm test:e2e`、`pnpm bench`、`pnpm bench:browser`；
- 从打包 tarball 做 ESM/CJS 消费冒烟验证；
- 推送 tag 后核验 GitHub Release 与 npm `latest` dist-tag。
