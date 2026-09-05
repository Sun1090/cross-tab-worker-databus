# Release checklist

Use this checklist for each pre-1.0 release. The repository does not publish from the assistant; run the final npm command manually after reviewing the packed artifact.

## Before tagging

1. Update `package.json`, `CHANGELOG.md`, and both roadmap files.
2. Run `pnpm check`, `pnpm lint`, `pnpm bench`, `pnpm test:e2e`, `pnpm bench:browser`, `pnpm verify:pack`, and `git diff --check`.
3. Confirm the package contains only intended files with `npm pack --dry-run --json`.
4. Commit, tag the exact version, and push `main --tags`.

## Tagged-release workflow

Pushing a version tag triggers the `Release` GitHub Action: it runs `pnpm check`, opens the GitHub release from the `CHANGELOG` section, publishes to npm when the `NPM_TOKEN` secret is set, and then runs the **blocking** published-consumer verification with the same budget as a manual run (`PUBLISHED_VERIFY_ATTEMPTS=24`, `PUBLISHED_VERIFY_DELAY_MS=5000`). A release whose published package cannot be imported by a clean consumer fails the workflow — treat every `verify:published` failure as a failed release and republish the tag after fixing it. When no token is configured the publish step is skipped, but verification still passes against whatever version is already on npm (e.g. one published manually).

## Publishing

For a manual release (no `NPM_TOKEN` in the workflow), run `npm publish --access public` from the tagged checkout. A version already present on npm cannot be published again. Historical versions missing from npm must be rebuilt from their exact git tags and reviewed individually; never publish the current tree under an old version.

## After publishing

1. Verify the version appears in `npm view cross-tab-worker-databus versions --json`.
2. Install the published tarball or version in a clean consumer and import the root plus every public subpath.
3. Record the result in the release notes. Do not advance to `1.0.0` until the public API and protocol deprecation policy are explicitly frozen.

The tagged-release workflow already ran the consumer verification above. Run `PUBLISHED_VERSION=<version> pnpm verify:published` by hand only when you need an offline repeat. Tune `PUBLISHED_VERIFY_ATTEMPTS` and `PUBLISHED_VERIFY_DELAY_MS` only for unusually slow mirrors.
