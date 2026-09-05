# 发布检查清单

每个 1.0.0 之前的版本都按此清单执行。仓库不由助手执行发布；完成打包验证并人工审阅后，再手动运行 npm 命令。

## 打 tag 前

1. 更新 `package.json`、`CHANGELOG.md` 和中英文 roadmap。
2. 运行 `pnpm check`、`pnpm lint`、`pnpm bench`、`pnpm test:e2e`、`pnpm bench:browser`、`pnpm verify:pack` 以及 `git diff --check`。
3. 用 `npm pack --dry-run --json` 确认发布包只包含预期文件。
4. 提交、给精确版本打 tag，并推送 `main --tags`。

## 打 tag 的发布工作流

推送版本 tag 会触发 `Release` GitHub Action：先跑 `pnpm check`，从 `CHANGELOG` 对应章节生成 GitHub release，配置了 `NPM_TOKEN` 时自动发布到 npm，然后运行与手动执行相同预算的**阻塞式**消费者验证（`PUBLISHED_VERIFY_ATTEMPTS=24`、`PUBLISHED_VERIFY_DELAY_MS=5000`）。已发布包若无法被干净消费者导入，工作流即失败——任何 `verify:published` 失败都应视为发布失败，修复后重新发布该 tag。未配置 token 时跳过发布步骤，但验证仍会针对 npm 上已有的版本（例如手动发布的）通过。

## 发布（手动场景）

未在工作流配置 `NPM_TOKEN` 时，从对应 tag 的工作树手动运行 `npm publish --access public`。已经存在于 npm 的版本不能重复发布；npm 缺失的历史版本必须从对应 git tag 重建并逐个审阅，不能把当前工作树伪装成旧版本发布。

## 发布后

1. 用 `npm view cross-tab-worker-databus versions --json` 确认版本已出现。
2. 在干净消费者中安装已发布版本或 tarball，并导入主入口及所有公开子路径。
3. 将结果记录到发布说明。在公开 API 和协议弃用策略明确冻结前，不进入 `1.0.0`。

打 tag 的发布工作流已自动执行上述消费者验证；仅在需要离线复验时才手动运行 `PUBLISHED_VERSION=<version> pnpm verify:published`。只有遇到异常慢的镜像才需要调整 `PUBLISHED_VERIFY_ATTEMPTS` 和 `PUBLISHED_VERIFY_DELAY_MS`。
