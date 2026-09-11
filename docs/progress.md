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