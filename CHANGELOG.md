## [Unreleased]

### Fixed
- The compatibility gate now rejects disabled public exports, removed worker default conditions, and conditional exports replaced with untyped strings or null type targets, including package-level `types`/`typesVersions` metadata.

## [0.20.92] - 2026-09-18

### Fixed
- Release automation now rejects mismatched tag/package versions and missing, duplicate or empty release notes before creating a release or publishing. Release guidance uses feature-branch PRs and immutable version tags.
- A rejected transport `stop()` is now retained consistently in both failure ledgers. `stop()` still resolves after reporting through `onError`, but `getRecoveryStats()` no longer reports `hasError: false` while `getHealthSummary().lastFailure` still describes the same stop failure; an explicit `start()` remains the boundary that clears both.
- Operations parked behind the recovery gate now remain queued when an explicit `start()` supersedes the automatic recovery timer. If that manual open also fails, the operations stay behind the still-closed gate and flush after the next successful automatic or demand-driven reopen instead of being silently dropped with the superseded opening.
- A transport operation parked behind the recovery gate is now invalidated when `stop()` / page-hide supersedes the recovery cycle. An immediate explicit `start()` can re-establish subscriptions on the replacement transport, but the stale waiter no longer replays its operation afterward, preventing a duplicate subscription from racing the restarted cluster.
- A delayed or replayed `CONTROL/SUBSCRIBE` can no longer make a worker subscribe when the durable route does not currently name it, and it can no longer confirm a pending graceful handoff before the matching `ROUTE_RELEASED`. Ownership now follows the route record instead of control-frame arrival order, preventing transient double subscriptions when an earlier assignment round is overtaken by a newer one.
- A restart queued behind an asynchronous `stop()` now stays suspended when `pagehide` lands during the stop cleanup. `WorkerClusterRuntime.start()` installs its lifecycle listeners before checking document visibility, so a hidden document waits for `pageshow` instead of opening a fresh transport in the background.
- `ROUTE_RELEASED` handoff acknowledgements are now accepted only when their route generation exactly matches the stored route. A delayed or replayed ACK carrying a newer generation could previously confirm a different handoff and release the new owner's `SUBSCRIBE` before the matching release arrived.
- Durable replay history loaded asynchronously can no longer overtake or evict publications recorded while `load()` is still pending. Hydration now places the durable snapshot ahead of that live tail before applying the retention/count policy, so a bounded ring keeps the newest messages instead of treating them as older history.
- Replay hydration now belongs to a replaceable lifecycle instead of one immutable constructor promise. A `clearAll()`, `clearTopic()`, topic unsubscribe, or `clearBefore()` issued while durable `load()` is pending is applied to the loaded snapshot, so cleared history cannot reappear. A load superseded by suspend/restart is cancelled without clobbering the replacement, and an explicit stop/start now performs a fresh hydration instead of leaving the restarted rings empty.
- A `start()` issued synchronously from the `DISCONNECTED` status callback during `pagehide` can no longer be undone by the stale hide continuation. `suspendTransport()` now abandons its stop chain when the status callback has already installed a newer lifecycle, so the replacement transport stays open and the health snapshot remains truthful instead of reporting `healthy` while the transport has been stopped again.
- Operations issued while a replacement transport is opening can no longer reach the closed connection. `reopenTransport()` now clears `transportReady` before its synchronous `CONNECTING` notification, so a second `publish()` / `subscribe()` in the same tick parks behind the opening gate instead of bypassing it. This also preserves operation order: the replacement receives the earlier parked operation before the later one.
- Replay retention cleanup queued after a suspend/resume cycle is no longer dropped when an older cleanup transaction is still unwinding. The old pass now hands a non-null queued cutoff to a fresh cleanup before releasing the in-flight slot, so the newest cutoff runs instead of waiting for an unrelated future publication.
- A transport operation that was already parked behind the recovery gate when an automatic recovery attempt failed is no longer stranded until an unrelated later operation arrives. `runTransport()` now counts the operations parked on the gate, and a failed automatic attempt immediately starts one on-demand reopen when any waiter is present, so an already-issued `publish()` / `subscribe()` itself drives recovery instead of waiting for a future operation that may never come. A failed on-demand reopen still re-arms the demand flag for a later operation rather than looping on its own failure, and every waiter is released in order once a reopen succeeds.
- A re-entrant `stop()` from the synchronous RESUME lifecycle trace event now cancels the rest of both an explicit `start()` resume and a native `pageshow` resume. Resume timers are only restarted when the callback still owns the lifecycle, and `WorkerClusterRuntime` now uses a lifecycle generation so its outer `pageshow` handler cannot reactivate a cluster already stopped or paused by `onResume`. Previously the callback's stop could settle first while the outer resume continued and left the bus reported as stopped with an active cluster.
- A re-entrant `stop()` from the synchronous CONNECTING status callback emitted during `reopenTransport()` now cancels that reopen instead of allowing it to install and start a new transport after teardown. The recovery lifecycle epoch and start promise are now installed before the status callback runs, so the stop gate observes the opening, its epoch guard abandons it, and health remains consistently stopped. Previously the callback's stop settled first while `reopenTransport()` continued and left `started: false` with a live connected transport.
- A re-entrant `stop()` from the synchronous START lifecycle trace event now supersedes the outer `start()` before it can open the transport. Lifecycle ownership and the shared start promise are installed before the trace event, and `start()` aborts the remaining timer/cluster setup if a callback stops or suspends the new lifecycle. Previously the stop settled while the outer start continued into `transport.start()`, leaving health reported as `stopped` with a live `connected` transport.
- `stop()` is now re-entrancy safe against a synchronous trace sink. The shared in-flight stop gate is installed before the teardown prelude runs, so a `stop()` re-entered from the synchronous STOP lifecycle trace event shares the single teardown instead of starting a second one. Previously the nested call ran before `stopPromise` was assigned and invoked `transport.stop()` a second time. The teardown still takes effect in the same tick, concurrent and repeated `stop()` calls keep returning the same promise, and a rejecting transport stop still resolves `stop()` through `onError`.

### Tests
- A parked-recovery cancellation regression covers page-hide followed by an immediate explicit `start()`: the replacement connection receives exactly one subscription for each assigned topic, and the stale recovery waiter cannot replay after that restart.
- A route-generation guard regression proves a `ROUTE_RELEASED` carrying a newer generation than the current handoff cannot enter `assignedTopics`, trigger `SUBSCRIBE`, or stamp `confirmedAt`.
- A delayed durable `load()` now has a direct replay ordering regression: a publication recorded while hydration is pending must remain newer than the loaded snapshot and survive a one-entry count cap.
- Hydration lifecycle regressions now cover `clearAll()`, `clearTopic()`, topic unsubscribe, and `clearBefore()` racing a pending load, plus explicit stop/start and immediate suspend/start re-entry. The replacement load must win, stale results must stay out of the rings, and durable history must be restored after an explicit restart.
- The documented storage and BroadcastChannel isolation boundary between different `clusterKey` values is now pinned by a two-runtime regression. It proves each tenant can independently own the same topic, publications do not cross, and persisted keys are namespaced under distinct opaque hashes without exposing the plaintext cluster identifier.

## [0.20.91] - 2026-09-16

### Fixed
- A malformed cross-tab `EVENT` frame can no longer break publication delivery. Publication payloads that are not objects with a string `topic`, and frames carrying an unknown `eventType`, are now ignored at the DataBus boundary; later valid events continue to dispatch. Legacy payloads without `originTabId` still inherit the frame-level attribution, while an explicit payload value takes precedence.
- `WebSocketTransport` now best-effort closes a socket after a connection error invalidates it. Automatic recovery can no longer leave a dead connection open when the socket implementation does not follow an `error` event with `close`.
- Centrifuge token-bridge callbacks are bound to the client lifecycle that created them. A credential request from a replaced client can no longer be routed into the replacement session or satisfy a fresh request with a stale token.
- `WorkerClusterRuntime.pause()` no longer schedules a deferred channel close when no channel exists, removing a stray timer left behind by an explicit `stop()`.

### Changed
- The browser benchmark trend documentation was refreshed from 24 archived reports. The release-gate comparison found no metric regression above the 50% ceiling; publish latency improved in both worker modes.

## [0.20.90] - 2026-09-16

### Fixed
- The `Release` workflow's blocking published-consumer gate no longer fails on ordinary npm CDN propagation lag. The 0.20.89 tag run published successfully and then still failed the gate because `npm pack cross-tab-worker-databus@0.20.89` kept returning `ETARGET` for the whole 24 x 5 s (2 min) budget; the budget is now 48 x 7.5 s (6 min). A genuinely missing or unimportable published package still exhausts the budget and fails the gate.
- The coverage gate no longer false-fails when V8 instrumentation pushes the 1,500-seed lifecycle fuzzer past Vitest's 5-second default. The fuzzer keeps every seed and now carries an explicit 30-second test budget.

### Changed
- Delivery semantics are now documented consistently: one accepted transport publication is fanned out once and dispatches at most once per matching local handler, but transport/server redelivery or loss and the bounded per-bus opt-in `messageId` dedup window still mean the SDK does not provide end-to-end at-least-once or exactly-once delivery. The architecture docs no longer claim exactly-once dispatch per subscriber, and the Chinese API reference now includes the deduplication boundary already documented in English.
- The browser benchmark trend docs were refreshed through the latest two-run release gate (23 archived reports). The final comparison found no metric regression above the 50% ceiling; full round-trip publish latency improved in both worker modes.

## [0.20.89] - 2026-09-16

### Fixed
- `getHealthSummary()` no longer reports `healthy` while an explicit `stop()` is still tearing down. The transport can keep reporting `connected` until its asynchronous `stop()` settles, so the verdict previously contradicted the stopping bus's own behavior: `publish()`/`subscribe()` were already routed through `onError`, and `ready()` already rejected. An in-flight stop is now surfaced as `state: 'stopped'` with `healthy: false`, matching the other lifecycle APIs; a restart queued behind that stop is reported as `starting` once it owns the lifecycle.
- A settled `stop()` gate can no longer swallow a subsequent teardown. `stop()` reused `stopPromise` whenever it was non-null, but that field is cleared in a microtask *after* `performStop()` has already finished and flipped `stopping` back to false. A `start()`/`stop()` issued inside that window therefore received the old settled promise, skipped teardown, and left the restarted bus running while `stop()` resolved. The in-flight gate is now reused only while `stopping` is true, so a stale gate falls through to a fresh stop.
- Replay batch flushes that are still queued in a microtask are now discarded when the bus suspends or stops. The queued callback previously started its persistence retry only after the lifecycle generation had already advanced, so it inherited the new session and could append stopped-session history to the durable store.
- A replay retention cleanup that is already in flight when the bus suspends or stops can no longer drain a newer cutoff queued behind it. The coalesced cleanup loop now captures the persistence lifecycle generation, the lifecycle transition clears its queued cutoff, and late failures from the superseded session are dropped instead of reaching the public persistence error ledger.
- Replay hydration results are now bound to the lifecycle generation that issued the load. A durable `load()` that resolves after `suspend()` or `stop()` can no longer append messages into buffers that teardown has already cleared; the stale operation is reported as a lifecycle cancellation and is filtered from the public error ledger.
- A stopped trace reporter now remains inert until `start()` explicitly begins a new session. Queued `asyncSink` events from the old session are discarded instead of flushing after teardown, metrics and ordinary events are ignored while stopped, and the stopped flag is cleared even for event-only mode so an explicit restart emits its new lifecycle `start` again.
- Centrifuge credential-provider results are now bound to the exact Worker, port, or local session that issued the request. A pending async token from a stopped backend could previously resolve after `stop()` / `start()` and satisfy the replacement session because request IDs restart at 1; late tokens and rejections are now dropped, while a provider that throws synchronously is converted into `TOKEN_ERROR` instead of escaping the worker-message handler.
- Async callbacks from a stopped in-process `CentrifugeSession` can no longer leak into the session created by a later `INIT`. Client lifecycle/publication/error events, subscription callbacks, and rejected local-fallback publishes now capture a lifecycle generation and are ignored once `STOP` or reinitialization supersedes their connection, preventing stale status, publications, or errors from reaching the replacement session.
- A WebSocket binary frame delivered as a `Blob` can no longer leak into a replacement connection after a `stop()` / `start()` cycle. `Blob.arrayBuffer()` is asynchronous, so a frame received by the old socket could finish converting after the new handlers were installed and be dispatched as if it belonged to the new connection. The transport now captures the socket/handler pair before conversion and drops the frame or its conversion error when either has been replaced or the socket is no longer active.

## [0.20.88] - 2026-09-16

### Fixed
- A transport that reports `error` synchronously during startup now lets `start()` retry from either the startup-failure `onStatus` callback or the startup-failure `onError` callback. The internal status is updated immediately, but the user-facing `onStatus('error')` notification is deferred until the failed open has cleared `transportReady`, torn down the initial cluster, installed the transport stop gate, recorded the failure, and cleared `startPromise`. The retry therefore opens a fresh lifecycle after cleanup and resets the failure ledger; the superseded opening's rejection is consumed by that lifecycle path and cannot repopulate the ledger after the retry succeeds.
- A synchronous `start()` retry issued from the startup-failure `onError` callback now opens a fresh lifecycle instead of returning the same rejecting open. `openTransport()` previously notified error handlers before clearing `startPromise`, so the retry shared the failed promise and never called `transport.start()` again. The failed open is now fully torn down and its lifecycle gate cleared before failure notification, and the retry is chained after the failed transport's stop cleanup.
- A bus whose initial transport open is still pending now recovers from repeated BFCache `pagehide`/`pageshow` cycles. Each suspend used to return early whenever a `pendingStop` gate existed, but a queued resume opening could already sit behind an older stop gate, so `startPromise` and `pendingStop` stopped being the same promise; the next `pageshow` then reused that superseded opening and the bus stayed suspended forever. `suspendTransport()` now reuses the gate only when it still represents this suspend, and otherwise chains a fresh serial `transport.stop()` that restores the `startPromise === pendingStop` invariant, so the following reopen actually restarts the transport.
- An explicit `start()` that resumes a BFCache-suspended bus now also resumes cross-tab coordination. `pagehide` pauses the bus *and* the `WorkerClusterRuntime` (closing the channel, stopping the heartbeat, releasing route assignments), but the started `start()` fast path only cleared `suspended` and reopened the transport, leaving `cluster.suspended` true. The bus then reported a healthy transport while every publication arriving from a peer tab was discarded by `isAssigned()` against the cleared assignment map, until a later `pageshow` happened to fire. `start()` now resumes the cluster whenever it is taking the bus out of suspension, so an explicit resume restores the full coordination plane.
- An explicit `start()` that resumes a BFCache-suspended bus now restarts every resource paused by `pagehide`, not only the transport and cluster. Trace metrics, the dedup expiry sweep, and replay retention cleanup were stopped by `onSuspend()`, while the native `pageshow` path restarted them through `onResume()`; the explicit resume bypassed that callback and could leave all three timers permanently off for the rest of a `healthy` session. Both resume paths now share one lifecycle helper.

## [0.20.87] - 2026-09-16

### Fixed
- Transport operations issued after a runtime `error` no longer reach the connection that just failed. While an automatic or demand-driven reopen is pending, `runTransport()` parks `subscribe()` / `publish()` behind a recovery gate and releases them only after a reopen succeeds (or the transport self-heals to `connected`). `transportReady` deliberately stays true through the error so `ready()` keeps tracking the installed transport, which meant a subscribe or publish inside the cooldown window was written to the dead connection and lost. A failed automatic attempt keeps the gate closed but now lets the next explicit operation start an immediate on-demand reopen instead of waiting out another cooldown, and parked operations flush behind that success; exhausting `recovery.maxAttempts`, or superseding the wait with `stop()` / page hide, releases the gate so the explicit-retry path and the documented suspend-drop semantics are unchanged. A clean `disconnected` still never schedules automatic recovery.
- An operation issued after a clean transport `disconnected` now reopens the transport on demand instead of being written to the closed connection. `runTransport()` previously exempted only `error`, so a `subscribe()` / `publish()` arriving after a clean `close` took the ready fast path and the backend dropped it (the WebSocket send guard reports dropped frames but never sends them). The fast path is now refused once the transport has actually reached `connected` and then reports `disconnected`: the clean close still schedules no background recovery, but the next explicit operation demands exactly one reopen and flushes the parked operation behind it. A transport that resolves `start()` before its first `connected` (worker-style backends report the connection asynchronously) keeps the previous behaviour, so the pre-connect window does not trigger a redundant reopen.
- `createWebSocketDataBus()` automatic recovery now actually reopens a failed WebSocket. `WebSocketTransport.start()` previously returned whenever `this.socket` was non-null, and an error/close left that reference in place, so every post-cooldown `reopenTransport()` was a no-op against the dead socket. The transport now tracks whether the current socket is active, replaces the stale connection on the next `start()`, re-sends subscriptions after the replacement opens, and ignores late callbacks from the superseded socket. An error followed by close also keeps the `error` status that schedules recovery.
- React and Vue `useCrossTabHealth` bindings now apply `intervalMs` changes without recreating the bus. React previously ignored an option change unless the bus identity changed, and the Vue composable ignored changes to a reactive options object; switching to `0` therefore left polling active, while changing a positive cadence kept the old timer. Both adapters now tear down the old listener/timer set and install the new cadence.
- `stop()` now resolves once the bus is torn down even when the transport's own `stop()` rejects or throws. The failure is routed through the same `onError` / unified `lastFailure` channel that page-hide suspension and open-failure cleanup already use, so the fire-and-forget `void bus.stop()` teardown in the React and Vue adapters can no longer surface as an unhandled rejection. The instance stays restartable either way.
- A failed transport open is now stamped once: `getRecoveryStats().errorAt` and the `lastFailure.at` of the same failure are equal instead of differing by a clock re-read. The open-failure path called the injected clock twice for one failure, so a consumer correlating the two ledgers (or a test using an advancing clock) saw two timestamps for one event. The open-failure path also clears `transportReady` before notifying status/error handlers, keeping the "transport is not accepting operations" verdict local to the failure block.
- `ready()` no longer reports a BFCache-suspended bus as ready. After `pagehide`, `suspendTransport()` chains `transport.stop()` and reuses `startPromise` as the stop gate; `ready()` previously returned that gate, so it resolved the moment cleanup finished even though the transport was intentionally stopped and publications were dropped. Readiness now rejects with a clear suspended-state error while hidden; `pageshow` (or an explicit `start()`) clears the flag and installs a real reopen promise, after which `ready()` resolves as before. This restores the documented invariant that `ready()` never resolves for a transport that cannot carry data.
- A runtime transport failure reported through `onError` now lands in the transport recovery ledger, not only in the unified `lastFailure` record. `getRecoveryStats().hasError` / `errorMessage` / `errorAt` were written exclusively by the transport-*open* failure path, so a failure raised after a successful open produced a self-contradicting health snapshot: `state: 'recovering'` and a retained `lastFailure` alongside `recovery.hasError: false, errorMessage: null`. The recovery ledger now tracks every transport-sourced failure (open or runtime) and still keeps non-transport failures (`persistence`, `dispatch`) out of it, where they remain visible through `lastFailure` and `getPersistenceStats()`.
- The native WebSocket backend now honors the `DataBusTransport.start()` contract: it resolves only after the socket `open` and rejects when the handshake errors, closes before opening, or exceeds the new `connectTimeoutMs` (default 30s). Previously `start()` returned while the socket was still `CONNECTING`, so `await bus.ready()` resolved before the connection was usable and an immediately following `publish()` was dropped by the not-open guard. A timed-out attempt now closes its half-open socket and ignores a late `open`; an in-place re-open after a successful handshake still re-asserts subscriptions.
- `getHealthSummary()` now treats a live `connected` transport as healthy even during the brief window before `start()` settles and `transportReady` flips to true. With a handshake-gated WebSocket start, the `connected` status event fires while `transportReady` is still false, so an event-driven `useCrossTabHealth` snapshot with `intervalMs: 0` could remain stuck in `starting`/`recovering`. `transportReady` remains a diagnostic field; operations are queued behind the in-flight start rather than dropped.


## [0.20.86] - 2026-09-16

### Added
- The configuration reference now documents the full public option surface: `replay.pruneStrategy` (previously absent entirely) and the replay options table (`maxPerTopic`, `persistence`, `retentionMs`, `pruneStrategy`, `retentionSweepMs`, `persistenceRetry`), plus a deduplication options table (`maxEntries`, `ttlMs`, `sweepMs`, `now`, `adaptiveTtl`) — in both languages. A guard derives the field list from the built declarations and fails when a `DataBusReplayOptions`/`DataBusDedupOptions` field is undocumented in either configuration reference. The `pruneStrategy` JSDoc no longer claims a default of `'both'` (the actual default is `'count'`).
- Property invariants for `selectActiveWorkers` / `selectRebalanceTarget`: the returned worker set is always a subset of the input, active selection stays within `maxActiveWorkers` and non-empty for a non-empty input, and neither helper throws on arbitrary corrupt worker records.

### Fixed
- `ready()` no longer reports readiness for a restart that a later `stop()` canceled. The queued `start()` promise retains its documented resolve-on-cancellation behavior, but readiness now rejects with a clear lifecycle error instead of resolving against a stopped bus.
- A failed restart queued behind an in-flight `stop()` now remains observable through `ready()`. Previously the failure cleared `started`, so a later `ready()` without `initialConfig` was masked by the generic "requires initialConfig" error; it now resurfaces the actual transport startup failure and preserves the explicit manual-retry path.
- `publish()` and non-empty `publishBatch()` calls issued while `stop()` is in flight now report through `onError` instead of silently returning once `runTransport()` refuses to touch the stopping transport. Empty batches remain no-ops, publications already queued behind an in-flight open are still canceled by the stop (latest lifecycle intent wins), and page-hide suspension keeps its documented drop-without-defer behavior.
- `subscribe()` and `ready()` now honor the explicit-stop barrier. A subscription requested while `stop()` is settling reports through `onError` and returns a no-op cleanup instead of being erased by teardown or leaking into a later restart; `ready()` rejects rather than resolving against the stopping transport. A `start()` already queued behind that stop remains the newest lifecycle intent, so `ready()` continues to follow its restart promise.
- A `stop()` that arrives before a restart queued behind an earlier in-flight `stop()` could run now cancels that queued restart instead of being swallowed by the in-flight stop gate. The queued continuation is invalidated with a monotonic token, so the latest lifecycle intent always wins: `stop → start → stop` ends stopped with no extra transport open, while a later `start()` still queues a fresh restart with a higher token.
- Superseded asynchronous transport opens can no longer tear down or detach a newer page-hide/pageshow reopen. Each open now carries a lifecycle epoch, so callbacks, failures, success telemetry, and cleanup from an older open are ignored once a newer suspend/resume/stop transition owns the lifecycle; `stop()` also waits for any pending open or reopen even when `started` has already been cleared. Previously an initial open failing after a queued resume reset `started` to false and nulled `startPromise`, making `stop()` resolve immediately while the queued transport could still start afterwards.
- `start()` now serialises correctly with both page-hide suspension and an in-flight explicit stop. A hidden bus whose asynchronous `transport.stop()` was still settling returned that cleanup promise from `start()` and never reopened the transport; an in-flight `stop()` likewise allowed `start()` to observe the old ready state and resolve as a no-op before the bus finished stopping. Both paths now queue one fresh start after cleanup, share concurrent start/stop promises, and preserve the existing degraded manual-recovery behavior.
- Explicit `start()` now performs a manual transport recovery when the bus has already started but its automatic recovery budget is exhausted; it preserves the cluster, subscriptions, and replay state while resetting the failure/recovery ledger before reopening. Previously `start()` returned a resolved no-op in the degraded state even though the public health contract documents it as the manual retry path. Covered by a regression that exhausts automatic recovery, succeeds through `start()`, and verifies the health summary returns to healthy.
- IndexedDB replay persistence now settles every mutation when a transaction aborts, including connection-loss aborts that fire `onabort` without a preceding request error. Previously the serialized mutation queue could remain blocked forever, preventing later appends and clears from running. Loads now resolve only after `transaction.oncomplete`, so a request that succeeds before a later abort cannot be reported as a successful read. Request/transaction failures without an `error` object use operation-specific fallback messages.
- Replay age pruning is now position-independent and uses one shared policy for the in-memory rings and IndexedDB adapter. Previously an expired timestamped entry after a timestamp-less legacy entry (or after a non-expired entry) was never removed, and hydrated history was always truncated to `maxPerTopic` even when `pruneStrategy: 'age'` was configured. Timestamp-less entries are still preserved for compatibility, but are now capped by `maxPerTopic` under AGE so they cannot grow without bound; timestamped entries remain bounded by the retention window. Covered across live recording, hydration without a `clearBefore` adapter, and durable append paths.

## [0.20.85] - 2026-09-13

### Added
- Seeded property suite (`tests/property.test.ts`) for the pure hot-path helpers and the stateful managers: `effectiveWorkerLoad`/`selectLeastLoadedWorker` totality and order-independence, `approximatePayloadBytes` finiteness (cycles included), `parseDataBusPublication` topic validity, `topicMatchesPattern` segment-boundary invariants, `serializeError` cloneability, `createOpaqueKey` shape, and `DedupManager`/`ReplayManager` bound invariants under long random operation sequences. Deterministic (fixed seeds), so failures reproduce and the suite is not flaky.

### Fixed
- Replay history is now bounded when `pruneStrategy: 'age'` is set without a `retentionMs`: neither the age pass nor the count cap applied, so the in-memory ring (and the persisted topic record) grew without limit while delivery stayed capped by `maxPerTopic`. The count cap now applies whenever there is no retention window to prune by. Pinned in both the in-memory manager and the IndexedDB adapter (mutation-checked).
- `serializeError` now guarantees its documented structured-cloneable result: a non-Error value was attached verbatim as `context`, so a function/symbol (or an object holding one) made the serialised error itself uncloneable and `postMessage` threw `DataCloneError` while reporting the original failure. Non-cloneable contexts are dropped (cloneable ones are still kept for diagnostics). Pinned by regression + property-suite cloneability invariants.
- `approximatePayloadBytes` no longer overflows the stack on deeply nested or cyclic payloads. Structured clone preserves cycles, so a cyclic publication can legitimately reach the replay-buffer byte estimate (`getDiagnostics().replay.bytes`) and the adaptive-load sampler; unbounded recursion there threw a `RangeError` and took down the diagnostics/reconcile path. The estimate is now depth-bounded (shallow results unchanged), pinned by a cycle/deep-nesting regression plus a finiteness invariant in the seeded property suite.

## [0.20.84] - 2026-09-13

### Added
- CI now enforces three gates that were documented but ran nowhere: `pnpm test:coverage` (the `vitest.config.ts` floors), `pnpm verify:compat`, and `pnpm verify:pack`. The `Release` workflow also runs `verify:compat` + `verify:pack` before publishing. Both workflows check out with `fetch-depth: 0` + `fetch-tags: true`, without which `verify:compat` fails to resolve its release-tag baseline. Documented in both release checklists.
- Focused `ReplayManager` unit suite (`tests/replay-manager.test.ts`): the disabled no-op contract, count/age/both pruning, wildcard replay fan-out, hydration with retention pre-pruning, append batch coalescing, `clear*` durable-failure propagation, retention-sweep coalescing and idempotence, and the persistence retry/backoff plus suspend-cancellation loop (86.95% -> 97.10% statements, 81.60% -> 96.00% branches).
- Additional IndexedDB replay adapter coverage: the unavailable-IndexedDB guard, ordering when a clear interleaves batch coalescing, the `onversionchange` connection drop that unblocks another tab's schema upgrade, transaction-construction failure on every mutation path, single-rejection semantics for a multi-read batched append (84.02% -> 93.29% statements), plus transaction-abort coverage — a quota-exceeded `put` aborts the whole transaction with no request error, so only `transaction.onerror` signals the failure (without it the append hangs), with a generic-message fallback when `transaction.error` is null.
- `CrossTabDataBus` lifecycle-contract coverage: `ready()` rejecting with the configuration error when no `initialConfig` exists and resurfacing the last transport failure once no start is in flight, `unsubscribe` no-ops for an unknown topic and an unregistered handler, `stop()` idempotence, and the third dispatch gate — an owning tab fans a publication out to a peer subscriber and records it *discarded* locally rather than counting it dispatched (mutation-checked).
- `WorkerClusterRuntime` publish-routing and lifecycle-guard coverage: wildcard publish-cache hits on repeat publishes and `publishBatch`, an empty batch as a no-op and a single-item batch delegating to `publish()` with metadata intact, `unsubscribe` on a topic with no route, `isActiveWorker()` eligibility before and after `stop()`, `start`/`stop` idempotence, and `hasLocalSubscriber` segment-boundary matching. Includes a two-runtime regression pinning the 0.20.58 fix: a `null` wildcard-cache entry must not short-circuit a publish whose topic is owned by a remote worker (mutation-checked). cluster.ts functions now 100%.
- `PortReaper` SharedWorker-shutdown coverage: `setTimeout`/`touch`/`remove` no-op for an untracked port (a STOP or INIT racing a reap must not resurrect it), duplicate `remove` clears the cadence timer once the last port goes, `dispose()` closes and stops every tracked session and is safe to repeat, `dispose()` keeps cleaning up after a target throws (a detached port must not strand the remaining WebSockets), and a non-finite/non-positive heartbeat falls back to the default session timeout. port-reaper.ts now 100% statements and functions; all three guards mutation-checked.
- `WebSocketTransport` frame-handling coverage: an empty `publishBatch` as a no-op, ArrayBuffer items embedded as byte arrays so a mixed batch stays one frame, a duplicate `start()` reusing the live socket instead of orphaning it, and non-string / non-object server frames ignored without an error report. websocket.ts 92.59 -> 96.29 statements, 85.54 -> 91.56 branches.
- `CentrifugeWorkerTransport` coverage: a duplicate `start()` reusing the live backend (a second Worker would mean two WebSocket connections), the SharedWorker-level failure and the port message-decode failure reported as distinct errors, a `channelToken` request satisfied from `getToken` when the provider has no `getChannelToken`, and a token request answered with `TOKEN_ERROR` rather than dropped when no `credentialProvider` is configured (a silent drop would hang the worker's connect). centrifuge.ts 93.12 -> 95.00 statements, 91.08 -> 93.06 branches; all four paths mutation-checked.
- `CentrifugeSession` coverage for the client-level `connected`/`disconnected`/`error` listeners, server-initiated `unsubscribed` cleanup, topic-less publication drops, the nested `push.channel` topic shape, and stale/duplicate token replies (85.18% -> 100% functions).
- Demo chaos toggles for lifecycle-failure coverage in a real browser: `#dropHandoffAck` drops outgoing `ROUTE_RELEASED` so a pagehide handoff can only converge through the TTL-gated stranded-handoff recovery, and `#simulateCrash` stops all outgoing coordination on a tab with no pagehide (zombie crash: heartbeats go stale, no handoff write, no worker-record removal) so survivors must re-elect through the heartbeat-TTL crash path. Both are covered by browser E2E (takeover timing corroborates the path taken: ~14 s recovery / ~13.6 s crash expiry vs 1–2 s graceful handoff), with exactly-once delivery asserted after each takeover. (A real renderer crash via CDP was evaluated and rejected: same-origin tabs share the renderer, so siblings die too.)
- Demo observability: the event feed now renders trace `reliability` events (route acknowledgments/migrations/recoveries, transport recovery attempts, persistence retries, dedup outcomes) with Chinese labels, so the new recovery diagnostics are visible in the product demo instead of only in the trace sink. Subscription (`subscription:subscribe/unsubscribe`) and cluster-coordination snapshots (`coordination`, counts only) render as bounded diagnostic rows too. Covered by a browser E2E asserting the acknowledgment, subscription, and coordination rows.
- Trace observability for handoff recovery: a re-election that recovers a stranded unconfirmed handoff now emits `reliability` trace events with `operation: 'route_migration_recovery'`, distinct from the routine graceful-handoff `route_migration`, so operators can tell recoveries apart from normal churn in the trace sink. Covered by unit tests on both paths plus a data-bus-level test proving the operation reaches the public trace sink end to end (mutation-checked); documented in the API reference (English and Chinese).
- Coverage-driven fault-injection suite for the storage utility layer (`tests/storage-utils.test.ts`): a fully-throwing storage backend and a corrupt-record backend pin every error-swallow branch of `readJson`/`writeJson`/`listKeys`/`readAllByPrefix` (storage-utils now 100% statements+branches).
- WebSocket transport regression coverage for two error paths: a Blob binary frame whose conversion rejects is isolated through `onError` (no crash, no delivery), and a binary publish whose encoded topic exceeds the 16-bit frame prefix reports "topic is too long" and sends nothing, with the exactly-0xffff boundary still framing successfully.
- Centrifuge transport coverage for factory-less degradation: with both Worker globals absent the transport resolves to the `local` backend without error (the documented SSR behavior), while an injected factory that throws surfaces the failure instead of degrading silently.
- Retention-cleanup regression coverage: a failing durable `clearBefore` pass is reported through `onError` once and does not wedge the pipeline (a later publication still flushes), and a cutoff queued while one pass is in flight is drained by the cleanup loop rather than dropped.
- IndexedDB replay persistence coverage for read-request failure paths: `load()` and `clearBefore()` reject with the request error and invalidate the connection; the fault-proxy transaction wrapper now forwards `oncomplete`/`onerror` so the previously untestable clear-path completion is exercisable.
- Dedup option validation coverage: invalid `maxEntries`/`ttlMs`/`sweepMs` and malformed `adaptiveTtl` bounds throw `TypeError` before the bus is constructed (validation.ts statements now 100%).
- `pnpm bench:trend` (`scripts/bench-trend.mjs`) generates a long-run browser benchmark trend doc (`docs/benchmarks.md` + Chinese mirror) from the archived `bench-results/` reports: per-metric latest/previous/delta plus an all-time best per latency. Both docs ship in the tarball and are indexed in the documentation READMEs; the release checklist (both languages) now includes the benchmark-regression gate step, and the Chinese checklist gained the previously missing browser-benchmark gate bullet (EN/ZH parity).
- Opt-in `loadWeighting` adaptive owner weighting (`messageRateWeight`, `byteRateWeight`, `scheduleLagWeight`): workers sample their own fan-out traffic and heartbeat scheduling overrun per window and publish it with the worker record; new-route owner selection adds the normalized rates and lag ratio to the topic count. Default (unset) keeps pure topic-count routing and existing routes stay sticky. `WorkerThroughputSample` gains `overrunMs`, a browser-native proxy for a starved event loop.
- Async credential refresh bridge for the Centrifuge worker: opt-in `credentialProvider` (`getToken` / `getChannelToken`) runs on the main thread, with the Worker requesting each fresh token over a `TOKEN_REQUEST` / `TOKEN_RESPONSE` / `TOKEN_ERROR` exchange. Function-valued Centrifuge options stay out of the structured-clone boundary; legacy configs keep byte-identical behavior; pending requests are settled on STOP.
- Synchronous trace visibility: `DataBusTraceReporter.getMetrics()` snapshots the current aggregation window without a sink or flush; `CrossTabDataBus.getMetrics()` and `getDiagnostics().metrics` expose it, and `getDiagnostics().trace` / `getHealthSummary().trace` report `asyncSink` mode and queued-event depth (back-pressure visibility).
- E2E: a real-Chromium scenario disables `window.BroadcastChannel` and verifies two tabs coordinate and deliver cross-tab over the localStorage storage-event channel; a Playwright `waitForSingleOwner` convergence helper replaces one-shot owner reads across the suite. A second fallback scenario drives a graceful `pagehide` handoff so the replacement route and REGISTRY nudge ride storage events and the standby takes ownership over the fallback plane.
- A 100-item × 3-tab `publishBatch` E2E asserts exactly-once fan-out per tab, guarding against the owner echo racing the EVENT broadcast and per-item frame decomposition on a larger burst.
- Getting-started guides (English and Chinese) gained an "Upgrading & Deprecation" section, the migration-guide payload behind the pre-1.0 deprecation policy in the release checklist.
- `getDiagnostics().replay` now reports `bytes`, the approximate in-memory footprint of the buffered replay rings (computed on demand, same sizing heuristic as adaptive load weighting).
- The demo's overview gains a live diagnostics row: the current trace-window throughput/dispatch P50 (`getMetrics()`) and the replay buffer footprint (`getDiagnostics().replay`), refreshed with the existing 1s render loop. A "负载加权" toggle (off by default) enables adaptive weighting in the demo and the workers table shows each worker's throughput sample (`msg/s` + scheduling-lag %) in a new 吞吐 column.
- QA: `verify:pack` now smoke-imports the full root public surface (12 functions incl. `effectiveWorkerLoad`, `approximatePayloadBytes`, `createIndexedDbReplayPersistence`) plus every subpath in ESM and CJS; a cluster integration test proves `scheduleLagWeight` steers a new route away from a scheduling-lagging worker; the `getMetrics()` test asserts full field parity with a flushed `message_metrics` event; README and Chinese roadmap feature lists were brought up to date with the recent additions.
- Packaging: the published tarball now enumerates the exact docs files (both languages) instead of the whole `docs/` directory, dropping the internal `docs/progress.md` tracking artifact from `npm pack` output.
- Security/CI infrastructure: a CodeQL workflow (javascript-typescript, push/PR/weekly) and a Dependabot config (weekly npm + GitHub Actions updates) were added; `verify:compat` now auto-derives its export-contract baseline from the latest release tag (with `COMPAT_BASE_TAG` override) instead of a hard-coded version.
- Dependency security: `pnpm audit` found two high dev-chain advisories (`glob <10.5.0`, `nanoid <3.3.18` via vitest/vite); pinned via `pnpm-workspace.yaml` overrides (the pnpm-v10 home for that setting) and the audit is clean.
- `verify:published` now smoke-imports the same full root public surface as `verify:pack`, so the release gate exercises the routing/observability exports end to end.
- Demo accessibility fixes (`examples/demo`): the run-mode segmented control is now an ARIA `radiogroup` with a `radio`/`aria-checked` state on each button, kept in sync by the click handler (previously only a CSS `active` class conveyed the selection, so assistive tech announced no selected mode at all and never announced a change). Its dangling `<label>` became a `<span id="modeSwitchLabel">` referenced via `aria-labelledby`, since a `<label>` with no form control has no accessible-name effect. Both `.state-table`s gained visually-hidden captions, and all eight `<th>` across the three tables gained `scope="col"` so cells are announced with their column header. Guarded by four browser E2E specs asserting no unnamed control, captions and column scopes on every table, and that `aria-checked` follows the selection. The group is also keyboard-operable per the radiogroup pattern: a roving tabindex makes it a single tab stop, and Arrow/Home/End move (and select) between options with a visible `:focus-visible` ring, which buttons previously lacked entirely.

### Fixed
- `effectiveWorkerLoad` is now total against a corrupt base load: the earlier non-finite-score guard fell back to `worker.load` itself, so a stored load of `Infinity` (JSON `1e999`) or a malformed record leaked a non-finite score back into owner selection — the exact array-order dependence the guard was added to prevent. Found by a new seeded property suite (`tests/property.test.ts`) that also pins order-independent minimum selection, `parseDataBusPublication` topic validity, `topicMatchesPattern` segment-boundary invariants, and `createOpaqueKey` shape.
- DataBus transport error isolation is now pinned: a transport whose `publish` throws synchronously, or whose `subscribe` rejects, is funnelled into `onError` instead of escaping the caller or being swallowed (mutation-checked by removing the synchronous catch). `parseDataBusPublication` now also pins the null branch for primitive/null/undefined frames when no fallback topic is available.
- Removed a second unreachable branch: `ReplayManager.schedulePersistenceFlush`'s per-message `append` fallback could never run, because the only queuer (`record()`) pushes to the batch only when the backend advertises `appendBatch`. The batched append is now unconditional there, with the reachability constraint documented. Behaviour-preserving (643 unit tests unchanged).
- Removed an unreachable branch in `WorkerClusterRuntime`'s wildcard publish path: the cache-hit guard queried `assignedTopics` (keyed by the opaque topic key) with the plaintext pattern, so `assignedTopics.has(cachedPattern)` was always false and the branch could never run. The memoisation is now documented as a scan-skip marker only (only the first, scanning call may dispatch a local-wildcard publish locally; later calls route through `resolvePublishTarget`, honouring a concrete remote owner). Behaviour-preserving removal (640 unit tests unchanged) and cluster branch/line coverage rose (90.21 → 90.50 branches, 97.61 → 98.24 lines).
- `CrossTabDataBus.unsubscribe(topic)` without a handler — the documented whole-topic teardown — is now pinned: it clears every handler, tears the transport subscription down exactly once, drops the topic's replay history (no stale replay on re-subscribe), and makes the previously returned per-handler closers no-ops. It previously had no direct coverage (only the with-handler and unknown-topic forms were exercised). Mutation-checked both ways.
- Centrifuge publication metadata is now pinned for the partial cases: a `messageId`-only or `timestamp`-only publish sends an envelope that omits the absent key entirely instead of serialising `undefined` into the server payload.
- Error-path coverage added for the WebSocket transport's separate binary framing path (a binary publish on a closed socket is reported through `onError`; mutation-checked) and for the structured-clone guard's documented skip when a runtime lacks `structuredClone` (older browsers must proceed rather than fail with a spurious `TypeError`; mutation-checked). `BatchingStorageWriter` now also pins that at most one backoff retry timer stays pending while writes keep failing.
- `scripts/bench-browser.mjs` ran the *entire* benchmark at module scope, so nothing could import it — a test, or any other script — without spawning the demo server and launching a Chromium instance. Its environment inputs were also `Number(...)`-coerced with no validation, the same defect class as the `bench:compare` gate: `BENCH_MESSAGES=abc` became `NaN`, the publish loop never executed, and the run died on a 30s `waitForFunction` timeout with no hint of the cause; `BENCH_MESSAGES=0` made `perMessageMs` `0/0`, a `NaN` that `JSON.stringify` archives as `null` and so poisons the trend comparison; `BENCH_MODES=,` silently ran *zero* modes and archived an empty `results` array, leaving `bench:compare` with nothing to compare while still reporting OK; and `PORT=abc` produced `http://localhost:NaN/...` and a server that failed to listen, far from the actual mistake. The runtime body now lives in `main()` behind an `invokedDirectly` guard (the pattern the other release scripts already used), and `PORT` / `BENCH_MESSAGES` / `BENCH_MODES` are parsed by an exported, validated `parseBenchEnv` — an empty value still means "use the default", as before. Covered by `tests/bench-browser.test.ts`, and a source-hygiene guard now fails when a package.json entry point that a test imports runs at import time.
- The new API-reference guard broke CI while passing locally. `pnpm check` runs `typecheck && build && test`, so `tsc --noEmit` sees a fresh checkout with no `dist/` and rejected the guard's literal `import('../dist/index.js')` with TS2307 — the directory existed locally, so the failure was invisible until CI ran. The specifier is now non-literal (`` import(`../dist/${'index.js'}`) ``), the same pattern `tests/dual-format.test.ts` already used for exactly this reason, and a new source-hygiene guard rejects any literal dynamic `import()` of `../dist/` from a test file so the trap cannot be reintroduced silently.
- Each adapter entry (`/hooks`, `/vue`) exported the same four composable names, and the API reference documented the health composable for only *one* adapter per language: English described it under React and never mentioned that `/vue` exports it, while Chinese described it under Vue and never mentioned it under React — and the Chinese Vue heading carried the React name (`useCrossTabHealth`) over a body describing a Vue `Ref`. Both adapters are now documented in both languages, with the Vue binding named `useVueCrossTabHealth` to match the aliasing convention already used throughout that section. The h2/table-row/list-item parity guards could not see this, because both languages have the same shape — a new guard splits the reference on h2 and requires each entry's own section to document every export of that entry.
- The API reference (English and Chinese) did not document the whole public surface: four of the nineteen root exports — `DEFAULT_MAX_ACTIVE_WORKERS`, `approximatePayloadBytes`, `effectiveWorkerLoad`, and `getOrCreateTabId` — were absent from `docs/api.md`, and `CrossTabDataBus.publishBatch` had no entry at all (only the transport-side optional `publishBatch?` hook was described, while the `WorkerClusterRuntime` "Main methods" list also omitted it). All are documented now, including the non-obvious guarantees: `getOrCreateTabId` deliberately does not reuse the stored value when `window.opener` is present (a `window.open()` child inherits the opener's `sessionStorage`, so a blind reuse would give two live tabs one identity), and `effectiveWorkerLoad` always returns a finite score. A new guard derives the export list from the built entry point and fails the suite when a public export is undocumented in either language, so the reference can no longer drift behind the code.
- `effectiveWorkerLoad` could return a non-finite score, which made owner selection depend on the *order* of the worker array. A `windowMs` of `NaN` slipped past the `sample.windowMs <= 0` guard (because `NaN <= 0` is false), and a corrupt sample field (a `NaN` `messageCount`/`overrunMs`) or a non-finite weight divided through to `NaN`. `selectLeastLoadedWorker` compares `byLoad !== 0` — true for `NaN` — and `NaN < 0` is false, so a `NaN` worker won or lost purely by its index: the same worker set produced different owners depending on storage listing order. The score is now total (a non-finite window or result falls back to the raw topic count), pinned by an order-independence regression test.
- The cluster coordination options were entirely unvalidated, so `maxActiveWorkers`, `heartbeatIntervalMs`, `workerTtlMs`, `routeOwnerCacheMax`, and the `loadWeighting` weights all accepted values that silently broke routing: `heartbeatIntervalMs: 0`/`NaN` degenerated the heartbeat `setInterval` into a 0ms busy loop (the exact hazard the Centrifuge PING guard already exists for, and `Infinity` is rejected here because a Worker that never refreshes its heartbeat is pruned by its own TTL), a non-positive `workerTtlMs` pruned every peer on the first reconcile, and a non-positive `maxActiveWorkers`/`routeOwnerCacheMax` disabled ownership or caching outright. A new `assertClusterOptions` runs in the `WorkerClusterRuntime` constructor (so it covers `CrossTabDataBus` and the transport factories too), and the `loadWeighting` weights must be non-negative finite numbers — a negative weight inverted the documented policy by biasing new routes toward the *busiest* Worker.
- `scripts/verify-packed-consumer.mjs` polluted the checkout and leaked its scratch space on every run. It called a bare `npm pack`, so each run wrote `cross-tab-worker-databus-<version>.tgz` into the repository root — a stale archive per version, left behind on every push because CI runs the smoke each time (its sibling `verify-published-consumer.mjs` already used `--pack-destination`). Neither verifier removed its `mkdtempSync` root either, so every run also left ~3 MB of unpacked package in the OS temp directory (five had accumulated locally, ~16 MB). The pack now targets the temp root, and both scripts remove it in a `finally` (best-effort — a blocked delete warns rather than throwing, so it cannot turn a passing verification into a failed release gate).
- The same smoke verified only a hardcoded `['.', './hooks', './vue', './centrifuge']` subpath list, so the two Worker artifacts — `./centrifuge.worker` and `./centrifuge.shared.worker`, the entry points the built-in Worker factory resolves at runtime — were never checked inside the tarball at all. The sweep is now derived from the packed manifest (every declared target must exist, string and conditional entries alike), so a new entry point is covered on the commit that adds it. Verified end to end by pointing a worker export at a missing file and watching the smoke exit 1 with `missing export target ./dist/centrifuge.worker.broken.js for ./centrifuge.worker`.
- `scripts/bench-compare.mjs` did not validate `--fail-above-pct`: the value was `Number(...)`-coerced, so a typo produced `NaN`, and since every `pct > NaN` comparison is false the documented release gate **silently passed** for every metric (`[bench] OK: no metric regressed more than NaN%`). A missing, empty, non-numeric, or negative threshold now throws instead. The same pass made the "one report path" case an error rather than silently comparing the two most recent reports, and split the CLI into validated, exported `parseArgs` / `compareReports` / `findRegressions` helpers covered by `tests/bench-compare.test.ts`.
- `scripts/` was in the ESLint `ignores` list, so the release-critical tooling (the bench gate, the packed/published consumer verifiers, the demo servers) was never linted. It is now covered with Node globals and `no-console` allowed (browser globals scoped to `bench-browser.mjs`, whose Playwright callback really does run in the page). Enabling it surfaced two real findings, both fixed: a `preserve-caught-error` in `verify-version-compat.mjs` (the original error was discarded instead of attached as `cause`) and a misindented `console.log` in `serve-examples.mjs`. A guard fails if `scripts/**` returns to the ignore list.
- `scripts/bench-trend.mjs` stamped the generated trend doc with `new Date()`, so `docs/benchmarks.md` and its Chinese mirror changed every day even when no new benchmark report existed — a spurious diff that also implied fresh data. The stamp is now derived from the latest report's own `generatedAt` (falling back to the `browser-<ISO>.json` filename date), making regeneration a no-op when nothing new was archived. The generated header also claimed "prose is maintained by hand" while the script overwrites the entire file; corrected to say so. The renderer is now a pure exported `buildDocs(entries)`, covered by `tests/bench-trend.test.ts` (stamp source, byte-determinism, delta + all-time-best math, and rejection of an archive with fewer than two reports).
- `BatchingStorageWriter` carried its class JSDoc twice — the first block a truncated copy left over from an earlier edit — so only the second was attached to the class and the first was dead documentation. Removed, with a source-hygiene guard that fails when a JSDoc block is stacked directly on another whose body it prefixes (a file-level header followed by a member's own doc is not flagged).
- Documentation parity (English and Chinese): the English release checklist was missing the "Security and dependency scanning" section (CodeQL + Dependabot) that only the Chinese copy carried; the Chinese roadmap had lost its entire `0.11.0` delivered-scope section and its `0.13.0` candidates section had lost all four items; the Chinese configuration reference omitted the `recovery.cooldownMs` and `recovery.maxAttempts` rows; and the Chinese documentation index's demo link carried a doubled slash. Five new structural guards now compare every localized doc pair (h2 section count, markdown-table row count, list-item count), reject any empty section, and require every shipped doc to be enumerated in `package.json` — this drift class fails the suite instead of shipping silently.
- `dedup.adaptiveTtl` bounds validation accepted non-finite values: `NaN <= 0` and `maxMs < NaN` are both false, so `{ minMs: NaN }` (or an `Infinity` `maxMs`) passed construction and left `currentTtl()` returning `NaN`, silently disabling expiry instead of failing loudly. Bounds must now be finite positive numbers with `minMs <= maxMs`.
- Manual release dispatch derived the release identity from the wrong ref: on `workflow_dispatch`, `GITHUB_REF_NAME` is the selected **branch**, not the `tag` input, so the release job would create a GitHub release named `main` and compute the npm version from the branch (with notes extracted for `main`). The release workflow now resolves `${ inputs.tag || github.ref_name }` once into `RELEASE_TAG` and every step uses it. Guarded by a new `tests/workflows.test.ts`.
- The capabilities matrix (English and Chinese) had a broken table row: the "Optional ArrayBuffer Transferable transport" description was orphaned onto the next row, leaving a 3-cell row beside a 5-cell row so the whole matrix rendered with shifted columns. The description is back on its own row, and a new documentation guard now fails the suite whenever a markdown table mixes cell counts (splitting on unescaped pipes only, so `\|` inside a cell is not mistaken for a separator).
- CHANGELOG structure: the `[Unreleased]` section carried two `### Changed` headings, and the `[0.20.60]` version heading was an h1 (`#`) instead of h2 (`##`) — invisible to the Release workflow's `## [<version>]` notes match. Both fixed, with guards that fail on a repeated subheading within one version section and on any version heading not written as an h2.
- Release checklists (both languages) now include `pnpm test:coverage` in the Before-tagging run so the local dry run matches the CI gate set, and note that `verify:compat` needs `git fetch --tags` in a shallow clone (otherwise it fails with "no version tag found"). A documentation test now asserts each checklist documents the full gate set.
- Vue `useCrossTabDataBus` no longer leaks a bus when the component unmounts inside the async start window. `start()` awaits `stop()` before calling `create()`; an unmount landing in that window ran `stop()` without bumping the lifecycle generation, so the pending continuation still created a bus that nobody owned or stopped. `onBeforeUnmount` now supersedes the pending start. Pinned by a regression test (fails without the fix). The React adapter is unaffected — its `create()` is synchronous inside `useEffect`.
- Stranded-handoff recovery no longer lets concurrent survivors ping-pong route generations: only the deterministically elected owner performs the re-election (peers stand down and wait for its write), and projected loads spread multi-topic recoveries across survivors like the graceful handoff does. When the elected owner has no local subscription — so it would never reconcile the topic — the recovering peer writes the route and notifies it directly instead of standing down forever. Without this, divergent cross-tab views made survivors rewrite the same route every pass, dropping each other's confirmations and piling topics onto one worker. Covered by distribution and unsubscribed-owner regression tests; the multi-round soak pins convergence.
- Stranded unconfirmed handoffs no longer stall forever when the previous owner's `ROUTE_RELEASED` never arrives (dropped channel message under load, or a crash between the route write and the ACK): the reconcile loop re-elects a live owner once the previous owner is gone and the handoff has been stuck longer than a worker TTL (10 s default), rewriting the route with a fresh generation and clearing the handoff marker so the normal confirmation path completes. While the previous owner is still alive the new owner keeps waiting, and a fresh handoff is never mistaken for a stranded one (age gate), so the strict handoff keeps its no-overlap guarantee. Pinned by two regression tests (recovery after the TTL vs. continued waiting while the previous owner lives); architecture docs (EN+ZH) updated.
- Adaptive dedup TTL now takes effect on the hot path: the opportunistic per-message expiry used the fixed `ttlMs` while the sweep and `getStats()` used the adaptive window, so a burst that shrank the effective TTL toward `minMs` still retained IDs for the full fixed TTL where nearly all traffic flows. The hot path now expires against `currentTtl()`. Pinned by a direct `DedupManager` suite (`tests/dedup-manager.test.ts`: acceptance/suppression, TTL expiry, FIFO eviction, sweep lifecycle, adaptive shrink/relax/window-reset; fails without the fix).

### Changed
- The demo's config panel now shows the active chaos mode (`丢弃交接确认` / `模拟崩溃` / `未启用`): a tab that is dropping handoff ACKs or simulating a crash was previously visually indistinguishable from a healthy one. Both chaos gates are now read live at call time (previously `dropHandoffAck` was captured at bus creation), so a toggle takes effect immediately and the panel cannot show a mode that is not actually active. Both chaos E2E specs assert the row.
- The `Release` workflow now re-runs `pnpm lint` before publishing (a version tag can point at a commit that never passed CI's lint job), alongside the existing `verify:compat` / `verify:pack` release gates. Both release checklists document it, and a workflow guard asserts the step exists.
- `package.json`'s `files` list now enumerates every shipped doc explicitly, adding the localized `docs/zh/README.md` and `README.zh.md` (mirroring the already-listed `docs/README.md` / `README.md`). npm auto-includes `README*` / `LICENSE*` / `CHANGELOG*` regardless of `files`, so these two were shipped anyway — but a *non*-README doc left off the list would silently vanish from the tarball, so a guard now fails when a doc on disk is not published.
- Dependency upgrades: vitest 4 → 5 (with the matching coverage provider) and the scoped lint-config package 9 → 10 to match eslint 10. Vitest 5 rewrote the benchmarking API (`bench` is now a test-context fixture instead of a module-scope import), so all 25 benchmarks in `tests/bench/` were migrated to the `test(name, async ({ bench }) => { await bench(name, fn).run(); })` form; the suite reports identical hot-path numbers under the new runner.
- Dependency security: vitest upgraded 3.2 → 4.1.11 (with the matching coverage provider) to clear the GHSA-82fw-gwwq-j7x9 path-traversal advisory in the vitest mocker package; the audit is clean again and the full suite (typecheck, 460 unit, bench, e2e) is green on the new major. One test helper's mock-factory return type needed explicit callback typing under Vitest 4's tighter mock generics.
- Playwright E2E default timeout raised 60 s → 90 s so convergence waits (30–45 s) can legitimately stack with `HANDOFF_TIMEOUT_MS` (60 s) polls inside one test; the storage-event handoff test — the one suite whose 45 s convergence + 60 s handoff previously exceeded the old ceiling — now carries an explicit 120 s budget. This removes the documented flake class where a healthy but slow handoff poll died on the test-level timeout rather than its own.
- The demo's config panel shows the load-weighting toggle state (启用 消息/字节/滞后 vs 禁用 纯 Topic 数), and the routing benchmark suite gains a `weighted + lag` owner-selection baseline.
- The COORDINATION trace event is now emitted after each transport open (start and recovery) with the settled route list; previously it fired synchronously at the top of `start()` where subscription writes were still coalesced, so its `routes` field was always empty.
- The CI verify job now runs `pnpm audit` (dependency security gate) and the release checklists document the audit step.
- IndexedDB replay persistence coalesces concurrent `appendBatch` calls into a single read-modify-write transaction (regression: ten concurrent batches = one readwrite transaction) while preserving order against `clear`/`clearTopic`/`clearBefore`.
- The root export surface is pinned by a regression test, making pre-1.0 API additions/removals deliberate.
- Benchmarks: load-weighting scoring, `getMetrics` snapshot, and `publishBatch` batch-size sensitivity (10/50/100 per call) baselines.
- GitHub Actions bumped to current majors (checkout/setup-node/upload-artifact v4 → v7, pnpm/action-setup v4 → v6), dropping the Node 20 deprecation warning on the forced Node 24 action runtime.
- Browser E2E handoff tests (owner migration, multi-tab soak, BFCache) wait up to 60 s for a pagehide owner takeover, absorbing shared-runner scheduling jitter.
- The demo WebSocket hub attributes wire-frame counters per topic (`/debug/wsstats.topics`) so the single-frame `publishBatch` assertion is immune to concurrent tests on a parallel local run.
- Browser benchmark databus matrix now measures real dispatch work: auto-start defers `transport.start` to a microtask, so the emit/publish cases previously ran before the transport was live (messages dropped, publishes queued) and reported sub-millisecond no-ops. Cases now `await ready()` plus a bounded assignment poll and assert exact delivery counts; the `publishBatch` case uses an echo stub to measure the full route → publish → dispatch round-trip, and a `firstPacketMs` cold-dispatch baseline was added.

## [0.20.83] - 2026-09-05

### Added
- `useCrossTabHealth` edge-case coverage for both adapters (React and Vue): interval polling refreshes the health snapshot, detaching a stopped bus resets it to `null` and unsubscribes its status/error listeners, and unmounting never leaks the polling timer.
- Browser benchmarks now archive every run under `bench-results/` (gitignored), and a new `scripts/bench-compare.mjs` prints per-metric deltas between two runs so publish-throughput and hot-path regressions can be checked locally.
- The demo gains a "批量 10" button that publishes ten JSON items through `CrossTabDataBus.publishBatch` with per-item `messageId`s; the demo WebSocket hub counts `publish` vs `publishBatch` wire frames and exposes them via `/debug/wsstats`, and a new E2E asserts the burst travels as exactly one frame with no per-item publishes.
- Documented the `asyncSink: true` delivery semantics in the API reference (English and Chinese): microtask-batched FIFO delivery, unchanged error isolation, and the ordering boundary versus the synchronous sink.
- Added the `src/utils/` toolbox: shared string constants with literal-derived types, `publicationMetadata`, fault-tolerant storage primitives (`readJson`/`writeJson`/`listKeys`/`readAllByPrefix`), option-validation asserts, and Worker-boundary error serialization.

### Changed
- Every runtime string literal in the SDK is centralized in `utils/constants.ts`; status/role/action unions and cluster/worker/message/trace discriminants are derived from those constants so values and types cannot drift apart, and the repeated magic strings across source and tests were unified.
- Replay buffering and inbound deduplication moved out of `CrossTabDataBus` into self-contained `ReplayManager` and `DedupManager` classes with their own lifecycle; the DataBus delegates to them and deliberately keeps its lifecycle state machine in place (`data-bus.ts` shrank from ~1440 to ~1094 lines).
- The release checklist (English and Chinese) now documents the tagged-release workflow's blocking published-consumer verification (`verify:published`, 24×5 s retry budget) instead of treating it as a post-publication side note.

## [0.20.82] - 2026-09-05

### Added
- The default Playwright assertion ceiling rose to 20 s, covering every remaining poll on slow shared runners.
- Added non-cloneable-config coverage (symbols) with `cause` preservation for the Worker transport's structured-clone guard.
- Added a `/debug/connections` endpoint to the examples server and an E2E asserting that a closed shared-mode tab's WebSocket is dropped server-side.

## [0.20.81] - 2026-09-05

### Added
- `bench:browser` now also runs the data-bus hot-path matrix (wildcard dispatch, `publishBatch`, dedup, trace-and-publish) inside a real browser against the built ESM bundle, reported alongside the publish-throughput results for Node-vs-browser comparison.
- The E2E suite asserts the health summary end to end: the demo's health line reads healthy and `window.__bus.getHealthSummary()` reports `{ healthy: true, state: 'healthy' }` on a connected tab.
- Documented `createStorageEventChannel` in the API reference (English and Chinese) and added the transport-level `publishBatch` row to the capabilities matrix.

## [0.20.80] - 2026-09-05

### Added
- E2E failure artifacts now include Playwright traces (retain-on-failure) and first-retry videos; diagnostics retention extended to 14 days.
- Reload-style E2E tests converge the cluster (exactly one owner) before publishing, removing the standby re-subscription race behind intermittent CI failures.
- Documented the loss-and-recovery matrix for every coordination message in the architecture docs (English and Chinese).

### Changed
- The concurrent-burst E2E staggers publishes within each tab: hammering one transport with a same-tick burst can push it into a documented disconnect window where dropped publishes are expected.

## [0.20.79] - 2026-09-05

### Added
- The Release workflow now fails when the published-package consumer verification fails (retry budget raised to 24 × 5 s to cover registry propagation); releases without an npm token keep skipping the check.
- Added a regression pinning the full lost-handoff-ACK recovery chain: TTL cleanup of the orphaned route followed by ownership re-election when the original owner resumes.

## [0.20.78] - 2026-09-05

### Added
- The demo now shows the REAL transport backend (`getDiagnostics().transport.backend`) and the E2E suite asserts dedicated/shared tabs actually run on Worker backends — a silent fallback to the local session fails CI instead of passing unnoticed.
- Added a regression pinning the deferred channel close in `pause()` so queued handoff frames always flush.
- Documented the close-ordering invariant in the architecture docs and added health-summary/fallback quick-start sections to the getting-started guide (English and Chinese).

## [0.20.77] - 2026-09-05

### Fixed
- Worker-backend availability now honors runtime capability in addition to injected factories: without the fix, a browser consumer that did not pass an explicit `workerFactory`/`sharedWorkerFactory` silently degraded to the main-thread local session and never used the bundled Dedicated/Shared Workers.

### Added
- Added default-backend coverage for the bundled Dedicated/Shared Worker paths and the `uninitialized` diagnostics identity.
- Added storage-event channel loss-recovery regressions: a silently dropped delivery is recovered by the heartbeat reconcile loop.
- The demo now surfaces coordination-channel diagnostics and an opt-in `channelFallback: 'storage-event'` toggle.

## [0.20.76] - 2026-09-05

### Added
- Added an opt-in coordination channel fallback for environments without BroadcastChannel: `createBrowserEnvironment({ channelFallback: 'storage-event' })` installs a localStorage storage-event `ClusterChannel` (exported as `createStorageEventChannel`), preserving cross-tab owner coordination instead of degrading to local mode. Coordination payloads persist to localStorage under a dedicated key namespace — a documented security trade-off, which is why the fallback is opt-in.

## [0.20.75] - 2026-09-05

### Added
- Added hot-path performance gates to the unit suite: generous-ceiling assertions over wildcard/exact topic matching, opaque-key hashing, and worker selection loops, so catastrophic hot-path regressions fail CI while real benchmarking stays in `pnpm bench`.
- Extended IndexedDB replay persistence tests with scripted fault injection (transaction-construction failure and failing store requests), covering the adapter's invalidate-and-recover error paths.

## [0.20.74] - 2026-09-05

### Added
- Added an optional `publishBatch` to the `DataBusTransport` contract: transports that can pack many items into one wire frame (the bundled WebSocket transport sends a single `publishBatch` frame) are used for burst publications, with automatic per-item `publish` fallback for transports without batch support.
- Added `useCrossTabHealth` to the React and Vue adapters, mirroring `getHealthSummary()` with interval polling (default 1 s, `intervalMs: 0` for event-driven only) plus event-driven refreshes on status changes and errors.
- The demo WebSocket server accepts `publishBatch` frames and re-fans them out as individual timestamped publications.

### Fixed
- `getHealthSummary()` now accounts for the live transport status, so a transport reporting `error`/`disconnected` no longer reads as `healthy` while the `transportReady` flag has not yet been cleared.

## [0.20.73] - 2026-09-05

### Added
- Added unit-test coverage for the IndexedDB replay persistence adapter via `fake-indexeddb`: round-trip, count/age/both pruning, `appendBatch` grouping, mutation-queue serialization of concurrent same-topic appends, `clear`/`clearTopic`/`clearBefore` semantics, and recovery after a transient open failure.
- Added real-browser E2E coverage for concurrent multi-publisher bursts across three tabs and for a full connection re-apply (bus stop/start) that rejoins the cluster without duplicate ownership.
- Added a "Stability Invariants" section to the architecture docs (English and Chinese) consolidating the handoff, cleanup-ordering, recovery-budget, and BFCache guarantees pinned by the regression suite.

## [0.20.72] - 2026-09-05

### Added
- Added advanced hot-path benchmarks for `publishBatch`, wildcard routing, deduplication, replay pruning, `appendBatch` persistence, and asynchronous trace sinks.
- Added `CrossTabDataBus.getHealthSummary()` with a single-object readiness verdict (`healthy`, lifecycle-derived `state`, unified `lastFailure` ledger, transport identity, and recovery context) for dashboards and readiness probes.
- Added `getPersistenceStats()` and surfaced persistence failure counters in `getDiagnostics()`; transport diagnostics now include the live connection `status` and `suspended` flag.
- Added long-session stability regression coverage for owner-handoff ACK validation, repeated BFCache round-trips, recovery exhaustion reset, storage write backoff recovery, and replay persistence cleanup races.

### Fixed
- Stale `ROUTE_RELEASED` ACKs whose generation is older than the current route record are now rejected; the comparison was inverted, so a replayed ACK from an earlier handoff round could confirm a newer handoff.
- Replay persistence cleanup no longer resurrects cleared history: a queued batch flush is filtered for topics cleared via `unsubscribe`/`clearReplayTopic` and for entries pruned via `clearReplayBefore`.
- Diagnostics report the released SDK version, injected from `package.json` at build time, instead of a stale hardcoded constant.

## [0.20.71] - 2026-09-05

### Added
- Added optional bulk replay persistence via `appendBatch`, with IndexedDB transaction coalescing for burst publications while preserving legacy adapters.

## [0.20.70] - 2026-09-05

### Added
- Added SDK version and transport/backend identity to `CrossTabDataBus.getDiagnostics()` for support bundles and health dashboards.

## [0.20.69] - 2026-09-05

### Added
- Exposed peer protocol capability versions in `WorkerClusterSnapshot.peerProtocolVersions` and `CrossTabDataBus.getDiagnostics().protocol.peers`; legacy peers are represented as `null`.
- Worker registration records now advertise `protocolVersion: 1` for runtime capability discovery.

## [0.20.68] - 2026-09-05

### Added
- Added explicit cluster protocol version metadata (`protocolVersion: 1`) to CONTROL, EVENT, REGISTRY, and ROUTE_RELEASED frames and worker snapshots.
- Legacy frames without the optional field remain accepted, while unknown message types continue to be safely ignored and diagnosed.
- Added cross-version protocol compatibility regression coverage.

## [0.20.67] - 2026-09-05

### Added
- Added bounded unknown protocol message diagnostics on `WorkerClusterRuntime` and `CrossTabDataBus.getDiagnostics()`, including count and last message type while preserving safe ignore behavior.

## [0.20.66] - 2026-09-05

### Added
- Extended IndexedDB replay persistence with optional `pruneStrategy` (`count`, `age`, `both`) and `retentionMs`, applying the same trimming semantics as in-memory replay.

## [0.20.65] - 2026-09-05

### Added
- Added opt-in adaptive dedup TTL sampling with bounded `minMs`/`maxMs` controls and diagnostics exposure.
- Added replay `pruneStrategy` configuration (`count`, `age`, `both`) for memory history trimming while preserving legacy defaults.

## [0.20.64] - 2026-09-05

### Added
- Added opt-in `asyncSink` trace mode, batching sink delivery onto a microtask while preserving event order and sink error isolation.
- Added regression coverage for asynchronous trace batching (339 unit tests).

## [0.20.63] - 2026-09-05

### Added
- Added an optional `onUnknownMessage` hook and forward-compatible protocol handling so older runtimes ignore future cluster message variants without throwing.
- Added regression coverage for unknown protocol variants (338 unit tests).

## [0.20.62] - 2026-09-05

### Added
- Added `CrossTabDataBus.getDiagnostics()` combining lifecycle status, transport readiness, recovery history, dedup counters, replay buffer usage, and cluster snapshot into one health-oriented view.
- Added coverage for the top-level diagnostics contract.

## [0.20.61] - 2026-09-05

### Added
- `originTabId?: string` on every `DataBusMessage` (and on the cluster `EVENT` wire frame) so cross-tab replay history is attributed to the tab that produced it.
- `WorkerClusterRuntime.broadcastEvent()` now defaults `originTabId` to the producing runtime's `tabId` so existing callers (and tests) get source-tab attribution without threading the value manually.
- `CrossTabDataBus.handleTransportMessage` stamps `originTabId = cluster.tabId` before broadcasting, so neighbors and IndexedDB-replayed late subscribers see the same attribution.
- Four unit tests under `CrossTabDataBus cross-tab replay consistency contract` cover the producing-tab stamp, local-handler parity, post-write late join with replay, and local-origin replay path.
- One e2e replay-persistence test now uses `toMatchObject` to tolerate the additional `originTabId` field on persisted entries.

### Changed
- `WorkerClusterRuntime.onEvent` handler signature now includes a fourth `originTabId?: string` argument; existing call sites use `toMatchObject` so the extra argument does not break strict equality.

## [0.20.60] - 2026-09-04

### Added
- `publishBatch(topic, items)` on both `CrossTabDataBus` and `WorkerClusterRuntime` packs multiple items into a single BroadcastChannel postMessage so the receiving owner can dispatch them in one tick instead of one channel post per item.
- Per-item `messageId` / `timestamp` is preserved across the batched wire frame, so dedup / replay / ordering still apply per item in the original order.
- Empty batch is a no-op; single-item batch delegates to `publish()` so callers do not have to special-case the boundary.
- Added a `data bus hot paths` bench case (`publishBatch / 1000 messages / 10 per call`) to give an upper-bound reference for the burst path.

## [0.20.59] - 2026-09-04

### Added
- Extended `CrossTabDataBus.getRecoveryStats()` with `generation` (monotonic counter incremented on every successful transport open) and `lastSuccessAt` (timestamp of the most recent successful open, or `null` until the transport reaches `ready`).
- Added a unit test asserting generation/lastSuccessAt advance on the initial start and after a recovery, and stay stable across failed recovery attempts.

## [0.20.58] - 2026-09-04

### Changed
- Bounded the publish route-owner cache to a configurable LRU cap (default 256), evicting the oldest entry on overflow.
- Surfaced route-owner cache diagnostics (`size`, `max`, `hits`, `misses`) on `WorkerClusterRuntime.getSnapshot()` so callers can observe warm vs. cold route resolution.
- Fixed a correctness bug where `wildcardPublishCache`'s `null` entry short-circuited the remote-owner publish path; topics with no local wildcard subscription now still consult the route-owner cache and forward to the remote owner.

### Added
- Added `routeOwnerCacheMax` to `WorkerClusterOptions` for tuning the route-owner cache size per workload.
- Added unit tests for LRU eviction, TTL-based cache invalidation, owner migration, and remote-owner cache hits.

## [0.20.57] - 2026-09-04

### Added
- Added warm/cold route-cache publish benchmark coverage to make owner-routing performance measurable.

## [0.20.56] - 2026-09-04

### Changed
- Added generation-checked route-owner caching for publish routing and cleared it across lifecycle teardown.

## [0.20.55] - 2026-09-04

### Changed
- Added a bounded wildcard publish decision cache with lifecycle-safe invalidation.

## [0.20.54] - 2026-09-04

### Added
- Added `errorAt` to `getRecoveryStats()` for recovery incident timing.


## [0.20.53] - 2026-09-04

### Added

- Extended `getRecoveryStats()` with a safe `errorMessage` summary for diagnostics without exposing the raw error object.

## [0.20.52] - 2026-09-04

### Added

- Extended `getRecoveryStats()` with `hasError`, exposing whether the current transport error is still retained.

## [0.20.51] - 2026-09-04

### Added

- Added a public recovery-state snapshot API via `getRecoveryStats()`.

## [0.20.50] - 2026-09-04

### Added

- Added owner-handoff unsubscribe coverage proving a handed-off route is not recreated after the surviving tab unsubscribes.

## [0.20.49] - 2026-09-04

### Added

- Added unsubscribe-before-reconnect coverage proving removed topics are not replayed after lifecycle recovery.

## [0.20.48] - 2026-09-04

### Added

- Added multi-topic recovery coverage proving every topic is restored exactly once after reconnect.

## [0.20.47] - 2026-09-04

### Added

- Added extended reconnect flapping coverage proving replay stays bounded and duplicate-free.

## [0.20.46] - 2026-09-04

### Added

- Added repeated worker capability-probe coverage proving auto backend selection remains deterministic across repeated checks.

## [0.20.45] - 2026-09-04

### Added

- Added repeated WebSocket error/restart coverage proving only the newest connection remains active.

## [0.20.44] - 2026-09-04

### Added

- Added a lifecycle contract regression proving stale WebSocket close/error callbacks cannot affect a restarted session.

## [0.20.43] - 2026-09-04

### Added

- Added repeated WebSocket stop/start cleanup coverage proving subscriptions and stale callbacks are cleared across lifecycle cycles.

## [0.20.42] - 2026-09-04

### Added

- Added repeated Dedicated Worker stop/start cleanup coverage proving STOP boundaries detach stale worker delivery across lifecycle cycles.

## [0.20.41] - 2026-09-04

### Added

- Added repeated SharedWorker stop/start resource-soak coverage proving listeners and heartbeat timers are released after every cycle.

本项目遵循 [Semantic Versioning](https://semver.org/)；变更记录格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [0.20.40] - 2026-09-04

### Added

- Added auto worker-mode repeated failure/recovery coverage proving SharedWorker preference remains stable and stale ports cannot deliver publications after successive reopen cycles.

## [0.20.39] - 2026-09-03

### Added

- Added repeated Dedicated Worker failure/recovery coverage proving stale messages from superseded workers cannot reach the reopened session.

## [0.20.38] - 2026-09-03

### Added

- Added repeated SharedWorker failure/recovery coverage proving stale messages from multiple superseded ports cannot reach the reopened session.

## [0.20.37] - 2026-09-03

### Added

- Added a repeated WebSocket replacement regression proving stale lifecycle/message callbacks from multiple superseded sockets cannot leak into the newest session.

## [0.20.36] - 2026-09-03

### Added

- Added a high-frequency publish regression proving local-owner fast-path publication preserves ordering and avoids storage reads across a 1,000-message burst.

## [0.20.35] - 2026-09-03

### Added

- Added public data-bus hot-path benchmarks for publish and receive/dispatch throughput, complementing routing and cluster coordination baselines.

## [0.20.34] - 2026-09-04

### Added

- Added a transport-recovery regression covering replay history, duplicate suppression, persistence append boundaries, and late-handler ordering after automatic resubscription.

## [0.20.33] - 2026-09-03

### Added

- Added `pnpm verify:compat` to compare the current package manifest with a prior release tag and reject removed public exports, module conditions, or type metadata.

## [0.20.32] - 2026-09-03

### Added

- Added a replay/dedup combination regression covering hydrated history, live delivery after recovery, duplicate suppression, persistence append boundaries, and late-handler replay ordering.

## [0.20.31] - 2026-09-04

### Fixed

- WebSocket transport now isolates stale socket lifecycle and message callbacks after stop/start replacement, preventing late frames from an old connection entering a new session.

### Added

- Added regression coverage for stale-socket isolation during transport replacement.

## [0.20.30] - 2026-09-04

### Added

- Extended the real IndexedDB replay persistence E2E through a BFCache round trip before reload, verifying ordered durable history and asynchronous replay hydration across both lifecycle transitions.

## [0.20.29] - 2026-09-04

### Added

- Added an exhaustive worker backend fallback matrix covering dedicated, shared, and auto preferences across every capability combination.

## [0.20.28] - 2026-09-04

### Added

- Expanded packed-consumer verification into a release compatibility matrix covering package version metadata, dual-format export targets, declaration files, and root/subpath consumers.

## [0.20.27] - 2026-09-04

### Added

- Added a real Chromium long-soak regression covering repeated BFCache pagehide/pageshow cycles, reloads, owner handoff, reconnect readiness, and duplicate-free delivery.

## [0.20.26] - 2026-09-04

### Added

- Added trace diagnostics contract coverage for privacy-safe fields, events/metrics mode isolation, repeated sink failures, reliability schema timestamps, bounded state, and lifecycle metrics windows.

### Fixed

- Stopped trace reporters no longer emit metrics from later manual flushes until explicitly started again.

## [0.20.25] - 2026-09-03

### Added

- Added WebSocket, Centrifuge, and shared publication-parser compatibility coverage for legacy frames, nested envelopes, unknown fields, invalid optional metadata, and unknown worker protocol variants.

## [0.20.24] - 2026-09-03

### Added

- Added a long-running replay/dedup regression covering quiet-period TTL sweeps, re-acceptance after expiry, durable retention cleanup, asynchronous hydration, and lifecycle timer shutdown.

## [0.20.23] - 2026-09-03

### Added

- Added a BFCache + transport-error owner-handoff regression covering recovery, takeover, and duplicate-free delivery across two tabs.

## [0.20.22] - 2026-09-03

### Fixed

- Explicit stop/restart lifecycles now reset recovery attempt and exhaustion state so a new session starts with a fresh diagnostic sequence.

## [0.20.21] - 2026-09-03

### Fixed

- Recovery exhaustion diagnostics are now emitted at most once per failed recovery sequence and reset after a successful reopen.

## [0.20.20] - 2026-09-03

### Added

- Automatic recovery now emits an `exhausted` reliability event when `recovery.maxAttempts` is reached, instead of stopping silently.

## [0.20.19] - 2026-09-03

### Added

- Added optional `recovery.maxAttempts` to cap automatic transport reopen attempts while preserving explicit demand-driven recovery.
- Added validation and regression coverage for capped recovery sequences.

## [0.20.18] - 2026-09-03

### Added

- Added optional `recovery.cooldownMs` to tune automatic transport reopen pacing for different runtime environments.
- Added validation and fake-timer coverage for custom recovery cooldowns.

## [0.20.17] - 2026-09-03

### Added

- Consecutive transport recovery traces now carry monotonic attempt numbers and reset after a successful reopen.
- Added regression coverage for multi-failure recovery sequences.

## [0.20.16] - 2026-09-03

### Added

- Transport recovery trace events now report `scheduled`, `succeeded`, and `failed` outcomes, making reconnect failures diagnosable without exposing payloads or connection details.
- Added regression coverage for failed recovery followed by a successful retry.

## [0.20.15] - 2026-09-03

### Added

- Added transport status-flapping regression coverage to ensure repeated connection state notifications do not duplicate or lose assigned topic subscriptions.

## [0.20.14] - 2026-09-03

### Changed

- Release jobs now preserve published-consumer verification failures as explicit summary diagnostics without marking an otherwise successful publish as failed; local verification remains strict.

## [0.20.13] - 2026-09-03

### Added

- CI now uploads Playwright reports and test results when browser E2E fails, preserving actionable diagnostics for flaky runner failures.

## [0.20.12] - 2026-09-03

### Added

- Published-consumer verification now reports package and optional peer-dependency link context when an import fails on CI.

## [0.20.11] - 2026-09-03

### Added

- Release workflow runs one serialized job per tag and records the exact npm version, tag, and commit in the GitHub step summary for easier failure diagnosis.

## [0.20.10] - 2026-09-02

### Added

- Added reconnect-cycle regression coverage proving every assigned topic is replayed exactly once per transport reconnect.

## [0.20.9] - 2026-09-02

### Fixed

- Published-consumer verification now accepts both npm versions (`0.20.9`) and Git tags (`v0.20.9`) as input.

## [0.20.8] - 2026-09-02

### Added

- Release verification now retries npm tarball resolution to tolerate registry propagation after publication.
- The release workflow always verifies the exact tagged package's ESM and CommonJS consumers after the publish-or-skip step.

## [0.20.7] - 2026-09-02

### Added

- Added published-package consumer verification that downloads the npm version, then imports every public ESM and CommonJS entry point from a clean temporary consumer.
- The verification can target `PUBLISHED_VERSION` explicitly, making release validation independent from the local checkout version.

## [0.20.6] - 2026-09-02

### Added

- Added a release checklist covering local gates, packed-consumer verification, tag creation, and manual npm publication.
- Added migration guidance for pre-0.20 consumers and clarified that historical npm versions are immutable and are not republished from the current tree.

## [0.20.5] - 2026-09-02

### Added

- Added public-consumer freeze coverage for root, hooks, Vue, and Centrifuge subpaths across ESM and CommonJS artifacts.
- Declaration checks now verify the shipped `.d.ts` files and key replay, deduplication, and publication metadata types.

## [0.20.4] - 2026-09-02

### Added

- Added a real Chromium multi-tab soak scenario covering repeated fan-out, owner migration, BFCache round trips, reload recovery, and duplicate-free delivery.
- Browser regression coverage now exercises lifecycle transitions as one continuous session instead of isolated one-shot checks.

## [0.20.3] - 2026-09-02

### Added

- Added React lifecycle coverage for dynamic topic changes.
- Topic replacement now verifies old subscriptions are removed before the new topic is delivered, including end-to-end WebSocket hook wiring.

## [0.20.2] - 2026-09-02

### Added

- Added protocol recovery coverage proving valid WebSocket publications continue after malformed binary and text frames.
- Binary truncation, JSON parse failures, nested envelopes, and error isolation are now exercised as one compatibility sequence.

## [0.20.1] - 2026-09-02

### Added

- Added persistence mutation-sequence soak coverage spanning hydration, retry recovery, topic cleanup, subsequent append, and full cleanup.
- Recovery tests now verify that serialized persistence operations remain usable after transient failures.

## [0.20.0] - 2026-09-02

### Added

- Formalized publication-envelope compatibility coverage across legacy, nested, fallback-topic, primitive payload, metadata, and unknown-field frames.
- Empty or missing topics are rejected consistently while transport-supplied fallback channels remain supported.

## [0.19.9] - 2026-09-02

### Added

- Added regression coverage for deduplication and replay/persistence composition.
- Duplicate publications are verified not to pollute replay history, while IDs can re-enter history after TTL expiry.

## [0.19.8] - 2026-09-02

### Fixed

- IndexedDB replay persistence now invalidates cached connections after transaction creation or request failures.
- Closed or otherwise unusable connections can recover through the existing persistence retry path without recreating the adapter.

## [0.19.7] - 2026-09-02

### Fixed

- IndexedDB replay persistence no longer permanently caches a rejected `open()` promise after transient initialization failures.
- Subsequent persistence operations can reopen the database and recover without recreating the adapter.

## [0.19.6] - 2026-09-02

### Fixed

- IndexedDB replay persistence now handles cross-tab `versionchange` events by closing stale connections and reopening on the next operation.
- Multi-tab schema changes no longer leave the adapter permanently bound to an invalid connection.

## [0.19.5] - 2026-09-02

### Fixed

- React `useCrossTabDataBus` now ignores stale effect generations during rapid dependency changes.
- Superseded asynchronous cleanup can no longer clear or overwrite the newest bus lifecycle.

## [0.19.4] - 2026-09-02

### Fixed

- Vue `useCrossTabDataBus` now guards against stale asynchronous stop/start completions during rapid reactive dependency changes.
- A superseded lifecycle no longer resurrects an obsolete bus instance after a newer dependency update.

## [0.19.3] - 2026-09-02

### Added

- Added optional `dedup.sweepMs` for periodic expiry cleanup during quiet periods.
- Dedup sweep timers follow start/resume and pagehide/stop lifecycle boundaries.

## [0.19.2] - 2026-09-02

### Fixed

- Pending persistence retries are cancelled across `stop()` and pagehide suspension boundaries.
- Lifecycle-cancelled retries no longer emit persistence errors or start another adapter attempt.

## [0.19.1] - 2026-09-01

### Fixed

- WebSocket transport now accepts browser `Blob` binary frames and decodes them through the existing ArrayBuffer protocol path.
- Blob conversion failures are isolated through the transport error handler without crashing the message callback.

## [0.19.0] - 2026-09-01

### Added

- Persistence retry now emits opt-in `reliability` trace events with the bounded operation name and retry attempt.
- Retry diagnostics cover `load`, `append`, `clear`, `clearTopic`, and `clearBefore` without exposing payloads or error bodies.

### Compatibility

- Tracing remains disabled by default; retry timing, adapter contracts, and final error behavior are unchanged.

## [0.18.0] - 2026-09-01

### Added

- Added opt-in `replay.persistenceRetry` with bounded attempts and exponential backoff for transient persistence failures.
- Replay append, hydrate, clear, topic cleanup, and retention cleanup now share the same retry policy.
- Exported `DataBusPersistenceRetryOptions` for typed configuration.

### Compatibility

- The default retry policy is one attempt, preserving existing persistence behavior and error timing.
- Persistence adapters remain unchanged; retry orchestration stays in `CrossTabDataBus`.

## [0.17.0] - 2026-09-01

### Added

- Added optional `replay.retentionSweepMs` for periodic durable replay retention cleanup when no new publications arrive.
- Retention sweeps follow the DataBus lifecycle: start/resume enables the timer, while pagehide/stop disables it.
- Added fake-clock lifecycle coverage for timer cleanup and invalid sweep intervals.

### Compatibility

- `retentionSweepMs` is opt-in and has no effect without both `retentionMs` and a persistence adapter implementing `clearBefore()`.
- Existing publication-triggered cleanup, manual cleanup, and replay persistence contracts remain unchanged.

## [0.16.0] - 2026-09-01

### Added

- Replay retention cleanup is coalesced during publication bursts; the newest cutoff wins while cleanup mutations remain serialized.
- WebSocket binary-frame compatibility coverage now verifies truncated, invalid-magic, and incomplete-header frames are ignored safely.

### Compatibility

- Retention cleanup remains opt-in through `replay.retentionMs`; manual `clearReplayBefore()` behavior is unchanged.
- Existing JSON, nested publication-envelope, and legacy binary payload formats remain supported.

## [0.15.0] - 2026-09-01

### Fixed

- Replay retention now preserves legacy messages that do not carry an explicit producer timestamp; only timestamped messages older than the cutoff are removed.

### Added

- Trace event timestamps accept an injectable `trace.now` clock for deterministic lifecycle and metrics tests.
- Added compatibility coverage for timestamp-less replay cleanup and injected trace clocks.

### Compatibility

- Existing `DataBusTraceOptions` and replay persistence adapters remain source-compatible; wall-clock behavior remains the default.

## [0.14.0] - 2026-09-01

### Fixed

- Vue `useCrossTabSubscription` now rebinds when a reactive topic changes on the same bus instance.

### Added

- Vue topic-switch lifecycle regression coverage.
- Release scope documents cross-page replay mutation ordering and adapter parity guarantees.

## [0.13.0] - 2026-09-01

### Added

- IndexedDB replay mutations are serialized per adapter instance, preventing concurrent append read-modify-write races from losing history.
- Dedup memory is reset as part of a full stop lifecycle, so a restarted bus begins with a clean delivery window.
- Added persistence-failure diagnostics and lifecycle regression coverage.

## [0.12.0] - 2026-09-01

### Added

- Deduplication TTL now accepts an injectable `dedup.now` clock for deterministic tests and host runtimes without a wall-clock dependency.
- Persistence failures in replay append/cleanup paths emit bounded `persistence_cleanup` reliability diagnostics before reaching error handlers.
- Publication parsing now accepts only non-empty message IDs and finite timestamps, while preserving legacy payload compatibility.
- Added protocol compatibility tests for legacy, nested, fallback-topic, and malformed metadata frames.

### Compatibility

- `dedup.now` is optional and existing configurations keep wall-clock behavior.
- Invalid metadata is ignored instead of poisoning a publication; the topic and payload remain deliverable.

## [0.11.0] - 2026-09-01

### Added

- Automatic durable replay retention via `replay.retentionMs` when a persistence adapter supports `clearBefore`.
- Deduplication accepted/suppressed counters in periodic `message_metrics` trace snapshots.
- Service Worker runtime boundary documented as intentionally deferred pending stable browser lifetime semantics.

### Compatibility

- Existing replay adapters remain valid; `retentionMs` is ignored when an adapter does not implement `clearBefore`.
- Existing trace consumers can continue reading the original metrics fields; dedup counters are additive.

## [0.10.0] - 2026-09-01

### Added

- Formal transport-neutral publication metadata types (`DataBusPublication`, `DataBusPublicationMetadata`, and `DataBusPublicationEnvelope`).
- Publication metadata (`messageId` and `timestamp`) now traverses cluster controls, Centrifuge Worker boundaries, and WebSocket publish frames.
- Demo WebSocket server emits the canonical nested publication envelope and preserves caller metadata; real-browser contract coverage added.

### Compatibility

- Flat WebSocket publication frames remain accepted.
- Existing payloads without metadata retain their legacy shape.

## [0.9.0] - 2026-09-01

### Added

- Dedup runtime statistics (`getDedupStats`) and reset API (`resetDedup`).
- Replay retention APIs: `clearReplayTopic` and `clearReplayBefore`; IndexedDB supports optional time-based pruning.
- Forward-compatible WebSocket publication envelope parsing with timestamp and message ID metadata.

## [0.4.0] - 2026-08-30

### Added

- 消息重放（有界本地历史）：`replay: { maxPerTopic }` 选项 + `subscribe(topic, handler, { replay: true | n })`，晚加入的 handler 立即收到缓冲历史（`message.replayed: true` 标记）；仅缓冲已分发消息，内存环形队列，最后一位 handler 退订即清空；通配订阅跨匹配 topic 回放。
- 性能基准套件：`pnpm bench`（routing 纯函数 / cluster 协调 / 通配匹配共 8 项基线）。
- e2e：二进制发布按钮 × WebSocket 后端跨 Tab 往返。

### Changed

- 校验 `replay.maxPerTopic` 必须为正安全整数，并从根入口导出 `DataBusReplayOptions`。
- CJS 产物在无法解析模块相对 Worker URL 时抛出可操作的错误信息，并补充使用说明。

- BFCache e2e 在 `pageshow` 后等待 transport 恢复完成，避免把合法的异步恢复窗口误判为重复投递。

## [0.8.0] - 2026-08-31

### Added

- 0.8.0 development: optional `publish(topic, data, { messageId })` metadata now propagates through cluster routing and supported transports.
- Explicit `bus.clearReplay()` retention cleanup for in-memory and durable replay stores.
- Dedup suppression is observable through reliability trace events (`dedup_suppressed`).

## [0.7.0] - 2026-08-31

### Added

- Replay persistence lifecycle cleanup (`clear` / `clearTopic`) with stale-history removal on unsubscribe.
- Opt-in reliability diagnostics for recovery retries, owner acknowledgments, and route migrations.
- Bounded, opt-in publication deduplication with caller-supplied message IDs.
- React/Vue and custom-transport compatibility fixtures plus browser/package regression coverage.

### Implemented in the current 0.7.0 worktree

- Replay persistence now supports optional `clear()` and `clearTopic()` lifecycle hooks; `CrossTabDataBus` invokes them on stop and final topic unsubscribe.
- Trace exports bounded `reliability` events for transport recovery attempts, route acknowledgments, and graceful route migrations.
- `DataBusMessage.messageId` plus opt-in `dedup: { maxEntries, ttlMs }` suppresses duplicate inbound publications with bounded memory.

## [0.6.0] - 2026-08-31

### Changed

- `publish()` 在当前 Worker 已同步持有 topic owner assignment 时走本地快路径，避免每条消息重复扫描 worker/route storage；跨 Tab 路由仍保留原有存储校验。
- 新增独立 `./vue` 入口，提供 `useCrossTabDataBus`、`useCrossTabSubscription` 和 `useCrossTabStatus`；Vue 3 作为可选 peer dependency，不影响核心入口。
- WebSocketTransport 与内置 demo 支持 `ArrayBuffer` 二进制帧往返；JSON payload 协议保持兼容。

## [0.5.0] - 2026-08-31

### Added

- 真实浏览器发布基准入口：`pnpm bench:browser`，在本地 Centrifuge 演示服务上用两个真实标签页分别测 dedicated/shared Worker 的跨 Tab 发布耗时。
- 可选 replay 持久化契约与 IndexedDB 实现：`createIndexedDbReplayPersistence({ maxPerTopic })`；默认仍为纯内存，持久化失败通过错误处理器报告。
- E2E：新增真实 Chrome reload 场景，验证 IndexedDB replay 历史在页面重建后恢复（总计 8 项 E2E）。

### Notes

- 当前基准包含页面点击、JSON 序列化、Worker/Storage/BroadcastChannel、服务端回显和接收端渲染，结果用于端到端回归趋势，不等同于核心 `publish()` 微基准。
- 2026-08-31 本机 Chrome 100 条消息采样：dedicated 约 34.03 ms/条，shared 约 33.89 ms/条；两者接近，暂不据此改动 publish 路径，避免在缺少核心 profile 时引入陈旧路由缓存。

## [0.3.0] - 2026-08-29

### Added

- 双格式发布：新增 CJS 构建（`dist/cjs/*.cjs`），`exports` 增加 `require` 条件，CommonJS 消费者（`require()`、CJS bundler 配置）可直接使用；新增构建产物冒烟测试（`pnpm check` 先构建后测试）。
- 原生 WebSocket 传输后端：`WebSocketTransport` + `createWebSocketDataBus`（零依赖，极简 JSON 帧协议），验证 `DataBusTransport` 多后端抽象；含 9 个单元测试。
- Topic 通配符订阅：`chat.*` 后缀通配与 `*` 全匹配。pattern 以字面量参与路由/归属/传输订阅（服务器需支持 channel pattern 并以具体 topic 标注发布，或直接以 pattern 标注）；dispatch 侧新增通配匹配——owner 门（`isAssigned`）、本地订阅门（`hasLocalSubscriber`）与 handler 分发均按 pattern 匹配具体 topic。新增纯函数 `isWildcardTopic` / `topicMatchesPattern` 与 10 个相关测试。
- React hooks 适配层：独立入口 `cross-tab-worker-databus/hooks`，导出 `useCrossTabDataBus`（StrictMode 安全的 bus 生命周期）、`useCrossTabSubscription`（handler 经 ref 读取，内联闭包不重订阅）、`useCrossTabStatus`；React（>=18）为可选 peer 依赖；jsdom 渲染测试 3 个。
- 示例与演示服务器：demo 页新增「WebSocket」后端模式（连接内置 `/ws/demo` 演示服务器，支持 pattern 订阅与发布回显）；新增 `scripts/demo-ws-server.mjs` 与 12 个契约测试；新增 WebSocket 后端跨 Tab 收发 e2e（全套 6 个）。

### Changed

- `main` 字段指向 CJS 入口（`./dist/cjs/index.cjs`），`module`/`exports.import` 仍为 ESM；worker 入口保持 ESM module worker 不变。

## [0.2.1] - 2026-08-29

### Added

- 发布自动化：tag 触发的 GitHub Actions release workflow（typecheck + 单测 + build 门禁 → 从 CHANGELOG 抽取版本说明创建 GitHub Release → `npm publish --provenance`）。
- 测试基建：ESLint（typescript-eslint flat config，含 `lint` 脚本）、Vitest 覆盖率（`pnpm test:coverage`，阈值 statements 85 / branches 80 / functions 90 / lines 85）、`.editorconfig`。
- 51 个新单元测试（137 → 188）：`CentrifugeSession` 协议分支（UNSUBSCRIBE、server-side publication、错误序列化）、浏览器环境适配层（`createBrowserEnvironment`/`getOrCreateTabId`/`canUseStorage`）、trace 上限截断与 sink 异常隔离、cluster 健壮性（损坏 JSON、存储写失败、TTL 清理、handoff UNSUBSCRIBE 短路、路由抢占 reconcile）、routing/storage-batch/port-reaper 边界分支、`CentrifugeWorkerTransport` 边界路径。
- 1 个新 E2E：BFCache 往返（pagehide 交接 + pageshow 恢复后双向收发）。
- React 18 使用示例（`examples/react`，StrictMode 安全的 bus 生命周期）；示例服务器支持 `.jsx`。
- README（中英）FAQ 与 0.1 → 0.2 迁移说明。

### Changed

- 包导出加固：`./centrifuge.worker` / `./centrifuge.shared.worker` 补 `types` 条件（指向 `dist/workers/*.d.ts`）；新增 `sideEffects` 白名单保护 worker 产物不被 tree-shake；`prepublishOnly` 门禁（`pnpm check`）。
- tsconfig 追加严格开关：`noFallthroughCasesInSwitch`、`noImplicitOverride`、`allowUnreachableCode: false`（零代码改动通过）。
- 测试总覆盖率：语句 89.9% → 96.6%，分支 86.3% → 90.9%（environment 32.9% → 100%，centrifuge-session 77.8% → 100%）。

### Fixed

- 清理 18 处 ESLint 违规：未使用变量/导入、注释中的 U+202F 不规则空白。
- `scripts/serve-examples.mjs` 之前不识别 `.jsx` MIME 导致模块脚本被拒（随新示例修复）。

## [0.2.0] - 2026-08-27

### Changed

- `centrifuge` 从 `dependencies` 改为 optional `peerDependencies`：仅在使用内置 Centrifuge 后端时需要安装，核心包零运行时依赖。
- `CentrifugeSession.handle()` 由连续 `if` 改为 `switch` + `default`，未知消息类型静默忽略，为未来协议扩展留出兼容余地。
- `routing.ts` 的 workerId 平局处理由 `localeCompare` 改为数值比较，消除宿主 locale 对路由确定性的影响。
- `port-reaper.ts` 提取 `computeMinHeartbeat()` 方法，reap 迭代改用 `Array.from` 快照，reaper 节奏计算与计时器逻辑解耦。
- `centrifuge-protocol.ts` 新增 `DEFAULT_SESSION_TIMEOUT_MS` 派生常量，消除 `port-reaper` 中重复的字面量计算。
- `CentrifugeWorkerTransport` 提取 `buildInitInput()` 与 `postToPortLike()` helper，消除 `start()`/`post()` 中的重复构造逻辑。
- `cluster.ts` 提取 `readAllByPrefix()` helper，统一 `readWorkers`/`cleanupOrphanedRoutes`/`cleanupOrphanedSubscribers`/`getSnapshot` 的 listKeys+readJson 循环；删除无调用点的 `listKeysSafe`。
- `cluster.ts` 提取 `buildLocalRoute()`，将 `readRoute` 的无 storage 降级分支独立命名并补文档；`readSubscriberTabIds` 同类分支拆为多行可读形式。
- `cluster.ts` 提取 `sendRouteReleased()` helper，消除三处 `ROUTE_RELEASED` 消息构造的重复；`handoffAssignedTopics` 的 generation 计算复用单次求值；`reconcileAssignedTopics` 去除同一 topicKey 的二次 `readRoute` 调用。
- `cluster.ts` `releaseSubscription` 返回 topicKey，`unsubscribe` 复用而非重新哈希；`handleMessage`/`handleControlMessage`/`sendControl` 连续 `if` 改 `switch`；`getSnapshot` 的序列化改用 `Array.from`。
- `data-bus.ts` `onControl` 连续 `if` 改 `switch`；提取 `invokeHandlers()` 统一 dispatch/status/error 三处 handler 遍历的 try-catch 隔离；提取 `formatWorkerTrace`/`formatRouteTrace` 格式化函数。
- `trace.ts` 提取 `metricsActive` getter，统一四个 record/flush 方法的守卫表达式。
- `cluster.ts` 提取 `routeOwnerIsLive()` 与 `isActiveAmong()`，消除 subscribe/publish 和 isActiveWorker/refreshRole 中的重复 route+workers.some / selectActiveWorkers+some 模式。
- `cluster.ts` 提取 `isStaleRouteRelease()`，命名 handleRouteReleasedMessage 的守卫条件。
- `cluster.ts` `activate()` 合并两个分支的 rememberTopic 调用为单循环；`handoffAssignedTopics` 去掉同一 topicKey 的二次 readRoute。
- `cluster.ts` `readSubscriberTabIds` 改用 `readAllByPrefix` + `Array.from`；`getSnapshot` 序列化改用 `Array.from` + mapping callback。
- `data-bus.ts` 提取 `formatWorkerTrace`/`formatRouteTrace` 格式化函数；`invokeHandlers` 的 label 参数改为联合类型字面量而非自由字符串。
- 多处 JSDoc/注释补全：writeRecord notify 参数、activate channel 判空、reconcileWorkers cleanup 顺序、rememberTopic eviction break、suspendTransport pendingStop 守卫、reopenTransport startPromise 检查、trace flushNow 条件、storage-batch flush break / scheduleFlush 降级 / scheduleRetry、port-reaper 各方法守卫、centrifuge assertHeartbeatInterval/assertStructuredCloneable/deserializeWorkerError、environment canUseStorage。

### Documentation (JSDoc 全覆盖)

- `hash.ts` 提取 seed/prime/avalanche 常量与 `avalancheMix()` 函数，补非 ASCII 字符处理注释。
- `types.ts` 全部类型（WorkerRecord/WorkerRoute/WorkerClusterMessage/DataBusTransport/DataBusMessage/handler 别名）字段级 JSDoc 补全。
- `centrifuge-protocol.ts` 全部协议变体（WorkerUnsafeOption/CentrifugeWorkerConfig/CentrifugeWorkerInput 各变体/CentrifugeWorkerOutput 各变体/SerializedWorkerError）JSDoc 补全。
- `worker-mode.ts` WorkerMode/WorkerBackend/WorkerAvailability/selectWorkerBackend JSDoc 补全。
- `routing.ts` DEFAULT_MAX_ACTIVE_WORKERS/selectLeastLoadedWorker JSDoc 增强。
- `storage-batch.ts` INITIAL/MAX_RETRY 常量 + BatchingStorageWriter 类 + pendingSize getter JSDoc 补全。
- `trace.ts` normalizeInterval/roundMs JSDoc 补全。
- `environment.ts` ClusterEnvironment 各字段 + canUseStorage JSDoc 补全。
- `cluster.ts` readJson/writeJson/WorkerClusterOptions 各字段 JSDoc 补全。
- `data-bus.ts` PUBLICATION_EVENT/getStatus/getClusterSnapshot/CrossTabDataBusOptions JSDoc 补全。
- `centrifuge.ts` handleOutput/onWorkerFailed JSDoc 补全。

### Documentation

- 架构运行时图（中英）补全 `BatchingStorageWriter`、`PortReaper`、`CentrifugeSession`、`CentrifugeWorkerTransport` 节点，与代码结构对齐。
- `AGENTS.md` 目录注释明确列出每个测试文件职责。
- `README`（中英）补充 `centrifuge` 为可选 peer 依赖的安装说明。
- `trace.ts`、`environment.ts` 补充 JSDoc：trace 模式与选项字段含义、SSR 场景的 storage/ BroadcastChannel 检测说明。

## [0.1.2] - 2026-08-24

### Fixed

- `BatchingStorageWriter` 在结构性写失败（如某 key 让底层 storage 持续抛错）时不再无限重试：每个 key 最多重试 5 次后丢弃并 `console.warn`，避免协调平面永久卡住。
- `PortReaper.setTimeout` 校验 `heartbeatIntervalMs` 为有限正数，`0`/`NaN`/负数回退默认值，防止 reaper 退化为忙循环或沉睡。
- `CentrifugeSession.unsubscribe` 先移除 subscription 监听器再退订，避免迟到的 `unsubscribed` 事件删除重订阅后的 subscription（幽灵订阅竞态）。
- `rememberTopic` FIFO 淘汰改为向前扫描首个非 own 条目，`knownTopics` 在有非 own 条目时真正不超 `MAX_KNOWN_TOPICS` 上限。
- `DataBusTraceReporter.pause()` 清零 `intervalStartedAt`，避免 stop 后手动 flush 算出异常大的 `durationMs`。

### Documentation

- 架构文档（中英）补充 transport 层 client 级与 subscription 级 publication 去重说明。
- 配置文档（中英）补充 SharedWorker reaper 的失败隔离与关闭清理行为。

## [0.1.1] - 2026-08-24

### Fixed

- 防止 centrifuge 客户端级 `publication` 与 subscription 级监听重复派发同一消息：client 级现在跳过已有 subscription 的 topic，仅处理 server-side subscription 的 publication。
- `PortReaper.dispose()` 关闭并停止所有追踪中的 session，避免 SharedWorker 关闭时遗留 WebSocket 连接。
- `PortReaper.reap()` 对 `target.close()`/`target.stop()` 加 try-catch，单个异常 port 不再瘫痪后续死 tab 的回收。

## [0.1.0] - 2026-08-24

首次公开发布。

### Added

- 框架无关的跨标签页发布/订阅数据总线，通过 BroadcastChannel 在同源标签页间分发消息
- Dedicated Worker / Shared Worker / 本地线程三档 transport 后端，`auto` 模式自动降级
- 基于 localStorage + BroadcastChannel 的 Worker 集群协调：粘性 Topic owner 路由、新 Topic 负载均衡、owner 崩溃 failover、`pagehide` 优雅交接
- 内置 Centrifuge WebSocket transport，连接、订阅、token 刷新、二进制数据均在 Worker 内处理，不阻塞主线程
- ArrayBuffer Transferable 支持，零拷贝传输二进制 publication
- 本地 handler 引用计数与订阅排队：连接期间订阅不丢失，去重 transport subscribe 调用
- 可选结构化 trace：生命周期、连接状态、协调快照、订阅事件，以及分桶延迟直方图（P50/P95/Max）与吞吐聚合指标
- localStorage 写入合并与指数退避重试，协调元数据写入移出热路径
- 连接 URL 与 Topic 通过 128 位非加密哈希转为不透明 key，明文不落入 localStorage 键名
- SharedWorker 端口回收器：主线程 PING 心跳 + 静默超时回收，崩溃 Tab 未发 STOP 也不泄漏 session
- 优雅降级：localStorage/BroadcastChannel 不可用时退化为本地单 Tab 模式

### Documentation

- 英文与中文文档：架构、API 参考、配置、快速上手、能力矩阵
- 多标签页浏览器演示页，可视化数据流、延迟指标与集群路由状态
