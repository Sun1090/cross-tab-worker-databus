/**
 * Hand-written declarations for the compiler-API preflight, so
 * `tests/verify-public-types.test.ts` can exercise it under `tsc --strict`
 * without turning `scripts/` into TypeScript.
 */

/** Members of the TypeScript object API that `verify:types` calls. */
export declare const REQUIRED_COMPILER_API: readonly string[];

/**
 * Every member of `REQUIRED_COMPILER_API` that `ts` does not provide. A
 * non-object argument reports the whole list, the same way a compiler that
 * lost the API does.
 */
export declare function missingCompilerApi(ts: unknown): string[];

/**
 * Throw a diagnosable error unless `ts` carries the API the gate needs, and
 * return the version string it accepted.
 */
export declare function assertCompilerApi(
  ts: unknown,
  options?: { gate?: string }
): string;
