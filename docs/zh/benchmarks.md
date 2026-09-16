<!-- 由 scripts/bench-trend.mjs 生成 —— 整个文件均为机器生成，请修改脚本而非本文档。 -->

# 浏览器基准趋势

> 数据截至 2026-09-16，基于 24 份归档的 `bench-results/browser-*.json` 报告（运行 `pnpm bench:browser` 追加一份；用 `node scripts/bench-trend.mjs` 重新生成本文档）。

发布门禁的对比基线是最近两份报告之间的 `pnpm bench:compare --fail-above-pct 50`（50% 上限用于吸收共享 runner 的噪声）。本文记录长期趋势：数值为逐指标延迟，越低越好；历史最优为本机观察到的最健康一次运行。

<!-- BENCH-TREND:BEGIN (machine-generated table) -->
| 指标 | 上次 (ms) | 本次 (ms) | Δ | 历史最优 (ms) |
|---|---|---|---|---|
| publish per-message (ms, lower is better) — dedicated | 42.335 | 39.5999 | -2.74 | 35.3543 |
| publish per-message (ms, lower is better) — shared | 35.806 | 34.3455 | -1.46 | 33.6784 |
| wildcard dispatch ×1000 (ms, lower is better) | 7.2 | 6.8 | -0.40 | 0.1 |
| publishBatch ×1000 (ms, lower is better) | 4.9 | 4.9 | +0.00 | 0.4 |
| dedup ×1000 (ms, lower is better) | 21.5 | 16.1 | -5.40 | 0 |
| trace + publish ×1000 (ms, lower is better) | 5.3 | 4.5 | -0.80 | 4.5 |
| first-packet cold dispatch (ms, lower is better) | 0.1 | 0 | -0.10 | 0 |
<!-- BENCH-TREND:END -->

说明：

- publish 行测量完整演示链路（发布点击 → transport → 演示服务器 → EVENT 扇出 → 接收方指标），包含真实浏览器与服务器延迟；databus 行是页内热路径微基准。
- 回归信号是多轮持续上移，而不是单次离群值。打 tag 发布前，应排查对应窗口内的热路径改动。
