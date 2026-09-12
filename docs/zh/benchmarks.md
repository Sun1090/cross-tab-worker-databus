<!-- 由 scripts/bench-trend.mjs 生成 —— 整个文件均为机器生成，请修改脚本而非本文档。 -->

# 浏览器基准趋势

> 数据截至 2026-09-11，基于 12 份归档的 `bench-results/browser-*.json` 报告（运行 `pnpm bench:browser` 追加一份；用 `node scripts/bench-trend.mjs` 重新生成本文档）。

发布门禁的对比基线是最近两份报告之间的 `pnpm bench:compare --fail-above-pct 50`（50% 上限用于吸收共享 runner 的噪声）。本文记录长期趋势：数值为逐指标延迟，越低越好；历史最优为本机观察到的最健康一次运行。

<!-- BENCH-TREND:BEGIN (machine-generated table) -->
| 指标 | 上次 (ms) | 本次 (ms) | Δ | 历史最优 (ms) |
|---|---|---|---|---|
| publish per-message (ms, lower is better) — dedicated | 43.8388 | 40.8227 | -3.02 | 40.8227 |
| publish per-message (ms, lower is better) — shared | 34.2105 | 35.4339 | +1.22 | 33.8206 |
| wildcard dispatch ×1000 (ms, lower is better) | 6.5 | 6.7 | +0.20 | 0.1 |
| publishBatch ×1000 (ms, lower is better) | 4.2 | 4 | -0.20 | 0.4 |
| dedup ×1000 (ms, lower is better) | 15.5 | 13.9 | -1.60 | 0 |
| trace + publish ×1000 (ms, lower is better) | 5.8 | 5.3 | -0.50 | 4.8 |
| first-packet cold dispatch (ms, lower is better) | 0 | 0 | +0.00 | 0 |
<!-- BENCH-TREND:END -->

说明：

- publish 行测量完整演示链路（发布点击 → transport → 演示服务器 → EVENT 扇出 → 接收方指标），包含真实浏览器与服务器延迟；databus 行是页内热路径微基准。
- 回归信号是多轮持续上移，而不是单次离群值。打 tag 发布前，应排查对应窗口内的热路径改动。
