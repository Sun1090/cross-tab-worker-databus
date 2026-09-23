# AGENTS.md — cross-tab-worker-databus

A framework-agnostic cross-tab data bus with Dedicated/Shared Worker clustering and Centrifuge support.

## Autonomous Execution and Branch Lifecycle

- Work continuously from repository evidence: inspect → choose the highest-priority executable task → implement → test → fix → verify → commit → update progress → inspect again. Do not stop merely because one task, commit, PR, release, or milestone is complete.
- Before coding, inspect the roadmap/milestones, TODO/FIXME markers, CI/build/test status, and `docs/progress.md`; create `docs/progress.md` when the repository uses no equivalent progress log.
- Prioritize blockers, failing quality/security gates, core bugs, milestone critical paths, tests/migrations, performance/CI, dependencies/security, then documentation. Fix discovered issues when feasible instead of only recording them.
- Stop only when all executable work is complete, a product decision or credential/external permission is required, an upstream dependency blocks every remaining task, or a hard tool/context limit prevents further progress.
- Use a focused topic branch and atomic Conventional/Angular commits unless this repository explicitly requires direct-to-main development. Rebase with `git fetch origin && git rebase origin/<base>`; never create merge commits, force-push, rewrite shared history, or change repository protection rules.
- **Remote topic branches are temporary PR transport, not persistent storage.** Do not push `codex/*`, `feat/*`, or any other topic branch merely for backup/checkpoints. Push one only when opening or updating its PR. After a PR is merged or closed, delete its remote branch immediately and prune stale tracking refs. Before starting another branch, audit open PRs and remote branches; finish/merge viable work and remove branches already merged.
- Never push directly to `main`/`master` when the repository uses protected-branch PR review. Where direct-to-main is explicitly documented, that repository-specific rule takes precedence.
- Keep `docs/progress.md` (or the repository equivalent) current with milestone/version, status, branch/commit, completed work, changed files, verification, blockers, risks/rollback, next task, and update date.

## Quick reference

| Action | Command |
|---|---|
| Install deps | `pnpm install` |
| Build | `pnpm build` |
| Type check | `pnpm typecheck` |
| Unit test | `pnpm test` (vitest; excludes the perf gates) |
| Perf gates | `pnpm test:perf` (own step — absolute-ms ceilings need an unscheduled core) |
| Watch tests | `pnpm test:watch` |
| E2E test | `pnpm test:e2e` (Playwright, requires `pnpm build` first) |
| Public-surface gates | `pnpm verify:compat` (package.json `exports`/type fields vs the base tag), `pnpm verify:types` (declared export names vs the base tag + type-graph closure; requires `pnpm build`), `pnpm verify:pack` (imports every entry from the tarball) |
| Bundle example vendor deps | `pnpm build:examples` (React for `examples/react`; run by `pnpm examples` and `pnpm test:e2e`) |
| Run demo | `pnpm examples` → http://localhost:4173/examples/demo/ (adapter pages: `/examples/react/`, `/examples/vue/`) |

## Directory layout

```
src/
  index.ts                      # Public API barrel export
  core/
    cluster.ts                  # WorkerClusterRuntime — cross-tab coordination
    data-bus.ts                 # CrossTabDataBus — public API, transport lifecycle
    dedup-manager.ts            # DedupManager — bounded messageId dedup + adaptive TTL
    replay-manager.ts           # ReplayManager — ring buffers, durable persistence, retention
    environment.ts              # ClusterEnvironment adapter (port/adapter pattern)
    hash.ts                     # createOpaqueKey — 128-bit non-cryptographic hash
    routing.ts                  # Pure functions: owner selection, load balancing
    storage-batch.ts            # BatchingStorageWriter — write coalescing + backoff
    trace.ts                    # DataBusTraceReporter — metrics/latency diagnostics
    types.ts                    # All shared type definitions
  utils/
    constants.ts                # Shared string constants; literal types derive from them
    metadata.ts                 # publicationMetadata — {messageId,timestamp} spreading
    storage-utils.ts            # readJson/writeJson/listKeys/readAllByPrefix
    validation.ts               # Option validation asserts (replay/dedup/recovery/centrifuge)
    error-utils.ts              # serializeError/deserializeWorkerError + SerializedWorkerError
  centrifuge.ts                 # CentrifugeWorkerTransport + createCentrifugeDataBus
  centrifuge-session.ts         # CentrifugeSession wrapper
  centrifuge-protocol.ts        # Worker ↔ main-thread message protocol
  websocket.ts                  # WebSocketTransport + createWebSocketDataBus (zero-dep backend)
  hooks.ts                      # React hooks adapter (separate entry; React optional peer)
  worker-mode.ts                # Worker backend selection (auto/dedicated/shared)
  workers/
    centrifuge.worker.ts         # Dedicated Worker entry
    centrifuge.shared.worker.ts  # SharedWorker entry
    port-reaper.ts               # PortReaper — dead-port detection
tests/
  cluster.test.ts               # WorkerClusterRuntime tests
  data-bus.test.ts              # CrossTabDataBus integration tests
  routing.test.ts               # Pure function tests (owner selection, load balancing)
  storage-batch.test.ts         # BatchingStorageWriter write coalescing + backoff
  centrifuge.test.ts            # CentrifugeWorkerTransport backend selection + lifecycle
  centrifuge-session.test.ts    # CentrifugeSession subscribe/publish/stop protocol
  websocket.test.ts             # WebSocketTransport lifecycle + frame protocol
  environment.test.ts           # createBrowserEnvironment probes + getOrCreateTabId
  trace.test.ts                 # DataBusTraceReporter caps, percentiles, sink isolation
  dual-format.test.ts           # ESM + CJS dist artifacts expose the public API
  hooks.test.tsx                # React hooks (jsdom + @testing-library/react)
  port-reaper.test.ts           # PortReaper adaptive cadence + session timeout
  worker-mode.test.ts           # selectWorkerBackend capability detection + degradation
  hash.test.ts                 # createOpaqueKey determinism + collision properties
  fakes.ts                      # Shared test doubles (MemoryStorage, FakeTransport, etc.)
  demo-centrifuge-server.test.ts # Demo server contract tests
e2e/
  demo.spec.ts                  # Playwright multi-tab browser E2E
  adapters.spec.ts              # Vue composables driven in real tabs (examples/vue)
docs/
  architecture.md               # Detailed design doc (English + Chinese)
  api.md                        # Public API reference
  configuration.md              # TTL, worker modes, security model
  getting-started.md            # Installation & usage
```

## Architecture principles

1. **Port/adapter pattern** — `ClusterEnvironment` abstracts browser APIs (localStorage, BroadcastChannel, timers, lifecycle). Core never touches `window`/`document` directly. Tests inject fake environments.
2. **Pure function routing** — `routing.ts` is side-effect-free. Owner selection, load balancing, and active worker filtering are pure reduce/sort operations.
3. **Write coalescing** — `BatchingStorageWriter` merges same-task writes to localStorage and flushes in one microtask. Quota failures retry with exponential backoff (50ms → 1600ms). Heartbeat writes (3s interval) + route/subscriber updates would otherwise thrash storage.
4. **Sticky routes** — Topics keep their owner until the owner's heartbeat expires. Load and visibility only influence placement of *new* routes — never migrate existing ones.
5. **Strict handoff** — `generation` monotonic version + `handoffFromWorkerId` + `ROUTE_RELEASED` ACK protocol prevents overlapping subscriptions during pagehide. Uncontrolled exit (crash) falls back to heartbeat-TTL recovery.
6. **Degradation** — Storage unavailable → local mode (no cross-tab coordination). BroadcastChannel unavailable → same. Both degrade gracefully, the local transport remains usable.

## Storage key structure

```
cross-tab-worker-databus:{clusterHash}:worker:{workerId}
cross-tab-worker-databus:{clusterHash}:route:{topicKey}
cross-tab-worker-databus:{clusterHash}:subscriber:{topicKey}:{tabId}
```

`clusterHash` = `createOpaqueKey(clusterKey)`. Topic plaintext never appears in localStorage keys. BroadcastChannel control messages carry topic plaintext in memory only.

## Opaque key design

- `createOpaqueKey()` is a non-cryptographic 128-bit hash (four-lane MurmurHash-style mixing).
- Each topic gets a stable `topicKey`. The reverse mapping (`topicKey → topic`) is held in the `knownTopics` in-memory cache (FIFO eviction, max 500 entries).
- `knownTopics` never evicts a key the worker still owns (`assignedTopics` guard), because the storage-less fallback path needs it.
- `isAssigned()` deliberately recomputes the hash via `createOpaqueKey` rather than calling `rememberTopic()` — it's a read-only query that must not populate the cache.
- `clusterKey` defines the cluster boundary: different clusterKeys = fully isolated storage and BroadcastChannel namespaces.

## Wildcard topic subscriptions

- Patterns are topic strings: `*` (match everything) or a `prefix.*` suffix wildcard. `topicMatchesPattern(pattern, topic)` in `routing.ts` is the single source of matching truth (segment-boundary prefix, so `chat.*` does not match `chatter.1`).
- A pattern subscription flows through routing/ownership/transport as a literal channel — zero special-casing in the cluster coordination plane.
- Only the dispatch gates understand patterns: `cluster.isAssigned(topic)` (owner fan-out gate), `cluster.hasLocalSubscriber(topic)` (local gate), and `data-bus dispatch()` (handler iteration). Servers either deliver publications tagged with concrete topics (pattern-aware, recommended) or with the pattern itself (exact path).

## Testing guide

The project uses Vitest with fake environments. Key infrastructure in `tests/fakes.ts`:

| Utility | Purpose |
|---|---|
| `MemoryStorage` | In-memory `StorageLike` implementation. Use in place of localStorage. Provides `entries()` for inspecting all persisted keys. |
| `ChannelHub` | Simulates BroadcastChannel between runtimes. `dropNextControl()` drops the next CONTROL message to simulate channel loss. `failNextPost()` makes the next `postMessage` throw. |
| `createFakeEnvironment()` | Creates a `ClusterEnvironment` with controllable time, storage, channels, and lifecycle. Returns `.runIntervals()`, `.pageHide()`, `.pageShow()`, `.setVisibility()` for manual control. |
| `FakeTransport` | Minimal `DataBusTransport` implementation. Track `subscribeCalls`, `unsubscribeCalls`, `publishCalls`. `startShouldFail` makes `start()` report error. `stopGate` delays stop. `emit(topic, data)` simulates an incoming message; `emitError(error)` simulates an asynchronous runtime failure. |
| `expectRejectionMessage()` | Assert a promise rejects with a real `Error` whose message contains a string. Use this whenever the *message* is the behaviour under test. |

**Typical test pattern:**

```ts
const storage = new MemoryStorage();
const hub = new ChannelHub();
let now = 1_000;
const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'test' });
const runtime = new WorkerClusterRuntime({
  clusterKey: 'test-cluster',
  environment: env.environment,
  tabId: 'tab-test',
  workerId: 'worker-test',
  handlers: { onControl: vi.fn(), onEvent: vi.fn() }
});
runtime.start();
runtime.subscribe('topic');
await Promise.resolve();        // let microtask flush settle
env.runIntervals();              // trigger heartbeat + reconcile
env.pageHide();                  // simulate pagehide
env.pageShow();                  // simulate pageshow
```

**Simulating message loss:** `hub.dropNextControl()` — the next CONTROL posted to the BroadcastChannel is silently dropped. The test then verifies that the retry logic (reconcile loop) recovers the lost assignment.

**Testing startup failure:** `transport.startShouldFail = true` — the transport reports `onStatus('error')` during start. The test verifies that `CrossTabDataBus` surfaces the error via `ready()` rejection and does not leave the transport in a half-started state.

## BroadcastChannel protocol

Four message types on one channel per cluster:

| Type | Direction | Purpose |
|---|---|---|
| CONTROL | point-to-point (A → B) | SUBSCRIBE / UNSUBSCRIBE / PUBLISH |
| EVENT | broadcast (owner → all tabs) | Fan-out a publication |
| REGISTRY | broadcast | Trigger immediate reconciliation |
| ROUTE_RELEASED | point-to-point (old owner → new owner) | Handoff ACK |

The channel is unauthenticated — any same-origin script can post into it — so a receiving runtime
treats frame fields as attacker-controlled except where it checks them. Two invariants carry that
weight: `topicKey` must equal `createOpaqueKey(topic)`, because ownership is authorized by the route
stored under `topicKey` while the transport is named by `topic`, and a mismatch is therefore a
substitution rather than a variant; and `targetWorkerId` must name this worker. Both point-to-point
handlers that carry the pair enforce it — `handleControlMessage` and
`handleRouteReleasedMessage`, which is the one that *completes* a handoff, authorizes itself against the
durable route under `topicKey`, and then writes `topic` into `assignedTopics` and hands it to the
transport. `EVENT` and `REGISTRY` need no such check because they carry no key/plaintext pair, and the
sender of an ACK can itself only be poisoned through those two handlers, which is why checking the
receiver is enough: a durable route record stores `topicKey` and never the plaintext, so the key → name
mapping exists only in `knownTopics`/`assignedTopics` in memory and cannot be injected through
localStorage. When adding a field the receiver acts on, ask which of those two
it belongs to, and pin the forged-frame case — `tests/cluster.test.ts`'s
"drops a control frame whose topicKey disagrees with its topic" is the shape, and it must fail when the
guard comes out.

A third check is the *shape* of an optional field rather than its value: a `CONTROL/PUBLISH` frame that
carries `items` at all must carry a non-empty array of them, because `publishBatch()`'s
`Array.prototype.map` is the only producer. Both halves of that sentence are load-bearing, and they are
load-bearing on different legs — dropping a non-array is what keeps a `{ length: 2 }` value from throwing
out of the message listener and a `"ab"` string from becoming two publications of `undefined`, while
requiring non-empty is only visible when the runtime has an `onPublishBatch` handler (without one the loop
runs zero times either way). Presence and emptiness are checked together for the same reason: a frame with
`items` has no `data`, so letting an unusable batch fall through to the single-publication tail makes the
owner publish `undefined`. Do not extend this to validating item *content*: `{ data: anything }` is what a
legit batch looks like, so per-item shape checks would stop nothing a well-formed frame cannot do, and
`messageId`/`timestamp` are forwarded only into `transport.publish()` — the receiving side already drops a
non-string id and a non-finite timestamp in `parseDataBusPublication`.

`EVENT` is deliberately *not* held to that standard, and this is decided rather than an oversight: it
checks `eventType === PUBLICATION_EVENT` and the minimum payload shape (a `topic` string), and forwards
the rest. Delivery then requires `cluster.hasLocalSubscriber(topic)` and reaches `dispatch()`, so the
blast radius of a forged frame is "a publication appears on a topic this tab already subscribes to, and
lands in that topic's replay ring buffer" — strictly weaker than what a same-origin script can already do
by calling the page's own bus. A forged `CONTROL` frame was different in kind, not in degree: it wrote
*shared* coordination state (ownership, the durable route confirmation, the transport subscription name)
that other tabs then observe. Do not "harden" `EVENT` with an `isAssigned`/route gate: it buys nothing
against the same-origin threat and would break the older and newer SDK versions the shape-only check
exists to tolerate. Reopen this only if `EVENT` payloads gain reach beyond local handlers plus that
topic's own replay buffer.

## Reconcile loop (3s default)

Every heartbeat tick: prune stale workers (TTL), orphaned subscribers (no live tab), orphaned routes (no subscribers + expired TTL); refresh role; re-send unconfirmed CONTROL/SUBSCRIBE; recompute load. Write to worker/route/subscriber storage also broadcasts a REGISTRY nudge so peers reconcile immediately instead of waiting for the next heartbeat.

## Key internal state (see docs/architecture.md)

| Concept | Section | Summary |
|---|---|---|
| Three-tier subscription | `### Subscription state layers` | `topicHandlers` → `subscribedTopics` → `assignedTopics` → `transportSubscribedTopics` |
| Lifecycle state machine | `## Lifecycle State Machine` | `started`/`stopping`/`suspended`/`transportReady` + promise gates |
| Cache key design | `### In-memory topic key cache` | `knownTopics` FIFO eviction, storage-less dependency |
| Dispatch flow | `### Dispatch flow: three gates` | `isAssigned` → `broadcastEvent` → `hasLocalSubscriber` |

## Testing conventions

- Unit tests use Vitest with `createFakeEnvironment()` + `MemoryStorage` + `ChannelHub`.
- `ChannelHub.dropNextControl()` simulates BroadcastChannel message loss.
- `FakeTransport.startShouldFail` / `FakeTransport.stopGate` simulates transport failure/async stop.
- Fake environment exposes `runIntervals()`, `pageHide()`, `pageShow()`, `setVisibility()` for lifecycle control.
- Two traps that make a coordination test pass while proving nothing. (1) A peer runtime that shares the `ChannelHub` reacts to the teardown it is supposed to observe: a "tab that died without releasing" must own its hub (shared `storage`, isolated control plane), or its own reconcile re-elects the route and the assertions hold with the code under test deleted. (2) Worker-record and route writes go through `BatchingStorageWriter`, so a peer started without an intervening `await Promise.resolve()` is invisible to the others — an empty active-worker set silently turns "did not migrate" into "had nowhere to migrate".
- When a mutation "passes" the new test, check that the mutant hit the code you meant to break before deleting the test. `publish()` and `publishBatch()` contain textually identical wildcard-probe blocks, so a non-global `perl -0pi -e 's/…/…/'` edits only the first twin and the probe actually under test stays intact. Same for the other duplicated guards; prefer an explicit `/g` plus a `git diff --stat src/` that shows the expected number of hunks.
- Diff the mutant itself before believing what it kills. A mutation that deletes a whole statement instead of only its guard ("remove `if (this.started) this.writeRecord(true);`" → drop the guard, keep the call) makes *unrelated* tests fail — here, four routing/TTL cases that depend on a record ever existing — while the new test passes, which reads as "this leg is already pinned". Both readings were wrong: the real mutant failed exactly one test. Print the diff (or an anchor `assert` on the line being changed) and check it removes only the condition under study; keep the intended-mutant and the accidental-mutant results separate in the record.
- A third reason a mutation survives: the reconcile loop *repairs* it before an end-state assertion can look. `reconcileAssignedTopics()` drops any assignment whose durable route no longer names this worker, so deleting the frame-level guards (`handleControlMessage`'s route check, the route write in `subscribe()`) still ends in a correct quiescent state. That is a finding, not a failure — record which mutants survive and why in the harness header, and keep the mutation that kills the repair itself (`empty the sweep`) as the proof that the leg is load-bearing.
- A mutant that does not compile is not a caught mutant, and on this repository it fails *loudly in the wrong place*. `scripts/build.mjs` calls `rmSync(dist)` before `tsc`, so a mutation the type checker rejects (`if (false && guard)` → `TS7027: Unreachable code detected`) leaves `dist/` holding declarations only, and the next E2E run dies inside `openDemoTab` waiting for the connected badge — a missing artifact reported as a test failure. Write the mutant in a form `tsc` accepts (an empty consequent block, or a comparison it cannot fold), and chain the build's exit status ahead of the test command so a broken build can never masquerade as a killed mutant.
- A guard in a *synchronous* `catch` is not automatically dead. The throw usually comes from application code that ran just before it, and that code can re-enter the library: `credentialProvider.getToken()` calling `transport.stop()` and then throwing leaves `resolveTokenRequest`'s catch addressing a backend that no longer exists, where `post()` throws `start() must be called first` out of the Worker message listener. Build that re-entry before classifying such a leg as unreachable — `tests/centrifuge.test.ts`'s throwing-provider cases are the shape. Contrast with genuinely unreachable legs (`selectWorkerBackend` cannot return a Worker backend when the global is absent): say which kind each is, because the difference decides whether deleting it is a cleanup or a regression.
- To prove an absorbed rejection (`` await p.catch(() => undefined) ``) is dead, enumerate the assignments to that variable and show each chain ends in a terminal `.catch(...)`: `performStop()`'s `pendingStop` is set in exactly two places, `createStopPromise()` and `suspendTransport()`'s chained stop, and both end in `.catch(error => this.reportError(error))`, so the absorb can never run and the failure is already recorded where it is produced. Name the assignment sites in the comment, because that enumeration *is* the proof, and check what deletion would do instead: dropping this absorb routes a future rejection to a second `reportError`, not to an unhandled rejection, which is a different (and survivable) mistake — whereas the neighbouring `startPromise?.catch(() => undefined)` must stay, because `startPromise` holds the opening a failing `ready()` reports to its caller.
- An enumeration proof is only as strong as its last step, and that step is often a claim about a *handler* rather than about assignments. The `0.21.2`/`0.21.3` deletions above were correct in form and wrong in fact: `.catch(handler)` produces a **rejected** promise when `handler` throws, and `reportError` threw on any rejection reason without a primitive conversion. `0.21.4` fixed the coercion (`describeFailure()`); write the dependency next to the enumeration, not only the enumeration. Prefer a proof that needs no such assumption — `opening.then(f, g)` registers `g` as a handler of `opening` itself, so a trailing `void opening.catch(...)` on that same promise is redundant by Promise semantics alone, and that argument survives any future change to the handler.
- Three different verdicts get confused under "uncovered", so name which one a leg is before touching it: **dominated** (provably cannot run — delete it, or keep it if the failure modes are asymmetric, see below), **the only handler** (an uncovered *function* that is load-bearing — `reopenTransport()`'s early-return arm gets no `.then(f, g)`, so its swallow is the guard, not a gap), and **executing but redundant** (covered, runs, changes nothing — deleting it moves *no* coverage number). Check which tier before claiming one: the trailing `reopenTransport()` swallow removed as Unreleased work was not among the module's three uncovered functions, so that change was justified by its proof with zero coverage movement, and reporting it as a coverage win would have been false.
- When a dominated leg has no assertion behind it, whether to delete it is a failure-mode question, not a purity question. Force the premise false (make the promise reject) and run the suite **twice**, with and without the guard: if the same single test fails both ways, nothing protects the premise, so decide what deletion costs. In `reopenTransport()`, keeping the absorb lets a superseded resume still reopen, while deleting it leaves the bus silently closed after a pageshow — a guard whose deletion converts "degraded" into "stuck" earns its uncovered function. Record the measured pair in the comment; "it is dominated, and here is what breaking it would cost" is the statement a later reader can act on.
- A comment asserting that a promise "never rejects" is a claim about every path *through the handler it runs*, not about the happy path. `performStop()`'s catch reports through `reportError()` → `notifyError()` → `invokeHandlers(errorHandlers, …, ERROR_HANDLER)`, which absorbs a throwing subscriber only by writing to `console.warn`, so a throwing subscriber **plus** a throwing `console.warn` makes `performStop()` reject — and on that path the rejection arm of `createStopPromise()`'s settle `.then(f, g)` is the only thing that ever settles `await bus.stop()`, because the transport shutdown is already finished and nothing else can wake the caller. That arm had never executed, and the comment saying it could not had made it read as defensive filler. When an impossibility claim guards against a *hang*, construct the throw rather than trusting the prose, and make the failure legible: race the promise against a short real-timer watchdog so deleting the leg fails as `expected 'hung' to be 'settled'` in 250ms, not as a test timeout that names nothing.
- A test that passes can still break the gate: attach a rejection handler **before** the await that lets the rejection land. `tests/replay-persistence.test.ts`’s stale-signal case created three loads whose aborts fire on real 0/15/40 ms timers and asserted the third one *after* a healthy reopen round trip, so on a runner where that round trip exceeds 40 ms a promise rejects with nothing attached to it — every test green, and `pnpm test:coverage` exiting 1 on `Unhandled Rejection: Error: transaction aborted`, attributed to whichever test happened to be last. Measured both ways on the real file with the round trip forced to 200 ms: attached at the assertion it fails the run with 34/34 passing, attached up front the same run exits 0. Vitest reports this as a separate “Unhandled Errors” block plus `Errors 1 error` rather than as a failed test, so read the exit code, not the checkmarks. The general shape: any assertion whose `await` is separated from the promise’s creation by another await is a race with the scheduler.
- When auditing shipped prose against the code, start from the sentence and end at the consumer, not the validator. Three defects of this shape reached a release (`0.21.7` wildcard replay teardown, `0.21.8` trace redaction, `0.21.10` a heartbeat value that meant "never" to the sender and "malformed" to the receiver), so the sweep was run across the whole option surface and the parts that came out **correct** are recorded here so nobody re-derives them: every default in `docs/configuration.md`’s tables matches its `??` site (`maxActiveWorkers` 3, cluster heartbeat 3000 / TTL 10000, replay `maxPerTopic` 100, trace `metricsIntervalMs` 5000, dedup 1000 / 60000, `persistenceRetry` 1 / 50, `recovery` 1000 / `Infinity`, Centrifuge heartbeat 10000); the `pruneStrategy` sentences match `replay-pruning.ts` exactly, including that `age` leaves timestamped entries bounded only by the retention window while timestamp-less legacy entries stay capped, and that `age` without `retentionMs` falls back to the count cap; `retentionSweepMs` really does require `retentionMs` plus a `clearBefore` adapter (`replay-manager.ts:288`); `replay: n` delivery is capped by `maxPerTopic` in every strategy and `docs/api.md` says so; the en and zh option tables carry identical types and defaults (only prose differs); and the two other `Infinity`-accepting options honour it on the consumer side — `attempt > recoveryMaxAttempts` (`data-bus.ts:1432`) and `Number.isFinite(timeoutMs) && timeoutMs > 0` (`websocket.ts:145`). What the sweep did *not* cover: prose outside the option tables (architecture, capabilities, getting-started) and the `docs/zh/` narrative sections. Nor did it catch a *behaviour* claim in the prose of a section it did cover: `docs/configuration.md` said the persistence retry delays "grow exponentially and are capped", and only the doubling is capped — `backoffMs` is waited verbatim as the first delay, so a `backoffMs` of 5000 waits 5000 ms and then 1600 ms. Both languages now say which of the two the ceiling bounds. Take the lesson from 0.21.11 rather than re-deriving it: a table row and the paragraph under the same heading are separate claims, and when the claim is about a number the pin has to reach that number — the one test whose name said "capped by the retry ceiling" advanced 50 ms then 100 ms and never went near it. That gap has since been swept (`0.21.11`, `0.21.12`): ~15 more unsupported sentences came out of `architecture.md`, `capabilities.md`, `getting-started.md`, `transports.md`, `api.md` and `README.md`, in both languages. Two lessons from doing it. (1) "I audited the option surface" describes the *tables*; the paragraph under the same heading, and the README's summary bullets, are separate claims — `README.md` promised "the persistence layer does not store connection addresses, raw Topic text, or message content" two bullets below the line where it advertises the IndexedDB adapter that does exactly that. (2) The highest-yield shape is an absolute about storage (`never`, `only`, `does not persist`), because one opt-in contradicts it; `channelFallback: 'storage-event'` (frame written whole, plaintext topic and payload) and `replay.persistence` (object store keyed by the plaintext topic, payloads in the rows) are the two opt-ins that broke such sentences six times over. Verify each candidate against `src/` yourself before editing — both audits produced items that read as defects and were demoted on inspection (the `route && route.workerId !== …` tolerance is deliberate, and the storage-writer's "exponential backoff" prose is accurate because its initial delay is a constant, not an option).
- A claim about *how prose reaches consumers* needs a control that could have failed. Concluding "this src string appears 0 times in `dist/index.js`, therefore src comments ship only through `dist/**/*.d.ts`" was wrong, and wrong for a checkable reason: the string tested came from `src/core/types.ts`, a type-only module that emits no runtime JS at all, so the probe could not have produced a positive result whatever the truth. Measured properly, esbuild preserves comments in the bundles too — `dist/cjs/index.cjs` carries 563 comment lines, a shared chunk 525, `dist/centrifuge.js` 84, `dist/index.js` 34 — and all of those are in `package.json` `files`, so **the shipped comment surface is the declarations *and* the JS**, roughly double what an audit scoped to `.d.ts` covers. Before concluding "X does not ship", name an artifact where X provably *does* ship and show the same probe finds it there; if the probe cannot distinguish, it is not evidence.
- A comment explaining *why a call sits where it sits* is a behavior claim about a counterfactual, so the probe has to take the read at the earlier point rather than argue from the mechanism. Two shipped comments explained themselves with "the route write has not flushed yet, so a reader in this task sees nothing", which the code refutes directly (`getItem` returns the pending value, `storage-batch.ts:79-82`; `keys()` is persisted ∪ pending minus pending-deletes, `:143-155`) — but "refuted by reading" is not "measured", and the real question was whether the *snapshot* taken pre-open differs. It does not: two buses on one `MemoryStorage` + `ChannelHub`, snapshot before and after `ready()`, byte-identical. Check **which write** that run exercised, though — the subscribing bus won the election, so the route it listed was its own still-pending `writeRoute`; had the peer kept the topic, the probe would have read a flushed record and proved nothing about coalescing while looking like it proved everything. A setup with a second participant satisfies one participant's premise before the other's read. Same discipline as the bad control above: name the artifact where the claim *would* have shown up, and confirm the probe reaches it.
- When a prose defect is retired, grep the claim rather than the file. The `0.21.11`/`0.21.12`/132/133 sweeps each fixed a sentence in one place and left restatements standing; the coordination-trace fiction lived in the declaration doc, the `start()` call-site comment, and `docs/api.md:299` + `docs/zh/api.md:299` — five copies of two wrong sentences. "Audited" means the string no longer appears anywhere in the repo, so the last step of every correction is a repo-wide grep for its distinguishing phrase (`grep -rn "see no routes\|still coalesced" docs/ src/`), with both languages in scope, and a per-copy decision rather than a global replace: some copies are the same claim in different words, and some are a different claim that merely looks alike.
- **A phrase-grep finds the copies that paraphrase hides.** The pass after that rule ran the grep above and called the claim closed — and `src/core/trace.ts`'s declaration of the same event still said "after the transport has opened and the just-issued subscriptions have flushed, so the route list is populated rather than empty". Same fiction, different words, so the distinguishing-phrase grep could not see it. Grep the *vocabulary of the mechanism* (`flush|coalesc|pending|populated|empty routes`), and then grep the corrected symbol's own doc: when you fix a behavior claim, every declaration that names the same function or field is a candidate restatement, and the symbol name is the term that survives paraphrase.
- **When a comment names another library's behavior, `src/` is not the verification target.** Four of this pass's defects were sentences about Centrifuge ("the two function-valued hooks Centrifuge invokes", "internal listeners preserved", `subscribe('')` throws, "can never drift apart"), and none of them is checkable by reading our code. Open the installed package: `getToken` is the only client-level credential hook in `centrifuge@5.7.4` (`types.d.ts:126`) and `getChannelToken` exists nowhere in its build; the `Subscription` constructor installs its own no-op `error` listener "to avoid unhandled exception in EventEmitter for non-set error handler" (`build/index.js:762`) which our `removeAllListeners('error')` deletes, and that emitter throws on an `error` emit with no listener (`:162`). **Pin the version in the corrected text**, because the claim is now about a dependency, not about us — and say plainly which half is an open question rather than asserting safety the probe did not establish.
- Numeric adjectives in a comment are the cheapest defects to catch and the easiest to leave: "the four record methods", "each time a backend is created", "exactly N places", "no-op", "distinct large primes". Each one is a grep or a five-line script — `metricsActive` had seven readers not four; `generation` is bumped on two of three backend-creation paths and `stop()` moves it *before* the listener removal the comment credits it with following; `defaultWebSocketFactory` "returns null" but throws; `unsubscribe()` "is a no-op" and unconditionally sends a frame; three of six "primes" in `hash.ts` are composite (`929 × 1_719_413` etc.), where the property `Math.imul` mixing actually needs is oddness. When a constant is involved, do not reason about it — factor it, and say in the comment that the values are load-bearing for keys already in localStorage so nobody "fixes" them.
- Before rewriting a test on the theory that it passes vacuously, measure the theory against the **unmodified** test — one scratch file that reproduces its shape and prints the counters the theory is about. A pass here reads `attempt: 3`, `startCalls: 3`, one `exhausted` event with the environment clock frozen, so the cooldown never swallowed the sequence; the rewrite, and the comment asserting the opposite that came with it, belonged in the bin rather than the branch. A speculative fix costs more than no fix, because the comment it brings along is a claim the next reader will trust.
- The mirror case is harder to see, because the test looks like it is asserting and the mutation check is the only thing that notices: `caps automatic recovery attempts…` counted the `exhausted` diagnostics a second time after the cap was spent, and deleting the one-shot guard kept the whole suite green. The second count never reached the branch — after a failed reopen the handlers installed on the transport capture a superseded `lifecycleEpoch`, so `isCurrentLifecycle()` drops a further `setStatus('error')` before the attempt counter (measured with a spy: `updateStatus` ran 0 times). When a re-issued *transport* event is meant to exercise something, check the event still arrives at all before believing the assertion; and remember the demand path (`bus.publish()` → reopen) is what reinstalls a live closure, which is also what an application does after exhaustion. Two related dead ends: the recovery cooldown is `this.now = dedup?.now ?? Date.now`, **not** the cluster/environment clock, so moving `createFakeEnvironment({ now })` changes nothing there; and a post-retry `startCalls` count is scheduler-dependent (5, not 4) — assert it relative to a captured baseline so the contract survives.
- `tests/coordination-invariants.test.ts` is the multi-tab fuzz harness: three buses on one `MemoryStorage` + `ChannelHub`, randomized sub/unsub/publish/hide/show/stop/start/tick/dropped-and-forged control frames, then quiescence, then "exactly one owner, exactly one transport holder, the same tab", "a departed topic leaves no owner, holder or route", and "one publication fans out to each live subscriber exactly once". Note `stop()` clears the instance's handlers, so the harness must forget its own subscriptions on a stop op — an end-state harness is only valid against a model of what each API actually retains.
- Measure a candidate harness's marginal kill rate before adding it, and delete it when the answer is zero. A seeded `PortReaper` interleaving sweep was written for exactly that check (four invariants over register/touch/configure/remove/advance, injected clock, 2,000 seeds green in 331 ms — ~6,000 seeds/s, so cost was never the question) and then run against twelve mutants. Nine die to the 19 existing unit tests *and* the sweep, one dies only to the unit tests (`schedule()`'s idempotency guard, which the `expect(sets).toEqual([])` assertion pins directly), and two survive both. So the sweep killed nothing the file did not already kill and was deleted; the surviving two were the useful part, because they say what those legs actually are: `touch()`'s early return is a map-hygiene invariant, not the resurrection guard its comment claimed, and `reap()`'s `Array.from` snapshot is defensive, since `Map` iteration is already deletion-safe. Both comments now carry the measurement. The general trap is that an interleaving harness *feels* like more coverage because it explores more states; the only question that decides it is whether any mutant dies to it alone.
- Seeded fuzzers share `mulberry32()` and `flushMicrotasks()` from `tests/fakes.ts`; do not re-implement them per file (identical sequences, so extracting them cannot change what a seed explores).
- A guard that protects a *protocol invariant* belongs to the protocol, not to the handler where the first violation was found. The 0.21.5 `topicKey === createOpaqueKey(topic)` check was written into `handleControlMessage` and the rule was stated in the section above as if it covered the channel — it covered one of the two handlers that read that pair, and `handleRouteReleasedMessage` stayed open for a release. When pinning an invariant, enumerate every reader of the fields it constrains (`handleMessage`'s branches are the list) and say at each one whether it needs the check and why.
- A long fuzz must bound depth by **wall clock**, never by seed count alone: the same sweep swings by an order of magnitude between an idle desktop and a shared CI runner, so a count that passes locally can blow the per-test ceiling there. Pattern: `MAX_SEEDS` cap + a budget check at the top of each iteration + `expect(completed).toBeGreaterThanOrEqual(MIN_SEEDS)` so a slow runner cannot "pass" on a handful of interleavings, plus a `console.log` when the sweep was truncated (that line is what makes a runner-depth regression diagnosable from a CI log instead of a mystery). Take the floor from measured mutant **kill depth**, not from how many seeds you like — the coordination harness's heaviest mutant dies at seed 12, so 100 leaves 8x the depth that detects a regression. Keep the floor an *assertion*, never a precondition on the budget check: `if (completed >= MIN_SEEDS && elapsed > BUDGET) break` is inert on exactly the runner the budget exists for, and it let a starved CI box run 1,046 seeds for 485s against a 60s fuse while reporting only a bare timeout. Demonstrated locally — with `BUDGET = 0` the gated form still ran 100 seeds and **passed**, the unconditional form stops at once and fails with `explored only 0 seeds`. Also log the **slowest seed** beside the truncation line: a fuse sampled between iterations cannot bound a seed that wedges on an `await` needing a timer the fake clock never advances, so that case is diagnosable only from the per-seed number.
- Print sweep progress *during* a long fuzz, not only when it ends. The post-loop truncation log cannot fire on the one failure it exists to explain: a host that kills the test on its own ceiling reports `Error: Test timed out in 120000ms` and nothing else. `if (seed <= 5 || seed % 50 === 0) console.log(...)` costs one line per 50 seeds and separates "this runner is slow" (depth climbing, elapsed growing) from "a seed wedged" (last line names the wedge) — different diagnoses, different fixes.
- Budget on `realNowMs()` from `tests/fakes.ts`, never on a clock fake timers can move, and keep `tests/setup.ts` restoring real timers after every test. Measured on the pinned Vitest 5 inside a window advanced 60 simulated seconds: global `performance.now()` read 60000, `process.hrtime.bigint()` moved 60000, and `node:perf_hooks`' `performance` — a *different* object in that context, which is why shadowing the global leaves it alone — read 216ms of real time. **That immunity is contextual, not inherent**: Node makes the global and the `perf_hooks` export the same object in a worker thread, so a `toFake` list containing `performance` patches both, and a budget clock that gets *frozen* reads 0 elapsed no matter how slow the host is. `realNowMs()` therefore takes the max of `node:perf_hooks` and `process.uptime()` — the latter is in no fake-timer toolbox's list, and measured a real 260ms across a 250ms `Atomics.wait` inside a fake window where `Date`, global `performance` and `hrtime` all read 0. Do not collapse it to one source. A live `performance.now()` is only safe because a seed loop reads it after the previous seed's `vi.useRealTimers()`: the same budget moved inside the window (per-operation check) reported "out of budget" after 48ms of real time and truncated the sweep at 3 seeds. Do not encode that placement dependency in a new call site — take the helper. Restoring real timers still matters, because a leaked fake `Date` travels with a reused worker and poisons the *cluster* clock: the same coordination file measured 16.4s in one full run and 60.2s alone. Reading `Date.now()` "in a real-timers window" is not enough — the *baseline* can already be fake. The sweep's own `Date`-driven cluster time stays fake on purpose.
- Pin a clock guard in **both** directions, or you have only pinned half of it. "60 simulated seconds must not cost 60 measured ones" passes trivially at 0, so a frozen clock sails through it; the assertion that catches the dangerous direction is "N ms of *real* blocked time inside a fake window must still measure ≥ N". Verified: a mutant that makes the helper return a constant passes the advance check and fails only the freeze check. Block real time with `blockRealTimeMs()` (an `Atomics.wait`) rather than `while (Date.now() < stop)` — `Date` is frozen inside the window, so a busy-wait on it never terminates; an early version of this pin hung the run that way.
- `pnpm test:coverage` only instruments `src/**` (the `coverage.include` in `vitest.config.ts`), so a leg whose *only* caller is a built artifact reads as uncovered. `tests/dual-format.test.ts`, `tests/verify-packed-consumer.test.ts` and `tests/release-version.test.ts` import from `dist/` and the packed tarball; `src/centrifuge.ts`'s two `catch` arms around `new URL('./centrifuge.worker.js', import.meta.url)` are the canonical example — esbuild shims `import.meta` to `{}` in the CJS bundle, so the CJS half of that test drives the throw while src-level coverage never sees it. Before hunting a zero count, check whether a dist-level test already drives it; record "pinned through dist" at the site (with the test name) so the next pass reads the classification instead of re-running the experiment.
- Distinguish the two tiers of the ledger when reporting it: an uncovered **line** and a line carrying zero-count **branch arms** are different claims. `cluster.ts` reached 100% lines while still holding 19 zero arms (`?? fallbacks`, conditional spreads, `typeof` guards), so "module closed" needs the tier named.
- A zero on an arm whose right operand is an **arrow function** is a statement about that closure's invocations, not about who omitted the argument. `this.sink = options?.sink ?? (() => undefined)` in `src/core/trace.ts` reports 0 while `tests/property.test.ts` selects that default 300 times per run — the branch region spans the arrow's *body*, and a selected-but-never-called no-op reads as unexercised. So never report that shape as "no caller uses the fallback"; check whether the fallback is ever *invoked*, and if it cannot be under the declared types, record at the site what deleting it costs (there: one `trace sink threw` warning per event, suite green either way) rather than lighting the arm up with a cast.
- A timing gate must sample the code, not the scheduler. Assert the **fastest of N repeats** (`bestOfMs` in `tests/perf-gate.test.ts`) because a real regression is slow on every repeat, and give absolute-millisecond gates their own sequential step (`pnpm test:perf`, excluded from `pnpm test`/`pnpm test:coverage` in `vitest.config.ts`) — 38 isolated workers on a runner's few cores still beat a 20x ceiling, which is what took two of the five gates down in one coverage run. Keep verifying a ceiling has teeth by mutating the hot loop, and record which weaker mutants pass so the gate's real sensitivity is known rather than assumed.
- E2E tests use Playwright with Chrome, launching a real demo server.
- E2E topic names must come from `uniqueTopic()` in `e2e/topics.ts`, never from `Date.now()` alone. The name doubles as a Centrifugo channel and `serverSubscribers()` counts connections to it **across the whole server**, so the "exactly one tab holds this topic" assertion is only meaningful if no other test shares the name. The same trap one level up: a *total* connection count from `/debug/connections` is server-wide, so it is not an observable for any single test — `playwright.config.ts` runs specs in parallel and every live tab is in the number. That mistake read as runner load for months until `--repeat-each=3` of the offending spec failed 3/3 at its own precondition. Address a socket by the channel it holds (and remember that in a shared cluster only the *owner's* transport subscribes a channel, so two tabs of one topic show one channel-carrying socket and one with none). `playwright.config.ts` runs `fullyParallel: true` with the platform default worker count off CI (and `--repeat-each` multiplies it), so two instances of one case can start in the same millisecond: that collision made a correct two-cluster pair look like a stuck 2-subscriber channel and burned a 30s poll to prove it.
- A handoff/teardown E2E must make the *sender's* cluster view a precondition it waits for, not a race it hopes to win. Delivery is at-most-once, so a publication written while the sending tab still addresses a departed worker is gone for good, and polling for it after the fact cannot distinguish "slow" from "unrescuable" — it just fails at the timeout. Read `getClusterSnapshot().routes` from the sending page (both example pages expose the bus) and wait for the dead worker id to disappear before publishing.
- An E2E gate cannot depend on which thread the browser puts a SharedWorker's timers on. Blocking a tab's main thread past the port session timeout does reap the port on desktop Chrome, but on headless Chromium the reaper's clock rides the blocked thread: no tick lands during the stall, and the queued PING is processed before the next one, so the precondition never occurs at all. Measured three ways — the same spec passed locally in 36.7 s and failed 3 of 3 on CI, each attempt ending with the channel still held by the *original* socket and the demo's health line reading `健康 · transport 就绪 · 恢复 0/Infinity · 无失败记录`. Test reaper behaviour at unit level with injected timers and clocks (`tests/port-reaper.test.ts`), and record the browser consequence as a measurement rather than as a check that only fires on the machine it was written on.
- An option whose effect is to *stop sending* something has to be checked against what the peer does when it stops receiving it. `heartbeatIntervalMs: Infinity` is accepted by `assertHeartbeatInterval`, documented in `docs/configuration.md` as the way to switch the SharedWorker PING heartbeat off, and pinned on the sending side by a test that no `PING` ever arrives — while `PortReaper.setTimeout()` filed `Infinity` under "malformed payload" and fell back to the 10 s default, i.e. a 30 s session timeout. So the one configuration whose purpose is "this port will never prove liveness" guaranteed the port would be reclaimed 30 s after connecting, in shared mode, and each half had a green test. When you pin a value's meaning on one side of a boundary, read the peer's guard for the *same* value in the same pass: a `Number.isFinite` check written to reject `NaN`/`0`/negatives also swallows `Infinity`, and only the caller's contract says those are different categories. The stale premise was visible in the old test's own comment, which listed `Infinity` among malformed payloads — a test that asserts a fallback cannot also be evidence about which inputs deserve one.
- Headless Chrome cannot be used to study background throttling, so a probe that measures "what a clamped heartbeat does" has to assert its own precondition. Two pages in one context plus `blocker.bringToFront()` left the first page at `document.visibilityState === 'visible'`, and a 100 ms in-page `setInterval` counted 2405 of a possible 2405 ticks over a 240 s window — no clamp at all, because Playwright passes `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` in its default Chromium switches (`chromiumSwitches` in `playwright-core/lib/coreBundle.js`). Dropping them with `ignoreDefaultArgs` is necessary and still not sufficient headless: measured, the tab never became hidden. Put the precondition read (visibility *and* tick count) inside the probe, because the result worth having is the one this instrument cannot produce, and a run that measures nothing prints like a clean pass. Headful Playwright fails the same way, and for a different reason worth knowing before a third attempt: a context gives each page its own window, so nothing is ever occluded (`bringToFront()` left the first page at `visible` with `hasFocus()` still true), `Target.createTarget` over a browser-level CDP session creates a target without hiding the first page, and this Chrome build exposes no `Emulation.setPageVisibilityOverride` or `Emulation.setFocusOverride` at all — only `Page.setWebLifecycleState`, which *freezes* the page (the starvation case above, not the clamp). The only route left runs through the desktop, which is not worth taking for one sentence: what survives as the open question is the arithmetic — 3 × the default 10 s heartbeat is below Chrome’s published ~1-minute floor for a long-hidden page, so a *sustained* clamp is expected to reclaim and rebuild once per period — and that stays recorded here as arithmetic on our constant plus upstream policy, not as a measurement taken in this repository.
- `await expect(promise).rejects.toThrow('message')` **also passes when the rejection reason is `null` or `undefined`** (verified on the pinned Vitest 5). That silently voids the assertion for exactly the bug the `reason ?? new Error(...)` fallbacks prevent, so those fallbacks cannot be pinned with `rejects.toThrow`. Use `expectRejectionMessage()` from `tests/fakes.ts` instead whenever the message itself is the contract; plain `rejects.toThrow` stays fine for rejections whose value the test itself constructed.
- Same trap one level up: `toThrow(TypeError)` cannot tell a validator rejecting an option from the validator's own message builder throwing while naming it, because both are a `TypeError`. Where the message is the contract, assert the message. `0.21.4`'s bug is the instance: `String(Object.create(null))` throws `TypeError: Cannot convert object to primitive value`, so any `String(error)` on a rejection reason — in a recorder, a message template, or an enum membership test — is a failure-reporting path that can fail. Render such values with `describeFailure()` from `src/utils/error-utils.ts`, and give the fake a way to set the rejection's **value** (`FakeTransport.stopRejection`), not just the fact of failure, when a test needs the distinction.
- `pnpm verify:types` (`scripts/verify-public-types.mjs`) is the only gate that can see a **type-only** export, because a declaration emits no runtime key: `tests/dual-format.test.ts` freezes `Object.keys()` of the built barrel and `verify:compat` compares package.json fields, so both are blind to it. Its two checks have **measured, disjoint** sensitivity, so neither is redundant: deleting `WorkerAvailability` from the barrel dies to the closure walk alone (with the walk neutered the same mutation exits 0, so the baseline leg cannot see it), and deleting `DEFAULT_MAX_ACTIVE_WORKERS` — which no public *type* references — dies to the baseline comparison alone (with that leg neutered the same mutation exits 0). Do not simplify one leg away to "dedupe" them. Do not simplify one leg away to "dedupe" them. The closure rule requires the name to be **exported by its own module**, and that filter is a decision with an instance behind it: `WorkerUnsafeOption` in `src/centrifuge-protocol.ts` is reachable from `./centrifuge` through `Omit<Partial<Options>, WorkerUnsafeOption>` and a mapped-type key, and stays module-local on purpose — `tsc` resolves it away, and a consumer never inhabits that position, so exporting it would add a public name nobody can use. Deleting the filter makes the gate report it again (measured). Design note, because the alternative looks natural and is not usable: walking *types* (`getPropertiesOfType` + type arguments + call signatures) needs a depth bound, and loosening that bound from 7 to 14 exhausted a 4 GB heap on this surface, so the bound was load-bearing for cost rather than safety; the syntax reference walk is bounded by the repository's own finite type symbol set instead. Its one real limit: a name that `tsc` inlines away rather than emits is invisible here.
- A percentage gate on a metric with a multi-modal history needs an **absolute** leg, or the summary statistic becomes the thing that fails. `bench:compare` baselines on the median of the last five reports; a median is stable only while the modes stay mixed, so when several consecutive reports land in the same mode the median itself jumps and a comment-only tree read +121% against one baseline and −56.7% against another. The fix (`findRegressions` now also requires beating the highest baseline sample) has a stated cost — a *sustained* shift that stays inside the observed range is invisible — so the suppressed rows are printed under `within-baseline, not gated` rather than passing silently: an excuse the reader cannot see is indistinguishable from a clean bill. Measured on the live archive at `--fail-above-pct 5`, three of the seven metrics (`publish/dedicated`, `publish/shared`, `publishBatch1000Ms`) were already inside their own five-report range, which is the honest statement of that gate's resolution. Mutation-check both legs: dropping the ceiling condition fails only the new multi-modal case, and hard-coding it to `false` fails four tests including the pre-existing explicit-pair path — that asymmetry is what says the null-ceiling leg is real behavior, not decoration.
- `docs/benchmarks.md` and `docs/zh/benchmarks.md` are **generated** by `scripts/bench-trend.mjs`'s `buildDocs()` (`pnpm bench:trend`); the prose paragraphs naming the gate live in that function's `en`/`zh` arrays. Editing the markdown loses the next regeneration and leaves the two languages out of step — change the generator, re-run it, and commit the tables it refreshed in the same commit.
- When a comment proves a promise resolves by pointing at a terminal `.catch(handler)`, the proof is only as good as `handler` being total. Two released versions deleted absorbers on exactly that argument while assuming the handler (`reportError`) could not throw; it could, and the assumption was load-bearing. State the assumption next to the enumeration, and pin the chain's observable end with a test.

## Common tasks

**Add a new topic owner selection strategy**: Add a pure function in `routing.ts`, test it in `tests/routing.test.ts`, then wire it in `cluster.ts` `subscribe()` / `reconcileSubscriptions()`.

**Add a new control message type**: Add the union member in `types.ts` `WorkerClusterMessage`, handle it in `cluster.ts` `handleMessage()`, add a test.

**Adjust heartbeat/worker TTL**: Pass `heartbeatIntervalMs` / `workerTtlMs` in `WorkerClusterOptions`. Defaults: 3s heartbeat, 10s TTL. Worst-case dead-owner detection = heartbeatIntervalMs + workerTtlMs ≈ 13s.

**Trace/diagnostics**: Pass `trace: { enabled: true, sink: (event) => ... }` to `CrossTabDataBus`. Events include lifecycle, status, subscription, coordination snapshot, and periodic metrics (throughput, dispatch latency percentiles).

## Product Boundaries (thesis → queue, not checklist)

The project is feature-complete: follow-up work is verification and deepening of the existing library surface — never new library capabilities. Queues derive from this boundary; parked ideas are not backlog items unless their entry conditions are met.

### In Scope (library thesis-internal queue)

- 12-arm ledger receiver-trust verification (the batched PUBLISH `message.items` and `ROUTE_RELEASED` key/topic questions are closed as of 0.21.6; what remains is arms whose consequence is a behavior no test names yet)
- Bench baselines and trend-document corrections
- Transport protocol compatibility fixes (Centrifuge / native WebSocket)
- Patch releases

### Out of Scope (parking; every item carries entry conditions)

- Server-side coordination component: entry = repositioning the library as a full-stack solution
- New framework adapters beyond React/Vue 3: entry = community demand + maintenance commitment
- Durable storage backends beyond replay ring buffers: entry = extending the library thesis

### Upstream Blocked

- Centrifuge major-version upgrade: unblocks = peer transport protocol change, with regression verification

### Boundary Review Signals

- Centrifuge breaking protocol changes
- An ability gap inside the library thesis that verification/deepening cannot cover
