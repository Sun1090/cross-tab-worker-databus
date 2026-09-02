# 发布检查清单

每个 1.0.0 之前的版本都按此清单执行。仓库不由助手执行发布；完成打包验证并人工审阅后，再手动运行 npm 命令。

## 打 tag 前

1. 更新 `package.json`、`CHANGELOG.md` 和中英文 roadmap。
2. 运行 `pnpm check`、`pnpm lint`、`pnpm bench`、`pnpm test:e2e`、`pnpm bench:browser`、`pnpm verify:pack` 以及 `git diff --check`。
3. 用 `npm pack --dry-run --json` 确认发布包只包含预期文件。
4. 提交、给精确版本打 tag，并推送 `main --tags`。

## 发布

从对应 tag 的工作树运行 `npm publish --access public`。已经存在于 npm 的版本不能重复发布；npm 缺失的历史版本必须从对应 git tag 重建并逐个审阅，不能把当前工作树伪装成旧版本发布。

## 发布后

1. 用 `npm view cross-tab-worker-databus versions --json` 确认版本已出现。
2. 在干净消费者中安装已发布版本或 tarball，并导入主入口及所有公开子路径。
3. 将结果记录到发布说明。在公开 API 和协议弃用策略明确冻结前，不进入 `1.0.0`。

npm 发布后运行 `PUBLISHED_VERSION=0.20.7 pnpm verify:published`。
