/**
 * The consumer-side type check, shared by the two gates that need one.
 *
 * Two scripts ask the same question of two different artifacts:
 *
 * - `verify-consumer-types.mjs` packs *this* workspace and asks whether a
 *   consumer's compiler can build against the resulting tarball.
 * - `verify-published-consumer.mjs` downloads the release from npm and asks the
 *   same of the artifact consumers actually get.
 *
 * The second one used to run the runtime import only, and `0.21.60` shipped with
 * declarations no `node16`/`nodenext` consumer could load while that blocking
 * release gate went green — because importing a module at runtime never reads a
 * `.d.ts`. The answer to that is not a second copy of the check: two copies drift
 * apart, which is the failure this repository keeps re-learning. So the modes,
 * the fixtures and the compile assertion live here and both callers import them.
 *
 * The check has two halves, and the second is the one that matters here:
 *
 * 1. Every public name resolves and its signatures still typecheck.
 * 2. Each mode reads the declaration tree it is *supposed* to read — asserted
 *    from the compiler's own `--listFiles`, because compiling cannot tell the
 *    intended tree from the wrong one. A manifest that advertises one tree for
 *    both module formats compiles everywhere except `node16` CJS, so "it built"
 *    is not the claim; "it built against `dist/cjs/index.d.cts`" is.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
} from 'PACKAGE_NAME';

declare const mode: WorkerMode;
declare const availability: WorkerAvailability;

export const key: string = createOpaqueKey('topic-a');
export const wildcard: boolean = isWildcardTopic('chat.*');
export const matched: boolean = topicMatchesPattern('chat.*', 'chat.a');
export const bytes: number = approximatePayloadBytes({ a: 1 });
export const backend: WorkerBackend = selectWorkerBackend(mode, availability);
export const maxActive: number = DEFAULT_MAX_ACTIVE_WORKERS;
`;

/**
 * The resolution modes a consumer can legitimately be in, one `tsc -p` each.
 *
 * `bundler` is the permissive one: it resolves extensionless relative imports.
 * `node16` and `nodenext` are not synonyms and both are run — `node16` pins
 * resolution to the Node version the compiler knows about (no import attributes,
 * no `require(esm)` interop) while `nodenext` tracks the newest, and they
 * disagree precisely about the shapes this package ships.
 *
 * `expects` is the declaration tree the mode must read, checked from
 * `--listFiles`.
 *
 * `skipLibCheck: false` everywhere, on purpose: the point is to check *this*
 * package's declarations, and every mode is expected to pass in the strictest
 * configuration. The CommonJS modes have their own fixture directory because the
 * module format of a `.ts` file under `node16`/`nodenext` is decided by the
 * nearest `package.json` `type`, so each needs a `commonjs` one of its own.
 */
export const MODES = [
  {
    id: 'bundler',
    label: 'bundler',
    dir: '.',
    type: 'module',
    compilerOptions: { module: 'esnext', moduleResolution: 'bundler' },
    expects: 'dist/index.d.ts'
  },
  ...['node16', 'nodenext'].flatMap(resolution => [
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

/**
 * Every dual-format subpath, taken from the `exports` map rather than listed.
 *
 * A `require` condition is what makes an entry dual-format, and it is also what
 * carries a second declaration tree — so deriving the list is what keeps the
 * check honest when a subpath is added. When it *was* written out it named two of
 * the four entries that ship nested `types`, so `./hooks` and `./vue` went
 * through every mode without once being compiled (`docs/progress.md` Phase 339).
 *
 * The worker entries drop out by the same rule: they declare `types` and
 * `default` with no `require`, so there is no second tree for them.
 */
export function dualFormatSubpaths(manifest) {
  const subpaths = Object.entries(manifest.exports ?? {})
    .filter(([subpath, entry]) => subpath !== './package.json' && entry?.require !== undefined)
    .map(([subpath]) => subpath);
  if (subpaths.length === 0) {
    throw new Error('[consumer-types] the exports map declares no dual-format subpath to check');
  }
  return subpaths;
}

/**
 * One file per subpath, never two in one: the root and `./centrifuge` legitimately
 * export the same names (`WorkerBackend`, `WorkerMode`), as do `./hooks` and
 * `./vue`, and a collision inside a single file would be this check's bug rather
 * than the package's.
 */
export function writeFixtures({ root, packageName, subpaths, usage = true }) {
  for (const mode of MODES) {
    const dir = mode.dir === '.' ? root : join(root, mode.dir);
    if (mode.dir !== '.') {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ type: mode.type }, null, 2)}\n`);
    }
    for (const subpath of subpaths) {
      const name = subpath === '.' ? 'root' : subpath.slice(2).replaceAll(/[^A-Za-z0-9]+/g, '-');
      const specifier = subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
      writeFileSync(join(dir, `${name}.ts`), `export * from '${specifier}';\n`);
    }
    if (usage) writeFileSync(join(dir, 'usage.ts'), USAGE.replaceAll('PACKAGE_NAME', packageName));
  }
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'consumer-types', private: true, type: 'module' }, null, 2)}\n`);
}

/**
 * The compiler executable inside an installed `typescript` directory.
 *
 * Read from the package's own `bin` map rather than assumed: this repository's
 * `typescript` is an npm alias to a 6.0 compatibility package, whose binary is
 * named `tsc6`, while the same directory installed from npm proper carries `tsc`.
 * Either way it is whatever the manifest says it is.
 */
export function resolveTscPath(typescriptDir) {
  const { bin, version } = JSON.parse(readFileSync(join(typescriptDir, 'package.json'), 'utf8'));
  const relative = typeof bin === 'string' ? bin : Object.values(bin ?? {})[0];
  if (typeof relative !== 'string') {
    throw new Error(`[consumer-types] the installed typescript ${version} declares no binary in its manifest`);
  }
  return { tscPath: join(typescriptDir, relative), version };
}

/** The `tsconfig.<id>.json` for one mode, written at the consumer root. */
export function writeTsconfig({ root, mode }) {
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
  return config;
}

/**
 * Compile one mode and assert it read the tree it was meant to.
 *
 * `tsc` reports paths relative to its own cwd, so diagnostics are stripped of the
 * temp-root prefix before they are thrown: the reader needs the consumer's file
 * names, not a path nobody can follow.
 */
export function compileMode({ mode, root, config, tscPath, packageName, installed }) {
  const run = args =>
    execFileSync(process.execPath, [tscPath, '-p', config, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe'
    });

  let listed;
  try {
    listed = run(['--listFiles']);
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
      .trim()
      .split('\n')
      .map(line => line.replace(/^(?:\.\.[\\/])*.*?cross-tab-(?:consumer-types|databus-published)-[^\\/]+[\\/]/, ''))
      .join('\n');
    throw new Error(
      `[consumer-types] typescript ${installed} could not build a consumer against ` +
        `${packageName} under ${mode.label}. This is a consumer-facing defect: the declarations were ` +
        `emitted by a compiler that this version refuses to accept, a public name does not resolve, or ` +
        `the subpath's types do not match this resolution mode. Diagnostics:\n${output}`,
      { cause: error }
    );
  }

  // Only the declaration this mode was supposed to reach is asserted, and only as
  // a suffix, so the temp path never enters a message.
  const read = listed.split('\n').map(line => line.trim().replaceAll('\\', '/'));
  if (!read.some(file => file.endsWith(`/${mode.expects}`))) {
    throw new Error(
      `[consumer-types] typescript ${installed} built the ${mode.label} consumer without reading ` +
        `${mode.expects}. The consumer compiled, but against a different declaration tree than this ` +
        `mode is meant to resolve, so the exports map and the module format disagree for ${packageName}. ` +
        `Declarations read: ${read.filter(file => file.includes('/dist/')).join(', ') || '(none from dist)'}`
    );
  }
  if (mode.expects === 'dist/cjs/index.d.cts' && read.some(file => file.endsWith('/dist/index.d.ts'))) {
    throw new Error(
      `[consumer-types] the ${mode.label} consumer read both declaration trees: it resolved the ` +
        'CommonJS one and still pulled in dist/index.d.ts. A CommonJS declaration graph must not cross ' +
        'into the ESM tree — that boundary is TS1479 under node16.'
    );
  }
}
