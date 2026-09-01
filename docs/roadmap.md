# Roadmap

0.11.0 is the current development line. The next work is organized as 1.0.0 candidates, with protocol stability and operational guarantees taking priority over adding another browser runtime.

## 0.11.0 delivered scope

- Automatic durable replay retention through `replay.retentionMs` when the persistence adapter supports `clearBefore`.
- Deduplication accepted/suppressed counters in periodic trace metrics.
- Publication metadata compatibility coverage across WebSocket, Centrifuge, Worker boundaries, and browser E2E.
- Service Worker transport decision: remain deliberately unimplemented until a stable connection-lifetime contract exists across target browsers.

## 1.0.0 candidates

1. Freeze the public export surface and transport-neutral publication envelope.
2. Document at-least-once delivery and deduplication guarantees precisely.
3. Add long-running browser soak coverage for replay retention, reconnect, BFCache, and owner migration.
4. Publish a migration guide and deprecation policy for any pre-1.0 protocol aliases.

## 0.7.0 candidates

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
