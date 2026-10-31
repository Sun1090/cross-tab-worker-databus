import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const current = JSON.parse(readFileSync('package.json', 'utf8'));

// The export contract is checked against the most recent release tag, so a
// removal is caught the moment a later version ships rather than only against
// the hard-coded baseline. COMPAT_BASE_TAG still overrides (e.g. for an
// emergency check against a specific release). When HEAD is already tagged at
// the current version, skip that tag and compare against the previous release.
let baseTag = process.env.COMPAT_BASE_TAG;
if (!baseTag) {
  const tags = execFileSync('git', ['tag', '--sort=-v:refname', '--list', 'v*'], { encoding: 'utf8' })
    .split('\n')
    .map(tag => tag.trim())
    .filter(Boolean);
  if (tags.length === 0) {
    throw new Error('[compat] no version tag found to use as compatibility baseline; set COMPAT_BASE_TAG');
  }
  const headTag = execFileSync('git', ['tag', '--points-at', 'HEAD'], { encoding: 'utf8' })
    .split('\n')
    .map(tag => tag.trim())
    .filter(Boolean);
  baseTag = tags.find(tag => !headTag.includes(tag)) ?? tags[0];
}
let baseline;
try {
  baseline = JSON.parse(execFileSync('git', ['show', `${baseTag}:package.json`], { encoding: 'utf8' }));
} catch (error) {
  throw new Error(
    `[compat] unable to read compatibility baseline ${baseTag}: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error }
  );
}


function hasUnconditionalExportTarget(entry) {
  if (typeof entry === 'string') return entry.length > 0;
  if (Array.isArray(entry)) return entry.some(hasUnconditionalExportTarget);
  return entry != null && typeof entry === 'object' && entry.default != null &&
    hasUnconditionalExportTarget(entry.default);
}

/**
 * Whether a `types` condition that used to cover a whole entry has been *widened*
 * into the branches it covered, rather than dropped.
 *
 * Phase 337 split each dual-format entry into `import`/`require` branches so a
 * `node16` CommonJS consumer resolves a CommonJS-format declaration instead of an
 * ESM one it cannot `require`. That necessarily removes the top-level `types`
 * key, which the removal check below would otherwise read as "the types condition
 * is gone" — a false alarm, and one worth answering precisely rather than by
 * exempting the field: the requirement is that *every* conditional branch now
 * carries its own declaration, so no configuration resolves fewer types than it
 * did before. A branch that lost its `types` still fails, which is the case this
 * allowance exists not to excuse.
 */
function typesWidenedIntoBranches(entry) {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const branches = Object.values(entry).filter(
    value => value != null && typeof value === 'object' && !Array.isArray(value)
  );
  return branches.length > 0 && branches.every(branch => typeof branch.types === 'string');
}

function assertExportCompatibility(baselineEntry, currentEntry, exportKey, conditionPath = []) {
  if ((typeof baselineEntry === 'string' || Array.isArray(baselineEntry)) &&
      hasUnconditionalExportTarget(baselineEntry) && !hasUnconditionalExportTarget(currentEntry)) {
    throw new Error(`[compat] removed default availability from export ${exportKey} since ${baseTag}`);
  }
  if (baselineEntry == null || typeof baselineEntry !== 'object' || Array.isArray(baselineEntry)) return;

  for (const field of Object.keys(baselineEntry)) {
    if (baselineEntry[field] == null) continue;
    if (currentEntry == null || typeof currentEntry !== 'object' ||
        Array.isArray(currentEntry) || currentEntry[field] == null) {
      if (field === 'types' && conditionPath.length === 0 && typesWidenedIntoBranches(currentEntry)) continue;
      const condition = [...conditionPath, field].join('.');
      throw new Error(`[compat] removed ${condition} condition from export ${exportKey} since ${baseTag}`);
    }
    assertExportCompatibility(
      baselineEntry[field], currentEntry[field], exportKey, [...conditionPath, field]
    );
  }
}

const currentExports = current.exports ?? {};
const baselineExports = baseline.exports ?? {};
for (const key of Object.keys(baselineExports)) {
  if (!(key in currentExports)) throw new Error(`[compat] removed public export ${key} since ${baseTag}`);
  const baselineEntry = baselineExports[key];
  const currentEntry = currentExports[key];
  if (baselineEntry != null && currentEntry == null) {
    throw new Error(`[compat] disabled public export ${key} since ${baseTag}`);
  }
  assertExportCompatibility(baselineEntry, currentEntry, key);
}

for (const field of ['types', 'typesVersions']) {
  if (field in baseline && (!(field in current) || (baseline[field] != null && current[field] == null))) {
    throw new Error(`[compat] removed package field ${field} since ${baseTag}`);
  }
  // Keep the metadata container compatible as well as present. A non-null
  // object (notably `typesVersions`) cannot be replaced by a scalar without
  // making the previous TypeScript resolution contract unusable.
  if (field in baseline && baseline[field] != null && current[field] != null) {
    const shape = value => Array.isArray(value) ? 'array' : typeof value;
    if (shape(baseline[field]) !== shape(current[field])) {
      throw new Error(`[compat] changed package field ${field} shape since ${baseTag}`);
    }
  }
}
console.log(`[compat] ${current.version} preserves public exports and type metadata from ${baseTag}`);
