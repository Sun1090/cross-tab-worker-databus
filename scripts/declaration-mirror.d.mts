/** Type surface for `declaration-mirror.mjs`, so tests and `build.mjs` can import it under `strict`. */

/** Rewrite every relative `.js` module specifier to `.cjs`, leaving package specifiers untouched. */
export declare function toCjsSpecifiers(text: string): string;

/** Top-level declarations under `dist`, sorted, skipping `cjs/` and `workers/`. */
export declare function collectDeclarations(dist: string): string[];

/** Relative `.cjs` specifiers inside one mirrored declaration that name no `.d.cts` beside it. */
export declare function danglingSpecifiers(mirrorFile: string): string[];

export declare function mirrorDeclarations(options: { dist: string; distCjs: string }): { count: number };
