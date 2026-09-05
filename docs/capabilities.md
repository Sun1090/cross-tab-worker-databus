> [中文](./zh/capabilities.md) | English

# Capabilities Matrix

Status Legend: `✅ Implemented` means the current version has code and test coverage; `Not Implemented` means no guarantee is currently provided; `Planned` means it has entered the scope of future design, but no version has been committed yet.

| Category | Capability | Status | Current Behavior / Boundary |
|---|---|---|---|
| Core API | Framework-agnostic subscribe, unsubscribe, publish, and status listening | ✅ Implemented | Provides a unified API via `CrossTabDataBus` |
| Startup Experience | Auto-start after creation, queued subscriptions before connecting, `ready()` | ✅ Implemented | Apps don't need to wait for a connection before registering Topics |
| In-Tab Reuse | Reference counting for multiple handlers on the same Topic | ✅ Implemented | The first handler registers; the last handler releases |
| Cross-Tab Coordination | Worker transport with BroadcastChannel control plane | ✅ Implemented | Each Tab gets a Dedicated Worker by default; in SharedWorker mode same-origin Tabs reuse the Worker, and Topic owners are shared across Tabs |
| Resource Limits | At most three active Workers | ✅ Implemented | Configurable via `maxActiveWorkers` |
| Topic Routing | Sticky existing owners with load-balanced first assignment | ✅ Implemented | Existing routes stay unchanged while the owner is alive; only new or orphaned Topics select the least-loaded candidate |
| Subscription Reliability | Per-Tab independent subscriber records | ✅ Implemented | Avoids multiple Tabs modifying the same subscriber array and overwriting each other |
| Subscription Reliability | Owner acknowledgment and automatic resend of unconfirmed routes | ✅ Implemented | Automatically retransmits when control messages are lost, so a stored route is not mistaken for a real successful subscription |
| Page Lifecycle | `pagehide` owner pre-transfer and transport shutdown | ✅ Implemented | Persists the replacement route and worker removal before notifying peers, so a dropped unload-time control message still converges immediately |
| Page Lifecycle | `pageshow`, BFCache restoration, and business subscription rebuild | ✅ Implemented | Apps don't need to call `subscribe` again |
| Visibility | Visible preference for new Topic placement | ✅ Implemented | Visibility changes do not migrate established routes; visible Workers are preferred only when a Topic needs a new owner |
| Exception Recovery | Worker TTL, stale owner migration, and coordination cache cleanup | ✅ Implemented | Reclaims dead Workers, orphaned subscribers, and expired routes with no subscribers |
| transport | Replays owner Topics after reconnect | ✅ Implemented | Business handlers and subscription intent are not cleared on disconnect |
| Degradation | Runs locally when localStorage or BroadcastChannel is unavailable | ✅ Implemented | Preserves the current Tab's connection and subscription capabilities |
| Degradation | Opt-in localStorage storage-event coordination channel when BroadcastChannel is unavailable | ✅ Implemented | `createBrowserEnvironment({ channelFallback: 'storage-event' })`; coordination payloads (plaintext topic names) persist to localStorage — documented trade-off |
| Centrifuge | Built-in Dedicated / Shared Worker transport | ✅ Implemented | Supports subscribe, unsubscribe, publish, connection status, and error reporting; `auto` degrades from SharedWorker → Dedicated Worker → main-thread WebSocket |
| Security Boundary | localStorage uses opaque keys derived from connection and Topic; BroadcastChannel coordination messages carry plaintext topic names | ✅ Implemented | Does not persist URLs, raw Topic names, credentials, or publication payloads. BroadcastChannel coordination messages are in-memory only and carry plaintext topic names — they are not persisted. |
| Diagnostics | Aggregates lifecycle events, throughput, delivery latency, dedup outcomes, recovery retries, route acknowledgments, and migrations | ✅ Implemented | Disabled by default; metrics are emitted every 5 seconds by default, with bounded reliability events for recovery and route coordination |
| Diagnostics | `getHealthSummary()` single-object readiness verdict and unified failure ledger | ✅ Implemented | `healthy`/`state` covers stopped, starting, recovering, BFCache-suspended, and recovery-exhausted degraded; `lastFailure` unifies transport/persistence/dispatch sources and resets on `start()` |
| Performance | Batched writes of coordination metadata with backoff retry | ✅ Implemented | Heartbeat, route, and subscriber writes are merged and flushed in a microtask; failures use exponential backoff; `pagehide` / `stop()` flush synchronously |
| Performance | Optional ArrayBuffer Transferable transport | ✅ Implemented |
| Performance | Optional `DataBusTransport.publishBatch` one-frame burst publishing | ✅ Implemented | The bundled WebSocket transport sends multi-item batches in one wire frame (`publishBatch` op, demo server supported); transports without batch support fall back to per-item `publish` | With `transferable: true`, binary publish / receive bypasses structured clone copying; the object message API is unchanged |
| Message Semantics | exactly-once delivery | Not Implemented | Graceful handoff avoids overlap, but crash recovery and transport/server behavior still do not provide an exactly-once guarantee |
| Message Semantics | Pluggable publication deduplication | ✅ Implemented | Opt-in bounded inbound suppression by `DataBusMessage.messageId`; default is disabled and transport/server IDs remain caller-controlled |
| Authentication | Async credential refresh bridge inside the Worker | Planned | Current Worker config must be structured-cloneable and cannot pass functions |
| Load Policy | Adaptive weighting by message rate, byte count, or CPU | Planned | Load is currently computed only from the number of owner Topics |
| Observability | Metrics/events for owner acknowledgments, migrations, and recovery attempts | ✅ Implemented | `DataBusReliabilityTraceEvent` reports bounded route ack/migration and transport recovery events; exact server-side ack remains transport-specific |
| Runtime Model | SharedWorker / Dedicated Worker transport | ✅ Implemented | `workerMode` supports `dedicated`, `shared`, and `auto`, defaulting to `dedicated` |
| Runtime Model | Service Worker transport | Not Implemented | Deliberately deferred; lifetime and long-lived connection constraints are documented in `docs/architecture.md` |
| Durable Messages | Persisting publications or publish commands across page close | Not Implemented | The SDK does not persist business payloads, nor does it replay publish commands after restoration |

## Acceptance Criteria

- "Implemented" does not mean every browser environment provides cross-Tab capability; when localStorage or BroadcastChannel is missing, it falls back to local degradation by design.
- Writing an owner route to storage does not mean the subscription has been established. Only when the owner writes `confirmedAt` after processing `SUBSCRIBE` does it represent that the control message has arrived; the server-side final subscription state is still the responsibility of the transport.
- The SDK guarantees subscription-intent recovery and eventual migration, but does not guarantee exactly-once within the migration window.
