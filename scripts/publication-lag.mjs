#!/usr/bin/env node
// Re-derive the publication-lag series from artifacts rather than from prose, so the
// numbers in `docs/release-checklist.md` (and the ceiling they size) never have to be
// copied by hand. Usage:
//
//     node scripts/publication-lag.mjs [earliest-version]      # default 0.20.85
//
// For each release tag it prints two measurements:
//   gap_s     — `time[<version>]` on the npmjs packument minus the `Publish to npm`
//               step's `completed_at`. This is the lag that sizes
//               `maxMeasuredAckToRecordMs`, and therefore the 96 x 7500 ms consumer
//               budget in `.github/workflows/release.yml`.
//   verify_s  — the `Verify published npm consumers` step's own wall time.
//
// Attempt selection is the whole trick and the reason this is a script rather than a
// curl. `…/actions/runs/<id>/jobs` with no attempt segment returns the *latest*
// attempt, so for a tag whose run was re-run the publish step read there completed
// *after* the registry already held the record: measured on `v0.21.30` (run_attempt 2)
// the default read gives -177.0 s and a 1.0 s consumer step, while attempt 1 holds the
// real 310.0 s gap and the 364 s exhaustion the prose describes. So each tag walks its
// attempts and keeps the first whose publish step succeeded and finished before the
// record.
//
// A negative gap is a regime, not a failed read: the registry stamped the version
// before `npm publish` returned. `v0.20.88`, `v0.20.90` and `v0.20.91` all do it, and
// the first version of this tool filed them as `NO-PUBLISH` — real readings reported as
// absences, which is how an instrument manufactures gaps that were never there. They are
// printed as `NEGATIVE` lines and excluded from the `measured=` count instead.
//
// Every way this file can lose a member is printed rather than swallowed:
// `EXCLUDED-NON-SUCCESS` for a tag whose release run did not go green (`v0.20.89`
// exhausted its then-2-minute budget), `NO-RECORD` / `NO-PUBLISH` / `API-FAIL` for a tag
// it could not read, and a `reading <version>` line on stderr before each tag so a run
// that stops reporting names where it stopped. The per-call timeout exists for the same
// reason: the first full sweep of this logic hung on one `gh api` for four minutes and
// printed nothing, and an unbounded probe does not read as slow — it reads as pending,
// which is indistinguishable from working.
import { execFileSync } from 'node:child_process';

const from = process.argv[2] ?? '0.20.85';
const CALL_TIMEOUT_MS = 30_000;

const run = args => execFileSync('gh', args, { encoding: 'utf8', timeout: CALL_TIMEOUT_MS }).trim();
// GitHub's API answers `unexpected EOF` intermittently from this host, and one such call
// mid-sweep once ended the whole series with zero rows printed. Retry once, then report
// the read as failed rather than letting the exception truncate the output.
const gh = args => {
  try {
    return run(args);
  } catch {
    try {
      return run(args);
    } catch {
      return null;
    }
  }
};

const semverLt = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

// Resolved rather than pinned: a workflow id survives every edit to the file but not a
// recreate, and a stale id here would silently read another workflow's runs.
const repo = run(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
const workflowId = run(['api', `repos/${repo}/actions/workflows`,
  '--jq', '.workflows[] | select(.name == "Release") | .id']);
if (!workflowId) {
  console.error('Could not resolve the "Release" workflow id for this repository.');
  process.exit(1);
}

const runs = [];
for (const page of [1, 2, 3, 4]) {
  const out = gh(['api', `repos/${repo}/actions/workflows/${workflowId}/runs?per_page=100&page=${page}`,
    '--jq', '[.workflow_runs[]|{id,head_branch,conclusion,run_attempt}]']);
  if (out === null) { console.log(`API-FAIL runs page=${page}`); break; }
  const parsed = JSON.parse(out);
  runs.push(...parsed);
  if (parsed.length < 100) break;
}

const byTag = new Map();
const excluded = [];
for (const r of runs) {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(r.head_branch ?? '');
  if (!m || semverLt(m[1], from)) continue;
  if (r.conclusion !== 'success') {
    if (!excluded.some(e => e.version === m[1])) excluded.push({ version: m[1], conclusion: r.conclusion });
    continue;
  }
  const prev = byTag.get(m[1]);
  if (!prev || r.id > prev.id) byTag.set(m[1], r);
}
for (const e of excluded.sort((a, b) => (semverLt(a.version, b.version) ? -1 : 1))) {
  console.log(`EXCLUDED-NON-SUCCESS ${e.version} conclusion=${e.conclusion}`);
}

// The registry is named explicitly. This machine's `npm` is configured to a mirror whose
// copy of a version can be an hour behind, and a lag read against that mirror is a
// measurement of the mirror's sync, not of the publish.
const packument = gh(['api', 'https://registry.npmjs.org/cross-tab-worker-databus',
  '--hostname', 'registry.npmjs.org', '--jq', '.time']);
if (packument === null) {
  console.error('Could not read the npmjs packument; the series has no registry side.');
  process.exit(1);
}
const times = JSON.parse(packument);

// Module scope, not inside the loop below: the per-tag rows are printed *after* the sweep
// finishes, so a formatter declared in the loop body is out of scope where the list needs it.
const fmt = r => `gap_s=${r.gap.toFixed(1)}\tpublish_s=${r.publishMs.toFixed(0)}`
  + `\tverify_s=${r.duration === null ? 'n/a' : r.duration.toFixed(1)}`;

const versions = [...byTag.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const rows = [];
for (const version of versions) {
  process.stderr.write(`reading ${version}\n`);
  const tagRun = byTag.get(version);
  const record = times[version];
  if (!record) { console.log(`NO-RECORD ${version}`); continue; }
  let best = null;
  let negative = null;
  for (let attempt = 1; attempt <= tagRun.run_attempt; attempt++) {
    const jobsRaw = gh(['api', `repos/${repo}/actions/runs/${tagRun.id}/attempts/${attempt}/jobs`,
      '--jq', '[.jobs[]|.steps[]?|select(.name|test("publish to npm|verify published npm consumers";"i"))'
        + '|{name,started_at,completed_at,conclusion}]']);
    if (jobsRaw === null) { console.log(`API-FAIL ${version} attempt=${attempt} run=${tagRun.id}`); break; }
    const steps = JSON.parse(jobsRaw);
    const publish = steps.find(s => /publish to npm/i.test(s.name) && s.conclusion === 'success');
    if (!publish) { console.log(`NO-STEP ${version} attempt=${attempt} run=${tagRun.id}`); continue; }
    const gap = (new Date(record) - new Date(publish.completed_at)) / 1000;
    const consumer = steps.find(s => /verify published npm consumers/i.test(s.name));
    const duration = consumer ? (new Date(consumer.completed_at) - new Date(consumer.started_at)) / 1000 : null;
    // The publish step's own wall time is the datum that tells a real publish from a skip:
    // the step prints "already published; skipping" and returns in about a second, which is
    // how `v0.20.85`'s attempt 2 reads -529.2 s against a record its earlier attempt made.
    const publishMs = (new Date(publish.completed_at) - new Date(publish.started_at)) / 1000;
    if (gap < 0) { negative = { attempt, gap, duration, publishMs }; continue; }
    best = { attempt, gap, duration, publishMs };
    break;
  }
  const fmt = r => `gap_s=${r.gap.toFixed(1)}\tpublish_s=${r.publishMs.toFixed(0)}`
    + `\tverify_s=${r.duration === null ? 'n/a' : r.duration.toFixed(1)}`;
  if (!best && negative) {
    console.log(`NEGATIVE ${version}\tattempt=neg${negative.attempt}\t${fmt(negative)}`);
    continue;
  }
  if (!best) { console.log(`NO-PUBLISH ${version} run=${tagRun.id} attempts=${tagRun.run_attempt}`); continue; }
  rows.push({ version, attempts: tagRun.run_attempt, ...best });
}

for (const r of rows) {
  const flag = r.attempt !== 1 ? `\tattempt=${r.attempt}/of${r.attempts}` : '';
  console.log(`${r.version}\t${fmt(r)}${flag}`);
}

const summary = (label, values) => {
  if (!values.length) return console.log(`${label}: none`);
  const sorted = [...values].sort((a, b) => a - b);
  console.log(`${label} n=${sorted.length} min=${sorted[0].toFixed(1)} p50=${sorted[Math.floor(sorted.length / 2)].toFixed(1)} max=${sorted.at(-1).toFixed(1)}`);
  return sorted;
};

console.log(`measured=${rows.length} of ${versions.length} tags (earliest ${from})`);
const gaps = summary('gap', rows.map(r => r.gap));
const durs = summary('verify', rows.filter(r => r.duration !== null).map(r => r.duration));
if (durs) {
  console.log(`verify inside 300-310s: ${durs.filter(d => d >= 300 && d <= 310).length} of ${durs.length}`);
}
if (gaps) {
  console.log(`gap over 310s (the figure that would raise the budget): ${gaps.filter(g => g > 310).length}`);
}
// Split at the window the near-zero readings sit below: `0.20.86`-`0.20.91` recorded
// within ±0.6 s of their acks and their consumer step returned in 1 s, while every release
// from `0.20.92` on has taken at least 74.8 s. Reporting one range over both halves is how
// "the registry records minutes after the ack" came to be written about npm rather than
// about a window in this repository's own history.
const modern = rows.filter(r => !semverLt(r.version, '0.20.92'));
const modernGaps = summary('modern gap (from 0.20.92)', modern.map(r => r.gap));
const modernDurs = summary('modern verify', modern.filter(r => r.duration !== null).map(r => r.duration));
if (modernDurs) {
  console.log(`modern in-band 300-310s: ${modernDurs.filter(d => d >= 300 && d <= 310).length} of ${modernDurs.length}`);
}
if (modernGaps) {
  console.log(`modern floor: ${modernGaps[0].toFixed(1)} | ceiling contribution unchanged if max <= 310.0: ${modernGaps.at(-1) <= 310}`);
}
console.log(`near-zero(|gap|<=1s)=${rows.filter(r => Math.abs(r.gap) <= 1).length} of ${rows.length}`);
