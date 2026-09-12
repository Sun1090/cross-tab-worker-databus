/** One archived `bench-results/browser-*.json` report plus its filename. */
export interface BenchTrendReportEntry {
  name: string;
  report: {
    benchmark?: string;
    generatedAt?: string;
    results?: Array<{ mode: string; perMessageMs: number }>;
    databus?: { timings?: Record<string, number> };
  };
}

/** Render the English and Chinese trend docs from an oldest-first report list. */
export declare function buildDocs(entries: BenchTrendReportEntry[]): { en: string; zh: string };

/** Read every archived report in `resultsDir`, sorted oldest first by filename. */
export declare function readReports(resultsDir: string): BenchTrendReportEntry[];
