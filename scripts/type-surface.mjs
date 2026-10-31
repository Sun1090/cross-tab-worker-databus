/**
 * Which compiler surface `verify:types` drives.
 *
 * The gate was written against the in-process object API
 * (`createProgram`, `createSourceFile`, `forEachChild`, …). TypeScript 7 no
 * longer exposes it: the root entry is version metadata only and the object API
 * is gone, replaced by a snapshot/handle protocol under `typescript/unstable/*`.
 * See docs/progress.md Phase 329 for the measurement behind that statement.
 *
 * Rather than fork the gate, this module classifies the installed compiler and
 * returns a small facade (`type-surface.object.mjs` /
 * `type-surface.handle.mjs`) exposing exactly the primitives the two checks
 * need. The checks themselves stay in one place, so the two surfaces cannot
 * drift into disagreeing about what a leak is.
 *
 * The facade contract, and the only thing a new compiler surface has to
 * implement:
 *
 *   kind                          'object' | 'handle', for the summary line
 *   parseExportedNames(items)     items: { fileName, text }[] -> Map<fileName, Set<name>>
 *   openProgram(entryPaths)       -> program facade, see below
 *   close()                       releases whatever was opened
 *
 * Program facade:
 *
 *   exportsOf(entryPath)          -> symbol[]
 *   nameOf(symbol)                -> string
 *   aliasOf(symbol)               -> symbol | null   (follows an alias to its target)
 *   declarationsOf(symbol)        -> node[]
 *   symbolAt(node)                -> symbol | undefined
 *   declaredKindOf(node)          -> 'interface' | 'type' | 'class' | 'enum' | null
 *   fileNameOf(node)              -> string
 *   exportsOfFile(fileName)       -> Set<string>
 *   identifierOf(node)            -> node | null      (Identifier, or the right of a QualifiedName)
 *   forEachChild(node, visit)     -> void
 *
 * `syntax` carries the node predicates and enum values the checks use. They are
 * the same names on both surfaces, differing only in where they are imported
 * from, which is why they are passed through instead of imported directly.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Classifies a loaded compiler module. Pure, so the shapes can be exercised
 * without installing the compiler they describe.
 *
 * @returns {{ ts: unknown, kind: 'object' | 'handle', version: string }}
 */
export function classify(ts) {
  const version = ts != null && typeof ts.version === 'string' ? ts.version : 'unknown';
  if (ts != null && typeof ts.createProgram === 'function') return { ts, kind: 'object', version };
  // A root entry carrying nothing but `version` is the TypeScript 7 stub. It is
  // not the handle surface either — that is a subpath — but it is the shape that
  // makes `openSurface` responsible for the diagnosis instead of this function.
  return { ts, kind: 'handle', version };
}

/**
 * @returns {{ ts: unknown, kind: 'object' | 'handle', version: string }}
 */
export function detectCompiler() {
  let ts;
  try {
    ts = require('typescript');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[types] unable to load the installed typescript: ${reason}`, { cause: error });
  }
  return classify(ts);
}

/**
 * @param {{ ts: unknown, kind: 'object' | 'handle', version: string, entryPaths: string[] }} options
 */
/**
 * The diagnosis for a compiler that exposes neither surface.
 *
 * Split out as a pure function so the wording is testable without a TypeScript 7
 * install: the import failure that triggers it cannot be injected from a test.
 */
export function unavailableSurfaceMessage(version, reason) {
  // Say what happened, name the version, and say what the failure is *not*: the
  // gate reached no verdict about the public type surface, so a reader must not
  // take this exit for one. Same intent as scripts/compiler-api.mjs, for the
  // surface that replaced the object API.
  return (
    `[verify:types] the installed typescript (${version}) exposes neither the in-process object API ` +
    `nor the typescript/unstable/sync handle API (${reason}). TypeScript 7 moved the program ` +
    'interface to that subpath; if it is absent here, nothing in this run is evidence about the ' +
    'public type surface. See docs/progress.md Phase 329 for the measurement.'
  );
}

export async function openSurface({ ts, kind, version, entryPaths }) {
  if (kind === 'object') {
    const { createObjectSurface } = await import('./type-surface.object.mjs');
    return createObjectSurface(ts, { entryPaths, version });
  }
  try {
    const { createHandleSurface } = await import('./type-surface.handle.mjs');
    return await createHandleSurface({ entryPaths, version });
  } catch (error) {
    throw new Error(unavailableSurfaceMessage(version, error instanceof Error ? error.message : String(error)), {
      cause: error
    });
  }
}
