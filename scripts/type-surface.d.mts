/**
 * Hand-written declarations for the compiler-surface selector, so
 * `tests/verify-public-types.test.ts` can exercise it under `tsc --strict`
 * without turning `scripts/` into TypeScript.
 */

/** Which interface the installed compiler exposes. */
export type CompilerKind = 'object' | 'handle';

export interface DetectedCompiler {
  /** The loaded compiler module, or whatever `require` returned. */
  ts: unknown;
  /** `object` for the in-process API (TypeScript <= 6), `handle` for 7's subpath API. */
  kind: CompilerKind;
  /** `ts.version`, or `'unknown'` when the module carries none. */
  version: string;
}

/** Classify an already-loaded compiler module. Pure. */
export declare function classify(ts: unknown): DetectedCompiler;

/** Load `typescript` and classify it. */
export declare function detectCompiler(): DetectedCompiler;

/**
 * The diagnosis for a compiler that exposes neither surface. Pure, so its
 * wording is testable without the install that triggers it.
 */
export declare function unavailableSurfaceMessage(version: string, reason: string): string;

/** Open the facade the two checks drive. */
export declare function openSurface(options: {
  ts: unknown;
  kind: CompilerKind;
  version: string;
  entryPaths: string[];
}): Promise<unknown>;
