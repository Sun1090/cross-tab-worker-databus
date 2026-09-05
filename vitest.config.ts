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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.worker.ts', 'src/workers/centrifuge*.ts'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 90,
        lines: 85
      }
    }
  }
});
