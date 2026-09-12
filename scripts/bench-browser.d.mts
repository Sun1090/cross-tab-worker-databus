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
