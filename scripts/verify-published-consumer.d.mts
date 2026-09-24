/**
 * Which published version to verify. An explicit `PUBLISHED_VERSION` wins
 * verbatim; otherwise the version is read from the registry and only trusted when
 * it agrees with `treeVersion`, because npm can serve that read from its local
 * packument cache. Throws otherwise — see the definition for the measurement.
 */
export declare function resolveTargetVersion(
  envVersion: string | undefined,
  readRegistryVersion: () => string,
  treeVersion: string
): string;
