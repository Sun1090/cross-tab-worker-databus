# Roadmap

0.20.91 is released. The project is intentionally continuing through reliability-focused releases before a 1.0.0 stability freeze.

## 0.20.92 in progress

The current line continues lifecycle error-path verification around predecessor reopen settlement, queued-start readiness, and stop-promise cleanup. Five fixes have now landed. First, the shared stop gate is installed before the synchronous teardown prelude, so a `stop()` re-entered from the synchronous STOP lifecycle trace event shares the one teardown instead of running `transport.stop()` twice. Second, lifecycle ownership and `startPromise` are installed before the synchronous START trace: if a trace or status callback re-enters `stop()`, the outer `start()` immediately stops later timer, cluster, and topic setup; the epoch guard abandons the old opening before `transport.start()`. Third, the same ownership-before-callback ordering now applies to `reopenTransport()`'s synchronous CONNECTING status notification, so a stop from that callback cancels recovery instead of letting it open a replacement transport after teardown. Fourth, a stop from the synchronous RESUME lifecycle trace now invalidates both explicit and native pageshow resumes; `WorkerClusterRuntime` uses a lifecycle generation so the outer pageshow handler cannot reactivate a cluster already stopped or paused by `onResume`. Previously each outer operation could settle after the nested stop and leave a stopped bus with a live connected transport or an active cluster. Fifth, transport operations already parked on the recovery gate are no longer stranded when the automatic recovery attempt they were waiting on fails: `runTransport()` now counts the parked operations, and a failed automatic attempt starts one on-demand reopen immediately when any waiter is present, so a `publish()` / `subscribe()` issued during the cooldown itself drives recovery instead of waiting for an unrelated later operation. A failed on-demand reopen still re-arms the demand flag for a later operation rather than looping on its own failure, and every waiter flushes in order once a reopen succeeds. The cluster-key isolation guarantee now has a dedicated two-runtime regression: same-topic ownership remains independent across tenants, publications do not cross the namespace boundary, and persisted keys use distinct opaque hashes without exposing the plaintext key.

## 0.20.91 delivered scope

The reliability line continues with error-path coverage and release-gate maintenance. IndexedDB replay cleanup now has regressions for transaction-level errors on `clear()`, `clearTopic()`, and `clearBefore()`, including connection invalidation/recovery and fallback rejections when the browser exposes no transaction error object. The WebSocket transport now best-effort closes a socket after connection invalidation so automatic recovery cannot orphan a dead connection; the published-consumer gate normal path was audited with no fixed wait or redundant registry round-trip found. Centrifuge token-bridge providers are now bound to the lifecycle of the client that created them, so a replaced client cannot route a late credential request into a new session. Subscription-level callbacks and publish rejections from a replaced client are also pinned not to mutate or report into its replacement.
The DataBus lifecycle audit now also pins failed-reopen stop-gate reuse, late rejection isolation for a superseded initial open, generation isolation for late message/status/error callbacks from a retired transport, and the readiness/recovery contract (`stop()`-then-`pageshow` must not restart background work, automatic-recovery failure must surface through `ready()`, a canceled queued start must not satisfy a replacement restart, a queued restart suspended before usable must reject `ready()`, and a stale recovery timer must not reopen the transport). The audit also surfaced and fixed a real timer leak: `WorkerClusterRuntime.pause()` no longer schedules a deferred `channel.close()` when there is no channel. Mutation checks prove each regression fails when its lifecycle guard is removed. This phase additionally pins failed-open stop-gate reuse, page-hide stop-rejection recovery, replay-handler dispatch isolation, and in-flight recovery reopen reuse, with mutation coverage for the reopen guard.

The queued transport-operation audit now pins that a `subscribe()` parked behind the initial open reports its rejection through `onError` exactly once and does not escape as an unhandled rejection, while the still-opening transport is never touched before the start gate opens.
The DataBus lifecycle audit now also pins rejection ownership when an in-flight initial `transport.start()` is superseded by `stop()` and rejects while teardown is waiting: the abandoned `start()` call observes its own failure, `stop()` still resolves, the transport is closed exactly once, and the stale rejection never enters the new lifecycle's error ledger.
The cross-tab `EVENT` boundary now rejects publication payloads that are not objects with a string `topic`, so one malformed same-origin frame cannot throw from the BroadcastChannel listener and break later delivery. Unknown event types remain forward-compatible, legacy payloads inherit frame-level `originTabId`, and payload-level attribution takes precedence; both behaviors are pinned by regressions.

## 0.20.90 delivered scope

The line hardens the release pipeline uncovered by the 0.20.89 tag run and aligns the documented delivery semantics with the implementation.

- Release-gate propagation budget: the blocking published-consumer verification now waits 48 x 7.5 s (6 min) instead of 24 x 5 s (2 min). The 0.20.89 tag run published successfully and then still failed the gate because `npm pack` returned `ETARGET` for the whole old budget; a genuinely missing package still exhausts the budget.
- Delivery semantics: the API, architecture, and capabilities docs now consistently state the bounded local fan-out guarantee and the lack of end-to-end at-least-once or exactly-once delivery; the Chinese API reference documents the opt-in `messageId` deduplication window.
- Release performance evidence: the benchmark trend docs were refreshed from 23 archived reports; the latest two-run comparison stayed inside the 50% ceiling, with per-message publish latency improving in both worker modes.

## 0.20.89 delivered scope

The line continues the async-callback isolation audit: every fix below binds a callback, queued microtask, or promise continuation to the lifecycle generation that created it, so a superseded session cannot write into its replacement.

- Async teardown and restart boundaries: a settled `stop()` gate can no longer swallow a later teardown (`stop → start → stop` now ends stopped), and `getHealthSummary()` reports `state: 'stopped'` for a stopping bus instead of contradicting the `publish()` / `subscribe()` / `ready()` rejections it is already issuing.
- Replay persistence isolation: microtask-queued batch flushes and a queued retention cleanup are discarded once `suspend()` / `stop()` supersedes their generation, so stopped-session history cannot be appended to the durable store.
- Durable hydration cancellation: a `load()` that resolves after `suspend()` or `stop()` can no longer append into buffers teardown has already cleared, and is reported as a lifecycle cancellation rather than a persistence failure.
- Trace session isolation: a stopped trace reporter stays inert — queued `asyncSink` events from the old session are dropped and the stopped flag is cleared by an explicit restart so its lifecycle `start` is emitted again.
- Transport and Worker callback isolation: Centrifuge credential-provider results are bound to the exact Worker/port/session that requested them, async `CentrifugeSession` client/subscription callbacks are ignored after `STOP` or reinit, and a `Blob` binary frame from a replaced WebSocket connection can no longer be dispatched as if it belonged to the new one.
- Regression safety net: the seeded lifecycle fuzzer now covers 1_500 interleavings and asserts that a sequence whose last explicit intent was `stop()` settles in `state: 'stopped'` with no live transport.

## 0.20.88 delivered scope

- Startup-failure recovery is now re-entrant. A transport that reports `error` synchronously while its initial `openTransport()` is still settling can be retried from either the `onStatus('error')` or `onError` callback; the failed open finishes cleanup first, the retry starts a fresh lifecycle, and the stale rejection cannot repopulate the reset failure ledger.
- Repeated BFCache `pagehide`/`pageshow` cycles during an in-flight initial open no longer strand the bus in a permanently suspended state. Suspend reuses the existing stop gate only when it still represents the current lifecycle, otherwise it installs a fresh serial stop so the next resume actually reopens the transport.
- Explicit `start()` is now a complete resume path after BFCache suspension: it restores cross-tab coordination as well as the transport, and restarts trace metrics, dedup expiry, and replay retention work that `pagehide` had paused.

## 0.20.87 delivered scope

- Transport recovery/readiness hardening: the native WebSocket backend now honors the `DataBusTransport.start()` contract (resolves only after `open`, rejects on a failed handshake or `connectTimeoutMs`), automatic recovery actually creates a replacement socket after a failure, and `getHealthSummary()` follows the live transport status instead of the `transportReady` diagnostic flag.
- No operation is written to a connection that is gone. A recovery gate parks `subscribe()` / `publish()` through automatic and on-demand reopens (including an automatic attempt that failed but left the budget open), and a clean `disconnected` after a real connection now demands exactly one on-demand reopen instead of being handed to a closed socket — while a worker-style backend that reports the connection asynchronously keeps its pre-connect window unreopened.
- Lifecycle/`ready()` boundary fixes: `ready()` rejects while the tab is BFCache-suspended, `stop()` resolves even when the transport's own `stop()` rejects or throws, a failed open is stamped once across both recovery ledgers, runtime transport errors land in the recovery ledger, and superseded asynchronous opens can no longer tear down a newer suspend/resume transition.
- Adapter and toolchain: React/Vue `useCrossTabHealth` apply `intervalMs` changes without recreating the bus, and `vitest` and its coverage-v8 provider moved to the 5.0.1 patch.

## 0.20.86 delivered scope

- Lifecycle hardening across explicit stop/start boundaries: queued restarts are serialized with in-flight stops, canceled by a newer stop, and observable through `ready()`; superseded asynchronous opens cannot tear down newer suspend/resume transitions; stop-time `subscribe()` and non-empty `publish()`/`publishBatch()` calls now report through `onError` instead of mutating teardown state or being silently dropped.
- Explicit `start()` now performs the documented manual recovery after automatic recovery exhaustion, while preserving cluster state, subscriptions, and replay history.
- IndexedDB replay persistence settles all mutations on transaction abort (including connection-loss aborts) so the serialized queue cannot remain blocked, and replay age pruning now uses one shared, position-independent policy for in-memory and persisted history.
- The configuration reference documents the full replay/dedup public option surface in both languages, with declaration-derived documentation guards; seeded property invariants cover active-worker selection and rebalance targets.

## 0.20.85 delivered scope

- A seeded property suite (`tests/property.test.ts`) for the pure hot-path helpers and the stateful managers: finiteness/totality, order-independent selection, cycle-safe sizing, publication topic/metadata validity, `serializeError` cloneability, and dedup/replay bounds under long random operation sequences.
- `effectiveWorkerLoad` is total against a corrupt stored base load — a non-finite value (JSON `1e999` → `Infinity`) can no longer leak into owner selection and re-introduce array-order dependence.
- `approximatePayloadBytes` is depth-bounded, so a cyclic payload (structured clone preserves cycles) can no longer overflow the stack in the replay-buffer footprint or the adaptive-load sampler.
- `serializeError` always produces a structured-cloneable result; a non-cloneable context (function/symbol) is dropped instead of making the error report itself throw `DataCloneError`.
- Replay history is bounded when `pruneStrategy: 'age'` is set without a `retentionMs`: the count cap now applies in both the in-memory ring and the IndexedDB record.

## 0.20.84 delivered scope

- Release/CI gates are enforced instead of advisory: `pnpm test:coverage`, `pnpm verify:compat`, and `pnpm verify:pack` run in the CI verify job, the Release workflow re-runs lint + compat + pack before publishing, and both checkouts fetch full history and tags so the compat baseline resolves.
- Coordination recovery hardening: a lost handoff ACK, a crashed owner, or the previous owner's departure now recovers through a worker-TTL-gated re-election with a single writer and projected-load spreading, and each route acknowledgment / migration / recovery is observable as a bounded `reliability` trace event.
- Three real correctness fixes: the Vue `useCrossTabDataBus` unmount leak (a pending start could create a bus with no owner), the adaptive dedup TTL not taking effect on the hot path, and `effectiveWorkerLoad` leaking a non-finite score from a corrupt stored load back into owner selection.
- Product-demo observability: the event feed renders reliability / subscription / coordination trace events, chaos toggles exercise the dropped-ACK and crash recovery paths in a real browser, and the config panel shows the active chaos mode.
- Coverage and toolchain: direct `ReplayManager` / `DedupManager` suites, transport error-isolation and partial-metadata coverage, vitest 5 (benchmark API migrated) and the eslint 10 lint config, with TypeScript 7 deferred until typescript-eslint supports it.

## 0.20.83 delivered scope

- Adapter edge-case coverage for the health hook, archived browser benchmarks with a comparison script, and a README feature list aligned with current capabilities.
- A large internal cleanup: every runtime string literal centralized in `utils/constants.ts` with literal-derived types, and replay/dedup split out of `CrossTabDataBus` into self-contained `ReplayManager` / `DedupManager` classes.
- The demo's "批量 10" publishBatch button with `/debug/wsstats` frame counting and a single-frame E2E, `asyncSink: true` delivery-semantics documentation, and a release checklist aligned with the blocking published-consumer gate.

## 0.20.82 delivered scope

- A 20 s default E2E assertion ceiling, structured-clone rejection coverage, and shared-mode session lifecycle verified end to end through the examples server's connection-count endpoint.

## 0.20.81 delivered scope

- The browser benchmark gained the data-bus hot-path matrix, health summaries are asserted end to end in E2E, and the storage-event channel plus transport batching joined the API docs and capabilities matrix.

## 0.20.80 delivered scope

- E2E reliability governance: failure traces/videos with longer retention, converge-before-publish patterns for reload tests, a staggered burst pattern within documented guarantees, and the loss-and-recovery matrix in the architecture docs.

## 0.20.79 delivered scope

- Published-consumer verification became a blocking release gate, and the lost-handoff-ACK recovery chain (TTL cleanup + resume re-election) is pinned by a regression.

## 0.20.78 delivered scope

- E2E now asserts the real transport backend per tab, the deferred-close handoff invariant is pinned by a regression test and documented, and the getting-started guide covers health summaries and the coordination fallback.

## 0.20.77 delivered scope

- Fixed a silent local-session degradation for factory-less consumers (bundled Workers are now actually used), added default-backend and channel loss-recovery coverage, and surfaced coordination-channel diagnostics plus the fallback toggle in the demo.

## 0.20.76 delivered scope

- Opt-in storage-event coordination fallback for BroadcastChannel-less environments, with an owner-election integration test over the fallback channel and updated degradation documentation and capabilities matrix.

## 0.20.75 delivered scope

- Hot-path performance gates joined the unit suite, and IndexedDB replay persistence gained scripted fault-injection coverage for its invalidate-and-recover error paths. The Release workflow's published-consumer verification was audited and confirmed complete.

## 0.20.74 delivered scope

- Optional `DataBusTransport.publishBatch` with a one-frame WebSocket implementation, demo-server support, and per-item fallback; `useCrossTabHealth` bindings for React and Vue; health verdict now honors the live transport status.

## 0.20.73 delivered scope

- IndexedDB replay persistence is now covered by unit tests (via `fake-indexeddb`) across pruning strategies, batch grouping, mutation serialization, cleanup semantics, and transient open-failure recovery.
- Real-browser E2E now covers concurrent multi-publisher bursts and full connection re-apply; the architecture docs gained a stability-invariants reference (English and Chinese).

## 0.20.72 delivered scope

- Expanded the benchmark matrix across publish batching, wildcard routing, deduplication, replay pruning, bulk persistence, and asynchronous trace sinks.
- Long-session stability hardening: regression coverage for handoff ACK generation validation, repeated BFCache round-trips, recovery exhaustion reset, storage write backoff recovery, and replay persistence cleanup races; fixed an inverted stale-ACK generation check and a batch-flush resurrection race in replay cleanup.
- Production capabilities: `getHealthSummary()` readiness verdict, `getPersistenceStats()`, transport status/suspended granularity in diagnostics, and a build-time injected SDK version.

## 0.20.71 delivered scope

- Added optional `appendBatch` replay persistence and IndexedDB transaction coalescing for publication bursts.

## 0.20.70 delivered scope

- Added SDK version and transport/backend identity to the unified diagnostics snapshot.

## 0.20.69 delivered scope

- Added peer protocol capability discovery to cluster snapshots and diagnostics. Current runtimes advertise protocol version 1; legacy peers remain visible as `null`.

## 0.20.67 delivered scope

- Added bounded unknown protocol message diagnostics on `WorkerClusterRuntime` and `CrossTabDataBus.getDiagnostics()`, including count and last message type while preserving safe ignore behavior.

## 0.20.66 delivered scope

- Extended IndexedDB replay persistence with optional `pruneStrategy` (`count`, `age`, `both`) and `retentionMs`, applying the same trimming semantics as in-memory replay.

## 0.20.65 delivered scope

- Added opt-in adaptive dedup TTL sampling with bounded min/max controls and diagnostics exposure. Added replay `pruneStrategy` (`count`, `age`, `both`) for memory history trimming while preserving legacy defaults.

## 0.20.64 delivered scope

- Added opt-in `asyncSink` trace mode, batching sink delivery onto a microtask while preserving event order and sink error isolation (339 unit tests).

## 0.20.63 delivered scope

- Added optional `onUnknownMessage` handling so older runtimes safely ignore future cluster message variants without throwing, with regression coverage (338 unit tests).

## 0.20.62 delivered scope

- Added `CrossTabDataBus.getDiagnostics()` combining lifecycle status, transport readiness, recovery history, dedup counters, replay buffer usage, and cluster snapshot into one health-oriented view (337 unit tests).

## 0.20.61 delivered scope

- Added `originTabId?: string` to every `DataBusMessage` and to the cluster `EVENT` wire frame so cross-tab replay history is attributed to the tab that produced it.
- `WorkerClusterRuntime.broadcastEvent()` now defaults `originTabId` to the producing runtime's `tabId`, and `CrossTabDataBus.handleTransportMessage` stamps `originTabId = cluster.tabId` before broadcasting so neighbors and IndexedDB-replayed late subscribers observe the same attribution.
- `onEvent` handler signature now includes a fourth `originTabId?: string` argument; existing call sites use `toMatchObject` so the extra argument does not break strict equality.
- New unit tests under `CrossTabDataBus cross-tab replay consistency contract` cover the producing-tab stamp, local-handler parity, post-write late join with replay, and local-origin replay path (336 unit tests, 11 e2e tests).

## 0.20.60 delivered scope

- Added `publishBatch(topic, items)` to `CrossTabDataBus` and `WorkerClusterRuntime` so callers can pack many items into a single BroadcastChannel postMessage. Per-item `messageId` / `timestamp` survive the wire frame, dedup / replay / ordering apply per item in source order. Empty batch is a no-op; single-item batch delegates to `publish()`. Bench case `publishBatch / 1000 messages / 10 per call` gives an upper-bound reference for the burst path (332 unit tests).

## 0.20.59 delivered scope

- Extended `CrossTabDataBus.getRecoveryStats()` with `generation` and `lastSuccessAt`, exposing the lifetime transport-open history for diagnostics.

## 0.20.58 delivered scope

- Bounded the publish route-owner cache with a configurable LRU cap (default 256) and surfaced size/max/hits/misses diagnostics on `WorkerClusterRuntime.getSnapshot()`.
- Fixed a remote-owner publish correctness bug where `wildcardPublishCache`'s `null` entry short-circuited the route-owner lookup; topics with no local wildcard subscription now correctly forward to the remote owner.
- Added unit tests for LRU eviction, TTL-based cache invalidation, owner migration, and remote-owner cache hits (319 → 321 unit tests).

## 0.20.57 delivered scope

- Added warm/cold route-cache publish benchmarks to make owner-routing performance measurable.

## 0.20.56 delivered scope

- Added generation-checked route-owner caching for publish routing and cleared it across lifecycle teardown.

## 0.20.55 delivered scope

- Added a lifecycle-safe wildcard publish decision cache; benchmark variance remains under investigation before claiming a throughput win.

## 0.20.53 delivered scope

- Extended recovery diagnostics with a safe serializable `errorMessage` summary.

## 0.20.52 delivered scope

- Extended `getRecoveryStats()` with `hasError`, making the currently retained transport error observable.

## 0.20.51 delivered scope

- Added a public recovery-state snapshot API via `getRecoveryStats()`.

- Added owner-handoff unsubscribe coverage proving a handed-off route is not recreated after the surviving tab unsubscribes.

- Added unsubscribe-before-reconnect coverage proving removed topics are not replayed after lifecycle recovery.

- Added multi-topic recovery coverage proving every topic is restored exactly once after reconnect.

- Added extended reconnect flapping coverage proving replay stays bounded and duplicate-free.

- Added repeated worker capability-probe coverage proving auto backend selection remains deterministic across repeated checks.

## 0.20.45 delivered scope

- Added repeated WebSocket error/restart coverage proving only the newest connection remains active.

## 0.20.44 delivered scope

- Added a lifecycle contract regression proving stale WebSocket close/error callbacks cannot affect a restarted session.

## 0.20.43 delivered scope

- Added repeated WebSocket stop/start cleanup coverage proving subscriptions and stale callbacks are cleared across lifecycle cycles.

## 0.20.42 delivered scope

- Added repeated Dedicated Worker stop/start cleanup coverage proving STOP boundaries detach stale worker delivery across lifecycle cycles.

## 0.20.41 delivered scope

- Added repeated SharedWorker stop/start resource-soak coverage proving listeners and heartbeat timers are released after every cycle.

## 0.20.40 delivered scope

- Added auto worker-mode repeated failure and recovery coverage verifying SharedWorker preference remains stable and stale ports cannot deliver publications after successive reopen cycles.

## 0.20.39 delivered scope

- Added repeated Dedicated Worker failure and recovery coverage verifying only the newest worker can deliver publications.

## 0.20.38 delivered scope

- Added repeated SharedWorker failure and recovery coverage verifying only the newest worker port can deliver publications.

## 0.20.37 delivered scope

- Added repeated WebSocket stop/start replacement coverage verifying stale callbacks from multiple superseded sockets are ignored.

## 0.20.36 delivered scope

- Added a 1,000-message publish burst regression covering ordering and storage-read avoidance on the local-owner fast path.

## 0.20.35 delivered scope

- Added publish and receive/dispatch hot-path benchmarks to establish repeatable throughput baselines alongside routing and cluster coordination measurements.

## 0.20.34 delivered scope

- Added a transport-recovery composition regression covering automatic reopen/resubscription, replay history, duplicate suppression, persistence append boundaries, and late-handler ordering.

## 0.20.33 delivered scope

- Added a tag-based release compatibility check for public exports, ESM/CJS conditions, and type metadata.

## 0.20.32 delivered scope

- Added replay/dedup combined coverage for hydration, post-recovery live delivery, duplicate suppression, persistence append boundaries, and late-handler ordering.

## 0.20.31 delivered scope

- WebSocket lifecycle and message callbacks are isolated by socket identity after replacement.
- Added stale-connection regression coverage for transport stop/start recovery.

## 0.20.30 delivered scope

- Extended IndexedDB replay persistence E2E across BFCache, stop, reload, asynchronous hydration, ordered history, and replay markers.

## 0.20.29 delivered scope

- Added exhaustive Dedicated/Shared/auto worker backend fallback coverage across all capability combinations.

## 0.20.28 delivered scope

- Expanded packed-consumer verification into a release compatibility matrix for package metadata, ESM/CJS export targets, declaration files, and all public subpaths.

## 0.20.27 delivered scope

- Added a real Chromium repeated BFCache/reload/owner-handoff soak that verifies reconnect readiness and exactly-once cross-tab delivery across consecutive lifecycle cycles.

## 0.20.26 delivered scope

- Added trace privacy, mode-isolation, sink-failure, reliability-schema, bounded-state, and lifecycle metrics-window regression coverage.
- Stopped trace reporters now remain inert until explicitly started again.

## 0.20.25 delivered scope

- Added protocol compatibility coverage for legacy and nested WebSocket/Centrifuge publication frames, unknown fields, invalid metadata, and unknown worker messages.

## 0.20.24 delivered scope

- Added a combined replay/dedup quiet-period regression covering TTL expiry, periodic sweeps, durable retention cleanup, async hydration, and timer shutdown.

## 0.20.23 delivered scope

- Added a two-tab BFCache and transport-error handoff regression covering owner takeover, resume, and duplicate-free delivery.

## 0.20.22 delivered scope

- Explicit stop/restart boundaries reset recovery attempt and exhaustion diagnostics for a fresh session.

## 0.20.21 delivered scope

- Recovery exhaustion diagnostics are deduplicated within each failure sequence and reset after success.

## 0.20.20 delivered scope

- Capped automatic recovery now emits an explicit `exhausted` diagnostic when the configured attempt limit is reached.

## 0.20.19 delivered scope

- Automatic recovery attempts can be bounded with `recovery.maxAttempts`; explicit subscription demand can still reopen a failed transport.
- Invalid attempt limits and capped recovery sequences are covered by tests.

## 0.20.18 delivered scope

- Automatic transport recovery pacing is configurable through `recovery.cooldownMs`.
- Custom cooldown validation and timer-boundary regression coverage are included.

## 0.20.17 delivered scope

- Recovery diagnostics now number consecutive reopen attempts and reset the sequence after success.
- Added multi-failure recovery regression coverage.

## 0.20.16 delivered scope

- Transport recovery reliability traces now distinguish scheduled, failed, and successful reopen attempts.
- Recovery regression coverage now spans a failed reopen followed by a successful retry.

## 0.20.15 delivered scope

- Added transport status-flapping coverage for duplicate `connected`/`disconnected`/`error` notifications and exact topic resubscription behavior.

## 0.20.14 delivered scope

- Release jobs keep publishing successful when only the post-publish consumer diagnostic fails, while preserving the exact check outcome in the step summary; local checks remain strict.

## 0.20.13 delivered scope

- Browser CI failures now retain Playwright reports and test results as workflow artifacts for post-run diagnosis.

## 0.20.12 delivered scope

- Published-consumer verification now emits package and peer-dependency link diagnostics when CI imports fail, making runner-only failures actionable.

## 0.20.11 delivered scope

- Release jobs are serialized per tag and always record npm version, tag, and commit context in the GitHub step summary, making registry or workflow failures easier to diagnose.

## 0.20.10 delivered scope

- Added repeated reconnect-cycle coverage for multi-topic subscription replay, guarding against duplicate or missing transport subscriptions during recovery.

## 0.20.9 delivered scope

- Published-package verification accepts both semver and `v`-prefixed tag inputs, keeping release-triggered checks aligned with local commands.

## 0.20.8 delivered scope

- Release verification retries npm tarball resolution during registry propagation and validates the exact tagged version after publish or skip.
- GitHub Release now runs the same ESM/CJS published-consumer check used locally, including manually published releases.

## 0.20.7 delivered scope

- Added `pnpm verify:published` to download the npm package and verify root, hooks, Vue, and Centrifuge ESM/CJS consumers in a clean temporary directory.
- Published verification accepts `PUBLISHED_VERSION` for release-specific checks and otherwise follows npm's current version.

## 0.20.6 delivered scope

- Added bilingual release checklists covering local validation, packed consumers, tagging, manual npm publication, and post-release verification.
- Documented immutable npm history and the requirement to rebuild missing historical versions from their exact git tags.

## 0.20.5 delivered scope

- Public-consumer freeze coverage now exercises root, hooks, Vue, and Centrifuge subpaths in both ESM and CommonJS builds.
- Shipped declaration files are checked for existence and key replay, deduplication, and publication metadata types.

## 0.20.4 delivered scope

- Added a real Chromium multi-tab soak scenario covering repeated fan-out, owner migration, BFCache round trips, reload recovery, and duplicate-free delivery.
- Browser lifecycle transitions are now exercised as one continuous session, catching timer and route cleanup regressions that isolated checks can miss.

## 0.20.3 delivered scope

- Added React lifecycle coverage for dynamic topic changes.
- Topic replacement verifies old subscriptions are removed before the new topic is delivered through WebSocket hook wiring.

## 0.20.2 delivered scope

- Added protocol recovery coverage proving valid WebSocket publications continue after malformed binary and text frames.
- Binary truncation, JSON parse failures, nested envelopes, and error isolation are exercised as one compatibility sequence.

## 0.20.1 delivered scope

- Added persistence mutation-sequence soak coverage spanning hydration, retry recovery, topic cleanup, subsequent append, and full cleanup.
- Serialized persistence operations remain usable after transient failures.

## 0.20.0 delivered scope

- Publication envelope compatibility is covered for legacy, nested, fallback-topic, primitive payload, metadata, and unknown-field frames.
- Empty or missing topics are rejected consistently while transport-supplied fallback channels remain supported.

## 0.19.9 delivered scope

- Added combined deduplication and replay/persistence regression coverage.
- Dedup-suppressed publications cannot pollute replay history, while TTL expiry permits the same message ID to be accepted again.

## 0.19.8 delivered scope

- IndexedDB replay adapters invalidate cached connections after transaction or request failures.
- Closed connections can recover through the existing persistence retry path without recreating the adapter.

## 0.19.7 delivered scope

- IndexedDB replay adapters discard rejected open promises so transient open failures can recover on the next operation.
- Recovery remains compatible with the existing cross-tab `versionchange` connection reset behavior.

## 0.19.6 delivered scope

- IndexedDB replay adapters recover from cross-tab `versionchange` events by reopening on the next operation.
- Stale database connections are closed instead of being reused after schema changes.

## 0.19.5 delivered scope

- React bus effects are generation-guarded across StrictMode and rapid dependency changes.
- Superseded asynchronous cleanup cannot overwrite the newest active bus.

## 0.19.4 delivered scope

- Vue bus recreation is generation-guarded across rapid reactive dependency changes.
- Stale asynchronous lifecycle completions cannot resurrect an obsolete bus instance.

## 0.19.3 delivered scope

- Added optional `dedup.sweepMs` to remove expired message IDs during quiet periods.
- Sweep timers follow DataBus lifecycle and remain disabled by default.

## 0.19.2 delivered scope

- Persistence retries are cancelled across `stop()` and pagehide suspension transitions.
- Cancelled retry waits do not trigger another adapter call or surface as persistence failures.

## 0.19.1 delivered scope

- WebSocket binary publication handling accepts browser `Blob` frames in addition to `ArrayBuffer` frames.
- Blob conversion failures remain isolated through the transport error callback.

## 0.19.0 delivered scope

- Persistence retries emit bounded, opt-in `persistence_retry` reliability events with the operation and attempt number.
- Diagnostics cover hydration, append, full/topic cleanup, and retention cleanup without exposing payloads or error bodies.
- Existing retry timing, default single-attempt behavior, adapter contracts, and final error handling remain compatible.

## 0.18.0 delivered scope

- Opt-in replay persistence retry policy with bounded attempts and exponential backoff.
- Append, hydration, manual cleanup, topic cleanup, and retention cleanup share one recovery path.
- Public retry option type is exported while persistence adapter contracts remain source-compatible.

## 0.17.0 delivered scope

- Optional periodic replay retention sweeps run without requiring a new publication.
- Sweep timers follow start/resume and pagehide/stop lifecycle boundaries.
- Fake-timer coverage protects cleanup scheduling, teardown, and invalid configuration behavior.

## 0.16.0 delivered scope

- Retention cleanup is coalesced during publication bursts and executes serialized mutations using the newest requested cutoff.
- WebSocket binary protocol boundaries now have regression coverage for truncated and invalid frames.
- Existing legacy replay, JSON metadata, and manual cleanup compatibility guarantees remain documented.

## 0.15.0 delivered scope

- Replay retention preserves legacy timestamp-less messages while pruning only explicitly timestamped records older than the cutoff.
- Trace timestamps accept an injectable `trace.now` clock, aligned with the existing dedup clock injection.
- Compatibility and lifecycle regression coverage protects replay cleanup, diagnostics, and adapter behavior.

## 0.14.0 delivered scope

- Vue subscription parity for reactive topic changes on a stable bus.
- Cross-page replay mutation ordering and lifecycle guarantees are documented and regression-tested.

## 0.13.0 delivered scope

- IndexedDB replay mutation serialization prevents concurrent append loss.
- Dedup state is reset on full stop/restart boundaries.
- Persistence failure and lifecycle regression coverage is included.

## 0.12.0 delivered scope

- Injectable deduplication TTL clock for deterministic lifecycle and expiry tests.
- Structured persistence cleanup diagnostics for append, hydration, unsubscribe, and retention failures.
- Strict-but-compatible publication metadata normalization (non-empty IDs and finite timestamps only).
- Protocol compatibility fixtures and expanded package-consumption coverage.

## 0.11.0 delivered scope

- Automatic durable replay retention through `replay.retentionMs` when the persistence adapter supports `clearBefore`.
- Deduplication accepted/suppressed counters in periodic trace metrics.
- Publication metadata compatibility coverage across WebSocket, Centrifuge, Worker boundaries, and browser E2E.
- Service Worker transport decision: remain deliberately unimplemented until a stable connection-lifetime contract exists across target browsers.

## 0.20.68 delivered scope

- Added protocol version metadata and compatibility behavior for mixed-version cluster peers.

## 0.20.69 candidates

1. ~~Publish a peer capability matrix and expose SDK/backend/transport identity in diagnostics.~~ Delivered: `getDiagnostics()` carries protocol version, unknown-message stats, peer protocol versions, and transport identity; `getHealthSummary()`/`getMetrics()` now ship live trace metrics and sink state.
2. ~~Unify replay, deduplication, trace, recovery, and cluster health counters.~~ Delivered: `getDiagnostics()` + `getMetrics()` + `getHealthSummary()` cover lifecycle, recovery, dedup, replay, persistence, protocol, transport, cluster, trace metrics, and sink back-pressure in single snapshots.
3. ~~Optimize IndexedDB concurrent append and cleanup paths.~~ Delivered: adjacent `appendBatch` mutations coalesce into one transaction; clear/clearTopic/clearBefore ordering preserved.
4. ~~Add performance baselines for adaptive dedup, async trace, pruning, and long-running multi-tab workloads.~~ Partially delivered: bench covers load-weighting scoring, `getMetrics`, publishBatch batch-size sensitivity, and the existing dedup/async-sink/persistence cases.

## 0.13.0 candidates

1. Freeze the public export surface and transport-neutral publication envelope.
2. ~~Document at-least-once delivery and deduplication guarantees precisely.~~ Delivered: architecture/API/capability docs now distinguish at-most-once local fan-out per accepted transport publication from end-to-end delivery, document transport/server loss and redelivery, and describe bounded opt-in `messageId` dedup without claiming at-least-once or exactly-once.
3. Add long-running browser soak coverage for replay retention, reconnect, BFCache, and owner migration.
4. Publish a migration guide and deprecation policy for any pre-1.0 protocol aliases.

## Longer-term candidates

1. **Replay lifecycle and retention** — add explicit persistence cleanup (`clear`, `clearTopic`), make unsubscribe/replacement remove stale history, and surface persistence failures through trace and error handlers.
2. **Reliability diagnostics** — emit structured recovery/retry, owner-acknowledgment, and route-migration events with bounded metadata while keeping tracing opt-in.
3. **Publication deduplication** — design and implement an opt-in, bounded message-ID window that works across local dispatch, BroadcastChannel fan-out, WebSocket, and replay without changing the default behavior.
4. **Adapter and protocol parity** — align React/Vue lifecycle and type contracts, document binary framing and recovery semantics, and add compatibility fixtures for custom transports.
5. **Operational validation** — extend browser and package-consumption tests, add regression benchmarks for dedup/recovery/replay cleanup, and keep push CI as a release gate.

## Release checklist

- Update the `[Unreleased]` section and version date.
- Run `pnpm check`, `pnpm lint`, `pnpm test:e2e`, `pnpm bench`, and `pnpm bench:browser`.
- Run ESM/CJS package-consumption smoke tests from the packed tarball.
- Tag the release and verify the GitHub Release and npm `latest` dist-tag.
