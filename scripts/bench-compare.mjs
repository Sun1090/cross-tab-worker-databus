/**
 * Compare two archived browser benchmark reports (see bench-browser.mjs's
 * bench-results/ output). Prints per-metric deltas so local trend checks can
 * catch regressions before they reach CI.
 *
 * Usage: node scripts/bench-compare.mjs [options] [older.json] [newer.json]
 *   --fail-above-pct <N>   exit non-zero when a latency metric regresses by
 *                          more than N% (used as a benchmark gate).
 * With no report paths, compares the two most recent reports in bench-results/.
 *
 * The threshold is validated rather than coerced: `Number('abc')` is `NaN`, and
 * every `pct > NaN` comparison is false, so a typo in the release-gate flag used
 * to silently pass the gate instead of failing loudly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Per-metric `[label, before, after]` rows present in both reports. */
export function compareReports(older, newer) {
  const rows = [];
  for (const result of newer.results ?? []) {
    const before = (older.results ?? []).find(item => item.mode === result.mode);
    if (before) rows.push([`publish/${result.mode}/perMessageMs`, before.perMessageMs, result.perMessageMs]);
  }
  for (const [key, after] of Object.entries(newer.databus?.timings ?? {})) {
    const before = older.databus?.timings?.[key];
    if (before !== undefined) rows.push([`databus/${key}`, before, after]);
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

/** The two most recent archived reports in `resultsDir`, oldest first. */
export function latestReports(resultsDir) {
  return readdirSync(resultsDir)
    .filter(name => name.startsWith('browser-') && name.endsWith('.json'))
    .sort()
    .slice(-2)
    .map(name => join(resultsDir, name));
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const resultsDir = resolve('bench-results');
  const { failPct, positional } = parseArgs(process.argv.slice(2));

  const files = positional.length === 2 ? positional : latestReports(resultsDir);
  if (files.length < 2) {
    console.error('Need two reports: pass paths or run bench-browser.mjs twice first.');
    process.exit(1);
  }

  const load = file => JSON.parse(readFileSync(file, 'utf8'));
  const older = load(files[0]);
  const newer = load(files[1]);
  const rows = compareReports(older, newer);

  console.log(`older: ${files[0]}`);
  console.log(`newer: ${files[1]}`);
  console.log('');
  for (const [metric, before, after] of rows) {
    const delta = after - before;
    const pct = before === 0 ? 'n/a' : `${((delta / before) * 100).toFixed(1)}%`;
    const marker = delta > 0 ? '+' : '';
    console.log(
      `${metric.padEnd(32)} ${String(before).padStart(8)} -> ${String(after).padStart(8)}  (${marker}${Number(delta.toFixed(2))} ms, ${pct})`
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
