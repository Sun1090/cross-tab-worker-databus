# Roadmap

0.4.0 is released. The next work is intentionally organized as 0.5.0 candidates so performance and persistence changes can land together with their compatibility notes.

## 0.5.0 candidates

1. **Publish-path profiling and optimization** — use both `pnpm bench` and `pnpm bench:browser`; optimize only after isolating storage batching, routing, and UI/server overhead separately.
2. **Persistent replay history** — add an IndexedDB adapter for replay history across page reloads and BFCache sessions, with explicit retention and schema-version controls. Keep in-memory replay as the zero-dependency default.
3. **Vue composables** — provide a Vue 3 adapter mirroring the React hooks lifecycle and subscription semantics without making Vue a core dependency.
4. **End-to-end binary demo** — exercise real `ArrayBuffer` frames through the WebSocket demo path; keep the existing base64 JSON fallback for servers that only support JSON.
5. **Push CI browser gate** — run the existing Playwright suite on pushes when a Chrome environment is available; keep local/manual execution as the fallback for contributors.

## Release checklist

- Update the `[Unreleased]` section and version date.
- Run `pnpm check`, `pnpm lint`, `pnpm test:e2e`, `pnpm bench`, and `pnpm bench:browser`.
- Run ESM/CJS package-consumption smoke tests from the packed tarball.
- Tag the release and verify the GitHub Release and npm `latest` dist-tag.
