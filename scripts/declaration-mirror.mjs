/**
 * The CommonJS declaration mirror: `dist/**\/*.d.ts` → `dist/cjs/**\/*.d.cts`.
 *
 * `tsc` emits one declaration tree and it is ESM, because the root
 * `package.json` says `"type": "module"` and a `.d.ts` file's format is decided
 * by that scope. A CommonJS consumer on `module: node16` refuses such a
 * declaration outright — `require`ing an ESM-format declaration is TS1479 —
 * while `nodenext` tolerates it only because Node 22 can `require(esm)`. The two
 * modes disagree, so one tree cannot answer for both.
 *
 * The copy is not cosmetic: `.d.cts` makes the file CommonJS by extension
 * alone, and relative specifiers have to be rewritten `./x.js` → `./x.cjs` so
 * the mirrored graph closes on itself. Without the rewrite the mirror cannot
 * resolve its own imports (`./core/data-bus.cjs` has no `.d.cts` twin under
 * that name) and fails with TS2307 from inside `node_modules` — measured, not
 * assumed; docs/progress.md Phase 337 records both the control and the fix.
 *
 * `workers/` is skipped deliberately: `./centrifuge.worker` and its sibling are
 * ESM-only subpaths whose `exports` entries carry no `require` condition, so
 * there is no CommonJS consumer for those declarations to serve.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** In these declarations a quoted relative `.js` string only ever appears as a module specifier. */
const SPECIFIER = /(['"])(\.\.?\/[^'"]*)\.js\1/g;

export const toCjsSpecifiers = text => text.replace(SPECIFIER, '$1$2.cjs$1');

/** Top-level `dist` declarations, in a stable order, skipping the two directories the mirror does not serve. */
export function collectDeclarations(dist) {
  return readdirSync(dist, { withFileTypes: true })
    .flatMap(entry => {
      if (entry.name === 'cjs' || entry.name === 'workers') return [];
      const full = join(dist, entry.name);
      if (entry.isDirectory()) return collectDeclarations(full);
      return entry.name.endsWith('.d.ts') ? [full] : [];
    })
    .sort();
}

/**
 * Relative specifiers in a mirrored declaration that name a `.d.cts` the mirror
 * does not contain.
 *
 * Derivation alone does not make a graph usable: a `dist` declaration that
 * imports `./workers/x.js` is mirrored *faithfully* into `./workers/x.cjs`, and
 * the derived-equivalence test in `tests/dual-format.test.ts` stays green,
 * while every CommonJS consumer of that declaration fails with TS2307 because
 * `workers/` is never mirrored. Closure is a separate property from derivation,
 * so it gets its own assertion.
 */
export function danglingSpecifiers(mirrorFile) {
  const dangling = [];
  for (const match of readFileSync(mirrorFile, 'utf8').matchAll(/(['"])(\.\.?\/[^'"]*)\.cjs\1/g)) {
    const specifier = match[2];
    if (!existsSync(join(dirname(mirrorFile), `${specifier}.d.cts`))) dangling.push(`${specifier}.cjs`);
  }
  return dangling;
}

/**
 * Mirror every top-level declaration into `dist/cjs` as `.d.cts` and assert the
 * result is a closed graph. Returns the mirrored count so the caller can report
 * it; throws rather than reporting when the mirror would be unusable.
 */
export function mirrorDeclarations({ dist, distCjs }) {
  const declarations = collectDeclarations(dist);

  // Silently mirroring nothing would leave every CommonJS consumer on `node16`
  // with the failure this exists to prevent, so the count is asserted.
  if (declarations.length === 0) {
    throw new Error(`[build] no declarations found to mirror under ${dist} for CommonJS consumers`);
  }

  const mirrored = declarations.map(declaration => {
    const relativePath = relative(dist, declaration).replace(/\.d\.ts$/, '.d.cts');
    const target = join(distCjs, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, toCjsSpecifiers(readFileSync(declaration, 'utf8')));
    return { relativePath, target };
  });

  const dangling = mirrored.flatMap(({ relativePath, target }) =>
    danglingSpecifiers(target).map(specifier => `${relativePath} -> ${specifier}`)
  );  if (dangling.length > 0) {
    throw new Error(
      `[build] the CommonJS declaration mirror references files it does not contain:\n  ${dangling.join('\n  ')}\n` +
        '[build] a mirrored declaration may only reference other declarations that are mirrored too'
    );
  }

  return { count: mirrored.length };
}
