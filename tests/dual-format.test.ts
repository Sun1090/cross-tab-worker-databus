/**
 * Dual-format build verification.
 *
 * `pnpm check` runs `build` BEFORE `test`, so these assertions validate the
 * freshly built artifacts: the ESM entry and the CJS bundle required by
 * CommonJS consumers both expose the public API surface, and every path
 * promised by package.json `exports` actually exists on disk.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const PUBLIC_FUNCTIONS = [
  'CrossTabDataBus',
  'WorkerClusterRuntime',
  'createBrowserEnvironment',
  'getOrCreateTabId',
  'createOpaqueKey',
  'selectWorkerBackend'
] as const;

describe('dual-format build artifacts', () => {
  it('exposes the public API to CommonJS consumers via dist/cjs', () => {
    const lib: Record<string, unknown> = require('../dist/cjs/index.cjs');
    for (const name of PUBLIC_FUNCTIONS) {
      expect(typeof lib[name], `dist/cjs missing export: ${name}`).toBe('function');
    }
  });

  it('exposes the public API to ESM consumers via dist', async () => {
    const lib = await import('../dist/index.js');
    for (const name of PUBLIC_FUNCTIONS) {
      expect(typeof (lib as Record<string, unknown>)[name], `dist missing export: ${name}`).toBe(
        'function'
      );
    }
  });

  it('materialises every path declared in package.json exports', () => {
    const pkg = require('../package.json') as {
      exports: Record<string, Record<string, string> | string>;
    };
    const targets: string[] = [];
    for (const value of Object.values(pkg.exports)) {
      if (typeof value === 'string') targets.push(value);
      else targets.push(...Object.values(value));
    }
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const file = target.replace(/^\.\//, '');
      expect(existsSync(file), `exports target missing: ${file}`).toBe(true);
    }
  });
});
