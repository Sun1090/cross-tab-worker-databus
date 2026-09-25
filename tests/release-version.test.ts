import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve('scripts/verify-release-version.mjs');

function verify(
  tag: string | undefined,
  changelog: string,
  version = '0.20.92',
  registryTime: string | undefined = JSON.stringify({ [version]: '2026-09-18T00:00:00.000Z' })
): string {
  const cwd = mkdtempSync(join(tmpdir(), 'databus-release-version-'));
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'cross-tab-worker-databus', version }));
    writeFileSync(join(cwd, 'CHANGELOG.md'), changelog);
    const env = { ...process.env };
    if (tag === undefined) delete env.RELEASE_TAG;
    else env.RELEASE_TAG = tag;
    // The registry history is injected so no test reaches the network; the stub is
    // always set or cleared explicitly, because an ambient value in the developer's
    // or CI's environment would otherwise decide what these tests observe.
    if (registryTime === undefined) delete env.RELEASE_REGISTRY_TIME;
    else env.RELEASE_REGISTRY_TIME = registryTime;
    // The script reports a skipped completeness pass on stderr, so both streams are
    // returned; a non-zero exit still throws with that text in the message, which is
    // what the `toThrow(...)` assertions match on (execFileSync's own error carried
    // the same string before this call was rewritten with spawnSync).
    const spawned = spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' });
    if (spawned.status !== 0) {
      throw new Error(`${spawned.stdout ?? ''}${spawned.stderr ?? ''}`);
    }
    return `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`;
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

  // The completeness half: a CHANGELOG section is a claim that a version exists,
  // and 41 of them in this repository's history are claims the registry never
  // recorded. See the header of scripts/verify-release-version.mjs for the measured
  // hole and for why the floor sits where it does.
  const twoReleases = '## [0.20.92] - 2026-09-18\n\n### Fixed\n- Newer.\n\n## [0.20.91] - 2026-09-17\n\n### Fixed\n- Older.\n';

  it('rejects a named release the registry never recorded, and names it', () => {
    expect(() => verify('v0.20.92', twoReleases, '0.20.92', JSON.stringify({ '0.20.92': 't' })))
      .toThrow('the registry has never recorded: 0.20.91');
  });

  it('exempts the release in flight, which cannot be published yet', () => {
    expect(verify('v0.20.92', twoReleases, '0.20.92', JSON.stringify({ '0.20.91': 't' })))
      .toContain('earlier CHANGELOG releases from 0.20.85 on are all in');
  });

  it('leaves releases below the floor alone, because the hole predates the discipline', () => {
    const belowFloor = '## [0.20.92] - 2026-09-18\n\n- Newer.\n\n## [0.20.5] - 2026-08-01\n\n- Never published.\n';
    expect(verify('v0.20.92', belowFloor, '0.20.92', JSON.stringify({ '0.20.92': 't' })))
      .toContain('are all in');
  });

  it('reports a hole once even when its section is duplicated', () => {
    const doubled = twoReleases + '\n## [0.20.91] - 2026-09-17\n\n- Repeated.\n';
    // "names 1 release" is the dedupe: counting sections instead of versions would
    // report the same hole twice. (The duplicate is on the *older* version, whose
    // section uniqueness the other check does not police.)
    expect(() => verify('v0.20.92', doubled, '0.20.92', JSON.stringify({ '0.20.92': 't' })))
      .toThrow('names 1 release');
  });

  it('skips the completeness check rather than failing a release over a bad read', () => {
    const output = verify('v0.20.92', twoReleases, '0.20.92', 'not json');
    expect(output).toContain('SKIPPED');
    expect(output).not.toContain('never recorded');
  });
});
