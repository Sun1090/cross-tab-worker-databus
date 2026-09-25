/**
 * Pre-publish release-record gate.
 *
 * Two things must be true before a tag is worth pushing: the tag names this tree
 * and its CHANGELOG section has notes, and — since this release cycle — every
 * version the CHANGELOG names from `firstGatedRelease` forward actually exists in
 * the registry. The second half is the failure mode this exists to stop. Measured
 * against the packument on the day `v0.21.33` published: 40 of this file's 163
 * `## [x.y.z]` sections name versions the registry has never recorded (no `time[]`
 * entry at all) — `0.9.0`, each minor's first patch from `0.12.0` to `0.18.0`, all
 * ten `0.19.x`, `0.20.0`–`0.20.5`, `0.20.54`, `0.20.55`, `0.20.69` and
 * `0.20.72`–`0.20.84`, which is 1 + 7 + 10 + 6 + 2 + 1 + 13 = 40 — 27 of them
 * carrying a git tag and 38 a `docs/roadmap.md` delivered-scope block. Those were cut as releases and never published, and
 * nothing noticed for twenty releases. Re-derive the tally with
 * `npm view cross-tab-worker-databus time --json --registry https://registry.npmjs.org`
 * compared against `grep -c '^## \[' CHANGELOG.md`; the number above is a
 * snapshot of that lookup,
 * taken after the tag, because the same measurement taken twelve minutes earlier —
 * while `v0.21.33` was still only a local commit — came out 41, and this comment
 * was written from *that* reading.
 *
 * Lockstep holds from `0.20.85` — every section at or after it is on npm — so the
 * floor is set there and this gate is prospective: it stops a new hole, it does
 * not litigate the old ones, which are history and would need 40 rewritten
 * sections to "fix".
 *
 * A registry read is skipped rather than fatal: refusing a *good* release because
 * one HTTP call failed is the exact failure this project has already paid for
 * twice with the published-consumer ceiling. A confirmed absence is different in
 * kind — `time[]` records never expire, so a version missing from a read of the
 * authoritative registry was never published.
 *
 * "Authoritative" is doing work in that sentence, which is why the read names
 * `https://registry.npmjs.org` explicitly. Measured while preparing `0.21.35`: this
 * machine's `npm` is configured to `registry.npmmirror.com`, whose copy of the
 * packument reported `modified: 2026-09-25T00:32:51.767Z` — the `0.21.33` publish —
 * while npmjs had recorded `0.21.34` at `02:47:50.782Z`. So the gate reported
 * `CHANGELOG names 1 release(s) the registry has never recorded: 0.21.34` for a
 * version npmjs had recorded **3,207 s** earlier (that run is stamped
 * `03:41:18Z`; the mirror's own `modified` did not move until `03:44:48.778Z`,
 * 3,418 s after the record), and it did so from a read that **succeeded**: a
 * mirror's own sync lag is not HTTP caching, and a no-store request returns the
 * same stale document. That falsifies the inference above in
 * its second premise, not its first — `time[]` entries do not expire, but a
 * document that has never *learned* about a version is not a record of its
 * absence. `verify-published-consumer.mjs` already pinned `--registry` for both
 * its reads and for the same reason; this was the last npm-based registry read in
 * the repository that did not.
 *
 * The failure message names two remedies, and one of them is a prose edit, so it has
 * to say which prose works. Measured against `findUnpublishedReleases` with a version
 * absent from `time`: `## [0.20.91] - never released` is still reported, exactly like
 * the plain standing section, while `## 0.20.91 — never released` and
 * `## ~~[0.20.91]~~ …` come back clean. The exemption is the heading *shape* this scan
 * matches, not a keyword — the good property (no phrase a typo can trip) and the one
 * the earlier wording hid. Pinned both ways in `tests/release-version.test.ts`,
 * including the still-reported direction, so a later reader cannot turn the gate into
 * a keyword scan by "fixing" the marker case.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Releases at or after this one must be present in the registry. */
export const firstGatedRelease = '0.20.85';

const numericCore = value => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const compareCores = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Which named releases the registry has never recorded.
 *
 * `releasingVersion` is exempt by necessity: this runs before the publish, so the
 * version being tagged is the one thing legitimately absent.
 */
export function findUnpublishedReleases({
  changelog,
  time,
  releasingVersion,
  firstGated = firstGatedRelease
}) {
  const floor = numericCore(firstGated);
  if (!floor) throw new Error(`firstGatedRelease ${JSON.stringify(firstGated)} is not x.y.z`);
  const named = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+(?:-[^\]]+)?)\]/gm)].map(match => match[1]);
  return named.filter((version, index) => {
    if (version === releasingVersion) return false;
    // A duplicate section is the other check's problem; report the hole once.
    if (named.indexOf(version) !== index) return false;
    const core = numericCore(version);
    return compareCores(core, floor) >= 0 && !Object.hasOwn(time, version);
  });
}

/**
 * The registry whose absence-claim is proof: npm itself. Configured mirrors can
 * lag it by hours while serving a document that reads as a successful fetch — see
 * the header above for the measured instance.
 */
export const authoritativeRegistry = 'https://registry.npmjs.org';

/**
 * The registry's own record of when each version landed. Injectable so the gate is
 * testable without a network, the way its sibling injects the version read.
 */
export function readRegistryTime(name, read = () => process.env.RELEASE_REGISTRY_TIME) {
  const injected = read();
  if (injected) return JSON.parse(injected);
  const raw = execFileSync(
    'npm',
    ['view', name, 'time', '--json', '--registry', authoritativeRegistry],
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`\`npm view ${name} time --json\` against ${authoritativeRegistry} did not return an object`);
  }
  return parsed;
}

export function main() {
  const tag = process.env.RELEASE_TAG;
  const { version, name } = JSON.parse(readFileSync('package.json', 'utf8'));
  if (!tag || tag !== `v${version}`) {
    throw new Error(`release tag ${JSON.stringify(tag)} must equal package version tag v${version}`);
  }

  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\](.*)$/gm)];
  const matching = headings.filter(heading => heading[1] === version);
  if (matching.length !== 1) {
    throw new Error(`CHANGELOG must contain exactly one section for ${version}`);
  }
  const heading = matching[0];
  const next = headings.find(candidate => candidate.index > heading.index);
  const notes = changelog.slice(heading.index + heading[0].length, next?.index).trim();
  if (!notes) {
    throw new Error(`CHANGELOG section for ${version} must contain release notes`);
  }
  console.log(`[release] ${tag} matches package.json and has non-empty release notes`);

  let time;
  try {
    time = readRegistryTime(name);
  } catch (error) {
    console.warn(
      `[release] could not read the registry's version history (${String(error).slice(0, 200)}), ` +
      'so the changelog/registry completeness check was SKIPPED. It is not a release failure; ' +
      're-run this step to get the verdict.'
    );
    return;
  }
  const missing = findUnpublishedReleases({ changelog, time, releasingVersion: version });
  if (missing.length > 0) {
    throw new Error(
      `[release] CHANGELOG names ${missing.length} release(s) the registry has never recorded: ` +
      `${missing.join(', ')}. Each needs either its artifact published or its section heading ` +
      `dropped out of the \`## [x.y.z]\` form this scan reads (writing "never released" beside a ` +
      `bracketed version does not exempt it) — the floor here is ${firstGatedRelease}, above which ` +
      'every named release has been published since.'
    );
  }
  const gated = [...new Set(
    [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+(?:-[^\]]+)?)\]/gm)]
      .map(match => match[1])
      .filter(named => {
        const core = numericCore(named);
        return core && compareCores(core, numericCore(firstGatedRelease)) >= 0;
      })
  )].filter(named => named !== version);
  console.log(
    `[release] the ${gated.length} earlier CHANGELOG releases from ${firstGatedRelease} on are all in ` +
    `the registry's \`time\` map (${version} is the release in flight and is exempt)`
  );
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
