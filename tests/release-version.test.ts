import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
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

/** Two named releases, so the completeness half has something to audit. */
const twoReleases = '## [0.20.92] - 2026-09-18\n\n### Fixed\n- Newer.\n\n## [0.20.91] - 2026-09-17\n\n### Fixed\n- Older.\n';

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

  it('rejects a named release the registry never recorded, and names it', () => {
    expect(() => verify('v0.20.92', twoReleases, '0.20.92', JSON.stringify({ '0.20.92': 't' })))
      .toThrow('the registry has never recorded: 0.20.91');
  });

  it('exempts the release in flight, which cannot be published yet', () => {
    expect(verify('v0.20.92', twoReleases, '0.20.92', JSON.stringify({ '0.20.91': 't' })))
      .toContain('earlier CHANGELOG releases from 0.20.85 on are all in');
  });

  it('exempts an abandoned release by its heading shape, and says so in the failure', () => {
    // The message offers two remedies, one of them a prose edit, so which prose works
    // is the contract: the exemption belongs to the `## [x.y.z]` heading shape this
    // scan matches, not to any word written beside it.
    const time = JSON.stringify({ '0.20.92': 't' });
    const bracketed = '## [0.20.92] - 2026-09-18\n\n- Newer.\n\n## [0.20.91] - never released\n\n- Older.\n';
    expect(() => verify('v0.20.92', bracketed, '0.20.92', time))
      .toThrow('the registry has never recorded: 0.20.91');
    const bare = '## [0.20.92] - 2026-09-18\n\n- Newer.\n\n## 0.20.91 - never released\n\n- Older.\n';
    expect(verify('v0.20.92', bare, '0.20.92', time)).toContain('are all in');
    // Read the message rather than trusting the two legs above: a green pair here is
    // also what a keyword exemption would produce, and that is the wrong lesson.
    expect(() => verify('v0.20.92', twoReleases, '0.20.92', time))
      .toThrow('heading dropped out of the');
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

/**
 * The read that decides "this version was never published" has to be a read of
 * npm itself, not of whatever `npm` is configured to talk to. Measured while
 * preparing `0.21.35`: this machine's registry is a mirror whose copy of the
 * packument still reported `modified` at the `0.21.33` publish when the gate ran at
 * 03:41:18Z, 3,207 s after npmjs recorded `0.21.34` (the mirror's own `modified` did not
 * move until 03:44:48.778Z, 3,418 s after the record), so the gate declared a public
 * version one "the
 * registry has never recorded", and it did so from a read that *succeeded*. A
 * mirror's own sync lag is not HTTP caching, so `cache-control: no-cache` returns
 * the same stale document; only naming the registry fixes it.
 *
 * Every case above injects `RELEASE_REGISTRY_TIME`, so none of them can see which
 * registry the real path consults — that is why this defect reached a release
 * tool undetected. This one runs the un-injected path against a stub `npm` and
 * reads back the argument vector it was handed.
 */
describe('registry read', () => {
  it('names the authoritative registry rather than the ambient npm config', () => {
    const root = mkdtempSync(join(tmpdir(), 'databus-release-registry-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const capture = join(root, 'argv.txt');
      writeFileSync(capture, '');
      writeFileSync(
        join(bin, 'npm'),
        [
          '#!/usr/bin/env node',
          "require('node:fs').appendFileSync(process.env.RELEASE_NPM_ARGV, process.argv.slice(2).join(' ') + '\\n');",
          `process.stdout.write(${JSON.stringify(JSON.stringify({ '0.20.92': 't', '0.20.91': 't' }))});`
        ].join('\n'),
        { mode: 0o755 }
      );
      const project = join(root, 'project');
      mkdirSync(project);
      writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'cross-tab-worker-databus', version: '0.20.92' }));
      writeFileSync(join(project, 'CHANGELOG.md'), twoReleases);

      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, RELEASE_NPM_ARGV: capture };
      delete env.RELEASE_REGISTRY_TIME;
      env.RELEASE_TAG = 'v0.20.92';
      const spawned = spawnSync(process.execPath, [script], { cwd: project, env, encoding: 'utf8' });
      // The stub answers with both versions present, so a green run here is the
      // proof the read was made at all; a failed one would print its own skip.
      expect(`${spawned.stdout ?? ''}${spawned.stderr ?? ''}`).toContain('are all in');

      const args = readFileSync(capture, 'utf8').trim().split(' ');
      const flag = args.indexOf('--registry');
      expect(flag, `the gate called npm without naming a registry: ${args.join(' ')}`).toBeGreaterThanOrEqual(0);
      expect(args[flag + 1]).toBe('https://registry.npmjs.org');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
