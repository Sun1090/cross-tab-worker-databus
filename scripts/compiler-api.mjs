/**
 * Preflight for the gates that drive the TypeScript compiler in-process.
 *
 * `pnpm verify:types` is the only gate that can see a type-only export, and it
 * does that with the compiler's object API (`createProgram`, a checker, the
 * syntax walk). That API was part of `require('typescript')` for the whole 5.x
 * and 6.x line, so the script has always been able to assume it.
 *
 * Measured on 7.0.2, it cannot any more: the package root resolves to
 * `./lib/version.cjs`, which carries version metadata and nothing else — every
 * one of `createSourceFile`, `createProgram`, `SyntaxKind`, `ScriptTarget`,
 * `ModuleResolutionKind`, `SymbolFlags` and `forEachChild` reads `undefined` on
 * the root import, and the AST moved to the separate, explicitly unstable
 * `typescript/unstable/ast` subpath.
 *
 * Without this preflight the failure surfaces as
 * `TypeError: Cannot read properties of undefined (reading 'Latest')` from
 * inside the walk — a message that names neither the version, nor the gate, nor
 * the fact that the migration is upstream work rather than a public-surface
 * regression. Worse, it would arrive on a *dependency bump* commit, where the
 * reader's first hypothesis is that the bump broke the library.
 *
 * So the check is a claim about the installed compiler, made once, at the top:
 * either the API this repository was written against is present, or the gate
 * says so by name and stops.
 */

/**
 * Every compiler-API member `scripts/verify-public-types.mjs` calls.
 *
 * Keep this list tied to the gate's own call sites rather than to what looks
 * complete: an entry that the gate does not use turns the preflight into a
 * compatibility assertion about TypeScript, and it would then reject a future
 * compiler that dropped something irrelevant while the gate itself still
 * worked. `tests/verify-public-types.test.ts` pins the list against the
 * script's source text for exactly that reason.
 */
export const REQUIRED_COMPILER_API = Object.freeze([
  'createSourceFile',
  'createProgram',
  'SyntaxKind',
  'ScriptTarget',
  'ModuleResolutionKind',
  'SymbolFlags',
  'forEachChild'
]);

/**
 * The members of `REQUIRED_COMPILER_API` that `ts` does not provide.
 *
 * A non-object argument reports every member, so a resolution failure (an
 * `undefined` import, a stub loader) takes the same path as a compiler that
 * lost the API — both mean "this gate cannot run", and neither should read as
 * a clean pass.
 */
export function missingCompilerApi(ts) {
  if (ts === null || (typeof ts !== 'object' && typeof ts !== 'function')) {
    return [...REQUIRED_COMPILER_API];
  }
  return REQUIRED_COMPILER_API.filter(name => ts[name] == null);
}

/**
 * Throw a diagnosable error unless `ts` carries the API the gate needs.
 *
 * Returns the version string it accepted, so the caller can print it beside a
 * passing run — the version is the operand a future reader needs to know which
 * compiler the surface was checked against.
 */
export function assertCompilerApi(ts, { gate = 'verify:types' } = {}) {
  const missing = missingCompilerApi(ts);
  if (missing.length === 0) {
    const version = typeof ts.version === 'string' ? ts.version : 'unknown';
    return version;
  }
  const version = typeof ts?.version === 'string' ? ts.version : 'unknown';
  throw new Error(
    `[${gate}] the installed typescript (${version}) does not expose the in-process compiler API ` +
      `this gate is written against: missing ${missing.join(', ')}. ` +
      "TypeScript 7 moved it — the package root resolves to version metadata only, and the AST " +
      "lives under `typescript/unstable/*` — so this gate has to be ported before the dependency " +
      'moves. Nothing here is evidence about the public type surface: do not read this failure as ' +
      'a removal or a leak. The measured migration probe (zero type errors on this tree, emit ' +
      'differs only in literal quoting) is recorded in docs/progress.md under `TypeScript 7`.'
  );
}
