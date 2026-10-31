import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { mirrorDeclarations } from './declaration-mirror.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });

// The CommonJS declaration tree, before either bundle runs: `dist/workers` is
// inputs to the worker builds below, and the mirror deliberately skips it.
const { count: mirrored } = mirrorDeclarations({
  dist: fileURLToPath(new URL('../dist/', import.meta.url)),
  distCjs: fileURLToPath(new URL('../dist/cjs/', import.meta.url))
});
console.log(`[build] mirrored ${mirrored} declarations into dist/cjs as .d.cts`);

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
