/**
 * Public type-surface gate.
 *
 * Nothing else in the repository can see a type-only export.
 * `tests/dual-format.test.ts` freezes the runtime `Object.keys()` of the built
 * barrel, and a declaration emits no runtime key; `verify:compat` compares
 * package.json `exports`/`types` fields, never names. So a type could be added
 * to, or dropped from, the public surface with every gate green — which is how
 * `DataBusPublicationItem` and `WorkerAvailability` ended up named by public
 * signatures while being impossible to import.
 *
 * Two checks, both mechanical:
 *
 * 1. Non-removal. Every name a public entry exported at the previous release
 *    tag must still be exported. Same baseline rule as `verify:compat`
 *    (`COMPAT_BASE_TAG` overrides, and a tagged HEAD falls back one release).
 * 2. Closure. If a consumer can reach a named type declared in this repository
 *    from a public entry, they must be able to import it — from *some* public
 *    entry, since `./centrifuge` legitimately returns a `CrossTabDataBus` whose
 *    members are typed by names the root barrel exports.
 *
 * Closure collects names from the *syntax* of the emitted declarations rather
 * than by walking types. That is a deliberate trade: a type-level walk has to
 * follow each member and instantiation it meets, and on this surface it costs
 * >4 GB of heap once the depth bound is loosened enough to be sound. The
 * reference walk visits only the finite set of repository type symbols, so it
 * needs no depth cap and sees a nested member's type argument, `keyof`, union
 * arm or `typeof` query the same way. Its one blind spot is a name `tsc`
 * resolves away instead of emitting it — which is also the name a consumer
 * cannot get wrong, and so what `declaredTypeName` exempts on purpose.
 *
 * Check 1 reads `src/`, check 2 reads `dist/`, so a stale `dist/` makes check 2
 * describe the previous build. That is the same exposure
 * `tests/dual-format.test.ts` already has, and `pnpm check` (which builds) runs
 * before this in both workflows.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const workspace = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'));

// Every entry that ships declarations, taken from the `exports` map so a new
// subpath is covered the moment it is advertised.
const entries = Object.entries(pkg.exports ?? {})
  .filter(([subpath, entry]) => subpath !== './package.json' && typeof entry?.types === 'string')
  .map(([subpath, entry]) => {
    const declaration = join(workspace, entry.types);
    const source = resolve(workspace, entry.types)
      .replace(/^.*[\\/]dist[\\/]/, join(workspace, 'src') + '/')
      .replace(/\.d\.ts$/, '.ts');
    return { subpath, declaration, source };
  });

const missing = entries.filter(entry => !existsSync(entry.declaration));
if (missing.length) {
  throw new Error(
    `declaration missing for ${missing.map(e => e.subpath).join(', ')}; ` +
    '`pnpm build` must run before `pnpm verify:types`'
  );
}

function exportedNamesFromSourceText(text, fileName) {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause == null) {
        throw new Error(`${fileName} uses 'export *', which this gate cannot reason about`);
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        throw new Error(`${fileName} uses 'export * as', which this gate cannot reason about`);
      }
      // `element.name` is what the consumer writes, so `export { A as B }`
      // contributes B — the alias is the contract, the target is not.
      for (const element of statement.exportClause.elements) names.add(element.name.text);
      continue;
    }
    const modifiers = ts.getModifiers(statement);
    if (!modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        names.add(declaration.name.getText());
      }
    } else if (statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  }
  return names;
}

function currentExportedNames(entry) {
  return exportedNamesFromSourceText(readFileSync(entry.source, 'utf8'), entry.source);
}

// --- check 1: non-removal against the previous release tag -------------------

let baseTag = process.env.COMPAT_BASE_TAG;
if (!baseTag) {
  const tags = execFileSync('git', ['tag', '--sort=-v:refname', '--list', 'v*'], { encoding: 'utf8' })
    .split('\n')
    .map(tag => tag.trim())
    .filter(Boolean);
  if (tags.length === 0) {
    throw new Error('no version tag found to use as the type baseline; set COMPAT_BASE_TAG');
  }
  const headTags = execFileSync('git', ['tag', '--points-at', 'HEAD'], { encoding: 'utf8' })
    .split('\n')
    .map(tag => tag.trim())
    .filter(Boolean);
  baseTag = tags.find(tag => !headTags.includes(tag)) ?? tags[0];
}

const removed = [];
// Counts the names the baseline side of this comparison actually produced. `removed`
// is built by iterating `baselineNames`, so an empty one means either "nothing was
// lost" or "the parser found nothing to lose" — and both print the same success line.
// The parser is the shared suspect: `exportedNamesFromSourceText` feeds the baseline
// *and* `currentExportedNames` feeds the other side, so a regression in it does not
// produce a false removal report, it produces a clean run over an empty set.
let baselineNamesSeen = 0;
for (const entry of entries) {
  let baselineText;
  try {
    baselineText = execFileSync('git', ['show', `${baseTag}:${relative(workspace, entry.source)}`], {
      encoding: 'utf8'
    });
  } catch (error) {
    // A subpath newer than the baseline has nothing to have lost. Any *other*
    // git failure (detached worktree, shallow clone) must not read as "clean".
    const reason = error instanceof Error ? error.message : String(error);
    if (!/does not have any files|fatal: path .* exists on disk/i.test(reason)) {
      throw new Error(`unable to read ${relative(workspace, entry.source)} at ${baseTag}: ${reason}`, { cause: error });
    }
    continue;
  }
  const baselineNames = exportedNamesFromSourceText(baselineText, relative(workspace, entry.source));
  const now = currentExportedNames(entry);
  baselineNamesSeen += baselineNames.size;
  for (const name of baselineNames) {
    if (!now.has(name)) removed.push(`${entry.subpath}: ${name}`);
  }
}
// 96 baseline names across the six public subpaths when this bound was set, two of which
// legitimately carry none (a worker entry newer than the baseline tag). The floor is on the
// aggregate for that reason, and it is deliberately far below the measurement: reaching it
// would take the parser returning nothing for most entries, which is the failure being
// guarded against and not a healthy tree. Re-derive the current total by printing
// `baselineNames.size` per entry in this loop — do not copy a number out of this comment.
if (baselineNamesSeen <= 50) {
  throw new Error(
    `[types] the baseline scan produced ${baselineNamesSeen} exported name(s) across ${entries.length} ` +
      'public subpaths, which is too few for the non-removal check to have compared anything. ' +
      'Check exportedNamesFromSourceText before believing any "no removals" line from this script.'
  );
}

// --- check 2: closure over the union of public entries ----------------------

const program = ts.createProgram(
  entries.map(entry => entry.declaration),
  { strict: true, target: ts.ScriptTarget.ES2020, moduleResolution: ts.ModuleResolutionKind.Bundler }
);
const checker = program.getTypeChecker();
const rootOf = file => file.startsWith(join(workspace, 'src')) || file.startsWith(join(workspace, 'dist'));

function resolveAlias(symbol) {
  let current = symbol;
  while (current?.flags & ts.SymbolFlags.Alias) {
    let next;
    try {
      next = checker.getAliasedSymbol(current);
    } catch {
      break;
    }
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

const importableNames = new Map();
for (const entry of entries) {
  const declarationFile = program.getSourceFile(entry.declaration);
  const moduleSymbol = checker.getSymbolAtLocation(declarationFile);
  if (!moduleSymbol) throw new Error(`no module symbol for ${entry.declaration}`);
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    importableNames.set(symbol.getName(), entry.subpath);
  }
}

const visited = new Set();
const moduleExports = new Map();

/** Names a module itself exports, keyed by source file. */
function exportedFromModule(declarationFile) {
  const cached = moduleExports.get(declarationFile.fileName);
  if (cached) return cached;
  const moduleSymbol = checker.getSymbolAtLocation(declarationFile);
  const names = new Set(
    moduleSymbol ? checker.getExportsOfModule(moduleSymbol).map(symbol => symbol.getName()) : []
  );
  moduleExports.set(declarationFile.fileName, names);
  return names;
}

/**
 * The name of a repository type symbol that its own module exports, or null.
 *
 * "exported by its module" is what makes this a *forgotten last mile* rather
 * than an implementation detail. `WorkerUnsafeOption` in
 * `src/centrifuge-protocol.ts` is reachable from `./centrifuge` through
 * `Omit<Partial<Options>, WorkerUnsafeOption>` and a mapped-type key, and stays
 * module-local on purpose: `tsc` resolves it away for the consumer, who never
 * inhabits that position. Exporting it would add a public name nobody can use.
 * The two shapes this gate does report are exported from an internal module and
 * then referenced as something a caller has to *write a value of*.
 */
function declaredTypeName(symbol) {
  const declaration = (symbol?.getDeclarations() ?? []).find(node =>
    ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node) || ts.isEnumDeclaration(node));
  if (!declaration) return null;
  const file = declaration.getSourceFile();
  if (!rootOf(file.fileName)) return null;
  if (file.fileName.includes('node_modules') || basename(file.fileName).startsWith('lib.')) return null;
  const name = symbol.getName();
  if (!exportedFromModule(file).has(name)) return null;
  return { name, file: relative(workspace, file.fileName) };
}

function walkReferences(symbol, origin, trail) {
  const key = `${origin}\u0000${symbol.getName()}`;
  if (visited.has(key)) return;
  visited.add(key);
  for (const declaration of symbol.getDeclarations() ?? []) {
    // Only the declaration surface of a `.d.ts` matters: consumers never see a
    // body, and `dist/**/*.d.ts` has none for these kinds anyway.
    visit(declaration);
  }

  function visit(node) {
    let identifier = null;
    if (ts.isIdentifier(node)) identifier = node;
    else if (ts.isQualifiedName(node)) identifier = node.right;
    if (identifier) {
      const target = resolveAlias(checker.getSymbolAtLocation(identifier));
      const named = target ? declaredTypeName(target) : null;
      if (named && !importableNames.has(named.name)) {
        if (!leaked.has(named.name)) {
          leaked.set(named.name, `${named.file}  reached from ${origin} (${trail})`);
        }
      } else if (named && !visited.has(`${origin}\u0000${named.name}`)) {
        // Reachable *and* importable: its own declaration may still mention a
        // name nobody exports, so it joins the worklist.
        walkReferences(target, origin, `${trail} > ${named.name}`);
      }
    }
    ts.forEachChild(node, visit);
  }
}

const leaked = new Map();
for (const entry of entries) {
  const declarationFile = program.getSourceFile(entry.declaration);
  const moduleSymbol = checker.getSymbolAtLocation(declarationFile);
  for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
    // No per-export leak check here: every name this loop visits was just added
    // to `importableNames` from the same export list, so it is importable by
    // construction. Only its *references* can escape the public surface.
    walkReferences(resolveAlias(exportSymbol), `${entry.subpath} → ${exportSymbol.getName()}`, 'export');
  }
}

const leakLines = [...leaked].map(([name, where]) => `${name}: ${where}`);

if (removed.length) {
  console.error(`[types] ${removed.length} name(s) exported at ${baseTag} are no longer exported:`);
  for (const line of removed) console.error(`  - ${line}`);
}
if (leakLines.length) {
  console.error('[types] public signatures reference type names no entry exports:');
  for (const line of leakLines) console.error(`  - ${line}`);
}
if (removed.length || leakLines.length) {
  console.error(
    '[types] either export the name from a public entry (it is already part of the ' +
    'API — a consumer has to write it inline today) or stop naming it in a public signature'
  );
  process.exit(1);
}
console.log(
  `[types] ${entries.length} entries, ${importableNames.size} importable names, ` +
  `surface closed and nothing dropped since ${baseTag}`
);
