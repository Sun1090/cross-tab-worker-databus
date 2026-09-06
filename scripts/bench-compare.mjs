/**
 * Compare two archived browser benchmark reports (see bench-browser.mjs's
 * bench-results/ output). Prints per-metric deltas so local trend checks can
 * catch regressions before they reach CI.
 *
 * Usage: node scripts/bench-compare.mjs [options] [older.json] [newer.json]
 *   --fail-above-pct <N>   exit non-zero when a latency metric regresses by
 *                          more than N% (used as a benchmark gate).
 * With no report paths, compares the two most recent reports in bench-results/.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const resultsDir = resolve('bench-results');
const listJson = () =>
  readdirSync(resultsDir)
    .filter(name => name.startsWith('browser-') && name.endsWith('.json'))
    .sort();

const argv = process.argv.slice(2);
let failPct = null;
const positional = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--fail-above-pct') {
    failPct = Number(argv[index + 1]);
    index += 1;
  } else {
    positional.push(argv[index]);
  }
}

const [olderArg, newerArg] = positional;
const files = olderArg && newerArg ? positional : listJson().slice(-2).map(name => join(resultsDir, name));
if (files.length < 2) {
  console.error('Need two reports: pass paths or run bench-browser.mjs twice first.');
  process.exit(1);
}

const load = file => JSON.parse(readFileSync(file, 'utf8'));
const older = load(files[0]);
const newer = load(files[1]);

const rows = [];
for (const result of newer.results) {
  const before = older.results.find(item => item.mode === result.mode);
  if (before) rows.push([`publish/${result.mode}/perMessageMs`, before.perMessageMs, result.perMessageMs]);
}
for (const [key, after] of Object.entries(newer.databus.timings)) {
  const before = older.databus.timings[key];
  if (before !== undefined) rows.push([`databus/${key}`, before, after]);
}

console.log(`older: ${files[0]}`);
console.log(`newer: ${files[1]}`);
console.log('');
const regressions = [];
for (const [metric, before, after] of rows) {
  const delta = after - before;
  const pct = before === 0 ? 'n/a' : `${((delta / before) * 100).toFixed(1)}%`;
  const marker = delta > 0 ? '+' : '';
  console.log(`${metric.padEnd(32)} ${String(before).padStart(8)} -> ${String(after).padStart(8)}  (${marker}${Number(delta.toFixed(2))} ms, ${pct})`);
  if (
    failPct !== null &&
    before > 0.01 &&
    ((after - before) / before) * 100 > failPct
  ) {
    regressions.push(`${metric}: +${(((after - before) / before) * 100).toFixed(1)}% > ${failPct}%`);
  }
}
if (failPct === null) process.exit(0);
if (regressions.length > 0) {
  console.error(`\n[bench] FAIL: ${failPct}% regression threshold exceeded`);
  for (const item of regressions) console.error(`  - ${item}`);
  process.exit(1);
}
console.log(`\n[bench] OK: no metric regressed more than ${failPct}%`);
