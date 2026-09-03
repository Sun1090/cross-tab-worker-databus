import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), 'cross-tab-databus-pack-'));
const packJson = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: workspace, encoding: 'utf8' });
const [{ filename }] = JSON.parse(packJson);
const packageDir = join(tempRoot, 'package');
execFileSync('tar', ['-xzf', join(workspace, filename), '-C', tempRoot]);

const packedManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
if (packedManifest.version !== JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8')).version) {
  throw new Error(`packed version mismatch: ${packedManifest.version}`);
}
for (const subpath of ['', './hooks', './vue', './centrifuge']) {
  const entry = packedManifest.exports?.[subpath || '.'];
  if (!entry?.import || !entry?.require) throw new Error(`missing dual-format export for ${subpath || '.'}`);
  for (const target of [entry.import, entry.require]) {
    if (!existsSync(join(packageDir, target))) throw new Error(`missing export target ${target}`);
  }
}
for (const declaration of ['dist/index.d.ts', 'dist/hooks.d.ts', 'dist/vue.d.ts', 'dist/centrifuge.d.ts']) {
  if (!existsSync(join(packageDir, declaration))) throw new Error(`missing declaration ${declaration}`);
}

const consumerNodeModules = join(tempRoot, 'node_modules');
mkdirSync(consumerNodeModules);
symlinkSync(packageDir, join(consumerNodeModules, 'cross-tab-worker-databus'), 'dir');
for (const dependency of ['react', 'vue', 'centrifuge']) {
  symlinkSync(join(workspace, 'node_modules', dependency), join(consumerNodeModules, dependency), 'dir');
}

const consumer = `
  import { CrossTabDataBus, createWebSocketDataBus } from 'cross-tab-worker-databus';
  import { useCrossTabDataBus } from 'cross-tab-worker-databus/hooks';
  import { useCrossTabDataBus as useVueBus } from 'cross-tab-worker-databus/vue';
  import { createCentrifugeDataBus } from 'cross-tab-worker-databus/centrifuge';
  import { createRequire } from 'node:module';
  const require = createRequire(import.meta.url);
  const cjs = require('cross-tab-worker-databus');
  const cjsHooks = require('cross-tab-worker-databus/hooks');
  const cjsVue = require('cross-tab-worker-databus/vue');
  const cjsCentrifuge = require('cross-tab-worker-databus/centrifuge');
  for (const value of [CrossTabDataBus, createWebSocketDataBus, useCrossTabDataBus, useVueBus, createCentrifugeDataBus, cjs.CrossTabDataBus, cjsHooks.useCrossTabDataBus, cjsVue.useCrossTabDataBus, cjsCentrifuge.createCentrifugeDataBus]) {
    if (typeof value !== 'function') throw new Error('packed consumer export is not callable');
  }
`;
execFileSync(process.execPath, ['--input-type=module', '-e', consumer], {
  cwd: tempRoot,
  stdio: 'inherit'
});
console.log(`[pack] verified ESM/CJS root and subpath consumers from ${filename}`);
