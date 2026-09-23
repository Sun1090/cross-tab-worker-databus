<!-- 由 scripts/bench-trend.mjs 生成 —— 整个文件均为机器生成，请修改脚本而非本文档。 -->

# 浏览器基准趋势

> 数据截至 2026-09-23，基于 71 份归档的 `bench-results/browser-*.json` 报告（运行 `pnpm bench:browser` 追加一份；用 `node scripts/bench-trend.mjs` 重新生成本文档）。

发布门禁的对比基线是 `pnpm bench:compare --fail-above-pct 50`：将最新报告与其之前若干报告中同一指标的中位数比较（50% 上限用于吸收共享 runner 的噪声；此前只看"上一份报告"并不稳定，因为页内热路径指标在同一份代码上会在快/慢两档之间来回跳）。本文记录长期趋势：数值为逐指标延迟，越低越好；最后一列是最近 5 份报告内的最优值，而不是历史纪录——页内基准矩阵在 2026 年 9 月初变更过测量语义，更早的报告不可比。

<!-- BENCH-TREND:BEGIN (machine-generated table) -->
| 指标 | 上次 (ms) | 本次 (ms) | Δ | 近 5 次最优 (ms) |
|---|---|---|---|---|
| publish per-message (ms, lower is better) — dedicated | 55.4416 | 50.6133 | -4.83 | 50.6133 |
| publish per-message (ms, lower is better) — shared | 58.2441 | 33.8955 | -24.35 | 33.8955 |
| wildcard dispatch ×1000 (ms, lower is better) | 5.2 | 5.7 | +0.50 | 5.2 |
| publishBatch ×1000 (ms, lower is better) | 3.5 | 3.7 | +0.20 | 3.5 |
| dedup ×1000 (ms, lower is better) | 13 | 11 | -2.00 | 11 |
| trace + publish ×1000 (ms, lower is better) | 4.6 | 4.7 | +0.10 | 4.6 |
| first-packet cold dispatch (ms, lower is better) | 0 | 0 | +0.00 | 0 |
<!-- BENCH-TREND:END -->

说明：

- publish 行测量完整演示链路（发布点击 → transport → 演示服务器 → EVENT 扇出 → 接收方指标），包含真实浏览器与服务器延迟；databus 行是页内热路径微基准。
- 回归信号是多轮持续上移，而不是单次离群值。打 tag 发布前，应排查对应窗口内的热路径改动。
