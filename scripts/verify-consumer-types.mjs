/**
 * Consumer-side type check of the packed tarball on a chosen TypeScript version.
 *
 * `verify:pack` imports every public subpath at *runtime*, and `verify:types`
 * checks the declarations with the compiler this repository builds against.
 * Neither answers the question a consumer actually has: **can my compiler build
 * against these declarations?** Those are different checks over different
 * artifacts, and the gap is not hypothetical — this repository is on 6.0.3 while
 * 7 is `latest` on npm.
 *
 * What it does: pack the tarball, install it into a scratch package together with
 * the optional `centrifuge` peer and the requested compiler, then have that
 * compiler typecheck a consumer that resolves every public name.
 *
 * The consumer re-exports each public subpath rather than naming the exports.
 * Naming them would need this script to classify values from types and to know
 * every generic's arity — two things that rot the moment the API grows, and which
 * would show up as a *fixture* failure that reads like a compatibility failure.
 * `export *` requires every name to resolve and stays correct by construction.
 * The subpaths get one file each because root and `./centrifuge` legitimately
 * export the same names (`WorkerBackend`, `WorkerMode`), and a collision in a
 * single file would be this script's bug, not the package's.
 *
 * Usage: node scripts/verify-consumer-types.mjs [typescript-version]
 *        (defaults to the version of the compiler whose API the other gates drive)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'));

/**
 * The version installed into the consumer when the caller names none.
 *
 * Deliberately the version the *loaded API* reports, not the one in
 * `node_modules/typescript/package.json`. Those stopped being the same answer
 * when this repository started building with TypeScript 7 while keeping the 6.x
 * API for its gates (`typescript` is an npm alias to `@typescript/typescript6`;
 * docs/progress.md Phase 334): that manifest reads `6.0.2` — the shim's own
 * version — while the API it re-exports is `6.0.3`, and the compiler that emits
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

/** Subpaths whose declarations are checked. The worker entries export nothing. */
const SUBPATHS = ['.', './centrifuge'];

/**
 * A few real calls, so the check is not only "the names resolve": each result is
 * annotated with the type the declaration promises, which fails if a signature
 * changed shape rather than merely moved.
 */
const USAGE = `import {
  approximatePayloadBytes,
  createOpaqueKey,
  isWildcardTopic,
  selectWorkerBackend,
  topicMatchesPattern,
  DEFAULT_MAX_ACTIVE_WORKERS,
  type WorkerAvailability,
  type WorkerBackend,
  type WorkerMode
} from 'cross-tab-worker-databus';

declare const mode: WorkerMode;
declare const availability: WorkerAvailability;

export const key: string = createOpaqueKey('topic-a');
export const wildcard: boolean = isWildcardTopic('chat.*');
export const matched: boolean = topicMatchesPattern('chat.*', 'chat.a');
export const bytes: number = approximatePayloadBytes({ a: 1 });
export const backend: WorkerBackend = selectWorkerBackend(mode, availability);
export const maxActive: number = DEFAULT_MAX_ACTIVE_WORKERS;
`;

const root = mkdtempSync(join(tmpdir(), 'cross-tab-consumer-types-'));

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...options });
}

try {
  const tarball = run('npm', ['pack', '--pack-destination', root, '--silent', workspace]).trim().split('\n').pop();

  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'consumer-types', private: true, type: 'module' }, null, 2)}\n`
  );

  // `centrifuge` is an optional peer of `./centrifuge`; without it the subpath's
  // declarations cannot resolve, and the failure would name the peer rather than
  // this package. Installing it is what a consumer of that subpath does.
  run('npm', ['install', `./${tarball}`, 'centrifuge', `typescript@${requested}`, '--silent']);

  for (const subpath of SUBPATHS) {
    const name = subpath === '.' ? 'root' : subpath.slice(2).replaceAll(/[^A-Za-z0-9]+/g, '-');
    const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    writeFileSync(join(root, `${name}.ts`), `export * from '${specifier}';\n`);
  }
  writeFileSync(join(root, 'usage.ts'), USAGE);

  writeFileSync(
    join(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2020',
          module: 'esnext',
          moduleResolution: 'bundler',
          noEmit: true,
          skipLibCheck: false
        },
        include: ['*.ts']
      },
      null,
      2
    )}\n`
  );

  const installed = JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8')).version;
  try {
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')]);
  } catch (error) {
    // `tsc` reports paths relative to its own cwd, which here is a temp root
    // several `../` deep. Strip that prefix so the diagnostics read as the
    // consumer's file names rather than as a path nobody can follow.
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
      .trim()
      .split('\n')
      .map(line => line.replace(/^(?:\.\.[\\/])*.*?cross-tab-consumer-types-[^\\/]+[\\/]/, ''))
      .join('\n');
    throw new Error(
      `[consumer-types] typescript ${installed} could not build a consumer against ` +
        `${manifest.name}@${manifest.version}. This is a consumer-facing defect: the declarations ` +
        `were emitted by a compiler that this version refuses to accept, or a public name does not ` +
        `resolve. Diagnostics:\n${output}`,
      { cause: error }
    );
  }

  console.log(
    `[consumer-types] ${manifest.name}@${manifest.version}: ${SUBPATHS.length} subpaths and their ` +
      `signatures typecheck under typescript ${installed}`
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
