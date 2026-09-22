# 发布检查清单

每个 1.0.0 之前的版本都按此清单执行。仓库不由助手执行发布；完成打包验证并人工审阅后，再手动运行 npm 命令。

## 公共 API 稳定性与弃用策略（1.0 之前）

- 根导出面由 `tests/dual-format.test.ts`（冻结测试）与 `scripts/verify-version-compat.mjs`（tag 间兼容门禁）钉住。新增或删除导出是经过评审的刻意变更；同一提交中必须同步更新 `docs/api.md` 与 CHANGELOG。
- 1.0 前的破坏性变更仅在走完弃用周期后才允许：legacy 别名至少保留一个小版本，首次使用时 `console.warn` 提示，且只在 CHANGELOG 明确标注移除的小版本中删除。
- 协议别名（worker/cluster/transport 消息形态）遵循同一规则：弃用后至少一个小版本继续解析 legacy 帧，保证混版本 peer 兼容（见 `getDiagnostics().protocol` 的协议版本诊断）。
- 晋升 `1.0.0` 要求公共 API 与协议弃用策略正式冻结，并发布迁移指南（见 `docs/roadmap.md` 的 0.13.0 candidates）。

## 自动化门禁（CI）

`CI` 工作流的 `verify` job 在每次 push 与 pull request 上运行 `pnpm check`、`pnpm lint`、`pnpm test:coverage`（`vitest.config.ts` 中的下限：语句 98% / 分支 96% / 函数 98% / 行 99%）、`pnpm verify:compat`、`pnpm verify:pack`、`pnpm bench` 与 `pnpm audit`；`browser` job 运行 Playwright E2E 套件。`Release` 工作流在发布前重跑 `verify:compat` 与 `verify:pack`，随后执行阻塞式 `verify:published` 门禁。两个工作流的 checkout 均使用 `fetch-depth: 0` + `fetch-tags: true`，因为 `verify:compat` 需要从最近的发布 tag 解析基线。

只有 `pnpm bench:browser` / `pnpm bench:compare` 保持仅本地执行：共享 runner 的计时噪声会让数值型 CI 门禁不可靠。

## 打 tag 前

1. 更新 `package.json`、`CHANGELOG.md` 和中英文 roadmap。
2. 运行 `pnpm check`、`pnpm lint`、`pnpm test:coverage`、`pnpm bench`、`pnpm test:e2e`、`pnpm bench:browser`、`pnpm verify:pack`、`pnpm verify:compat` 以及 `git diff --check`（`verify:compat` 断言 `COMPAT_BASE_TAG` 基线中的 package `exports` 子路径与类型字段仍然存在；`verify:pack` 从打包产物冒烟导入完整根公共面与全部子路径的 ESM/CJS。`verify:compat` 从最近的发布 tag 解析基线，因此浅克隆或缺少 tag 的克隆需先执行 `git fetch --tags`，否则会以 "no version tag found" 失败）。
3. 依赖安全门禁：`pnpm audit --registry=https://registry.npmjs.org`（配置的镜像 registry 缺少 audit 端点；CI 在 verify job 中于公共 registry 运行）。任一已知漏洞公告即视为发布失败；`pnpm-workspace.yaml` overrides 钉住补丁版本。
4. 浏览器基准回归门禁：运行 `pnpm bench:browser`（至少两次；门禁将最新报告与之前最多五份归档报告中同一指标的中位数比较），随后执行 `pnpm bench:compare --fail-above-pct 50`。采用中位数基线是因为页内热路径指标在同一份代码上会在快/慢两档之间来回跳——`dedup1000Ms` 相邻两次实测分别为 12.7 ms 与 25.6 ms，只看"上一份报告"时，一次偶发噪声就能在无代码改动的情况下击穿既定上限。`publish/dedicated/perMessageMs` 同样如此：同一份代码相邻两次实测为 49.9 ms 与 71.1 ms，令门禁以 +75.7% 失败，而同一份报告里 `dedup1000Ms` 与 `traceAndPublish1000Ms` 反而*变快*——"单指标上涨、其余下降"正是噪声的特征，第三次实测为 49.4 ms 并通过。因此在采信或处理失败前先复跑并观察离散度；若改动涉及热路径，就直接量化其开销（0.20.95 有界映射改写的微基准显示三种写法均为 80–86 ns/op，落在运行间波动之内）。基线迁移（例如某指标从空操作变为真实路径）属预期内的一次性失败。用 `pnpm bench:trend` 刷新长期趋势文档，表格变化时一并提交。
5. 用 `npm pack --dry-run --json` 确认发布包只包含预期文件。
6. 在功能分支提交并推送该分支，PR 验证通过后使用 squash 或 fast-forward 合入（不创建 merge commit）。获取合入后的精确提交并打 tag，只推送该版本 tag；禁止直接推送 `main`/`master` 或 force-push。工作流运行 `node scripts/verify-release-version.mjs`，要求 `RELEASE_TAG` 等于 `v` 加 package 版本，且 CHANGELOG 中恰好有一个非空的对应版本章节。

## 安全与依赖扫描

仓库配置了 CodeQL（`javascript-typescript`，push/PR/每周）与 Dependabot（npm + GitHub Actions 每周更新）。CodeQL 告警会作为 PR check 暴露；Dependabot PR 在合并前必须通过其 verify（全量 check）与 CodeQL 检查，浏览器 E2E 的已知共享 runner 抖动按既有处理方式重跑确认。

## 打 tag 的发布工作流

推送版本 tag 会触发 `Release` GitHub Action：先跑 `pnpm check` 与 `pnpm lint`（tag 可能指向从未通过 CI lint 步骤的提交），再跑 `verify:compat` 与 `verify:pack`，从 `CHANGELOG` 对应章节生成 GitHub release，配置了 `NPM_TOKEN` 时自动发布到 npm，然后运行与手动执行相同预算的**阻塞式**消费者验证（`PUBLISHED_VERIFY_ATTEMPTS=48`、`PUBLISHED_VERIFY_DELAY_MS=7500`，即 6 分钟上限）。已发布包若无法被干净消费者导入，工作流即失败——任何 `verify:published` 失败都应视为发布失败。若为 registry 传播延迟或基础设施故障，针对不变的 tag 重跑工作流；若为产物缺陷，发布新的 patch 版本。禁止移动或重用已发布 tag。未配置 token 时跳过发布步骤，但验证仍会针对 npm 上已有的版本（例如手动发布的）通过。

## 发布（手动场景）

未在工作流配置 `NPM_TOKEN` 时，从对应 tag 的工作树手动运行 `npm publish --access public`。已经存在于 npm 的版本不能重复发布；npm 缺失的历史版本必须从对应 git tag 重建并逐个审阅，不能把当前工作树伪装成旧版本发布。

## 发布后

1. 用 `npm view cross-tab-worker-databus versions --json` 确认版本已出现。
2. 在干净消费者中安装已发布版本或 tarball，并导入主入口及所有公开子路径。
3. 将结果记录到发布说明。在公开 API 和协议弃用策略明确冻结前，不进入 `1.0.0`。

打 tag 的发布工作流已自动执行上述消费者验证；仅在需要离线复验时才手动运行 `PUBLISHED_VERSION=<version> pnpm verify:published`。工作流默认的 6 分钟上限足以吸收 npm CDN 的正常传播延迟（0.20.89 tag 首次运行在发布成功后排空了旧的 2 分钟预算）；只有遇到异常慢的镜像才需要继续调大 `PUBLISHED_VERIFY_ATTEMPTS` 和 `PUBLISHED_VERIFY_DELAY_MS`。
