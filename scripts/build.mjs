import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });

/**
 * A second declaration tree, in CommonJS format, for CommonJS consumers.
 *
 * `tsc` emits one tree and it is ESM, because the root `package.json` says
 * `"type": "module"` and a `.d.ts` file's format is decided by that scope. A
 * CommonJS consumer on `module: node16` refuses such a declaration outright —
 * `require`ing an ESM-format declaration is TS1479 — while `nodenext` tolerates
 * it only because Node 22 can `require(esm)`. The two modes disagree, so one
 * tree cannot answer for both.
 *
 * The copy is not cosmetic: `.d.cts` makes the file CommonJS by extension alone,
 * and relative specifiers have to be rewritten `./x.js` → `./x.cjs` so the
 * mirrored graph closes on itself. Without the rewrite the mirror cannot resolve
 * its own imports (`./core/data-bus.js` has no `.d.cts` twin under that name)
 * and fails with TS2307 from inside `node_modules` — measured, not assumed;
 * docs/progress.md Phase 337 records both the control and the fix.
 *
 * `workers/` is skipped deliberately: `./centrifuge.worker` and its twin are
 * ESM-only subpaths whose `exports` entries carry no `require` condition, so
 * there is no CommonJS consumer for those declarations to serve.
 */
function emitCommonJsDeclarations() {
  const distPath = fileURLToPath(new URL('../dist/', import.meta.url));
  const distCjsPath = fileURLToPath(new URL('../dist/cjs/', import.meta.url));

  const collect = directory =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (entry.name === 'cjs' || entry.name === 'workers') return [];
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return collect(full);
      return entry.name.endsWith('.d.ts') ? [full] : [];
    });

  // The rewrite is content-wide rather than parser-aware: in these declarations a
  // quoted relative `.js` string only ever appears as a module specifier (checked
  // — no JSDoc example uses that shape), and `tests/dual-format.test.ts` asserts
  // each twin equals its source under exactly this substitution, so a future
  // comment that did use it would fail a test rather than drift silently.
  const declarations = collect(distPath);
  for (const declaration of declarations) {
    const relative = declaration.slice(distPath.length).replace(/\.d\.ts$/, '.d.cts');
    const target = join(distCjsPath, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      readFileSync(declaration, 'utf8').replace(/(['"])(\.\.?\/[^'"]*)\.js\1/g, '$1$2.cjs$1')
    );
  }

  // Silently mirroring nothing would leave every CommonJS consumer on `node16`
  // with the old failure, so the count is asserted rather than reported.
  if (declarations.length === 0) {
    throw new Error('[build] no declarations found to mirror for CommonJS consumers');
  }
  console.log(`[build] mirrored ${declarations.length} declarations into dist/cjs as .d.cts`);
}

emitCommonJsDeclarations();

// ESM build (primary). Splitting shares the core chunk between the two entries.
await build({
  entryPoints: {
    index: 'src/index.ts',
    centrifuge: 'src/centrifuge.ts',
    hooks: 'src/hooks.ts',
    vue: 'src/vue.ts'
  },
  bundle: true,
  external: ['centrifuge', 'react', 'vue'],
  format: 'esm',
  outdir: 'dist',
  platform: 'browser',
  // Injected so diagnostics always report the released version, never a stale constant.
  define: { __SDK_VERSION__: JSON.stringify(version) },
  sourcemap: true,
  splitting: true,
  target: ['es2022']
});

// CJS build for CommonJS consumers (require(), legacy bundler configs).
// Splitting is not supported for CJS, so each entry bundles the core itself.
await build({
  entryPoints: {
    index: 'src/index.ts',
    centrifuge: 'src/centrifuge.ts',
    hooks: 'src/hooks.ts',
    vue: 'src/vue.ts'
  },
  bundle: true,
  external: ['centrifuge', 'react', 'vue'],
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  outdir: 'dist/cjs',
  platform: 'browser',
  // Injected so diagnostics always report the released version, never a stale constant.
  define: { __SDK_VERSION__: JSON.stringify(version) },
  sourcemap: true,
  target: ['es2022']
});

await build({
  entryPoints: {
    'centrifuge.worker': 'src/workers/centrifuge.worker.ts',
    'centrifuge.shared.worker': 'src/workers/centrifuge.shared.worker.ts'
  },
  bundle: true,
  format: 'esm',
  outdir: 'dist',
  platform: 'browser',
  // Injected so diagnostics always report the released version, never a stale constant.
  define: { __SDK_VERSION__: JSON.stringify(version) },
  sourcemap: true,
  target: ['es2022']
});
