/**
 * Verify the *published* package by downloading it from npm and importing every
 * public subpath as both ESM and CJS, in a throwaway tree that shares nothing
 * with the checkout. The blocking gate of the `Release` workflow.
 *
 * Like its sibling `verify-packed-consumer.mjs`, the runtime body lives in
 * `main()` behind an `invokedDirectly` check, so the pure version resolver can be
 * imported and tested without reaching the registry. (The module previously did
 * its `npm view` at import time.)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const stripLeadingV = value => String(value).trim().replace(/^v(?=\d)/i, '');

/**
 * Which published version to verify.
 *
 * An explicit `PUBLISHED_VERSION` wins verbatim, *including* when it names a
 * release older than the tree — repeating this gate against a past version is a
 * legitimate thing to want, and it is the only way to ask the question.
 *
 * Without it the target comes from `npm view <pkg> version`, and that read can be
 * served from npm's local packument cache. Observed minutes after the 0.21.29 publish
 * (2026-09-24 UTC): two consecutive reads returned the release that had just been
 * superseded, while `npm view <pkg> versions dist-tags --json` against the same
 * registry already reported the new one, and a third read of the original form
 * then agreed. Naming `--registry` explicitly does not defeat the local cache.
 *
 * So an inferred version is only trusted when it agrees with the tree it is being
 * run from. Otherwise this gate would download and import the *previous* artifact
 * and exit 0 — the sole witness being the version in the line it prints, which
 * nothing forces a reader to read. Hence a refusal rather than a warning.
 */
export function resolveTargetVersion(envVersion, readRegistryVersion, treeVersion) {
  if (envVersion) return stripLeadingV(envVersion);
  const inferred = stripLeadingV(readRegistryVersion());
  if (!inferred) {
    throw new Error(
      `[npm] \`npm view <pkg> version\` returned no version, so nothing to verify; ` +
      `pass it explicitly: PUBLISHED_VERSION=${stripLeadingV(treeVersion)} pnpm verify:published`
    );
  }
  if (inferred !== stripLeadingV(treeVersion)) {
    throw new Error(
      `[npm] the registry read reported ${inferred} while this tree is ${stripLeadingV(treeVersion)}, ` +
      'so the published-consumer gate would verify an artifact other than the one this tree ' +
      'publishes. Either this tree\'s version is not on npm yet, or that read came from npm\'s ' +
      'local packument cache, which lags a publish. Pass it explicitly: ' +
      `PUBLISHED_VERSION=${stripLeadingV(treeVersion)} pnpm verify:published`
    );
  }
  return inferred;
}

async function main() {
  const workspace = process.cwd();
  const packageJson = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: workspace, encoding: 'utf8' }));
  const packageName = packageJson.name;
  const version = resolveTargetVersion(
    process.env.PUBLISHED_VERSION,
    () => execFileSync('npm', ['view', packageName, 'version', '--registry', 'https://registry.npmjs.org'], { encoding: 'utf8' }),
    packageJson.version
  );
  const attempts = Number(process.env.PUBLISHED_VERIFY_ATTEMPTS ?? 6);
  const delayMs = Number(process.env.PUBLISHED_VERIFY_DELAY_MS ?? 5_000);
  if (!Number.isSafeInteger(attempts) || attempts <= 0) throw new TypeError('PUBLISHED_VERIFY_ATTEMPTS must be a positive safe integer.');
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError('PUBLISHED_VERIFY_DELAY_MS must be a non-negative finite number.');
  // Removed in the `finally` below — a release run must not leave the unpacked
  // tarball, its symlinked dependency tree, or the downloaded archive behind.
  const tempRoot = mkdtempSync(join(tmpdir(), 'cross-tab-databus-published-'));

  try {
    let packJson;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        packJson = execFileSync('npm', ['pack', `${packageName}@${version}`, '--json', '--ignore-scripts', '--pack-destination', tempRoot, '--registry', 'https://registry.npmjs.org'], { encoding: 'utf8' });
        break;
      } catch (error) {
        lastError = error;
        if (attempt === attempts) throw error;
        console.warn(`[npm] ${packageName}@${version} not available yet (attempt ${attempt}/${attempts}); retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
    if (!packJson) throw lastError ?? new Error(`Unable to download ${packageName}@${version}`);
    const [{ filename }] = JSON.parse(packJson);
    const packageDir = join(tempRoot, 'package');
    execFileSync('tar', ['-xzf', join(tempRoot, filename), '-C', tempRoot]);
    const nodeModules = join(tempRoot, 'node_modules');
    mkdirSync(nodeModules);
    symlinkSync(packageDir, join(nodeModules, packageName), 'dir');
    for (const dependency of ['react', 'vue', 'centrifuge']) {
      const source = join(workspace, 'node_modules', dependency);
      if (!existsSync(source)) throw new Error(`Missing workspace dependency required by published consumer: ${dependency}`);
      symlinkSync(source, join(nodeModules, dependency), 'dir');
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
  } from '${packageName}';
  import { useCrossTabDataBus } from '${packageName}/hooks';
  import { useCrossTabDataBus as useVueBus } from '${packageName}/vue';
  import { CentrifugeWorkerTransport, createCentrifugeDataBus } from '${packageName}/centrifuge';
  import { createRequire } from 'node:module';
  const require = createRequire(import.meta.url);
  const cjs = require('${packageName}');
  const cjsHooks = require('${packageName}/hooks');
  const cjsVue = require('${packageName}/vue');
  const cjsCentrifuge = require('${packageName}/centrifuge');
  for (const value of [
    CrossTabDataBus, WebSocketTransport, WorkerClusterRuntime, approximatePayloadBytes,
    createBrowserEnvironment, createIndexedDbReplayPersistence, createOpaqueKey,
    createStorageEventChannel, createWebSocketDataBus, effectiveWorkerLoad,
    selectWorkerBackend, topicMatchesPattern,
    useCrossTabDataBus, useVueBus, CentrifugeWorkerTransport, createCentrifugeDataBus,
    cjs.CrossTabDataBus, cjs.createWebSocketDataBus, cjs.effectiveWorkerLoad,
    cjsHooks.useCrossTabDataBus, cjsVue.useCrossTabDataBus, cjsCentrifuge.createCentrifugeDataBus
  ]) {
    if (typeof value !== 'function') throw new Error('published consumer export is not callable');
  }
`;
    try {
      execFileSync(process.execPath, ['--input-type=module', '-e', consumer], { cwd: tempRoot, stdio: 'inherit' });
    } catch (error) {
      console.error(`[npm] consumer import failed for ${packageName}@${version}; package=${packageDir}`);
      console.error(`[npm] dependency links: ${['react', 'vue', 'centrifuge'].map(name => `${name}=${existsSync(join(nodeModules, name))}`).join(', ')}`);
      throw error;
    }
    console.log(`[npm] verified published ${packageName}@${version} ESM/CJS consumers`);
  } finally {
    // Best-effort: a blocked delete (a locked file, or a sandbox that refuses
    // bulk deletes) must not turn a successful verification into a failed
    // release gate. Warn instead of throwing, and never mask the real error.
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `[npm] could not remove the temp root ${tempRoot}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
