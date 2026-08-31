# Roadmap

0.5.0 is released. The next work is organized as 0.6.0 candidates, with publish-path improvements landing first because they are measurable without changing the public transport contract.

## 0.6.0 candidates

1. **Publish-path profiling and optimization** — continue isolating routing, storage, and transport overhead; the first 0.6.0 slice adds a synchronous owner fast path for local publishes.
2. **Vue composables** — provide a Vue 3 adapter mirroring the React hooks lifecycle and subscription semantics without making Vue a core dependency. (Adapter implemented; contract coverage and examples remain.)
3. **End-to-end binary demo** — exercise real `ArrayBuffer` frames through the WebSocket demo path; keep the existing base64 JSON fallback for servers that only support JSON.
4. **Push CI browser gate** — run the existing Playwright suite on pushes when a Chrome environment is available; keep local/manual execution as the fallback for contributors.
5. **Operational polish** — document IndexedDB replay retention/cleanup and add diagnostics around persistence quota failures.

## Release checklist

- Update the `[Unreleased]` section and version date.
- Run `pnpm check`, `pnpm lint`, `pnpm test:e2e`, `pnpm bench`, and `pnpm bench:browser`.
- Run ESM/CJS package-consumption smoke tests from the packed tarball.
- Tag the release and verify the GitHub Release and npm `latest` dist-tag.
