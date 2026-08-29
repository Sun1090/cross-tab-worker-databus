import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });

// ESM build (primary). Splitting shares the core chunk between the two entries.
await build({
  entryPoints: {
    index: 'src/index.ts',
    centrifuge: 'src/centrifuge.ts'
  },
  bundle: true,
  external: ['centrifuge'],
  format: 'esm',
  outdir: 'dist',
  platform: 'browser',
  sourcemap: true,
  splitting: true,
  target: ['es2022']
});

// CJS build for CommonJS consumers (require(), legacy bundler configs).
// Splitting is not supported for CJS, so each entry bundles the core itself.
await build({
  entryPoints: {
    index: 'src/index.ts',
    centrifuge: 'src/centrifuge.ts'
  },
  bundle: true,
  external: ['centrifuge'],
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  outdir: 'dist/cjs',
  platform: 'browser',
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
  sourcemap: true,
  target: ['es2022']
});
