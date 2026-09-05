/**
 * Compare two archived browser benchmark reports (see bench-browser.mjs's
 * bench-results/ output). Prints per-metric deltas so local trend checks can
 * catch regressions before they reach CI.
 *
 * Usage: node scripts/bench-compare.mjs [older.json] [newer.json]
 * With no arguments, compares the two most recent reports in bench-results/.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const resultsDir = resolve('bench-results');
const listJson = () =>
  readdirSync(resultsDir)
    .filter(name => name.startsWith('browser-') && name.endsWith('.json'))
    .sort();

const [olderArg, newerArg] = process.argv.slice(2);
const files = olderArg && newerArg ? [olderArg, newerArg] : listJson().slice(-2).map(name => join(resultsDir, name));
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
for (const [metric, before, after] of rows) {
  const delta = after - before;
  const pct = before === 0 ? 'n/a' : `${((delta / before) * 100).toFixed(1)}%`;
  const marker = delta > 0 ? '+' : '';
  console.log(`${metric.padEnd(32)} ${String(before).padStart(8)} -> ${String(after).padStart(8)}  (${marker}${Number(delta.toFixed(2))} ms, ${pct})`);
}
