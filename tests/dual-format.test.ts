/**
 * Dual-format build verification.
 *
 * `pnpm check` runs `build` BEFORE `test`, so these assertions validate the
 * freshly built artifacts: the ESM entry and the CJS bundle required by
 * CommonJS consumers both expose the public API surface, and every path
 * promised by package.json `exports` actually exists on disk.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const PUBLIC_FUNCTIONS = [
  'CrossTabDataBus',
  'WorkerClusterRuntime',
  'createBrowserEnvironment',
  'getOrCreateTabId',
  'createOpaqueKey',
  'selectWorkerBackend'
] as const;

const SUBPATH_EXPORTS = {
  './hooks': ['useCrossTabDataBus', 'useCrossTabSubscription', 'useCrossTabStatus'],
  './vue': ['useCrossTabDataBus', 'useCrossTabSubscription', 'useCrossTabStatus'],
  './centrifuge': ['CentrifugeWorkerTransport', 'createCentrifugeDataBus']
} as const;

describe('dual-format build artifacts', () => {
  it('exposes the public API to CommonJS consumers via dist/cjs', () => {
    const lib: Record<string, unknown> = require('../dist/cjs/index.cjs');
    for (const name of PUBLIC_FUNCTIONS) {
      expect(typeof lib[name], `dist/cjs missing export: ${name}`).toBe('function');
    }
  });

  it('exposes the public API to ESM consumers via dist', async () => {
    // Built as a non-literal specifier so tsc does not statically resolve it
    // (dist/ may not exist during a pre-build typecheck).
    const lib = await import(/* @vite-ignore */ `../dist/${'index.js'}`);
    for (const name of PUBLIC_FUNCTIONS) {
      expect(typeof (lib as Record<string, unknown>)[name], `dist missing export: ${name}`).toBe(
        'function'
      );
    }
  });

  it('keeps every public subpath consumable in both module formats', async () => {
    for (const [subpath, names] of Object.entries(SUBPATH_EXPORTS)) {
      const entry = subpath.slice(2);
      const esm = (await import(/* @vite-ignore */ `../dist/${entry}.js`)) as Record<string, unknown>;
      const cjs = require(`../dist/cjs/${entry}.cjs`) as Record<string, unknown>;
      for (const name of names) {
        expect(typeof esm[name], `dist/${entry}.js missing export: ${name}`).toBe('function');
        expect(typeof cjs[name], `dist/cjs/${entry}.cjs missing export: ${name}`).toBe('function');
      }
    }
  });

  it('freezes the root export surface so additions/removals are deliberate', async () => {
    // Pinning the exact runtime export set: pre-1.0 the public API is
    // intentionally growing, but every change must be a conscious decision
    // (documented in docs/api.md and release notes), not an incidental one.
    const expected = [
      'CrossTabDataBus',
      'DEFAULT_MAX_ACTIVE_WORKERS',
      'WebSocketTransport',
      'WorkerClusterRuntime',
      'approximatePayloadBytes',
      'createBrowserEnvironment',
      'createIndexedDbReplayPersistence',
      'createOpaqueKey',
      'createStorageEventChannel',
      'createWebSocketDataBus',
      'effectiveWorkerLoad',
      'getOrCreateTabId',
      'hasActiveOwner',
      'isWildcardTopic',
      'selectActiveWorkers',
      'selectLeastLoadedWorker',
      'selectRebalanceTarget',
      'selectWorkerBackend',
      'topicMatchesPattern'
    ];
    const lib = (await import(/* @vite-ignore */ `../dist/${'index.js'}`)) as Record<string, unknown>;
    expect(Object.keys(lib).sort()).toEqual(expected);
  });

  it('publishes declarations for every public subpath and key option type', () => {
    const declarations = ['index.d.ts', 'hooks.d.ts', 'vue.d.ts', 'centrifuge.d.ts'];
    for (const file of declarations) {
      expect(existsSync(`dist/${file}`), `declaration missing: dist/${file}`).toBe(true);
    }
    const indexTypes = require('node:fs').readFileSync('dist/index.d.ts', 'utf8') as string;
    expect(indexTypes).toContain('DataBusPublicationMetadata');
    expect(indexTypes).toContain('DataBusReplayPersistence');
    expect(indexTypes).toContain('DataBusDedupOptions');
    expect(indexTypes).toContain('DataBusHealthSummary');
    expect(indexTypes).toContain('DataBusPersistenceHealth');
  });

  it('reports the CJS-only default Worker failure with the actionable message', async () => {
    // The bundled default Workers are located relative to the module:
    // `new URL('./centrifuge.worker.js', import.meta.url)`. esbuild shims
    // `import.meta` to `{}` in the CommonJS bundle, so that specifier cannot
    // resolve and the transport has to surface its "pass workerFactory
    // explicitly" error rather than a bare TypeError. The ESM build resolves the
    // same URL and constructs the Worker — asserting both halves is what ties
    // the failure to the module format instead of to a typo in the filename.
    type Transport = {
      start: (config: unknown, handlers: unknown) => void;
      stop: () => void;
    };
    const constructed: string[] = [];
    class StubWorkerGlobal {
      readonly port = {
        postMessage(): void {},
        addEventListener(): void {},
        removeEventListener(): void {},
        start(): void {},
        close(): void {}
      };
      constructor(url: URL | string) {
        constructed.push(String(url));
      }
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      terminate(): void {}
      close(): void {}
    }
    const previousWorker = globalThis.Worker;
    const previousSharedWorker = globalThis.SharedWorker;
    globalThis.Worker = StubWorkerGlobal as unknown as typeof Worker;
    globalThis.SharedWorker = StubWorkerGlobal as unknown as typeof SharedWorker;
    const handlers = { onMessage: () => undefined, onStatus: () => undefined, onError: () => undefined };
    const config = { url: 'ws://example.invalid/connection/websocket' };
    try {
      const cjs = require('../dist/cjs/centrifuge.cjs') as {
        CentrifugeWorkerTransport: new (options: { workerMode: string }) => Transport;
      };
      for (const [mode, message] of [
        ['dedicated', 'default Centrifuge Worker URL is unavailable'],
        ['shared', 'default Centrifuge SharedWorker URL is unavailable']
      ] as const) {
        expect(() => new cjs.CentrifugeWorkerTransport({ workerMode: mode }).start(config, handlers))
          .toThrow(message);
      }

      const esm = (await import(/* @vite-ignore */ `../dist/${'centrifuge.js'}`)) as {
        CentrifugeWorkerTransport: new (options: { workerMode: string }) => Transport;
      };
      for (const mode of ['dedicated', 'shared'] as const) {
        const transport = new esm.CentrifugeWorkerTransport({ workerMode: mode });
        expect(() => transport.start(config, handlers)).not.toThrow();
        transport.stop();
      }
      expect(constructed).toHaveLength(2);
      expect(constructed[0]).toContain('centrifuge.worker.js');
      expect(constructed[1]).toContain('centrifuge.shared.worker.js');
    } finally {
      globalThis.Worker = previousWorker;
      globalThis.SharedWorker = previousSharedWorker;
    }
  });

  it('materialises every path declared in package.json exports', () => {
    const pkg = require('../package.json') as {
      exports: Record<string, Record<string, string> | string>;
    };
    const targets: string[] = [];
    for (const value of Object.values(pkg.exports)) {
      if (typeof value === 'string') targets.push(value);
      else targets.push(...Object.values(value));
    }
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const file = target.replace(/^\.\//, '');
      expect(existsSync(file), `exports target missing: ${file}`).toBe(true);
    }
  });
});
