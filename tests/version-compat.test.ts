import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve('scripts/verify-version-compat.mjs');

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

  it('rejects disabling a public string export with null', () => {
    expect(() => checkExports({ './package.json': './package.json' }, {
      './package.json': null
    })).toThrow('disabled public export');
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
