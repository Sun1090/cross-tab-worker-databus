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

const require = createRequire(import.meta.url);
const gateSource = readFileSync('scripts/verify-public-types.mjs', 'utf8');

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

describe('REQUIRED_COMPILER_API tracks the gate', () => {
  it('is called before the first compiler-API use', () => {
    const callAt = gateSource.indexOf('assertCompilerApi(ts');
    expect(callAt, 'verify-public-types.mjs must call assertCompilerApi(ts, …)').toBeGreaterThan(-1);
    const uses = [...gateSource.matchAll(/\bts\.([A-Za-z_]+)/g)].map(match => match.index ?? 0);
    expect(uses.length).toBeGreaterThan(0);
    expect(callAt).toBeLessThan(Math.min(...uses));
  });

  it('lists only members the gate actually calls', () => {
    // The reverse direction of the ordering case: a listed member with no call
    // site is a compatibility assertion about TypeScript, not a precondition of
    // this repository's gate.
    const unused = REQUIRED_COMPILER_API.filter(name => !new RegExp(`\\bts\\.${name}\\b`).test(gateSource));
    expect(unused).toEqual([]);
  });
});
