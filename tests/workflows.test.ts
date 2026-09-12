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
});
