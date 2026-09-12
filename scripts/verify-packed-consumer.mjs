/**
 * Pack the tarball and import every public subpath as both ESM and CJS, so a
 * broken `files`/`exports` mapping fails here rather than on npm.
 *
 * Everything this script creates lives under a single `mkdtempSync` root that is
 * removed in a `finally`:
 *  - `npm pack --pack-destination` keeps the archive out of the checkout (a bare
 *    `npm pack` writes `cross-tab-worker-databus-*.tgz` into the repo root on
 *    every run, leaving a stale artifact behind per version).
 *  - the temp root is removed afterwards, so repeated runs (CI runs this on every
 *    push) do not accumulate unpacked tarballs in the OS temp directory.
 *
 * Usage: node scripts/verify-packed-consumer.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** JS entry points that must stay dual-format (ESM + CJS). The worker entries
 * are intentionally ESM-only, so they are excluded from this contract and
 * covered by the target-existence sweep instead. */
const DUAL_FORMAT_SUBPATHS = ['.', './hooks', './vue', './centrifuge'];

/**
 * Every file path the packed export map promises, as `{ subpath, target }`.
 *
 * Derived from the manifest rather than a hardcoded subpath list: a hardcoded
 * list silently stops covering the package the moment a new entry point is
 * added. That is exactly how the two Worker artifacts (`./centrifuge.worker`,
 * `./centrifuge.shared.worker`) — the entry points the built-in Worker factory
 * resolves at runtime — went unverified in the tarball.
 */
export function collectExportTargets(manifest) {
  const entries = Object.entries(manifest.exports ?? {});
  if (entries.length === 0) throw new Error('packed manifest declares no exports');
  const targets = [];
  for (const [subpath, entry] of entries) {
    const values = typeof entry === 'string' ? [entry] : Object.values(entry ?? {});
    if (values.length === 0) throw new Error(`export ${subpath} declares no target`);
    for (const target of values) targets.push({ subpath, target });
  }
  return targets;
}

/** Assert the packed manifest promises a complete, resolvable export surface. */
export function assertPackedExports(packedManifest, exists) {
  if (packedManifest.version === undefined) throw new Error('packed manifest declares no version');
  for (const { subpath, target } of collectExportTargets(packedManifest)) {
    if (!exists(target)) throw new Error(`missing export target ${target} for ${subpath}`);
  }
  // The dual-format contract is separate from existence: these four must keep
  // offering both a `require` and an `import` condition.
  for (const subpath of DUAL_FORMAT_SUBPATHS) {
    const entry = packedManifest.exports?.[subpath];
    if (!entry?.import || !entry?.require) {
      throw new Error(`missing dual-format export for ${subpath}`);
    }
  }
}

async function main() {
  const workspace = process.cwd();
  const tempRoot = mkdtempSync(join(tmpdir(), 'cross-tab-databus-pack-'));
  try {
    const packJson = execFileSync(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', tempRoot],
      { cwd: workspace, encoding: 'utf8' }
    );
    const [{ filename }] = JSON.parse(packJson);
    const packageDir = join(tempRoot, 'package');
    execFileSync('tar', ['-xzf', join(tempRoot, filename), '-C', tempRoot]);

    const packedManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const workspaceVersion = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8')).version;
    if (packedManifest.version !== workspaceVersion) {
      throw new Error(`packed version mismatch: ${packedManifest.version} !== ${workspaceVersion}`);
    }
    assertPackedExports(packedManifest, target => existsSync(join(packageDir, target)));

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
  import {
    CrossTabDataBus,
    WebSocketTransport,
    WorkerClusterRuntime,
    approximatePayloadBytes,
    createBrowserEnvironment,
    createIndexedDbReplayPersistence,
    createOpaqueKey,
    createStorageEventChannel,
    createWebSocketDataBus,
    effectiveWorkerLoad,
    selectWorkerBackend,
    topicMatchesPattern
  } from 'cross-tab-worker-databus';
  import { useCrossTabDataBus } from 'cross-tab-worker-databus/hooks';
  import { useCrossTabDataBus as useVueBus } from 'cross-tab-worker-databus/vue';
  import { CentrifugeWorkerTransport, createCentrifugeDataBus } from 'cross-tab-worker-databus/centrifuge';
  import { createRequire } from 'node:module';
  const require = createRequire(import.meta.url);
  const cjs = require('cross-tab-worker-databus');
  const cjsHooks = require('cross-tab-worker-databus/hooks');
  const cjsVue = require('cross-tab-worker-databus/vue');
  const cjsCentrifuge = require('cross-tab-worker-databus/centrifuge');
  for (const value of [
    CrossTabDataBus, WebSocketTransport, WorkerClusterRuntime, approximatePayloadBytes,
    createBrowserEnvironment, createIndexedDbReplayPersistence, createOpaqueKey,
    createStorageEventChannel, createWebSocketDataBus, effectiveWorkerLoad,
    selectWorkerBackend, topicMatchesPattern,
    useCrossTabDataBus, useVueBus, CentrifugeWorkerTransport, createCentrifugeDataBus,
    cjs.CrossTabDataBus, cjs.createWebSocketDataBus, cjs.effectiveWorkerLoad,
    cjsHooks.useCrossTabDataBus, cjsVue.useCrossTabDataBus, cjsCentrifuge.createCentrifugeDataBus
  ]) {
    if (typeof value !== 'function') throw new Error('packed consumer export is not callable');
  }
`;
    execFileSync(process.execPath, ['--input-type=module', '-e', consumer], {
      cwd: tempRoot,
      stdio: 'inherit'
    });
    console.log(`[pack] verified ESM/CJS root and subpath consumers from ${filename}`);
  } finally {
    // Best-effort: a blocked delete (a locked file, or a sandbox that refuses
    // bulk deletes) must not turn a successful verification into a failed
    // release gate. Warn instead of throwing, and never mask the real error.
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `[pack] could not remove the temp root ${tempRoot}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
