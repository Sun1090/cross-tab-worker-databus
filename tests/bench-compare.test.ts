import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  archiveLoads,
  archiveReport,
  compareAgainstBaseline,
  compareReports,
  findRegressions,
  findWithinBaseline,
  latestReports,
  loadVerdict,
  median,
  parseArgs,
  POISON_LOAD_RATIO,
  reportCpus,
  reportLoad
} from '../scripts/bench-compare.mjs';
import type { BenchMetricRow, BenchReportLike } from '../scripts/bench-compare.mjs';

/**
 * `pnpm bench:compare --fail-above-pct 50` is a documented release gate (both
 * checklists). The threshold used to be `Number(...)`-coerced without checking,
 * so a typo produced `NaN` — and since every `pct > NaN` comparison is false,
 * the gate silently passed. These tests pin the loud failure.
 */

describe('bench-compare argument parsing', () => {
  it('accepts a non-negative finite threshold', () => {
    expect(parseArgs(['--fail-above-pct', '50'])).toEqual({ failPct: 50, positional: [] });
    expect(parseArgs(['--fail-above-pct', '0']).failPct).toBe(0);
    expect(parseArgs(['--fail-above-pct', '12.5']).failPct).toBe(12.5);
  });

  it('leaves the gate off when the flag is absent', () => {
    expect(parseArgs([]).failPct).toBeNull();
    expect(parseArgs(['a.json', 'b.json'])).toEqual({ failPct: null, positional: ['a.json', 'b.json'] });
  });

  it('rejects a missing, non-numeric, or negative threshold instead of coercing to NaN', () => {
    // The regression: Number('abc') is NaN, and `pct > NaN` is always false, so
    // the gate reported success for every metric.
    for (const argv of [
      ['--fail-above-pct'],
      ['--fail-above-pct', 'abc'],
      ['--fail-above-pct', ''],
      ['--fail-above-pct', '-5'],
      ['--fail-above-pct', 'Infinity'],
      ['--fail-above-pct', 'NaN']
    ]) {
      expect(() => parseArgs(argv), `argv ${JSON.stringify(argv)} must be rejected`).toThrow(
        /--fail-above-pct requires a non-negative finite number/
      );
    }
  });

  it('rejects a positional count other than zero or two', () => {
    expect(() => parseArgs(['only-one.json'])).toThrow(/expected zero or two report paths, got 1/);
    expect(() => parseArgs(['a.json', 'b.json', 'c.json'])).toThrow(/expected zero or two report paths, got 3/);
  });
});

const older: BenchReportLike = {
  results: [
    { mode: 'dedicated', perMessageMs: 10 },
    { mode: 'shared', perMessageMs: 20 }
  ],
  databus: { timings: { dedup1000Ms: 8, firstPacketMs: 0 } }
};

const newer: BenchReportLike = {
  results: [
    { mode: 'dedicated', perMessageMs: 12 },
    { mode: 'shared', perMessageMs: 18 },
    // A mode the baseline never measured must not produce a row.
    { mode: 'local', perMessageMs: 5 }
  ],
  databus: { timings: { dedup1000Ms: 9, firstPacketMs: 0 } }
};

describe('bench-compare regression gate', () => {
  it('pairs metrics present in both reports', () => {
    expect(compareReports(older, newer)).toEqual([
      ['publish/dedicated/perMessageMs', 10, 12, null],
      ['publish/shared/perMessageMs', 20, 18, null],
      ['databus/dedup1000Ms', 8, 9, null],
      ['databus/firstPacketMs', 0, 0, null]
    ]);
  });

  it('reports only regressions above the threshold', () => {
    const rows = compareReports(older, newer);
    // dedicated +20% and dedup +12.5% both exceed 10%; shared improved.
    expect(findRegressions(rows, 10)).toEqual([
      'publish/dedicated/perMessageMs: +20.0% > 10%',
      'databus/dedup1000Ms: +12.5% > 10%'
    ]);
    // A 25% ceiling lets everything through.
    expect(findRegressions(rows, 25)).toEqual([]);
  });

  it('ignores metrics whose baseline is effectively zero', () => {
    // firstPacketMs goes 0 -> 0; a percentage change from ~0 is meaningless and
    // must not blow up into a false regression.
    const rows: BenchMetricRow[] = [['databus/firstPacketMs', 0, 5, 0]];
    expect(findRegressions(rows, 1)).toEqual([]);
  });

  it('disables the gate when the threshold is null', () => {
    expect(findRegressions(compareReports(older, newer), null)).toEqual([]);
  });
});

const timed = (dedup: number, dedicated = 10): BenchReportLike => ({
  results: [{ mode: 'dedicated', perMessageMs: dedicated }],
  databus: { timings: { dedup1000Ms: dedup } }
});

describe('bench-compare median baseline', () => {
  it('medians odd and even samples regardless of input order', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([5, 1, 4, 2])).toBe(3);
    expect(median([7])).toBe(7);
  });

  it('does not fail the gate on one noisy preceding run', () => {
    // Measured on identical code across five consecutive runs: 12.7, 25.6,
    // 10.1, 25.3, 25.5 ms. Comparing the newest report with the single previous
    // one flips sign with that noise, so the documented 50% ceiling could fail
    // without any code change. The median holds the line.
    const archive = [timed(12.7), timed(25.6), timed(10.1), timed(25.3), timed(25.5), timed(13, 13)];
    const rows = compareAgainstBaseline(archive);
    expect(rows).toEqual([
      ['publish/dedicated/perMessageMs', 10, 13, 10],
      ['databus/dedup1000Ms', 25.3, 13, 25.6]
    ]);
    expect(findRegressions(rows, 50)).toEqual([]);
  });

  it('still catches a sustained regression', () => {
    // A real doubling fails even though the newest baseline run was itself
    // already drifting upward: the baseline is the median of the last five, 11.
    const archive = [timed(10), timed(11), timed(10), timed(12), timed(21), timed(22, 22)];
    const rows = compareAgainstBaseline(archive);
    expect(rows).toEqual([
      ['publish/dedicated/perMessageMs', 10, 22, 10],
      ['databus/dedup1000Ms', 11, 22, 21]
    ]);
    expect(findRegressions(rows, 50)).toEqual([
      'publish/dedicated/perMessageMs: +120.0% > 50%',
      'databus/dedup1000Ms: +100.0% > 50%'
    ]);
  });

  it('uses at most the configured number of preceding reports', () => {
    // Seven reports: only the five immediately before the newest may count, so
    // the two oldest fast runs must not drag the baseline down.
    const archive = [timed(1), timed(1), timed(30), timed(31), timed(30), timed(32), timed(30)];
    const rows = compareAgainstBaseline(archive);
    expect(rows).toEqual([
      ['publish/dedicated/perMessageMs', 10, 10, 10],
      ['databus/dedup1000Ms', 30, 30, 32]
    ]);
    expect(findRegressions(rows, 50)).toEqual([]);
  });

  it('skips a metric that has no preceding sample', () => {
    const archive: BenchReportLike[] = [timed(10), { results: [{ mode: 'brandnew', perMessageMs: 1 }] }];
    expect(compareAgainstBaseline(archive)).toEqual([]);
  });

  it('degenerates to the previous report for a two-report archive', () => {
    // With one preceding report the median is that report. The ceiling leg is
    // then identical to the percentage leg's own comparison point — the new
    // number must beat the only sample there is — so the gate keeps working
    // before the archive fills up.
    expect(compareAgainstBaseline([older, newer])).toEqual([
      ['publish/dedicated/perMessageMs', 10, 12, 10],
      ['publish/shared/perMessageMs', 20, 18, 20],
      ['databus/dedup1000Ms', 8, 9, 8],
      ['databus/firstPacketMs', 0, 0, 0]
    ]);
    expect(findRegressions(compareAgainstBaseline([older, newer]), 10)).toEqual(
      findRegressions(compareReports(older, newer), 10)
    );
  });

  it('does not gate a multi-modal metric whose swing exceeds the threshold', () => {
    // The gap the median baseline leaves open, measured on a comment-only branch
    // that read +121% and -56.7% minutes apart. History spans both modes, so the
    // median can sit in either one; a fast-median baseline plus a slow-mode newest
    // is a large percentage with no new information in it.
    const archive = [timed(11.0), timed(11.5), timed(11.6), timed(22.4), timed(26.8), timed(25.5, 10)];
    const rows = compareAgainstBaseline(archive);
    const dedup = rows.find(([label]) => label === 'databus/dedup1000Ms') as BenchMetricRow;
    expect(dedup).toEqual(['databus/dedup1000Ms', 11.6, 25.5, 26.8]);
    // +120% over the median — and still the third-fastest reading in the window.
    expect(findRegressions([dedup], 50)).toEqual([]);
    expect(findWithinBaseline([dedup], 50)).toEqual([
      'databus/dedup1000Ms: +119.8%, within the 26.8 ms observed since the baseline was taken'
    ]);
    // The same value beyond every sample in the window *is* evidence.
    expect(findRegressions([['databus/dedup1000Ms', 11.6, 27.8, 26.8]], 50)).toEqual([
      'databus/dedup1000Ms: +139.7% > 50%'
    ]);
    // A stable metric keeps full resolution: its ceiling is one sample, so the
    // percentage leg alone decides, exactly as before.
    expect(findRegressions([['databus/publishBatch1000Ms', 3.7, 5.6, 3.9]], 40)).toEqual([
      'databus/publishBatch1000Ms: +51.4% > 40%'
    ]);
  });

  it('reports nothing as suppressed when the gate is off or no metric moved', () => {
    const rows = compareAgainstBaseline([timed(10), timed(10), timed(10)]);
    expect(findWithinBaseline(rows, 50)).toEqual([]);
    expect(findWithinBaseline(compareReports(older, newer), null)).toEqual([]);
    // A two-report pair has no ceiling to hide behind, so a large swing is never
    // suppressed — the leg cannot invent history that was not passed in.
    expect(findWithinBaseline(compareReports(older, newer), 10)).toEqual([]);
  });
});


/**
 * The host-load refusal. Every report in the archive predates the `host` field,
 * so the standing rule in `docs/progress.md` — defer `bench:browser` rather than
 * sample a loaded host — was enforced by a human for ten cycles and 24 tags,
 * while `compareAgainstBaseline` can only judge a report against the previous
 * five. A *fast* sample taken under load therefore enters the baseline and
 * becomes the reference for the next five readings, and nothing in the archive
 * recorded that the host was busy. These cases pin both halves: the reading is
 * extracted when present, and a sample far above the baseline's own median is
 * refused with a reason.
 */
describe('bench-compare host load', () => {
  const withLoad = (loadavg1m: number | null): BenchReportLike =>
    loadavg1m === null ? {} : { host: { loadavg1m, cpus: 8 } };

  it('reads a finite load and treats an absent one as unknown rather than idle', () => {
    expect(reportLoad(withLoad(3.5))).toBe(3.5);
    // Every archived report today looks like this. Zero would make 91 idle-host
    // samples the baseline and every future reading a regression against it.
    expect(reportLoad(withLoad(null))).toBeNull();
    expect(reportLoad({ host: { loadavg1m: Number.NaN } })).toBeNull();
    expect(reportLoad({ host: { loadavg1m: -1 } })).toBeNull();
    expect(reportLoad(undefined)).toBeNull();
  });

  it('refuses a sample far above the baseline median and names both figures', () => {
    const verdict = loadVerdict(withLoad(20), [withLoad(1), withLoad(2), withLoad(2)]);
    expect(verdict, 'a 10x load must be refused').toBeTypeOf('string');
    expect(verdict).toContain('20.00');
    expect(verdict).toContain('(2.00)');
    // The reason is printed, so a refusal says why rather than just failing.
    expect(verdict).toContain(String(POISON_LOAD_RATIO));
  });

  it('accepts a sample within the ratio, with the boundary inclusive', () => {
    expect(loadVerdict(withLoad(3), [withLoad(1), withLoad(2), withLoad(2)])).toBeNull();
    // Exactly at the ratio is trusted: the threshold is a refusal to trust, not a
    // claim that the sample above it is invalid, so the boundary must not reject.
    expect(loadVerdict(withLoad(2 * POISON_LOAD_RATIO), [withLoad(1), withLoad(2), withLoad(2)])).toBeNull();
    expect(loadVerdict(withLoad(2 * POISON_LOAD_RATIO + 0.01), [withLoad(1), withLoad(2), withLoad(2)])).toBeTypeOf('string');
  });

  it('stays silent when there is nothing to judge, rather than refusing blindly', () => {
    // No reading on the newest report: the archive's own shape.
    expect(loadVerdict(withLoad(null), [withLoad(1), withLoad(2)])).toBeNull();
    // A median of zero cannot carry a ratio, and is said so rather than refused
    // on a division by zero.
    expect(loadVerdict(withLoad(5), [withLoad(0), withLoad(0)])).toContain('not comparable');
  });

  /**
   * The no-baseline leg, and the case the guard is weakest on: the archive
   * records no reading at all, so there is no ratio to compute. This replaces a
   * case that asserted a silent pass here, and the reason it asserted it is the
   * finding — "no comparable baseline, so refusing would lock the gate out of the
   * very archive it is meant to protect" is a mechanism argument that does not
   * survive the case that actually occurs. The next sample on a loaded host
   * finds no baseline, is admitted, and becomes the baseline every later
   * comparison is judged against; the guard was weakest exactly where the
   * archive is weakest, and a first sample on a busy host is the sample that
   * ends a twenty-five-tag deferral streak. Which is the live state: all 91
   * archived reports predate the field.
   */
  describe('with no recorded baseline to compare against', () => {
    it('refuses a load above the core count, since that is oversubscribed by definition', () => {
      const verdict = loadVerdict(withLoad(32.27), []);
      expect(verdict, '32.27 across 8 cores is 4x oversubscribed and must be refused').toBeTypeOf('string');
      expect(verdict).toContain('32.27');
      expect(verdict).toContain("8 core(s)");
      // The reason is printed, so the refusal says why rather than just failing.
      expect(verdict).toContain('no archived report');
    });

    it('admits a load at or under the core count, with the boundary inclusive', () => {
      expect(loadVerdict(withLoad(2.5), [])).toBeNull();
      // Exactly at the core count is admitted, for the same reason the ratio's
      // boundary is: a refusal to trust is not a claim the sample is invalid,
      // and a false positive costs one deferred run.
      expect(loadVerdict(withLoad(8), [])).toBeNull();
      expect(loadVerdict(withLoad(8.01), [])).toBeTypeOf('string');
    });

    it('refuses blindly neither without a reading nor without a core count', () => {
      // No reading at all: nothing to judge, and refusing here would be
      // refusing on a premise the record does not support.
      expect(loadVerdict({}, [])).toBeNull();
      // A reading with no core count: the only machine-relative scale the
      // fallback has is missing, so it declines rather than inventing one.
      expect(loadVerdict({ host: { loadavg1m: 50 } }, [])).toBeNull();
      expect(loadVerdict({ host: { loadavg1m: 50, cpus: 0 } }, [])).toBeNull();
      expect(loadVerdict({ host: { loadavg1m: 50, cpus: Number.NaN } }, [])).toBeNull();
      expect(loadVerdict({ host: { loadavg1m: 50, cpus: null } }, [])).toBeNull();
    });

    it('prefers the baseline ratio once one exists, so the fallback never shadows it', () => {
      // 50 is 25x this baseline's median, so both legs would refuse — and the
      // ratio leg must be the one that speaks, because its message is the one
      // that names a comparison. The distinguishing word is `median`.
      const withBaseline = loadVerdict(withLoad(50), [withLoad(1), withLoad(2), withLoad(2)]);
      expect(withBaseline).toContain('median');
      expect(withBaseline).not.toContain('no archived report');
      // A load the ratio admits but the core count would refuse: this is the
      // overlap where the two rules disagree, and the ratio has to win or the
      // fallback would be strictly stricter than the rule it stands in for.
      expect(loadVerdict(withLoad(7), [withLoad(1), withLoad(2), withLoad(2)])).toBeNull();
    });
  });

  it('reads the core count only when the platform publishes a finite positive one', () => {
    expect(reportCpus({ host: { loadavg1m: 1, cpus: 8 } })).toBe(8);
    expect(reportCpus({ host: { cpus: 0 } })).toBeNull();
    expect(reportCpus({ host: { cpus: -4 } })).toBeNull();
    expect(reportCpus({ host: { cpus: Number.NaN } })).toBeNull();
    expect(reportCpus({ host: { cpus: null } })).toBeNull();
    expect(reportCpus({ host: {} })).toBeNull();
    expect(reportCpus({})).toBeNull();
    expect(reportCpus(undefined)).toBeNull();
  });
});

/**
 * The admission control, pinned on the effect rather than the decision: the bug
 * was that a report reached the disk before anything judged it, so the assertion
 * that matters is **which files exist afterwards**, not what a verdict string
 * says. A test asserting the message would have passed against the pre-fix code
 * whenever the caller chose to keep the write.
 */
describe('bench-compare archiveReport', () => {
  const stamp = '2026-09-30T03-00-00-000Z';
  const sample = (loadavg1m: number | null, cpus: number | null = 8) => ({
    generatedAt: '2026-09-30T03:00:00.000Z',
    host: { loadavg1m, cpus },
    results: []
  });
  const dir = () => mkdtempSync(join(tmpdir(), 'bench-admit-'));
  const files = (d: string) => readdirSync(d).filter(name => name.startsWith('browser-'));

  it('writes nothing when the host is oversubscribed and no baseline exists', () => {
    // The live state: the archive records no reading, so the ratio cannot be
    // computed, and 32.27 across 8 cores is refused on the core count alone.
    const d = dir();
    const outcome = archiveReport(sample(32.27), d);
    expect(outcome.archived).toBe(false);
    expect(outcome.refusal).toContain('8 core(s)');
    expect(outcome.warning).toBeNull();
    expect(files(d), 'a refused sample must leave no file to become the next baseline').toEqual([]);
  });

  it('writes nothing when the reading is far above a recorded baseline', () => {
    const d = dir();
    writeFileSync(join(d, 'browser-2026-01-01T00-00-00-000Z.json'), JSON.stringify(sample(1)));
    writeFileSync(join(d, 'browser-2026-01-02T00-00-00-000Z.json'), JSON.stringify(sample(1)));
    const outcome = archiveReport(sample(50), d);
    expect(outcome.refusal).toContain('median');
    expect(files(d)).toEqual(['browser-2026-01-01T00-00-00-000Z.json', 'browser-2026-01-02T00-00-00-000Z.json']);
  });

  it('writes the sample when the host is idle', () => {
    const d = dir();
    const outcome = archiveReport(sample(1.5), d);
    expect(outcome).toEqual({ archived: true, refusal: null, warning: null });
    // The filename comes from the report's own clock, so it cannot disagree with
    // the body — which is why `stamp` is asserted rather than a fresh reading.
    expect(files(d)).toEqual([`browser-${stamp}.json`]);
    expect(JSON.parse(readFileSync(join(d, `browser-${stamp}.json`), 'utf8')).host.loadavg1m).toBe(1.5);
  });

  it('creates the results directory when it does not exist yet', () => {
    const parent = dir();
    const nested = join(parent, 'results');
    expect(archiveReport(sample(1), nested).archived).toBe(true);
    expect(files(nested)).toEqual([`browser-${stamp}.json`]);
  });

  it('reports a write failure as a warning, not a refusal', () => {
    // The two outcomes mean different things to a caller: a refusal is a
    // judgment about the host and fails the run, a broken disk is not, and
    // conflating them would let a full volume fail a release over a sample that
    // was correctly taken and simply could not be saved.
    const d = dir();
    writeFileSync(join(d, 'blocker'), 'not a directory');
    const outcome = archiveReport(sample(1), join(d, 'blocker', 'nested'));
    expect(outcome.archived).toBe(false);
    expect(outcome.refusal, 'a disk failure must not read as a host judgment').toBeNull();
    expect(outcome.warning).toBeTypeOf('string');
  });

  it('admits a sample with no reading at all, since there is nothing to judge', () => {
    // A platform that publishes no finite load is a platform this gate cannot
    // reason about, and refusing there would be refusing on a premise the record
    // does not support.
    const d = dir();
    expect(archiveReport(sample(null), d).archived).toBe(true);
    expect(files(d)).toEqual([`browser-${stamp}.json`]);
  });
});

/**
 * The archive reader `bench:browser` consults *before* writing, so that the
 * refusal lands on a sample that has not yet become the next comparison's
 * baseline. Both filters are load-bearing and each is pinned in the direction
 * that fails if the filter is dropped.
 */
describe('bench-compare archiveLoads', () => {
  const withDir = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-loads-'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  };

  it('returns only the reports that record a reading, oldest first', () => {
    const dir = withDir({
      'browser-1.json': JSON.stringify({ host: { loadavg1m: 1, cpus: 8 } }),
      'browser-2.json': JSON.stringify({ results: [] }),
      'browser-3.json': JSON.stringify({ host: { loadavg1m: 3, cpus: 8 } })
    });
    expect(archiveLoads(dir).map(reportLoad)).toEqual([1, 3]);
  });

  it('skips a file that no longer parses rather than taking the run down', () => {
    // A truncated write is a weaker judgment, never a failed benchmark run, and
    // this is the filter that says so.
    const dir = withDir({
      'browser-1.json': '{"host":{"loadavg1m":1,',
      'browser-2.json': JSON.stringify({ host: { loadavg1m: 2, cpus: 8 } })
    });
    expect(archiveLoads(dir).map(reportLoad)).toEqual([2]);
  });

  it('ignores files that are not browser reports', () => {
    const dir = withDir({
      'browser-1.json': JSON.stringify({ host: { loadavg1m: 1, cpus: 8 } }),
      'note.txt': 'ignored',
      'cluster-2.json': JSON.stringify({ host: { loadavg1m: 99, cpus: 8 } })
    });
    expect(archiveLoads(dir).map(reportLoad)).toEqual([1]);
  });

  it('treats an unlistable results directory as an empty archive, not an error', () => {
    // A correction, not a convenience: the first `bench:browser` on a clean
    // checkout has no `bench-results/` at all, and the reader that gates the
    // write behind it would have thrown on the one run meant to create it. A
    // missing baseline must reduce the judgment available, never fail a run whose
    // numbers were already produced.
    expect(latestReports(join(tmpdir(), 'bench-absent-' + process.pid))).toEqual([]);
    const parent = withDir({ blocker: 'not a directory' });
    expect(latestReports(join(parent, 'blocker'))).toEqual([]);
  });

  it('takes the most recent `limit`, which is what makes the baseline a window', () => {
    const dir = withDir({
      'browser-1.json': JSON.stringify({ host: { loadavg1m: 1, cpus: 8 } }),
      'browser-2.json': JSON.stringify({ host: { loadavg1m: 2, cpus: 8 } }),
      'browser-3.json': JSON.stringify({ host: { loadavg1m: 3, cpus: 8 } })
    });
    expect(archiveLoads(dir, 2).map(reportLoad)).toEqual([2, 3]);
    expect(archiveLoads(dir, 1).map(reportLoad)).toEqual([3]);
  });
});
