# AGENTS.md — cross-tab-worker-databus

A framework-agnostic cross-tab data bus with Dedicated/Shared Worker clustering and Centrifuge support.

## Quick reference

| Action | Command |
|---|---|
| Install deps | `pnpm install` |
| Build | `pnpm build` |
| Type check | `pnpm typecheck` |
| Unit test | `pnpm test` (vitest) |
| Watch tests | `pnpm test:watch` |
| E2E test | `pnpm test:e2e` (Playwright, requires `pnpm build` first) |
| Run demo | `pnpm examples` → http://localhost:4173/examples/demo/ |

## Directory layout

```
src/
  index.ts                      # Public API barrel export
  core/
    cluster.ts                  # WorkerClusterRuntime — cross-tab coordination
    data-bus.ts                 # CrossTabDataBus — public API, transport lifecycle
    environment.ts              # ClusterEnvironment adapter (port/adapter pattern)
    hash.ts                     # createOpaqueKey — 128-bit non-cryptographic hash
    routing.ts                  # Pure functions: owner selection, load balancing
    storage-batch.ts            # BatchingStorageWriter — write coalescing + backoff
    trace.ts                    # DataBusTraceReporter — metrics/latency diagnostics
    types.ts                    # All shared type definitions
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
| `FakeTransport` | Minimal `DataBusTransport` implementation. Track `subscribeCalls`, `unsubscribeCalls`, `publishCalls`. `startShouldFail` makes `start()` report error. `stopGate` delays stop. `emit(topic, data)` simulates an incoming message. |

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
- E2E tests use Playwright with Chrome, launching a real demo server.

## Common tasks

**Add a new topic owner selection strategy**: Add a pure function in `routing.ts`, test it in `tests/routing.test.ts`, then wire it in `cluster.ts` `subscribe()` / `reconcileSubscriptions()`.

**Add a new control message type**: Add the union member in `types.ts` `WorkerClusterMessage`, handle it in `cluster.ts` `handleMessage()`, add a test.

**Adjust heartbeat/worker TTL**: Pass `heartbeatIntervalMs` / `workerTtlMs` in `WorkerClusterOptions`. Defaults: 3s heartbeat, 10s TTL. Worst-case dead-owner detection = heartbeatIntervalMs + workerTtlMs ≈ 13s.

**Trace/diagnostics**: Pass `trace: { enabled: true, sink: (event) => ... }` to `CrossTabDataBus`. Events include lifecycle, status, subscription, coordination snapshot, and periodic metrics (throughput, dispatch latency percentiles).