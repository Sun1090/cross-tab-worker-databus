import { describe, expect, it } from 'vitest';
import { compareAgainstBaseline, compareReports, findRegressions, median, parseArgs } from '../scripts/bench-compare.mjs';
import type { BenchReportLike } from '../scripts/bench-compare.mjs';

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
      ['publish/dedicated/perMessageMs', 10, 12],
      ['publish/shared/perMessageMs', 20, 18],
      ['databus/dedup1000Ms', 8, 9],
      ['databus/firstPacketMs', 0, 0]
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
    const rows: Array<[string, number, number]> = [['databus/firstPacketMs', 0, 5]];
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
      ['publish/dedicated/perMessageMs', 10, 13],
      ['databus/dedup1000Ms', 25.3, 13]
    ]);
    expect(findRegressions(rows, 50)).toEqual([]);
  });

  it('still catches a sustained regression', () => {
    // A real doubling fails even though the newest baseline run was itself
    // already drifting upward: the baseline is the median of the last five, 11.
    const archive = [timed(10), timed(11), timed(10), timed(12), timed(21), timed(22, 22)];
    const rows = compareAgainstBaseline(archive);
    expect(rows).toEqual([
      ['publish/dedicated/perMessageMs', 10, 22],
      ['databus/dedup1000Ms', 11, 22]
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
      ['publish/dedicated/perMessageMs', 10, 10],
      ['databus/dedup1000Ms', 30, 30]
    ]);
    expect(findRegressions(rows, 50)).toEqual([]);
  });

  it('skips a metric that has no preceding sample', () => {
    const archive: BenchReportLike[] = [timed(10), { results: [{ mode: 'brandnew', perMessageMs: 1 }] }];
    expect(compareAgainstBaseline(archive)).toEqual([]);
  });

  it('degenerates to the previous report for a two-report archive', () => {
    // With one preceding report the median is that report, so the gate keeps
    // working before the archive fills up.
    expect(compareAgainstBaseline([older, newer])).toEqual(compareReports(older, newer));
  });
});
