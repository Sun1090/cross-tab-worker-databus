import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const current = JSON.parse(readFileSync('package.json', 'utf8'));
const baseTag = process.env.COMPAT_BASE_TAG ?? 'v0.20.31';
let baseline;
try {
  baseline = JSON.parse(execFileSync('git', ['show', `${baseTag}:package.json`], { encoding: 'utf8' }));
} catch (error) {
  throw new Error(`unable to read compatibility baseline ${baseTag}: ${error instanceof Error ? error.message : String(error)}`);
}

const currentExports = current.exports ?? {};
const baselineExports = baseline.exports ?? {};
for (const key of Object.keys(baselineExports)) {
  if (!(key in currentExports)) throw new Error(`removed public export ${key} since ${baseTag}`);
  const baselineEntry = baselineExports[key];
  const currentEntry = currentExports[key];
  if (typeof baselineEntry === 'object' && typeof currentEntry === 'object') {
    for (const field of ['types', 'import', 'require']) {
      if (field in baselineEntry && !(field in currentEntry)) {
        throw new Error(`removed ${field} condition from export ${key} since ${baseTag}`);
      }
    }
  }
}

for (const field of ['types', 'typesVersions']) {
  if (field in baseline && !(field in current)) throw new Error(`removed package field ${field} since ${baseTag}`);
}
console.log(`[compat] ${current.version} preserves public exports and type metadata from ${baseTag}`);
