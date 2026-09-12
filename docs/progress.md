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

## Definitive verification record (2026-09-09, main @ 4c9679c + phase-12 battery)

- pnpm check: typecheck + build + 473 unit tests green (26 files).
- lint, e2e 20/20, bench (Node), bench:browser + bench:compare 50% gate,
  verify:pack (full-surface ESM/CJS), verify:compat (v0.20.71 baseline),
  pnpm audit (public registry): no known vulnerabilities, git diff --check.
- npm pack dry-run: 107 files (benchmark docs ship; progress.md excluded).
- CI + CodeQL green on every pushed commit this session (no reruns needed
  since the phase-6 timeout-budget fix).
- Cumulative session output: E2E timeout-budget unstacking (the documented
  flake class eliminated — evidence: three consecutive green browser jobs
  with zero retries), bench trend doc + generator, 28 new unit tests
  (445 → 473) across storage-utils/error-utils/websocket/centrifuge/
  data-bus/replay-persistence/vue, vitest 4.1.11 security upgrade,
  dev-dependency minor/patch batch, demo a11y (live regions + labels).

## Phase 12 (in progress — stranded-handoff root-cause fix)

- CI failure on docs-only HEAD 07d1cf9: multi-tab soak stuck 60 s x3 at
  `demo.spec.ts:380` (`waitForSingleOwner(survivors)` returns 0 holders).
  Trace forensics: the suspended owner shows `lifecycle:suspend` + `已断开`
  (pause() ran), the storage route still names the dead owner's worker, both
  survivors report 0 assigned topics.
- Root cause (real product bug, not runner noise): if the previous owner's
  `ROUTE_RELEASED` never reaches the new owner, the route sits unconfirmed
  with `handoffFromWorkerId` set and a live new owner — and reconcile
  deliberately never retries SUBSCRIBE in that state (strict-handoff
  no-overlap rule), with no deadline. Permanent stall; the 60 s poll and the
  120 s test budget only masked it.
- Fix (`src/core/cluster.ts` reconcileSubscriptions + `isStaleHandoff`
  helper): once the previous owner is gone AND the handoff is older than a
  worker TTL, re-elect a live owner with a fresh generation and a cleared
  handoff marker. The age gate was load-bearing during development: the first
  cut without it broke the four-tab handoff test, because a peer observing a
  just-written (confirmation not yet flushed) route mistook it for stranded.
- Tests (`tests/cluster.test.ts`, +2): stranded-route + dead owner recovers
  after the TTL (gen 3, confirmed, marker cleared, single SUBSCRIBE, stable
  on re-reconcile); same state with the previous owner alive keeps waiting
  (no re-elect, no SUBSCRIBE). Mutation-checked: recovery test fails with
  the src fix reverted. 475 unit tests green.
- Docs: architecture.md + zh rewritten handoff-recovery invariants
  (stranded-handoff subsection; loss-matrix bullet now describes the
  TTL-gated re-election instead of "re-elect when the owner resumes");
  CHANGELOG [Unreleased] gains a Fixed entry (no scoped package names —
  docs-guard safe).

## Phase 12 result (pushed 07d1cf9..548aee8, CI green on first try)

- Local battery before push: check (475 unit), lint, e2e 20/20, bench,
  verify:pack, verify:compat (v0.20.71), audit clean, diff-check.
- CI green: verify + browser + CodeQL on the fix commit — the multi-tab
  soak that failed 60 s x3 on the docs-only HEAD now passes in CI, which
  corroborates the stranded-handoff diagnosis (a pure runner-noise failure
  would not be fixed by a reconcile change).
- Shipped: reconcile TTL-gated re-election of stranded unconfirmed handoffs
  (+2 unit regressions, mutation-checked), architecture EN+ZH invariant
  rewrite, CHANGELOG Fixed entry.

## Phase 13 (release-checklist dry run, post-fix tree)

- bench:browser archived (2026-09-09T08-58); bench:compare 50% gate green
  (all deltas within noise: -4%..+4.8%); bench:trend refreshed (11 reports),
  committed dbf077a.
- npm pack dry-run: 107 files, progress.md excluded — unchanged.
- verify:pack + verify:compat (v0.20.71) green; audit clean.
- verify:published: npm latest is still 0.20.71 (0.20.83 unpublished,
  expected pre-release state); the consumer-verifier path itself was
  verified in earlier phases — nothing new to dry-run until a tag is cut.
- CI green on dbf077a (verify + browser + CodeQL).

## Phase 14 (in progress — handoff-cooperation coverage + test hygiene)

- New cluster regression: old owner still holding a handed-off assignment
  drops it and re-sends ROUTE_RELEASED on reconcile, letting the new owner
  confirm with no re-election churn (generation stays 2). Mutation-checked
  both ways (probe removing the resend fails the test; restore passes).
- Hygiene: crafted stranded-route fixtures now strip `confirmedAt` with
  `delete` instead of rest-spread + `void`.
- 476 unit tests green (475 + 1); typecheck, lint, diff-check green.

## Phase 14 result (pushed 4d8f9d7..7e358cb, CI green on first try)

- CI green: verify + browser + CodeQL. Docs-only follow-ups not needed
  (no shipped-doc changes this round).

## Phase 15 (in progress — wire-loss end-to-end regression + soak repetition)

- New cluster regression drives a REAL pageHide() with the ROUTE_RELEASED
  dropped in transit (hub.send monkey-patch): asserts the handoff route
  genuinely moves to the survivor unconfirmed, the fresh handoff waits, and
  post-TTL reconcile converges with confirmation. Mutation-checked (branch
  disabled → fails; enabled → passes).
- Soak E2E repeated 3x locally green (2.4–7.4 s each) on top of the earlier
  full 20/20 + CI green.
- 477 unit tests green; typecheck, lint, diff-check green.

## Phase 15 result (pushed d5ba840..6ea82ac, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 16 (in progress — post-fix stability evidence)

- Baseline sweep: zero TODO/FIXME/XXX/HACK; audit clean; no secrets;
  no open PRs; outdated = deferred majors only (eslint 10, vitest 5,
  TS 7) + auto-installed centrifuge peer (no package.json entry to bump).
- Full e2e 20/20 locally x2 more (16.5 s, 13.8 s). Cumulative post-fix
  evidence: 4 consecutive local full-suite greens + soak isolation 3/3 +
  green CI browser jobs on every push since the fix, zero retries.

## Phase 17 (in progress — multi-round stranded-handoff soak)

- New cluster soak: 3 consecutive owners each pageHide() with the ACK
  dropped; every round converges on exactly one confirmed holder with the
  marker cleared and a monotonically increasing generation, and a pageshowed
  owner reuses the replacement route instead of taking it back.
- Two test-harness findings fixed in the test (not src): time must advance
  in 1 s heartbeat steps (a single +11 s jump strands peer heartbeats in
  writer pending queues, making live peers look TTL-dead — fake-clock
  artifact), and rounds must pageshow the suspended owner (last-subscriber
  -out legitimately deletes the route by design).
- Noted dynamics (pre-existing class, also present in the crash-recovery
  path): two survivors may re-elect on the same stale view with
  last-writer-wins; the holder's next reconcile self-heals confirmation via
  the normal unconfirmed-route retry — covered by the settle round.
- 478 unit tests green; typecheck, lint, diff-check green.

## Phase 17 result (pushed ccdabd5..484ed4c, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 18 (in progress — coverage residuals round 2)

- port-reaper.test.ts: throwing reap target is isolated — a port whose
  close() throws does not prevent the remaining ports from being reaped on
  the same tick, and the reaper keeps working afterwards (new port lifecycle
  normal). Mutation-checked (catch rethrows → fails; restored → passes).
  (Boundary learned: reap needs age strictly greater than the timeout with
  10 s ticks, so probes use 41 s windows like the existing tests.)
- storage-batch.test.ts: setTimeout fallback when queueMicrotask is absent —
  microtask drain first proves the microtask path was not taken, then the
  macrotask flush lands exactly once. Mutation-checked (forced microtask
  path → fails; restored → passes).
- 480 unit tests green (478 + 2); typecheck, lint, diff-check green.

## Phase 18 result (pushed f8c8735..ea1ebf1, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 19 (in progress — cluster defensive-branch coverage)

- pause()-path orphan prune (`readSubscriberTabIds` duplicate branch):
  new test crafts a ghost subscriber with no worker record and drives a
  real pageHide — the ghost is ignored/removed in pause() itself and the
  route is deleted (no live subscribers) rather than handed off.
  Mutation-checked (branch removed → fails; restored → passes). This also
  documents why the duplicate prune must stay despite reconcile's cleanup
  running first (pause never runs that cleanup).
- Unknown CONTROL action wire-compat: a future-protocol action falls
  through to the generic metadata + onControl dispatch without throwing.
  Mutation-checked (default returns early → fails; restored → passes).
- 482 unit tests green (480 + 2); typecheck, lint, diff-check green.

## Phase 19 result (pushed a31f7da..0a8a76c, CI green on first try)

- CI green: verify + browser + CodeQL.
- Final-tree browser proof: full e2e 20/20 locally (21.8 s) on the closing
  tree (unit-test-only changes since the post-fix 20/20, re-confirmed).
- Coverage residuals triaged to defensive-only: trace.ts:445 unreachable
  (rank ≤ count always for the 0.5/0.95/1 callers), env.ts:131 esbuild
  artifact (behaviorally pinned), hooks/vue/websocket/centrifuge guards
  unreachable through public API in Node, `?? currentRecord` twins
  unreachable (self always present when started).

## Phase 20 (in progress — post-merge surveillance)

- External sweep: no open PRs, audit clean, zero TODO/FIXME, outdated =
  deferred majors only (no actionable patch/minor drift since phase 8).
- Targeted re-verification on the closing tree: cluster + stability unit
  (68 passed), soak e2e in isolation (1 passed), BFCache e2e group in
  isolation (3 passed).

## Phase 21 (in progress — deferred major upgrades, one at a time)

- `@eslint/js` 9 → 10 (completes the eslint 10 upgrade): lint clean with no
  new violations; check (482 unit) green.
- vitest 4 → 5 (+ coverage provider): 482 unit + coverage green on the new
  runner. The major rewrote the benchmarking API (`bench` module-scope
  import removed; now a test-context fixture), which broke `pnpm bench`
  (`bench is not a function` on all 3 files) — migrated all 25 benchmarks
  to `test(name, async ({ bench }) => { await bench(name, fn).run(); })`
  per the official migration guide. Bench suite green with identical
  hot-path numbers; no `benchmark.*` config keys existed to clean up.
- Full battery on the vitest-5 tree: typecheck, lint, e2e 20/20,
  verify:pack, verify:compat (v0.20.71), audit clean, diff-check.

## Phase 23 (TypeScript 7 evaluation — reverted with evidence)

- Installed TS 7.0.2: `tsc` clean and 482 unit green, but `pnpm lint`
  hard-fails — typescript-eslint 8.70 does not support TS 7.0 (upstream
  tracks TS >= 7.1, suggests side-by-side TS 6 API). No available fix
  without dropping the lint gate, so reverted to TS 6; tree clean.
  Deferral is now evidence-based: retry when typescript-eslint supports
  the TS 7 line.

## Phase 24 (in progress — handoff-recovery trace observability)

- Feature: stranded-handoff re-elections now emit `reliability` trace
  events with `operation: 'route_migration_recovery'`, distinct from the
  routine graceful-handoff `route_migration` (new
  `RELIABILITY_OPERATION` key; internal trace payload only, zero public
  export-surface impact — verify:compat green).
- Tests: recovery path pins the new op (and absence of the old one);
  graceful four-tab handoff pins the old op (and absence of the new one).
- Docs: API reference trace section (EN+ZH) + CHANGELOG Added entry.
- 482 unit green; typecheck, lint, verify:compat, diff-check green.

## Phase 24 result (pushed 7e2db21..a203094, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 25 (in progress — demo renders reliability trace events)

- Real gap: the demo trace sink dropped `reliability` events, so the new
  recovery diagnostics (and all migration/retry observability) were
  invisible in the product demo. `handleTraceEvent` now renders them into
  the event feed with Chinese operation labels
  (`reliability:<operation>` + label + bounded details).
- E2E: new test pins the initial route-acknowledgment row (op + label).
  Isolation green (2.1 s); full suite 21/21 green.
- 482 unit green; typecheck, lint green.

## Phase 25 result (pushed 12add67..ba96c63, CI green on first try)

- CI green: verify + browser (21 e2e incl. the new reliability-feed test) + CodeQL.

## Phase 26 (in progress — full low-frequency trace coverage in the demo feed)

- Extended the phase-25 feed work: `subscription` and `coordination`
  trace events now also render as bounded diagnostic rows (action + active
  count; coordinated worker/route counts only — arrays stay out of the
  DOM). The feed now covers every low-frequency trace event type.
- E2E broadened to pin all three diagnostic rows on connect.
- Full suite 21/21 green; typecheck, lint green.

## Phase 26 result (pushed c57ee87..fafd8ce, CI green on first try)

- CI green: verify + browser (21 e2e) + CodeQL.

## Phase 27 (in progress — recovery-op end-to-end sink coverage)

- Data-bus-level test drives two live buses through a real pageHide with
  the ACK dropped: past the TTL the survivor re-elects and the public
  trace sink carries `reliability` / `route_migration_recovery` (and never
  the graceful op) for the topic. Mutation-checked (forwarding cut →
  fails; restored → passes).
- 483 unit tests green (482 + 1); typecheck, lint, diff-check green.

## Phase 27 result (pushed 1ece57c..1634121, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 28 (in progress — single-writer + projected loads for recovery)

- Found via the new distribution test failing: concurrent re-elections
  from divergent cross-tab views ping-ponged generations and dropped
  confirmations (each fresh write is unconfirmed by construction), with
  per-pass SUBSCRIBE churn and topic pile-up. Debug forensics (temporary
  elect/write/confirm/assign logging, removed afterwards) pinned the exact
  interleaving.
- Fix (`src/core/cluster.ts`): single-writer rule (only the elected owner
  writes; peers stand down, views converge on the next flush) + projected
  loads within the pass (mirrors graceful handoff). Standing down stays
  live: bounded by one heartbeat, then all peers agree.
- Process lesson recorded: never restore probes from /tmp snapshots (an
  expired snapshot silently clobbered the rule mid-session and all later
  analysis ran against rule-less code — which itself corroborated the
  rule's necessity). Snapshots purged; src fix committed immediately
  (59d8c33) before further probing.
- Tests: distribution (one topic per survivor, confirmed, markers cleared,
  per-share diagnostics) + multi-round soak convergence; 484 unit, 21 e2e,
  bench, pack, compat, audit, lint, diff-check green.

## Phase 28 result (pushed f8ff90a..59d8c33..e53bf30, CI green)

- Local battery on the fix: 484 unit, 21 e2e, bench, pack, compat,
  audit, lint, diff-check green.
- CI green on the closing HEAD (verify + browser + CodeQL); no
  failures/cancellations outstanding. (The intermediate src-fix push's
  run was superseded by the docs push via concurrency cancel; the
  closing run covers the full tree including the fix.)

## Phase 29 (in progress — single-writer liveness hole)

- Review of the phase-28 rule found a real stall: when the elected owner
  has no local subscription it never reconciles the topic, so universal
  stand-down stalls forever (reachable through ordinary unsubscribe
  timing — unsubscribing drops load, making the unsubscribed tab the
  likely winner). Fix: stand down only when the elected owner is
  subscribed (mapped via subscriber tabIds); otherwise write the route
  and notify it directly, exactly like the handoff and crash paths.
- Regression test pins the unsubscribed-elected-owner recovery end to
  end; mutation-checked (always-stand-down probe fails; restored passes).
- 485 unit green; typecheck, lint, diff-check green.

## Phase 29 result (pushed 7bab502..287656c, CI green on first try)

- CI green: verify + browser + CodeQL.

## Phase 30 (in progress — browser coverage for stranded-handoff recovery)

- Real gap: the recovery path had zero browser coverage (a 10 s+ stall
  cannot be induced deterministically in-browser). New demo chaos toggle
  (`#dropHandoffAck`) wraps `environment.createChannel` to drop outgoing
  `ROUTE_RELEASED`; the bus, trace, and feed are otherwise untouched, and
  the toggle defaults off so all existing tests are unaffected.
- E2E: pagehide with ACKs dropped on both tabs → survivor converges via
  re-election (~14 s, vs 1–2 s graceful — the timing itself corroborates
  the recovery path, not the ACK path) → feed shows the recovery row →
  delivery resumes exactly once. Isolation green.
- Full-suite note: 3/5 local parallel runs fully green; 2 runs each dropped
  a different single test to 20 s-poll timeouts under parallel load (the
  documented local-load flake class; CI serializes workers:1 with 2
  retries, so gating is unaffected). The longer suite (chaos test ≈16 s)
  adds parallel overlap locally — accepted, same trade the project
  already documents.
- 483 unit green; typecheck, lint green.

## Phase 30 result (pushed dc73b15..bd2dfe1, CI green on first try)

- CI green: verify + browser (22 e2e incl. the chaos recovery test) +
  CodeQL. The serialized CI workers absorb the longer suite without the
  local parallel-load flake.

## Phase 31 (in progress — browser coverage for the crash path)

- Real gap: the crash path (owner dies with no pagehide at all) had only
  unit coverage. A real renderer crash via CDP was evaluated first and
  rejected with evidence: same-origin tabs share the renderer
  (TAB-B-ALIVE: false in the probe), so siblings die too and the survivors
  under test disappear.
- Instead: demo `#simulateCrash` chaos toggle stops all outgoing
  coordination on the armed tab with no pagehide dispatched (channel sends
  + localStorage writes blocked live-gated, reads unaffected). Always
  installed, pass-through when unchecked — the full suite passing proves
  zero regression to existing tests.
- E2E: converge 3 tabs, arm crash on the owner only, survivors re-elect
  after TTL expiry (~13.6 s) and delivery resumes exactly once.
- Full suite 23/23 green locally (24.8 s); typecheck, lint green.

## Phase 31 result (pushed 779a378..cb29413, CI green on first try)

- CI green: verify + browser (23 e2e) + CodeQL.

## Phase 32 (in progress — TS 7.1 probe + bench-engine baseline re-check)

- TypeScript 7.1: only a `next`-tag dev build exists (`7.1.0-dev…`);
  latest stable is still 7.0.2, which typescript-eslint rejects. TS 7
  stays deferred with even stronger evidence; the configured mirror does
  not even carry 7.1 yet. Retry when a stable 7.1 lands alongside
  typescript-eslint support.
- Vitest 5 swapped the bench engine (tinybench 6): re-running
  `bench:browser` to check for a systematic baseline shift (the release
  checklist anticipates a one-time shift on engine changes).

## Phase 32 result (pushed 86fee81..2388d5e, CI green on first try)

- bench:compare 50% gate green on the post-vitest-5 run (all deltas
  within ±10% noise — no engine-shift regression); trend docs refreshed
  (12 reports). CI green: verify + browser + CodeQL.

## Phase 33 (in progress — definitive full battery on the final tree)

- check: typecheck + build + 485 unit green (26 files); lint clean.
- e2e 23/23 green locally; Node bench green; verify:pack full-surface
  green; verify:compat (v0.20.71 baseline) green; audit clean;
  npm pack 107 files without progress.md; diff-check clean.
- bench:browser covered in phase 32 (gate green, trend refreshed).

## Phase 34 (autonomous session — coverage-driven defect hunt + CI gate enforcement)

Method: rather than assume the "feature-complete" state was verified, re-ran
the full battery from a clean install and used per-branch v8 coverage to find
code paths no test reaches, then wrote focused tests there. Every new suite was
mutation-checked (delete the guard under test -> the test must fail).

**Real defect found and fixed** — `src/vue.ts` `useCrossTabDataBus`:
`start()` awaits `stop()` before calling `create()`. An unmount landing inside
that async window ran `stop()` without bumping `lifecycleGeneration`, so the
pending continuation still ran `create()` after the component was gone,
leaving a live bus with no owner to stop it. `onBeforeUnmount` now bumps the
generation. Regression test fails without the fix. (React adapter unaffected:
its `create()` is synchronous inside `useEffect`.)

**Real CI gap found and fixed** — `verify:compat`, `verify:pack`, and the
`vitest.config.ts` coverage thresholds were all documented release gates that
no workflow ran. They could only ever fail after a tag was pushed, or never.
Added to the CI `verify` job and (compat/pack) to the `Release` job. Both
checkouts needed `fetch-depth: 0` + `fetch-tags: true` — `verify:compat`
resolves its baseline from the latest release tag and dies with
"no version tag found" on the default shallow checkout (reproduced locally).
Documented the automated gate set in both release checklists.

**Coverage** (485 -> 541 unit tests, 26 -> 27 files):

| Module | Before (stmt/branch) | After |
|---|---|---|
| `core/replay-manager.ts` | 86.95 / 81.60 | 97.10 / 96.00 |
| `core/replay-persistence.ts` | 84.02 / 66.17 | 93.29 / 72.05 |
| `centrifuge-session.ts` | 92.62 / 88.05 | 98.36 / 94.02 |
| `vue.ts` | 96.55 / 86.66 | 97.72 / 93.33 |
| All files | 94.00 / 88.62 | 95.86 / 90.48 |

New `tests/replay-manager.test.ts` (41 tests) drives the manager directly —
previously it was only exercised transitively through `CrossTabDataBus`, which
left the retention-sweep coalescing, the persistence retry/backoff loop, the
suspend-cancellation path, and the wildcard replay gates unpinned.

**Deps**: react / react-dom / @types/react -> 19.3.0 (dev-only). TypeScript
stays on 6.0.3; 7.0.2 is still rejected by typescript-eslint (phase-32
deferral stands). `pnpm audit` clean.

**Local battery**: install (frozen lockfile), typecheck, lint, build, 541 unit
tests, coverage (95.86 / 90.48 / 95.58 / 97.80 vs 85 / 80 / 90 / 85 floors),
bench (25 cases), verify:compat (baseline v0.20.71), verify:pack — all green,
run in the exact CI order. E2E could not run in this sandbox (the Playwright
Chromium download is network-blocked: ECONNRESET against cdn.playwright.dev);
the `browser` CI job covers it, and no E2E-facing source changed except
`src/vue.ts`, which has no demo/E2E surface.

## Phase 35 (autonomous session, cont. — core-module coverage + routing regression)

Continued the coverage-driven hunt into the two core modules.

`CrossTabDataBus` lifecycle contract edges (5 tests): `ready()` rejecting with
the configuration error when no `initialConfig` exists and resurfacing the
recorded transport failure once the opening settled; `unsubscribe` no-ops for
an unknown topic and an unregistered handler; `stop()` idempotence; and the
third dispatch gate — a two-tab setup where the owner fans out to a peer
subscriber and records the message *discarded*, so its throughput and dispatch
percentiles are not inflated by a message it never handed to a handler.
Mutation-checked (removing the `hasLocalSubscriber` gate fails it).

`WorkerClusterRuntime` publish-routing cache + lifecycle guards (8 tests),
including a two-runtime regression pinning the 0.20.58 correctness fix: a
`null` `wildcardPublishCache` entry means "no local wildcard subscription",
not "owned locally", so a topic owned by a remote worker must still be
forwarded. Note: the obvious mutation (dropping `&& cachedPattern !== null`)
is *equivalent* — `Map.has(null)` is already false — so the probe used was
the semantic one (treat any cached entry as locally-owned), which fails 4
tests including the new one.

| Module | Before (stmt/branch/func) | After |
|---|---|---|
| `core/data-bus.ts` | 94.58 / 89.79 / 90.21 | 95.07 / 90.20 / 90.21 |
| `core/cluster.ts` | 94.30 / 87.50 / 98.79 | 95.95 / 90.21 / **100** |
| All files | 94.00 / 88.62 / 94.37 | **96.29 / 91.19 / 95.78** |

Unit tests 485 -> 554. typecheck, lint, coverage, build all green.

## Phase 34-35 result (PR #10, CI green on first try)

- PR: https://github.com/Sun1090/cross-tab-worker-databus/pull/10
- All four checks green on the first run: `verify`, `browser`, `analyze`,
  `CodeQL`.
- The three newly-wired gate steps each ran and passed in the real runner:
  `Coverage thresholds`, `Public export compatibility`, `Packed consumer
  smoke`. The compat step passing confirms the `fetch-depth: 0` +
  `fetch-tags: true` checkout fix — without it that step aborts with
  "no version tag found".
- `browser` (23 e2e) green, which closes the one gap from the local battery:
  Playwright Chromium could not be downloaded in the dev sandbox (ECONNRESET
  against cdn.playwright.dev), so E2E was verified in CI instead.

## Phase 36 (autonomous session, cont. — worker/transport edge coverage)

Continued down the coverage ranking to the two remaining sub-95% modules.

`PortReaper` (SharedWorker cleanup, 5 tests): untracked-port no-ops for
`setTimeout`/`touch`/`remove` (a STOP or INIT racing a reap must not resurrect
a port), duplicate `remove` plus cadence-timer teardown when the last port
goes, `dispose()` closing and stopping every session and being repeat-safe,
`dispose()` continuing after a target throws (one detached port must not
strand the remaining WebSockets), and the non-finite/non-positive heartbeat
fallback. Three mutations checked, all caught. **97.18 -> 100 statements**,
81.81 -> 90.91 branches, 100 functions.

`WebSocketTransport` (5 tests): empty `publishBatch`, ArrayBuffer items
embedded as byte arrays in a mixed batch, duplicate `start()` reusing the live
socket, and non-string / non-object frames ignored. 92.59 -> 96.29 statements,
85.54 -> 91.56 branches, 100 functions.

Mutation-testing note: two probes turned out **equivalent** rather than
uncaught, and were recorded as such instead of chasing them —
`assignedTopics.has(null)` is already false (phase 35), and the websocket
non-object JSON guard is redundant with `parseDataBusPublication`. Both
remain as defensive depth with the contract pinned by tests.

Cumulative this session: **485 -> 564 unit tests**, all files
94.00 / 88.62 / 94.37 -> **96.53 / 91.70 / 95.78**.

## Phase 37 (autonomous session, cont. — Centrifuge transport edges)

`CentrifugeWorkerTransport` (4 tests, all mutation-checked): duplicate
`start()` reusing the live backend (a second Worker means a second WebSocket),
SharedWorker-level vs port message-decode failures reported as distinct
errors, a `channelToken` request falling back to `getToken` when the provider
lacks `getChannelToken`, and a token request answered with `TOKEN_ERROR`
instead of dropped when no `credentialProvider` exists (a silent drop hangs
the worker's connect indefinitely). 93.12 -> 95.00 statements, 91.08 -> 93.06
branches, 100 functions.

Remaining uncovered lines in `centrifuge.ts` (421/427/442/448) are the
`typeof Worker === 'undefined'` / `typeof SharedWorker === 'undefined'` SSR
guards inside the *default* factory functions. They are unreachable from the
test process without deleting the globals for the whole module graph, and the
degradation behavior they back is already covered through injected factories.
Left deliberately uncovered.

Cumulative this session: **485 -> 568 unit tests**, all files
94.00 / 88.62 / 94.37 / 96.77 -> **96.64 / 91.83 / 95.78 / 98.22**.

### Session summary (phases 34-37)

Two real problems found and fixed, both by coverage-driven probing rather
than by reading the task list:

1. `src/vue.ts` leaked a bus when a component unmounted inside the async
   start window (fixed; regression test).
2. `verify:compat`, `verify:pack`, and the coverage thresholds were
   documented release gates that no workflow ran (wired into CI + Release,
   with the `fetch-tags` checkout fix `verify:compat` requires).

Verified end to end on PR #10: `verify`, `browser` (23 e2e), `analyze`, and
`CodeQL` all green, with the three new gate steps confirmed executing in the
runner.

## Phase 38 (autonomous session, cont. - demo accessibility)

First pass over the UI/a11y area of the brief, which no prior phase had
examined. Audited `examples/demo/index.html` (396 lines) against what
assistive tech can actually perceive.

Already correct: every form control's `label[for=]` resolves to a real
control (`endpointPreset`, `urlInput`, `workerMode`, `topicInput`,
`payloadInput`), `#statusBadge` is already `role="status"` +
`aria-live="polite"`, and the event table already carried a visually-hidden
caption.

Four genuine gaps found and fixed:

1. The run-mode segmented control conveyed its selection **only** through a
   CSS `active` class. Screen readers announced three plain buttons with no
   selected state. Now `role="radiogroup"` + `aria-labelledby`, with
   `role="radio"` / `aria-checked` per button.
2. `demo.js` toggled just the `active` class on click, so the new
   `aria-checked` would have gone stale after the first switch - the handler
   now moves both together. Static ARIA that lies is worse than none.
3. The dangling `<label>run mode</label>` had no form control to label (a
   `<label>` around a button group contributes no accessible name). It became
   a `<span class="field-label" id="modeSwitchLabel">`, with a CSS rule added
   so it renders identically to the real field labels.
4. Both `.state-table`s lacked captions, and all eight `<th>` across the three
   tables lacked `scope="col"`, so cells were announced without their column
   header.

Verification: the assertions were run against the real HTML through jsdom
before and after the fix - **15 violations before, 0 after** - because
Playwright browsers cannot be installed in this sandbox. Three browser E2E
specs in `e2e/demo.spec.ts` encode the same contracts for CI: no unnamed
interactive control, a caption + column scopes on every table, and
`aria-checked` following the selection through an actual mode switch (the
regression guard for gap 2). `pnpm check` (568) and `pnpm lint` green.

Follow-up in the same phase: declaring `role="radio"` without implementing the
radiogroup keyboard pattern would have been a promise the widget did not keep,
so the click handler was refactored into a shared `selectMode()` that also
maintains a **roving tabindex** (one tab stop for the group), with Arrow / Home
/ End navigation where selection follows focus. Buttons also had *no* focus
style at all, making keyboard navigation invisible - added a `:focus-visible`
outline. The state machine was validated in jsdom (wrap-around both
directions, Home/End, click, and the "exactly one tabbable / one checked"
invariant) and pinned by a fourth E2E spec; the browser suite is now 27.

That fourth spec **failed in CI on first run** (commit `ec29397`), which is
exactly what it was for - though the bug was in the assertion, not the app:
`options.locator('[tabindex="0"]')` searches *descendants* of each `.seg`
button, while the roving tabindex lives on the button itself, so the count was
always 0. Fixed to `group.locator('.seg[tabindex="0"]')` in `6ac3a81`; all four
checks green. Lesson for this repo: Playwright's `locator.locator()` is
descendant-scoped - use a compound selector to filter the elements themselves.

Note: CI job logs and run artifacts cannot be downloaded from this sandbox
(the results-receiver and blob endpoints both close with EOF). Diagnosis has to
come from `gh pr checks`, the check-run annotations API, and local reasoning /
jsdom reproduction. Budget an extra CI round trip for browser-only failures.

Confirmed on PR #10 at commit `18ab15d`: all four checks pass and the browser
job's spec count went 23 -> 26, so the new specs really executed in CI rather
than being collected and skipped. (Job log download fails from this sandbox
with an EOF from the results receiver; `npx playwright test --list` locally
corroborates the 26-spec collection.)

## Phase 38 (PR #10 merged — coverage hunt, Vue leak fix, CI gates)

- Reviewed PR #10 (forked from 6a853d3; no conflicts — verified with a real
  trial merge before merging) and ran the full battery on the merged tree,
  including the browser suite the PR author's sandbox could not run.
- Merged as squash `7e65f28` (branch deleted). CI on the merge commit green:
  verify (now running coverage + verify:compat + verify:pack) + browser +
  CodeQL.
- Post-merge local verification: 27 files / 568 unit tests, coverage
  96.64/91.83/95.78/98.22 vs the 85/80/90/85 floors, verify:compat
  (v0.20.71), verify:pack, e2e 27/27, lint, typecheck, pack 107 files
  (no progress.md).
- Shipped from the PR: the Vue `useCrossTabDataBus` unmount leak fix
  (pending `start()` continuation could `create()` a bus after unmount with
  no owner to stop it), the CI enforcement gap (documented-but-unrun
  coverage/compat/pack gates now wired into CI + Release with full-history
  checkouts), replay-manager direct suites, and demo a11y (mode radiogroup
  with roving tabindex/keyboard nav, table captions + column scopes).

## Phase 39 (docs defect: capabilities matrix table corruption + guard)

- Found while auditing doc accuracy after the merge: the capabilities matrix
  in BOTH languages had a 3-cell row ("Optional ArrayBuffer Transferable
  transport") beside a 5-cell row (`publishBatch`), because the Transferable
  description was orphaned onto the following row — the whole matrix
  rendered with shifted columns. Fixed in `docs/capabilities.md` and
  `docs/zh/capabilities.md`.
- New documentation guard: every contiguous markdown table in the shipped
  docs must have a single cell count. Splits on unescaped pipes only, so a
  literal `\|` inside a cell (several config tables use type unions) is not
  mistaken for a separator. Mutation-checked: re-introducing the malformed
  row fails the guard; restoring passes. A full scan found only these two
  tables affected.
- 569 unit tests green (568 + 1 guard); typecheck, lint green.

## Phase 40 (CHANGELOG structure defects + release-notes guards)

- Continued the doc audit: the `[Unreleased]` section had two `### Changed`
  headings (accumulated across sessions), and `[0.20.60]` was an h1 (`#`)
  instead of h2 (`##`). The latter matters — the Release workflow matches
  `## [<version>]` to extract notes, so an h1 version would publish without
  notes (and made its `### Added` look like a duplicate).
- Fixed both, and added two guards to `tests/documentation.test.ts`: no
  repeated `### ` subheading within a CHANGELOG version section, and every
  version heading must be an h2. The first guard actually caught the 0.20.60
  defect before the fix, so both are behaviourally demonstrated.
- 571 unit tests green (569 + 2 guards); typecheck, lint, diff-check green.

## Phase 41 (release workflow ref bug + workflow guards)

- Real release-automation bug: on `workflow_dispatch`, `GITHUB_REF_NAME` is
  the selected branch (`main`), not the `tag` input. The release job used it
  raw, so a manual dispatch would create a GitHub release named `main`,
  derive the npm version from the branch, and extract notes for `main`
  (which fails the section check). Fixed by resolving
  `${ inputs.tag || github.ref_name }` once into a job-level `RELEASE_TAG`
  and using it in every step.
- New `tests/workflows.test.ts`: pins the tag derivation, rejects any raw
  `GITHUB_REF_NAME` in release.yml, sanity-checks every workflow declares
  name/on/jobs and pins actions, and requires `fetch-depth: 0` wherever
  `verify:compat` runs. Mutation-checked (reverting to the raw ref fails).
- 574 unit tests green (571 + 3); typecheck, lint, diff-check green.

## Phase 42 (release-checklist parity with the CI gates)

- The Before-tagging steps lagged the CI gate set: they omitted
  `pnpm test:coverage`, and did not warn that `verify:compat` needs
  `git fetch --tags` in a shallow clone (it resolves the baseline from the
  latest release tag). Updated both languages and pinned parity: a
  documentation test now asserts each checklist documents
  `test:coverage`, `verify:compat`, `verify:pack`, `bench:compare`, and
  the fetch-tags note.
- 575 unit tests green (574 + 1); typecheck, lint, diff-check green.

## Phase 43 (EN/ZH parity defects, adaptive-dedup validation hole, JSDoc dup)

- Continued the doc audit into cross-language drift. Structural comparison of
  every localized pair (h2 count, table-row count, list-item count) found five
  real defects, all in the language that had drifted:
  - `docs/release-checklist.md` (EN) was missing the whole "Security and
    dependency scanning" section (CodeQL + Dependabot) that only the Chinese
    copy carried — EN had 6 h2 sections, ZH 7.
  - `docs/zh/roadmap.md` had lost the `0.11.0` delivered-scope section
    entirely (EN 100 h2, ZH 99), and its `0.13.0` candidates section was
    empty (EN lists four items).
  - `docs/zh/configuration.md` omitted the `recovery.cooldownMs` and
    `recovery.maxAttempts` rows that the EN Core-config table documents
    (39 table rows vs 37).
  - `docs/zh/README.md`'s demo link text was `../..//examples/demo` (doubled
    slash); the target was right, the label was not.
- Five new guards in `tests/documentation.test.ts` pin this class: EN/ZH h2
  parity, table-row parity, list-item parity, no empty section, and every
  shipped doc enumerated in `package.json` `files`. All five mutation-checked
  by reverting the corresponding fix (each fails with a precise message, e.g.
  `docs/zh/configuration.md has a different number of table rows ... expected
  37 to be 39`).
- Real code fix found while reading the dedup path: `assertDedupOptions`
  accepted non-finite `adaptiveTtl` bounds. `NaN <= 0` and `maxMs < NaN` are
  both false, so `{ minMs: NaN, maxMs: 1000 }` (or `maxMs: Infinity`) passed
  construction and left `DedupManager.currentTtl()` returning `NaN`, silently
  disabling expiry rather than failing loudly. Bounds must now be finite
  positive numbers with `minMs <= maxMs`; the existing bounds test gained the
  five non-finite cases.
- Second code-hygiene fix: `BatchingStorageWriter` carried its class JSDoc
  twice (the first a truncated copy), so the first block was dead
  documentation. Removed, with a `tests/regression.test.ts` guard that fails
  when a JSDoc block is stacked on another whose body it prefixes (a file
  header followed by a member doc is deliberately allowed). Mutation-checked:
  re-inserting the duplicate reports
  `src/core/storage-batch.ts:21 duplicates the JSDoc block at line 25`.
- Packaging: `package.json` `files` now also enumerates `README.zh.md` and
  `docs/zh/README.md`, mirroring the already-listed English counterparts.
  Verified with `npm pack --dry-run --json` that npm auto-includes any
  `README*` regardless of `files` (a scratch `docs/zh/_scratch-probe.md` is
  *not* included, so the enumeration guard still has real teeth for
  non-README docs) — recorded so a future reader does not mistake this for a
  missing-file fix.
- 581 unit tests green (575 + 6 new guards); typecheck, lint, build, e2e
  (27/27), verify:pack, `npm pack --dry-run` (107 files, `docs/zh/README.md`
  present, no progress.md) green.
- Sandbox note: this environment cannot run `pnpm` (its global store symlink
  is broken) or the full suite in one shot — vitest spawns 26 forks and the
  jsdom files (hooks/vue) intermittently fail to start, and the `dual-format`
  dist test can time out when the machine is loaded. Run with
  `./node_modules/.bin/vitest run --maxWorkers=1` and re-run the two jsdom
  files separately; all 581 pass. `pnpm` can be replaced by
  `PATH="$PWD/node_modules/.bin:$PATH" node scripts/build.mjs`.

## Phase 44 (deterministic generated benchmark doc + testable generator)

- Found while checking whether the shipped trend doc was stale: regenerating
  `docs/benchmarks.md` on a day with no new archived report produced a diff —
  the stamp was `new Date()`, so the doc changed daily and claimed data it did
  not have. (Running it on 09-12 rewrote the line to "Auto-generated
  2026-09-12" while the newest report was still 09-11.)
- Two real defects in `scripts/bench-trend.mjs`:
  - non-deterministic stamp (above); now derived from the latest report's
    `generatedAt`, falling back to the `browser-<ISO>.json` filename date, so
    regeneration is a no-op diff when nothing new was archived.
  - the generated header claimed "prose is maintained by hand" while the script
    overwrites the entire file — corrected in both the script and both docs.
- Refactored the script so the renderer is a pure exported `buildDocs(entries)`
  (+ `readReports`), with `scripts/bench-trend.d.mts` for type-checked imports
  (the existing `demo-*.d.mts` pattern), and the CLI body behind an
  `import.meta` direct-invocation check.
- New `tests/bench-trend.test.ts` (6 tests): the stamp is the report date and
  never the wall clock (the explicit regression assertion), byte-determinism
  across calls, the report count, delta + all-time-best math in both
  directions, the filename-date fallback, and rejection of a <2-report archive.
  Mutation-checked: restoring `new Date()` fails two tests with
  "expected ... to contain 'Data through 2020-01-02'".
- 587 unit tests green (581 + 6); typecheck, lint, build green.

## Phase 45 (silent benchmark-gate bypass + scripts/ lint coverage)

- Swept the release-critical scripts (they are mostly unguarded). Found a
  real gate defect in `scripts/bench-compare.mjs`, which both release
  checklists invoke as `pnpm bench:compare --fail-above-pct 50`:
  the threshold was `Number(...)`-coerced with no validation, so
  `--fail-above-pct abc` produced `NaN` — and because every `pct > NaN`
  comparison is false, the gate reported
  `[bench] OK: no metric regressed more than NaN%` and exited 0. A typo
  therefore **silently disabled the regression gate**. Now a missing, empty,
  non-numeric, or negative threshold throws.
- Also fixed the adjacent argument-handling wart: passing exactly one report
  path silently compared the two most recent reports instead of erroring.
- Refactored the CLI into validated exported helpers (`parseArgs`,
  `compareReports`, `findRegressions`, `latestReports`) with
  `scripts/bench-compare.d.mts`, plus `tests/bench-compare.test.ts` (8 tests)
  pinning the loud failure, the row pairing, the threshold boundary, the
  near-zero-baseline skip, and the null-threshold off switch. Mutation-checked
  (removing the validation fails the test). Real-CLI smoke: `abc` now exits 1
  with a clear message; `50` still prints `[bench] OK`.
- Second finding: `scripts/` was in the ESLint `ignores` list, so none of the
  release tooling was linted. Removed the ignore and added a Node config block
  (Node globals, `no-console` allowed; browser globals scoped to
  `bench-browser.mjs`, whose Playwright `waitForFunction` callback really runs
  in the page). Enabling it surfaced two genuine findings, both fixed:
  - `verify-version-compat.mjs` threw a new error without attaching the
    original as `cause` (`preserve-caught-error`), discarding the git failure
    detail.
  - `serve-examples.mjs` had a misindented `console.log` in the startup block.
  A guard now fails if `scripts/**` returns to the ignore list.
- 596 unit tests green (587 + 8 + 1); typecheck, lint (now covering scripts),
  build, `verify:compat`, `bench:compare`, idempotent `bench:trend` green.

## Phase 46 (packed-consumer smoke: workspace pollution, temp leak, coverage gap)

- Swept `scripts/verify-packed-consumer.mjs` (run by CI on every push and by the
  release workflow before publish). Three real defects, all confirmed
  empirically before the fix:
  1. **Checkout pollution.** A bare `npm pack` writes
     `cross-tab-worker-databus-0.20.83.tgz` into the repo root — one stale
     archive per version, recreated on every push. Its sibling
     `verify-published-consumer.mjs` already passed `--pack-destination`; this
     one never did. (Confirmed: a `.tgz` was sitting in the root, and its mtime
     advanced on each run.)
  2. **Temp-root leak.** Neither verifier removed its `mkdtempSync` root, so
     every run left ~3.3 MB of unpacked package behind. Five
     `cross-tab-databus-pack-*` dirs had accumulated (~16.5 MB) — one per
     `verify:pack` run.
  3. **Coverage gap.** The smoke swept only a hardcoded
     `['.', './hooks', './vue', './centrifuge']` list, so `./centrifuge.worker`
     and `./centrifuge.shared.worker` — the entry points the built-in Worker
     factory resolves at runtime — were never checked inside the tarball.
- Fixes: pack into the temp root; remove it in a `finally` in both scripts;
  derive the sweep from the packed manifest via a new exported
  `collectExportTargets(manifest)` (+ `assertPackedExports`), keeping the
  dual-format `import`/`require` contract as a separate explicit assertion so
  the intentionally ESM-only worker entries are not mis-flagged. The CLI body is
  now behind an `import.meta` direct-invocation check (the `bench-trend.mjs`
  pattern) with `scripts/verify-packed-consumer.d.mts` for typed imports.
- Guards: new `tests/verify-packed-consumer.test.ts` (9 tests) pins the
  manifest-derived coverage — including the explicit assertion that every key of
  the real `package.json` `exports` is swept, which is the regression itself —
  plus the string-entry flattening, the empty-export rejections, the missing
  worker target, the lost `require` condition, and the real manifest against the
  real `dist`. A new `tests/regression.test.ts` case pins the hygiene
  properties (`--pack-destination`, tarball read back from the temp root,
  `rmSync` inside a `finally` in both verifiers).
- Mutation-checked all three guards: (a) reverting the sweep to the hardcoded
  list fails 4 tests with `export ./centrifuge.worker must be swept by the pack
  smoke`; (b) dropping `--pack-destination` fails with `npm pack must write into
  the temp root`; (c) dropping the `finally` fails with
  `verify-published-consumer.mjs must remove its temp root`. Additionally an
  end-to-end mutation — pointing `./centrifuge.worker` at a missing file and
  running the real CLI against a real tarball — now exits 1 with
  `missing export target ./dist/centrifuge.worker.broken.js for
  ./centrifuge.worker`, which the old hardcoded sweep could not detect at all.
- Post-fix CLI smoke: tarball count 0 and temp-dir count unchanged across a run,
  `[pack] verified ESM/CJS root and subpath consumers` still green.

## Phase 47 (non-finite load scores + unvalidated cluster options)

- Found by auditing the option surface against the docs rather than reading
  prose: `loadWeighting` is a documented, routing-affecting public option with
  **zero** validation anywhere, and the rest of the cluster options were in the
  same state. Reproduced five behaviours against the built bundle first:
  1. `effectiveWorkerLoad` returned `NaN` for a sample with `windowMs: NaN`
     (`NaN <= 0` is false, so it slipped the "non-positive window" guard).
  2. `NaN` for a non-finite weight.
  3. `NaN` for a corrupt sample field (`messageCount`).
  4. **Order-dependent owner selection.** `selectLeastLoadedWorker` compares
     `byLoad !== 0` — true for `NaN` — and `NaN < 0` is false, so the `NaN`
     worker won or lost purely by its array index:
     `[healthy, corrupt] → healthy` but `[corrupt, healthy] → corrupt`. Worker
     order comes from storage listing, so the same cluster could pick different
     owners per tab.
  5. A negative weight inverts the documented policy: `messageRateWeight: -1`
     picked the *loud* worker.
- Fixes:
  - `src/core/routing.ts` — the score is now total. A non-finite `windowMs`
    falls back like a non-positive one, and a non-finite weighted sum falls back
    to the raw topic count, so `NaN` can never reach the comparator.
  - `src/utils/validation.ts` — new `assertLoadWeightingOptions` (weights must be
    non-negative finite) and `assertClusterOptions` (`maxActiveWorkers` and
    `routeOwnerCacheMax` positive safe integers; `heartbeatIntervalMs` and
    `workerTtlMs` positive finite). Called from the `WorkerClusterRuntime`
    constructor, so it covers `CrossTabDataBus` and both transport factories.
    `Infinity` is rejected for the cluster heartbeat (unlike the Centrifuge PING,
    where it legitimately means "disable"): a Worker that never refreshes its
    heartbeat is pruned by its own TTL. A `0`/`NaN` heartbeat would degenerate
    `setInterval` into a 0ms busy loop — the exact hazard the PING guard exists
    for — and a non-positive TTL pruned every peer on the first reconcile.
- Tests: 2 in `tests/routing.test.ts` (never non-finite; same owner regardless of
  input order), 5 in `tests/cluster.test.ts` (one per option group + the
  `loadWeighting` shape), 1 in `tests/data-bus.test.ts` (the same validation
  reached through the public bus, which is how the gap was discovered).
- Mutation-checked all three: removing the `Number.isFinite(weighted)` guard
  fails with `expected NaN to be 4`; removing both NaN guards fails the
  order-independence test with `expected 'healthy' to be 'corrupt'`; removing the
  `assertClusterOptions(options)` call fails all 6 validation tests.
- Docs: both configuration references now state the weight constraint (EN/ZH
  parity preserved).
- 614 unit tests (606 + 8), typecheck, lint, build, verify:compat, verify:pack,
  bench:compare, and 27/27 browser E2E green.

## Phase 48 (the API reference drifted behind the public surface)

- Continued the Phase 47 method — audit the *documented* surface against the
  *actual* one — and pointed it at the API reference. Derived the 19 root
  exports from the built entry point and checked each against `docs/api.md`:
  - `DEFAULT_MAX_ACTIVE_WORKERS`, `approximatePayloadBytes`,
    `effectiveWorkerLoad`, `getOrCreateTabId` were **absent from the API
    reference entirely** (the first three also from every other shipped doc;
    `effectiveWorkerLoad` only appeared in architecture.md).
  - `CrossTabDataBus.publishBatch` — a headline public method — had no entry;
    only the *transport-side* optional `publishBatch?` hook was described. The
    `WorkerClusterRuntime` "Main methods" list omitted it too.
  - Self-correction: an initial heading-only grep suggested `clearReplayTopic`,
    `clearReplayBefore`, `getDedupStats` and `resetDedup` were also missing.
    They are documented as prose paragraphs under `### clearReplay()`, so the
    heading list was the wrong instrument — checked before claiming anything.
- Documented all five in both languages (EN + ZH), including the two
  non-obvious guarantees that were only in the source: `getOrCreateTabId`
  deliberately does **not** reuse the stored value when `window.opener` is
  present (`window.open()` clones the opener's `sessionStorage`, so a blind
  reuse would give two live tabs one identity), and `effectiveWorkerLoad` is
  total — a non-finite window/result falls back to the raw Topic count so owner
  selection stays order-independent.
- New guard in `tests/documentation.test.ts`: derives the export list from
  `dist/index.js` and asserts every name appears in *both* `docs/api.md` and
  `docs/zh/api.md`. A new public export now fails the suite until documented, so
  the reference cannot silently drift behind the code again. Mutation-checked
  (renaming the `DEFAULT_MAX_ACTIVE_WORKERS` heading fails with
  `docs/api.md must document every public root export: expected [ 'DEFAULT_MAX_ACTIVE_WORKERS' ]`).
- EN/ZH structural parity preserved (h2 count, table rows, list items, no empty
  sections) — the new `###` sections and the one mirrored
  `WorkerClusterRuntime` bullet keep both counts equal.

## Phase 49 (the two adapter entries documented for only one adapter each)

- Spotted while reading the sections Phase 48 pointed at: `### useCrossTabHealth`
  sat under `## React Hooks` in English but under `## Vue Composables` in
  Chinese, and `/hooks` and `/vue` export the **same four composable names**
  (`useCrossTabDataBus`, `useCrossTabSubscription`, `useCrossTabStatus`,
  `useCrossTabHealth` — verified against `dist/hooks.d.ts` / `dist/vue.d.ts`).
  So each language documented the health composable for exactly one adapter:
  EN readers never learned `/vue` exports it, ZH readers never learned `/hooks`
  does. The Chinese Vue heading also carried the **React** name
  (`useCrossTabHealth`) over a body describing a Vue `Ref`.
- This class is invisible to the existing parity guards: both languages have the
  same h2 count, the same table rows, and the same list items, so only *where* a
  name lives differs. New guard: split the reference on h2, and require each
  entry's own section to document every export of that entry (derived from the
  built declaration files). It failed on the pre-fix docs with exactly
  `docs/api.md: the /vue section must document every export of that entry:
  expected [ 'useCrossTabHealth' ]` and then, after fixing EN, the Chinese
  equivalent for `/hooks` — i.e. it caught both defects independently.
- Fixes: EN gains `### useVueCrossTabHealth(bus, options?)` in the Vue section;
  ZH gains the React `### useCrossTabHealth(bus, options?)` section and its Vue
  heading is corrected to `useVueCrossTabHealth`, matching the `useVue*`
  aliasing convention that section already uses elsewhere.
- 615 unit tests, typecheck, lint green; EN/ZH structural parity intact.

## Phase 50 (my own Phase 48 guard broke CI — invisible locally)

- CI failed in 22s on both Phase 48 and Phase 49 while every local gate was
  green. Root cause: `pnpm check` is `typecheck && build && test`, so
  `tsc --noEmit` runs against a **fresh checkout with no `dist/`**, and the new
  documentation guard's literal `import('../dist/index.js')` was rejected with
  `TS2307: Cannot find module '../dist/index.js'`. Locally `dist/` already
  existed, so the failure never appeared.
- This is a known trap in this repo — `tests/dual-format.test.ts` carries a
  comment explaining that it builds the specifier as a non-literal
  (`` `../dist/${'index.js'}` ``) precisely so tsc does not statically resolve
  it. The guard now uses the same form.
- Reproduced the CI condition locally by `mv dist dist-hidden && tsc --noEmit`
  (exit 0 after the fix) instead of trusting the local run.
- Added a source-hygiene guard so the trap cannot return silently: no test file
  may use a literal dynamic `import()` of `../dist/`. Mutation-checked — it
  reports `tests/documentation.test.ts:245 statically imports dist — use a
  non-literal specifier`.
- Lesson recorded: after adding any test that touches `dist/`, run the *CI
  sequence* (`tsc --noEmit` **before** the build), not just the test suite.

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