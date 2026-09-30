/**
 * Compare archived browser benchmark reports (see bench-browser.mjs's
 * bench-results/ output). Prints per-metric deltas so local trend checks can
 * catch regressions before they reach CI.
 *
 * Usage: node scripts/bench-compare.mjs [options] [older.json] [newer.json]
 *   --fail-above-pct <N>   exit non-zero when a latency metric regresses by
 *                          more than N% *and* lands beyond the highest value in
 *                          its baseline window (used as a benchmark gate).
 * With no report paths, compares the newest report in bench-results/ against the
 * per-metric median of the preceding reports; two explicit paths compare those
 * two reports directly.
 *
 * The threshold is validated rather than coerced: `Number('abc')` is `NaN`, and
 * every `pct > NaN` comparison is false, so a typo in the release-gate flag used
 * to silently pass the gate instead of failing loudly.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * A comparison row is `[label, baseline, current, ceiling]`.
 *
 * `ceiling` is the largest baseline sample the row's baseline was summarised
 * from, or `null` when no such history exists (the explicit two-report path).
 * `findRegressions` needs it to tell "beyond everything recently measured" from
 * "beyond the summary of it" — the two are not the same on a multi-modal metric.
 */

/** Rows comparing two reports directly. No history, so no ceiling. */
export function compareReports(older, newer) {
  const before = new Map(reportMetrics(older));
  const rows = [];
  for (const [label, after] of reportMetrics(newer)) {
    const previous = before.get(label);
    if (previous !== undefined) rows.push([label, previous, after, null]);
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
 * It does not, on its own, make a multi-modal metric gateable, and that is the
 * gap the `ceiling` in each row exists to close. A median over five bimodal
 * samples is stable only while the modes are mixed: when several consecutive
 * reports land in the same mode the *median itself* jumps, which is how the same
 * tree read +121% against one baseline and -56.7% against another minutes apart
 * (both measured on a comment-only branch). `ceiling` is the largest value the
 * baseline summarises, so `findRegressions` can ask the question the percentage
 * cannot: is this number beyond everything recently observed, or only beyond the
 * summary?
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
    rows.push([label, median(history), current, Math.max(...history)]);
  }
  return rows;
}

/**
 * The load reading `bench-browser.mjs` records for each report, normalized.
 *
 * Reports archived before the field existed have none, and they are the whole
 * archive today — so this returns `null` for them rather than treating "absent"
 * as zero, which would make every old sample look like an idle host and every
 * new sample like a regression against it.
 */
export function reportLoad(report) {
  const load = report?.host?.loadavg1m;
  return typeof load === 'number' && Number.isFinite(load) && load >= 0 ? load : null;
}

/**
 * The core count `bench-browser.mjs` records beside the load reading, or `null`
 * where the platform publishes no finite one.
 *
 * This is the only *machine-relative* scale available, which is what the
 * no-baseline leg of `loadVerdict` needs: a load average is not a number
 * without it, and a ratio against other machines' readings is not available
 * when no other reading exists.
 */
export function reportCpus(report) {
  const cpus = report?.host?.cpus;
  return typeof cpus === 'number' && Number.isFinite(cpus) && cpus > 0 ? cpus : null;
}

/**
 * Judge a newest sample's host load against the baseline samples that recorded
 * one, and return a verdict string or `null`.
 *
 * The reason this exists: `compareAgainstBaseline` can only judge a report
 * against the previous five, so a sample taken on a loaded host — the *fast*
 * direction, which is what a warm-but-busy or cached state produces — enters the
 * baseline and becomes the reference for the next five comparisons. The deferral
 * rule that prevents that lived only in `docs/progress.md` and in a human
 * remembering it, and it slipped for ten cycles and 24 tags.
 *
 * The threshold is a **ratio against the baseline's own median**, not an
 * absolute number, because the archive spans machines and a load average means
 * nothing without its core count: a value that is unremarkable for a 32-core
 * host is a stall on a 4-core one, and any absolute ceiling would be wrong on one
 * of them. `POISON_LOAD_RATIO` is deliberately generous — 4× — because the cost
 * of a false positive is one deferred run and the cost of a false negative is a
 * corrupted baseline that silently corrupts the next five readings. It is a
 * refusal to trust, not a claim that the sample is invalid.
 *
 * Returns a human-readable reason (so the caller can print *why*) or `null` when
 * the sample is admissible: no reading on the new report (nothing to judge), a
 * reading within the ratio, a reading at or under the core count when nothing
 * can be compared against it, or genuinely nothing to judge on a platform that
 * publishes neither a reading nor a core count.
 */
export const POISON_LOAD_RATIO = 4;

export function loadVerdict(newest, baselineReports) {
  const load = reportLoad(newest);
  if (load === null) return null;
  const baseline = baselineReports
    .slice(-BASELINE_SAMPLES)
    .map(reportLoad)
    .filter(value => value !== null);
  if (baseline.length === 0) return idleVerdict(newest, load);
  const reference = median(baseline);
  if (reference <= 0) return `load ${load.toFixed(2)} with a baseline median of ${reference} — not comparable`;
  if (load <= reference * POISON_LOAD_RATIO) return null;
  return (
    `host load ${load.toFixed(2)} is ${(load / reference).toFixed(1)}x the baseline median ` +
    `(${reference.toFixed(2)}) over ${baseline.length} recorded sample(s) — above the ` +
    `${POISON_LOAD_RATIO}x refusal to trust, so this report will not be trusted as a baseline`
  );
}

/**
 * The no-baseline leg: what to do when the archive holds no reading to compare
 * against, which is the archive's *entire current state* — all 91 reports
 * predate the field.
 *
 * Returning `null` here is the one behavior that made the guard inert on the
 * series it exists to protect, and the reason is worth recording because it
 * reads like prudence. "No comparable baseline, so refusing would lock the gate
 * out of the very archive it is meant to protect" is a mechanism argument, and
 * it does not survive the case that actually occurs: the next sample on a loaded
 * host finds no baseline, is admitted, and *becomes* the baseline every later
 * comparison is judged against. The gate was therefore weakest exactly where the
 * archive is weakest, and a first sample on a busy host is the sample that ends
 * a twenty-five-tag deferral streak.
 *
 * So the fallback is an absolute, machine-relative ceiling instead: a 1-minute
 * load average above the core count means more runnable work than cores, which
 * is the definition of oversubscribed and needs no history to establish. The
 * boundary is inclusive for the same reason the ratio's is — this is a refusal
 * to trust, not a claim the sample is invalid, and a false positive costs one
 * deferred run.
 *
 * With neither a baseline nor a core count there is genuinely nothing to judge
 * and this returns `null`: on such a platform the reading is absent rather than
 * favorable, and refusing blind would be refusing on a premise the record does
 * not support.
 */
function idleVerdict(newest, load) {
  const cpus = reportCpus(newest);
  if (cpus === null) return null;
  if (load <= cpus) return null;
  return (
    `host load ${load.toFixed(2)} exceeds the host's ${cpus} core(s) and no archived report ` +
    `records a reading to compare against — above the ${cpus} that means more runnable work ` +
    `than cores, so there is no idle reference for this sample and it is refused`
  );
}

/**
 * Descriptions of every metric that regressed past `failPct` **and** past the
 * largest value its own baseline recorded. Metrics whose baseline is effectively
 * zero are skipped (a percentage change from ~0 is meaningless); `failPct ===
 * null` disables the gate entirely.
 *
 * The second condition is what keeps the gate honest on a multi-modal metric:
 * +139% over a median that happens to sit in the other mode is not evidence of a
 * regression if the new number is still below every sample the baseline came
 * from. It is also an explicit limit — a *sustained* shift that stays inside the
 * observed range is invisible to this gate, and the only way to shrink that
 * blind spot is more history, not a tighter percentage.
 */
export function findRegressions(rows, failPct) {
  if (failPct === null) return [];
  const regressions = [];
  for (const row of rows) {
    if (!exceedsPct(row, failPct) || !beyondBaseline(row)) continue;
    const [metric, before, after] = row;
    regressions.push(`${metric}: +${(((after - before) / before) * 100).toFixed(1)}% > ${failPct}%`);
  }
  return regressions;
}

/**
 * Descriptions of the rows the percentage alone would have failed but the
 * baseline range excuses — the suppressed set, printed so a reader sees which
 * metrics currently carry no gateable signal rather than inferring it from the
 * absence of a failure.
 */
export function findWithinBaseline(rows, failPct) {
  if (failPct === null) return [];
  const suppressed = [];
  for (const row of rows) {
    if (!exceedsPct(row, failPct) || beyondBaseline(row)) continue;
    const [metric, before, after, ceiling] = row;
    suppressed.push(
      `${metric}: +${(((after - before) / before) * 100).toFixed(1)}%, within the ${ceiling} ms observed since the baseline was taken`
    );
  }
  return suppressed;
}

/** Percentage-delta leg of the gate, shared so both verdicts read one rule. */
function exceedsPct([, before, after], failPct) {
  return before > 0.01 && ((after - before) / before) * 100 > failPct;
}

/** Absolute leg: `ceiling === null` means no history exists to consult, which is
 * the explicit two-report path, so the percentage is all there is. */
function beyondBaseline([, , after, ceiling]) {
  return ceiling === null || after > ceiling;
}

/**
 * The `limit` most recent archived reports in `resultsDir`, oldest first.
 *
 * A directory that cannot be listed is an **empty archive**, not an error, and
 * that is a correction rather than a convenience: the first `bench:browser` on a
 * clean checkout has no `bench-results/` at all, so the reader this gates the
 * write behind would have thrown on the one run that is supposed to create it.
 * The same tolerance covers a path that is not a directory, which is what a
 * failed write looks like from here. Both reduce the judgment available — no
 * baseline to compare against — rather than fail a run whose numbers were
 * already produced.
 */
export function latestReports(resultsDir, limit = 2) {
  let names;
  try {
    names = readdirSync(resultsDir);
  } catch {
    return [];
  }
  return names
    .filter(name => name.startsWith('browser-') && name.endsWith('.json'))
    .sort()
    .slice(-limit)
    .map(name => join(resultsDir, name));
}

/**
 * Admit a freshly taken sample to the archive, or refuse it, and say which.
 *
 * This is the function that closes the gap the comparison-side refusal could not.
 * `loadVerdict` above refuses to *trust* a loaded report, but a report already on
 * disk is a report the next comparison reads as its baseline — so a refusal
 * applied after the write labels a sample that has already entered the archive,
 * and on this archive (no recorded readings at all) the next comparison is the
 * very next sample. Hence one function that decides *and* writes, so a refusal
 * is a file that does not exist rather than a verdict printed about one that does.
 *
 * The three outcomes are kept distinct because they mean different things to a
 * caller: a **refusal** is a judgment about the host and the run should report
 * failure, while a **write failure** is a broken disk and the benchmark itself
 * succeeded — the run has already produced its numbers, and conflating the two
 * would make a full volume fail a release over a sample that was correctly taken
 * and simply could not be saved.
 */
export function archiveReport(report, resultsDir, limit = BASELINE_SAMPLES) {
  const refusal = loadVerdict(report, archiveLoads(resultsDir, limit));
  if (refusal !== null) return { archived: false, refusal, warning: null };
  try {
    mkdirSync(resultsDir, { recursive: true });
    // The report's own `generatedAt` rather than a second clock read here: one
    // timestamp for the sample, so the filename and the body cannot disagree.
    const stamp = (report.generatedAt ?? new Date().toISOString()).replace(/[:.]/g, '-');
    writeFileSync(join(resultsDir, `browser-${stamp}.json`), JSON.stringify(report, null, 2));
    return { archived: true, refusal: null, warning: null };
  } catch (error) {
    return { archived: false, refusal: null, warning: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The archived reports that actually record a load reading, oldest first, so a
 * caller deciding whether to archive a fresh sample consults the same rule the
 * comparison will.
 *
 * Two filters, and each earns its place. Reports with no reading are dropped
 * because the whole archive predates the field, and including them would either
 * fail to parse or read as zero — the `reportLoad` contract already says absent
 * is unknown rather than idle, and this is where that has to be applied. Files
 * that no longer parse are skipped rather than thrown, because a truncated write
 * or a hand-edited report must not take the benchmark run down with it; a
 * missing baseline is a weaker judgment, never a failed run.
 */
export function archiveLoads(resultsDir, limit = BASELINE_SAMPLES) {
  const reports = [];
  for (const file of latestReports(resultsDir, limit)) {
    let report;
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (reportLoad(report) !== null) reports.push(report);
  }
  return reports;
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
  // A comparison that scored no metric has no verdict to give, and the closing line
  // below would otherwise print `OK: no metric regressed` over an empty table. Both
  // paths can get here: `compareAgainstBaseline` skips any metric with no preceding
  // sample, so when the newest report's labels share nothing with the archive's — a
  // renamed `reportMetrics` label, a report written by a different generator — every
  // metric is skipped and the run is silent rather than empty-by-legitimacy. The
  // first run of a fresh archive cannot reach this: the `files.length < 2` guard above
  // already exits on fewer than two reports.
  if (rows.length === 0) {
    console.error(
      `[bench] no metric in ${explicitPair ? 'the newer report' : 'the newest report'} has a baseline ` +
      'sample, so nothing was compared — check that the metric labels still line up'
    );
    process.exit(1);
  }

  if (explicitPair) {
    console.log(`older: ${files[0]}`);
    console.log(`newer: ${files[1]}`);
  } else {
    console.log(`newer: ${files.at(-1)}`);
    console.log(
      `baseline: median of the preceding ${files.length - 1} report(s) per metric; ` +
      'the gate also requires beating the highest of those samples'
    );
    // Refuse to *trust* a sample taken on a loaded host before its numbers are
    // compared, because a fast sample under load enters the baseline and becomes
    // the reference for the next five comparisons. Reports predating the `host`
    // field have nothing to judge, and so does a newest report with no reading —
    // both are silent, which is why the standing rule also names the archive's
    // vintage in `docs/benchmarks.md`.
    const newest = files.at(-1);
    const verdict = loadVerdict(load(newest), files.slice(0, -1).map(load));
    if (verdict !== null) {
      console.log('');
      console.log(`[bench] NOT TRUSTED: ${verdict}`);
      console.log('[bench] the numbers below are printed for diagnosis; re-run on an idle host');
      process.exit(1);
    }
  }
  console.log('');
  for (const [metric, before, after, ceiling] of rows) {
    const baseline = Number.isInteger(before) ? before : Number(before.toFixed(3));
    const delta = after - before;
    const pct = before === 0 ? 'n/a' : `${((delta / before) * 100).toFixed(1)}%`;
    const marker = delta > 0 ? '+' : '';
    const range = ceiling === null ? '' : `  [max ${ceiling}]`;
    console.log(
      `${metric.padEnd(32)} ${String(baseline).padStart(8)} -> ${String(after).padStart(8)}  (${marker}${Number(delta.toFixed(2))} ms, ${pct})${range}`
    );
  }

  if (failPct === null) process.exit(0);
  const suppressed = findWithinBaseline(rows, failPct);
  if (suppressed.length > 0) {
    console.log(`\n[bench] within-baseline, not gated:`);
    for (const item of suppressed) console.log(`  - ${item}`);
  }
  const regressions = findRegressions(rows, failPct);
  if (regressions.length > 0) {
    console.error(`\n[bench] FAIL: ${failPct}% regression threshold exceeded`);
    for (const item of regressions) console.error(`  - ${item}`);
    process.exit(1);
  }
  console.log(`\n[bench] OK: no metric regressed more than ${failPct}%`);
}
