# 贡献指南

感谢关注 cross-tab-worker-databus！本文档描述开发环境的搭建、常用命令与提交规范。

## 环境要求

- Node.js >= 18（开发机建议 22+）
- pnpm 10（`corepack enable` 即可获得，版本由 `packageManager` 字段锁定）
- 运行 e2e 需要系统安装 Google Chrome（Playwright 配置为 `channel: 'chrome'`）。Chrome 不可用时（例如 CI），先 `pnpm exec playwright install chromium`，再用 `PLAYWRIGHT_CHANNEL=chromium` 或 `--channel=chromium` 覆盖。

## 快速开始

```bash
pnpm install
pnpm check        # typecheck → build → 全部单测 → 性能门禁（用例数由 `pnpm test` 自己打印）
pnpm lint         # ESLint（不在 `pnpm check` 里，但 CI 作为独立阻断步骤运行）
pnpm test:watch   # 监听模式
pnpm test:e2e     # Playwright 多 Tab 浏览器测试（自动构建 + 启动演示服务器）
pnpm examples     # 启动演示服务器 → http://localhost:4173/examples/demo/
```

## 项目结构

见 [AGENTS.md](./AGENTS.md)——它同时是给人类贡献者和 AI 编码工具的项目地图：目录布局、架构原则（port/adapter、纯函数路由、写合并、粘性 owner）、协调协议与测试基建（`tests/fakes.ts` 的 MemoryStorage / ChannelHub / FakeTransport）。

## 测试约定

- 单元测试使用 Vitest + `createFakeEnvironment()` 假环境，时间、存储、BroadcastChannel 全部可控。
- 修改 `src/core/` 协调逻辑时，先看 `tests/cluster.test.ts` 是否已有同场景，再补边界分支。
- 覆盖率门禁：`pnpm test:coverage` 只统计 `src/**`，四项阈值写在 `vitest.config.ts` 的 `coverage.thresholds`（本次核对为 statements 98 / branches 96 / functions 98 / lines 99）。阈值故意贴着实测值，低于它们是**失败**而不是警告，所以数值以配置文件为准，不要以本文档为准——它比代码慢一步。
- 新增 transport 后端必须通过 `DataBusTransport` 契约（幂等订阅、stop 后可重启、状态经 onStatus 上报），参考 `src/websocket.ts` 与其测试。
- e2e 只覆盖单测无法触达的真实浏览器行为（多 Tab、SharedWorker、BFCache、真实 WebSocket 握手）。

## 提交规范

- 提交信息用约定式前缀：`feat:` / `fix:` / `docs:` / `chore:` / `test:` / `refactor:`。正文语言以仓库现状为准——`git log --format=%s` 最近 200 条里 0 条含中日韩字符，即全部为英文；本条曾写作“中文描述正文”，与实际约定相反，若维护者要改回中文，改这一行即可，但请同时检查历史。
- 提交前保证 `pnpm lint && pnpm check` 全绿（`pnpm check` 不含 lint）。
- 用户可见变更必须同步更新：`CHANGELOG.md` 里**对应版本号的那一节**（`## [x.y.z] - 日期`，在发布准备提交里直接写；仓库现在不再维护 `[Unreleased]` 段，`docs/release-checklist.md` 是唯一权威流程）+ 中英文档（README、docs/*.md 与 docs/zh/*.md 保持结构一致）。

## 发版流程（维护者）

完整步骤以 `docs/release-checklist.md` 为准（`node scripts/verify-release-version.mjs` 会检查 `RELEASE_TAG == v + package.json 版本`、该版本在 CHANGELOG 里恰好有一节非空说明，并对照 registry 的 `time` 映射）。要点：

```bash
# 1. 在功能分支上写好 CHANGELOG 的版本节与版本号，PR 全绿后 squash 合入
git fetch origin --prune
git switch main && git merge --ff-only origin/main
git tag -a v<版本号> <合并后的精确提交>       # 2. tag 打在合入提交上，不是本地 HEAD
git push origin v<版本号>                    # 3. 只推这一个 tag
```

**不要**用 `npm version` + `git push origin main --tags`：前者把 tag 打在本地 HEAD 而非合入提交，后者直推受保护的 `main` 并连带推送所有 tag，两者都会被仓库规则拒绝。workflow 会跑完整门禁并从 CHANGELOG 抽取版本说明创建 GitHub Release；若仓库配置了 `NPM_TOKEN` secret，会同时 `npm publish --provenance --registry https://registry.npmjs.org`，未配置时该步骤自动跳过（手动发布场景，命令同样显式点名 registry）。

## 行为准则

保持友善、就事论事。所有交互遵循项目开源社区的一般礼仪。
