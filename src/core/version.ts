/**
 * SDK version reported in diagnostics and health summaries.
 *
 * The value is injected at bundle time (esbuild `define`) from package.json, so
 * what it cannot drift from is that field — and `scripts/verify-release-version.mjs`
 * refuses a tag that is not `v` plus that field, which is the whole of the chain
 * from this constant to a release. The two readers of this file at source level
 * take it differently: `vitest.config.ts` passes the same define read from the
 * same field, while `pnpm typecheck` evaluates no code and so sees only the
 * `declare` below, which is what keeps `tsc` happy where no define is present.
 */
declare const __SDK_VERSION__: string | undefined;

export const SDK_VERSION: string =
  // The `''` arm has zero counts in every coverage run and cannot be lit from a
  // test: `vitest.config.ts` defines the global for the whole suite, and so does
  // each bundle `scripts/build.mjs` emits, so reaching this side needs a tool that
  // consumes `src/` without passing the define — and this repository has none. The
  // two source-level readers are named in the header above, and only one of them
  // evaluates this expression. It cannot be deleted either, since the
  // declaration's type is `string | undefined` and the export's is `string`
  // (dropping the conditional is TS2322, measured). Recorded here so the leg reads
  // as a shape the harness cannot reach rather than as a case nobody exercised.
  typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : '';
