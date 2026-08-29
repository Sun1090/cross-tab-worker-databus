# 贡献指南

感谢关注 cross-tab-worker-databus！本文档描述开发环境的搭建、常用命令与提交规范。

## 环境要求

- Node.js >= 18（开发机建议 22+）
- pnpm 10（`corepack enable` 即可获得，版本由 `packageManager` 字段锁定）
- 运行 e2e 需要系统安装 Google Chrome（Playwright 使用 `channel: 'chrome'`）

## 快速开始

```bash
pnpm install
pnpm check        # typecheck + build + 221 个单元测试（发布前门禁）
pnpm lint         # ESLint
pnpm test:watch   # 监听模式
pnpm test:e2e     # Playwright 多 Tab 浏览器测试（自动构建 + 启动演示服务器）
pnpm examples     # 启动演示服务器 → http://localhost:4173/examples/demo/
```

## 项目结构

见 [AGENTS.md](./AGENTS.md)——它同时是给人类贡献者和 AI 编码工具的项目地图：目录布局、架构原则（port/adapter、纯函数路由、写合并、粘性 owner）、协调协议与测试基建（`tests/fakes.ts` 的 MemoryStorage / ChannelHub / FakeTransport）。

## 测试约定

- 单元测试使用 Vitest + `createFakeEnvironment()` 假环境，时间、存储、BroadcastChannel 全部可控。
- 修改 `src/core/` 协调逻辑时，先看 `tests/cluster.test.ts` 是否已有同场景，再补边界分支。
- 覆盖率阈值：statements 85 / branches 80 / functions 90 / lines 85（`pnpm test:coverage` 本地可查）。
- 新增 transport 后端必须通过 `DataBusTransport` 契约（幂等订阅、stop 后可重启、状态经 onStatus 上报），参考 `src/websocket.ts` 与其测试。
- e2e 只覆盖单测无法触达的真实浏览器行为（多 Tab、SharedWorker、BFCache、真实 WebSocket 握手）。

## 提交规范

- 提交信息用约定式前缀：`feat:` / `fix:` / `docs:` / `chore:` / `test:` / `refactor:`，中文描述正文。
- 提交前保证 `pnpm lint && pnpm check` 全绿。
- 用户可见变更必须同步更新：`CHANGELOG.md`（[Unreleased] 段）+ 中英文档（README、docs/*.md 与 docs/zh/*.md 保持结构一致）。

## 发版流程（维护者）

```bash
# 1. CHANGELOG 的 [Unreleased] 改为 [x.y.z] - 日期
npm version x.y.z            # 2. 版本号 + package.json（自动打本地 tag）
git push origin main --tags  # 3. 推送 tag 触发 release workflow
```

workflow 会跑完整门禁并从 CHANGELOG 抽取版本说明创建 GitHub Release。若仓库已配置 `NPM_TOKEN` secret，会同时 `npm publish --provenance`；未配置时 publish 步骤自动跳过（手动发布场景）。手动发布用 `npm publish --registry https://registry.npmjs.org`。

## 行为准则

保持友善、就事论事。所有交互遵循项目开源社区的一般礼仪。
