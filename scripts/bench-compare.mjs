/**
 * Compare archived browser benchmark reports (see bench-browser.mjs's
 * bench-results/ output). Prints per-metric deltas so local trend checks can
 * catch regressions before they reach CI.
 *
 * Usage: node scripts/bench-compare.mjs [options] [older.json] [newer.json]
 *   --fail-above-pct <N>   exit non-zero when a latency metric regresses by
 *                          more than N% (used as a benchmark gate).
 * With no report paths, compares the newest report in bench-results/ against the
 * per-metric median of the preceding reports; two explicit paths compare those
 * two reports directly.
 *
 * The threshold is validated rather than coerced: `Number('abc')` is `NaN`, and
 * every `pct > NaN` comparison is false, so a typo in the release-gate flag used
 * to silently pass the gate instead of failing loudly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How many preceding reports the default baseline summarises per metric. */
export const BASELINE_SAMPLES = 5;

/**
 * Parse CLI arguments. Returns the validated threshold (`null` when the gate is
 * off) and the positional report paths. Throws on a missing/non-numeric/negative
 * threshold or on a positional count other than 0 or 2.
 */
export function parseArgs(argv) {
  let failPct = null;
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--fail-above-pct') {
      const raw = argv[index + 1];
      const value = Number(raw);
      // `Number('')` is 0 and `Number('  ')` is 0, so an empty value must be
      // rejected explicitly rather than silently becoming the strictest gate.
      if (raw === undefined || raw.trim() === '' || !Number.isFinite(value) || value < 0) {
        throw new TypeError(
          `--fail-above-pct requires a non-negative finite number, got ${raw === undefined ? '(missing value)' : `"${raw}"`}`
        );
      }
      failPct = value;
      index += 1;
    } else {
      positional.push(argv[index]);
    }
  }
  if (positional.length !== 0 && positional.length !== 2) {
    throw new TypeError(`expected zero or two report paths, got ${positional.length}: ${positional.join(', ')}`);
  }
  return { failPct, positional };
}

/** Every `[label, value]` metric a single report carries. */
function reportMetrics(report) {
  const rows = [];
  for (const result of report.results ?? []) {
    rows.push([`publish/${result.mode}/perMessageMs`, result.perMessageMs]);
  }
  for (const [key, value] of Object.entries(report.databus?.timings ?? {})) {
    rows.push([`databus/${key}`, value]);
  }
  return rows;
}

/** Per-metric `[label, before, after]` rows present in both reports. */
export function compareReports(older, newer) {
  const before = new Map(reportMetrics(older));
  const rows = [];
  for (const [label, after] of reportMetrics(newer)) {
    const previous = before.get(label);
    if (previous !== undefined) rows.push([label, previous, after]);
  }
  return rows;
}

/** Median of a non-empty numeric sample; even counts average the middle two. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Rows comparing the newest report against the median of the same metric in the
 * preceding `BASELINE_SAMPLES` reports.
 *
 * The single previous report was a fragile baseline: the in-page `dedup1000Ms`
 * and `traceAndPublish1000Ms` measurements alternate between a fast and a slow
 * mode on the same code (measured 12.7 / 25.6 / 10.1 / 25.3 / 25.5 ms across
 * five consecutive runs, and 11.7–28.9 ms across the archive since 2026-09-15),
 * so one unlucky pair could fail the documented 50% gate with no code change at
 * all. A median baseline removes that false alarm *and* sharpens real signal: a
 * genuine regression is measured against typical recent runs rather than
 * whatever the last run happened to be.
 *
 * A metric with no preceding sample is skipped, matching `compareReports`.
 */
export function compareAgainstBaseline(reports) {
  const newest = reports.at(-1);
  if (newest === undefined) throw new TypeError('compareAgainstBaseline needs at least one report');
  const preceding = reports.slice(0, -1).slice(-BASELINE_SAMPLES);
  const samples = new Map();
  for (const report of preceding) {
    for (const [label, value] of reportMetrics(report)) {
      const collected = samples.get(label) ?? [];
      collected.push(value);
      samples.set(label, collected);
    }
  }
  const rows = [];
  for (const [label, current] of reportMetrics(newest)) {
    const history = samples.get(label);
    if (history === undefined || history.length === 0) continue;
    rows.push([label, median(history), current]);
  }
  return rows;
}

/**
 * Descriptions of every metric that regressed past `failPct`. Metrics whose
 * baseline is effectively zero are skipped (a percentage change from ~0 is
 * meaningless); `failPct === null` disables the gate entirely.
 */
export function findRegressions(rows, failPct) {
  if (failPct === null) return [];
  const regressions = [];
  for (const [metric, before, after] of rows) {
    if (before > 0.01 && ((after - before) / before) * 100 > failPct) {
      regressions.push(`${metric}: +${(((after - before) / before) * 100).toFixed(1)}% > ${failPct}%`);
    }
  }
  return regressions;
}

/** The `limit` most recent archived reports in `resultsDir`, oldest first. */
export function latestReports(resultsDir, limit = 2) {
  return readdirSync(resultsDir)
    .filter(name => name.startsWith('browser-') && name.endsWith('.json'))
    .sort()
    .slice(-limit)
    .map(name => join(resultsDir, name));
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const resultsDir = resolve('bench-results');
  const { failPct, positional } = parseArgs(process.argv.slice(2));

  const load = file => JSON.parse(readFileSync(file, 'utf8'));
  const explicitPair = positional.length === 2;
  const files = explicitPair ? positional : latestReports(resultsDir, BASELINE_SAMPLES + 1);
  if (files.length < 2) {
    console.error('Need two reports: pass paths or run bench-browser.mjs twice first.');
    process.exit(1);
  }

  const rows = explicitPair
    ? compareReports(load(files[0]), load(files[1]))
    : compareAgainstBaseline(files.map(load));

  if (explicitPair) {
    console.log(`older: ${files[0]}`);
    console.log(`newer: ${files[1]}`);
  } else {
    console.log(`newer: ${files.at(-1)}`);
    console.log(`baseline: median of the preceding ${files.length - 1} report(s) per metric`);
  }
  console.log('');
  for (const [metric, before, after] of rows) {
    const baseline = Number.isInteger(before) ? before : Number(before.toFixed(3));
    const delta = after - before;
    const pct = before === 0 ? 'n/a' : `${((delta / before) * 100).toFixed(1)}%`;
    const marker = delta > 0 ? '+' : '';
    console.log(
      `${metric.padEnd(32)} ${String(baseline).padStart(8)} -> ${String(after).padStart(8)}  (${marker}${Number(delta.toFixed(2))} ms, ${pct})`
    );
  }

  if (failPct === null) process.exit(0);
  const regressions = findRegressions(rows, failPct);
  if (regressions.length > 0) {
    console.error(`\n[bench] FAIL: ${failPct}% regression threshold exceeded`);
    for (const item of regressions) console.error(`  - ${item}`);
    process.exit(1);
  }
  console.log(`\n[bench] OK: no metric regressed more than ${failPct}%`);
}
