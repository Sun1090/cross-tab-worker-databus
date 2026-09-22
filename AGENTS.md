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
- A third reason a mutation survives: the reconcile loop *repairs* it before an end-state assertion can look. `reconcileAssignedTopics()` drops any assignment whose durable route no longer names this worker, so deleting the frame-level guards (`handleControlMessage`'s route check, the route write in `subscribe()`) still ends in a correct quiescent state. That is a finding, not a failure — record which mutants survive and why in the harness header, and keep the mutation that kills the repair itself (`empty the sweep`) as the proof that the leg is load-bearing.
- A guard in a *synchronous* `catch` is not automatically dead. The throw usually comes from application code that ran just before it, and that code can re-enter the library: `credentialProvider.getToken()` calling `transport.stop()` and then throwing leaves `resolveTokenRequest`'s catch addressing a backend that no longer exists, where `post()` throws `start() must be called first` out of the Worker message listener. Build that re-entry before classifying such a leg as unreachable — `tests/centrifuge.test.ts`'s throwing-provider cases are the shape. Contrast with genuinely unreachable legs (`selectWorkerBackend` cannot return a Worker backend when the global is absent): say which kind each is, because the difference decides whether deleting it is a cleanup or a regression.
- To prove an absorbed rejection (`` await p.catch(() => undefined) ``) is dead, enumerate the assignments to that variable and show each chain ends in a terminal `.catch(...)`: `performStop()`'s `pendingStop` is set in exactly two places, `createStopPromise()` and `suspendTransport()`'s chained stop, and both end in `.catch(error => this.reportError(error))`, so the absorb can never run and the failure is already recorded where it is produced. Name the assignment sites in the comment, because that enumeration *is* the proof, and check what deletion would do instead: dropping this absorb routes a future rejection to a second `reportError`, not to an unhandled rejection, which is a different (and survivable) mistake — whereas the neighbouring `startPromise?.catch(() => undefined)` must stay, because `startPromise` holds the opening a failing `ready()` reports to its caller.
- `tests/coordination-invariants.test.ts` is the multi-tab fuzz harness: three buses on one `MemoryStorage` + `ChannelHub`, randomized sub/unsub/publish/hide/show/stop/start/tick/dropped-and-forged control frames, then quiescence, then "exactly one owner, exactly one transport holder, the same tab", "a departed topic leaves no owner, holder or route", and "one publication fans out to each live subscriber exactly once". Note `stop()` clears the instance's handlers, so the harness must forget its own subscriptions on a stop op — an end-state harness is only valid against a model of what each API actually retains.
- Seeded fuzzers share `mulberry32()` and `flushMicrotasks()` from `tests/fakes.ts`; do not re-implement them per file (identical sequences, so extracting them cannot change what a seed explores).
- A long fuzz must bound depth by **wall clock**, never by seed count alone: the same sweep swings by an order of magnitude between an idle desktop and a shared CI runner, so a count that passes locally can blow the per-test ceiling there. Pattern: `MAX_SEEDS` cap + a budget check at the top of each iteration + `expect(completed).toBeGreaterThanOrEqual(MIN_SEEDS)` so a slow runner cannot "pass" on a handful of interleavings, plus a `console.log` when the sweep was truncated (that line is what makes a runner-depth regression diagnosable from a CI log instead of a mystery). Take the floor from measured mutant **kill depth**, not from how many seeds you like — the coordination harness's heaviest mutant dies at seed 12, so 100 leaves 8x the depth that detects a regression.
- Budget on `realNowMs()` from `tests/fakes.ts`, never on a clock fake timers can move, and keep `tests/setup.ts` restoring real timers after every test. Measured on the pinned Vitest 5 inside a window advanced 60 simulated seconds: global `performance.now()` read 60000, `process.hrtime.bigint()` moved 60000, and `node:perf_hooks`' `performance` — a *different* object, which is why shadowing the global leaves it alone — read 216ms of real time. So `realNowMs()` is immune wherever it is called, while a live `performance.now()` is only safe because a seed loop reads it after the previous seed's `vi.useRealTimers()`: the same budget moved inside the window (per-operation check) reported "out of budget" after 48ms of real time and truncated the sweep at 3 seeds. Do not encode that placement dependency in a new call site — take the helper. Restoring real timers still matters, because a leaked fake `Date` travels with a reused worker and poisons the *cluster* clock: the same coordination file measured 16.4s in one full run and 60.2s alone. Reading `Date.now()` "in a real-timers window" is not enough — the *baseline* can already be fake. The sweep's own `Date`-driven cluster time stays fake on purpose.
- `pnpm test:coverage` only instruments `src/**` (the `coverage.include` in `vitest.config.ts`), so a leg whose *only* caller is a built artifact reads as uncovered. `tests/dual-format.test.ts`, `tests/verify-packed-consumer.test.ts` and `tests/release-version.test.ts` import from `dist/` and the packed tarball; `src/centrifuge.ts`'s two `catch` arms around `new URL('./centrifuge.worker.js', import.meta.url)` are the canonical example — esbuild shims `import.meta` to `{}` in the CJS bundle, so the CJS half of that test drives the throw while src-level coverage never sees it. Before hunting a zero count, check whether a dist-level test already drives it; record "pinned through dist" at the site (with the test name) so the next pass reads the classification instead of re-running the experiment.
- Distinguish the two tiers of the ledger when reporting it: an uncovered **line** and a line carrying zero-count **branch arms** are different claims. `cluster.ts` reached 100% lines while still holding 19 zero arms (`?? fallbacks`, conditional spreads, `typeof` guards), so "module closed" needs the tier named.
- A timing gate must sample the code, not the scheduler. Assert the **fastest of N repeats** (`bestOfMs` in `tests/perf-gate.test.ts`) because a real regression is slow on every repeat, and give absolute-millisecond gates their own sequential step (`pnpm test:perf`, excluded from `pnpm test`/`pnpm test:coverage` in `vitest.config.ts`) — 38 isolated workers on a runner's few cores still beat a 20x ceiling, which is what took two of the five gates down in one coverage run. Keep verifying a ceiling has teeth by mutating the hot loop, and record which weaker mutants pass so the gate's real sensitivity is known rather than assumed.
- E2E tests use Playwright with Chrome, launching a real demo server.
- E2E topic names must come from `uniqueTopic()` in `e2e/topics.ts`, never from `Date.now()` alone. The name doubles as a Centrifugo channel and `serverSubscribers()` counts connections to it **across the whole server**, so the "exactly one tab holds this topic" assertion is only meaningful if no other test shares the name. `playwright.config.ts` runs `fullyParallel: true` with the platform default worker count off CI (and `--repeat-each` multiplies it), so two instances of one case can start in the same millisecond: that collision made a correct two-cluster pair look like a stuck 2-subscriber channel and burned a 30s poll to prove it.
- A handoff/teardown E2E must make the *sender's* cluster view a precondition it waits for, not a race it hopes to win. Delivery is at-most-once, so a publication written while the sending tab still addresses a departed worker is gone for good, and polling for it after the fact cannot distinguish "slow" from "unrescuable" — it just fails at the timeout. Read `getClusterSnapshot().routes` from the sending page (both example pages expose the bus) and wait for the dead worker id to disappear before publishing.
- `await expect(promise).rejects.toThrow('message')` **also passes when the rejection reason is `null` or `undefined`** (verified on the pinned Vitest 5). That silently voids the assertion for exactly the bug the `reason ?? new Error(...)` fallbacks prevent, so those fallbacks cannot be pinned with `rejects.toThrow`. Use `expectRejectionMessage()` from `tests/fakes.ts` instead whenever the message itself is the contract; plain `rejects.toThrow` stays fine for rejections whose value the test itself constructed.
- Same trap one level up: `toThrow(TypeError)` cannot tell a validator rejecting an option from the validator's own message builder throwing while naming it, because both are a `TypeError`. Where the message is the contract, assert the message. `0.21.4`'s bug is the instance: `String(Object.create(null))` throws `TypeError: Cannot convert object to primitive value`, so any `String(error)` on a rejection reason — in a recorder, a message template, or an enum membership test — is a failure-reporting path that can fail. Render such values with `describeFailure()` from `src/utils/error-utils.ts`, and give the fake a way to set the rejection's **value** (`FakeTransport.stopRejection`), not just the fact of failure, when a test needs the distinction.
- When a comment proves a promise resolves by pointing at a terminal `.catch(handler)`, the proof is only as good as `handler` being total. Two released versions deleted absorbers on exactly that argument while assuming the handler (`reportError`) could not throw; it could, and the assumption was load-bearing. State the assumption next to the enumeration, and pin the chain's observable end with a test.

## Common tasks

**Add a new topic owner selection strategy**: Add a pure function in `routing.ts`, test it in `tests/routing.test.ts`, then wire it in `cluster.ts` `subscribe()` / `reconcileSubscriptions()`.

**Add a new control message type**: Add the union member in `types.ts` `WorkerClusterMessage`, handle it in `cluster.ts` `handleMessage()`, add a test.

**Adjust heartbeat/worker TTL**: Pass `heartbeatIntervalMs` / `workerTtlMs` in `WorkerClusterOptions`. Defaults: 3s heartbeat, 10s TTL. Worst-case dead-owner detection = heartbeatIntervalMs + workerTtlMs ≈ 13s.

**Trace/diagnostics**: Pass `trace: { enabled: true, sink: (event) => ... }` to `CrossTabDataBus`. Events include lifecycle, status, subscription, coordination snapshot, and periodic metrics (throughput, dispatch latency percentiles).