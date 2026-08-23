/**
 * Vitest unit-test configuration.
 *
 * Unit tests live under tests/**\/*.test.ts. The Playwright E2E specs under
 * e2e/ are excluded so `pnpm test` does not attempt to run them with vitest.
 */
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**']
  }
});
