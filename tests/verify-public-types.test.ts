/**
 * Guards for the compiler-API preflight (`scripts/compiler-api.mjs`).
 *
 * The preflight exists because `verify:types` — the only gate that can see a
 * type-only export — drives the TypeScript compiler in-process, and the 7.x
 * line no longer publishes that API at the package root: `require('typescript')`
 * resolves to version metadata, so `ts.createProgram` reads `undefined` and the
 * gate dies inside its own walk with
 * `TypeError: Cannot read properties of undefined (reading 'Latest')`.
 *
 * Two claims are worth pinning, and they fail for different reasons:
 *
 *  1. The preflight rejects a version-only export, and says so in a message that
 *     names the version and the missing members. A guard that throws *something*
 *     is not the deliverable — the deliverable is a reader who learns, from the
 *     message alone, that a dependency bump moved the API rather than that the
 *     library's public surface regressed.
 *  2. `REQUIRED_COMPILER_API` is tied to the gate's own call sites. A member
 *     listed but never called would turn the preflight into a compatibility
 *     assertion about TypeScript itself, and would then refuse a future compiler
 *     that dropped something irrelevant while the gate still worked.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { REQUIRED_COMPILER_API, assertCompilerApi, missingCompilerApi } from '../scripts/compiler-api.mjs';
import { classify, detectCompiler, specifierFromArgv, unavailableSurfaceMessage } from '../scripts/type-surface.mjs';

const require = createRequire(import.meta.url);
const gateSource = readFileSync('scripts/verify-public-types.mjs', 'utf8');
// The gate stopped touching `ts.*` when the object and handle surfaces were
// split; the object surface is where those call sites live now.
const objectSurfaceSource = readFileSync('scripts/type-surface.object.mjs', 'utf8');

/** A compiler stub carrying every member the gate needs. */
function completeCompiler(version = '6.0.3') {
  return Object.fromEntries([
    ['version', version],
    ...REQUIRED_COMPILER_API.map(name => [name, () => undefined])
  ]);
}

describe('missingCompilerApi', () => {
  it('reports nothing for a compiler that carries the whole API', () => {
    expect(missingCompilerApi(completeCompiler())).toEqual([]);
  });

  it('reports exactly the members that are absent, not the whole list', () => {
    const partial = completeCompiler();
    delete (partial as Record<string, unknown>).createProgram;
    expect(missingCompilerApi(partial)).toEqual(['createProgram']);
  });

  it('treats a null member as absent rather than present-but-falsy', () => {
    // `SyntaxKind === null` and `SyntaxKind === undefined` are the same failure
    // to the gate: both throw on first use. `!= null` is what makes them one
    // case; a `name in ts` test would call this present.
    const stubbed = { ...completeCompiler(), SyntaxKind: null };
    expect(missingCompilerApi(stubbed)).toContain('SyntaxKind');
  });

  it('reports every member when the import resolved to nothing', () => {
    expect(missingCompilerApi(undefined)).toEqual([...REQUIRED_COMPILER_API]);
    expect(missingCompilerApi(null)).toEqual([...REQUIRED_COMPILER_API]);
    expect(missingCompilerApi('6.0.3')).toEqual([...REQUIRED_COMPILER_API]);
  });
});

describe('assertCompilerApi', () => {
  it('returns the version it accepted', () => {
    expect(assertCompilerApi(completeCompiler('6.0.3'))).toBe('6.0.3');
  });

  it('rejects a version-only export, which is the 7.x shape', () => {
    // Measured: `typescript@7.0.2`'s root entry (`./lib/version.cjs`) carries
    // `version` and nothing else; the AST moved to `typescript/unstable/ast`.
    const versionOnly = { version: '7.0.2' };
    expect(() => assertCompilerApi(versionOnly, { gate: 'verify:types' })).toThrowError(
      /verify:types.*7\.0\.2.*unstable/s
    );
  });

  it('names every missing member, so the reader does not have to bisect them', () => {
    const message = (() => {
      try {
        assertCompilerApi({ version: '7.0.2' });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    for (const name of REQUIRED_COMPILER_API) expect(message).toContain(name);
  });

  it('says the failure is not evidence about the public surface', () => {
    // The failure arrives on a dependency-bump commit, where the first
    // hypothesis is "the bump broke the library". The message has to refuse
    // that reading explicitly, because `verify:types` exiting 1 normally *is*
    // a removal-or-leak verdict.
    expect(() => assertCompilerApi({ version: '7.0.2' })).toThrowError(/public type surface/);
  });

  it('accepts the compiler this repository is installed against', () => {
    // Not redundant with the stub cases: this is the leg that says the required
    // list is not over-broad. Under a TypeScript 7 install it reddens here,
    // naming the migration, before the gate itself can produce a confusing one.
    expect(assertCompilerApi(require('typescript'))).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('REQUIRED_COMPILER_API tracks the surface that uses it', () => {
  it('is asserted before the surface that needs it is opened', () => {
    const assertAt = gateSource.indexOf('assertCompilerApi(compiler.ts');
    expect(assertAt, 'verify-public-types.mjs must call assertCompilerApi(compiler.ts, …)').toBeGreaterThan(-1);
    const openAt = gateSource.indexOf('openSurface(');
    expect(openAt, 'verify-public-types.mjs must open a surface').toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(openAt);
    // Only the object branch is asserted member-by-member. A compiler without the
    // object API may still be a working TypeScript 7, and asserting the object
    // members unconditionally is what would have made the preflight into a
    // blocker on the migration rather than a diagnostic for it.
    expect(gateSource).toMatch(/compiler\.kind === 'object'\) assertCompilerApi/);
  });

  it('lists only members the object surface actually calls', () => {
    // The reverse direction of the ordering case: a listed member with no call
    // site is a compatibility assertion about TypeScript, not a precondition of
    // this repository's gate. The call sites moved out of the gate and into the
    // object surface when the two compiler surfaces were split, so this leg is
    // anchored on the file that now drives `ts`.
    const unused = REQUIRED_COMPILER_API.filter(name => !new RegExp(`\\bts\\.${name}\\b`).test(objectSurfaceSource));
    expect(unused).toEqual([]);
  });

  it('is not vacuously satisfied by the gate text alone', () => {
    // Pins the reason the leg above moved: the gate no longer touches `ts.*`.
    expect(/\bts\.[A-Za-z_]/.test(gateSource)).toBe(false);
  });
});

describe('detectCompiler', () => {
  it('classifies the installed compiler by the API it actually exposes', () => {
    const detected = detectCompiler();
    expect(detected.kind).toBe('object');
    expect(detected.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof (detected.ts as { createProgram?: unknown }).createProgram).toBe('function');
  });

  it('reads the version off a compiler that exposes no object API', () => {
    // The shape `typescript@7.0.2` ships at its root: version metadata only. It
    // classifies as `handle` — the handle surface is a subpath, not the root —
    // and the version has to survive so the later diagnosis can name it.
    const { kind, version } = classify({ version: '7.0.2' });
    expect(kind).toBe('handle');
    expect(version).toBe('7.0.2');
  });

  it('does not claim a version it could not read', () => {
    expect(classify({}).version).toBe('unknown');
  });

  it('loads whichever compiler the caller names, not only the package called typescript', () => {
    // The whole point of `--compiler`: the package named `typescript` is the 6.0
    // compatibility shim (docs/progress.md Phase 334), so without a specifier the
    // handle surface could only be reached by replacing node_modules (Phase 335).
    // Pin both aliases rather than the mechanism, so removing either one fails
    // here instead of in a CI job nobody reads.
    const handle = detectCompiler('@typescript/native');
    expect(handle.kind).toBe('handle');
    expect(handle.version).toMatch(/^7\./);
    expect(handle.specifier).toBe('@typescript/native');
  });

  it('names the specifier it could not load rather than the default one', () => {
    // A typo in `--compiler=` must not read as "the installed typescript broke".
    expect(() => detectCompiler('typescript-does-not-exist')).toThrowError(
      /unable to load the compiler typescript-does-not-exist/
    );
  });
});

describe('specifierFromArgv', () => {
  it('defaults to the package the repository depends on as typescript', () => {
    expect(specifierFromArgv([])).toBe('typescript');
  });

  it('takes the specifier out of --compiler= and ignores everything else', () => {
    expect(specifierFromArgv(['--verbose', '--compiler=@typescript/native'])).toBe('@typescript/native');
  });

  it('lets the last flag win, so a wrapper script can override a default it prepends', () => {
    expect(specifierFromArgv(['--compiler=first', '--compiler=second'])).toBe('second');
  });

  it('refuses an empty specifier instead of resolving it as the default', () => {
    // `--compiler=` with nothing after it would otherwise load the default and
    // report a green run against a compiler the caller did not ask for.
    expect(() => specifierFromArgv(['--compiler='])).toThrowError(/--compiler= needs a module specifier/);
    expect(() => specifierFromArgv(['--compiler=   '])).toThrowError(/--compiler= needs a module specifier/);
  });
});

describe('unavailableSurfaceMessage', () => {
  const message = unavailableSurfaceMessage('7.0.2', 'Cannot find module typescript/unstable/sync');

  it('names the version and the subpath the program interface moved to', () => {
    expect(message).toContain('7.0.2');
    expect(message).toContain('typescript/unstable/sync');
  });

  it('refuses the verdict reading', () => {
    // This exit arrives on a dependency bump. `verify:types` exiting non-zero
    // normally *is* a removal-or-leak verdict, so the message has to say that
    // this run reached none.
    expect(message).toMatch(/nothing in this run is evidence about the public type surface/);
  });
});
