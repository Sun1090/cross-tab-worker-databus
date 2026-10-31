/** Type surface for `consumer-types.mjs`, so tests can import it under `strict`. */

export interface CompilerOptions {
  module: string;
  moduleResolution: string;
}

export interface ConsumerMode {
  readonly id: string;
  readonly label: string;
  readonly dir: string;
  readonly type: 'module' | 'commonjs';
  readonly compilerOptions: CompilerOptions;
  /** Declaration the mode must read, asserted from the compiler's `--listFiles`. */
  readonly expects: string;
}

export declare const MODES: readonly ConsumerMode[];

/** A condition tree, kept open: new conditions are legal manifest keys. */
export interface ExportEntry {
  readonly require?: unknown;
  readonly import?: unknown;
  readonly types?: unknown;
  readonly default?: unknown;
  readonly [condition: string]: unknown;
}

export interface ManifestShape {
  exports?: Record<string, ExportEntry | string>;
}

/** Every subpath whose `exports` entry carries a `require` condition. Throws when there are none. */
export declare function dualFormatSubpaths(manifest: ManifestShape): string[];

export declare function writeFixtures(options: {
  root: string;
  packageName: string;
  subpaths: readonly string[];
  usage?: boolean;
}): void;

export declare function writeTsconfig(options: { root: string; mode: ConsumerMode }): string;

export declare function resolveTscPath(typescriptDir: string): { tscPath: string; version: string };

export declare function compileMode(options: {
  mode: ConsumerMode;
  root: string;
  config: string;
  tscPath: string;
  packageName: string;
  installed: string;
}): void;
