/**
 * Sensitivity check for the public type-surface gate.
 *
 * `verify:types` has two backends — TypeScript's in-process object API and 7's
 * snapshot/handle API (`scripts/type-surface.mjs`). Both print the *same*
 * success line on a clean tree, which means a green run is not evidence that the
 * backend it used still catches anything: the handle adapter's first alias
 * resolution returned the alias itself instead of its target, so a leaked type
 * was caught on 6.0.3 and silently passed on 7.0.2 while both trees reported
 * `surface closed` (docs/progress.md Phase 330).
 *
 * So sensitivity is asserted rather than assumed. This script mutates the tree in
 * the two ways the gate exists to catch, requires a failure each time with the
 * expected text, and restores the files. It runs under whichever compiler is
 * installed, so the same claims are held against both backends in CI.
 *
 * Everything it touches is either generated (`dist/`, rebuilt by `pnpm build`) or
 * restored from a backup taken before the first mutation. The restore is asserted
 * too — a mutation harness that leaves the tree dirty turns a green run after it
 * into an unreadable result.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { detectCompiler } from './type-surface.mjs';

const workspace = resolve(import.meta.dirname, '..');
const GATE = 'scripts/verify-public-types.mjs';
const LEAK_NAME = 'LeakProbeInternal';
const LEAK_ENTRY = 'LeakOuter';

/** Files this script edits. Kept explicit so a restore cannot miss one. */
const TOUCHED = ['dist/index.d.ts', 'dist/core/types.d.ts', 'src/index.ts'];

const backups = mkdtempSync(join(tmpdir(), 'cross-tab-sensitivity-'));
const compilerVersion = `typescript ${detectCompiler().version}`;

function backup(relativePath) {
  copyFileSync(join(workspace, relativePath), join(backups, relativePath.replaceAll('/', '__')));
}

function restore() {
  for (const relativePath of TOUCHED) {
    copyFileSync(join(backups, relativePath.replaceAll('/', '__')), join(workspace, relativePath));
  }
}

function runGate() {
  try {
    const stdout = execFileSync('node', [GATE], { cwd: workspace, encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : ''
    };
  }
}

function fail(message) {
  console.error(`[sensitivity] ${message}`);
  restore();
  rmSync(backups, { recursive: true, force: true });
  process.exit(1);
}

function expectFailure(label, result, needles) {
  if (result.status === 0) {
    fail(
      `${label}: the gate exited 0 on a mutated tree. This backend does not catch that mutation, ` +
        `which is why a clean-tree success line proves nothing on its own. ` +
        `Gate output: ${(result.stdout + result.stderr).trim() || '(none)'}`
    );
  }
  const output = `${result.stdout}\n${result.stderr}`;
  for (const needle of needles) {
    if (!output.includes(needle)) {
      fail(`${label}: the gate failed but did not report '${needle}'. Output:\n${output.trim()}`);
    }
  }
}

for (const relativePath of TOUCHED) backup(relativePath);

try {
  // A broken environment must not read as sensitivity: if the gate cannot even
  // pass on the tree as it stands, every mutation below "fails" for free.
  const clean = runGate();
  if (clean.status !== 0) {
    fail(
      'the gate did not pass before any mutation, so nothing below would be evidence. ' +
        `Run \`pnpm build\` first. Output:\n${(clean.stdout + clean.stderr).trim()}`
    );
  }

  // --- mutation 1: a repository type reachable from a public signature -------
  // Exported by its own internal module, never by a public entry, and named by a
  // public signature: the shape the closure check exists to report.
  const internalTypes = join(workspace, 'dist/core/types.d.ts');
  writeFileSync(internalTypes, `${readFileSync(internalTypes, 'utf8')}\nexport interface ${LEAK_NAME} { a: 1 }\n`);

  const entryDeclaration = join(workspace, 'dist/index.d.ts');
  const entryText = readFileSync(entryDeclaration, 'utf8');
  writeFileSync(
    entryDeclaration,
    `import type { ${LEAK_NAME} } from './core/types';\n${entryText}\n` +
      `export interface ${LEAK_ENTRY} { probe: ${LEAK_NAME} }\n`
  );

  const leak = runGate();
  expectFailure('leak mutation', leak, [LEAK_NAME, 'reached from']);
  restore();

  // --- mutation 2: a name the previous release exported ---------------------
  // Taken from the file's own re-export statements rather than hard-coded, so it
  // keeps pointing at a real name instead of decaying into a no-op. The name must
  // occur exactly once in the whole barrel: `CrossTabDataBus` is a prefix of
  // `CrossTabDataBusOptions`, so a substring test would accept a removal that
  // removes nothing, and the first name in the first statement is not safe.
  const barrel = join(workspace, 'src/index.ts');
  const barrelText = readFileSync(barrel, 'utf8');
  let target = null;
  for (const match of barrelText.matchAll(/^export (?:type )?\{ ([A-Za-z0-9_, ]+) \} from '[^']+';$/gm)) {
    const names = match[1].split(',').map(name => name.trim()).filter(Boolean);
    const name = names.find(candidate => new RegExp(`\\b${candidate}\\b`, 'g').test(barrelText) &&
      (barrelText.match(new RegExp(`\\b${candidate}\\b`, 'g')) ?? []).length === 1);
    if (name) {
      target = { statement: match[0], names, name };
      break;
    }
  }
  if (!target) {
    fail('no singly-declared name found in src/index.ts to build the removal mutation from');
  }
  const remaining = target.names.filter(name => name !== target.name);
  const open = target.statement.indexOf('{');
  const close = target.statement.indexOf('}');
  const replacement = remaining.length === 0
    ? ''
    : `${target.statement.slice(0, open)}{ ${remaining.join(', ')} }${target.statement.slice(close)}`;
  const mutatedBarrel = barrelText.replace(target.statement, replacement);
  if (new RegExp(`\\b${target.name}\\b`).test(mutatedBarrel)) {
    fail(
      `'${target.name}' still appears in src/index.ts after removing it from \`${target.statement}\`, ` +
        'so the removal mutation would not remove anything'
    );
  }
  writeFileSync(barrel, mutatedBarrel);

  const removal = runGate();
  expectFailure('removal mutation', removal, [target.name, 'no longer exported']);
  restore();

  // --- the tree is clean again ---------------------------------------------
  const restored = runGate();
  if (restored.status !== 0) {
    fail(
      'the tree did not return to a passing state after the mutations were reverted, so the ' +
        `next gate run cannot be trusted. Output:\n${(restored.stdout + restored.stderr).trim()}`
    );
  }

  console.log(
    `[sensitivity] leak and removal mutations both caught, tree clean again (${compilerVersion})`
  );
} finally {
  restore();
  rmSync(backups, { recursive: true, force: true });
}
