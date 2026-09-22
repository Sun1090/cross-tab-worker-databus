/**
 * Vitest unit-test configuration.
 *
 * Unit tests live under tests/**\/*.test.ts. The Playwright E2E specs under
 * e2e/ are excluded so `pnpm test` does not attempt to run them with vitest.
 */
import { readFileSync } from 'node:fs';
import { defineConfig, configDefaults } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The hot-path gates in `tests/perf-gate.test.ts` assert absolute millisecond
// ceilings, and an absolute ceiling only measures the code when nothing else
// wants the cores. Vitest isolates every file into its own worker, so inside a
// full suite those loops run at whatever share the scheduler hands out: two of
// the five gates failed at 2x their ceiling in one run while the same file
// passed on its own. They are therefore excluded from the parallel suites and
// run as their own step — `pnpm test:perf`, which `pnpm check` and CI invoke
// after the unit run has finished.
const perfGates = process.env.DATABUS_PERF_GATES === '1';

export default defineConfig({
  // Matches the esbuild `define` in scripts/build.mjs so SDK_VERSION reports
  // the released version in tests as well as in the bundled dist.
  define: {
    __SDK_VERSION__: JSON.stringify(version)
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      ...(perfGates ? [] : ['**/perf-gate.test.ts'])
    ],
    // Restores real timers after every test. A leaked fake `Date` travels with
    // a reused worker and poisons the seeded fuzzers' wall-clock budget; see
    // tests/setup.ts.
    setupFiles: ['./tests/setup.ts'],
    // The package/compat gates shell out to `git` and `node` per case (18 cases,
    // ~1.7s worst unloaded). At the 5000ms default a loaded runner pushed 11 of
    // them past the ceiling while every one passed in isolation, so the gate
    // failed on scheduling rather than on behavior. The seeded lifecycle fuzzer
    // keeps its own explicit budget; see tests/lifecycle-invariants.test.ts.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.worker.ts', 'src/workers/centrifuge*.ts'],
      thresholds: {
        // Measured at HEAD: 98.13 / 94.59 / 98.17 / 99.19. The previous
        // 85/80/90/85 floors were advisory only — a change could lose 10 points
        // of branch coverage and still pass the release gate. These sit a few
        // points under the measured values so real regressions fail CI while
        // ordinary feature work still fits.
        statements: 96,
        branches: 92,
        functions: 96,
        lines: 97
      }
    }
  }
});
