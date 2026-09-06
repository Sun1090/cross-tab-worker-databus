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

1. [x] Audit React (tests/hooks.test.tsx) vs Vue (tests/vue.test.ts) adapter parity;
      port any missing React coverage (health hook edge cases, topic rebinding)
      to Vue or justify the gap. -> Parity complete: Vue covers lifecycle+status+subscribe,
      bus-ref rebind, reactive-topic rebind, stale-bus-after-rapid-changes, health refresh,
      interval polling + detach nulling. StrictMode double-mount is React-only. No gap.
2. [x] README feature list: add loadWeighting / credentialProvider / getMetrics /
      replay bytes / bench gate bullets; keep the capabilities link accurate.
      -> README.md (EN) + README.zh.md updated with the three new bullets
      (adaptive weighting, credential bridge, synchronous diagnostics);
      capabilities link already accurate.
3. [ ] Docs EN/ZH parity sweep: diff every public API change against docs/zh;
      fix any missing zh mirror.
4. [ ] verify:compat / version-compat script: confirm it type-checks new exports
      (effectiveWorkerLoad, approximatePayloadBytes, getMetrics, WorkerThroughputSample)
      or extend its export manifest.
5. [ ] Demo: surface getDiagnostics().replay.bytes already done; add throughput
      sample coverage assertion already done via e2e (adaptive-weighting).
6. [ ] Unit coverage: cluster integration test that scheduleLagWeight actually
      steers a route on a sampling peer (end-to-end, not just pure fn).
7. [ ] Unit coverage: DataBusTraceReporter.getMetrics() consistency vs a flushed
      message_metrics event (same window values).
8. [ ] Release checklist: record the verify:pack command output + bench gate in
      the checklist validation run.
9. [ ] Add `pnpm verify:published` (offline/local) note + `verify:compat` to the
      release checklist documented commands.
10. [ ] CHANGELOG: fold the phase changes into [Unreleased].

## Recovery entry

If interrupted: working tree state, current commit, and any in-flight test
outputs are recorded here (see Task pool checkboxes). Resume with:
`pnpm check && pnpm lint && pnpm test:e2e && pnpm bench && pnpm verify:pack`
then continue the next unmarked task. Push only after the phase is locally green.