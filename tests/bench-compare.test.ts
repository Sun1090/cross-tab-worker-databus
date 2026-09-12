import { describe, expect, it } from 'vitest';
import { compareReports, findRegressions, parseArgs } from '../scripts/bench-compare.mjs';
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
