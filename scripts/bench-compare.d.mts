/**
 * One compared metric: `[label, baseline, current, ceiling]`.
 *
 * `ceiling` is the highest baseline sample the row's baseline summarises, or
 * `null` when there is no history to consult (the explicit two-report path).
 */
export type BenchMetricRow = [label: string, before: number, after: number, ceiling: number | null];

/** Minimal shape of an archived `bench-results/browser-*.json` report. */
export interface BenchReportLike {
  results?: Array<{ mode: string; perMessageMs: number }>;
  databus?: { timings?: Record<string, number> };
}

/** Parse CLI args; throws on an invalid `--fail-above-pct` or positional count. */
export declare function parseArgs(argv: string[]): { failPct: number | null; positional: string[] };

/** Per-metric before/after rows present in both reports. */
export declare function compareReports(older: BenchReportLike, newer: BenchReportLike): BenchMetricRow[];

/** How many preceding reports the default baseline summarises per metric. */
export declare const BASELINE_SAMPLES: number;

/** Median of a non-empty numeric sample. */
export declare function median(values: readonly number[]): number;

/**
 * Newest report vs the per-metric median of the preceding `BASELINE_SAMPLES`
 * reports (input ordered oldest first).
 */
export declare function compareAgainstBaseline(reports: readonly BenchReportLike[]): BenchMetricRow[];

/**
 * Descriptions of metrics that regressed past `failPct` *and* past their
 * baseline ceiling (`null` disables the gate).
 */
export declare function findRegressions(rows: BenchMetricRow[], failPct: number | null): string[];

/** The complement of `findRegressions`: rows whose percentage delta exceeds
 * `failPct` but whose value is still within the range the baseline observed. */
export declare function findWithinBaseline(rows: BenchMetricRow[], failPct: number | null): string[];

/** The `limit` most recent archived reports in `resultsDir`, oldest first. */
export declare function latestReports(resultsDir: string, limit?: number): string[];
