# Roadmap

0.18.0 is the current development line. The project is intentionally continuing through reliability-focused minor releases before a 1.0.0 stability freeze.

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

## 0.13.0 candidates

1. Freeze the public export surface and transport-neutral publication envelope.
2. Document at-least-once delivery and deduplication guarantees precisely.
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
