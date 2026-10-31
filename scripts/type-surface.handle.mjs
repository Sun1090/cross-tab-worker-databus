/**
 * The `verify:types` facade over the TypeScript 7 snapshot/handle API.
 *
 * This surface has no in-process object model. What it has, and what this file
 * bridges, measured on 7.0.2 (docs/progress.md Phase 329):
 *
 * - No `createProgram`. A program comes from a **tsconfig on disk** opened into
 *   a snapshot, so `openProgram` writes one into a temp directory. Options that
 *   the old code passed in memory (`strict`, `target`, `moduleResolution`) go
 *   into that file; `ModuleResolutionKind` is not exported at all, which is why
 *   `moduleResolution` is spelled the way a tsconfig spells it.
 * - No text -> AST parser. `factory.createSourceFile` is the node *factory*
 *   (`statements, endOfFileToken, text, fileName, path`), not a parser. So
 *   `parseSourceFiles` materialises the text into the temp directory and opens
 *   it as MCP-style `openFiles`, which lands each file in an inferred project
 *   with no tsconfig above it. That is also what makes the baseline side of
 *   check 1 work: its text comes from `git show` and never exists on disk.
 * - No module-level `forEachChild`; it is `RemoteNode.prototype.forEachChild`.
 * - Symbols expose `name` / `flags` / `declarations` as fields, and
 *   `declarations` holds `NodeHandle`s whose `resolve()` returns the node.
 *
 * Everything here is explicitly `unstable/*` upstream. The point of confining it
 * to this file is that when a subpath moves, one file stops compiling instead of
 * the gate silently reporting a surface it never walked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/**
 * @param {{ entryPaths: string[], version: string }} options
 */
export async function createHandleSurface({ entryPaths, version }) {
  const sync = await import('typescript/unstable/sync');
  const is = await import('typescript/unstable/ast/is');
  const ast = await import('typescript/unstable/ast');

  const syntax = {
    SyntaxKind: ast.SyntaxKind,
    ScriptTarget: ast.ScriptTarget,
    isExportDeclaration: is.isExportDeclaration,
    isNamespaceExport: is.isNamespaceExport,
    isVariableStatement: is.isVariableStatement,
    isIdentifier: is.isIdentifier,
    isQualifiedName: is.isQualifiedName,
    isInterfaceDeclaration: is.isInterfaceDeclaration,
    isTypeAliasDeclaration: is.isTypeAliasDeclaration,
    isClassDeclaration: is.isClassDeclaration,
    isEnumDeclaration: is.isEnumDeclaration,
    // `getModifiers` is gone; the modifiers are a property of the node.
    modifiersOf: statement => statement.modifiers ?? [],
    statementsOf: sourceFile => sourceFile.statements ?? [],
    exportElementsOf: exportDeclaration => exportDeclaration.exportClause?.elements ?? []
  };

  const workDirectory = mkdtempSync(join(tmpdir(), 'cross-tab-types-'));
  const api = new sync.API();
  let closed = false;

  const dispose = () => {
    if (closed) return;
    closed = true;
    try {
      api.close();
    } catch {
      // Closing a session that never initialised is not a gate failure.
    }
    rmSync(workDirectory, { recursive: true, force: true });
  };

  const surface = {
    kind: 'handle',
    compilerVersion: version,
    syntax,

    /**
     * Writes the text out and reads it back as a parsed `SourceFile`, keyed by
     * the caller's file name so error messages keep pointing at `src/…`.
     *
     * Each item gets its own directory: two entries can share a basename
     * (`workers/centrifuge.worker.ts` and a baseline of it), and a collision
     * would silently hand one item the other's text.
     */
    parseSourceFiles(items) {
      const staged = items.map((item, index) => {
        const directory = join(workDirectory, `parsed-${index}`);
        mkdirSync(directory, { recursive: true });
        const onDisk = join(directory, basename(item.fileName));
        writeFileSync(onDisk, item.text, 'utf8');
        return { fileName: item.fileName, onDisk };
      });
      if (staged.length === 0) return new Map();

      const snapshot = api.updateSnapshot({ openFiles: staged.map(item => item.onDisk) });
      const files = new Map();
      for (const item of staged) {
        const project = snapshot.getDefaultProjectForFile(item.onDisk);
        const sourceFile = project?.program.getSourceFile(item.onDisk);
        if (!sourceFile) {
          throw new Error(`[types] the handle API parsed nothing for ${item.fileName}`);
        }
        files.set(item.fileName, sourceFile);
      }
      return files;
    },

    openProgram() {
      // `files` takes absolute paths, so the six entries stay the program's
      // roots — the same set `createProgram(entryPaths, …)` used to receive.
      const configPath = join(workDirectory, 'tsconfig.json');
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            compilerOptions: { strict: true, target: 'ES2020', moduleResolution: 'bundler', noEmit: true },
            files: entryPaths
          },
          null,
          2
        ),
        'utf8'
      );

      const snapshot = api.updateSnapshot({ openProjects: [configPath] });
      const project = snapshot.getProjects()[0];
      if (!project) {
        throw new Error('[types] the handle API opened no project for the entry declarations');
      }
      const { program, checker } = project;
      const exportsCache = new Map();

      const exportsOfSourceFile = sourceFile => {
        const key = sourceFile.fileName ?? '';
        const cached = exportsCache.get(key);
        if (cached) return cached;
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        const symbols = moduleSymbol ? [...moduleSymbol.getExports().values()] : [];
        exportsCache.set(key, symbols);
        return symbols;
      };

      const facade = {
        exportsOf(entryPath) {
          const sourceFile = program.getSourceFile(entryPath);
          if (!sourceFile) throw new Error(`[types] no source file for ${entryPath}`);
          return exportsOfSourceFile(sourceFile);
        },
        nameOf: symbol => symbol.name,
        aliasOf(symbol) {
          let current = symbol;
          // There is no `getAliasedSymbol` here, and the two obvious substitutes
          // are both wrong: `getExportSymbol()` returns the alias itself
          // (measured: flags still carry `SymbolFlags.Alias`), and
          // `checker.getResolvedSymbol(identifier)` returns `undefined` for a
          // type-position identifier. `getDeclaredTypeOfSymbol(alias).getSymbol()`
          // is what actually crosses the boundary — measured on an
          // `import type { T }` reference it yields `T` with `flags = 64`
          // (Interface) and no Alias bit.
          //
          // This mattered: with `getExportSymbol()` the walk never reached the
          // aliased declaration, so a deliberately leaked type passed the gate on
          // TypeScript 7 while the same tree failed it on 6.0.3.
          for (let hops = 0; current && current.flags & sync.SymbolFlags.Alias && hops < 16; hops += 1) {
            let next;
            try {
              next = checker.getDeclaredTypeOfSymbol(current)?.getSymbol?.() ?? null;
            } catch {
              next = null;
            }
            // The hop cap is not a guess: an alias chain that long is a cycle,
            // and this walk runs inside a recursive descent.
            if (!next || next === current) break;
            current = next;
          }
          return current ?? null;
        },
        declarationsOf(symbol) {
          const nodes = [];
          for (const handle of symbol?.declarations ?? []) {
            const node = handle.resolve();
            if (node) nodes.push(node);
          }
          return nodes;
        },
        symbolAt: node => checker.getSymbolAtLocation(node),
        declaredKindOf(node) {
          if (is.isInterfaceDeclaration(node)) return 'interface';
          if (is.isTypeAliasDeclaration(node)) return 'type';
          if (is.isClassDeclaration(node)) return 'class';
          if (is.isEnumDeclaration(node)) return 'enum';
          return null;
        },
        fileNameOf: node => node.getSourceFile().fileName,
        exportsOfFile(fileName) {
          const sourceFile = program.getSourceFile(fileName);
          if (!sourceFile) return new Set();
          return new Set(exportsOfSourceFile(sourceFile).map(symbol => symbol.name));
        },
        identifierOf(node) {
          if (is.isIdentifier(node)) return node;
          if (is.isQualifiedName(node)) return node.right;
          return null;
        },
        forEachChild(node, visit) {
          if (typeof node.forEachChild !== 'function') return;
          node.forEachChild(child => {
            visit(child);
            return undefined;
          });
        }
      };
      return facade;
    },

    close: dispose
  };

  return surface;
}
