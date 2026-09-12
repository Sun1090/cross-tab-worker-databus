/**
 * Guards for the packed-consumer release smoke (`pnpm verify:pack`).
 *
 * The smoke is what stands between a broken `files`/`exports` mapping and npm,
 * so its *coverage* matters as much as its assertions: while the subpath list
 * was hardcoded, the two Worker artifacts were never checked in the tarball at
 * all. `collectExportTargets` derives the sweep from the packed manifest so a
 * new entry point is covered on the commit that adds it.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertPackedExports, collectExportTargets } from '../scripts/verify-packed-consumer.mjs';
import type { PackedManifestLike } from '../scripts/verify-packed-consumer.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as PackedManifestLike;

describe('collectExportTargets', () => {
  it('flattens object and string export entries into subpath/target pairs', () => {
    const targets = collectExportTargets({
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/cjs/index.cjs' },
        './package.json': './package.json'
      }
    });
    expect(targets).toEqual([
      { subpath: '.', target: './dist/index.d.ts' },
      { subpath: '.', target: './dist/index.js' },
      { subpath: '.', target: './dist/cjs/index.cjs' },
      { subpath: './package.json', target: './package.json' }
    ]);
  });

  it('covers every export the package actually ships, worker entries included', () => {
    // The regression: a hardcoded ['.', './hooks', './vue', './centrifuge'] list
    // left both Worker entry points unverified in the tarball.
    const subpaths = new Set(collectExportTargets(pkg).map(entry => entry.subpath));
    for (const subpath of Object.keys(pkg.exports ?? {})) {
      expect(subpaths, `export ${subpath} must be swept by the pack smoke`).toContain(subpath);
    }
    expect(subpaths).toContain('./centrifuge.worker');
    expect(subpaths).toContain('./centrifuge.shared.worker');
  });

  it('rejects a manifest with no exports at all', () => {
    expect(() => collectExportTargets({})).toThrowError(/declares no exports/);
    expect(() => collectExportTargets({ exports: {} })).toThrowError(/declares no exports/);
  });

  it('rejects an export entry that promises nothing', () => {
    expect(() => collectExportTargets({ exports: { './empty': {} } })).toThrowError(
      /export \.\/empty declares no target/
    );
  });
});

describe('assertPackedExports', () => {
  const dualFormat = (name: string): Record<string, string> => ({
    types: `./dist/${name}.d.ts`,
    import: `./dist/${name}.js`,
    require: `./dist/cjs/${name}.cjs`
  });
  const manifest: PackedManifestLike = {
    version: '1.2.3',
    exports: {
      '.': dualFormat('index'),
      './hooks': dualFormat('hooks'),
      './vue': dualFormat('vue'),
      './centrifuge': dualFormat('centrifuge'),
      './centrifuge.worker': {
        types: './dist/workers/centrifuge.worker.d.ts',
        default: './dist/centrifuge.worker.js'
      }
    }
  };
  const everythingExists = () => true;

  it('accepts a complete export surface', () => {
    expect(() => assertPackedExports(manifest, everythingExists)).not.toThrow();
  });

  it('rejects a missing worker artifact, which the hardcoded sweep never inspected', () => {
    expect(() =>
      assertPackedExports(manifest, target => target !== './dist/centrifuge.worker.js')
    ).toThrowError(/missing export target \.\/dist\/centrifuge\.worker\.js for \.\/centrifuge\.worker/);
  });

  it('rejects a dual-format entry point that lost its require condition', () => {
    expect(() =>
      assertPackedExports(
        {
          ...manifest,
          exports: { ...manifest.exports, '.': { types: './dist/index.d.ts', import: './dist/index.js' } }
        },
        everythingExists
      )
      // Anchored: the message must name the root entry, not the first missing one.
    ).toThrowError(/missing dual-format export for \.$/);
  });

  it('rejects a manifest with no version to compare against', () => {
    expect(() => assertPackedExports({ exports: { '.': dualFormat('index') } }, everythingExists)).toThrowError(
      /declares no version/
    );
  });

  it('accepts the real manifest against the real dist artifacts', () => {
    // Ties the helper to reality: the export map and the built files must agree.
    expect(() => assertPackedExports(pkg, existsSync)).not.toThrow();
  });
});
