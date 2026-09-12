import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOpaqueKey } from '../src/core/hash';
import { hasActiveOwner, selectLeastLoadedWorker } from '../src/core/routing';
import type { WorkerRecord } from '../src/core/types';

/**
 * Regression tests for the deep-refactor batch. These exercise the helpers and
 * code paths introduced/extracted during the second optimization pass so a
 * future change cannot silently break them.
 */

const makeWorker = (overrides: Partial<WorkerRecord> = {}): WorkerRecord => ({
  workerId: 'w1',
  tabId: 't1',
  load: 0,
  role: 'active',
  status: 'connected',
  visibilityState: 'visible',
  heartbeatAt: 0,
  registeredAt: 0,
  ...overrides
});

describe('routing: locale-independent tie-break', () => {
  // selectLeastLoadedWorker now compares workerId with < rather than localeCompare.
  // Ensure the tie-break is a plain ascending code-unit comparison, unaffected by
  // the host's collation order.
  it('picks the workerId with the smallest code-unit ordering regardless of locale', () => {
    const upper = makeWorker({ workerId: 'Zeta', load: 1 });
    const lower = makeWorker({ workerId: 'alpha', load: 1 });
    // Code-unit comparison: uppercase 'Z' (90) < lowercase 'a' (97), so 'Zeta'
    // wins — the opposite of a case-insensitive locale sort.
    expect(selectLeastLoadedWorker([upper, lower])?.workerId).toBe('Zeta');
    expect(selectLeastLoadedWorker([lower, upper])?.workerId).toBe('Zeta');
  });

  it('hasActiveOwner accepts a route shaped like the storage record', () => {
    const route = { topicKey: 'k', workerId: 'w1', tabId: 't1', updatedAt: 0, generation: 1 };
    expect(hasActiveOwner(route, [makeWorker({ workerId: 'w1' })])).toBe(true);
    expect(hasActiveOwner(route, [makeWorker({ workerId: 'w2' })])).toBe(false);
  });
});

describe('hash: regression invariants after refactor', () => {
  it('createOpaqueKey stays stable across calls in the same process', () => {
    const key = createOpaqueKey('regression.topic');
    expect(createOpaqueKey('regression.topic')).toBe(key);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('source hygiene', () => {
  const sourceFiles = (): string[] => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(name => {
        const child = join(dir, name);
        return statSync(child).isDirectory() ? walk(child) : child.endsWith('.ts') ? [child] : [];
      });
    return walk('src');
  };

  it('keeps scripts/ covered by ESLint', () => {
    // scripts/ used to be in the ignores list, so the release-critical tooling
    // (the bench gate, the consumer verifiers, the demo servers) was never
    // linted. Removing the ignore surfaced a real `preserve-caught-error` in
    // verify-version-compat.mjs and a misindented line in serve-examples.mjs.
    const config = readFileSync('eslint.config.js', 'utf8');
    const ignores = /ignores:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
    expect(ignores, 'scripts/ must not be in the ESLint ignores list').not.toContain("'scripts/**'");
  });

  it('keeps the consumer verifiers from polluting the checkout or the temp dir', () => {
    // Both release verifiers unpack a tarball. `verify:pack` used to run a bare
    // `npm pack`, which writes `cross-tab-worker-databus-*.tgz` into the repo
    // root — a stale archive per version, left behind on every push because CI
    // runs the smoke each time. Neither script removed its `mkdtempSync` root,
    // so each run also leaked ~3 MB of unpacked package into the OS temp dir.
    const read = (name: string): string => readFileSync(join('scripts', name), 'utf8');

    const packed = read('verify-packed-consumer.mjs');
    expect(packed, 'npm pack must write into the temp root').toContain("'--pack-destination', tempRoot");
    expect(packed, 'the tarball must be read back from the temp root').toContain('join(tempRoot, filename)');

    for (const name of ['verify-packed-consumer.mjs', 'verify-published-consumer.mjs']) {
      const script = read(name);
      expect(script, `${name} must remove its temp root`).toContain(
        'rmSync(tempRoot, { recursive: true, force: true })'
      );
      expect(script, `${name} must remove it on the failure path too`).toContain('} finally {');
    }
  });

  it('keeps every test-imported entry-point script free of import-time side effects', () => {
    // tests/bench-browser.test.ts imports the pure `parseBenchEnv` from
    // scripts/bench-browser.mjs. That script used to run the *whole* benchmark
    // at module scope, so importing it spawned the demo server and launched a
    // Chromium instance — making the parser untestable. Any script that is both
    // a package.json entry point (`node scripts/x.mjs`) and imported by a test
    // must gate its runtime body behind an `invokedDirectly` check.
    //
    // Pure library modules (scripts/demo-ws-server.mjs, which exports installer
    // functions with no top-level execution) are exempt: they have nothing to
    // gate, and are imported for their exports.
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(name => {
        const child = join(dir, name);
        return statSync(child).isDirectory() ? walk(child) : /\.tsx?$/.test(child) ? [child] : [];
      });

    const imported = new Set<string>();
    for (const file of walk('tests')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/from '(\.\.\/scripts\/[\w.-]+\.mjs)'/g)) {
        imported.add(match[1]!.replace('../scripts/', ''));
      }
    }

    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
    const entryPoints = new Set(
      Object.values(manifest.scripts ?? {}).flatMap(command =>
        [...command.matchAll(/scripts\/([\w.-]+\.mjs)/g)].map(match => match[1]!)
      )
    );

    const covered = [...imported].filter(name => entryPoints.has(name)).sort();
    expect(covered, 'expected a test to import at least one entry-point script').not.toEqual([]);

    const offenders: string[] = [];
    for (const name of covered) {
      const source = readFileSync(join('scripts', name), 'utf8');
      if (!/^const invokedDirectly =/m.test(source) || !/^if \(invokedDirectly\) \{/m.test(source)) {
        offenders.push(`scripts/${name} runs at import time — gate its body behind \`invokedDirectly\``);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never statically imports dist from a test (tsc runs before the build)', () => {
    // `pnpm check` is `typecheck && build && test`, so `tsc --noEmit` sees a
    // fresh checkout with no dist/ and rejects a literal specifier with
    // TS2307 — which is exactly how a new documentation guard broke CI while
    // passing locally (where dist/ already existed). Use the non-literal form
    // instead: `await import(/* @vite-ignore */ `../dist/${'index.js'}`)`.
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(name => {
        const child = join(dir, name);
        return statSync(child).isDirectory() ? walk(child) : /\.tsx?$/.test(child) ? [child] : [];
      });
    const offenders: string[] = [];
    for (const file of walk('tests')) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const call = /import\(([^)]*)/.exec(line);
          if (!call) return;
          // Strip an inline `/* @vite-ignore */` (or any block comment) first.
          const argument = call[1]!.replace(/\/\*[^]*?\*\//g, '').trim();
          if (/^['"]\.\.\/dist\//.test(argument)) {
            offenders.push(`${file}:${index + 1} statically imports dist — use a non-literal specifier`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('does not leave a duplicated JSDoc block stacked on a declaration', () => {
    // A copy-paste can leave two JSDoc blocks in a row; only the last one is
    // attached to the declaration, so the first becomes dead documentation that
    // silently drifts. (Found: BatchingStorageWriter carried its class doc
    // twice, the first a truncated copy.) A file-level header followed by a
    // member's own doc is fine — only a *prefix duplicate* is flagged.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n');
      const blocks: Array<{ start: number; end: number; body: string }> = [];
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index]!.trim() !== '/**') continue;
        let end = index;
        while (end < lines.length && lines[end]!.trim() !== '*/') end += 1;
        if (end >= lines.length) continue;
        const body = lines
          .slice(index + 1, end)
          .map(line => line.replace(/^\s*\*\s?/, '').trimEnd())
          .join('\n')
          .trim();
        blocks.push({ start: index + 1, end: end + 1, body });
        index = end;
      }
      for (let index = 0; index + 1 < blocks.length; index += 1) {
        const first = blocks[index]!;
        const second = blocks[index + 1]!;
        const between = lines.slice(first.end, second.start - 1).join('\n').trim();
        if (between !== '') continue;
        if (second.body.startsWith(first.body)) {
          offenders.push(`${file}:${first.start} duplicates the JSDoc block at line ${second.start}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
