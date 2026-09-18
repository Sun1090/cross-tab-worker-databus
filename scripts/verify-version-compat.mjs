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
    throw new Error('no version tag found to use as compatibility baseline; set COMPAT_BASE_TAG');
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
    `unable to read compatibility baseline ${baseTag}: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error }
  );
}

const currentExports = current.exports ?? {};
const baselineExports = baseline.exports ?? {};
for (const key of Object.keys(baselineExports)) {
  if (!(key in currentExports)) throw new Error(`removed public export ${key} since ${baseTag}`);
  const baselineEntry = baselineExports[key];
  const currentEntry = currentExports[key];
  if (baselineEntry != null && currentEntry == null) {
    throw new Error(`disabled public export ${key} since ${baseTag}`);
  }
  if (baselineEntry != null && typeof baselineEntry === 'object' && !Array.isArray(baselineEntry)) {
    for (const field of ['types', 'import', 'require', 'default']) {
      if (baselineEntry[field] != null && (
        currentEntry == null || typeof currentEntry !== 'object' ||
        Array.isArray(currentEntry) || currentEntry[field] == null
      )) {
        throw new Error(`removed ${field} condition from export ${key} since ${baseTag}`);
      }
    }
  }
}

for (const field of ['types', 'typesVersions']) {
  if (field in baseline && (!(field in current) || (baseline[field] != null && current[field] == null))) {
    throw new Error(`removed package field ${field} since ${baseTag}`);
  }
  // Keep the metadata container compatible as well as present. A non-null
  // object (notably `typesVersions`) cannot be replaced by a scalar without
  // making the previous TypeScript resolution contract unusable.
  if (field in baseline && baseline[field] != null && current[field] != null) {
    const baselineIsObject = typeof baseline[field] === 'object' && !Array.isArray(baseline[field]);
    const currentIsObject = typeof current[field] === 'object' && !Array.isArray(current[field]);
    if (baselineIsObject !== currentIsObject) {
      throw new Error(`changed package field ${field} shape since ${baseTag}`);
    }
  }
}
console.log(`[compat] ${current.version} preserves public exports and type metadata from ${baseTag}`);
