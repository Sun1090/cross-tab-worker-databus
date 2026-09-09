# Development Progress

Session operating notes: work in local batches (10-20 real tasks), commit locally
during development, push once per completed phase after full local verification,
then check CI and fix failures automatically. If interrupted, resume from here.

## Current phase: v-next observability & parity audit

Phase goal: close real gaps in adapter parity, doc parity (EN/ZH) that drifted,
release-compat coverage for new public API, and demo/observability polish. No
fake tasks; each item is verified locally before being marked done.

## Baseline (2026-09-06, main @ 06dcc25)

- CI green for all prior pushes (last: browser 3m20s + verify 45s after reruns of
  the documented shared-runner handoff flake).
- `pnpm check` (typecheck+build+unit), `pnpm lint`, `pnpm test:e2e` (20 tests),
  `pnpm bench`, `pnpm verify:pack` all green locally.
- Public API additions not yet re-verified against release gates:
  `loadWeighting` / `WorkerThroughputSample.overrunMs` /
  `getMetrics()` / `getDiagnostics().replay.bytes`.

## Task pool (this phase)

1. [x] Adapter parity audit (React vs Vue) — parity confirmed, StrictMode React-only.
2. [x] README feature list (EN+ZH) — added weighting/bridge/diagnostics bullets.
3. [x] Docs EN/ZH parity sweep — zh roadmap gap fixed.
4. [x] verify:pack covers new exports — packed-consumer now smoke-imports full surface.
5. [x] Demo observability — already shipped (diagnostics row + adaptive-weighting e2e).
6. [x] scheduleLagWeight cluster steering test — added (A starved/B healthy, weight 3 → B).
7. [x] getMetrics vs flushed event full-field parity — strengthened trace.test.ts.
8. [x] Release checklist verify:pack/bench gate — already present, confirmed.
9. [x] verify:compat documented in checklist Before-tagging run.
10. [x] CHANGELOG [Unreleased] QA bullet.

## Phase 1 result (pushed 06dcc25..362adef, CI green on first try)

- verify 49s + browser 3m13s (incl. new Bench smoke step). Repo has only ci.yml +
  release.yml (no CodeQL/dependabot/deploy workflows to scan for this push).
- Local verification before push: pnpm check (438 tests), lint, test:e2e (20/20),
  bench, verify:pack all green.

## Phase 2 pool (packaging hygiene + observability polish)

1. [x] Exclude docs/progress.md (internal tracking doc) from the published tarball.
      -> npm ignores do NOT apply to files-allowlisted paths in this npm version
      (verified empirically), so package.json files now enumerates docs files
      explicitly; pack --dry-run: 105 files, hasProgress=false, 18 docs ship.
2. [x] Demo renderConfig shows the loadWeighting active state in the config panel.
      -> New config row: '负载加权' shows 启用（消息/字节/滞后） or 禁用（纯 Topic 数）
      based on the toggle; e2e single-owner + adaptive-weighting still pass.
3. [x] Routing bench: add a scheduleLagWeight variant to the weighted scoring baseline.
      -> tests/bench/routing.bench.ts adds 'selectLeastLoadedWorker / 50 workers /
      weighted + lag' (1.7M ops/s), validating the third score term's cost.
4. [x] approximatePayloadBytes test: explicit DataView (and Uint8Array view) coverage.
      -> tests/routing.test.ts 'binary payloads and views': Uint8Array view,
      DataView over a buffer, Float64Array(4) report their own byteLength.
5. [x] npm pack --dry-run --json audit: confirm only intended files ship.
      -> Done as part of task 1 (105 files, no progress.md, all docs/dist ship).
6. [x] README/Getting-Started: link docs/configuration.md adaptive-weighting anchor
      from the README feature bullet (navigation polish).
      -> README loadWeighting bullet links ./docs/configuration.md#adaptive-owner-weighting.
7. [x] Progress-pad: fold phase-2 changes into CHANGELOG [Unreleased] + this file.
      -> CHANGELOG [Unreleased]: Packaging + Changed bullets added.

## Phase 2 result (pushed 362adef..dd89853, CI green on first try)

- verify 52s + browser 2m33s. Local: check (438), lint, e2e (20/20), bench, verify:pack.
- Shipped: packaging (enumerated docs files, progress.md excluded), demo config-panel
  weighting state, +lag bench baseline, DataView sizing coverage, README weighting link.

## Phase 3 pool (security & release infrastructure)

1. [x] Add .github/workflows/codeql.yml (static analysis on push/PR; javascript-typescript).
2. [x] Add .github/dependabot.yml (weekly npm + GitHub Actions).
3. [x] verify-version-compat: auto-derive baseline from the latest git tag (keep
      COMPAT_BASE_TAG override), so the export contract is checked against the last
      release instead of a fixed v0.20.31. -> [compat] 0.20.83 ... from v0.20.71.
4. [x] Validate new workflow YAMLs (basic structural check) and verify:compat locally.
      -> python yaml.safe_load parses codeql.yml + dependabot.yml; verify:compat green.
5. [x] Fold phase-3 into CHANGELOG [Unreleased] + this file.
      -> CHANGELOG: Security/CI infrastructure bullet (CodeQL + Dependabot +
      verify:compat auto-baseline).

## Phase 3 result (pushed dd89853..d9c8296, CI + CodeQL green)

- CI verify 47s + browser 3m18s; CodeQL run SUCCESS on push (1m35s).
- Dependabot config became active immediately: auto-PRs opened for react/react-dom
  (npm) and github/codeql-action 3→4 (actions). Not merged by this agent; they run
  their own CI on dependabot branches.
- codeql.yml bumped to github/codeql-action@v4 (current major).

## Phase 4 pool (frontier — audit first, then pick verifiable items)

1. [x] Audit npm deps for known vulnerabilities (npm audit) and record result.
      -> 2 high via dev chain (glob<10.5.0, nanoid<3.3.18); fixed with pnpm
      overrides in pnpm-workspace.yaml (pnpm v10 home — the package.json pnpm
      field is ignored); pnpm audit now clean; pnpm check still 438 green.
2. [x] Decide react/react-dom/codeql-action dependabot PRs: verify locally, merge or
      close with reason.
      -> Resolved: #4 codeql-action 3→4 CLOSED (workflow already on v4). Merged:
      #3 @types/node, #1 jsdom 25→30, #6 globals, #5 react — each after verify+CodeQL
      green (browser handoff flake rerun where needed; main CI green after each merge).
      #2 typescript 5.9→6.0 still OPEN: verify passes (TS6 compiles/tests fine), browser
      has failed on the documented shared-runner handoff flake across reruns; a fresh
      dependabot rebase run is in flight. Deferred until green rather than merged red.
3. [x] `verify:published` release-gate parity: confirm the published-consumer path
      exercises the same full-surface smoke import as verify:pack.
      -> verify-published-consumer.mjs now imports the same 12 root functions +
      3 subpaths in ESM/CJS (node --check ok; full run needs a published version).
4. [x] docs/zh release-checklist: mirror the verify:compat + CodeQL/Dependabot notes.
5. [x] CHANGELOG [Unreleased] fold for phase-4 + this file.
      -> Dependency-security + verify:published bullets added.

## Phase 5 (in progress — Dependabot influx + doc parity finishing)

- Merged dependabot PRs (each after verify+CodeQL green; browser handoff flake
  rerun where needed): #1 jsdom 25→30, #3 @types/node, #5 react/react-dom, #6 globals,
  #9 eslint 9→10, #7 esbuild 0.25→0.28, #2 typescript 5.9→6.0, #8 typescript-eslint
  8.69. All merges verified locally (check 439 / lint / e2e-in-isolation green; the
  full-suite e2e handoff failures pass in isolation — known shared-runner + local-load
  flake). #4 codeql-action 3→4 closed (workflow already on v4).
- All dependabot PRs resolved; no open PRs remain.
- Release gates under the major toolchain bumps re-verified: pnpm bench,
  verify:pack, verify:compat (baseline v0.20.71) all green.
- CI: pnpm audit added to the verify job (dependency scan institutionalized);
  release checklists (en+zh) document the audit gate. Final HEAD CI green
  (verify + browser + CodeQL), audit step passes.
- Doc parity: architecture.md + zh gained the adaptive-owner-weighting and
  credential-bridge subsections (committed 2e064a9, documentation test green).
- centrifuge default-factory SSR guards confirmed already covered (stub tests).

## Post-phase-5 genuine fixes (coverage-driven)

- test: bounded dedup eviction path (data-bus.test.ts) — the existing maxEntries:2
  test only tracked two IDs so the FIFO eviction loop never ran; new test overflows
  the set and pins "evicted ID re-delivered, in-set ID still suppressed".
- fix: COORDINATION trace event carried an always-empty routes list (emitted
  synchronously before subscription writes flushed through the batching writer).
  Now emitted after the transport open resolves so routes/roles are settled;
  new test asserts the formatted topicKey@workerId|confirmed=… entries.
- Local verification: 441 unit tests, lint, e2e-in-isolation green.
- bench:browser + bench:compare gate re-verified on the final toolchain (TS6 /
  esbuild 0.28 / eslint 10): databus matrix numbers realistic, no regression
  over 50%. Full e2e 20/20 green.
- docs: CHANGELOG + api.md (en+zh) document the coordination-event fix and its
  settled route list.

## Definitive verification record (2026-09-07, main @ 8b56ebe)

- pnpm audit (public registry): no known vulnerabilities.
- verify:compat: 0.20.83 preserves exports/types from v0.20.71.
- bench (Node smoke) + bench:browser + bench:compare gate: green, no >50% regression.
- pnpm check (441), lint, e2e (20/20), verify:pack (full-surface), npm pack
  (105 files, no progress.md), git diff --check: all green.
- CI + CodeQL green on the final HEAD (after one documented handoff-flake rerun).
- No open PRs; working tree clean.

## Phase 6 (in progress — flake-class fix + bench trend doc)

- Real flake defect found and fixed: the storage-event pagehide-handoff E2E
  polled with HANDOFF_TIMEOUT_MS (60 s) under the default 60 s test timeout —
  its 45 s convergence wait stacked with the handoff poll, so a healthy-but-
  slow run died on the test-level ceiling. Playwright default timeout raised
  to 90 s (covers all stacked budgets) and the test now sets 120 s explicitly.
  Full e2e 20/20 green locally after the fix.
- Bench drift: new `pnpm bench:trend` (scripts/bench-trend.mjs) generates
  docs/benchmarks.md + zh mirror from the archived bench-results/ reports
  (latest/previous/delta + all-time best per metric). Both docs registered in
  the docs indexes and the package files allowlist (npm pack: 107 files, both
  ship; progress.md still excluded). Release checklist (en+zh) gained the
  benchmark-gate step; zh checklist additionally gained the previously missing
  browser-benchmark gate bullet (EN/ZH parity).
- bench:compare --fail-above-pct 50 gate green on the current archive.

## Phase 6 result (pushed 0f94c41..fa10235..27c3af6, CI green on first try)

- fa10235: storage-event handoff timeout-budget fix (90s global + 120s test),
  bench:trend generator + docs/benchmarks.md (en+zh) shipped in the tarball,
  release checklists document the benchmark gate (zh gained the missing bullet).
- 27c3af6: systematic per-test budget audit (scripted) — eight more tests
  stacked explicit 30–45s waits above the ceiling without their own
  test.setTimeout; each now has a worst-case budget. Full e2e 20/20 green.
- CI green on both pushes with zero reruns — first push since the flake was
  documented that needed no handoff-flake rerun, which is itself evidence the
  diagnosis (budget stacking, not runner flake) was correct.
- Local verification at fa10235: 445 unit tests, lint, e2e 20/20, bench,
  verify:compat (v0.20.71 baseline), verify:pack, audit (public registry),
  npm pack dry-run (107 files, benchmarks ship, progress.md excluded),
  git diff --check — all green.

## Phase 7 (coverage-driven gap hunt — in progress)

- Coverage run (445 tests) identified real untested error paths: storage-utils
  82% (all four swallow branches), websocket binary error paths, dedup option
  validation branches, retention-cleanup failure/draining, IndexedDB
  read-request failures.
- New tests (15 added, 445 → 460):
  - tests/storage-utils.test.ts — new fault-injection file (BrokenStorage/
    CorruptStorage doubles); storage-utils now 100% stmts+branches.
  - websocket.test.ts — poisoned-Blob conversion isolation + 16-bit topic-
    length boundary (0x10000 errors with zero sends; exactly 0xffff frames).
  - centrifuge.test.ts — factory-less SSR degradation resolves `local` with
    no error; throwing injected factory surfaces instead of silent degrade.
  - data-bus.test.ts — invalid dedup options (maxEntries/ttlMs/sweepMs/
    adaptiveTtl bounds) throw before construction; failing durable retention
    pass reports once and later flushes still work; queued cutoff drained by
    the cleanup loop. (Discovery: hydration issues its own pre-load
    clearBefore pass at construction — tests now baseline it.)
  - replay-persistence.test.ts — load/clearBefore request-failure paths
    reject + invalidate; fault-proxy tx wrapper now forwards oncomplete/
    onerror (was structurally impossible to drive the clear path before).
- Coverage after: storage-utils 100/100, validation 100/96.55, websocket
  97.19/85 (remaining: SSR guard + default-factory branches unreachable in
  Node), overall 96.31 → 96.79 stmts (vitest-4 accounting includes barrel
  files; raw source numbers improved across the board).
- Security: new GHSA-82fw-gwwq-j7x9 advisory (vitest/@vitest/mocker path
  traversal) failed the audit gate → vitest upgraded 3.2 → 4.1.11 with
  matching @vitest/coverage-v8. Full suite re-verified on the new major:
  typecheck (one explicit-callback typing fix in cluster.test.ts), 460 unit,
  coverage, bench, e2e 20/20, verify:pack, verify:compat, audit clean.
- Full verification: typecheck, 460 unit, lint green.

## Phase 7 result (pushed 6d3e89d..ca05cd6..786812e, CI green on second push)

- ca05cd6: 15 new tests (445 → 460) across storage-utils (new file, 100%
  stmts+branches), websocket binary error paths, centrifuge factory
  degradation, dedup option validation, retention-cleanup failure/draining,
  IndexedDB read-request failures. Plus the GHSA-82fw-gwwq-j7x9 fix: vitest
  3.2 → 4.1.11 (+coverage provider), one mock-typing fix; audit clean.
- First push failed only on the public-docs guard: the CHANGELOG security
  note named two scoped dev packages (@scope/ references are forbidden in
  shipped docs). 786812e rewrote the note without scoped names. The guard
  doing its job — caught it in CI before any release path saw it.
- CI green on 786812e (verify 47s + browser 6m21s + CodeQL).

## Phase 8 (release-checklist dry run on the current toolchain)

- bench:browser run archived (2026-09-09T03:26); bench:compare 50% gate green
  — no metric regressed (dedup -15%, wildcard dispatch -14%, publish -5.5%);
  bench:trend refreshed docs/benchmarks.md (en+zh), committed cb643b2.
- npm pack audit: 107 files (benchmark docs ship, progress.md excluded);
  verify:pack full-surface ESM/CJS smoke green; verify:compat green against
  v0.20.71.
- pnpm audit (public registry): no known vulnerabilities.
- Dependency batch update (minor/patch only, majors deliberately deferred:
  vitest 5 / eslint / typescript majors are not patch-level moves): playwright
  1.63, eslint 10.10, typescript-eslint 8.70, @eslint/js 10.0.1, @types/node
  26.5, centrifuge 5.7.3. Verified: typecheck, 460 unit, lint, build, e2e
  20/20, verify:pack. CI green (verify + browser + CodeQL) on 549cfe8.
- No open dependabot PRs; working tree clean at 549cfe8 + this doc.

## Phase 9 (coverage residuals — error-utils direct unit file)

- tests/error-utils.test.ts (new, 10 tests): stack preservation/omission,
  non-Error shapes (string/object/undefined/number/boolean), context
  reconstruction, round-trip identity. error-utils now 100% stmts+branches;
  470 unit tests.
- environment.ts residual line 131 (storage-event JSON.parse catch) is
  behaviorally exercised by storage-channel.test.ts's malformed-payload test;
  the v8 statement map does not credit the full-suite run (esbuild try/catch
  statement-map artifact) — direct-hit probe confirmed the statement executes.
  Not chased further; the behavior is pinned.
- CI green on 8661f28 (verify + browser + CodeQL).

## Phase 10 (vue composable edge paths)

- Three new vue.test.ts cases (470 → 473): superseded-start cycle stops the
  abandoned bus without mounting it; identical bus+topic sync re-run takes
  the no-op early return (no resubscribe churn); reactive handler swap
  updates latestHandler in place without resubscribing.
- Remaining vue.ts uncovered lines (20: generation-guard continuation that
  only fires when stop() is still pending across a supersede; 45/54:
  defensive watches unreachable through the public API) are documented
  defensive paths — behavior already pinned by the new tests.
- CI green on 0523123 (verify + browser + CodeQL).

## Phase 11 (demo accessibility)

- Status badge is now `role="status" aria-live="polite"` — connection
  transitions are announced to assistive tech.
- The event table gained a visually-hidden caption describing its behavior
  (newest rows on top); the `.visually-hidden` utility joined styles.css.
- The icon-only clear button got an explicit `aria-label`.
- All 20 e2e green (caption is display-concealed, selectors untouched).
- CI green on 8cdfa33.

## Next candidates (project is feature-complete; future work is verification/deepening)

- Track the browser handoff flake: consider raising HANDOFF_TIMEOUT or moving the
  handoff suite to a dedicated workflow if the shared-runner failure rate stays high.
  -> RESOLVED in phase 6: the storage-event handoff test's budgets stacked past
  the 60s test timeout; global timeout now 90s + explicit 120s there. Remaining
  shared-runner slowness shows up as slower passes, not failures.
- Add a browser benchmark trend doc or CI gate for bench:browser drift.
  -> DONE in phase 6: pnpm bench:trend generates docs/benchmarks.md (en+zh)
  from the bench-results archive; bench:compare gate documented in both
  release checklists. (A CI regression-threshold gate stays deliberately
  local-only: shared-runner timing noise makes numeric CI gates unreliable.)
- Release-readiness: run the full release checklist dry (verify:published needs a
  published version; everything else verified locally).

## Recovery entry

If interrupted: working tree state, current commit, and any in-flight test
outputs are recorded here (see Task pool checkboxes). Resume with:
`pnpm check && pnpm lint && pnpm test:e2e && pnpm bench && pnpm verify:pack`
then continue the next unmarked task. Push only after the phase is locally green.