/** `[metric label, before, after]` for one compared metric. */
export type BenchMetricRow = [label: string, before: number, after: number];

/** Minimal shape of an archived `bench-results/browser-*.json` report. */
export interface BenchReportLike {
  results?: Array<{ mode: string; perMessageMs: number }>;
  databus?: { timings?: Record<string, number> };
}

/** Parse CLI args; throws on an invalid `--fail-above-pct` or positional count. */
export declare function parseArgs(argv: string[]): { failPct: number | null; positional: string[] };

/** Per-metric before/after rows present in both reports. */
export declare function compareReports(older: BenchReportLike, newer: BenchReportLike): BenchMetricRow[];

/** Descriptions of metrics that regressed past `failPct` (`null` disables the gate). */
export declare function findRegressions(rows: BenchMetricRow[], failPct: number | null): string[];

/** The two most recent archived reports in `resultsDir`, oldest first. */
export declare function latestReports(resultsDir: string): string[];
