> [中文](./zh/architecture.md) | English

# Architecture

## Runtime Model

```mermaid
graph TB
  subgraph Browser["Browser (same-origin)"]
    subgraph TabA["Tab A"]
      AppA["Business Module"] --> BusA["CrossTabDataBus"]
      BusA --> RuntimeA["WorkerClusterRuntime"]
      BusA --> TransportA["CentrifugeWorkerTransport"]
      TransportA --> WorkerA["Dedicated / Shared Worker A"]
    end
    subgraph TabB["Tab B"]
      AppB["Business Module"] --> BusB["CrossTabDataBus"]
      BusB --> RuntimeB["WorkerClusterRuntime"]
      BusB --> TransportB["CentrifugeWorkerTransport"]
      TransportB --> WorkerB["Dedicated / Shared Worker B"]
    end
  end

  RuntimeA <--> Channel["BroadcastChannel Control Plane"]
  RuntimeB <--> Channel
  RuntimeA --> BatchA["BatchingStorageWriter"]
  RuntimeB --> BatchB["BatchingStorageWriter"]
  BatchA <--> Registry["localStorage Worker Registration"]
  BatchB <--> Registry
  BatchA <--> Routes["localStorage Topic Routes"]
  BatchB <--> Routes
  WorkerA --> SessionA["CentrifugeSession"]
  WorkerB --> SessionB["CentrifugeSession"]
  SessionA --> Server["Centrifuge / realtime server"]
  SessionB --> Server
  subgraph SW["SharedWorker process (when backend = shared)"]
    Reaper["PortReaper"] -.-> SessionA
    Reaper -.-> SessionB
  end
```

By default, when `workerMode: 'dedicated'`, each Tab has its own dedicated transport Worker. When configured as `shared` or `auto` and the browser supports SharedWorker, same-origin tabs share the same SharedWorker; each connection port within the SharedWorker creates its own independent `CentrifugeSession`, so one Tab refreshing or stopping does not affect other Tabs. The `auto` mode degrades in order of **SharedWorker → Dedicated Worker → Local mode**, while the `dedicated` mode degrades in order of **Dedicated Worker → SharedWorker → Local mode**. `BroadcastChannel` is only responsible for control messages and real-time publication forwarding; localStorage is only responsible for eventually-consistent coordination metadata.

Because `MessagePort` has no `close` event, a tab that crashes before sending `STOP` would otherwise leak its session and WebSocket. The main thread therefore sends a `PING` every 10 seconds, and the SharedWorker reaps any port that stays silent for more than 30 seconds, releasing the session and its subscriptions.

## Layers

| Layer | Entry | Responsibility |
|---|---|---|
| DataBus | `CrossTabDataBus` | Local handler reference counting, message dispatch, state and transport lifecycle |
| Replay | `ReplayManager` | Bounded per-topic history ring, durable IndexedDB persistence, retention cleanup, retry policy |
| Dedup  | `DedupManager`  | Opt-in bounded duplicate suppression by `messageId`, adaptive TTL, expiry sweep |
| Cluster Coordination | `WorkerClusterRuntime` | Worker registration, roles, heartbeat, Topic owner, migration and broadcast protocol |
| Transport | `DataBusTransport` | Executes subscribe, unsubscribe, publish on the real Worker/connection |
| Centrifuge | `CentrifugeWorkerTransport` | Protocol adaptation between the main thread and the built-in Centrifuge Worker |

## Source Layout & Shared Utils

The `src/` tree keeps platform adapters and the coordination core beside a small
`src/utils/` toolbox:

| File | Contents | Consumers |
|---|---|---|
| `utils/constants.ts` | Every runtime string literal in one place — statuses, roles, actions, cluster/worker/protocol message types, trace event discriminants, enums, namespace prefixes. All literal-derived types (`WorkerStatus`, message `type` fields, trace `action`/`operation`, …) are derived from these constants with `(typeof X)[keyof typeof X]`, so a value and its type cannot drift apart. | all modules |
| `utils/metadata.ts` | `publicationMetadata(messageId, timestamp)` — spreads only defined metadata, previously duplicated across four modules. | data-bus, cluster, centrifuge, centrifuge-session |
| `utils/storage-utils.ts` | `readJson` / `writeJson` / `listKeys` / `readAllByPrefix` — fault-tolerant storage primitives (corrupt JSON → absent; failed write → swallowed). | cluster |
| `utils/validation.ts` | Constructor/option validation asserts (`assertReplayOptions`, `assertDedupOptions`, `assertRecoveryOptions`, `assertHeartbeatInterval`, …). Optional fields are validated only when explicitly provided; defaults are always valid. | data-bus, replay-persistence, centrifuge |
| `utils/error-utils.ts` | `serializeError` / `deserializeWorkerError` + `SerializedWorkerError` — Error round-tripping across the Worker boundary. | centrifuge, centrifuge-session |

Extracting these was deliberate: they are side-effect-free, dependency-light
helpers whose duplicated copies had already started to drift (e.g. four
near-identical `publicationMetadata` implementations). Stateful cross-cutting
concerns with their own lifecycle — replay buffering and dedup — live as
self-contained `DedupManager` / `ReplayManager` classes that the DataBus
delegates to; they own their maps/timers/stats and expose thin start/stop/
record/clear surfaces. The DataBus lifecycle state machine (start/stop/
suspend/resume, promise gates, recovery pacing) was kept inside
`CrossTabDataBus` on purpose: those flags interlock tightly and extracting
them would re-introduce the race conditions the gates exist to prevent.

## Glossary

Terms are explained in plain language; the code and the rest of this document use the short names.

| Term | Short name in code | Plain-language meaning |
|---|---|---|
| **Topic** | `topic` | A named channel (e.g. `price.feed`) that applications subscribe to or publish on. |
| **Topic key** | `topicKey` | An opaque 128-bit hash of the Topic name. The Topic name itself is never persisted in coordination storage. |
| **Tab** | `tabId` | One browser page instance. `tabId` survives refresh so a tab keeps its identity across the page lifecycle. |
| **Worker** | `workerId` | One runtime instance inside a Tab. Each Worker publishes its own heartbeat and can own Topics. A Tab can briefly run two Workers during a restart/handoff. |
| **Topic owner** | — | The Worker responsible for the real transport subscription of a Topic. "Owner" is a hat a Worker wears, not a permanent role: it receives the Topic's publications from the server and fans them out to other Tabs. |
| **Assignment** | `assignedTopics` | The set of Topics a Worker currently owns. |
| **Active / standby** | `role` | `active` Workers are eligible to become new Topic owners; `standby` Workers are not. A hidden tab is still `active` if it already owns Topics. |
| **Subscriber** | `subscriber` | A Tab that holds a local subscription record for a Topic. |
| **Route** | `route` | The persisted record mapping a `topicKey` to its owner Worker. |
| **Sticky** | — | Existing routes keep their owner while that owner is alive; load and visibility only affect placement of brand-new routes. |
| **Heartbeat** | `heartbeatAt` | A Worker's periodic liveness write to storage. Workers past `workerTtlMs` without refreshing are considered dead. |
| **Handoff** | `handoffFromWorkerId` | The graceful passing of a Topic from an old owner to a new one (e.g. on `pagehide`), with a strict release-ACK protocol so no Topic is ever owned twice simultaneously. |
| **Generation** | `generation` | A monotonic counter on each route. Handoff ACKs must reference a generation at least as new as the route's, so stale ACKs are ignored. |
| **Local mode** | `coordinated: false` | Degraded operation when storage or BroadcastChannel is unavailable: no cross-Tab routing, the Tab only uses its own transport. |

## Storage Structure

All keys are isolated by `createOpaqueKey(clusterKey)`. Topics are also stored as 128-bit opaque keys.

BroadcastChannel messages carry topic names, event types, and publication payloads in plaintext. Only the channel name (derived from `clusterKey`) is hashed. If topic names are sensitive, avoid including them as part of the plaintext payload, or use an end-to-end encryption layer on top of the data bus.

```text
cross-tab-worker-databus:{clusterHash}:worker:{workerId}
cross-tab-worker-databus:{clusterHash}:route:{topicKey}
cross-tab-worker-databus:{clusterHash}:subscriber:{topicKey}:{tabId}
```

Unlike the old single-JSON route table, subscribers use per-Tab independent keys. When Tab A and Tab B subscribe/unsubscribe concurrently, they do not perform a read-modify-write on the same `subscribers[]`, structurally reducing the probability of lost updates.

### Worker Record

```ts
interface WorkerRecord {
  workerId: string;
  tabId: string;
  load: number;
  role: 'active' | 'standby';
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  visibilityState: 'visible' | 'hidden';
  heartbeatAt: number;
  registeredAt: number;
}
```

Each Worker writes its own record independently. `load` is the number of Topics it is responsible for, not CPU percentage.

### Topic Route

```ts
interface WorkerRoute {
  topicKey: string;
  workerId: string;
  tabId: string;
  updatedAt: number;
  generation: number;
  handoffFromWorkerId?: string;
  confirmedAt?: number;
}
```

`generation` increments on every re-assignment and must match across the handoff handshake; `handoffFromWorkerId` records the previous owner during a graceful handoff. The interface above matches the current protocol — see [Failover](#failover) for how these two fields drive takeover.

Routes do not store the original topic string or payload. When the actual owner receives `CONTROL/SUBSCRIBE`, the original topic string is only passed through the BroadcastChannel in-memory message. `confirmedAt` is written after the owner processes the control message; before the route is confirmed, the subscriber Runtime holding the original topic string will resend `SUBSCRIBE` to recover from BroadcastChannel message loss that results in "a route without a real subscription".

### How `topic`, `topicKey`, `tabId`, `workerId`, and BroadcastChannel relate

These identifiers represent different layers:

| Object | Meaning | Main use | Persisted in coordination storage |
|---|---|---|---|
| `topic` | Original application Topic string | Passed to transport `subscribe`, `unsubscribe`, and `publish` | No; kept in Runtime memory and control messages |
| `topicKey` | Stable opaque key from `createOpaqueKey(topic)` | Joins route and subscriber records | Yes |
| `tabId` | Stable identity of a browser Tab | Identifies which Tab subscribes to a `topicKey` | Yes, in subscriber keys |
| `workerId` | Identity of the current Runtime/Worker instance | Identifies the Worker that owns the transport subscription | Yes, in worker/route records |
| `BroadcastChannel` | Same-origin, in-memory real-time channel | Carries control actions, publication events, and reconciliation signals | No |

```text
topic
  └─ createOpaqueKey(topic) → topicKey
       ├─ route:{topicKey}
       │    └─ workerId / tabId / generation / confirmedAt
       └─ subscriber:{topicKey}:{tabId}

BroadcastChannel CONTROL
  └─ topic + topicKey + sourceWorkerId + targetWorkerId + action
```

`topicKey` links storage records to control messages, but it cannot be reversed to recover the original `topic`. Only a live Runtime retains the in-memory `topicKey → topic` mapping.

### In-memory topic key cache (`knownTopics`)

Each Runtime maintains a `Map<topicKey, topic>` called `knownTopics` that serves as the reverse-lookup cache from opaque key to plaintext topic. It is populated by `rememberTopic()`, which is called on every `subscribe`, `publish`, `unsubscribe`, and inbound `CONTROL` message.

The cache exists for two reasons:

1. **Storage-less fallback.** When localStorage is unavailable (degraded mode), `readRoute()` and `readSubscriberTabIds()` have no persisted records to query. They reconstruct the route from in-memory state — but that requires recovering the plaintext `topic` from a `topicKey`. Without `knownTopics`, a topic whose key was evicted would silently return `null` from `readRoute()` even though the worker still owns it.

2. **Avoid re-hashing on every reconcile.** Each reconcile cycle iterates `subscribedTopics` and calls `rememberTopic` for each topic. The cache is updated unconditionally (hash is cheap, so there is no hit/miss penalty), but the reverse mapping is essential for the storage-less path.

**Cap and eviction.** The cache is capped at `MAX_KNOWN_TOPICS = 500` entries. This limit prevents a misbehaving or malicious peer from exhausting memory by referencing arbitrary topics in control messages — every `CONTROL` message the handler processes calls `rememberTopic`, which would otherwise grow the map unboundedly.

Eviction is FIFO (insertion order, Map iteration order). When the cache exceeds the cap, the oldest entry (first key in Map iteration) is removed:

- An entry is **never evicted** if the current worker still owns it (`assignedTopics.has(oldest)` guard), because the storage-less `readRoute` path depends on it.
- The entry being inserted is never evicted in the same step (`oldest !== topicKey` guard).
- Reads do not promote recency, so this is not true LRU. Hashing is cheap enough that a missed reverse-lookup merely recomputes the key.

**`isAssigned` bypasses the cache.** `isAssigned(topic)` calls `createOpaqueKey(topic)` directly rather than `rememberTopic()`. This is deliberate: `isAssigned` is a read-only query, not a state change, so it must not populate `knownTopics` (which could evict an entry the storage-less path needs). It also prefers the synchronous `assignedTopics` Map over reading the route from storage, avoiding a race with the `BatchingStorageWriter` flush window.

**Opaque key collision.** `createOpaqueKey` is a non-cryptographic 128-bit hash. The birthday collision bound (~2⁶⁴ for 50% probability) is far beyond the number of topics a single cluster handles (thousands at most). Similarly, `clusterKey` is hashed via `createOpaqueKey` to derive the storage prefix and BroadcastChannel name. In practice, `clusterKey` is always a connection URL or a developer-controlled namespace — naturally unique, so cross-cluster collision is not a concern.

**`clusterKey` isolation.** The `clusterKey` defines the cluster boundary. Two DataBus instances with different `clusterKey` values — even in the same origin — operate on completely isolated storage namespaces and BroadcastChannel names, even if they happen to use the same transport connection. This is how different logical clusters (e.g. market data vs. notifications) coexist without cross-talk.

**`knownTopics` lifecycle.** The cache is populated, read, and cleaned at specific points:

| Event | `knownTopics` mutation | Why |
|---|---|---|
| `subscribe(topic)` | `rememberTopic(topic)` → `set(topicKey, topic)` | Populate the reverse mapping; needed for storage-less `readRoute` |
| `publish(topic, data)` | `rememberTopic(topic)` → `set(topicKey, topic)` | Populate; same reason |
| `unsubscribe(topic)` | `delete(topicKey)` if not in `assignedTopics` | No longer needed; only keep it if we still own the topic |
| `CONTROL` received (any action: SUBSCRIBE / UNSUBSCRIBE / PUBLISH) | `rememberTopic(message.topic)` → `set(topicKey, topic)` | Every inbound control message carries the plaintext topic and the handler caches it before acting |
| `CONTROL/UNSUBSCRIBE` received | no direct deletion | `rememberTopic` still caches the topic; the entry is later removed by `reconcileAssignedTopics` once the route no longer points to this worker |
| `reconcileAssignedTopics` | `delete(topicKey)` if not subscribed and not owned | Route no longer points to us — clean up unless we're still a subscriber |
| `stop()` | `clear()` | Full teardown |
| FIFO eviction (next `rememberTopic` call) | `delete(oldest)` if `!assignedTopics.has(oldest)` | Cache size exceeded `MAX_KNOWN_TOPICS`; never evict owned keys |

**Storage-less fallback dependency.** When `this.storage` is `null` (degraded mode), `readRoute()` and `readSubscriberTabIds()` cannot query persisted records. They reconstruct routes from in-memory state alone:

- `readRoute(topicKey)` → looks up `knownTopics.get(topicKey)` to recover the plaintext topic, then checks `subscribedTopics.has(topic)` or `assignedTopics.has(topicKey)` to determine if this worker is the owner.
- `readSubscriberTabIds(topicKey, workers)` → `knownTopics.get(topicKey)` recovers the plaintext topic, then checks `subscribedTopics.has(topic)` — if we are a subscriber, we are the only subscriber (no storage means no cross-tab coordination).

This is why `assignedTopics` guards the FIFO eviction: evicting a key we still own would silently break `readRoute()` in storage-less mode, causing `isAssigned()` to disagree with `readRoute()`.

### One subscription and publication flow

```mermaid
sequenceDiagram
  participant App as App (Tab A)
  participant RuntimeA as Runtime A
  participant Storage as localStorage
  participant Channel as BroadcastChannel
  participant RuntimeB as Owner Runtime B
  participant Transport as Transport/server

  App->>RuntimeA: subscribe(topic, handler)
  RuntimeA->>RuntimeA: derive topicKey
  RuntimeA->>Storage: write subscriber:{topicKey}:{tabId}
  RuntimeA->>Storage: read or create route:{topicKey}
  RuntimeA->>Channel: CONTROL/SUBSCRIBE(topic, topicKey, targetWorkerId)
  Channel->>RuntimeB: deliver control message
  RuntimeB->>Transport: subscribe(topic)
  RuntimeB->>Storage: write route.confirmedAt
  Transport-->>RuntimeB: publication(topic, payload)
  RuntimeB->>Channel: EVENT/DATABUS_PUBLICATION
  Channel->>RuntimeA: deliver event
  RuntimeA->>App: invoke handler(payload)
```

A second Tab subscribing to the same Topic adds only its own subscriber record; it does not create another transport subscription while the existing owner is alive. Unsubscribe removes the current Tab's subscriber record. The owner unsubscribes the transport and removes the route only when no subscriber remains.

### Console diagnostics

If the application exposes the DataBus instance as `window.__bus`, the live Runtime can be inspected with:

```js
__bus.getClusterSnapshot().subscribedTopics
__bus.getClusterSnapshot().assignedTopics
__bus.getClusterSnapshot().knownTopics
console.table(__bus.getClusterSnapshot().routes)
```

`routes` now includes the plaintext `topic` (injected from the in-memory `knownTopics` cache), so each entry shows both the opaque key and the original topic name. `knownTopics` exposes the full `topicKey → topic` mapping for debugging. BroadcastChannel has no history API; inspect live messages by enabling trace or temporarily logging the `postMessage` and receive paths.

### Why Multiple localStorage Keys

This decentralized structure is a trade-off for concurrency correctness, not for reducing event listeners:

| Approach | Write Conflict | Cleanup Granularity | Main Issue |
|---|---|---|---|
| Single large JSON for Worker/route/subscriber | High | Only whole read/write | Multiple Tabs doing read-modify-write concurrently can easily overwrite each other, losing subscribers |
| Independent key per entity | Low | Can clean up per Worker, per route, per Topic+Tab precisely | More keys, requires TTL-based garbage collection |

The SDK does not rely on `storage` events to drive coordination; control notifications use BroadcastChannel. Although Worker heartbeats update their own independent key, this does not trigger repeated business callbacks or message dispatch within the SDK. The core benefit of separate keys is that different Tabs write different records, avoiding overwrite contention on a shared large object.

Under normal conditions, the number of keys is approximately: `Number of Workers + Number of Topic routes + Number of Topic/Tab subscription relationships`. The Runtime cleans up timed-out Workers, orphaned subscribers without active Tabs, and orphaned routes that have exceeded the Worker TTL and no longer have subscribers. Other naming structures left over from older versions do not belong to the current SDK protocol and do not participate in current route resolution.

### Storage Write Coalescing

Coordination metadata writes first enter an in-memory pending table, where they are merged by key within the same task (heartbeats, route confirmations, and subscriber updates share one flush), then batch-flushed to localStorage via a microtask. When a flush encounters a quota or write failure, it retries with exponential backoff from `50ms → 1600ms`. The current Tab's transport is not interrupted by coordination write failures. `clear()` resets the backoff counter to avoid starting retries from a delayed initial value after frequent cleaning.

Reads always see the not-yet-flushed pending values within the same task; cross-tab visibility is guaranteed by the microtask flush and the synchronous flush on `pagehide` / `stop()`. During `pagehide`, the owner writes and flushes the transferred route and its worker removal before broadcasting `REGISTRY`. If the unload-time `CONTROL / SUBSCRIBE` message is lost, receiving tabs therefore reconcile against the final persisted topology instead of waiting for their next heartbeat.

## Key State Inventory

Every keyed piece of state in the system — the full picture of what the previous sections described piece by piece. Each row has its own lifecycle; that is **why they are separate** and must not be merged:

| State | Owner class | Key | Value | Lifecycle | Why it is separate |
|---|---|---|---|---|---|
| `topicHandlers` | `CrossTabDataBus` | Plaintext `topic` | `Set<handler>` | Added/removed by app `subscribe`/`unsubscribe`; entry deleted when its last handler leaves | Reference-counts application-level handlers; belongs to the business layer |
| `transportSubscribedTopics` | `CrossTabDataBus` | Plaintext `topic` | marker | Cleared on disconnect; replayed from `assignedTopics` on reconnect | Tracks what the live transport connection actually holds; dies with the connection |
| `subscribedTopics` | `WorkerClusterRuntime` | Plaintext `topic` | marker | Grows as the first local handler subscribes; shrinks when the last one leaves | The Tab's durable subscription intent, survives transport failures |
| `assignedTopics` | `WorkerClusterRuntime` | `topicKey` | Plaintext `topic` | Set on receiving `CONTROL/SUBSCRIBE`; cleared on `CONTROL/UNSUBSCRIBE` or handoff | The authoritative "what I own" set; drives `isAssigned` and load |
| `knownTopics` | `WorkerClusterRuntime` | `topicKey` | Plaintext `topic` | FIFO-capped at 500; never evicts owned keys | The reverse-lookup cache; also the only source of plaintext in storage-less mode |
| Storage `worker:` | persisted | `clusterHash:…:worker:{workerId}` | JSON `WorkerRecord` | Heartbeat refresh; pruned after `workerTtlMs` | Cross-tab liveness discovery |
| Storage `route:` | persisted | `clusterHash:…:route:{topicKey}` | JSON `WorkerRoute` | Created/stamped by subscriber; pruned when no subscribers + TTL expired | Cross-tab owner mapping |
| Storage `subscriber:` | persisted | `clusterHash:…:subscriber:{topicKey}:{tabId}` | JSON `TopicSubscriberRecord` | Written per Tab subscription; pruned when the Tab dies | Cross-tab subscriber intent |

**How the three in-memory topic forms relate** (`knownTopics` ↔ `assignedTopics` ↔ the four plaintext sets):

```text
app subscribe/unsubscribe loop
        │  (handler reference counting)
        ▼
   topicHandlers ──────────────► subscribedTopics ──► storage subscriber + route
        (plaintext topic)         (plaintext topic)      (topicKey)
                                            │ CONTROL/SUBSCRIBE on the wire
                                            ▼
                                    assignedTopics ──► transport subscription
                                      (topicKey)         (plaintext topic again)
                                            │
                                            └─► knownTopics: reverse cache used by
                                                readRoute/readSubscriberTabIds (esp. storage-less)
```

The two `topicKey → topic` maps (`assignedTopics`, `knownTopics`) deliberately hold **the same pairs with different lifecycles**: `assignedTopics` is authoritative and never evicts, `knownTopics` is a bounded cache to keep plaintext reachable when no storage is present. After a plaintext topic leaves `assignedTopics` and `knownTopics` (via `reconcileAssignedTopics` or eviction), the Runtime can still read routes by `topicKey` — it just can no longer reverse them to plaintext.

## BroadcastChannel Protocol

All real-time coordination flows through one BroadcastChannel per cluster, whose name is derived from `clusterKey`. Messages on it exist only in memory: they never touch localStorage and never pass through the transport server. Four message types are exchanged:

| Type | Direction | Purpose |
|---|---|---|
| `CONTROL` | point-to-point (A → B) | Ask the target Worker to `SUBSCRIBE`, `UNSUBSCRIBE`, or `PUBLISH` a topic. Carries `action`, `topic`, `topicKey`, `targetWorkerId`, and an optional `data` payload. |
| `EVENT` | broadcast (owner → all Tabs) | Fan out a publication that the transport delivered to the owning Worker. Carries `eventType` and `payload`. |
| `REGISTRY` | broadcast | Nudge every Tab to reconcile immediately after a registry or route write, instead of waiting for the next heartbeat. |
| `ROUTE_RELEASED` | point-to-point (old owner → new owner) | Acknowledge a graceful handoff; only the new owner whose route `generation` matches may `SUBSCRIBE` (see Failover). |

The owning Worker filters every publication it receives with `isAssigned(topic)`, and every Tab filters inbound `EVENT` messages through its local subscriber records — each message is therefore dispatched exactly once. BroadcastChannel never echoes a message back to its sender, which is also why the owner does not double-dispatch its own broadcast.

## Owner Selection

1. Workers with status `connecting` / `connected` are prioritized for the candidate set.
2. If a visible Tab exists, visible Workers are preferred when choosing an owner for a new Topic; when all Tabs are hidden, hidden Workers remain eligible.
3. Sorted by `registeredAt, workerId`, up to 3 active Workers are selected as new-route candidates.
4. An existing route remains sticky as long as its owner Worker record is alive, regardless of load, visibility, or whether the owner remains in the new-route candidate set.
5. A second Tab subscribing to an existing Topic only writes its subscriber record. It does not modify the route or call its own transport `subscribe`.
6. Only a Topic without a route, or a route whose owner has departed or expired by heartbeat TTL, is assigned to the least-loaded candidate Worker.
7. A new route is considered unconfirmed until the owner writes `confirmedAt`; the subscriber will automatically resend the control message.

## Subscription Flow

```mermaid
sequenceDiagram
  participant App as Business Module
  participant Bus as CrossTabDataBus
  participant Route as Topic Route
  participant Channel as BroadcastChannel
  participant Owner as Owner Worker

  App->>Bus: subscribe(topic, handler)
  Bus->>Bus: First handler in this Tab?
  Bus->>Route: Write subscriber:{topicKey}:{tabId}
  Route-->>Bus: Current owner
  alt Owner does not exist or is invalid
    Bus->>Route: Write lowest-load owner
    Bus->>Channel: CONTROL / SUBSCRIBE
    Channel->>Owner: transport.subscribe(topic)
  end
```

Within the same DataBus instance, multiple handlers subscribing to the same topic are only registered once; the Tab's subscription is only canceled from the cluster after the last handler is released.

### Subscription state layers

The system maintains four independent subscription-tracking sets. Understanding their relationship is key to the architecture:

| Set | Location | Tracks | Lifecycle |
|---|---|---|---|
| `topicHandlers` | `CrossTabDataBus` | Application-level handler references per topic | Added/removed by `subscribe(topic, handler)` / `unsubscribe(topic, handler)` |
| `subscribedTopics` | `WorkerClusterRuntime` | Topics this tab has asked the cluster to coordinate | Added when `topicHandlers` goes 0→1; removed when it goes n→0 |
| `assignedTopics` | `WorkerClusterRuntime` | Topics this worker is the owner of (transport subscription responsibility) | Set on receiving `CONTROL/SUBSCRIBE`; cleared on `CONTROL/UNSUBSCRIBE` or handoff |
| `transportSubscribedTopics` | `CrossTabDataBus` | Topics the transport has been asked to subscribe to | Cleared on disconnect; replayed from `assignedTopics` on reconnect |

**Subscription propagation chain:**

```text
Application: subscribe(topic, handler)
  → topicHandlers 0→1
    → cluster.subscribe(topic) → subscribedTopics.add(topic)
      → write subscriber:{topicKey}:{tabId}
      → readRoute(topicKey)
        → if no route: selectLeastLoadedWorker, writeRoute, sendControl(SUBSCRIBE)
          → owner receives CONTROL/SUBSCRIBE
            → assignedTopics.set(topicKey, topic)
            → transport.subscribe(topic) → transportSubscribedTopics.add(topic)
```

**Unsubscribe propagation chain:**

```text
Application: unsubscribe(topic, handler) (last handler)
  → topicHandlers empty
    → cluster.unsubscribe(topic) → subscribedTopics.delete(topic)
      → releaseSubscription → delete subscriber record
        → if no subscribers left: delete route, sendControl(UNSUBSCRIBE)
          → owner receives CONTROL/UNSUBSCRIBE
            → assignedTopics.delete(topicKey)
            → transport.unsubscribe(topic) → transportSubscribedTopics.delete(topic)
```

**Disconnect / reconnect behavior:**

- On transport disconnect: `transportSubscribedTopics` is **cleared** immediately. The other three sets (`topicHandlers`, `subscribedTopics`, `assignedTopics`) survive unchanged.
- On transport reconnect: `CrossTabDataBus` iterates `assignedTopics` and re-calls `transport.subscribe(topic)` for each one, repopulating `transportSubscribedTopics`.
- This is how business subscription intent survives transport failures: the application never needs to re-subscribe after a reconnect.

## Message Flow

A publication travels publisher → current Topic owner → transport/server → owner → all Tabs:

1. Any Tab calls `publish(topic, data)`. The Runtime looks up `route:{topicKey}` and sends `CONTROL/PUBLISH` to the owner Worker; when no route exists the message is submitted to the current Tab's own transport.
2. The owner runs `transport.publish(topic, data)`. Because only the owner holds a real transport subscription to the topic, the server delivers the resulting publication back to exactly one Worker.
3. The owner accepts a publication only while `isAssigned(topic)` still holds. Stale messages from an expired owner are discarded — keeping the fan-out single-sourced.
4. The owner broadcasts `EVENT/DATABUS_PUBLICATION` over the BroadcastChannel and, if its own Tab also has a local subscription, dispatches once directly. BroadcastChannel never echoes to the sender, so there is no duplicate dispatch.
5. Every other Tab receives the `EVENT` but invokes its local handlers only when it holds a `subscriber:{topicKey}:{tabId}` record for that topic; Tabs without a local subscription drop the message.

Optional publication metadata (`messageId` and `timestamp`) follows the same path as the payload: `CONTROL/PUBLISH` → transport/server → `DataBusMessage` → `EVENT` fan-out. It is never written to coordination storage. Transports normalize legacy payloads and the canonical `DataBusPublicationEnvelope` before the three dispatch gates.

At the transport layer, a Centrifuge client can emit a publication both on the `client` object and on the matching `Subscription` object. To avoid dispatching the same server publication twice, the Centrifuge session only handles the client-level `publication` for topics that have **no active client-side subscription** (server-side subscriptions); topics with an active subscription are delivered solely through the subscription-level listener.

```mermaid
sequenceDiagram
  participant Pub as Publisher Tab A
  participant CH as BroadcastChannel
  participant Owner as Owner Tab B
  participant Server as Transport / server
  participant Other as Other Tabs C / D / E

  Pub->>CH: CONTROL/PUBLISH(topic, data, targetWorkerId=owner)
  CH->>Owner: deliver CONTROL/PUBLISH
  Owner->>Server: transport.publish(topic, data)
  Server-->>Owner: publication(topic, payload)
  Owner->>Owner: isAssigned(topic) holds?
  Owner->>CH: EVENT/DATABUS_PUBLICATION
  Owner->>Owner: local dispatch (if subscribed)
  CH->>Other: deliver EVENT
  Other->>Other: hasLocalSubscriber(topic) → invoke handlers
```

BroadcastChannel does not echo to its sender, so the owner receives no `EVENT` back for its own broadcast — its local dispatch is the only local delivery.

Publications are not written to localStorage. Message data and publication metadata only exist in the BroadcastChannel in-memory event and within the transport; batch writes only cover coordination metadata.

### Service Worker boundary

The SDK intentionally does not host a real-time transport in a Service Worker. Service Workers can be terminated between events, do not provide a durable foreground connection lifetime, and impose browser-specific restrictions around long-lived WebSockets. A future adapter would need an explicit connection owner, client wake-up protocol, reconnection policy, and durable handoff semantics; until those are standardized and covered by browser tests, Dedicated/Shared Worker transports remain the supported runtime models.

### Dispatch flow: three gates

Every publication from the transport goes through three checks before reaching the application handler:

1. **`isAssigned(topic)`** — called on the owning Worker when a transport message arrives (`handleTransportMessage`). If the topic is no longer assigned to this worker (e.g. a stale message from a previous ownership window), the message is dropped immediately. This is the outer gate: it prevents a non-owner from broadcasting.

2. **`broadcastEvent('DATABUS_PUBLICATION', message)`** — called only after `isAssigned` passes. The owning Worker fans the message out to all tabs via BroadcastChannel `EVENT`. Each tab receives the event but does not dispatch yet — it must pass the inner gate.

3. **`hasLocalSubscriber(topic)`** — called on each tab receiving the `EVENT`. Only tabs that have a local subscriber record for this topic invoke the registered handler. Tabs without a local subscription drop the message silently.

These three checks ensure **exactly-once dispatch per subscriber**:
- The outer gate (`isAssigned`) prevents duplicate broadcasts from a stale owner.
- The inner gate (`hasLocalSubscriber`) prevents a tab from dispatching a topic it never subscribed to.
- BroadcastChannel never echoes to its sender, so the owner does not receive its own `EVENT` — its local dispatch is the only local delivery.

```text
Transport message → isAssigned(topic)? → Yes → broadcastEvent(EVENT)
                                                 ↓
                                     Each tab receives EVENT
                                                 ↓
                                     hasLocalSubscriber(topic)? → Yes → dispatch(handler)
```

## Coordination & Reconciliation

Cluster convergence is driven on two timelines:

- **Heartbeat + reconcile loop** (default `3000 ms`, `heartbeatIntervalMs`). On every tick each Worker refreshes its own record and runs a reconcile pass: prunes Workers past `workerTtlMs`, orphaned subscribers whose Tab is no longer active, and orphaned routes that have no subscribers and exceed the TTL; recomputes its own active/standby role; re-writes its subscriber records; and re-sends `CONTROL/SUBSCRIBE` for any route that still lacks `confirmedAt` — which also recovers control messages lost on the channel.
- **`REGISTRY` nudge**. Writes to Worker records, routes, or subscribers broadcast a `REGISTRY` message so every peer reconciles immediately rather than waiting for the next heartbeat.

Heartbeat writes are not announced, so a stale record is only noticed within one heartbeat interval. The worst case for failing to detect a dead owner is `heartbeatIntervalMs + workerTtlMs` (default about 13 s); see [TTL Message-Loss Window](./configuration.md#ttl-message-loss-window) for the trade-offs.

## Failover

On normal close or entry into BFCache, `pagehide` pauses the Runtime: it deletes Worker and subscriber records, yields the actual owner, and closes the underlying transport, but retains the business subscription intent in memory. After the page is restored via `pageshow`, DataBus rebuilds the Worker/connection, and the Runtime automatically re-registers, restores subscriber records, and reconciles Topics, without requiring the business to re-call `subscribe`.

#### Tab identity and `window.open`

Each Runtime stores its `tabId` in `sessionStorage` so refreshes retain identity; every Runtime gets a random-suffixed `workerId`. Browsers may clone the opener's `sessionStorage` when `window.open()` creates a page, causing two physical tabs to share a `tabId` and collide on subscriber or diagnostic keys.

Applications should use `noopener` when opening a new tab. As a safety net, the SDK discards a copied sessionStorage id when an opener is detected and generates a fresh one. Inspection records are keyed by `tabId + workerId`, preventing Worker restart or handoff snapshots from overwriting one another.

`visibilitychange` does not remove business subscriptions or migrate established routes. A hidden Tab keeps the Topics it already owns and can still receive data broadcast by other owners. Visibility only affects candidate selection when a new Topic needs its first owner.

When an abnormal exit cannot execute the `pagehide` cleanup, other Runtimes scan Worker records and clean up by TTL.

If a Tab still subscribed to a Topic finds that the owner Worker has departed or expired, it selects a new owner and increments the route `generation`. Normal `pagehide` handoff is strict: the new route records `handoffFromWorkerId`, the old owner unsubscribes from transport first, then sends `ROUTE_RELEASED(generation)`, and only the matching new owner ACK handler sends `SUBSCRIBE`. If the old Worker has already disappeared, the new owner takes over immediately. A refreshed Tab that rejoins afterward records itself as a subscriber and reuses the replacement owner instead of taking the route back.

This process prevents overlap during graceful owner handoff while retaining availability during failure recovery; it does not guarantee exactly-once delivery.

## Stability Invariants

These invariants are pinned by regression tests (see `tests/stability.test.ts` and `tests/replay-persistence.test.ts`) and must hold through future refactors:

- **Handoff ACK validity.** A `ROUTE_RELEASED` is accepted only when the route still points at the receiver, the release comes from the recorded `handoffFromWorkerId`, and the ACK generation is at least as new as the stored route generation. Replayed ACKs from an earlier handoff round (e.g. an a↔b ping-pong) carry an older generation and are dropped.
- **Replay persistence cleanup ordering.** A batched persistence flush queued behind the current task is filtered against the cleanup that wins the race: `unsubscribe` and `clearReplayTopic` drop the topic's pending entries, `clearReplayBefore` drops entries older than the cutoff. Cleared history is never re-appended by an in-flight flush.
- **Storage write recovery.** Coalesced writes retry with exponential backoff (50 ms → 1.6 s cap). A structurally failing key is dropped after 5 attempts (with a `console.warn`) without permanently blocking other queued keys, and the backoff delay resets once the queue fully drains or `clear()` cancels the retries.
- **Transport recovery budget.** Automatic recovery is paced by a cooldown, bounded by `recovery.maxAttempts`, and reports `exhausted` when the budget is spent. A successful reopen resets the attempt counter and the exhausted flag; explicit `subscribe` on a down transport can still recover manually.
- **BFCache suspension.** Hiding the tab stops the transport, bumps the persistence-retry generation (cancelling in-flight persistence retries without surfacing errors), and gates dispatch; pageshow reopens the transport and re-establishes subscriptions exactly once per cycle.
- **Handoff channel close ordering.** `pause()` defers the physical `channel.close()` by one task. Closing synchronously would discard messages still queued for delivery — including the handoff's `ROUTE_RELEASED` — stranding the handoff target with an unconfirmed route until the original tab resumes.
- **Loss and recovery matrix.** Each coordination message has a bounded recovery path: a lost `CONTROL/SUBSCRIBE` is re-sent by the heartbeat reconcile for any route still lacking `confirmedAt`; a lost `REGISTRY` nudge costs at most one heartbeat interval (3 s default) because every tick reconciles anyway; a lost `ROUTE_RELEASED` is recovered by TTL cleanup of the orphaned route plus ownership re-election when the original owner resumes (pinned by regression); publications dropped during a transport disconnect window are the one documented unrecoverable loss (transport contract). The storage-event fallback channel guarantees value-change delivery via a monotonic sequence in the envelope, and a dropped dispatch recovers through the same reconcile loop.
- **Recovery diagnostics.** `getHealthSummary()` derives a single readiness verdict from the lifecycle flags (`stopped` / `starting` / `healthy` / `recovering` / `suspended` / `degraded`); the unified `lastFailure` ledger and persistence counters reset on every explicit `start()`.

## Transport Reconnection

DataBus separates "business subscription intent" from "transport current subscription state". When the transport reports `disconnected` / `error`, it only clears the underlying subscription flag, not the business handler; when it re-enters `connected`, DataBus automatically replays the Topics the current Worker is responsible for.

The built-in Centrifuge transport also retains its own Subscriptions and performs protocol-level reconnection. Both layers of recovery require `subscribe` / `unsubscribe` to be idempotent.

## Lifecycle State Machine

`CrossTabDataBus` uses several boolean flags and promise gates to serialize lifecycle transitions. The interaction between them is the most complex part of the DataBus layer.

### Flags

| Flag | Type | Meaning |
|---|---|---|
| `started` | `boolean` | `start()` has been called and no `stop()` has completed since |
| `stopping` | `boolean` | `stop()` is in progress; prevents new operations |
| `suspended` | `boolean` | Tab is hidden; transport is intentionally stopped |
| `transportReady` | `boolean` | Transport has reported `connected` and is accepting operations |
| `startPromise` | `Promise \| null` | Gate for concurrent `start()` calls; cleared after settle |
| `pendingStop` | `Promise \| null` | Gate for async `transport.stop()`; shared by suspend and failure paths |

### State transitions

```text
                  ┌──────────────────────────────────────────────┐
                  │                                              ▼
              ┌───────┐   start(config)    ┌──────────┐   openTransport ok   ┌───────────┐
              │ idle  │ ──────────────────→ │ starting │ ──────────────────→ │  running  │
              └───────┘                     └──────────┘                     └───────────┘
                  ▲                              │                               │
                  │                              │ openTransport fails           │ pagehide
                  │                              ▼                               │
                  │                          ┌──────────┐                        ▼
                  │                          │  failed  │                  ┌───────────┐
                  │                          └──────────┘                  │ suspended │
                  │                              │                         └───────────┘
                  │                              │ start(config) again          │
                  │                              ▼                              │ pageshow
                  │                          ┌──────────┐                        │
                  │                          │ starting │◄───────────────────────┘
                  │                          └──────────┘
                  │
                  │   stop()                  ┌──────────┐
                  └────────────────────────── │ stopped  │
                                              └──────────┘
```

**Key behaviors:**

- **Concurrent start**: If `start()` is called while `startPromise` is non-null, the second call returns the same promise. Only one transport open is in flight at a time.
- **Suspend during start**: If `pagehide` fires while `openTransport` is in flight, `suspendTransport()` sets `suspended = true` and chains a `transport.stop()` after the in-flight start. The `openTransport` catch path detects `suspended` and abandons the open without treating it as a failure.
- **Recovery cooldown**: When the transport reports `error` while `started` is true and `stopping` is false, `updateStatus` schedules an automatic `reopenTransport()` after `RECOVERY_COOLDOWN_MS` (1000 ms). A second error within the cooldown window is suppressed to prevent a tight retry loop.
- **Stop during suspend**: `stop()` sets `stopping = true`, which prevents `suspendTransport()` from running. The cleanup awaits `startPromise` and `pendingStop` to ensure any in-flight open or stop completes before the final `transport.stop()`.

## Degradation

The Runtime degrades to local mode when any of the following conditions are met:

- localStorage is not writable
- BroadcastChannel does not exist or construction fails
- SSR / Node environment without browser APIs

Local mode still calls the current transport's subscribe and publish methods, but does not perform cross-Tab routing or forwarding.

The Centrifuge transport also has a backend degradation scheme based on `workerMode`: `auto` tries SharedWorker → Dedicated Worker → main-thread local session in order; `dedicated` tries Dedicated Worker → SharedWorker → main-thread local session in order. The Runtime's cross-Tab degradation and the transport's backend degradation are independent of each other: even if the transport runs in a Worker, when localStorage or BroadcastChannel is unavailable, it still only runs within the current Tab.
