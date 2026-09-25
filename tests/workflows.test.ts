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
    for (const file of ['ci.yml', 'release.yml']) {
      const workflow = readWorkflow(file);
      if (!workflow.includes('verify:compat')) continue;
      expect(workflow, `${file} runs verify:compat but has no full-history checkout`).toMatch(
        /fetch-depth:\s*0/
      );
    }
  });

  it('re-runs lint in the release job before publishing', () => {
    // A tag may point at a commit that never passed CI's lint step.
    const workflow = readWorkflow('release.yml');
    expect(workflow, 'release.yml must lint before publishing').toMatch(/run:\s*pnpm lint/);
  });

  it('keeps enough published-consumer retry budget for npm propagation', () => {
    // The ceiling is a sum of two measured lags, not a comfort number. (1) The
    // registry records the publish *minutes* after `npm publish` returns: the
    // ack -> `time[<version>]` gap measured on 0.21.27 through 0.21.33 was
    // 74.8-310.0 s — 248.7 / 96.8 / 74.8 / 310.0 / 127.2 / 76.1 / 75.5 s in version
    // order. The three releases that ran after this floor was written recorded 127.2
    // (0.21.31), 76.1 (0.21.32) and 75.5 s (0.21.33), all inside the band, so
    // `maxMeasuredAckToRecordMs` below stays at 310 s. (2) The packument `npm pack` resolves against is served
    // `cache-control: public, max-age=300`, so a copy anywhere in the path may be
    // five minutes stale by design and cannot be read sooner than that. Re-derive
    // (1) from a tag run: subtract the `Publish to npm` step's completion from
    // `time[<version>]` in the packument (`gh api
    // repos/<owner>/<repo>/actions/runs/<id>/attempts/<n>/jobs`).
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
});
