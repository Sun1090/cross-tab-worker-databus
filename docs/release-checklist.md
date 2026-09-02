# Release checklist

Use this checklist for each pre-1.0 release. The repository does not publish from the assistant; run the final npm command manually after reviewing the packed artifact.

## Before tagging

1. Update `package.json`, `CHANGELOG.md`, and both roadmap files.
2. Run `pnpm check`, `pnpm lint`, `pnpm bench`, `pnpm test:e2e`, `pnpm bench:browser`, `pnpm verify:pack`, and `git diff --check`.
3. Confirm the package contains only intended files with `npm pack --dry-run --json`.
4. Commit, tag the exact version, and push `main --tags`.

## Publishing

Run `npm publish --access public` from the tagged checkout. A version already present on npm cannot be published again. Historical versions missing from npm must be rebuilt from their exact git tags and reviewed individually; never publish the current tree under an old version.

## After publishing

1. Verify the version appears in `npm view cross-tab-worker-databus versions --json`.
2. Install the published tarball or version in a clean consumer and import the root plus every public subpath.
3. Record the result in the release notes. Do not advance to `1.0.0` until the public API and protocol deprecation policy are explicitly frozen.

Run `PUBLISHED_VERSION=0.20.7 pnpm verify:published` after npm publication.
