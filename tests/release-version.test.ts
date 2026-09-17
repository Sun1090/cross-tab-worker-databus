import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve('scripts/verify-release-version.mjs');

function verify(tag: string | undefined, changelog: string, version = '0.20.92'): string {
  const cwd = mkdtempSync(join(tmpdir(), 'databus-release-version-'));
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version }));
    writeFileSync(join(cwd, 'CHANGELOG.md'), changelog);
    const env = { ...process.env };
    if (tag === undefined) delete env.RELEASE_TAG;
    else env.RELEASE_TAG = tag;
    return execFileSync(process.execPath, [script], { cwd, env, encoding: 'utf8', stdio: 'pipe' });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const notes = '## [Unreleased]\n\nNo unreleased changes yet.\n\n## [0.20.92] - 2026-09-18\n\n### Fixed\n- Lifecycle fixes.\n';

describe('release version gate', () => {
  it('accepts an exact version tag with release notes', () => {
    expect(verify('v0.20.92', notes)).toContain('[release] v0.20.92 matches');
  });

  it.each([undefined, '', 'main', '0.20.92', 'v0.20.91', 'v0.20.920'])('rejects mismatched tag %s', tag => {
    expect(() => verify(tag, notes)).toThrow('must equal package version tag');
  });

  it('accepts matching prerelease versions', () => {
    expect(verify('v1.0.0-rc.1', '## [1.0.0-rc.1]\n\n- Candidate.\n', '1.0.0-rc.1')).toContain('matches');
  });

  it('rejects missing and duplicate changelog sections', () => {
    expect(() => verify('v0.20.92', '## [0.20.920]\n\n- Not this version.')).toThrow('exactly one section');
    expect(() => verify('v0.20.92', notes + '\n## [0.20.92]\n\n- Duplicate.')).toThrow('exactly one section');
  });

  it('does not mistake the following release notes for an empty section', () => {
    expect(() => verify('v0.20.92', '## [0.20.92]\n\n## [0.20.91]\n\n- Older release.')).toThrow('must contain release notes');
  });
});
