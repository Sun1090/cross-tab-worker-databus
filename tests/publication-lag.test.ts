import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/publication-lag.mjs` is the tool both release checklists now name as the way to
 * re-derive the ack→record gap that sizes the workflow's 720 s consumer budget. Its whole
 * job is *choosing which run attempt to read*, and that choice is invisible to an end-state
 * assertion: reading the latest attempt instead of the first that actually published still
 * produces a plausible report, just with different membership. So every case here is pinned
 * on a stub `gh` with a fixture timeline whose answer is known by construction.
 *
 * Mutation record — three mutants run against this file (`.gate-logs/probe-publication-lag.mjs`,
 * each a literal line-targeted replacement with an `applied=yes` assertion before the run):
 *  - iterate only `run_attempt`, i.e. the latest attempt → `0.2.0` loses its row and the
 *    series shrinks; dies at "takes the gap from the attempt that actually published" *and*
 *    at the `measured=2 of 4` count. Two assertions, which is the point: a mutant that only
 *    moved the count would leave the reading itself unverified.
 *  - drop the `gap < 0` branch (so a negative is measured as an ordinary row) → no
 *    `NEGATIVE 0.3.0` line and `measured=3 of 4`; dies at "reports a negative gap as its own
 *    regime" and at the count.
 *  - drop the `conclusion !== 'success'` exclusion → `0.4.0` enters the denominator with no
 *    publish step of its own; dies at "names the tag its denominator drops", at the count,
 *    *and* at the progress-line assertion, which counts one `reading <version>` per tag and
 *    so doubles as an independent witness of the denominator's size.
 * All three killed, exit 1, and the file restored byte-identical afterwards.
 */

const script = join(__dirname, '..', 'scripts', 'publication-lag.mjs');

/** Post-`--jq` shapes: the script parses whatever `gh` prints, so the stub emits filtered JSON. */
const runs = [
  { id: 11, head_branch: 'v0.1.0', conclusion: 'success', run_attempt: 1 },
  { id: 12, head_branch: 'v0.2.0', conclusion: 'success', run_attempt: 2 },
  { id: 13, head_branch: 'v0.3.0', conclusion: 'success', run_attempt: 1 },
  { id: 14, head_branch: 'v0.4.0', conclusion: 'failure', run_attempt: 1 },
  // Green, but with no `time[]` entry: the registry side is missing rather than negative.
  { id: 15, head_branch: 'v0.5.0', conclusion: 'success', run_attempt: 1 }
];

const step = (name: string, started: string, completed: string) => ({
  name,
  started_at: started,
  completed_at: completed,
  conclusion: 'success'
});

const jobs: Record<string, unknown[]> = {
  // A plain first-attempt publish: 20 s of wall time, recorded 200 s after it returned.
  '11/1': [step('Publish to npm', '2026-01-01T10:00:00Z', '2026-01-01T10:00:20Z'),
    step('Verify published npm consumers', '2026-01-01T10:00:30Z', '2026-01-01T10:05:34Z')],
  // Attempt 1 is the real publish; attempt 2 re-ran and found the version already there, so
  // its own `completed_at` sits *after* the record — the reading that yields a negative gap.
  '12/1': [step('Publish to npm', '2026-01-01T09:59:40Z', '2026-01-01T10:00:00Z'),
    step('Verify published npm consumers', '2026-01-01T10:00:10Z', '2026-01-01T10:06:14Z')],
  '12/2': [step('Publish to npm', '2026-01-01T11:00:00Z', '2026-01-01T11:00:01Z'),
    step('Verify published npm consumers', '2026-01-01T11:00:10Z', '2026-01-01T11:00:11Z')],
  // The registry stamped this one *before* the ack returned: a regime, not a failed read.
  '13/1': [step('Publish to npm', '2026-01-01T10:00:00Z', '2026-01-01T10:00:18Z')],
  '15/1': [step('Publish to npm', '2026-01-01T10:00:00Z', '2026-01-01T10:00:17Z')]
};

const times = {
  '0.1.0': '2026-01-01T10:03:40Z',
  '0.2.0': '2026-01-01T10:05:10Z',
  '0.3.0': '2026-01-01T09:59:59Z',
  '0.4.0': '2026-01-01T10:04:00Z'
};

function runTool(): { stdout: string; stderr: string; status: number } {
  const root = mkdtempSync(join(tmpdir(), 'databus-publication-lag-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      [
        '#!/usr/bin/env node',
        "const args = process.argv.slice(2).join(' ');",
        `const runs = ${JSON.stringify(runs)};`,
        `const jobs = ${JSON.stringify(jobs)};`,
        `const times = ${JSON.stringify(times)};`,
        "if (args.includes('repo view')) { process.stdout.write('octo/demo'); }",
        "else if (args.includes('registry.npmjs.org')) { process.stdout.write(JSON.stringify(times)); }",
        // Most specific first. The workflow-id endpoint's path is a *prefix* of the runs
        // endpoint's, so a bare `actions/workflows` test placed ahead of `/runs?` answered
        // the page with the id `77`, and the sweep died on
        // `TypeError: Spread syntax requires ...iterable[Symbol.iterator] to be a function`.
        "else if (/attempts\\/\\d+\\/jobs/.test(args)) {",
        "  const [, id, attempt] = /runs\\/(\\d+)\\/attempts\\/(\\d+)\\/jobs/.exec(args) ?? [];",
        "  process.stdout.write(JSON.stringify(jobs[`${id}/${attempt}`] ?? []));",
        "} else if (/\\/runs\\?/.test(args)) {",
        // `[?&]` is load-bearing: a bare `/page=(\d+)/` matches the `per_page=100` that
        // precedes it, so page one was answered as page one hundred — i.e. with `[]` — and
        // the sweep reported a clean `measured=0 of 0 tags`.
        "  const page = Number(/[?&]page=(\\d+)/.exec(args)?.[1] ?? '1');",
        "  process.stdout.write(JSON.stringify(page === 1 ? runs : []));",
        "} else if (/actions\\/workflows/.test(args)) { process.stdout.write('77'); }",
        " else {",
        "  process.stderr.write(`unexpected gh args: ${args}\\n`);",
        "  process.exit(1);",
        '}',
        ''
      ].join('\n'),
      { mode: 0o755 }
    );
    const spawned = spawnSync(process.execPath, [script, '0.1.0'], {
      cwd: join(script, '..', '..'),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
      encoding: 'utf8'
    });
    return { stdout: spawned.stdout ?? '', stderr: spawned.stderr ?? '', status: spawned.status ?? -1 };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('publication-lag sweep', () => {
  const result = runTool();
  const line = (prefix: string) => result.stdout.split('\n').find(l => l.startsWith(prefix));

  it('runs to completion against the stub', () => {
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('measured=');
  });

  it('takes the gap from the attempt that actually published, not the latest one', () => {
    // 0.2.0's run has two attempts; only attempt 1's publish precedes the record, so a 310 s
    // row is the proof the sweep walked back. The latest attempt would yield -3291 s here.
    expect(line('0.2.0\t'), 'expected a measured row for the re-run tag').toContain('gap_s=310.0');
    expect(result.stdout).not.toContain('NEGATIVE 0.2.0');
  });

  it('uses the single-attempt reading unchanged', () => {
    const observed = `${result.stdout}\n--- stderr ---\n${result.stderr}`;
    expect(line('0.1.0\t'), observed).toContain('gap_s=200.0');
    expect(line('0.1.0\t'), observed).toContain('verify_s=304.0');
  });

  it('reports a negative gap as its own regime rather than as a missing publish', () => {
    const negative = line('NEGATIVE 0.3.0');
    expect(negative, 'the registry stamped before the ack returned; that is a reading').toContain('gap_s=-19.0');
    expect(result.stdout).not.toContain('NO-PUBLISH 0.3.0');
    expect(result.stdout).not.toContain('\n0.3.0\t');
  });

  it('names the tag its denominator drops for a non-green release run', () => {
    expect(line('EXCLUDED-NON-SUCCESS 0.4.0')).toContain('conclusion=failure');
    expect(result.stdout).not.toContain('\n0.4.0\t');
  });

  it('distinguishes a tag with no registry record from one with no publish step', () => {
    expect(line('NO-RECORD 0.5.0')).toBeDefined();
  });

  it('counts the measured rows against every green tag it considered', () => {
    // Four green tags (0.1.0/0.2.0/0.3.0/0.5.0), two of which produce a non-negative reading.
    expect(line('measured=')).toContain('measured=2 of 4 tags');
  });

  it('prints a progress line before each tag so a stopped run names where it stopped', () => {
    expect(result.stderr).toContain('reading 0.2.0');
    expect(result.stderr.split('\n').filter(l => l.startsWith('reading ')).length).toBe(4);
  });
});
