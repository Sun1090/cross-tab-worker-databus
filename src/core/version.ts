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
  typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : '';
