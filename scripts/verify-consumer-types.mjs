/**
 * Consumer-side type check of the packed tarball on a chosen TypeScript version.
 *
 * `verify:pack` imports every public subpath at *runtime*, and `verify:types`
 * checks the declarations with the compiler this repository builds against.
 * Neither answers the question a consumer actually has: **can my compiler build
 * against these declarations?** Those are different checks over different
 * artifacts, and the gap is not hypothetical — this repository is on 6.0.x while
 * 7 is `latest` on npm.
 *
 * What it does: pack the tarball, install it into a scratch package together with
 * the peers a consumer of these subpaths installs and the requested compiler,
 * then have that compiler typecheck a consumer that resolves every public name —
 * in each resolution mode, and against the declaration tree that mode is supposed
 * to read. The modes, fixtures and assertions live in `consumer-types.mjs`,
 * shared with the published-artifact gate so the two cannot disagree about what
 * passing means.
 *
 * `export *` per subpath rather than naming the exports: naming them would need
 * this script to classify values from types and to know every generic's arity —
 * two things that rot the moment the API grows, and which would show up as a
 * *fixture* failure that reads like a compatibility failure.
 *
 * Usage: node scripts/verify-consumer-types.mjs [typescript-version]
 *        (defaults to the version of the compiler whose API the other gates drive)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MODES, compileMode, dualFormatSubpaths, writeFixtures, writeTsconfig } from './consumer-types.mjs';

const workspace = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'));

/**
 * The version installed into the consumer when the caller names none.
 *
 * Deliberately the version the *loaded API* reports, not the one in
 * `node_modules/typescript/package.json`. Those stopped being the same answer
 * when this repository started building with TypeScript 7 while keeping the 6.x
 * API for its gates (`typescript` is an npm alias to a 6.0 compatibility package;
 * docs/progress.md Phase 334): that manifest reads the shim's own version while
 * the API it re-exports is a patch newer, and the compiler that emits
 * `dist/*.d.ts` is 7.x. Defaulting to the shim's version would quietly check a
 * third compiler that nothing in this repository runs.
 *
 * Read through `default` as well as the namespace: `typescript` is CommonJS, and
 * named-export detection is a lexer heuristic this should not depend on.
 */
const loaded = await import('typescript');
const defaultCompilerVersion = loaded.version ?? loaded.default?.version;

if (defaultCompilerVersion === undefined) {
  throw new Error('[consumer-types] cannot read the loaded compiler version; pass one explicitly');
}

const requested = process.argv[2] ?? defaultCompilerVersion;

const subpaths = dualFormatSubpaths(manifest);

/**
 * Peers a consumer of those subpaths installs.
 *
 * `centrifuge` is an optional peer of `./centrifuge`, and `react` / `vue` of the
 * two adapter entries; without them those subpaths' declarations cannot resolve
 * and the failure would name the peer rather than this package. `@types/react` is
 * separate because React publishes no types of its own.
 */
const PEERS = ['centrifuge', 'react', '@types/react', 'vue'];

/** `label (version)` per mode that passed, for the one-line summary. */
const checked = [];

const root = mkdtempSync(join(tmpdir(), 'cross-tab-consumer-types-'));

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...options });
}

try {
  const tarball = run('npm', ['pack', '--pack-destination', root, '--silent', workspace]).trim().split('\n').pop();

  writeFixtures({ root, packageName: manifest.name, subpaths });

  run('npm', ['install', `./${tarball}`, ...PEERS, `typescript@${requested}`, '--silent']);

  const installed = JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8')).version;
  for (const mode of MODES) {
    const config = writeTsconfig({ root, mode });
    compileMode({
      mode,
      root,
      config,
      tscPath: join(root, 'node_modules/typescript/bin/tsc'),
      packageName: manifest.name,
      installed
    });
    checked.push(`${mode.label} (${installed})`);
  }

  console.log(
    `[consumer-types] ${manifest.name}@${manifest.version}: ${subpaths.length} subpaths and their ` +
      `signatures typecheck under ${checked.join(', ')}`
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
