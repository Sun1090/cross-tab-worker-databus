# Release checklist

Use this checklist for each pre-1.0 release. The repository does not publish from the assistant; run the final npm command manually after reviewing the packed artifact.

## Public API stability and deprecation policy (pre-1.0)

- The root export surface is pinned by `tests/dual-format.test.ts` (freeze test) and `scripts/verify-version-compat.mjs` (tag-to-tag compatibility gate). Adding or removing an export is a deliberate, reviewed change; add it to `docs/api.md` and the CHANGELOG in the same commit.
- Pre-1.0 breaking changes are allowed only with a deprecation cycle: keep the legacy alias for at least one minor version, emit a `console.warn` at first use, and remove it only in a minor whose CHANGELOG calls the removal out explicitly.
- Protocol aliases (worker/cluster/transport message shapes) follow the same rule: keep parsing legacy frames for one minor after deprecation so mixed-version peers stay compatible (see the protocol-version diagnostics in `getDiagnostics().protocol`).
- Advancing to `1.0.0` requires the public API and protocol deprecation policy to be frozen and a migration guide published (see `docs/roadmap.md`, 0.13.0 candidates).

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
