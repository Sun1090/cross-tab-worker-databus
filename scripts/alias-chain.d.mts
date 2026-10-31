/**
 * Hand-written declarations for the shared alias-chain walk, so
 * `tests/alias-chain.test.ts` can exercise it under `tsc --strict` without
 * turning `scripts/` into TypeScript.
 */

export declare function followAlias<T>(
  symbol: T | null | undefined,
  options: {
    isAlias: (symbol: T) => boolean;
    follow: (symbol: T) => T | null | undefined;
    maxHops?: number;
  }
): T | null;
