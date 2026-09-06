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
3. [x] Docs EN/ZH parity sweep: diff every public API change against docs/zh;
      fix any missing zh mirror. -> Keyword + content sweep across api/config/
      capabilities/release-checklist/getting-started all matched; the one gap was
      zh/roadmap.md (0.20.69 candidates not marked delivered) — now mirrored.
4. [x] verify:compat / version-compat script: confirm it type-checks new exports
      (effectiveWorkerLoad, approximatePayloadBytes, getMetrics, WorkerThroughputSample)
      or extend its export manifest. -> verify-packed-consumer.mjs now smoke-imports
      the full root public surface (12 ESM + subpath + CJS) incl. the new routing/
      observability functions; `pnpm verify:pack` passes locally. verify:compat's
      subpath-contract check unchanged (still valid).
5. [x] Demo: surface getDiagnostics().replay.bytes already done; add throughput
      sample coverage assertion already done via e2e (adaptive-weighting).
      -> Already shipped: overview live-diagnostics row (getMetrics + replay
      bytes) and the adaptive-weighting e2e asserting msg/s in the workers table.
6. [x] Unit coverage: cluster integration test that scheduleLagWeight actually
      steers a route on a sampling peer (end-to-end, not just pure fn).
      -> tests/cluster.test.ts 'steers a new route away from a scheduling-lagging
      worker despite fewer topics': A=1 topic starved (overrun 0.667 ratio), B=2
      topics healthy; with scheduleLagWeight:3 the new route lands on B, and the
      SUBSCRIBE control is asserted.
7. [x] Unit coverage: DataBusTraceReporter.getMetrics() consistency vs a flushed
      message_metrics event (same window values).
      -> Strengthened tests/trace.test.ts 'getMetrics snapshots...' to assert full
      field parity: the flushed message_metrics event (minus type) equals the
      on-demand snapshot exactly for the same window.
8. [x] Release checklist: record the verify:pack command output + bench gate in
      the checklist validation run. -> Already present (Before tagging #2
      includes verify:pack, #3 the bench gate); confirmed unchanged.
9. [x] Add `pnpm verify:published` (offline/local) note + `verify:compat` to the
      release checklist documented commands. -> Added pnpm verify:compat to the
      Before-tagging run list with a parenthetical on what it asserts;
      verify:published offline note was already present.
10. [x] CHANGELOG: fold the phase changes into [Unreleased] (after local verify).
      -> QA bullet added: verify:pack full-surface smoke-import, scheduleLag
      steering integration test, getMetrics full-parity test, README + zh roadmap
      updates.

## Recovery entry

If interrupted: working tree state, current commit, and any in-flight test
outputs are recorded here (see Task pool checkboxes). Resume with:
`pnpm check && pnpm lint && pnpm test:e2e && pnpm bench && pnpm verify:pack`
then continue the next unmarked task. Push only after the phase is locally green.