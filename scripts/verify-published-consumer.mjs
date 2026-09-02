import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = process.cwd();
const packageJson = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: workspace, encoding: 'utf8' }));
const packageName = packageJson.name;
const version = process.env.PUBLISHED_VERSION || execFileSync('npm', ['view', packageName, 'version', '--registry', 'https://registry.npmjs.org'], { encoding: 'utf8' }).trim();
const tempRoot = mkdtempSync(join(tmpdir(), 'cross-tab-databus-published-'));
const packJson = execFileSync('npm', ['pack', `${packageName}@${version}`, '--json', '--ignore-scripts', '--pack-destination', tempRoot, '--registry', 'https://registry.npmjs.org'], { encoding: 'utf8' });
const [{ filename }] = JSON.parse(packJson);
const packageDir = join(tempRoot, 'package');
execFileSync('tar', ['-xzf', join(tempRoot, filename), '-C', tempRoot]);
const nodeModules = join(tempRoot, 'node_modules');
mkdirSync(nodeModules);
symlinkSync(packageDir, join(nodeModules, packageName), 'dir');
for (const dependency of ['react', 'vue', 'centrifuge']) symlinkSync(join(workspace, 'node_modules', dependency), join(nodeModules, dependency), 'dir');

const consumer = `
  import { CrossTabDataBus, createWebSocketDataBus } from '${packageName}';
  import { useCrossTabDataBus } from '${packageName}/hooks';
  import { useCrossTabDataBus as useVueBus } from '${packageName}/vue';
  import { createCentrifugeDataBus } from '${packageName}/centrifuge';
  import { createRequire } from 'node:module';
  const require = createRequire(import.meta.url);
  const cjs = require('${packageName}');
  const cjsHooks = require('${packageName}/hooks');
  const cjsVue = require('${packageName}/vue');
  const cjsCentrifuge = require('${packageName}/centrifuge');
  for (const value of [CrossTabDataBus, createWebSocketDataBus, useCrossTabDataBus, useVueBus, createCentrifugeDataBus, cjs.CrossTabDataBus, cjsHooks.useCrossTabDataBus, cjsVue.useCrossTabDataBus, cjsCentrifuge.createCentrifugeDataBus]) {
    if (typeof value !== 'function') throw new Error('published consumer export is not callable');
  }
`;
execFileSync(process.execPath, ['--input-type=module', '-e', consumer], { cwd: tempRoot, stdio: 'inherit' });
console.log(`[npm] verified published ${packageName}@${version} ESM/CJS consumers`);
