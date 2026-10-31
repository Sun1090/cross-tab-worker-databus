/**
 * The `verify:types` facade over the in-process object API (TypeScript <= 6).
 *
 * Every primitive here is a one-line delegation: this file exists so the checks
 * have one shape to call, not because the object API needs interpretation. The
 * commentary is limited to the two places where the facade has to *choose*.
 */
import { followAlias } from './alias-chain.mjs';

/**
 * @param {any} ts the installed compiler
 * @param {{ entryPaths: string[], version: string }} options
 */
export function createObjectSurface(ts, { entryPaths, version }) {
  const syntax = {
    SyntaxKind: ts.SyntaxKind,
    ScriptTarget: ts.ScriptTarget,
    isExportDeclaration: ts.isExportDeclaration,
    isNamespaceExport: ts.isNamespaceExport,
    isVariableStatement: ts.isVariableStatement,
    isIdentifier: ts.isIdentifier,
    isQualifiedName: ts.isQualifiedName,
    isInterfaceDeclaration: ts.isInterfaceDeclaration,
    isTypeAliasDeclaration: ts.isTypeAliasDeclaration,
    isClassDeclaration: ts.isClassDeclaration,
    isEnumDeclaration: ts.isEnumDeclaration,
    modifiersOf: statement => ts.getModifiers(statement) ?? [],
    statementsOf: sourceFile => sourceFile.statements,
    exportElementsOf: exportDeclaration => exportDeclaration.exportClause?.elements ?? []
  };

  let program = null;

  const surface = {
    kind: 'object',
    compilerVersion: version,
    syntax,

    /** @param {{ fileName: string, text: string }[]} items -> Map<fileName, SourceFile> */
    parseSourceFiles(items) {
      const files = new Map();
      for (const item of items) {
        files.set(item.fileName, ts.createSourceFile(item.fileName, item.text, ts.ScriptTarget.Latest, true));
      }
      return files;
    },

    openProgram() {
      program = ts.createProgram(entryPaths, {
        strict: true,
        target: ts.ScriptTarget.ES2020,
        moduleResolution: ts.ModuleResolutionKind.Bundler
      });
      const checker = program.getTypeChecker();
      const pathOf = sourceFile => sourceFile.fileName;

      const facade = {
        exportsOf(entryPath) {
          const sourceFile = program.getSourceFile(entryPath);
          if (!sourceFile) throw new Error(`[types] no source file for ${entryPath}`);
          const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
          if (!moduleSymbol) throw new Error(`[types] no module symbol for ${entryPath}`);
          return [...checker.getExportsOfModule(moduleSymbol)];
        },
        nameOf: symbol => symbol.getName(),
        aliasOf(symbol) {
          return followAlias(symbol, {
            isAlias: candidate => (candidate.flags & ts.SymbolFlags.Alias) !== 0,
            follow: candidate => {
              try {
                return checker.getAliasedSymbol(candidate);
              } catch {
                return null;
              }
            }
          });
        },
        declarationsOf: symbol => symbol?.getDeclarations() ?? [],
        symbolAt: node => checker.getSymbolAtLocation(node),
        declaredKindOf(node) {
          if (ts.isInterfaceDeclaration(node)) return 'interface';
          if (ts.isTypeAliasDeclaration(node)) return 'type';
          if (ts.isClassDeclaration(node)) return 'class';
          if (ts.isEnumDeclaration(node)) return 'enum';
          return null;
        },
        fileNameOf: node => pathOf(node.getSourceFile()),
        exportsOfFile(fileName) {
          const sourceFile = program.getSourceFile(fileName);
          if (!sourceFile) return new Set();
          const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
          return new Set(moduleSymbol ? checker.getExportsOfModule(moduleSymbol).map(s => s.getName()) : []);
        },
        identifierOf(node) {
          if (ts.isIdentifier(node)) return node;
          if (ts.isQualifiedName(node)) return node.right;
          return null;
        },
        forEachChild(node, visit) {
          ts.forEachChild(node, child => {
            visit(child);
            return undefined;
          });
        }
      };
      return facade;
    },

    close() {
      program = null;
    }
  };

  return surface;
}
