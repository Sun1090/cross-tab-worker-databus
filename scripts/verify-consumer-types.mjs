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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
 * The resolution modes a consumer can legitimately be in, one `tsc -p` each.
 *
 * `bundler` was the only mode until Phase 336, and it is the permissive one: it
 * resolves extensionless relative imports, which is what `tsc` emits here. A
 * consumer on `node16`/`nodenext` does not, and the difference is not academic —
 * measured on the tarball built from `0.21.60`'s source, an ESM consumer with
 * `moduleResolution: nodenext` and `skipLibCheck: false` reported **16 × TS2834**
 * from `dist/index.d.ts` alone ("relative import paths need explicit file
 * extensions"). The fix was to emit extensioned specifiers (`./core/data-bus.js`)
 * by writing them that way in `src`, and this mode is the gate that keeps them.
 *
 * `skipLibCheck: false` everywhere, on purpose: the point is to check *this*
 * package's declarations, and every mode is expected to pass in that strictest
 * configuration. The CJS modes have their own fixture directory because the
 * module format of a `.ts` file under `node16`/`nodenext` is decided by the
 * nearest `package.json` `type`, so each needs a `commonjs` one of its own.
 *
 * `node16` is not a synonym for `nodenext`, which is why both are run: `node16`
 * pins resolution to the Node version the compiler knows about (no `import`
 * attributes, no `require(esm)` interop), while `nodenext` tracks the newest.
 * They disagreed often enough during the 6.0 major line that a `tsconfig.json`
 * naming one cannot be assumed to behave like the other, and a consumer's file
 * says whichever it says.
 */
const RESOLUTION_MODES = ['node16', 'nodenext'];

/**
 * `expects` is the declaration tree this mode must actually resolve, checked from
 * the compiler's own `--listFiles`. Compiling is the weaker claim: a manifest that
 * advertised one tree for both formats compiles in every mode except `node16`
 * CJS, so "it built" cannot distinguish the fix from the defect. Naming the file
 * each consumer is supposed to read is what this gate is about.
 */
const MODES = [
  {
    id: 'bundler',
    label: 'bundler',
    dir: '.',
    type: 'module',
    compilerOptions: { module: 'esnext', moduleResolution: 'bundler' },
    expects: 'dist/index.d.ts'
  },
  ...RESOLUTION_MODES.flatMap(resolution => [
    {
      id: `${resolution}-esm`,
      label: `${resolution} (ESM)`,
      dir: '.',
      type: 'module',
      compilerOptions: { module: resolution, moduleResolution: resolution },
      expects: 'dist/index.d.ts'
    },
    {
      id: `${resolution}-cjs`,
      label: `${resolution} (CJS)`,
      dir: 'cjs',
      type: 'commonjs',
      compilerOptions: { module: resolution, moduleResolution: resolution },
      expects: 'dist/cjs/index.d.cts'
    }
  ])
];

/** `label (version)` per mode that passed, for the one-line summary. */
const checked = [];

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

  const installed = JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8')).version;
  for (const mode of MODES) {
    const dir = mode.dir === '.' ? root : join(root, mode.dir);
    if (mode.dir !== '.') {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ type: mode.type }, null, 2)}\n`);
    }
    for (const subpath of SUBPATHS) {
      const name = subpath === '.' ? 'root' : subpath.slice(2).replaceAll(/[^A-Za-z0-9]+/g, '-');
      const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
      writeFileSync(join(dir, `${name}.ts`), `export * from '${specifier}';\n`);
    }
    writeFileSync(join(dir, 'usage.ts'), USAGE);

    const config = join(root, `tsconfig.${mode.id}.json`);
    writeFileSync(
      config,
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            target: 'ES2020',
            ...mode.compilerOptions,
            noEmit: true,
            skipLibCheck: false
          },
          include: mode.dir === '.' ? ['*.ts'] : [`${mode.dir}/*.ts`]
        },
        null,
        2
      )}\n`
    );

    let listed;
    try {
      listed = run(process.execPath, [
        join(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        config,
        '--listFiles'
      ]);
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
          `${manifest.name}@${manifest.version} under ${mode.label}. This is a consumer-facing ` +
          `defect: the declarations were emitted by a compiler that this version refuses to accept, ` +
          `a public name does not resolve, or the subpath's types do not match this resolution mode. ` +
          `Diagnostics:\n${output}`,
        { cause: error }
      );
    }
    // `--listFiles` reports every file the program read, absolute and with the
    // platform's separators. Only the declaration this mode was supposed to reach
    // is asserted, and only as a suffix, so the temp path never enters a message.
    const read = listed.split('\n').map(line => line.trim().replaceAll('\\', '/'));
    const wanted = manifest.name;
    if (!read.some(file => file.endsWith(`/${mode.expects}`))) {
      throw new Error(
        `[consumer-types] typescript ${installed} built the ${mode.label} consumer without reading ` +
          `${mode.expects}. The consumer compiled, but against a different declaration tree than this ` +
          `mode is meant to resolve, so the exports map and the module format disagree for ${wanted}. ` +
          `Declarations read: ${read.filter(f => f.includes('/dist/')).join(', ') || '(none from dist)'}`
      );
    }
    if (mode.expects === 'dist/cjs/index.d.cts' &&
        read.some(file => file.endsWith('/dist/index.d.ts'))) {
      throw new Error(
        `[consumer-types] the ${mode.label} consumer read both declaration trees: it resolved the ` +
          `CommonJS one and still pulled in dist/index.d.ts. A CommonJS declaration graph must not ` +
          `cross into the ESM tree — that boundary is TS1479 under node16.`
      );
    }
    checked.push(`${mode.label} (${installed})`);
  }

  console.log(
    `[consumer-types] ${manifest.name}@${manifest.version}: ${SUBPATHS.length} subpaths and their ` +
      `signatures typecheck under ${checked.join(', ')}`
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
