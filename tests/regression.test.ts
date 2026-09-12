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
