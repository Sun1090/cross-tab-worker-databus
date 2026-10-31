/**
 * The CommonJS declaration mirror, tested on scratch trees rather than on `dist`.
 *
 * `tests/dual-format.test.ts` asserts what the shipped mirror *is* (a twin
 * beside every declaration, derived not drifted). This file asserts what the
 * mirror *builder* does at its edges — which directories it excludes, what it
 * refuses, and the one property derivation alone cannot give: that the mirrored
 * graph closes on itself.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectDeclarations,
  danglingSpecifiers,
  mirrorDeclarations,
  toCjsSpecifiers
} from '../scripts/declaration-mirror.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'declaration-mirror-'));

const write = (root: string, path: string, content: string) => {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
};

const roots: string[] = [];
const tree = () => {
  const root = scratch();
  roots.push(root);
  return { dist: join(root, 'dist'), distCjs: join(root, 'dist', 'cjs') };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CommonJS declaration mirror', () => {
  it('rewrites relative specifiers and only those', () => {
    expect(toCjsSpecifiers(`export * from './core/data-bus.js';\nimport type { A } from "../types.js";`)).toBe(
      `export * from './core/data-bus.cjs';\nimport type { A } from "../types.cjs";`
    );
    // A package specifier is not the mirror's business, and neither is a name
    // that merely ends in `js`.
    expect(toCjsSpecifiers(`import { Bus } from 'centrifuge';\nexport type { Bus };`)).toBe(
      `import { Bus } from 'centrifuge';\nexport type { Bus };`
    );
  });

  it('mirrors the declarations a CommonJS consumer can reach, and skips the two it cannot', () => {
    const { dist } = tree();
    write(dist, 'index.d.ts', `export * from './core/data-bus.js';\n`);
    write(dist, 'core/data-bus.d.ts', `export type A = 1;\n`);
    write(dist, 'workers/worker.d.ts', `export type B = 2;\n`);
    write(dist, 'cjs/stale.d.cts', `export type C = 3;\n`);
    write(dist, 'index.js', `export {};\n`);

    expect(collectDeclarations(dist)).toEqual([join(dist, 'core/data-bus.d.ts'), join(dist, 'index.d.ts')]);
  });

  it('writes a twin whose specifiers point into the mirror, not back out at the ESM tree', () => {
    const { dist, distCjs } = tree();
    write(dist, 'index.d.ts', `export * from './core/data-bus.js';\n`);
    write(dist, 'core/data-bus.d.ts', `export type A = 1;\n`);

    expect(mirrorDeclarations({ dist, distCjs })).toEqual({ count: 2 });
    expect(readFileSync(join(distCjs, 'index.d.cts'), 'utf8')).toBe(`export * from './core/data-bus.cjs';\n`);
    expect(danglingSpecifiers(join(distCjs, 'index.d.cts'))).toEqual([]);
  });

  it('refuses to report a green build when it mirrored nothing', () => {
    const { dist, distCjs } = tree();
    mkdirSync(dist, { recursive: true });
    expect(() => mirrorDeclarations({ dist, distCjs })).toThrow(/no declarations found to mirror/);
  });

  it('refuses a mirror whose graph dangles, naming both ends', () => {
    // The failure this catches is invisible to derivation: `workers/` is never
    // mirrored, so a top-level declaration that imports from it produces a
    // faithful twin that no CommonJS consumer can resolve.
    const { dist, distCjs } = tree();
    write(dist, 'index.d.ts', `export * from './workers/worker.js';\n`);
    write(dist, 'workers/worker.d.ts', `export type B = 2;\n`);

    expect(() => mirrorDeclarations({ dist, distCjs })).toThrow(/index\.d\.cts -> \.\/workers\/worker\.cjs/);
    // The twin that caused it was still written, which is why the count alone
    // cannot stand in for this check.
    expect(readFileSync(join(distCjs, 'index.d.cts'), 'utf8')).toBe(`export * from './workers/worker.cjs';\n`);
  });
});
