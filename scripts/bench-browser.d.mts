/** Validated environment inputs for the browser benchmark. */
export interface BenchEnv {
  port: number;
  messages: number;
  modes: string[];
  baseUrl: string;
  wsUrl: string;
}

/**
 * Parse and validate `PORT`, `BENCH_MESSAGES` and `BENCH_MODES`.
 *
 * Empty/absent values fall back to the documented defaults (4173, 100,
 * `dedicated,shared`); anything else must be a valid integer / known worker
 * mode. Throws a `TypeError` naming the offending variable.
 */
export declare function parseBenchEnv(env?: Record<string, string | undefined>): BenchEnv;

/**
 * The host load **as it was before the run started**, recorded with each archived
 * report so the reading describes the host rather than the benchmark's own CPU
 * cost — a measurement showed an idle 8-core host at 7.23 rising to 11.95 by the
 * time a sample completed. Shape: `{ loadavg1m, cpus, platform, release }`, or
 * `null` when the platform provides no finite reading.
 */
export declare function readHostLoad(): { loadavg1m: number; cpus: number | null; platform: string; release: string } | null;
