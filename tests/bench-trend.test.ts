import { describe, expect, it } from 'vitest';
import { buildDocs } from '../scripts/bench-trend.mjs';
import type { BenchTrendReportEntry } from '../scripts/bench-trend.mjs';

/**
 * The trend doc is a reviewed, shipped artifact (it is in package.json `files`),
 * so it must be a pure function of the archived reports: same inputs → same
 * bytes. It previously stamped `new Date()`, which changed the doc every day
 * even when no new report existed and implied fresh data that was not there.
 */

const entry = (
  name: string,
  generatedAt: string,
  perMessageMs: number,
  timings: Record<string, number>
): BenchTrendReportEntry => ({
  name,
  report: {
    generatedAt,
    results: [
      { mode: 'dedicated', perMessageMs },
      { mode: 'shared', perMessageMs: perMessageMs * 2 }
    ],
    databus: { timings }
  }
});

const older = entry('browser-2020-01-01T00-00-00-000Z.json', '2020-01-01T00:00:00.000Z', 10, {
  wildcardDispatch1000Ms: 5,
  firstPacketMs: 1
});
const newer = entry('browser-2020-01-02T00-00-00-000Z.json', '2020-01-02T00:00:00.000Z', 8, {
  wildcardDispatch1000Ms: 3,
  firstPacketMs: 2
});

describe('bench-trend generator', () => {
  it('stamps the latest report date, never the wall clock', () => {
    const { en, zh } = buildDocs([older, newer]);
    expect(en).toContain('Data through 2020-01-02');
    expect(zh).toContain('数据截至 2020-01-02');
    // The regression: a wall-clock stamp made every day produce a new doc.
    expect(en).not.toContain(new Date().toISOString().slice(0, 10));
    expect(zh).not.toContain(new Date().toISOString().slice(0, 10));
  });

  it('is deterministic for identical inputs', () => {
    const first = buildDocs([older, newer]);
    const second = buildDocs([older, newer]);
    expect(second.en).toBe(first.en);
    expect(second.zh).toBe(first.zh);
  });

  it('records the archived report count', () => {
    expect(buildDocs([older, newer]).en).toContain('from the 2 archived');
  });

  it('computes the delta and the all-time best per metric', () => {
    const { en } = buildDocs([older, newer]);
    // latest 8 vs previous 10 → -2.00, and the latest is also the best.
    expect(en).toContain(
      '| publish per-message (ms, lower is better) — dedicated | 10 | 8 | -2.00 | 8 |'
    );
    expect(en).toContain('| wildcard dispatch ×1000 (ms, lower is better) | 5 | 3 | -2.00 | 3 |');
    // A regression direction still reports the older run as the all-time best.
    expect(en).toContain('| first-packet cold dispatch (ms, lower is better) | 1 | 2 | +1.00 | 1 |');
  });

  it('falls back to the filename date when a report has no generatedAt', () => {
    const withoutStamp: BenchTrendReportEntry = { name: 'browser-2019-12-31T00-00-00-000Z.json', report: {} };
    const { en } = buildDocs([withoutStamp, newer]);
    expect(en).toContain('Data through 2020-01-02');
  });

  it('rejects an archive with fewer than two reports', () => {
    expect(() => buildDocs([older])).toThrow(/at least two/);
  });
});
