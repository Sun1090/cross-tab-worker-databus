/**
 * One compared metric: `[label, baseline, current, ceiling]`.
 *
 * `ceiling` is the highest baseline sample the row's baseline summarises, or
 * `null` when there is no history to consult (the explicit two-report path).
 */
export type BenchMetricRow = [label: string, before: number, after: number, ceiling: number | null];

/** Minimal shape of an archived `bench-results/browser-*.json` report. */
export interface BenchReportLike {
  generatedAt?: string;
  results?: Array<{ mode: string; perMessageMs: number }>;
  databus?: { timings?: Record<string, number> };
  /**
   * The host block, as *parsed from a file on disk* rather than as a writer
   * produces it — these reports are untrusted input, hand-editable and possibly
   * written by another generator. `null` is therefore a real value here and not
   * only a type error: `JSON.stringify` writes a non-finite reading as `null`,
   * which is precisely the "absent" that `reportLoad` must not read as zero.
   */
  host?: { loadavg1m?: number | null; cpus?: number | null } | null;
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

/** Load ratio, against the baseline's own median, above which a newest sample is refused. */
export declare const POISON_LOAD_RATIO: number;

/** The finite, non-negative 1-minute load recorded on a report, or `null`. */
export declare function reportLoad(report: BenchReportLike | undefined): number | null;

/**
 * The core count recorded beside the load reading, or `null` where the platform
 * publishes no finite one. The only machine-relative scale available to the
 * no-baseline leg of `loadVerdict`.
 */
export declare function reportCpus(report: BenchReportLike | undefined): number | null;

/**
 * The archived reports that actually record a load reading, oldest first —
 * unparseable files and pre-`host` reports skipped, so a caller gating whether to
 * archive a fresh sample consults the same rule the comparison will.
 */
export declare function archiveLoads(resultsDir: string, limit?: number): BenchReportLike[];

/**
 * Admit a freshly taken sample to the archive, or refuse it before it is
 * written. A **refusal** is a judgment about the host (`refusal` set, exit
 * non-zero); a **write failure** is a broken disk (`warning` set, exit zero) and
 * is deliberately not conflated with the first.
 */
export declare function archiveReport(
  report: BenchReportLike,
  resultsDir: string,
  limit?: number
): { archived: boolean; refusal: string | null; warning: string | null };

/**
 * Why a newest report's host load is too far above the baseline's to trust, or
 * `null` when the sample is admissible (or when there is nothing to judge).
 */
export declare function loadVerdict(newest: BenchReportLike, baselineReports: BenchReportLike[]): string | null;
