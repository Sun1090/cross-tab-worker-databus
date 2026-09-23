/**
 * Generate docs/benchmarks.md (and the Chinese mirror) from archived
 * bench-results/browser-*.json reports, so the browser benchmark trend is a
 * reviewed artifact instead of tribal knowledge.
 *
 * For each metric the doc shows the most recent value, the previous archived
 * value, the delta, and a running all-time best.
 *
 * The output is a pure function of the archived reports — including the
 * "data through" stamp, which comes from the latest report's own timestamp
 * rather than the wall clock. Re-running with no new report is therefore a
 * no-op diff; stamping `new Date()` made the doc change every day for no
 * reason and implied fresh data that did not exist.
 *
 * The whole file is machine-generated: the prose lives here, not in the doc,
 * so hand-edits to docs/benchmarks.md are overwritten on the next run.
 *
 * Usage: node scripts/bench-trend.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS = {
  publish: [
    { path: 'perMessageMs', label: 'publish per-message (ms, lower is better)', note: 'measured per worker mode (dedicated / shared)' }
  ],
  databus: [
    { path: 'wildcardDispatch1000Ms', label: 'wildcard dispatch ×1000 (ms, lower is better)' },
    { path: 'publishBatch1000Ms', label: 'publishBatch ×1000 (ms, lower is better)' },
    { path: 'dedup1000Ms', label: 'dedup ×1000 (ms, lower is better)' },
    { path: 'traceAndPublish1000Ms', label: 'trace + publish ×1000 (ms, lower is better)' },
    { path: 'firstPacketMs', label: 'first-packet cold dispatch (ms, lower is better)' }
  ]
};

/** Flatten one report into `metricKey → value` entries (mode-suffixed for publish). */
function collect(report) {
  const entries = {};
  for (const result of report.results ?? []) {
    entries[`publish/${result.mode}`] = result.perMessageMs;
  }
  for (const [key, value] of Object.entries(report.databus?.timings ?? {})) {
    entries[`databus/${key}`] = value;
  }
  return entries;
}

/**
 * How many of the most recent reports the "best" column considers.
 *
 * A whole-archive minimum is not a health signal here: the in-page benchmark
 * matrix changed measurement semantics twice in early September 2026 (it first
 * measured no-ops at all, then measured `publishBatch` without a server echo),
 * and no report records which harness produced it. The archived best column
 * therefore published an impossible `dedup ×1000 = 0 ms` next to a 25 ms latest
 * value. A short rolling window keeps the column a "what this machine just
 * achieved" reference and never compares across a semantics change.
 */
const BEST_WINDOW = 5;

/**
 * The date the latest report was produced: its own `generatedAt` when present,
 * otherwise the date embedded in the `browser-<ISO>.json` filename. Derived
 * from the data so regeneration is deterministic.
 */
function reportDate(entry) {
  const fromGeneratedAt = /^(\d{4}-\d{2}-\d{2})/.exec(String(entry.report?.generatedAt ?? ''))?.[1];
  if (fromGeneratedAt) return fromGeneratedAt;
  return /^browser-(\d{4}-\d{2}-\d{2})/.exec(entry.name)?.[1] ?? 'unknown';
}

function buildTable(entries, cur, prev, best, locale) {
  const th = locale === 'zh'
    ? ['指标', '上次 (ms)', '本次 (ms)', 'Δ', `近 ${BEST_WINDOW} 次最优 (ms)`]
    : ['Metric', 'Previous (ms)', 'Latest (ms)', 'Δ', `Best of last ${BEST_WINDOW} runs (ms)`];
  const lines = [
    `| ${th[0]} | ${th[1]} | ${th[2]} | ${th[3]} | ${th[4]} |`,
    `|---|---|---|---|---|`
  ];
  for (const [group, metrics] of Object.entries(METRICS)) {
    for (const metric of metrics) {
      if (group === 'publish') {
        for (const mode of ['dedicated', 'shared']) {
          const key = `${group}/${mode}`;
          if (cur[key] === undefined) continue;
          const delta = prev[key] === undefined ? 'n/a' : `${cur[key] - prev[key] >= 0 ? '+' : ''}${(cur[key] - prev[key]).toFixed(2)}`;
          lines.push(`| ${metric.label} — ${mode} | ${prev[key] ?? 'n/a'} | ${cur[key]} | ${delta} | ${best[key]} |`);
        }
        continue;
      }
      const key = `${group}/${metric.path}`;
      if (cur[key] === undefined) continue;
      const delta = prev[key] === undefined ? 'n/a' : `${cur[key] - prev[key] >= 0 ? '+' : ''}${(cur[key] - prev[key]).toFixed(2)}`;
      lines.push(`| ${metric.label} | ${prev[key] ?? 'n/a'} | ${cur[key]} | ${delta} | ${best[key]} |`);
    }
  }
  return lines.join('\n');
}

/**
 * Render both language variants from an ordered list of `{ name, report }`
 * entries (oldest first). Pure: the same entries always produce the same text.
 * Throws when fewer than two reports are supplied (a delta needs a baseline).
 */
export function buildDocs(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error('Need at least two archived reports in bench-results/ (run pnpm bench:browser twice).');
  }

  const current = entries.at(-1);
  const previous = entries.at(-2);

  // Best per metric over the most recent `BEST_WINDOW` reports (min, since
  // every metric is a latency where lower is better).
  const best = {};
  for (const { report } of entries.slice(-BEST_WINDOW)) {
    for (const [key, value] of Object.entries(collect(report))) {
      if (typeof value === 'number' && (best[key] === undefined || value < best[key])) best[key] = value;
    }
  }

  const stamp = reportDate(current);
  const cur = collect(current.report);
  const prev = collect(previous.report);
  const count = entries.length;

  const en = [
    '<!-- Generated by scripts/bench-trend.mjs — the whole file is machine-generated; edit the script, not this doc. -->',
    '',
    '# Browser Benchmark Trend',
    '',
    `> Data through ${stamp}, from the ${count} archived \`bench-results/browser-*.json\` reports (run \`pnpm bench:browser\` to add one; regenerate this doc with \`node scripts/bench-trend.mjs\`).`,
    '',
    'The comparison baseline for release gating is `pnpm bench:compare --fail-above-pct 50`, which compares the newest report against the median of the same metric in the preceding reports *and* requires the new value to exceed the highest of those samples (50% ceiling absorbs shared-runner noise; a single previous report was a fragile baseline because the in-page hot-path metrics alternate between a fast and a slow mode on identical code — and a median over an alternating sample is only stable while the modes are mixed, so a percentage alone can still fail on nothing but a mode shift. Metrics excused by that second leg are listed as "within-baseline, not gated" rather than passing silently). This doc records the long-run picture: values are per-metric latencies where lower is better, and the last column is the best run inside the most recent ' + BEST_WINDOW + ' reports — not an all-time record, because the in-page matrix changed measurement semantics in early September 2026 and older reports are not comparable.',
    '',
    '<!-- BENCH-TREND:BEGIN (machine-generated table) -->',
    buildTable(entries, cur, prev, best, 'en'),
    '<!-- BENCH-TREND:END -->',
    '',
    'Notes:',
    '',
    '- publish rows measure the full demo round-trip (publish click → transport → demo server → EVENT fan-out → receiver metric), so they include real browser and server latency; the databus rows are in-page hot-path microbenchmarks.',
    '- A sustained upward drift across several runs — not a single outlier — is the regression signal. Investigate the hot-path changes in that window before tagging a release.'
  ].join('\n');

  const zh = [
    '<!-- 由 scripts/bench-trend.mjs 生成 —— 整个文件均为机器生成，请修改脚本而非本文档。 -->',
    '',
    '# 浏览器基准趋势',
    '',
    `> 数据截至 ${stamp}，基于 ${count} 份归档的 \`bench-results/browser-*.json\` 报告（运行 \`pnpm bench:browser\` 追加一份；用 \`node scripts/bench-trend.mjs\` 重新生成本文档）。`,
    '',
    '发布门禁的对比基线是 `pnpm bench:compare --fail-above-pct 50`：将最新报告与其之前若干报告中同一指标的中位数比较，*并且*要求新值超过这些样本中的最大值（50% 上限用于吸收共享 runner 的噪声；此前只看"上一份报告"并不稳定，因为页内热路径指标在同一份代码上会在快/慢两档之间来回跳；而在两档交替的样本上，中位数只有在这两档混合分布时才稳定，因此单看百分比仍可能纯粹因为档位切换而失败）。被第二个条件放过的指标会显式列在 “within-baseline, not gated” 里，而不是悄悄算作通过。本文记录长期趋势：数值为逐指标延迟，越低越好；最后一列是最近 ' + BEST_WINDOW + ' 份报告内的最优值，而不是历史纪录——页内基准矩阵在 2026 年 9 月初变更过测量语义，更早的报告不可比。',
    '',
    '<!-- BENCH-TREND:BEGIN (machine-generated table) -->',
    buildTable(entries, cur, prev, best, 'zh'),
    '<!-- BENCH-TREND:END -->',
    '',
    '说明：',
    '',
    '- publish 行测量完整演示链路（发布点击 → transport → 演示服务器 → EVENT 扇出 → 接收方指标），包含真实浏览器与服务器延迟；databus 行是页内热路径微基准。',
    '- 回归信号是多轮持续上移，而不是单次离群值。打 tag 发布前，应排查对应窗口内的热路径改动。'
  ].join('\n');

  return { en, zh };
}

/** Read every archived report, oldest first. */
export function readReports(resultsDir) {
  const files = readdirSync(resultsDir)
    .filter(name => name.startsWith('browser-') && name.endsWith('.json'))
    .sort();
  return files.map(name => ({
    name,
    report: JSON.parse(readFileSync(join(resultsDir, name), 'utf8'))
  }));
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const resultsDir = resolve('bench-results');
  const entries = readReports(resultsDir);
  if (entries.length < 2) {
    console.error('Need at least two archived reports in bench-results/ (run pnpm bench:browser twice).');
    process.exit(1);
  }
  const { en, zh } = buildDocs(entries);
  writeFileSync(resolve('docs/benchmarks.md'), `${en}\n`);
  writeFileSync(resolve('docs/zh/benchmarks.md'), `${zh}\n`);
  console.log(
    `docs/benchmarks.md + docs/zh/benchmarks.md generated from ${entries.length} reports (latest: ${entries.at(-1).name}).`
  );
}
