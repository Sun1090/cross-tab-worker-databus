# Release checklist

Use this checklist for each pre-1.0 release. Pushing the version tag *is* the publish: the `Release` workflow runs on the tag, publishes to npm because the `NPM_TOKEN` secret is configured for this repository, and then runs the blocking `verify:published` gate. The manual `npm publish` at the end of this document applies only to a repository state where that secret is absent.

## Public API stability and deprecation policy (pre-1.0)

- The root export surface is pinned by `tests/dual-format.test.ts` (freeze test) and `scripts/verify-version-compat.mjs` (tag-to-tag compatibility gate). Adding or removing an export is a deliberate, reviewed change; add it to `docs/api.md` and the CHANGELOG in the same commit.
- Pre-1.0 breaking changes are allowed only with a deprecation cycle: keep the legacy alias for at least one minor version, emit a `console.warn` at first use, and remove it only in a minor whose CHANGELOG calls the removal out explicitly.
- Protocol aliases (worker/cluster/transport message shapes) follow the same rule: keep parsing legacy frames for one minor after deprecation so mixed-version peers stay compatible (see the protocol-version diagnostics in `getDiagnostics().protocol`).
- Advancing to `1.0.0` requires the public API and protocol deprecation policy to be frozen and a migration guide published (see `docs/roadmap.md`, 0.13.0 candidates).

## Automated gates (CI)

The `CI` workflow's `verify` job runs `pnpm check`, `pnpm lint`, `pnpm test:coverage` (the `vitest.config.ts` floors: 98% statements / 96% branches / 98% functions / 99% lines), `pnpm verify:compat`, `pnpm verify:pack`, `pnpm bench`, and `pnpm audit` on every push and pull request; the `browser` job runs the Playwright E2E suite. The `Release` workflow repeats `verify:compat` and `verify:pack` before publishing, then runs the blocking `verify:published` gate. The checkout in both workflows uses `fetch-depth: 0` + `fetch-tags: true` because `verify:compat` resolves its baseline from the most recent release tag.

Only `pnpm bench:browser` / `pnpm bench:compare` stay local-only: shared-runner timing noise makes numeric CI gates unreliable.

## Before tagging

1. Update `package.json`, `CHANGELOG.md`, and both roadmap files.
2. Run `pnpm check`, `pnpm lint`, `pnpm test:coverage`, `pnpm bench`, `pnpm test:e2e`, `pnpm bench:browser`, `pnpm verify:pack`, `pnpm verify:compat`, and `git diff --check`. (`verify:compat` asserts the package `exports` subpaths and type fields present in the `COMPAT_BASE_TAG` baseline still exist; `verify:pack` steam-imports the full root public surface plus every subpath in ESM and CJS from the packed tarball. `verify:compat` resolves its baseline from the most recent release tag, so a shallow or tag-less clone must first run `git fetch --tags` or it fails with "no version tag found".)
3. Gate dependency security: `pnpm audit --registry=https://registry.npmjs.org` (the configured mirror registry lacks the audit endpoint; CI runs it on the public registry in the verify job). Fail the release on any known-vulnerability advisory; `pnpm-workspace.yaml` overrides pin patched ranges.
4. Gate browser benchmark regressions: run `pnpm bench:browser` (twice at minimum; the gate compares the newest report against the median of the same metric in up to the five preceding archived reports) and then `pnpm bench:compare --fail-above-pct 50`. The median baseline exists because the in-page hot-path metrics alternate between a fast and a slow mode on identical code — two consecutive runs of `dedup1000Ms` measured 12.7 ms then 25.6 ms, and a single noisy previous report could fail the documented ceiling with no code change at all. `publish/dedicated/perMessageMs` is noisy the same way: two consecutive runs of identical code measured 49.9 ms then 71.1 ms, failing the gate at +75.7% while `dedup1000Ms` and `traceAndPublish1000Ms` *improved* in the same report — that single-metric-up-everything-else-down shape is the noise signature, and the next run reported 49.4 ms and passed. Before accepting or acting on a failure, re-run and check the spread; if the change touches a hot path, size it directly (a micro-benchmark of the 0.20.95 bounded-map rewrites measured 80–86 ns/op across all three variants, i.e. inside run-to-run variance). A baseline shift (e.g. a metric becoming real instead of a no-op) is an expected one-time failure. Refresh the long-run trend doc with `pnpm bench:trend` and commit it when the tables change.
5. Confirm the package contains only intended files with `npm pack --dry-run --json`.
6. Commit on a feature branch, push that branch, and merge its green PR using squash or fast-forward (no merge commit). Fetch the merged commit, tag that exact commit, and push only the specific version tag; never push `main`/`master` directly or force-push. The workflow runs `node scripts/verify-release-version.mjs` to require `RELEASE_TAG` to equal `v` + the package version and to require exactly one non-empty CHANGELOG section.

## Security and dependency scanning

The repository runs CodeQL (`javascript-typescript`; on push, on pull request, and weekly) and Dependabot (weekly npm + GitHub Actions updates). CodeQL alerts surface as pull-request checks; a Dependabot pull request must pass its verify (the full `pnpm check`) and CodeQL checks before merge, with the known shared-runner browser-E2E flake re-run as usual.

## Tagged-release workflow

Pushing a version tag triggers the `Release` GitHub Action: it runs `pnpm check` and `pnpm lint` (a tag can point at a commit that never passed CI's lint step), runs `verify:compat` and `verify:pack`, opens the GitHub release from the `CHANGELOG` section, publishes to npm when the `NPM_TOKEN` secret is set, and then runs the **blocking** published-consumer verification with the same budget as a manual run (`PUBLISHED_VERIFY_ATTEMPTS=48`, `PUBLISHED_VERIFY_DELAY_MS=7500`, a 6-minute ceiling). A release whose published package cannot be imported by a clean consumer fails the workflow — treat every `verify:published` failure as a failed release. For registry propagation or infrastructure failures, rerun the workflow against the unchanged tag; for artifact defects, ship a new patch version. Never move or reuse a published tag. When no token is configured the publish step is skipped, but verification still passes against whatever version is already on npm (e.g. one published manually).

## Publishing

For a manual release (no `NPM_TOKEN` in the workflow), run `npm publish --access public` from the tagged checkout. A version already present on npm cannot be published again. Historical versions missing from npm must be rebuilt from their exact git tags and reviewed individually; never publish the current tree under an old version.

## After publishing

1. Verify the version appears in `npm view cross-tab-worker-databus versions --json`.
2. Install the published tarball or version in a clean consumer and import the root plus every public subpath.
3. Record the result in the release notes. Do not advance to `1.0.0` until the public API and protocol deprecation policy are explicitly frozen.

The tagged-release workflow already ran the consumer verification above. Run `PUBLISHED_VERSION=<version> pnpm verify:published` by hand only when you need an offline repeat. The workflow's 6-minute ceiling absorbs normal npm CDN propagation lag (the 0.20.89 tag run exhausted the older 2-minute budget after a successful publish); raise `PUBLISHED_VERIFY_ATTEMPTS` / `PUBLISHED_VERIFY_DELAY_MS` further only for unusually slow mirrors.
