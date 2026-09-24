import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const script = resolve('scripts/verify-version-compat.mjs');

// Every case here builds a throwaway git repository and runs the gate as a child
// process: `checkExports` issues `git init`, `git add`, `git commit`, `git tag` and
// one `node` spawn, so a test's cost is five process starts plus temp-tree I/O
// rather than the object comparison it asserts on. That makes the global 15 s
// `testTimeout` (vitest.config.ts) load-dependent for this file alone, measured
// three ways on an 8-core host at load average 400+:
//   - `pnpm test:coverage`, nothing else of mine running: one case timed out
//     (`Error: Test timed out in 15000ms`), 940 of 941 passed.
//   - this file alone in its worker, while a `pnpm bench` of mine competed: two
//     cases timed out and the survivors reported 3-19 s each. **Those per-case
//     numbers are confounded** by that concurrency and are the slowest reading of
//     the three.
//   - this file alone, contention gone, same load average: 18 passed in 23.7 s
//     total, i.e. ~1.3 s per case and nothing near the ceiling.
// So the flake is real (the first bullet reproduces it without any help from this
// session) but intermittent, and which case crosses 15 s moved between runs — the
// signature of scheduling rather than of a hang. The ceiling is widened for this
// file only, so every in-process test keeps relying on the global.
vi.setConfig({ testTimeout: 60_000 });

function checkExports(
  baselineExports: unknown,
  currentExports: unknown,
  metadata: { baseline: Record<string, unknown>; current: Record<string, unknown> } = { baseline: {}, current: {} }
): string {
  const cwd = mkdtempSync(join(tmpdir(), 'databus-compat-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  try {
    git('init', '--quiet');
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '0.1.0', exports: baselineExports, ...metadata.baseline }));
    git('add', 'package.json');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline');
    git('-c', 'tag.gpgsign=false', 'tag', 'v0.1.0');
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '0.1.1', exports: currentExports, ...metadata.current }));
    return execFileSync(process.execPath, [script], {
      cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, COMPAT_BASE_TAG: 'v0.1.0' }
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('version compatibility export gate', () => {
  it('permits adding exports and changing concrete target filenames', () => {
    expect(checkExports({ '.': { types: './old.d.ts', import: './old.js' } }, {
      '.': { types: './new.d.ts', import: './new.js', require: './new.cjs' }, './extra': './extra.js'
    })).toContain('preserves public exports');
  });

  it('rejects replacing object-shaped typesVersions metadata with a scalar', () => {
    expect(() => checkExports({}, {}, {
      baseline: { typesVersions: { '*': { '*': ['./index.d.ts'] } } },
      current: { typesVersions: './index.d.ts' }
    })).toThrow('changed package field typesVersions shape');
  });

  it('rejects replacing typesVersions metadata with an array', () => {
    expect(() => checkExports({}, {}, {
      baseline: { typesVersions: { '*': { '*': ['./index.d.ts'] } } },
      current: { typesVersions: ['./index.d.ts'] }
    })).toThrow('changed package field typesVersions shape');
  });

  it('rejects replacing scalar types metadata with an object', () => {
    expect(() => checkExports({}, {}, {
      baseline: { types: './index.d.ts' },
      current: { types: { path: './index.d.ts' } }
    })).toThrow('changed package field types shape');
  });

  it.each(['types', 'typesVersions'])('rejects disabling package %s metadata with null', field => {
    const target = field === 'types' ? './index.d.ts' : { '*': { '*': ['./index.d.ts'] } };
    expect(() => checkExports({}, {}, {
      baseline: { [field]: target }, current: { [field]: null }
    })).toThrow(`removed package field ${field}`);
  });

  it('rejects replacing typed conditional exports with an untyped string', () => {
    expect(() => checkExports({ '.': { types: './index.d.ts', import: './index.js' } }, {
      '.': './index.js'
    })).toThrow('removed types condition');
  });

  it('permits replacing a string export with a conditional object that keeps a default', () => {
    expect(checkExports({ './feature': './feature.js' }, {
      './feature': { import: './feature.mjs', default: './feature.js' }
    })).toContain('preserves public exports');
  });

  it('rejects replacing an unconditional string export with import-only conditions', () => {
    expect(() => checkExports({ './feature': './feature.js' }, {
      './feature': { import: './feature.mjs' }
    })).toThrow('removed default availability');
  });

  it('permits moving an unconditional export into a non-empty fallback array', () => {
    expect(checkExports({ './feature': './feature.js' }, {
      './feature': ['./feature-modern.js', './feature.js']
    })).toContain('preserves public exports');
  });

  it('rejects replacing an unconditional export with an empty fallback array', () => {
    expect(() => checkExports({ './feature': './feature.js' }, {
      './feature': []
    })).toThrow('removed default availability');
  });

  it('rejects replacing an unconditional fallback array with import-only conditions', () => {
    expect(() => checkExports({ './feature': ['./feature.js'] }, {
      './feature': { import: './feature.mjs' }
    })).toThrow('removed default availability');
  });

  it('rejects disabling a public string export with null', () => {
    expect(() => checkExports({ './package.json': './package.json' }, {
      './package.json': null
    })).toThrow('disabled public export');
  });

  it('rejects removing a custom export condition', () => {
    expect(() => checkExports({ './feature': { browser: './browser.js', default: './node.js' } }, {
      './feature': { default: './node.js' }
    })).toThrow('removed browser condition');
  });

  it('rejects removing a condition nested under another condition', () => {
    expect(() => checkExports({ './feature': {
      node: { import: './node.mjs', require: './node.cjs' }, default: './browser.js'
    } }, { './feature': {
      node: { import: './node.mjs' }, default: './browser.js'
    } })).toThrow('removed node.require condition');
  });

  it('rejects replacing a nested unconditional target with import-only conditions', () => {
    expect(() => checkExports({ './feature': {
      node: './node.js', default: './browser.js'
    } }, { './feature': {
      node: { import: './node.mjs' }, default: './browser.js'
    } })).toThrow('removed default availability');
  });

  it('rejects removing the default condition used by worker entries', () => {
    expect(() => checkExports({ './worker': { types: './worker.d.ts', default: './worker.js' } }, {
      './worker': { types: './worker.d.ts' }
    })).toThrow('removed default condition');
  });

  it('rejects null condition targets without throwing an incidental TypeError', () => {
    expect(() => checkExports({ '.': { types: './index.d.ts', import: './index.js' } }, {
      '.': { types: null, import: './index.js' }
    })).toThrow('removed types condition');
  });
});
