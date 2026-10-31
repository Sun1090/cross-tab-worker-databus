/**
 * The shared consumer-type check is load-bearing for two gates now, so its two
 * decisions — which subpaths to drive, and which declaration tree each mode must
 * read — are asserted here rather than left to the scripts' own output.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODES, dualFormatSubpaths, resolveTscPath, writeFixtures, writeTsconfig } from '../scripts/consumer-types.mjs';

describe('consumer-type check shape', () => {
  it('derives the subpath list from the require condition, so a new subpath is covered on arrival', () => {
    expect(
      dualFormatSubpaths({
        exports: {
          '.': { import: { types: './dist/index.d.ts' }, require: { types: './dist/cjs/index.d.cts' } },
          './centrifuge': { import: { types: './a.d.ts' }, require: { types: './cjs/a.d.cts' } },
          './worker': { types: './w.d.ts', default: './w.js' },
          './package.json': './package.json'
        }
      })
    ).toEqual(['.', './centrifuge']);
  });

  it('refuses to pass vacuously when no entry is dual-format', () => {
    // The filter used to be a hard-coded list; a filter that matches nothing is
    // the failure mode an `exports` reshape produces, and it must be loud.
    expect(() => dualFormatSubpaths({ exports: { './worker': { types: './w.d.ts', default: './w.js' } } })).toThrow(
      /no dual-format subpath/
    );
    expect(() => dualFormatSubpaths({})).toThrow(/no dual-format subpath/);
  });

  it('drives five modes, and names the tree each one must read', () => {
    expect(MODES.map(mode => mode.id)).toEqual([
      'bundler',
      'node16-esm',
      'node16-cjs',
      'nodenext-esm',
      'nodenext-cjs'
    ]);
    for (const mode of MODES) {
      expect(mode.expects, `${mode.id} expects`).toBe(
        mode.type === 'commonjs' ? 'dist/cjs/index.d.cts' : 'dist/index.d.ts'
      );
    }
  });

  it('writes one fixture per subpath in every mode and its own module-scope package.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'consumer-types-shape-'));
    try {
      writeFixtures({ root, packageName: 'some-pkg', subpaths: ['.', './centrifuge'] });
      const cjsScope = JSON.parse(readFileSync(join(root, 'cjs', 'package.json'), 'utf8')) as { type: string };
      expect(cjsScope.type).toBe('commonjs');
      expect(readFileSync(join(root, 'root.ts'), 'utf8')).toBe("export * from 'some-pkg';\n");
      expect(readFileSync(join(root, 'cjs', 'centrifuge.ts'), 'utf8')).toBe(
        "export * from 'some-pkg/centrifuge';\n"
      );
      // The usage file names the package it is checking, never a hard-coded one.
      expect(readFileSync(join(root, 'usage.ts'), 'utf8')).toContain("from 'some-pkg'");
      for (const mode of MODES) {
        const config = JSON.parse(readFileSync(writeTsconfig({ root, mode }), 'utf8')) as {
          compilerOptions: { skipLibCheck: boolean; noEmit: boolean };
          include: string[];
        };
        expect(config.compilerOptions.skipLibCheck, `${mode.id} must check lib`).toBe(false);
        expect(config.include).toEqual(mode.dir === '.' ? ['*.ts'] : [`${mode.dir}/*.ts`]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads the compiler binary from the installed manifest rather than assuming its name', () => {
    // This repository's `typescript` is an alias whose binary is `tsc6`; the same
    // directory installed from npm carries `tsc`. Both are whatever the manifest says.
    expect(resolveTscPath('node_modules/typescript')).toEqual({
      tscPath: join('node_modules/typescript', './bin/tsc6'),
      version: expect.any(String)
    });
  });
});
