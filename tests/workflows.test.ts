import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the release automation. These are textual by design: the repo
 * does not depend on a YAML parser, and the failure modes being pinned are
 * about specific strings/expressions, not document shape.
 */

const WORKFLOW_DIR = '.github/workflows';

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOW_DIR, name), 'utf8');
}

describe('release workflow', () => {
  it('validates tag, package version and notes before publishing or creating a release', () => {
    const workflow = readWorkflow('release.yml');
    const gate = workflow.indexOf('run: node scripts/verify-release-version.mjs');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(workflow.indexOf('- name: Create GitHub release'));
    expect(gate).toBeLessThan(workflow.indexOf('- name: Publish to npm'));
  });

  it('derives the release tag from the dispatch input, not the branch', () => {
    // On workflow_dispatch `github.ref_name` is the selected BRANCH, so a raw
    // `$GITHUB_REF_NAME` in the release/publish steps created a GitHub release
    // named "main" and derived the npm version from the branch.
    const workflow = readWorkflow('release.yml');
    expect(
      workflow,
      'release.yml must define the tag once and use it everywhere'
    ).toContain('RELEASE_TAG: ${{ inputs.tag || github.ref_name }}');

    const shellLines = workflow
      .split('\n')
      .filter(line => !line.trimStart().startsWith('#'));
    for (const [index, line] of shellLines.entries()) {
      if (!line.includes('GITHUB_REF_NAME')) continue;
      // The only allowed URL/expression use is the tag-aware form.
      expect(
        line.includes('inputs.tag || github.ref_name'),
        `release.yml:${index + 1} uses a raw GITHUB_REF_NAME; use RELEASE_TAG (it is the branch on workflow_dispatch): ${line.trim()}`
      ).toBe(true);
    }

    // Every release step that names a version must use the shared variable.
    expect(workflow).toContain('gh release create "$RELEASE_TAG"');
    expect(workflow).toContain('PUBLISHED_VERSION: ${{ env.RELEASE_TAG }}');
  });
});

describe('workflow files', () => {
  const files = readdirSync(WORKFLOW_DIR).filter(name => name.endsWith('.yml') || name.endsWith('.yaml'));

  it('exist and declare triggers plus at least one job', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const workflow = readWorkflow(file);
      expect(workflow, `${file} must declare a name`).toMatch(/^name:/m);
      expect(workflow, `${file} must declare triggers`).toMatch(/^on:/m);
      expect(workflow, `${file} must declare jobs`).toMatch(/^jobs:/m);
      expect(workflow, `${file} must pin at least one action`).toMatch(/uses: [\w-]+\/[\w-]+@/);
    }
  });

  it('checks out the full history where a release-tag baseline is needed', () => {
    // verify:compat resolves its baseline tag from git history; a shallow
    // checkout fails with "no version tag found".
    let reached = 0;
    for (const file of ['ci.yml', 'release.yml']) {
      const workflow = readWorkflow(file);
      if (!workflow.includes('verify:compat')) continue;
      reached += 1;
      expect(workflow, `${file} runs verify:compat but has no full-history checkout`).toMatch(
        /fetch-depth:\s*0/
      );
    }
    // The `continue` above is the whole gate's off switch. Both files name the script today
    // (measured: 2 mentions each), so `reached` of zero means the string left the workflows —
    // a rename, or the step moving into a composite action where this file-level scan cannot
    // see it — and the requirement it exists to enforce is then unchecked while the case
    // reports green. Re-take the count by grepping the script name in .github/workflows rather
    // than from this sentence.
    expect(reached, 'the full-history checkout check must find a workflow that needs it').toBeGreaterThan(0);
  });

  it('re-runs lint in the release job before publishing', () => {
    // A tag may point at a commit that never passed CI's lint step.
    const workflow = readWorkflow('release.yml');
    expect(workflow, 'release.yml must lint before publishing').toMatch(/run:\s*pnpm lint/);
  });

  it('names the Verify step for every command `pnpm check` actually runs', () => {
    // The comment above the step used to read "typecheck + build + test" and the
    // step was named `Verify (typecheck + build + unit tests)`, while the script
    // runs four commands — `test:perf` was invisible in both places. Same class as
    // `0.21.36`'s CONTRIBUTING gloss: a summary of a composite command that omits
    // a member reads as complete and contradicts nothing.
    //
    // The comparison is by COUNT, derived from package.json rather than restated
    // here, so it is the drift that fails and not the wording. Adding a fifth
    // command to `check` without widening the name reddens this case, and so does
    // dropping a token from the name while `check` keeps four.
    const stages = JSON.parse(readFileSync('package.json', 'utf8')).scripts.check.split('&&');
    const stepName = readWorkflow('release.yml')
      .split('\n')
      .find(line => /^\s*- name: Verify \(/.test(line)) ?? '';
    const named = (stepName.match(/\(([^)]*)\)/)?.[1] ?? '').split('+');
    expect(named.length, `the step must name one token per command in pnpm check (${stages.length})`).toBe(stages.length);
    // A name whose parentheses do not exist would split to [''], a one-token list
    // that could still match a one-command `check`; the floor says the step really
    // carries a list.
    expect(named.filter(token => token.trim().length > 0).length).toBe(named.length);
  });

  it('explains that `npm publish` re-runs the whole gate set through prepublishOnly', () => {
    // The publish step takes ~30 s, not the 5 s an upload costs, because the
    // package's `prepublishOnly` lifecycle hook is `pnpm check` — a second full
    // typecheck/build/test/test:perf run that no `run: pnpm …` line shows. The
    // existing quick-reference gate scans `run:` commands and cannot see an
    // implicit hook, which is the 0.21.48 lesson that an omission is invisible to
    // every check this repository has. Measured on run 40111113635: a second
    // `> cross-tab-worker-databus@0.21.51 check` with all four sub-steps inside the
    // `Publish to npm` step's own log.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.prepublishOnly).toBe('pnpm check');
    expect(
      readWorkflow('release.yml'),
      'the publish step must say that the hook re-runs the gate set'
    ).toMatch(/prepublishOnly[\s\S]{0,400}second/i);
  });

  it('keeps enough published-consumer retry budget for npm propagation', () => {
    // The ceiling is a sum of two measured lags, not a comfort number. (1) The
    // registry records the publish *minutes* after `npm publish` returns — for every
    // release in the sweep's modern window, whose size is `scripts/publication-lag.mjs`'s
    // own `modern gap (from 0.20.92) n=` line rather than a count kept here (one lived in
    // this comment and read 42 while the window was already wider); the five releases
    // before that window
    // (0.20.86, 0.20.87, 0.20.88, 0.20.90, 0.20.91) recorded within +-0.6 s of their acks,
    // so the lag is a property of the window and not of npm, and what the budget needs
    // from it is only the maximum. The
    // ack -> `time[<version>]` gap measured on 0.21.27 through 0.21.37 was
    // 74.8-310.0 s — 248.7 / 96.8 / 74.8 / 310.0 / 127.2 / 76.1 / 75.5 / 75.8 /
    // 127.3 / 126.4 / 77.1 s in version order (eleven values; re-count them from this
    // enumeration, or re-derive the series from the tool instead of trusting the list).
    // None exceeds 310 s, so `maxMeasuredAckToRecordMs` below stays at
    // 310 s. (2) The packument `npm pack` resolves against is served
    // `cache-control: public, max-age=300`, so a copy anywhere in the path may be
    // five minutes stale by design and cannot be read sooner than that. Re-derive
    // (1) from a tag run: subtract the `Publish to npm` step's completion from
    // `time[<version>]` in the packument (`gh api
    // repos/<owner>/<repo>/actions/runs/<id>/attempts/<n>/jobs`). Read `<n>` off the
    // run's own `run_attempt` rather than leaving it out: `/jobs` without the segment
    // returns the **latest** attempt, and for the only re-run release in this series
    // (v0.21.30, `run_attempt` 2) that attempt republished nothing — measured, the
    // default read gives a -177.0 s gap and a 1.0 s verify step, while attempt 1 gives
    // the 310.0 s and the 364 s failure quoted above and below.
    //
    // 0.20.89 exhausted a 2-minute budget and 0.21.30 exhausted a 6-minute one,
    // both after successful publishes; the 6-minute case failed at 364 s while the
    // version's tarball was already fetchable. So the floor below is the measured
    // worst case of both lags added, and the workflow's actual budget sits above it.
    const workflow = readWorkflow('release.yml');
    const attempts = Number(
      /PUBLISHED_VERIFY_ATTEMPTS:\s*(\d+)/.exec(workflow)?.[1]
    );
    const delayMs = Number(
      /PUBLISHED_VERIFY_DELAY_MS:\s*(\d+)/.exec(workflow)?.[1]
    );
    expect(Number.isSafeInteger(attempts) && attempts > 0, 'PUBLISHED_VERIFY_ATTEMPTS must be a positive integer').toBe(true);
    expect(Number.isFinite(delayMs) && delayMs > 0, 'PUBLISHED_VERIFY_DELAY_MS must be a positive number').toBe(true);
    const packumentCacheLifetimeMs = 300_000;
    const maxMeasuredAckToRecordMs = 310_000;
    const totalMs = attempts * delayMs;
    expect(
      totalMs,
      `release.yml: the published-consumer gate only waits ${totalMs / 1000}s; it must clear the measured ack->registry-record gap (${maxMeasuredAckToRecordMs / 1000}s) plus one full packument cache lifetime (${packumentCacheLifetimeMs / 1000}s), or a good release fails this blocking step`
    ).toBeGreaterThanOrEqual(packumentCacheLifetimeMs + maxMeasuredAckToRecordMs);
  });

  it('lists every gate the workflows run in the AGENTS.md quick reference', () => {
    // The command table is what a fresh session reads first, and its own note records
    // that it was assembled from these steps and should be re-read against them. The
    // note did not prevent the drift it warns about: `pnpm audit` is a blocking step in
    // the verify job and was absent from the table until this case existed, so an
    // agent working from the table could land a vulnerable dependency and be surprised
    // by CI. Comparing the two artifacts is the fix; restating the rule was not.
    //
    // Scope is decided by what the command *is* rather than by a hand-kept list of
    // gates: every `run: pnpm …` except the two provisioning commands is either a
    // package script or a pnpm built-in that can fail a build, so both belong in the
    // table. Deleting the exclusion below makes this case fail on
    // `pnpm exec playwright install`, which is what keeps that set honest.
    const provisioning = new Set(['install', 'exec']);
    const documented = new Set<string>();
    for (const line of readFileSync('AGENTS.md', 'utf8').split('\n')) {
      if (!line.startsWith('|')) continue;
      for (const match of line.matchAll(/pnpm ([\w:-]+)/g)) documented.add(match[1]!);
    }
    const missing: string[] = [];
    let gated = 0;
    for (const file of ['ci.yml', 'release.yml']) {
      for (const match of readWorkflow(file).matchAll(/run:\s*pnpm ([\w:-]+)/g)) {
        const command = match[1]!;
        if (provisioning.has(command)) continue;
        gated += 1;
        if (!documented.has(command)) missing.push(`${file} runs pnpm ${command}`);
      }
    }
    expect(missing, 'the AGENTS.md quick reference is missing a gate the workflows run').toEqual([]);
    // An empty `missing` is also what a table scan that read nothing produces, so the
    // other half of the instrument is checked separately.
    expect(documented.size, 'the table scan must read commands out of AGENTS.md').toBeGreaterThan(10);
    // And the same on this side of the comparison, which the floor above cannot see: a
    // `documented` set of twenty commands against a workflow scan that matched nothing is a
    // perfect pass with nothing compared. Measured 19 `run: pnpm` lines across the two files,
    // 17 of them outside `provisioning`; the floor is set where a whole workflow file leaving
    // scope still reddens it but a single step moving to `npm run` does not.
    expect(gated, 'the workflow scan must read commands out of .github/workflows').toBeGreaterThan(10);
  });

  it('keeps the second compiler backend in CI, not only in the script list', () => {
    // `verify:types` has two backends and only one of them is the default: the
    // package named `typescript` is the 6.0 compatibility shim, so the handle
    // surface runs only when something asks for the 7 alias (docs/progress.md
    // Phases 334/335). Deleting the job that asks would redden nothing above —
    // the quick-reference scan compares commands the workflows run against the
    // table, never the reverse — and the second surface would quietly go back to
    // being unexecuted. Pin it at the job that carries the obligation.
    const ci = readWorkflow('ci.yml');
    const starts = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map(match => ({
      name: match[1]!,
      at: match.index
    }));
    const job = starts.find(candidate => candidate.name === 'typescript-7');
    expect(job, 'the typescript-7 job is gone; the handle backend would no longer run anywhere').toBeDefined();
    const following = starts.find(candidate => candidate.at > job!.at);
    const body = ci.slice(job!.at, following?.at ?? ci.length);
    expect(body).toMatch(/run: pnpm verify:types:handle/);
    // The job used to reach the 7 compiler by replacing node_modules; that shape
    // needed a scratch `npm install`, a per-platform copy and a `rm -rf`, and it
    // left typescript-eslint on 6 anyway. A revert to it should be a decision
    // someone makes on purpose.
    expect(body).not.toMatch(/rm -rf node_modules\/typescript/);
  });
});
