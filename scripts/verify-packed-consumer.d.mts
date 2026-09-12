/** Minimal shape of a packed `package.json` (only the fields verified here). */
export interface PackedManifestLike {
  version?: string;
  exports?: Record<string, string | Record<string, string>>;
}

/** One promised file path: the export subpath it belongs to, and its target. */
export interface ExportTarget {
  subpath: string;
  target: string;
}

/**
 * Every file path the packed export map promises, derived from the manifest so
 * a newly added entry point is covered automatically.
 *
 * Throws when the manifest declares no exports, or an export declares no target.
 */
export declare function collectExportTargets(manifest: PackedManifestLike): ExportTarget[];

/**
 * Assert the packed manifest promises a complete, resolvable export surface:
 * every declared target must exist (per `exists`), and the four dual-format JS
 * entry points must keep both an `import` and a `require` condition.
 */
export declare function assertPackedExports(
  packedManifest: PackedManifestLike,
  exists: (target: string) => boolean
): void;
