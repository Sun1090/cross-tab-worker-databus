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

export default defineConfig({
  // Matches the esbuild `define` in scripts/build.mjs so SDK_VERSION reports
  // the released version in tests as well as in the bundled dist.
  define: {
    __SDK_VERSION__: JSON.stringify(version)
  },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
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
