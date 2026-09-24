/**
 * SDK version reported in diagnostics and health summaries.
 *
 * The value is injected at bundle time (esbuild `define`) from package.json so
 * it can never drift from the release. Source-level consumers (typecheck,
 * vitest) get the same value via the vitest `define`; the declare keeps tsc
 * happy when no define is present.
 */
declare const __SDK_VERSION__: string | undefined;

export const SDK_VERSION: string =
  // The `''` arm has zero counts in every coverage run and cannot be lit from a
  // test: `vitest.config.ts` defines the global for the whole suite, and so does
  // each bundle `scripts/build.mjs` emits, so reaching this side needs a consumer
  // that bundles `src/` without passing the define — which is also the only
  // consumer this module is read by at source level. It cannot be deleted either,
  // since the declaration's type is `string | undefined` and the export's is
  // `string` (dropping the conditional is TS2322, measured). Recorded here so the
  // leg reads as a shape the harness cannot reach rather than as a case nobody
  // exercised.
  typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : '';
