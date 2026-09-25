## [0.21.38] - 2026-09-25

One English sentence in the shipped roadmap described a ratio backwards while its Chinese mirror had the direction right — the class of defect only a two-language comparison finds. No library behavior, export, option, default, frame or storage key changed; the coverage floors and the zero-count arm ledger are `0.21.37`'s.

### Fixed

- **`docs/roadmap.md` placed the failing seed *below* the floor it is above.** The `0.21.17` block said the `storage-fail` interleaving reddens the sweep "from seed 414 onward, which is four times below the sweep's depth floor". The floor is `MIN_SEEDS = 100` in `tests/coordination-invariants.test.ts`, and 414 is more than four times it — which is the whole point of the sentence: the finding needs depth past what the sweep asserts as a minimum, so it is a finder rather than a guard. The Chinese mirror read 是……下限的四倍, correct in direction, so the two languages agreed on every digit and disagreed on the relation. Fixed in the English side; the Chinese side is left as written.
- **The English side of the same file now names the timeout its mirror names.** The `0.21.37` block credited `scripts/publication-lag.mjs` with "a per-call timeout"; the Chinese block said 30 秒超时. The script sets `CALL_TIMEOUT_MS = 30_000`, so the figure is in `scripts/publication-lag.mjs` and both languages now make the same claim rather than one making it more precisely than the other.

## [0.21.37] - 2026-09-25

One shipped instruction told every reader to run a script that exists in no clone, and making that script tracked turned up three numbers its own quoted prose had wrong. No library behavior, export, option or storage key changed.

### Fixed

- **Both release checklists pointed at a directory git never had.** `docs/release-checklist.md` and its Chinese mirror told the reader to re-derive the publication-lag series from `.gate-logs/publication-pair.mjs`, and `.gate-logs/` is in `.gitignore` — so a *published* instruction resolved only on the machine that wrote it. No gate can see this class: the citation sweep in `tests/documentation.test.ts` resolves test titles, and a shell command is neither a title nor a symbol. The tool is now `scripts/publication-lag.mjs` — tracked, with the repository name and the Release workflow id resolved through `gh` rather than hardcoded — and all three mentions across the two languages point at it. Promoting it also fixed the instrument twice over: the previous sweep had hung ~18 minutes on one unbounded `gh api` and printed nothing, so each call now carries a 30 s timeout, a `reading <version>` progress line and a named line for every member its denominator drops; and the first tracked run died with `ReferenceError: fmt is not defined` **after** reading all 45 tags, because the row formatter was a `const` scoped inside the sweep loop while the row list prints after it — four lines of stdout plus exit 1, which is the record that a run which has executed is not a run that has printed.

### Documentation

- **Three figures the same prose quoted came back different from the sweep.** The consumer steps under a second inside the measured set are **two** (`0.20.86`, `0.20.87`), not the "six" both languages carried — the other four pre-`0.20.92` releases print as `NEGATIVE` and are excluded from the 45, which is precisely the distinction the tool's own output draws and a copied sentence lost. `AGENTS.md` counted "all 42 releases from `0.20.92`"; the window holds **43**, and since that count moves every release the number is replaced by the lookup (`measured=N of M tags`) rather than refreshed. And "prints the attempt each reading came from" over-stated the flag, which fires only for a non-first attempt.
- **What held, re-read off the same output.** Gaps of 127.2 / 76.1 / 75.5 / 75.8 / 127.3 / 126.4 s for `0.21.31`–`0.21.36`, with their consumer steps at 308 / 304 / 304 / 304 / 305 / 304 s, and `0.21.30` alone at a 310.0 s gap and a 364.0 s step. Series summary: `measured=45 of 49`, `EXCLUDED-NON-SUCCESS 0.20.89 conclusion=failure`, 42 of 45 verifies inside 300–310 s, and zero gaps over 310 s — so `maxMeasuredAckToRecordMs` and the 96 × 7500 ms budget are untouched and `tests/workflows.test.ts` passes unmodified.
- **`AGENTS.md` gained the citation class, with its own scope measured rather than tidied.** `grep -c -o '\.gate-logs/' $(git ls-files)` now reports 3 in `AGENTS.md`, 23 in `docs/progress.md`, 1 in `CHANGELOG.md`, and one each in `.gitignore` and `eslint.config.js` (those two name the directory as configuration, which is the point of it). Only the first are living instructions, and they deliberately stay pointing at session scratch: promoting a throwaway mutation probe into `scripts/` to satisfy a pointer in a dated record trades a dead reference for a file nobody maintains.
- **A copied-forward count in the progress log had never been read off an artifact.** The `bench:browser` debt was recorded as "four releases" and then "five" in successive entries' `Next` lines; the newest `bench-results/browser-*.json` is `2026-09-24T13:40:52Z`, eight minutes before `0.21.22`'s release commit (`47cf6f4`) regenerated `docs/benchmarks.md`, which makes it **fourteen** releases (`0.21.23` on). Neither wrong number reached a shipped file, so the fix is in the log: both older `Next` lines now point at the two artifacts instead of reasserting a guess.

## [0.21.36] - 2026-09-25

Two shipped comments said things the code contradicts — one counted three listeners where the repository registers one handler twice, and the other quoted a test total that had already gone stale twice *while telling the reader how to re-derive it*. Fourteen numeric claims across `src/` were counted against the tree to find them, and thirteen surfaces of prose and gates were corrected or given a check on the way. No library behavior, export, option or storage key changed.

### Fixed

- **A declaration comment on a `private` member counted three listeners where there are two call sites.** `src/centrifuge.ts`'s `handleOutput` doc read "Shared by the Worker message listener, the SharedWorker port listener, and the local-session sink — all three feed into this single dispatcher". Measured: dedicated Worker and SharedWorker `MessagePort` are attached to the *same* `handleMessage` function (`addEventListener('message', …)` fires twice for one handler), so three sources reach it through two call sites — the sentence was right about feeds and wrong about functions, and a reader grepping for the third listener lands back on the first and concludes code is missing. It now carries both counts and the reason. This ships wider than it looks: `tsc` emits a `private` member and keeps its JSDoc, so the text was found in five artifacts — `dist/centrifuge.d.ts`, `dist/centrifuge.js`, both CJS bundles and their maps — which is why `AGENTS.md` now says plainly that `private` is not an exemption from the shipped-prose surface.
- **A count beside its own lookup instruction was deleted rather than refreshed.** `src/core/trace.ts`'s `sink`-default note said "the same deletion re-run here: all 944 tests pass"; the suite is 954. That figure had replaced "884" two releases earlier, in the very sentence that added "take the denominator from `pnpm test`" — so the site held the re-derive recipe and a stale product of it at once, which is the form least likely to be checked, because the next reader is the person who just edited the number. The suite total is not a property of the claim (which is "2 events → 2 `TypeError`s"), so the value is gone and only the lookup remains. The same sweep counted fourteen numeric claims against the tree and twelve held exactly — `confirmRoute()`'s three call sites, `assignedTopics`' three writers, `pendingStop`'s four writes and two non-null writes, `transportReady = false`'s five sites, `startPromise`'s four installs of ten assignments, `percentileMs`' six calls, the reaper's three statements in one `try`, `validation.ts`' twenty-five-value vector enumerated in the sentence that counts it, and `centrifuge@5.7.4`'s twelve `emit('error')` sites inside `BaseSubscription` at lines 667–2673 against 23 in the file, where the range qualifier is what makes the claim true. The dated copies of the corrected figure in the roadmap and progress logs stay: they record what a mutant did at their own release.

### Documentation

- **`CONTRIBUTING.md` had never been read against the repository, and four of its claims were contradicted by it.** Coverage thresholds were stated as 85/80/90/85 against `vitest.config.ts`'s 98/96/98/99 — understating a blocking gate is the direction that manufactures a contributor who is green locally and red in CI, so the line now names the config as the source of truth; `pnpm check` was glossed as "typecheck + build + 221 unit tests" and omitted that it runs the perf gates and *not* lint; the release section told contributors to run `npm version` and then `git push origin main --tags`, i.e. to tag the local HEAD and push to the protected branch directly, which are the two operations this repository prohibits, and it now reads fetch → fast-forward → tag the merged commit → push that one tag; and `[Unreleased]` was prescribed in four places (two in this file, the PR template, and both roadmap languages) although the convention is abandoned — `## [Unreleased]` appears zero times in `CHANGELOG.md` and the last commit that touched the marker is `0794966`, at the `0.21.17` prep. All four copies now describe the versioned section and point at `docs/release-checklist.md` as authoritative.
- **The publish-lag recipe named a parameter it never said how to choose.** Three surfaces told a reader to re-derive the ack→record gap from a release run's jobs endpoint with the attempt left blank, and one glossed it as "attempt 1 is the failed one" — true of exactly one tag in the series. The plain endpoint returns the *latest* attempt, so on the one re-run release the obvious short form answers a different question: -177.0 s and a 1.0 s consumer step, against the 310.0 s gap and 364 s failure that attempt 1 holds. Both checklists (en + zh) and the release workflow comment now state where to read the attempt number from, and the same sweep widened the series from nine releases to every tag the repository has cut: 44 non-negative gaps with a maximum of 310.0 s, so the 720 s registry-propagation budget is untouched, while "the registry records minutes after the ack" is scoped to the `0.20.92`-onward window because five older releases recorded within ±0.6 s and three of them *before* the ack returned.
- **The documentation index described a generator more loosely than the generator describes itself.** `docs/README.md` said the benchmark trend is built "from `bench-results/`" where `scripts/bench-trend.mjs` reads only `browser-*.json`; both languages now name the subset. The other ten index rows were read against their targets and hold — including the capabilities row, whose three tiers appear in no heading at all and only in the status legend plus table cells, which is why the check had to read bodies rather than grep headings.

### Added

- **`AGENTS.md`'s directory map is now complete and gated.** It named 16 of the 43 files under `tests/` while keeping a one-line-per-file shape, so every harness, prose gate, release gate and bench file added after the block was written was invisible to the session that reads it first. It covers all tracked `src`/`tests`/`e2e` files plus a line per code directory, and `tests/documentation.test.ts`'s new case enforces it — with the section's *edges* pinned, not only its contents, because a fence extraction that slips one position makes "every name appears in the block" true of a document that merely discusses those files elsewhere. Five mutants, each dying to a different assertion.
- **A prose gate can no longer scan a build artifact.** `listDocumentationFiles()` walks a directory as it is on disk with no extension filter, so the privacy gate was regex-scanning the 1.13 MB React bundle and 1.75 MB map that `pnpm build:examples` leaves in gitignored `examples/react/vendor/` — and only on machines that had built it, since CI's `verify` job never does and the `browser` job that does runs no vitest. A vendored scoped-package specifier would therefore have reddened a docs-only PR at home while the merge gate stayed green. The scope is now the repository's own index, and the predicate has a case on fabricated input so it reads identically on a clean and a built tree.
- **`CONTRIBUTING.md` joined three prose gates, and each was probed separately rather than credited as one widening.** Doctored with one violation of each kind and run with the array entry, then with only that entry removed: the empty-section and relative-link sweeps go `FAILED(1)` → `PASSED(21)`, so those additions are preventive coverage that provably fires; the citation sweep has no citation in the file to fire on, and is reported as preventive only.

## [0.21.35] - 2026-09-25

Two shipped comments cited a test by a fixture string instead of its name, and that class of citation now has a gate; the `AGENTS.md` copy of the `knownTopics` cap rule was the last one still stating a bound the code refuses; the release gate that decides "npm never recorded this version" now asks npm instead of whatever registry the machine is configured to use; and finishing the sweep of one of this release's own corrections turned up three sentences it had broken or left behind in the Chinese mirror. No library behavior, export, option or key changed.

### Fixed

- **The completeness gate could call a published version unpublished, from a read that succeeded.** `scripts/verify-release-version.mjs` read the packument with a bare `npm view <pkg> time --json`, which consults the *configured* registry. Measured while preparing this release on a machine whose `npm` points at `registry.npmmirror.com`: its copy of the document still reported `modified: 2026-09-25T00:32:51.767Z` — the `0.21.33` publish — when the gate ran at `03:41:18Z`, **3,207 s (53 min)** after npmjs recorded `0.21.34` at `02:47:50.782Z`; the mirror's own `modified` stamp later moved to `03:44:48.778Z`, so it had been answering without that version for 3,418 s. So the gate exited 1 with `CHANGELOG names 1 release(s) the registry has never recorded: 0.21.34` about a version that had been public for 3,207 s. (An earlier draft of this sentence wrote "75 minutes" as an elapsed time in that story; it is the gap between two *previous* stamps, `00:32:51Z` → `02:47:50Z`, and belongs to no interval here.) The header's own inference — "`time[]` records never expire, so a version missing from a read that succeeded was never published" — was wrong in its second premise: a mirror that has not *learned* about a version is not a record of its absence, and because a mirror's sync lag is not HTTP caching, `cache-control: no-cache` returns the same stale document. The read now names `https://registry.npmjs.org` explicitly, which is what makes "the registry" mean the thing whose absence is proof; re-running it after the fix prints `the 48 earlier CHANGELOG releases from 0.20.85 on are all in the registry's time map`, exit 0. `verify-published-consumer.mjs` had already pinned `--registry` on both of its reads for the same reason — this was the last npm-based registry read in the repository that did not, and the documented re-derive command in `docs/release-checklist.md` (en + zh) carried the unpinned form. Every existing case for this gate injects `RELEASE_REGISTRY_TIME`, which is why none of them could see which registry is consulted; the new one runs the un-injected path against a stub `npm` and asserts the flag and the URL arrive as a pair.

### Added

- **Every test-name citation in the living prose must now resolve to exactly one case.** `tests/documentation.test.ts` gained "resolve to a case that exists in the file they name", which scans `src/**`, `AGENTS.md`, `README.md` and the public docs for `tests/<file>`'s `<name>` and requires the name to match one `it()`/`test()` title in the file it names (a trailing `…` may prefix-match, against one hit only). 18 citations across 52 files today. Both halves of the scan carry their own control, because both can go empty and an empty `unresolved` list reads as a clean bill either way: the title collector must find the suite's cases (977 titles across 40 files, floored at 500 rather than at the corpus size, since a floor at the current count teaches the next reader to lower it), the citation pattern must examine at least one citation, and the `e2e` corpus is asserted separately — 937 of the 977 titles come from `tests/`, so the total could not notice the e2e sweep going empty. Two scope decisions are measured rather than assumed: the two exempt surfaces hold 11 of these citations between them (`docs/progress.md` 8, `CHANGELOG.md` 3) while the public docs hold 1, and exactly one of the 11 does not resolve — a verbatim quote of the gate's own failure message, not a pointer — where an earlier draft of this sentence had written "`docs/` carries 8" by counting `progress.md`, which the gate deliberately does not scan; and the looser `filename … ('a name')` window was tried and left out, because it produces exactly one candidate across the scope and that candidate is the `new Error(…)` message inside the very function whose doc comment names the test. Mutation-checked five ways: a dead citation kills 1 test, a nine-way ambiguous prefix is reported as `(9 matches)`, neutering the citation pattern trips the `examined` control, neutering the title collector trips the title floor, and shortening the `docs/architecture.md` citation kills one test — which is what says the widened scope has teeth the `src`-only version did not. The gate reddened the `AGENTS.md` bullet written to describe it, because the first draft named the two defective tokens in citation form as examples; the rule now says to name a token bare when the sentence is about a defect rather than pointing at a case.

### Documentation

- **A load-bearing test-harness count had rotted in two directions at once, and one file held both values.** `ChannelHub`'s synchronous delivery default is documented by what it costs: flipping it reddens the suite. `tests/fakes.ts`, `tests/coordination-invariants.test.ts` and one `AGENTS.md` bullet said 15 post-and-assert tests and 17 failures; `AGENTS.md`'s *other* bullet said 18. Re-measured by editing the field and running the suite: **18** fail — 9 `cluster`, 6 `data-bus`, 1 `stability` (16 that post a frame and assert in the same stack), plus the hub's two own pins in `coordination-invariants`, one of which asserts the default by name. The three surfaces now agree, and each names the edit that regenerates the number rather than leaving it to rot again. **The finding is not the off-by-one; it is that a single file can carry the stale count and its correction simultaneously**, in two bullets written a cycle apart, and nothing contradicts either — the same shape as a drifted line number, one level up.
- **A correction can break the sentence it lands in, and the zh mirror can keep the figure the English already retired.** Three survivors of the sweep that replaced an unmeasured "75 minutes" with the four timestamps that produce it: `docs/zh/release-checklist.md` still said the mirror ran an hour behind after its English counterpart carried 3,418 s; both zh copies of the measurement read `3,207 s 秒`, the unit written twice, which is what a numeric insert leaves in a sentence whose unit was already spelled out; and two copies of the retraction itself were spliced into running text, producing `…not an elapsed time in this story. so the gate exited 1 with …` and `…) and the gate exited 1 …`. Nothing compiles prose, so no gate can see the last class and no phrase-grep finds the first — a paraphrase shares no substring with the text that was fixed, which is why the closing check is a grep for the *figure* across languages. `AGENTS.md` gained the rule plus the scan recipe (a full stop followed by a lowercase function word over the 70 living-surface files, with inline code stripped and a lone letter before the dot read as an abbreviation); it reported one real hit in the tree (a sentence in `docs/progress.md`, repaired two commits earlier in this same branch at `7168810`, so a run after that one reports none), and the scan is graded by the two pre-fix commits it still finds, because its first pattern required whitespace straight after the stop and cleared the bracketed form, while its first abbreviation filter matched the `e` of `evidence.` and called the tree clean over a genuine defect. The scan then caught this session splicing a second instance while writing the bullet about the first.
- **Two shipped citations named a fixture, not a case — and both reach consumers.** `src/core/routing.ts` pointed at `tests/cluster.test.ts`'s sticky case by the `clusterKey` literal written inside it, and `src/core/trace.ts` did the same with a `tests/data-bus.test.ts` case named by its `clusterKey` fixture rather than by its title ("keeps tracing disabled by default"); each is a `clusterKey` string sitting in a test *body*, so the pointer landed mid-case rather than at the assertion, and the first rename of either arbitrary fixture would have landed nowhere with nothing in the build, the type check or the suite to contradict it. Both sit in declaration JSDoc, so the wrong pointer is published: after the fix the case titles appear in `dist/core/routing.d.ts` and `dist/core/trace.d.ts` and the fixture strings do not.
- **The last copy of the `knownTopics` cap absolute is retired.** `AGENTS.md` — the surface that steers every future session — still read "FIFO eviction, max 500 entries" and "never evicts a key the worker still owns" two releases after `src/` and both architecture languages were corrected. It now states the measured rule: the 500 bound counts entries this worker does not own, the eviction scan skips two candidates (an owned key, and the key being remembered, because a fresh `Map.set` lands at the back so the front-scan reaches it only once everything older is owned), and in that state the cap slips — 1,200 adopted peer `CONTROL/SUBSCRIBE` frames grew `knownTopics` and `assignedTopics` to 1,200 together and one reconcile tick returned both to `0`. For that flood the memory bound is the sweep, not the cap.
- **The publication-lag samples were extended, and the ceiling's derivation did not move.** `0.21.34`'s tag run is the eighth ack→`time[<version>]` reading and the ninth green step duration: `Publish to npm` completed `02:46:35Z`, the registry recorded the version at `02:47:50.782Z` (**75.8 s**), and `Verify published npm consumers` took **304 s**. The three newest record lags — 76.1, 75.5, 75.8 s — span half a second across three consecutive releases while the step still consumes ~304 s each time, which locates the variance in the reader's blindness rather than in the registry's write; the observation is in all four copies (`docs/release-checklist.md` en + zh, the workflow comment, `tests/workflows.test.ts`) beside the `gh api` lookup that re-derives it. 75.8 s does not beat the 310 s that sizes the 720 s ceiling, so `maxMeasuredAckToRecordMs` stays put and the floor passes unmodified.

### Compatibility

No library code, export, option, default, frame or storage key changed; `verify:compat`, `verify:types` and `verify:pack` run against `v0.21.34`. The suite is 37 files / 952 tests (950 before this cycle, plus the citation gate and the registry-read case). The release-time completeness gate now reports 48 gated releases rather than 47, because `0.21.34` has joined the set it audits — the count rising is that gate working.


## [0.21.34] - 2026-09-25

A release gate that can now refuse to tag, one library behavior that got the test it never had, and three shipped sentences about caps that each described a protection the code does not provide. No public API, export, option, default, frame or storage key changed.

### Added

- **The release record is checked against the registry before a tag moves.** `scripts/verify-release-version.mjs` now reads the packument's `time` map beside the version/tag/CHANGELOG checks it already made, and fails the tag when the CHANGELOG names a release at or above `firstGatedRelease = 0.20.85` that npm never recorded. The release in flight is exempt by necessity (the step runs before the publish), a duplicated section reports its hole once, and a failed registry read **warns and skips** rather than redding the release — the deliberate half, because this repository has several gates that have already turned a good release red over their own plumbing. Why a floor rather than the whole file: 40 of the CHANGELOG's 164 `## [x.y.z]` sections name versions with no registry `time` entry at all — 41 counting the release in flight, which is exactly why the gate exempts it — and they are `0.9.0`, each minor's first patch from `0.12.0` to `0.18.0`, **all ten** `0.19.x`, `0.20.0`–`0.20.5`, `0.20.54`, `0.20.55`, `0.20.69` and `0.20.72`–`0.20.84`, which is 1 + 7 + 10 + 6 + 2 + 1 + 13 = 40, every one of them below `0.20.85`, while from there on the record is in lockstep: all 47 sections from `0.20.85` through `0.21.33` are in the registry's `time` map (that count is this tag's own reading — take it from the line the script prints, which rises by one with every release). So the gate is strict about the era where strictness is the norm and cannot fire on the archaeology before it. Re-derive with `npm view cross-tab-worker-databus time --json`; the script prints its own count rather than letting a reader trust this one.

### Tests

- **`rememberTopic()`'s eviction loop skips two candidates, and only one of them could decide anything a test saw.** Deleting `candidate === topicKey ||` left all 944 tests green, so the term was live and unpinned rather than dominated. The reachable state is narrow: a fresh `Map.set` lands at the **back** of the insertion-ordered Map, so the front-scan arrives at the key being remembered only once every older entry is owned — and there the mutant discards the very mapping the call exists to install. `tests/cluster.test.ts`'s new case builds exactly that (500 adopted peer `CONTROL/SUBSCRIBE` frames, which are owned by definition, then one `CONTROL/PUBLISH` for a new topic); with the term removed it fails at `expected [ 'owned.0', 'owned.1', …(498) ] to include 'evict.extra'`, and the pre-existing `never evicts a topic the worker still owns from knownTopics` is what attributes the *other* skip, so both terms now have their own kill set. Two candidate designs were tried and discarded before this one, and the reason is recorded in the test's comment: a peer SUBSCRIBE frame cannot produce an unowned entry, and re-remembering a key already present cannot overflow the cap.

### Documentation

- **The `knownTopics` cap does not bound an adoption flood — in either language, and in a table cell nobody re-read.** `docs/architecture.md` claimed `MAX_KNOWN_TOPICS = 500` "prevents a misbehaving or malicious peer from exhausting memory by referencing arbitrary topics in control messages". Measured, it does not: each such frame is *adopted*, adoption makes its key owned, and the eviction loop declines to drop an owned key, so 1,200 peer `CONTROL/SUBSCRIBE` frames grew `knownTopics` and `assignedTopics` to 1,200 (marks at 500 / 600 / 800 / 1,200) and one reconcile tick took both back to `0`. The bound on that flood is the sweep; the cap bounds entries this worker does not own. The same section's identifier table still carried the older short form of the rule ("FIFO-capped at 500; never evicts owned keys") and the row beside it named `CONTROL/UNSUBSCRIBE` and handoff as the only release paths for `assignedTopics`, omitting `reconcileAssignedTopics` — the leg that actually ends the flood. All three surfaces now say which structure bounds which, in both languages.
- **`MAX_PENDING_TOPICS` is an admission gate, not a per-topic bound.** `src/core/trace.ts` credited both of its caps with protecting against "a single misbehaving topic"; only `MAX_PENDING_MESSAGES_PER_TOPIC` (256) is about one topic. The 1,000-entry cap refuses the *next distinct* topic — measured 1,001 topics leaving 1,000 queues while an admitted topic still grows to 256 — and the `topics` Set carries neither cap on purpose (10,001 touched beside 1,000 sampled), being bounded by the window flush instead. Both caps turned out to have had named tests all along: two new cases written for this cycle were mutation-probed, found to duplicate `caps the number of topics tracked for pending receives` and `caps the pending receive queue per topic`, and deleted, so the shipped comment cites the existing names and the release adds no test and removes none.
- **The publication-lag samples were extended, and the ceiling's derivation did not move.** `0.21.33`'s tag run is the seventh ack→`time[<version>]` reading and the eighth green step duration: ack `00:31:20Z`, registry record `00:32:35.519Z` (**75.5 s**), `Verify published npm consumers` **304 s** — one 300 s lifetime plus command time, measured from that runner's own first fetch. Both lists are written out in `docs/release-checklist.md` (en + zh), the workflow comment and `tests/workflows.test.ts`, each with the `gh api` lookup that re-derives it. 75.5 s does not beat the 310 s that sizes the 720 s ceiling, so `maxMeasuredAckToRecordMs` stays put and the floor passes unmodified — widening the sample set without moving the derivation is the result being looked for.

### Compatibility

No library code, export, option, default, frame or storage key changed; `verify:compat`, `verify:types` and `verify:pack` run against `v0.21.33`. The suite is 37 files / 950 tests (944 before `0.21.34`'s cycle, plus the five release-gate cases and the eviction pin). The only new blocking behavior is in the release workflow's own version gate, which skips itself when the registry read fails.

## [0.21.33] - 2026-09-25

A sentence in the release checklist was wrong in a way only a new measurement could show, and the release it described was the one that produced it: `0.21.32`'s published-consumer step took 304 s while its registry record existed 76.1 s in. No library code changed.

### Fixed

- **Documentation tooling: the counter-observation against a purely-local npm cache account is retracted, because it joined two machines.** The prose cited 0.21.30 as evidence *against* that account on the grounds that "the retry resolved before a fresh 21:44 fetch's 300 s lifetime had run out". Read against the run records, the two halves come from different hosts: the 21:44:35Z "fresh read" was a `npm pack` on a laptop, while the 1 s green at 21:47:10Z was a **new runner job**, and a new job starts with an empty npm cache — which is what the local account *predicts*, not what refutes it. What such an account still cannot explain is exactly one reading, and the text now names that one instead: the runner's own `ETARGET` at 21:45:07Z, 364 s after the poll loop opened at 21:39:03Z and so ~60 s after a copy taken then must have expired. The verdict stays *not established*, now resting on an anomaly rather than on a comparison that never was.

### Documentation

- **`0.21.32` is the cache-lifetime model's cleanest sample, and it is recorded as one.** Ack 23:34:46Z, registry `time['0.21.32']` 23:36:02.091Z (**76.1 s** — the second-smallest of the six now listed), a `no-cache` packument read from a laptop reporting the new `latest` 151 s in, and the runner's blocking verify finishing at **304 s** — one 300 s lifetime plus a few seconds of command time, measured from that runner's own first fetch. The verify-duration band is now **seven green samples at 304–308 s** (307, 304, 305, 304, 304 under the old ceiling; 308 and 304 under the raised one). Both sample lists — the ack→record gaps and the per-run durations — were extended in `docs/release-checklist.md` (en + zh), the workflow comment and `tests/workflows.test.ts`, and the `AGENTS.md` bullet that restates the lesson.
- **`maxMeasuredAckToRecordMs` deliberately did not move.** 76.1 s does not beat the 310 s that sizes the 720 s ceiling, so the floor's constant stays put and `tests/workflows.test.ts` still passes unchanged at 6/6 — which is the check that the new sample widened the list without invalidating the derivation.
- **The retired claim's earlier copies carry pointers rather than silent rewrites.** `CHANGELOG.md`'s `0.21.31` entry and both language `docs/roadmap.md` blocks keep the sentence they got wrong and add what superseded it, naming `0.21.33`, so the history reads as the sequence it was rather than as a claim that never existed.
- **Three numbers in that prose named the wrong quantity, and all three were caught before the tag.** (1) "the second-smallest of the **seven** now listed" counted the ack→record list with the verify-duration list's size: the gap list carries six values — the seven is `307 / 304 / 305 / 304 / 304 / 308 / 304` s of *step duration* — and the sentence's own parenthesis enumerated six. Fixed in this file and in `docs/progress.md`'s Phase 199 entry. (2) Three copies said 0.21.30 "burned its whole **364 s budget**"; that run's ceiling was **360 s** (48 × 7.5 s), and 364 s is the observed span from the step's first poll (21:39:03Z) to its last `ETARGET` (21:45:07Z) — a budget and a reading written as one number. `docs/release-checklist.md` (en + zh) and the workflow comment now say the 360 s ceiling and keep 364 s for the span. (3) `docs/progress.md` still carried the first draft of the anomaly sentence — "about 5 min 40 s after the fetch that should have gone stale by 21:44:05Z" — which matches neither the 364 s span nor the ~60 s past-expiry figure the corrected copies use; it now states those. While checking (1) the list's stated range, the two releases below it were sampled for the first time the same way: **157.8 s** for 0.21.25 (ack 17:56:53Z, record 17:59:30.781Z) and **96.1 s** for 0.21.26 (ack 18:41:40Z, record 18:43:16.084Z), whose step durations come back at 307 s and 304 s, exactly the two the duration list already records — so the run↔version attribution is confirmed by a number already on file. Eight gaps now exist and neither beats 310.0 s, so `maxMeasuredAckToRecordMs`, the 720 s ceiling and the shipped lists' stated range (0.21.27–0.21.32) are all unchanged; the two new readings live here rather than in every restatement, because a fourth copy of a list is a fourth thing to keep in sync.

### Compatibility

No library code, export, option, default, frame or storage key changed; `verify:compat`, `verify:types` and `verify:pack` run against `v0.21.32`. The edits are confined to `docs/`, `.github/workflows/release.yml`'s comment, `tests/workflows.test.ts`'s comment and `AGENTS.md`, none of which changes runtime behaviour; the workflow's `PUBLISHED_VERIFY_ATTEMPTS` stays at 96.

## [0.21.32] - 2026-09-25

A delivery bug, found while looking for something else. A topic's **first** publication from a tab that held a matching wildcard was dispatched locally and never forwarded, even while a live durable route named a different owner for it — and delivery is at-most-once, so that publication was gone for good. The fix is a deletion: the memo that made the decision decided nothing.

### Fixed

- **Routing: a topic's first `publish()` / `publishBatch()` now reaches that topic's concrete owner.** Both methods carried a textually identical fast path: while `wildcardPublishCache` held no entry for a topic, it scanned the local wildcard patterns and, on a match, addressed the control frame to *this* worker without consulting the durable route — while every later publication for the same topic did consult it. Measured with one runtime holding `chat.*` and a peer concretely owning `chat.room.1` (both `isAssigned` true, the route record naming the peer): three publications from the wildcard holder landed `1,0,0` on the sender and `0,1,1` on the owner. The first never left the tab. The same shape reproduced for a two-item batch, whose frame the receiver unpacks per item.
- **This is `0.20.58` from the other side, which is why an eviction rule would not have fixed it.** There, a cached `null` short-circuited the owner lookup and the fix was to keep consulting the route; here a cache *miss* did the same thing. The stored value decided nothing either way — `pattern` and `null` were both read only as "have I scanned this topic" — so the memo is removed rather than bounded, and every non-owned publication now resolves its target through `resolvePublishTarget()`. Wildcard ownership is still honoured: with no live concrete route that call answers with this worker, and the receiving ownership gate matches the pattern. Removing the map also retires the unbounded growth documented in `0.21.31`; that growth was a side effect of this fast path, not a separate defect, so the eviction rule it was framed as needing is no longer needed at all.

- **Repository tooling: a scratch directory inside the linted tree made `pnpm lint` red without naming any product code.** A mutation-probe harness was written to `.gate-logs/` — in-tree on purpose, since `/tmp` had evicted a failing log mid-session and `pnpm test:coverage` deletes `coverage/`, where logs had also been written — and `eslint .` reported 9 errors from it (`no-undef` on `console`/`process`, `no-control-regex`) as a lint failure of the release tree. `.gate-logs/` is now ignored by both git and eslint, with the reason recorded beside the entry in `.gitignore`. `tests/regression.test.ts`'s "keeps scripts/ covered by ESLint" still passes, so the release tooling stays linted and only scratch is excluded.

### Tests

- **Two regressions, one per entry point, each asserted one publication at a time** so a regression names *which* publication was lost instead of reporting a count short by one: `forwards a topic's FIRST publish to its concrete remote owner, not to a matching local wildcard` and `forwards a batch's FIRST publish to the concrete remote owner as well`. Measured both ways — without the fix they fail at `first publish must reach the concrete owner: expected +0 to be 1` and `expected [] to deeply equal [1, 2]`; with it the file is green. Three pre-existing cases that named the removed cache in their titles were retitled to what they actually assert, and the single-runtime pair among them is now labelled as the characterization it is: a lone runtime always wins its own election, so it cannot distinguish the two paths.
- **`trace.ts`'s flush-activity guard was re-measured on the tree that shipped this fix**, not carried forward: deleting `received` alone reddens 3 tests, `dispatched` 2, `dedupAccepted` 1, `dedupSuppressed` 1 — each operand's own kill set, all four restorations byte-identical.

### Documentation

- **`trace.ts`: each kill now names the file it comes from.** The note recorded which test dies to each operand deletion but not where it lives, and the two `dispatched` kills sit in two different files (`tests/data-bus.test.ts` and `tests/trace.test.ts`).
- **The publication-lag samples were extended, and one of them had been undercounted.** `0.21.31`'s tag run is the first to exercise the raised 720 s published-consumer ceiling: green on attempt 1 at 308 s, with its registry record 127.2 s after the publish ack and the remaining ~181 s spent against the cache lifetime — so the 310 s maximum the ceiling is sized from still stands, and the ceiling does not need raising again. The other half of that sentence was wrong in the cheap direction: the checklist and `AGENTS.md` credited the 304–305 s regularity to "three consecutive green tag runs", where the five runs from 0.21.25 to 0.21.29 took 307, 304, 305, 304 and 304 s, six samples in a 5-second band once 0.21.31's 308 s is counted. The lag list, the run-by-run durations and the `gh api` lookup that re-derives both are now written out in `docs/release-checklist.md` (en + zh), the workflow's own comment, and `tests/workflows.test.ts`.
- **`docs/architecture.md` (en + zh): the wildcard publish memo is removed, not capped.** Both copies had described it as the per-topic map the documented `knownTopics` cap does not reach, with an open question about which of its two value shapes could be forgotten; neither half survives, so the paragraph now says what replaced it and records the 1,200-versus-500 measurement beside the delivery counts that made the mechanism visible.
- **`publish()`'s surviving comment described the deleted mechanism.** Above the `assignedTopics.has(topicKey)` early return it still said wildcard holders "use the same fast path" — which that lookup never did: `assignedTopics` is keyed by the plaintext it was handed, so a holder of `chat.*` carries the *pattern's* key and a concrete topic misses the `has()`, exactly the fall-through the fix relies on. The sentence now names which lookup answers for which assignment, checked against `isAssigned()`'s own `topicMatchesPattern` loop and against `publishBatch()`, which carried no such claim.
- **The upstream-blocked toolchain item was re-checked, and both channels still exclude TypeScript 7.** `typescript-eslint`'s latest (8.70.1) and its canary (8.70.2-alpha.7) both declare `typescript >=4.8.4 <6.1.0`, so TS 7.0.2 would break the lint gate before touching our own types. The roadmap entry now says how to look that up without being fooled: read `dist-tags.canary`, because sorting version strings puts `8.9.1-alpha.9` last — `9` sorts after `70` — while the line actually worth watching is 8.70.x. The English entry's date had also drifted from the Chinese one (2026-09-23 against 2026-09-22) for the same check; both now carry one date and the same two versions.

### Compatibility

One behavioural change: a first publication for a wildcard-covered topic that has a live concrete owner is now forwarded to that owner instead of being dispatched locally. No export, option, default, frame or storage key changed; `wildcardPublishCache` was a private field and is absent from the emitted `dist/core/cluster.d.ts`. `verify:compat`, `verify:types` and `verify:pack` run against `v0.21.31`.

## [0.21.31] - 2026-09-25

The `0.21.30` tag run failed its blocking published-consumer gate after a *successful* publish. Diagnosing that gave the retry budget a measured size, retired a floor in the gate whose job was to keep that failure out, and retracted a note this repository wrote about the same failure less than an hour before it was corrected. No library code changed.

### Fixed

- **Release tooling: the published-consumer retry ceiling sat below the propagation lag it exists to absorb.** `PUBLISHED_VERIFY_ATTEMPTS=48` × 7500 ms is 360 s, and the 0.21.30 tag run consumed all of it on `ETARGET` while that version's tarball was already fetchable; the re-run against the unchanged tag then passed in 1 s. Two measured terms now size the number. (1) `npm publish`'s success ack precedes the registry's own `time[<version>]` record — by 74.8 s on 0.21.29, 96.8 s on 0.21.28, 248.7 s on 0.21.27 and 310.0 s on 0.21.30. (2) The packument that `npm pack` resolves against is served `cache-control: public, max-age=300`, so a copy of it anywhere in the path may be a full cache lifetime stale by design; that term is also what the three preceding green tag runs were reporting when they consumed 305 s, 304 s and 304 s of the ceiling in turn. The budget is now 96 × 7500 ms = 720 s, clearing the 310 + 300 = 610 s the two add to. Which copy served this run's stale views is **not** established: a purely npm-local-cache account predicts the retry should have waited for the same 300 s object and it did not, so the comment records the open question instead of naming a cache. *(That last inference was wrong, and `0.21.33` retracts it: the two readings it joins come from different machines — a laptop's `npm pack` and a new runner job whose cache starts empty — which is what the local account predicts rather than refutes. Its corrected form, plus `0.21.32`'s supporting sample, is in that release's notes.)*
- **`tests/workflows.test.ts` pinned a floor that the value which just failed satisfied.** The assertion was `totalMs >= 5 * 60 * 1000`, so the 360 s budget that had just turned a good release red passed the gate whose entire purpose is to stop that happening, and nothing would have objected to lowering it again. The floor is now the sum above, written as two named constants beside the rule that re-derives each. Measured against it: setting the workflow's attempts from 96 back to 48 fails exactly that test, and both the 360 s budget that failed here and the 120 s one 0.20.89 exhausted are rejected by it.

### Documentation

- **`cluster.ts`: the one per-topic map the documented `knownTopics` cap does not cover now says so.** `wildcardPublishCache` — concrete topic → the local wildcard pattern that matched it, or `null` for "scanned, nothing matched" — has no cap, and is cleared only by the two lifecycle teardowns whose `wildcardPublishCache.clear()` sits beside each `routeOwnerCache.clear()`. Measured: 1,200 `publish()` calls on distinct topic names leave `knownTopics` at its 500-entry cap while this map holds 1,200. The note records why a number is not the fix — evicting a *pattern* re-runs the first local dispatch the entry exists to prevent, while evicting a `null` re-scans and, if a wildcard has been assigned in between, gives that publication the fan-out of a first one — so bounding the map needs a rule about which of the two halves may be forgotten. `docs/architecture.md` and its Chinese counterpart gained the same statement in the paragraph after "Cap and eviction", which is where a reader looking for the memory bound would look.
- **`trace.ts`: the metrics guard's kill sets are named by test instead of counted.** Its flush-activity note carried "(three cases for `received`, two for `dispatched`)". Those multiplicities are exactly the kind that go false on an unrelated commit, and the five verbatim test names now stand in their place — including the fact the count hid, that `dispatched`'s two cases live in two different files.
- **`docs/release-checklist.md` (en + zh): how to adjudicate a publish, plus one retraction.** The note written during the same release claimed the package document endpoint and the tarball URL had disagreed "in the same minute". Its own timestamps say otherwise: the stale-document read was 21:43:15Z and the registry's record of that version is 21:44:12.987Z, so the read was not lagging an artifact that already existed — it was correctly reporting a publish the registry had not finished writing. The corrected text gives the sequence with its clock readings, states that absence from `versions`/`latest` minutes after a green publish step is the *expected* state of a successful release, names the genuine disagreement (a HEAD and a pack from one machine good by 21:44:35Z while the runner was still on `ETARGET` at 21:45:07Z), and tells the reader to probe from the machine that is failing. The "twelve times the manual default / ~6-minute ceiling / expect ~39 retries of 48" budget prose is replaced by the derivation above, with the two lookups needed to re-measure it.

### Tests

- **`tests/version-compat.test.ts` got its own per-test ceiling, because the global one was load-dependent for that file alone.** Every case there builds a throwaway git repository and runs `scripts/verify-version-compat.mjs` as a child process — `git init`, `git add`, `git commit`, `git tag` and one `node` spawn per test — so a case costs five process starts plus temp-tree I/O, not the object comparison it asserts on. Measured on an 8-core host at load average 400+: under `pnpm test:coverage` with nothing else of ours running, one case died with `Error: Test timed out in 15000ms` while 940 of 941 passed; the same file alone with a competing `pnpm bench` on the machine lost two cases and reported 3–19 s for the survivors (that reading is confounded by the concurrency and is the slowest of the three); and the same file alone with the contention gone passed all 18 in 23.7 s total, about 1.3 s per case. Which case crossed the line moved between runs, which is the signature of scheduling rather than of a hang. The ceiling is therefore raised for this file only, leaving every in-process test on the global 15 s. Proven wired rather than assumed: setting the value to `1` makes 17 of the 18 cases fail with `Test timed out in 1ms` and the run exit 1 — a control that could not fail would say nothing about whether the call binds.

### Compatibility

No library code, export, frame, option, default or storage key changed; `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.30`. The behavioural changes are confined to `.github/workflows/release.yml`, `tests/workflows.test.ts` and `tests/version-compat.test.ts`, none of which ships inside the package; the workflow change takes effect on the next tag push.

## [0.21.30] - 2026-09-25

The claim queue's remaining sites, worked one measurement at a time. Two shipped absolutes turned out to be false, four counts were made re-derivable where they had only been asserted, and one release gate was found able to pass while verifying the wrong artifact. No library code changed.

### Fixed

- **Release tooling: the published-consumer gate could verify the *previous* release.** `scripts/verify-published-consumer.mjs` resolved its target from `npm view <pkg> version` whenever `PUBLISHED_VERSION` was unset — and that read can be served from npm's local packument cache. Minutes after the last publish, two consecutive reads of that form named the version that had just been superseded, while `npm view <pkg> versions dist-tags --json` against the same registry already reported the new one and a third plain read then agreed; naming `--registry` explicitly does not defeat the local cache. A gate that downloads and imports the previous artifact exits 0, and the only witness is the version in the line it prints. An inferred version is therefore now trusted only when it agrees with the tree's own `package.json`, and an empty read is refused rather than allowed to become `pkg@`, which npm resolves as `latest`. The `Release` workflow never took this path — it passes the tag as `PUBLISHED_VERSION` — so this is a hazard on the manual repeat, which is the one the release checklist tells a maintainer to run.
- **`cluster.ts`'s route-owner cache described an over-cap condition that is the opposite of what happens.** The eviction loop's justification read "the cache is at least one entry over the cap here, so the iterator always yields a key to drop". Measured at `routeOwnerCacheMax: 2` against two remote owners: filling to the cap and then re-resolving either owner leaves `size` at 2, and the loop's first iteration breaks without deleting anything. A call adds at most one net entry, so the cap is exceeded only when a *new* key arrives while the cache already sits at it — "at least" was backwards for every re-touch and for every fill below the cap.
- **Six shipped comments quoted the size of the test suite as if it were stable.** Each said a deletion left "all 37 test files green". The count carries nothing the sentence lacks — the claim is that nothing fails — and it goes false on the commit that adds a file rather than on any change to the code being described. All six now say "the whole suite green", which is the phrasing `cluster.ts` already used for its own nil-owner guard.

### Tests

- **Five for the version resolver, which is now a pure function.** The script's body moved behind the same `main()`/`invokedDirectly` gate its sibling `verify-packed-consumer.mjs` uses, so the resolution rule is tested directly instead of asserted as source text: an explicit version wins without a registry read (and keeps winning when it names an older release, which is the only way to ask that question), a leading `v` and surrounding whitespace are stripped from either source, an inferred version agreeing with the tree is accepted, one disagreeing is refused with the remedy in the message, and an empty read is refused. All five legs were mutation-checked: ignoring the explicit value dies to two tests, removing the disagreement check to one, removing the empty check to one (it falls through to the other message), and dropping the strip to two.
- **`data-bus.ts`'s reopen absorb: all four legs re-run, and the forcing's shape recorded.** The `51 tests fail` leg had carried that number since its file held 194 tests. At 198 the same 51 came back, and the other three legs reproduce green. The measurement is only valid for a forcing that *appends a link to* `pending`: an earlier attempt replaced the variable with a fresh promise, and both of the legs that must be green then failed three tests each — the queued-behind-a-pending-stop case, the repeated hide/show case and the async-stop recovery case — because those assert on which promise a reopen waits for, not on whether it rejects. A broken mutant in a control leg reads as a finding rather than as a broken instrument.
- **`validation.ts`'s `typeof` operand: the vector named in full, and the deletion measured directly.** The comment said "a 23-value vector (numeric strings, booleans, `±Infinity`, …)" — plural categories with no multiplicities, so the count could not be rebuilt from the sentence beside it. Rebuilt as an explicit 25 inputs including `3000`, because a differential in which nothing is accepted proves nothing: each guard as written, and with only its `typeof` operand deleted, answered identically on all 25, same accept/reject and same message. The deletion in its direct form was then run against the whole suite — any one of the three operands out, and all three out together, leaves every test green — which is the other half of "six of those nine".
- **`environment.ts`'s envelope guard: the same treatment, and a collapse worth knowing.** "23 stored values spanning `null`, every JSON primitive, arrays, and an envelope with each field absent, null, boolean, a numeric string or `1e999`" became a rebuildable enumeration: 26 writes, **23 distinct documents**, because `1e999` is `Infinity` and `JSON.stringify` emits it as `null`, so each of those three rows stores the same bytes as its `null` twin. That is also why no non-finite `seq` can ever reach the `typeof` test, which is the fact the `1e999` row exists to check. The accept/drop vectors still match for both deletions; `null` is the one input whose *exit route* parts (guard-rejected vs thrown-and-caught), and the comment now says the vectors agree on delivery rather than implying they are identical everywhere.
- **`data-bus.ts`'s reopen gate: all four operands survive, and so does `tsc`.** Re-running each single-operand deletion at line 2113 left the whole suite green, as the note claimed — and each deletion also typechecks clean, which separates this guard from the `?? fallback` legs elsewhere in the file that only the compiler holds. Neither gate stands between those deletions and a merge; only the callee argument below them does.
- **Gates.** `pnpm check` 0, `pnpm lint` 0, `pnpm test:coverage` 0 with the ledger unchanged, `tests/documentation.test.ts` 18/18.

### Documentation

- **`AGENTS.md`: the void-probe rule's own counter was wrong.** Last cycle's rule said a mutation harness should assert its insertion count with `diff pristine mutant | grep -c '^>'`. That reads 0 for a pure deletion — which is most of what an operand-removal probe does — and following the recipe produced three `VOID — mutant not applied` reports for three mutants that had applied and were simply not adding a line. The counter belongs on `^[<>]`. The failure biases toward *surviving* mutants, i.e. gaps that never existed, which is the direction a reader acts on. A second rule added beside it covers the control-leg case above.

### Compatibility

No library code, export, frame, option, default or storage key changed; `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.29`. The one behavioural change is in `scripts/verify-published-consumer.mjs`, which is not part of the published package: a manual `pnpm verify:published` without `PUBLISHED_VERSION` now fails when the registry read disagrees with `package.json` instead of quietly verifying that other version. Pass the version explicitly to verify a release older than the tree.

## [0.21.29] - 2026-09-25

Every claim quoted in a shipped comment that this pass could re-run was re-run against the current suite, one mutant at a time. The `tsc` error counts and the kill sets held to the number written down; four claims had gone stale. The failures were all of one kind: a number that was true when it was measured and had since become false. No total of runs is quoted here, because a total of runs is the same class of claim as the ones being audited.

### Fixed

- **The IndexedDB settlement note counted four guards where the edit removes five.** Its comment said "the same latch in all four `invalidate`+`reject` closures" and "deleting all four latches leaves the suite green". There are four latch *variables* and five guarded closures, because `load()`'s `transaction.oncomplete` shares its latch with that block's `fail` — so the measured deletion is a five-statement edit. Re-run that way: all five guards out, 37 files green, connection count unchanged.
- **`CentrifugeSession`'s dependency citations named no installed line, and one of its own counts was off by one.** The sentence said the SDK's no-op `error` listener sits at `build/index.js:762` and that the bundled emitter's throw is at `:162`. Against the pinned `centrifuge@5.7.4` the guard is at 763-764, and in the `5.7.0` copy also present in the store it is at 748 — so the number matched neither, and whether it drifted or was mis-copied cannot be recovered from here. Both citations are now the dependency's own quoted comment text, which survives a reflow. In the same sentence "four statements later" named three; the anchor the sentence sets (the `error` removal) has exactly three statements before the re-installation, and the `BaseSubscription` range became its actual class body (667-2673), inside which the twelve `emit('error')` sites were counted rather than assumed.
- **A rotted test count and a host-specific timing, in three copies.** The `queueStartAfterStop()` note said its mutation "leaves `tests/data-bus.test.ts` 194/194 green"; the file is at 198, and re-running the mutation (replacing the `stopPromise` chain with `Promise.resolve()`) reproduced both halves — green in full, and `tests/lifecycle-invariants.test.ts` dying with `Ineffective mark-compacts near heap limit` inside `Builtins_RunMicrotasks`. That crash came at **26.8 s** of worker life here rather than the recorded ~40 s, so all three places that told the story — the `src/` comment, the test's own header note, and the `AGENTS.md` bullet that cites it as guidance — now name the crash as the load-bearing half and the interval as host-dependent. The neighbouring four-way absorb measurement quoted `194/194` three times; its green legs now say "green in full" and the failing leg keeps its count with the file size it was taken against, since that one has not been re-run.
- **Two internal line citations replaced by the statements they meant.** `validation.ts` cited `routing.ts:64-70` for `effectiveWorkerLoad`'s `Number.isFinite` fallback, and `storage-batch.ts` cited `:99` for `flush()`'s gate drop. Both happened to still point roughly right, which is the problem: a correct-but-brittle citation reads as verified.

### Tests

- **None added or changed.** Every result below is a mutant run against the committed tree, each restored and checked byte-identical afterwards. Claims that **held**: `port-reaper`'s `touch()` early return and `reap()`'s non-null `??` fallback (green both ways); `centrifuge-session`'s empty-topic drop (green); `cluster`'s unconditional `clearInterval` and the null-handle tolerance behind it (green, and both adapters really do accept `null`); both dominated terms of the `stop()` entry guard (green each); `cluster`'s nil-owner guard (green, and `tsc` reports exactly the five errors at the three expressions named); `websocket`'s `handshakeCompleted` term (green); `trace`'s `metricsActive` term (fails precisely its two named tests, and `stopped` really is read in exactly two places); `centrifuge`'s double-arm guard (green, with `startHeartbeat()` reached only from `startSharedWorker()` and `clearHeartbeat()` only from `stop()` and `onWorkerFailed()`); and the three election `?? this.currentRecord` fallbacks, whose `tsc` counts came back **3, 2, 7** as quoted, with the suite green when all three go at once; and `validation.ts`'s six-of-nine enumeration — the two predicate legs of the positive guards die to 6 tests each, the three sign tests to 8, 9 and 3, and `assertNonNegativeFiniteNumber`'s predicate to exactly one named case, `rejects a negative or non-finite loadWeighting weight`, which is the leg this file singles out rather than rounding up.
- **One probe was void and had to be redone.** The first pass at those validator legs substituted the predicate text through an unquoted pattern, so `!Number.isSafeInteger(value)` matched nothing: three mutants were never applied and the suite answered 936 passed against an **unmodified** file. The runner printed `applied=0` for exactly those three, which is the only reason the gap was visible; re-run with a literal, line-targeted replacement, all six applied, and the counts above come from that run. A green run against a mutant that was never inserted is the same failure as a control that cannot fail, and it reads identically unless the insertion is checked.
- **Gates.** `pnpm check` 0 (936 tests / 37 files, 5/5 perf gates), `pnpm lint` 0, `pnpm test:coverage` 0 with the ledger at **46 zero-count arms of 1963** and aggregate 99.02 / 97.65 / 99.27 / 99.69, `tests/documentation.test.ts` 18/18. `git diff -U0 -- src/ tests/` with comment lines filtered returns nothing across the five `src/` files and the one test header.

### Documentation

- **`AGENTS.md`: pinning a dependency version is not the same as checking its lines.** The existing rule said a claim about another library must be verified in the installed package and pinned to a version; this release's citation was pinned *and* wrong, matching no copy in the store. So the rule now says to read the number off the installed file at the time of writing, and to prefer the dependency's own comment string as the locator — it is searchable, and a reflow does not invalidate it.
- **And a new mutation-testing rule: a mutant that was never inserted reports as a surviving mutant.** The void probe above is the mirror of the existing "diff the mutant itself before believing what it kills" — there the diff was too large, here it was empty, and both look like a result. A harness that runs several mutants must print and assert its insertion count before the suite runs, and treat `applied=0` as a void leg rather than a green one.

### Compatibility

Comment-only. No export, frame, option, default or storage key moved; `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.28`.

## [0.21.28] - 2026-09-25

Four shipped sentences re-read against the code, and three measurements taken again rather than carried forward. Two of the four were wrong; one was right but unreadable, and one was right in its conclusion and wrong in the count it quoted to support it.

### Fixed

- **`reopenTransport()`'s early-return arm does not hold "the only handler this opening ever gets".** The note also claimed it "is not dominated by anything: it is the handler". Five sites call this method, and three of them (`startDemandRecovery()`, `updateStatus()`'s recovery-timer arm, `runTransport()`) chain their own `opening.then(f, g)` onto the promise this returns — the *same* object, so their `g` is already a handler of `opening` by Promise semantics and this `.catch` decides nothing on those paths. `start()` returns it to its own caller. Only `resumeTransport()`'s `void` call is the case the absorb exists for, and the note now says exactly that. It also records the symmetric mutation: deleting **this** line leaves all 37 test files green with zero unhandled-rejection reports, and so does deleting the `.catch` at the top of the method, because no test constructs a rejection on the `void` path. What separates the two absorbs is the caller list, not a test — an enumeration, not a pin.
- **`ClusterEnvironment.now` was documented as having a monotonic alternative it does not have.** The field said "the injected clock is the only monotonic one in the picture". There is no monotonic clock in the picture: `createBrowserEnvironment` binds the field straight to `Date.now`, and `performance.now()`/`hrtime` are read nowhere in `src/`. Nor is the injected clock monotonic by contract — it is a bare `() => number`, and a whole-suite census of every clock the tests inject found one that steps **backwards** on purpose (`tests/trace.test.ts`'s "keeps counting a measurable dispatch whose clock ran backwards"). What the sentence was reaching for is a property of the consumers, so it is now stated as one: `cluster.ts` is the field's only reader in `src/`, seven of its ten reads only stamp a record, and the three that subtract each fail their comparison on a backwards jump, so a record stamped before one reads as not-yet-expired until the clock climbs back past its stamp.
- **The `runTransport()` guard's census rows were never decodable.** The note quoted `1000`, `0000`, `0100`, `1001` and `1010` without saying what the four bits are, so no reader could check any of them. The encoding is now stated (the four premises in source order), the row set was re-derived with a first-sight `console.log` over one whole-suite run — **same five rows** — and the `1001` row's stack is now named rather than paraphrased: `handoffAssignedTopics()` → `onControl` → `unsubscribeTransport()`.
- **`ReapTarget`'s ordering note said a port is a chance.** "A port that is about to be closed is the only chance its owner gets to learn why" restated `reap()`'s measured reasoning and lost the grammar on the way. It now names the three steps, the order, why `notify` must go first, and what the shared `try`/`catch` costs — a target that throws in `notify` also skips `close` and `stop` for itself.

### Tests

- **None added or changed.** `pnpm check` 0 (936 tests, 37 files, 5/5 perf gates), `pnpm lint` 0, `pnpm test:coverage` 0 with **46** zero-count branch arms of **1963** and aggregate 99.02 / 97.65 / 99.27 / 99.69 — the same distribution as `0.21.27`, which is the control that says this diff contains no code. `git diff -U0 src/` with comment lines filtered returns nothing.
- **Two operand mutants re-run, and one count had rotted.** Deleting `droppedAfterConnect` fails exactly the two named tests, as the note claimed. Deleting `transportReady` fails **nine** (6 in `data-bus.test.ts`, 3 in `centrifuge.test.ts`), where the note said eight — and because the eight were never named, the newcomer cannot be identified. The comment now gives both numbers as "run the mutant" rather than as limits.

### Documentation

- **`AGENTS.md` grew from these two findings**: a row/flag vector is worth nothing until the comment says what its positions mean, and a kill count quoted without the list behind it cannot be re-attributed when it drifts.
- **Nothing consumer-facing moved**, so no `docs/` page was rewritten. All four corrections sit in maintainer-facing comments about internal methods. Two of them are class-member/interface JSDoc (`ClusterEnvironment.now`, `ReapTarget`), so they do reach the published `.d.ts`; the other two are statement-slot comments inside method bodies, which reach the package only through the published `.js.map` embedded sources — the split this repository measured in `0.21.27`.

### Compatibility

Comment-only. No export, frame, option, default or storage key moved; `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.27`.

## [0.21.27] - 2026-09-25

Three shipped sentences about lifecycle windows were re-checked against the code and the runner: one held and is now backed by a measurement, one was false about *why* the code is safe, and one quoted a number that had already rotted.

### Fixed

- **`reconcile()`'s REGISTRY leg was unreachable for a different reason than its comment gave.** The note said the span between `pause()` clearing `started` and `pause()` removing the message listener holds "a boolean assignment and two `heartbeatHandle` writes, with no call that can hand the stack to consumer code". The middle of those three statements is `this.environment.clearInterval(this.heartbeatHandle)` — a call into adapter code, which this same file's `activate()` comment treats as consumer-supplied and untrusted. So the absence of calls was never what closed the window; the `if (!this.started) return` guard at the top of `reconcile()` is. The comment now says that, which also strengthens the case for keeping a guard that the old phrasing made look redundant.
- **The activation window's provenance is measured rather than argued.** `pause()`'s null-`heartbeatHandle` branch is a covered arm whose *origin* was a claim: that only the two "abandons activation…" tests reach it. Instrumenting the branch and running the whole suite printed exactly two lines and no third — one from the adapter's `createChannel`, one from the storage-less self-SUBSCRIBE's `handlers.onControl` — and the two test names are now quoted at the site, so a third origin is something a future reader can notice rather than something they have to re-derive.
- **A quoted call count became a lookup.** `reopenTransport()`'s note had carried "0 of 5041 calls" since `b0354e4`; the same function count on this tree reads 5046. The number was only ever there to say *hot method, cold arms*, and that reading survives any drift — which is precisely why a stale figure is dangerous: it looks like evidence. The sentence now names where to take the count from instead of preserving one.

### Tests

- **None added or changed, and the ledger is quoted rather than assumed.** `pnpm check` 0 with **936** tests and 5/5 perf gates, `pnpm lint` 0, `pnpm test:coverage` 0 with **46** zero-count branch arms of **1963** and aggregate 99.02 / 97.65 / 99.27 / 99.69 — unchanged, as it must be for a diff that contains no code. `git diff -U0 src/` with every comment line filtered out returns nothing.

### Documentation

- **`AGENTS.md` gained the decay rule for quoted numbers.** A count in a comment contradicts nothing when it drifts, so either name the lookup that re-derives it or drop the figure; the pair that carries the argument (this leg runs thousands of times, these arms read zero) is the part worth keeping. This is the same failure mode as quoting a sweep total as a per-seed cost — the reader cannot tell a stale measurement from a current one, and a stale one calibrates them.
- **And the shipped-surface rule got its position half, measured rather than inherited.** The existing note says a src comment ships through the declarations *and* the JS, which is true in aggregate and misleading per sentence: this release's three corrections all sit in **statement slots inside method bodies**, and grepping one built tree shows they reach the published package only through the `.js.map` files' embedded sources (`files: ["dist"]` does publish those). A **class-member JSDoc** — `0.21.26`'s `stop()` note is the control — does appear in `dist/core/replay-manager.d.ts`, in the shared ESM chunk and in both CJS bundles. The control that keeps this from reading as a regression is a comment that predates both releases: `cluster.ts`'s "Order matters: release local subscriptions…" is equally absent from the bundles. So "does this comment ship?" is asked per artifact — what a consumer's editor shows, what a sourcemap step recovers, what a bundle read surfaces — not once for the tree.
- **Nothing consumer-facing moved**, so no `docs/` page was rewritten: these are maintainer-facing comments about internal methods, corrected in place.

### Compatibility

Comment-only. No export, frame, option, default or storage key moved; `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.26`.

## [0.21.26] - 2026-09-25

One false sentence about who cancels a persistence retry, corrected everywhere it had been written — found by an audit pass whose own scheduling step was wrong, which is the part worth reading.

### Fixed

- **`retryGeneration` has exactly one writer, and it is not `stop()`.** Four comments in `replay-manager.ts` described the cancellation generation as bumped "on suspend/stop". This class defines *both* of those methods, and only `suspend()` increments the field — `stop()` clears the retention-sweep timer and cancels nothing in flight. A maintainer auditing "what supersedes an in-flight retry" who read `stop()` first would have found no bump and had to conclude either that the comment was right and the code was broken, or that the pair meant something else. `ReplayManager` appears nowhere in the barrel, so no consumer can reach the wrong model; the class's own callers can, and `stop()`'s only caller in `src/` is `suspend()`.
- **The half that was true is now stated at the level it is true at.** `CrossTabDataBus` has no `suspend()` method at all: it reaches the bump from two sites, the cluster's `onSuspend` handler and `beginStop()`. So a hidden *tab* and a stopped *bus* both do cancel their queued durable appends — through `ReplayManager.suspend()` — and that is exactly why the shorthand stayed plausible: the test that covers the behavior is named "cancels a pending persistence retry when the bus stops", and it passes whatever this class's `stop()` does. Nor was the sentence a stale remnant of code that once behaved that way — checked against `0cb8572`, the commit that split this file out, `stop()` has never touched the field; the pair has been false since the day it was written.
- **One corrected claim about the corrected claims, caught before it shipped.** The pass began with a scan that decided which zero-count branch arms still lacked a verdict at their site by reading the line above each one. It reported 21 unvisited legs on a ledger of 46 in which **every** arm already carries one, because those verdicts run five to fifteen lines and state the measurement that closes the arm. Reading the reported sites with a window is what turned the pass into a one-defect pass instead of a re-do of closed work.

### Tests

- **None added, and that is the honest classification.** Nothing here moves behavior: the diff is comment lines only (`git diff -U0 src/` with every non-comment line filtered out returns nothing), the suite is unchanged at 936 tests, the perf gates at 5/5, and the branch-arm ledger at **46 zero-count arms of 1963** with aggregate 99.02 / 97.65 / 99.27 / 99.69 — byte-identical to `0.21.25`'s. A test asserting that `ReplayManager.stop()` cancels nothing would characterize an internal method with one caller rather than pin a contract, and this repository's rule is to name that difference instead of banking the green.

### Documentation

- **`AGENTS.md` gained the scoping rule.** A scan is a probe, so it needs the control the probe rules already demand: run it on a site you know is answered and check it reports "present" before its output becomes a task list — a scan that cannot distinguish *absent* from *not looked at* schedules rework over closed ground, and that rework looks like progress. The second half of the rule is the pair-shorthand itself: when a comment names two methods as doing the same thing, check each name in the class that owns the thing, because the pair can be accurate about callers and false about callees while every test passes.
- **The shipped surface for a comment is wider than the declarations.** Verified rather than assumed: the corrected sentences appear in `dist/core/replay-manager.d.ts`, in the ESM chunk `dist/chunk-WKOCDMCH.js`, and in both CJS bundles (`dist/cjs/index.cjs`, `dist/cjs/centrifuge.cjs`) — esbuild preserves comments in the JS, and all of those paths are in `package.json` `files`.

### Compatibility

Comment-only. No export, frame, option, default or storage key moved; `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.25`.

## [0.21.25] - 2026-09-25

A publication's fan-out set is now fixed when its delivery begins, which closes a shape that did not terminate: a handler that registers a fresh closure for its own topic made the message that triggered the registration keep delivering to the handlers it created.

### Fixed

- **`dispatch()` collects before it invokes.** Handler lists are held in a `Set` per topic, and `Set` iteration visits entries appended after the cursor while skipping entries deleted before it, so both directions of mutation were observable inside one delivery: a handler that subscribed another one for the same topic received the message that caused the subscription, and a handler that unsubscribed a later one cut it out of a delivery already in flight (measured: a two-handler topic delivered `['first']`). The first half does not terminate and did not need a hostile application to reach — the ordinary "re-arm this one-shot handler on every message" pattern, which registers a *new* closure each time, ran **500 handlers for a single publication** (that number is the probe's own ceiling, not a bound the library imposed) and the next publication delivered to **999**, because the registrations persist. Re-subscribing the *same* function reference is a no-op by `Set` identity, which is why the shape survived every prior pass over this file: the first probe written for it used a named function and measured one invocation.
- **What the contract is now.** Both passes — the exact-topic handlers and the handlers of every matching wildcard pattern — are collected before the first handler runs, so a message is delivered to the subscribers that existed when its delivery began, and a late `unsubscribe()` takes effect on the next publication instead of mid-message.

### Tests

- **Three cases, and each one's failure message is the measurement.** `delivers a publication to the handlers that existed when its delivery began` fails as `expected 500 to be 1` against the previous code, `keeps a handler in a delivery that another handler already started` as `expected [ 'first' ] to deeply equal [ 'first', 'second' ]`, and `does not deliver a publication to a wildcard subscription made during it` as `expected [ 'exact', 'pattern' ] to deeply equal [ 'exact' ]`. The first is written with an explicit ceiling so a regression reports a count rather than hanging the runner. All three pass against the fix, and the 933 tests that already existed are unchanged by it — no prior test depended on mutating the fan-out mid-delivery.
- **The hot path was sized, not assumed.** The five `tests/perf-gate.test.ts` gates cover hashing, owner selection and pattern matching, not dispatch, so the snapshot was measured directly: best-of-seven over 200k iterations, **9-23 ns per dispatch** for 1-20 handlers and **+15 ns** for a matching wildcard pattern holding two handlers, against a shipped per-message budget in the tens of microseconds. Coverage did not move — 46 zero-count branch arms of 1963, aggregate 99.02 / 97.65 / 99.27 / 99.69 — because both arms of every branch added here were already exercised. Tests 933 → 936.

### Documentation

- **`docs/api.md` and its Chinese mirror each gained one bullet** stating the delivery-set contract in the `subscribe()` list, so the rule is visible where a consumer reads it rather than only in the source.

### Compatibility

Delivery to a handler registered *during* a dispatch, and cancellation of a handler unsubscribed *during* one, both change: those handlers no longer see the in-flight message, and that handler does. A consumer relying on either needed the pattern this fix stops (a self-growing fan-out), and no shipped default, frame, storage key, export or option moved. `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.24`.

## [0.21.24] - 2026-09-25

Two lifecycle defects that the coverage ledger handed over as a by-product: a cluster runtime stopped during its own activation rebuilt everything its teardown had removed, and a `stop()` issued from one of its callbacks was dropped on the floor. A verdict now sits at every zero-count site the ledger had left bare.

### Fixed

- **A teardown arriving during activation abandons the rest of it.** `activate()` sets `started = true` and only then reaches consumer code — the environment adapter's `createChannel`, and `handlers.onControl` for a self-addressed SUBSCRIBE when storage is unavailable — before it arms its heartbeat. A `stop()` or pagehide landing in that span had already run `pause()`, so the remaining lines rebuilt exactly what it removed: the runtime kept a live channel with its listener attached, was written back into storage as a worker record no peer would ever TTL-prune, armed an interval no later `stop()` could clear (every leaked tick re-registered the departed tab), and accepted a `CONTROL/SUBSCRIBE` frame addressed to it after the stop. All four were measured on the unmodified tree, and each half of the rollback now dies to its own named assertion.
- **A `stop()` issued from `handlers.onResume` takes effect.** `handlePageShow()` clears `suspended` on the statement before it calls that callback, and `started` is set only by the `activate()` its own generation bump then skips, so both of `stop()`'s entry flags read false while consumer code was running: the teardown was dropped, the lifecycle listeners stayed attached, and the next hide/show pair re-fired `onResume` and put `coordinated` back to true. The guard's third term is `lifecycleListening`, which is what "something is still attached" actually means here.

### Tests

- **Three cases, one per symptom, and a census to tell the rest from unreachability.** Two new `cluster.test.ts` tests construct the activation window from the two seams that open it (a channel adapter that stops the runtime, a control handler that stops the runtime) and assert the abandoned activation leaves no registration, no heartbeat and no live listener; the third stops the runtime from inside `onResume` and asserts a later visibility toggle fires nothing. For the arms that stayed zero-count the method from `0.21.23` was reused: a flag-vector census over one full suite run (four distinct `pause()` vectors, one each for `activate()`'s entry and the listener removal, two for `reconcile()` and `writeRoute()` — every one of them reading the flag false *somewhere*, which is the control on the rows that never do), plus a `tsc --noEmit` measurement for each leg whose deadness is a type question rather than a reach question: one error apiece for `resolvePublishTarget`'s `?? this.workerId`, for `writeRoute`'s storage guard (reported on the very next statement), and for each of the four projected-load reads, and five for the handoff's `if (!owner) continue` — the count the comment at that site has been claiming, re-measured against this tree rather than inherited.
- **The ledger moved for the first time in six phases: 47 \u2192 46 zero-count branch arms**, denominator 1958 \u2192 1963, aggregate 99.02 / 97.59 \u2192 **97.65** / 99.27 / 99.69, tests 930 \u2192 933. One arm (`pause()`'s clear-the-interval false leg) became reachable-and-covered because of the fix, and every new branch the fix introduced is exercised on both sides.
- **Two terms of `stop()`'s guard are dominated by the new one, and stay.** Deleting `!started` alone or `!suspended` alone leaves the suite green at its full count, because each implies `lifecycleListening`. They are kept on an asymmetry: a redundant term in a disjunction costs one boolean test, while a missing one drops a teardown silently — which is the bug this release fixes.

### Documentation

- **Thirteen verdicts written at their sites, and one shipped enumeration corrected.** Every remaining zero-count arm in `cluster.ts` now carries what decides it: the caller enumeration for `writeRoute()`'s storage guard (with the contrast that makes its twin `writeSubscriber()` covered — one unconditional call site), `routeOwnerIsLive()`'s own conjunct for the publish-target fallback, the Map seeding for the two handoff projected-load reads (the only difference from their covered twins in `reconcileSubscriptions()`), and the three-flag invariant stated once, at `stop()`, with the other two sites pointing at it. One of those sites described a `?? this.currentRecord` fallback in the method whose comment it was — that election has no such fallback; the three are `subscribe()`'s and the two in `reconcileSubscriptions()` — and the list is now named by owning method.
- **A consumer-visible contract was added to `docs/api.md` and its Chinese mirror**: `stop()` is effective from inside any synchronous callback of `WorkerClusterRuntime`, and an abandoned activation leaves nothing registered. One repository rule went into `AGENTS.md`: a verdict of "no caller can bring the premise" must be re-checked against the consumer code the enclosing method itself calls, because in both defects found this way the caller list was correct and the re-entry was inside the audited method.

### Compatibility

No frame, storage key, default, export or option moved. The behavior change is only observable to a consumer that stops a cluster runtime from inside one of its own callbacks or its adapter's `createChannel`, and it changes that case from "the stop is dropped and the tab revives" to "the stop takes effect" — mixed-version peers see a well-behaved peer either way. `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.23`.

## [0.21.23] - 2026-09-24

A sixteen-mutant sweep of the last multi-term guards in the repository, one behavior that no test had ever named, and a comment that existed to justify an otherwise dead operand replaced by a lint gate that refuses the edit for real.

### Tests

- **One live gap in sixteen operands.** Every four-term state chain in `data-bus.ts` was measured one deletion at a time against the whole suite: `stop()`'s "nothing to tear down" early return, the recovery-timer callback gate, `runTransport()`'s ready shortcut, and the demand reopen under it. Four of the sixteen were already pinned by a named test, eleven are closed by construction, and exactly one — `!this.stopping` on the ready shortcut — was live and unnamed. `sends no unsubscribe to a transport while the bus is stopping` pins it now, and dies to that mutant alone.
- **How the guard was found is the reusable part.** For a state guard there is no input vector to differential, so the operands were classified with a *flag-vector census*: instrument the guard, record the operand fields at every evaluation, run the suite once, and compare the observed rows against the single assignment each surviving operand needs to be the decider (7589 recorded `stop()` calls over seven vectors; 49 timer-callback entries over two). Where a premise row did occur but its deletion still passed, printing a short stack on first sight named the *production path* reaching the guard — `unsubscribeTransport()` ← a control frame ← `WorkerClusterRuntime.stop()`'s handoff — which is what turned a surviving mutant into a test. The construction needed a second tab: with no remaining subscriber the handoff removes the route instead of posting a frame, and the single-tab version of the test passed against its own mutation.
- **Two closure mechanisms that had not met this repository before.** A leg can be dominated by the *function it calls* rather than by a neighbouring operand: three of the demand reopen's four legs restate guards `reopenTransport()` performs first, so deleting one assigns the caller the same promise it would have received. And a leg can have a premise that genuinely exists for the length of every `start()` and still be unobservable, because no caller boundary falls inside it — `stop()`'s `!this.started` is that case, and the same invariant is already written down at `reopenTransport()`, in the one copy of two that had a comment.
- **Two tests were written, measured, and deleted.** A draft aimed at the `status !== ERROR` leg and an early single-tab version of the unsubscribe test both passed against the mutation they were written for: the first parked its operation behind the recovery gate, which pre-empts the guard a few lines earlier; the second never reached the guard at all. Neither is in the suite; the verdicts that replaced them say "no route found, held against this branch being relaxed" instead of claiming unreachability.

### Quality gates

- **`no-restricted-globals` now refuses `isFinite` and `isNaN`.** The three `typeof value !== 'number'` operands in `src/utils/validation.ts` cannot decide anything for any input, and the only reason recorded for keeping one was that it catches a specific edit — writing the coercing global `isFinite(value)` where `Number.isFinite(value)` was — which nothing refused. A leg justified by a forbidden edit should have a gate refusing the edit, so the rule was added, and then *proved to have teeth* by introducing the swap: `pnpm lint` reports it at the call. The clean tree has zero findings, because no bare `isFinite(`/`isNaN(` call exists anywhere in `src/`, `tests/` or `scripts/`.
- **Which meant the claim had to be hunted down.** Two live copies said the rule does not exist — the validator's own paragraph and the `AGENTS.md` bullet citing this measurement — and both now state that the operand is defended twice, and which removal each defence covers. Five historical `docs/progress.md` mentions were left as written, with the new entry as the pointer.

### Documentation

- **Three repository rules.** Measure a *state* guard with a flag-vector census plus the assignment enumeration, and use a stack on first sight of a premise row to find the path that reaches it; a cannot-decide leg whose justification is a forbidden edit should end up with a gate in front of the edit, not only a comment; and name which of "no test reaches it" and "it cannot be reached" a verdict actually establishes, because the first is a coverage statement and the second is a claim about the state machine.
- **Ledger:** **47** zero-count branch arms of **1958** at both ends of all three phases, aggregate **99.02 / 97.59 / 99.27 / 99.69**, tests 929 → 930. Every operand probed is evaluated on every call, so no coverage total could have pointed at the gap this release closed — the sixth consecutive phase to make that argument by measurement rather than by assertion.

### Compatibility

Mixed-version peers are unaffected: no frame, default, storage key, export or behavior moved. The pinned behavior is one the code already had and no test named; the lint rule is repository-local and reaches consumers only as comment text in the declarations and the bundles. `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.22`.

## [0.21.22] - 2026-09-24

Six phases of one method, applied to every multi-term guard the previous scan ranked: delete a single operand, run the whole suite, and ask which of three answers that mutant produced. Nine behaviors that no test named are now named, five operands are closed as incapable of deciding anything, and the coverage ledger did not move once — which is the finding, not a shortfall.

### Tests

- **Nine newly pinned operands.** Measured one deletion at a time across six guards: three staleness terms in `websocket.ts`'s socket listeners (each now dies to its own new case), two of `trace.ts`'s four-term activity check (`received > 0 || dispatched > 0 || dedupAccepted > 0 || dedupSuppressed > 0`, where the one existing test raised *both* dedup counters in one window, so whichever operand survived still emitted), two operands of the `storage-event` frame envelope (three labelled writes now exercise an absent `seq`, a `seq` that is the numeric string `"1"`, and an absent `message` separately), and two option legs of `DedupManager.start()`'s sweep gate, whose own doc had long stated "no-op when disabled or no `sweepMs` was configured" without either leg being verified. Tests 923 → 929.
- **Why none of that showed up as coverage.** Every operand probed is evaluated on every call, so no line count, branch arm or function total distinguishes "runs" from "decides". `src/` stays at **47** zero-count branch arms through all six phases — 99.02 / 97.59 / 99.27 / 99.69 — and the only movement in the ledger is the denominator, 1962 → 1958, from the two dominated operands deleted below. The arm ledger cannot find this class; a whole-suite mutant can.
- **Five operands closed as incapable of deciding, by differential rather than by argument.** Two in the storage envelope (`typeof parsed !== 'object'` is never first, and `!parsed`'s rejection is absorbed by the same `catch` that would report it) and all three `typeof value !== 'number'` tests in `validation.ts` (`Number.isSafeInteger` and `Number.isFinite` reject a non-number without coercing, so any value reaching the first operand reaches the second with the same message). Each was proven with a fixed input vector — 23 stored payloads, and 23 values × 3 validators × 4 variants — that produced a byte-identical accept/reject-and-message result for the guard as written and for each mutant.
- **A kept leg's justification was then tested in both directions.** The `typeof` operand stays because of one specific easy edit, so that edit was constructed: write the coercing global `isFinite(value)` where `Number.isFinite(value)` was, which no lint rule forbids. With the operand in place the swap kills nothing; with the operand also deleted, `heartbeatIntervalMs: '3000'` becomes an accepted option and `rejects a non-positive or non-finite heartbeatIntervalMs` reddens.
- **One clean bill, and one thin pin named as such.** `ReplayManager.start()`'s four-term gate turned out to have every operand already pinned by exactly the test `DedupManager` lacked — parity between two managers of the same construct, checked rather than assumed. And of the six `validation.ts` deletions that die, five die to several cases while `assertNonNegativeFiniteNumber`'s predicate leg dies to exactly one; that one feeds `NaN` and `Infinity`, so it is thin in count and correct in kind, and the asymmetry is recorded at the site instead of being smoothed into "six of nine".

### Documentation

- **Two dominated operands deleted, and the guard's own comment rewritten against the counter-evidence.** `getMetrics()` and `flush()` each appended `|| this.stopped` to a condition whose first operand had just evaluated a term containing `!this.stopped`; such a read cannot be the decider, and it was silently *absorbing* the mutation that would have proved the getter's contract. Deleted, with both kill sets recorded: with the repeats in place, removing the getter's term left all 37 test files green; with them gone, the same deletion fails two.
- **Enumerations and numbers re-read against what they count.** The `getMetrics` case whose name promises all three inactive causes asserted two of them, and the getter's JSDoc enumeration was rewritten to name each (disabled, stopped, events-only); the async-hub cost of raising fuzz delivery to browser-realistic timing was restated in `AGENTS.md` at "~16 tests" where the measurement is 18 (16 post-and-assert cases plus 2 of the hub's own delivery pins); and `version.ts`'s header claimed source-level consumers "get the same value via the vitest `define`" while its own next clause admitted `tsc` sees no value at all — `pnpm typecheck` is `tsc --noEmit`, which evaluates no code, so the drift it feared has an owner (`scripts/verify-release-version.mjs` refuses a tag that is not `v` plus `package.json`'s field) rather than a compiler. Every claim now names the artifact that would show it, and the three shipped comment rules added this release are about the shapes that went wrong: a redundant re-read is load-bearing in the wrong direction, measure a disjunction operand by operand, and a surviving mutant means something different depending on whether a fixed input vector can distinguish it.
- **The comment-only claim was proven, not asserted.** Each prose change was emitted through esbuild and compared against the previous revision at both ends of the position rule this release also documented: identical with comment lines stripped, and identical raw where — as in `validation.ts` — every added block is a declaration header, the position esbuild drops. The first version of that proof reported a false difference, because a comment in *expression* position does survive into the bundle.

### Compatibility

Mixed-version peers are unaffected: no frame, default, storage key, export or behavior moved. The two deleted `trace.ts` operands are provably consequence-free — the same expression reads the field synchronously on their left, so no input can distinguish them, and the two tests above are the evidence. Consumer-visible differences are comment text, which reaches them through both the declarations and the bundles. `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.21`.

## [0.21.21] - 2026-09-24

One branch arm closed by a call that had never been made, three shipped comment claims retracted against the code they describe, and a repository rule about the difference between a guard nobody can pin and a guard nobody has pinned.

### Tests

- **`queueStartAfterStop()`'s no-gate fallback had never run.** `this.stopPromise ?? Promise.resolve()` is reached with `stopPromise` null only by a *failed initial open*, whose teardown belongs to `pendingStop` instead — and nothing reachable through a browser re-enters `start()` inside that window, because the only synchronous application-code seam there is the caller's own `ClusterEnvironment` port. The new case drives that seam (a storage write that calls back into the bus) and closes one of `src/`'s 48 zero-count branch arms; `data-bus.ts` goes 12 → 11, and aggregate branches 97.55 → 97.60. What gives the test teeth is not the expression it was written for: routing `start()` on the gate instead of the flag (`if (this.stopping)` → `if (this.stopPromise)`) reddens it, while the fallback operand itself is provably consequence-free, because `start()` chains the reopen behind `pendingStop` regardless.
- **A second test was written, measured, and deleted.** A case that queued a restart behind a transport whose `stop()` was held open passed under all four single-leg mutations tried, so it pinned nothing: a bounded number of awaited microtasks cannot observe a wait whose wakeup needs the timer queue. Its zero kill rate is recorded at the site instead, next to the measurement of what the guard actually does — deleting the read turns one deferral into a microtask busy-wait that starves its own wakeup, which the suite reports as an out-of-memory worker abort in the lifecycle fuzz rather than as a failed assertion.

### Documentation

- **Three comment claims re-read against the code, and all three were wrong.** `subscribe()`'s note described the `?? this.currentRecord` fallbacks as "the identical pair" where the file holds three (the third — the stale-handoff re-election — carried no site text at all, so it had been quietly re-hunted by every coverage pass); `reopenTransport()`'s note quoted a mutation result ("fails exactly one test, with the guard present or deleted") that reproduces under none of four experiments now run in its place; and of the eleven `:NNN` citations pointing into this repository's own files, **six were wrong and one imprecise**, including two that had drifted *inside another comment*. Every one now names a symbol or a condition instead of a position, and the numbers that were measured — three, two and seven `tsc` rejections for the three fallbacks, 194/194 and 51-of-194 for the absorb — are what the text carries.
- **The verification that a prose sweep touched no code.** `npx esbuild --loader=ts` over each changed file at both revisions, then `cmp`: identical emitted JavaScript for all five files. That is a stronger statement than counting which diff lines begin with `//`, and it costs one loop.
- **Two `AGENTS.md` rules.** A guard whose deletion changes *when* work happens rather than *what* it produces cannot be pinned by a bounded assertion — name the fuzz as the witness at the site instead of adding a test that looks like coverage. And a line-number citation in a comment decays on every edit above it, silently, so cite the symbol; keep a number only where no name exists, and pin it to a dependency version there.

### Compatibility

Mixed-version peers are unaffected: no frame, default, storage key, export or behavior moved, and the only consumer-visible difference is comment text, which reaches them through both the declarations and the bundles. `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.20`.

## [0.21.20] - 2026-09-24

Six uncovered branch arms closed by calls no test had ever made, one shipped sentence corrected, and the coverage ledger given a third tier — the kind a compiler, not a test, owns.

### Tests

- **The string overload of `publish()` had never been called.** `WorkerClusterRuntime.publish` declares `(topic, data, messageId: string)` alongside the metadata form, and the normalization at the top of the method is the only thing that turns it into the object every downstream reader expects. `CrossTabDataBus.publish` always hands over an object, so nothing reachable *through the bus* can take that arm — and no test had called the runtime directly with a string, even though `docs/api.md` points callers who coordinate straight at the cluster there.
- **A single-item `publishBatch` whose item carries partial or no metadata.** Every existing case supplied both `messageId` and `timestamp`, so the `… || …` test, its `: undefined` fallback, and both conditional spreads had each only ever been evaluated one way. The absent-metadata case is the one with a consequence: `sendControl` calls the handler with **three** arguments when the metadata is falsy and five otherwise, and that arity is what separates "arrived without an id" from "arrived with an id of `undefined`". The two partial shapes are now covered and have no assertion of their own — recorded as such, because the receiving side re-normalizes with `metadata?.x === undefined ? {} : …`, so an omitted key and an `undefined` value produce the same wire frame.
- **`clusterKey: ''` is a namespace alias, and it is now pinned on both sides.** The namespace is `createOpaqueKey(options.clusterKey || '__default__')`, so an empty key hashes the literal `'__default__'` rather than naming its own cluster. Two runtimes on one storage and channel, keyed `''` and `'__default__'`, now have to leave exactly one owner for a shared topic, and a third runtime on another key owns its own copy — which is the half that fails if the fallback ever widens past the empty string.

### Documentation

- **`clusterKey`'s shipped JSDoc said different keys "operate in isolation" without naming that pair** — an absolute about behavior, reaching consumers through both the declarations and the bundles. The exception is now stated where the option is declared, and in `AGENTS.md`.
- **A third tier in the uncovered-arm ledger, in `AGENTS.md`.** With `noUncheckedIndexedAccess` on, an index read is `T | undefined` whether or not a hole is reachable, so a `?? fallback` that satisfies an assignment can neither run nor be deleted; `exactOptionalPropertyTypes` produces the same tier from the other side, where the always-present form of a conditional spread is a `TS2769` while the whole suite stays green. Both were established by **deleting the fallback and running `tsc`** per arm, which is the procedure the rule prescribes: in the route-write block it separated five compiler-held legs from one (`(previous?.generation ?? 0)`) that compiles bare and is therefore dominated by a filter three lines above rather than by its own expression.

### Compatibility

Mixed-version peers are unaffected: no frame, default, storage key, or export moved, and no behavior changed — the empty-`clusterKey` alias is documented as it already was, because moving `''` into its own namespace would silently relocate storage for anyone passing an empty key today. `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.19`.

## [0.21.19] - 2026-09-24

One behavior fix in the trace reporter, two test pins that each close a leg no test named, and the last unclassified uncovered-branch legs outside the two large modules written up at their sites.

### Fixed

- **A non-finite reading of the public `trace.now()` clock no longer blanks a metrics window.** `recordDispatched()` counted every dispatch that had a matching receive as a latency sample, and the `Math.max(0, …)` it used was added for a *backwards* clock — which `Math.max` clamps — while `NaN` passes straight through it, because `Math.max` returns `NaN` for any `NaN` argument. So the sample count rose while the bucket write landed on the non-index property `"NaN"`, which no percentile walk can reach (it iterates `0 … buckets.length - 1`). Measured on the unmodified reporter with one 50 ms sample and one NaN-delay sample: `dispatchSamples: 2`, `dispatchAvgMs: NaN` — which `JSON.stringify` renders as `null`, so the field disappears rather than reading wrong — and `dispatchP95Ms`/`dispatchMaxMs` pinned at the histogram ceiling because the rank exceeds the sum of every reachable bucket, while `dispatchP50Ms` still printed a plausible number. A dispatch whose delay cannot be computed now records **no** latency sample, on the same terms as a dispatch with no matching receive; `received`, `dispatched` and `topics` still count it, and a negative delay is still clamped to 0 because that pair is a real measurement in the wrong order. Both non-finite kinds (`NaN` and `±Infinity`) drop the sample.

### Tests

- **`ReplayManager.clearAll()` and `clearBefore()` on a persistence adapter that does not implement the method.** Both operations put their durable call behind an optional-method check, and `DataBusReplayPersistence` declares both methods optional, so a `load`/`append`-only adapter is legal — while every existing case either injected a full adapter or issued one `clearBefore` per lifecycle, so neither "no durable operation" leg had ever executed. The `clearAll` case asserts the local clear succeeds *without* reporting a persistence error (degrading the check to `this.persistence` turns an operation that had nothing durable to do into a `TypeError` after the retry budget — a caller-visible failure of a success). The `clearBefore` case asserts the **newest** cutoff wins over an earlier one when nothing prunes durably, which is where the filter over `load()`'s result is the only enforcement of a cutoff the caller already asked for.

### Documentation

- **Six uncovered-branch legs now say at the site why they read 0**, so a coverage pass stops re-hunting them: `websocket.ts`'s `connectPromise ?? undefined` (excluded by the field's whole write set — both assignments sit in the same frame as the premise fields the reuse gate reads), `replay-persistence.ts`'s `dbPromise === pending` fall-through (no writer fits between a rejection and the first reaction registered on that promise), `port-reaper.ts`'s null-handle arm (unreachable, not merely unreached: every `schedule()` caller is gated on a tracked port, and the only statement that nulls the handle without emptying the maps is that branch itself), and three `invalidate`+`reject` latches in `clear`/`clearTopic`/`clearBefore` that now point at the enumeration which already covered all four of them but sat only in `load()`.
- **A third tier in the coverage ledger, in `AGENTS.md`.** With `noUncheckedIndexedAccess` on, an index read is `T | undefined` whether or not a hole is reachable, so a `?? fallback` that satisfies an assignment can neither run nor be deleted. Measured on four legs: `latencyBuckets[i] += 1` and `seen += buckets[index] ?? 0` in `src/core/trace.ts` are `TS2532`, `return this.connectPromise` in `src/websocket.ts` and `export const SDK_VERSION: string = __SDK_VERSION__` in `src/core/version.ts` are `TS2322`. Before hunting an arm, write the bare field and run `pnpm typecheck` — a compiler error means the counter is reporting a type artifact. `src/core/trace.ts` and `src/core/version.ts` carry that statement at the sites.

### Compatibility

Mixed-version peers are unaffected: no frame, default, storage key, or export moved. `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.18`. The only consumer-visible difference is the fixed one above — a trace window whose clock misbehaves now reports finite numbers instead of a missing average.

## [0.21.18] - 2026-09-24

No behavior, public API, protocol, or storage change. This release carries five test pins that each close a leg no test named, one rewritten source comment that ships through the bundles, and two repository workflow rules.

### Tests

- **A non-string frame `type` is normalized to `null` before it is reported.** `getDiagnostics().protocol.lastUnknownMessageType` is declared `string | null` and is filled from a BroadcastChannel any same-origin script can post into. The `null` side of that normalization had never executed, and `getUnknownMessageStats()` had no reader at all — so the `unknownMessages` count published beside it had none either. Four forged frames now arrive through a channel joined *by name* rather than by calling the handler. The prototype-less-object frame is posted **first** on purpose: the failure it exists to catch is a throw (`String(Object.create(null))` raises `TypeError: Cannot convert object to primitive value`), and in any other order an earlier value mismatch hides it.
- **A `replay.persistenceRetry` block that names only one field applies the documented default to the other.** Each field is validated only when present and each default is supplied independently, so `{ maxAttempts: 2 }` must still wait the 50 ms backoff and `{ backoffMs: 5 }` must still make exactly one attempt. Previously every partial object the suite built threw at the field it named, so the validator's accept path for a partial policy had never completed. This gap was invisible from the defaulting sites' own counters — both `??` legs read hot, because a bus with no policy takes the right one and a bus with both takes the left; the untested shape was between them.
- **A failed handshake leaves no connect timer armed.** `failConnect()` cancels the attempt's connect timer before it rejects, and that cancel — not the callback's staleness guard — is what makes the guard unreachable. It had no test. Without it, the dead attempt's own timeout later reports `onStatus('error')` plus an `onError('WebSocket did not open within Nms.')` for a connection the application was already told had failed.
- **A `channelToken` credential request that names no channel is answered with an empty one.** `channel` is optional on the `TOKEN_REQUEST` wire shape and the session omits it when it is `undefined`, which is reachable from an older worker on the port or from a dependency handing the callback a non-string. The `?? ''` is the only thing keeping `undefined` from crossing into an application `getChannelToken(channel: string)`.
- **A `Blob` frame whose conversion fails after its connection was replaced is not reported to the replacement.** That catch reports through `this.handlers` — whoever holds the connection at that moment — so the guard comparing the captured socket/handler pair is the only thing between a dead socket's conversion error and the live connection's `onError`, which an application would read as the new connection being broken.

Each case was mutation-checked, and the attribution is recorded in `docs/progress.md` (Phases 155–159): which single assertion fails, which mutant dies at which leg, and the three legs found to have **no mutant of their own**. Four zero-count branch slots closed; `src/` now reads 56 of 1960, and `validation.ts` reports 100% branches for the first time.

### Documentation

- `src/websocket.ts` — the connect-timeout callback's guard comment now names the enumeration that makes **all three** of its terms unreachable (`socket` and the handler set are reassigned only in `start()` and `stop()`; reaching either needs `socketActive` already false, and every path that lowers it has already cancelled the armed timer), says which test holds which leg, and **drops** its "all 880 tests green" count instead of refreshing a number that rots in place. This is shipped text: it reaches consumers through both `dist/` bundles and the declarations.
- `AGENTS.md` — two rules taken from measurements in this batch. (1) Vitest transpiles `tests/**` with no type checking, so a test that constructs a deliberately illegal value is red only under `pnpm check`; the widen belongs on the post helper, not on each frame, because `Object.create(null)` is `any`. (2) Do not rebase a branch whose PR is already open: the progress log has a single append anchor, so two open PRs touching it leave the older unmergeable, and the repair cannot be pushed without a force-push, which this repository forbids.

### Compatibility

Mixed-version peers are unaffected: no frame, default, storage key, or export moved. `verify:compat`, `verify:types` and `verify:pack` pass against `v0.21.17`, and the published-consumer gate re-runs on the tag.

## [0.21.17] - 2026-09-24

### Fixed

- **A durable route confirmed to a Worker that no longer holds the assignment no longer orphans its Topic permanently.** `pause()` clears `assignedTopics` unconditionally but rewrites only the routes it can hand off, and a handoff whose final storage flush is cut short leaves the queued rest to be discarded when the teardown ends — so the record on disk still names the departing owner, confirmed, with the generation it had before. When that worker id registers again (a BFCache restore, or a runtime rebuilt with an explicit `workerId`), the route names a live Worker that holds nothing, and both reconcile passes miss the combination by construction: `reconcileSubscriptions()` walks `subscribedTopics` and stands down for a live owner, `reconcileAssignedTopics()` walks `assignedTopics`, and the phantom is in neither. The result is a topic nobody's transport subscribes — inbound messages stop arriving in **every** tab while outbound publishing keeps working, and `isAssigned()` still answers `true` for the phantom owner through its durable-route fallback, so nothing reports it.
- The named Worker now repairs it, and only it can: reclaim through the same self-assignment `subscribe()` performs when it still has a local handler for the topic (the record and its generation stay byte-identical, so peers see no churn on a route that already named it), or release the record and let a remaining subscriber elect an owner it can act on. Two gates make this safe to run every heartbeat. `confirmedAt` must be present, because that is what distinguishes a settled record from an election or handoff in flight — `confirmRoute()` has exactly three call sites and each sits in the same task as the `assignedTopics.set` before it, so a confirmed route with no assignment can only mean the assignment was taken away afterwards; and the assignment map is consulted first, which is what leaves the *legitimate* case alone: a Worker elected on a peer's behalf owns a route for a topic it never subscribed locally, and a sweep keyed on `subscribedTopics` would delete that record on every pass.
- The release **flushes the deletion before broadcasting `REGISTRY`**. A peer reconciling on the nudge reads storage through its own batching writer, so without the flush it reads the route that is still queued for deletion in the releasing Worker, stands down again, and the repair waits a full heartbeat. This is the rule `pause()` and `handoffAssignedTopics()` already follow, and the pin is a synchronous post-pass read that fails when the flush is removed.
- Corrected the premise of one pre-existing test, which hand-wrote a takeover route by copying the real one and changing `workerId`/`tabId`/`generation` — leaving the *previous* owner's `confirmedAt` on a record that names a different worker. No Worker writes that state, and it is exactly what the new sweep releases, so the test's assertion would have gone green by way of a different mechanism than the one it names. It now stages an unconfirmed takeover, which is what a real one looks like from a peer's seat.

### Tests

- `MemoryStorage` gained `failNextWrites(n)`, which makes the next `n` `setItem` calls throw the error a quota-full `localStorage` throws. Only writes fail — `removeItem` cannot — which is what makes the knob usable for its one purpose: the state above is produced by a lost **write**, and a test that asserted "storage failed" through a lost delete would be asserting a mechanism the browser does not have.
- Three pins, one per leg, and each dies separately: reclaiming a stranded self-route (`generation` and owner asserted unchanged alongside the restored assignment), releasing one for a peer to re-elect, and leaving a route alone while its holder still has the assignment. Mutating the new code leg by leg, with the whole suite run each time: dropping the confirmation gate fails **6**, dropping the addressee gate fails **28**, dropping the assignment gate fails **7** (including the sticky-route pin above), dropping the reclaim fails exactly **1**, dropping the route delete exactly **1**, dropping the nudge exactly **1**, dropping the flush exactly **1** — the last three are disjoint, so none of the three legs is decoration.
- The `storage-fail` interleaving that found this is **not** shipped in the coordination sweep, and the reason is measured rather than assumed. Adding it as a band in the seed's roll (2.5% of steps) makes the sweep fail on the pre-fix code with five violating seeds — `414`, `467`, `1557`, `2074`, `2969`, every one opening with a `storage-fail` and ending in `1 subscriber(s) need one owner that holds the transport, got owners=[] transportSubscriptions=[]` — and pass with the fix (`0` violations over the `4,701` seeds that run before the fuse). But the first kill sits at seed **414**, four times above the sweep's 100-seed floor, so on a starved runner the band would not catch a regression of this class, while the unit pins catch it deterministically. It stays a finder: the recipe is in `docs/progress.md`, and the `failNextWrites` knob it needs is now committed.

### Documentation

- `docs/architecture.md` and its Chinese mirror gained a "Stranded-self-route repair" invariant bullet next to the "Assignment drift repair" one it is the inverse of, and the heartbeat/reconcile summary now lists the pass in the order it runs (after the orphan prune, before the subscription pass, so a released route is re-elected inside the same cycle rather than one heartbeat later).

## [0.21.16] - 2026-09-24

### Fixed

- **A transport subscribe deferred behind an opening no longer flushes after the unsubscribe that cancelled it.** `subscribeTransport()` and `unsubscribeTransport()` mutate `transportSubscribedTopics` and then hand the work to `runTransport()` as a captured closure. When the subscribe was parked behind an opening and the release reached the transport immediately — the window between the opening resolving and its own parked continuation running — the connection was left holding a channel that no local handler, cluster assignment, or route record owns. Nothing recovers from that: `subscribeTransport`'s dedupe returns early for a topic already in the set, and the set here says the channel is held, so the tab stays subscribed to a topic it has released and deaf to one it re-takes. `runTransport()` now also takes the desired state as a `stillWanted()` predicate and re-reads it at each place that resumes on a later task (the recovery-gate waiter and the opening flush). The immediate branch keeps no check because every path into it evaluated the set in the same task.
- Reproduced with one bus and a gated `transport.start()`: subscribe while the open is pending, resolve the open, release one or two microtasks later. At those offsets the transport's *own* subscription set ends as `["topic"]` while both `subscribeCalls` and `unsubscribeCalls` hold one entry — an add and a delete that leave a `Set` non-empty is only reachable in unsubscribe-then-subscribe order, which is what names the defect. Offsets 0, 3 and 4 were clean, so the test asserts the whole window instead of the two values that failed here, and it reads `FakeTransport.subscribed` rather than the bus's bookkeeping, which is the thing that lies.
- The same cancellation now covers a release whose topic was re-subscribed before its flush, and the measured consequence there is narrower: the old code put `sub, uns, sub` on the wire where the new one puts `sub, sub`. The end state was already correct; a real transport answers that middle `UNSUBSCRIBE` by tearing the channel down and re-establishing it, with a delivery gap in between. The comment at the call site says which half is measured.
- Each of the two checks earns its keep separately, and that was measured rather than assumed, because the two resume points flush independently: deleting the recovery-gate check fails **1** of 191 tests (the gate case), deleting the opening-flush check fails exactly the **other two**, and reverting the whole change fails exactly those 3 with 188 pre-existing green — so no test in the repository pinned this before. Inverting both guards fails 20, including the pre-existing "starts automatically and queues subscriptions until the transport is ready", which is the assertion that the guard cannot silently swallow a wanted subscribe.
- `FakeTransport` gained `channelCalls`, one entry per channel call in the order the transport received them. `subscribeCalls` and `unsubscribeCalls` are per-direction and cannot express ordering, and the contract fixed here *is* ordering.
- **The question 0.21.15 closed on is now answered: the residue was this defect.** That entry recorded six sweep seeds that fail once the test channel delivers asynchronously, as an open product question the experiment "surfaced but did not settle". With the fix in, the same sweep is green; without it, the same six seeds fail again with the same messages. Measured both ways on one branch: `origin/main`'s `data-bus.ts` plus an asynchronous hub fails **seeds 100, 727, 1129, 1487, 1756** (`no subscriber left but owners=[] transportSubscriptions=[a]`) **and 1853** (`1 subscriber(s) need one owner that holds the transport, got owners=[b] transportSubscriptions=[a b]`); the fixed code with the same hub passes all 5,000 seeds; and the *synchronous* hub passes on the pre-fix code, which is exactly why a shipped defect stayed invisible to a harness that exercises it constantly.

### Tests

- `ChannelHub` gained `setAsyncDelivery(true)`, which defers every post by one microtask. A real `BroadcastChannel` delivers in a later task, so no runtime ever reacts to its own post inside one call stack — the hub's synchronous default lets exactly that happen, and the two cases above are what it can hide. The option is opt-in rather than the default because 15 tests in `cluster`, `data-bus` and `stability` post a frame and assert without awaiting: flipping the default was tried and reddens exactly **17** cases, those 15 plus this hub's own two delivery pins. The coordination sweep's per-seed hub is the only consumer that opts in, and its cost is measured as no cost: 8.0–9.5 s for the full sweep against ~10.5 s synchronous on the same machine.
- The option is pinned directly, on both sides: the default hub must still deliver inside the posting stack, an opted-in hub must deliver nothing until a microtask, a peer that closes before delivery receives nothing, and a sender that closes does not cancel its own frame — which is what the sweep's `forgeSubscribe()` depends on. Which half is load-bearing was measured: forcing the option to a no-op kills the second assertion, while removing the sweep's own opt-in leaves all five cases green on the fixed code. So the fidelity is justified by the six seeds it caught, not by a standing kill, and the pin's comment says so — while the *first* assertion is what makes the 17-case default flip impossible to land quietly.
- One mechanism in there is recorded as defensive rather than as covered: reading the channel's member set inside the microtask instead of snapshotting it when the frame is posted is **indistinguishable through this fake**, because `FakeChannel.close()` clears the channel's listeners. That mutant was written, run, and survived the whole file; the comment at the site carries the measurement so the next reader does not mistake the assertion for a pin on the mechanism.

### Documentation

- `docs/architecture.md` and its Chinese mirror described both subscription chains in the wrong order and omitted the deferral altogether. The published text read `→ transport.subscribe(topic) → transportSubscribedTopics.add(topic)`; the code adds to the set **first** and then hands the call to `runTransport()`, which may park it. Both chains now put the set write before the call, and a new bullet in the disconnect/reconnect section states the rule #241 implements: a parked operation is re-checked against that set before it runs, and the alternative — what shipped until now — is a subscribe flushing after its own unsubscribe, leaving the connection holding a topic that none of the four tracked sets owns.
- The same claim had three more copies, each corrected in both languages: the "Recovery waiter invalidation" bullet (which explained only the cancellation-generation guard, and now says plainly that the generation check alone cannot cancel a released subscribe because nothing about the recovery cycle changed), the "Transport recovery gate" paragraph's "parked operations flush behind that success" (now qualified, with a pointer), and `docs/api.md`'s `subscribe()` behavior list (which promised queuing but not cancellation). `docs/api.md`'s publication row was checked and left alone: a parked `publish()` carries no desired state to re-read, so its "sent once the transport is ready" is still exact. `docs/*.md` is in `package.json` `files`, so this is consumer-visible text and ships with the patch.

## [0.21.15] - 2026-09-24

### Tests

- `handleControlMessage`'s addressee check is now pinned. `handleMessage` dispatches on `type` alone and the cluster channel is broadcast, so that first line is the only thing keeping a runtime from acting on a CONTROL frame addressed to someone else — and nothing asserted it. Measured by deleting it: 369 tests across `cluster`/`stability`/`data-bus`/`centrifuge`/`worker-mode` stayed green while the three-tab coordination fuzz churned 16+ minutes of CPU against a ~1-minute baseline. The fuzz reaches the leg constantly (every point-to-point frame is a non-target for the other tabs) and cannot assert it, because its invariants are end-state checks and a slower convergence still passes.
- The pin asserts the non-target's own behavior — no `onControl` dispatch, no assignment, and no `knownTopics` entry for a plaintext it was never meant to serve — plus the addressee's, which is what shows the frame was deliverable rather than malformed. That distinction was earned: the first version died against the mutant too, but at the *addressee's* assertion, which pinned something other than the guard. Why the mutant also suppresses the addressee's claim is not yet explained, and is recorded as an open question rather than as a passing test.
- `handleRouteReleasedMessage`'s addressee check is now pinned on the one input where nothing else can reject it. Its staleness test compares the frame against the *durable route*, so a non-target that does not own the topic is already turned away by that — which is why the existing forged-`topicKey` case never reached this line. The pin's frame is addressed to a third worker while the route genuinely names this runtime, with a matching `generation` and `handoffFromWorkerId`, so every staleness term passes and only `targetWorkerId` stands. Measured by deleting it: 358 tests across `cluster`/`stability`/`data-bus`/`centrifuge` stayed green, and the failure was attributed to the new case alone. `tests/coordination-invariants.test.ts` cannot reach it at all — `forgeSubscribe()` is the only frame that harness sends, so no seed ever posts a `ROUTE_RELEASED` to the wrong worker.
- One assertion inside that pin was wrong before it shipped and is recorded so it is not re-introduced: `isAssigned()` reads true from the route record the scenario itself writes, because `isAssigned` falls through to `readRoute(topicKey)?.workerId === this.workerId`. It asserted nothing about the frame. The `assignedTopics` map is what the handler actually writes, and that is what the test now checks.
- The coordination fuzz gained a third limit, because the two it had were both made of time and the failure that has been turning `verify` red is not a waiting failure. `tests/coordination-invariants.test.ts` now arms a **channel delivery budget** on `ChannelHub`: past 50,000 posts in one seed the hub stops delivering, so a coordination loop that never converges is cut at the one place both halves of it are visible. The await cap reported `0 cut short` while one seed spent 463s of a CI run (and 151s in an earlier one) because that time is CPU spent inside microtasks — nothing on the same thread can preempt it, so no deadline can bound it. The threshold is taken from a measured distribution rather than taste: instrumenting `ChannelHub.send` across a full 5,000-seed sweep on an idle desktop gave p50 = 28 posts, p99 = 90, p99.9 = 5,429, maximum 16,763, with 18 seeds over 500 — so 50,000 is ~3x the worst interleaving this machine produces and cannot fire on a healthy seed. A cut seed prints `[CHURN] seed=N deliveries=… ops=…`, is excluded from the depth floor (its end state was never reached, so asserting on it would be a false failure), and the sweep summary now prints the churn count even when the sweep completed — which is the case in which the number is otherwise invisible.
- The budget's own teeth are pinned in both directions, like the await cap: a hub must deliver everything under the limit and nothing over it. Measured against two mutants — dropping the `return` (never cut) fails at "posts past the budget must not be delivered: expected 6 to be 3", and comparing with `>=` (cut one post early) fails at "a budget must not drop anything under the limit: expected 2 to be 3". A guard that can never fire would let the wedge through looking like a working limit.
- `docs/progress.md`'s phase log has a structural gate. Phase entries are appended at one shared anchor, and the two PRs for the same phase (#233 closed in favor of #234) landed as **two `## Phase 142` blocks** — one of them pushed below the `## Next candidates` heading the log is meant to sit above — so the record of a single change was duplicated and out of order, and read that way until a `grep -c "^## Phase 142"` returned 2. `tests/documentation.test.ts` now requires every `## Phase N / …` heading to number strictly above the previous entry and to appear above that heading. The scope is the current convention on purpose: 30 phase numbers repeat in the older part of the log (numbers 2–51, where an entry pairs a `## Phase N (in progress …)` heading with a `## Phase N result …` line), and none of those headings uses the `## Phase N / Title` form the gate covers — that form begins at Phase 84 and has never been duplicated. Measured on two scratch trees, one per leg: a second `## Phase 142` inserted above the anchor fails the numbering assertion alone, and a correctly numbered `## Phase 145` inserted below `## Next candidates` fails the placement assertion alone.

### Documentation

- Both release checklists now record that `pnpm bench:compare` can be closed by the act of investigating it. Its baseline — the median *and* the maximum leg — is drawn from the same rolling archive every `pnpm bench:browser` run appends to, so re-runs taken to "check the spread" become the baseline that excuses the failure. Measured while preparing 0.21.14: two runs at host load 7.7–15.1 failed the ceiling on `publish/dedicated` (77.3 ms against a ~38 ms fast mode), five further re-runs reported OK with the baseline median slid to 70.6 ms, and one clean run after removing those samples showed every metric up together — the contention signature, not a regression. The instruction is now: read `uptime` before re-running, record a suspect failure as deferred with its load, keep off-mode samples out of the archive, and do not regenerate `docs/benchmarks.md` from them.
- **The churn loop is the harness, not the library — and the earlier diagnosis of it is retracted.** The bullet above described the loop the budget cuts as "a real behavior and not fixed", and named the open question as *which read answers stale between the re-election's `writeRoute` and the next pass*. Neither the framing nor the implied mechanism survives measurement. Replaying seed 1046 with counters at the decision points in the two handlers and the route writer gave: **11,542 `handleControlMessage` accepts, 11,541 `reconcileSubscriptions` re-sends, 11,538 `confirmRoute` skips, 6 `confirmRoute` writes**, and at the storage boundary **27,571 reads of route keys against 6 writes that reached the store** — so there is no re-election loop at all (the re-send leg writes nothing, and the durable record was rewritten a handful of times across the whole seed). What actually happens is a *visibility* disagreement of one step: the route owner confirms the assignment, its confirmation sits in its own `BatchingStorageWriter.pending`, and a peer reading the flushed record still sees `confirmedAt === undefined`, so it re-sends; the owner's `confirmRoute` then returns early because *its own* read sees the confirmation. The one event that ends that cycle is the microtask flush — and the harness never yields to one, because `ChannelHub.send()` delivers every frame **synchronously**, so a whole `reconcile → post → reconcile` cascade runs inside a single call stack. Measured directly: deferring delivery by one `queueMicrotask` in the hub takes the sweep from ~18 seeds over 500 posts (in 5,000) to **zero seeds over 500 in 1,050**, with no `[CHURN]` and no budget trip. A browser cannot produce this loop: `BroadcastChannel` delivers in a later task, so the flush always lands before the peer reacts, and the re-send is bounded by one heartbeat. The delivery budget therefore stays exactly where it belongs — it is immunity against a wedge the *harness* can create — and the number it reports is no longer a goal for a product fix, because there is none to make. What the experiment did open, and did not answer: with asynchronous delivery the same sweep fails six invariant checks — seeds 100, 727, 1129, 1487 and 1756 report `no subscriber left but owners=[] transportSubscriptions=[a]`, and 1853 reports `1 subscriber(s) need one owner that holds the transport, got owners=[b] transportSubscriptions=[a b]` — and every one of them is a seed that opens with an injected `a:forge:<topic>` frame. So raising the harness's fidelity is its own change, not a one-line edit (making *every* hub asynchronous breaks ~16 tests in `cluster`/`data-bus`/`stability` that post a frame and assert without awaiting, so the deferral has to be opt-in and scoped to the fuzz), and whether a route-less `CONTROL/SUBSCRIBE` accepted under the documented missing-route tolerance can leave a transport subscription held after the assignment sweeps it is a product question this run surfaced but did not settle.


## [0.21.14] - 2026-09-24

### Documentation

- The published Chinese mirrors were read against `src/` for the first time. `package.json` `files` ships ten `docs/*.md` plus their `docs/zh/` copies and both READMEs, and the 0.21.11/0.21.12 corrections had been applied sentence by sentence to whichever language the pass was reading — so the Chinese paragraphs kept claims the English had already retracted, and the English kept claims only its own tables had corrected.
- The storage-boundary section of `docs/configuration.md` was the largest survivor, and it was wrong in **both** languages: "Storage only holds … does NOT hold … Publication data", and the trust-model paragraph's "it never proxies the payload through `localStorage`". `channelFallback: 'storage-event'` writes each coordination frame whole under `cross-tab-worker-databus:channel:*` (`src/core/environment.ts:169`), and a `CONTROL/PUBLISH` frame carries its topic plaintext and payload with it. The section now bounds the claim to the coordination records it is actually about and names the two opt-ins that put plaintext into browser storage — the same distinction `docs/architecture.md` already made.
- `docs/getting-started.md` told readers that N shared-mode tabs mean N server connections **and N channel subscriptions**, two bullets below the design that makes the second half false: `subscribeTransport` runs over `cluster.getSnapshot().assignedTopics`, so a Topic's channel is held by one tab's socket. The connections half stands; the multiplication is gone, in both languages.
- `docs/zh/capabilities.md` still promised that a structurally failing storage key is dropped "without blocking the other queued keys". `src/core/storage-batch.ts:137-138` calls `scheduleRetry()` and then `break`s out of the flush, so every key behind the failing one waits for its retry — the English row had said exactly that since 0.21.11, and the Chinese row is now its mirror.
- Both READMEs described the demo page as defaulting to the public `wss://faye.centrifugal.dev/connection/websocket`; `examples/demo/demo.js:86` seeds the address box with the demo server's own local endpoint, and `docs/getting-started.md` had been corrected to say so in 0.21.11. Both languages now match the page, including the "one of the selectable presets, not the default" phrasing.
- `docs/release-checklist.md`'s tagged-release paragraph listed the Release job as running `verify:compat` and `verify:pack`, omitting `verify:types` — which `.github/workflows/release.yml` runs and the same file's own "Automated gates" section lists.
- Five claims in `docs/architecture.md` about coordination were corrected in both languages, each after reading the code path it describes: `rememberTopic` runs *after* the `targetWorkerId` and `topicKey` guards, so a frame either guard drops is never cached (the protocol table and the invariants list still held the pre-0.21.11 strict reading, which the shipped test contradicts); the `REGISTRY` nudge covers worker and route writes only, because `subscribe()` on a live owner writes its subscriber record and returns; and when the last subscriber leaves, it is the departing tab that deletes the route, while the owner receives `CONTROL/UNSUBSCRIBE` and releases the transport. The Chinese copy also claimed the original topic "cannot be recovered from localStorage", which its own storage-event row contradicts two pages earlier.
- The one question Phase 134 left open in `src/` is closed by enumeration rather than by a defensive change. `CentrifugeSession.unsubscribe()` deletes Centrifuge 5.7.4's own no-op `error` listener under an emitter that throws on an `error` emit with no listener, so the question was whether any post-`unsubscribe()` emit could reach it. It cannot: all twelve `emit('error')` sites in `BaseSubscription` sit behind a `_isSubscribing()`/`_isSubscribed()` test except `_getSubscriptionToken`'s `badConfiguration` one, and the three ways back into that method after `_setUnsubscribed` — the resubscribe timer, which re-tests the state when it fires, the client's reconnect pass, which drives only `Subscribing` subscriptions, and `_refresh()`, which has no state test of its own but is reachable only through the refresh timeout `_clearSubscribedState()` cancels — are all closed. The comment now carries the enumeration, because re-attaching a no-op sink would have been code for a scenario the pin rules out.
- A second pass over `api.md` / `transports.md` / `configuration.md` corrected six more claim classes, each confirmed by a re-adjudication that assumed the collecting pass was wrong (it had quoted two sentences that do not exist in the files, and had reported the packed-consumer gate as unable to fail). `docs/transports.md` and its Chinese mirror told integrators that `stop()` and `onWorkerFailed()` "remove those listeners before the generation moves on"; `src/centrifuge.ts` bumps the counter on the first line of `stop()` and removes them after, and `onWorkerFailed()` never touches the counter at all — and the same bullet's "bump when a backend is created" omitted that the in-process local backend is installed without a bump, which is why `isCurrentBackend()` compares Worker/port/`localSession` identity too. `docs/api.md` claimed the React hook's StrictMode double-invoke "exercises the same stop/recreate path as BFCache suspend/resume", a sentence `src/hooks.ts` had already retracted: the hook runs create → `stop()` → create across *separate* instances and clears `topicHandlers` and the replay buffers, while `onSuspend` keeps both. That file's Chinese copy also said `getDedupStats()` returns "four" bounded counters (a fifth, `ttlMs`, appears whenever `dedup.adaptiveTtl` is set — `data-bus.ts:313` feeds it straight to `adaptiveBounds`) and that an adapter's `clearBefore()` runs synchronously, where `replay-manager.ts:252-255` wraps it in `withPersistenceRetry` and awaits it.
- Four more copies described the credential bridge as fetching "`getToken` / `getChannelToken`" from the main thread — both READMEs and both `configuration.md` tables. `centrifuge@5.7.4` has zero occurrences of `getChannelToken` in its build *or* its types, so nothing ever asks; the option shape and the Worker protocol still carry the kind for a future SDK, and each sentence now says which of the two is live. The same pass added the SharedWorker's actual name (`cross-tab-worker-databus-shared`) beside the dedicated one, which the docs already named.
- `docs/architecture.md`'s degradation paragraph, both languages, closed the last unqualified storage absolute in the set: "localStorage is only responsible for eventually-consistent coordination metadata" is true of the coordination records and false of the `channelFallback` path the same file documents, so the sentence now names the exception and links to the boundary section. The Chinese copy also labelled the third degradation step "主线程 WebSocket" where `worker-mode.ts` returns `local` and the session that runs is a `CentrifugeSession`; it now says Local mode, matching English.
- The "holds only" list rewritten above was itself re-checked and found not exhaustive: the persisted worker record also carries `protocolVersion`, `role`, `registeredAt` and an optional `throughput` sample, and the route carries `generation` and the handoff pair, so both languages now enumerate by record instead of by three rounded bullets. Stale line numbers inside a shipped comment (`src/centrifuge.ts`, citing `:189`/`:193-194` for sites now at `:194`/`:197-205`) were replaced with the names they belong to, because a comment that ships through `dist/**` rots faster than the code it points at.
- `docs/architecture.md`'s `knownTopics` section enumerated three of the six in-process call sites that populate the cache. `rememberTopic()` runs at `subscribe`, `publish`, `publishBatch`, `unsubscribe` (inside `releaseSubscription`), `activate()` for topics queued before the cluster started, and `reconcileSubscriptions()` each cycle, plus inbound `CONTROL` frames — so `publishBatch` and `activate()` appeared nowhere in the section, `reconcileSubscriptions()` only in the prose explaining *why* the cache is re-affirmed, and the `unsubscribe` row of the lifecycle table showed only the conditional `delete`, though the same call derives the key one line earlier. Both languages, prose and table.
- The same table carried the storage absolute this cycle has retracted six times in other files, in a cell rather than a paragraph: the `topic` row said "No; kept in Runtime memory and control messages" while the storage-event row of the *same* table says each frame is written whole, topic plaintext included. The cell now states which records the plaintext stays out of and names the exception. `docs/configuration.md`'s boundary list had also filed the tab-id key with the three `localStorage` coordination records; `getOrCreateTabId()` writes it through `environment.sessionStorage`, so the entry now says so (`src/core/environment.ts:275`).

### Tests

- The coordination sweep now caps every *awaiting* step inside a seed, because the between-seeds fuse could not bound one. A `verify` run reported `[coordination-invariants] stopped at 1046/5000 seeds after 158476ms (slowest seed 151850ms)` and then `Error: Test timed out in 120000ms`: the 1,045 other seeds sum to ~6.6 ms each, so **one interleaving ate 96% of the sweep's wall clock**, and the per-test ceiling fired 113 s into it — Vitest marks the test failed but the loop keeps running, which is why the truncation line is in that log at all, printed after the failure it describes. Nothing named which seed or which operation, and the same head passed on rerun, so the wedge is contention-amplified rather than deterministic. The tick advance, the twelve-round settle and the teardown are each raced against a 2 s deadline sampled on a `setTimeout` captured before any fake timers were installed; a seed that trips it is counted separately and **not** asserted on, because its end state never reached quiescence and an assertion there would be a false failure rather than a finding. It is logged as `[CUT] seed=N ms=… ops=…`, the summary line now also prints when the sweep reached `MAX_SEEDS` but lost seeds to the cap, and the depth floor counts only seeds that were actually asserted.
- What the cap cannot reach was measured rather than assumed, and it is a real limit. Forcing the deadline to 12 ms over a full 5,000-seed sweep trips it **zero** times: the slow seeds this harness can reproduce locally are synchronous. In the instrumented run to seed 112,399, six seeds cost over 100 ms, and in each one tab `a`'s `stop()` was essentially the whole cost (`stops=[a=109..132 b=0 c=0]` inside a 111-135 ms seed), i.e. CPU spent before any promise was even awaited — nothing a same-thread deadline can preempt. So this guard bounds queue-yielding waits, the CI wedge's nature is still unattributed, and the claim is limited accordingly: it converts an unbounded *awaiting* step into two seconds of lost depth plus a line naming the seed.
- Because a guard that can never fire locally would still leave the sweep green, `capped()` is pinned directly and in both directions: a never-settling await must hit a 25 ms cap (and a 0 ms one), a microtask-settling chain must beat even a 0 ms cap, and a 5 ms real timer must beat a 100 ms cap. Three mutants die at three separate assertions — a cap that never expires, one that expires eagerly, and one that reports settled work as expired — which is what distinguishes this pin from the absence of a trip.


No behavior, wire-format, storage-layout or cluster-protocol change. `git diff -U0 v0.21.13..HEAD -- src/`, reduced to non-comment lines, is empty (measured: 0 lines), and coverage is identical to 0.21.13 at 99.01 / 96.90 / 99.26 / 99.69 — now over **898** tests, the extra one being the `capped()` pin. `verify:compat` and `verify:types` both diff against `v0.21.13` and pass (6 entries, 90 importable names, surface closed), and `verify:pack` imports every entry from the `0.21.14` tarball. The only executable file in the release is a test, which `package.json` does not publish.

## [0.21.13] - 2026-09-24

### Documentation
- Two passes closed the third shipped-prose surface: **comments inside function bodies** in `src/**`. They reach consumers because esbuild preserves them into `dist/**/*.js` and `dist/cjs/*.cjs`, both of which are in `package.json` `files`, so the audit that produced 0.21.11/0.21.12 (`docs/**` + READMEs) and the one that produced #223 (declaration JSDoc) had each left this half of the published text unread. Thirty-three claims were checked against the code and corrected, each after confirming the consumer it misdescribes; a dozen more candidates were cleared on inspection and are recorded so nobody re-derives them.
- The one that mattered: `src/core/data-bus.ts` proved a chained `.catch` resolves by asserting "`reportError` cannot throw". `describeFailure()` is total, but `reportError`'s only protection against a throwing subscriber is a `console.warn`, so a throwing subscriber **plus** a throwing `console.warn` escapes it — which the same file documents 500 lines below and `tests/data-bus.test.ts`'s "settles stop() when the teardown failure cannot be reported either" pins. Three enumeration proofs rested on that sentence; all three now state the dependency next to the enumeration instead of claiming totality.
- A second class was the *explanation* being wrong while the code was right, three times over: `isAssigned`, `storage-batch.flush()` and `replay-manager.suspend()` each credited themselves with preventing something the adjacent code already handles (a route write "not yet flushed" — but `BatchingStorageWriter.getItem` serves the pending value first and `keys()` is persisted ∪ pending − pending-deletes; a `scheduleFlush` re-entry that cannot happen because it defers through `queueMicrotask`; a cleanup loop that already stops on its own generation check). Each now names what it actually guards, and `isAssigned` points at the shipped test that pins the state in question.
- The absolute-enumeration class, each settled by one grep rather than by reading: `transportReady = false` has five writers not four, `assignedTopics` three not two, `metricsActive` seven readers not "the four record / flush methods", `generation` bumps on two of three backend-creation paths (and `stop()` moves it *before* the listener removal its comment credited it with following), `hydrationEpoch` is written by `suspend()`/`resetBuffers()` and by no clear path, and `trace.start()` "no-ops" in events mode only after clearing `stopped`. Two claims about the world were factored rather than reasoned about: three of six `hash.ts` "primes" are composite (`PRIME_H2 = 929 × 1_719_413`), where what 32-bit `Math.imul` mixing requires is oddness — and the constants are now labelled load-bearing, because the digest keys records already in localStorage.
- Two sentences describe a dependency rather than this repository, so both now carry its version. `centrifuge@5.7.4` exposes **one** client-level credential hook (`getToken`, `types.d.ts:126`) and no `getChannelToken` anywhere in its types or build, which is why the `channelToken` request kind has never executed outside a test fake. And `CentrifugeSession.unsubscribe()`'s `removeAllListeners('error')` deletes Centrifuge's own no-op `error` listener — installed in the `Subscription` constructor to prevent an unhandled `error` emit throwing (`build/index.js:762`, `:162`) — under a comment that claimed internal listeners were "preserved". That half is recorded as an open question with what would have to be built to call it a defect, not as a fix: every `emit('error')` site read in `BaseSubscription` sits behind a `_isSubscribing()`/`_isSubscribed()` guard, and the session test double cannot exhibit the guard at all.
- `src/websocket.ts`'s module header described a JSON-only wire protocol while `sendBinaryFrame` writes a second, tagged frame format (`0xc7 | uint16 topicLength | topic | raw payload`, degrading to a JSON envelope when metadata is present) that the bundled demo server implements in both directions; and its `sendFrame` doc called a publish "the only real loss" on a closed socket, where a dropped UNSUBSCRIBE is equally unrecoverable because the topic has already left `subscribedTopics`. `docs/transports.md` had both halves right all along — the header was the outlier an integrator would read.
- `docs/api.md` and its Chinese counterpart claimed the `coordination` trace event is "emitted after each transport open"; it has one call site, on `start()`'s opening success arm, so a recovery emits no second snapshot.

### Tests
- `pnpm bench:compare --fail-above-pct 50` gained the leg its median baseline could not supply. The baseline is the median of up to five archived reports, which is stable only while the fast and slow modes stay *mixed* in that window: when consecutive reports land in the same mode the median itself jumps, and a percentage measured against it is not a measurement of anything — the same comment-only tree read +121 % against one baseline and −56.7 % against another minutes apart. `compareAgainstBaseline` rows now carry a `ceiling` (the highest sample the baseline summarises), `findRegressions` requires both legs, and the rows the second leg excuses are printed under `within-baseline, not gated` rather than passing silently, because an excuse a maintainer cannot see is indistinguishable from a clean bill. The cost is stated in the script and both release checklists: a sustained shift that stays inside the observed five-report range is now invisible to the gate. On the live archive that range is wide — `dedup1000Ms` sits at median 14.9 against a max of 29.2, and three metrics were inside their own range at a 5 % threshold — which is the bimodality `scripts/bench-compare.mjs` already documented, visible in the numbers the gate prints now.
- Three tests added (13 → 16), and both legs attributed by mutation rather than by reading: deleting the ceiling condition fails exactly the new multi-modal case, the signature of a leg that was previously unenforced; forcing it to always suppress fails four, including the pre-existing explicit-pair test, which is what pins `ceiling === null` as behavior rather than decoration. `docs/benchmarks.md` is generated, so its prose correction went into `scripts/bench-trend.mjs`'s `buildDocs()` and both languages were regenerated.

No behavior, wire-format, storage-layout or cluster-protocol change: `git diff -U0 src/` with comment lines filtered is empty across all 13 audited files, coverage holds at 99.01 / 96.90 / 99.26 / 99.69 over **897** tests. The one executable change in the release is inside `scripts/`, which `package.json` does not publish.
## [0.21.12] - 2026-09-23

### Documentation
- `README.md` and `README.zh.md` promised that "the persistence layer does not store connection addresses, raw Topic text, or message content" — two bullets below the line advertising the durable replay persistence that does exactly that. `replay-persistence.ts` creates its IndexedDB object store with `keyPath: 'topic'` and writes `{ topic, messages }` rows, so the plaintext topic is the store key and the publication payloads are its values, and `createIndexedDbReplayPersistence` is a public export named by the published-consumer verification script. The sentence now scopes itself to what it is true of (the worker/route/subscriber coordination records) and names both opt-ins that persist real content: `replay.persistence`, and `channelFallback: 'storage-event'`, which writes every coordination frame it carries — topic plaintext, and payloads on `PUBLISH` frames — into localStorage until the channel closes. The Chinese README additionally listed neither feature, so its reader received the privacy promise with no disclosure paired to it; both bullets are now present in both languages. This closes the `docs/` + README prose surface that the 0.21.11 sweep had named as unread; the per-file typedoc in `src/**` ships by a different route (bundled into `dist/`) and remains unaudited. Fourth release in this class after 0.21.7, 0.21.8 and 0.21.11 — and the second in a row.
- `docs/release-checklist.md` (and its Chinese counterpart, which also ships) carried three claims that would misdirect a maintainer at the moment they most need the file to be accurate. **The published-consumer gate was documented as running "with the same budget as a manual run"; it does not** — the workflow passes `PUBLISHED_VERIFY_ATTEMPTS=48` / `PUBLISHED_VERIFY_DELAY_MS=7500` as its own env while `scripts/verify-published-consumer.mjs` defaults to 6 × 5000 ms, so a hand-run repeat reports `ETARGET` after 30 seconds against a tag whose CI run was green, which is indistinguishable from a failed publish. Measured on this very release: `v0.21.11` took 39 retries of 48 in a successful run and the offline repeat passed on its first attempt, so the checklist now states both budgets and how to reproduce the CI one. **CI was said to run "on every push and pull request"**, while both triggers in `ci.yml` are filtered to `branches: [main]` — a topic-branch push runs nothing, and the work is first covered when its PR opens. **And `bench:trend` was missing from the local-only list**, though it rewrites `docs/benchmarks.md` from the local archive and appears in no workflow, so a maintainer could conclude CI refreshes the trend doc.
- The coverage-floors comment in `ci.yml` still named the pre-0.21.7 values (96/92/96/97) as what `vitest.config.ts` carries; the config, the shipped checklist and `AGENTS.md` all say 98/96/98/99, and only the workflow comment had drifted. Corrected. No behaviour, wire-format, storage-layout or cluster-protocol change, and no coverage movement: this release touches no `src/` or `tests/` file.

## [0.21.11] - 2026-09-23

### Documentation
- Two comments in `src/workers/port-reaper.ts` described mechanisms the code does not have, and both were corrected against a measurement rather than a re-read. `touch()`'s early return claimed to stop a late PING "resurrecting" a removed port in the reaper's tracking — deleting the guard instead passes the whole suite, because `reap()` iterates `targets`, so the only difference is one stale `lastSeenAt` row per dead port; the comment now says that, and says why the guard is still worth having (it is what keeps the three maps holding exactly the tracked ports, which is the enumeration `reap()`'s `??` fallbacks rest on). And `reap()`'s `Array.from(…)` snapshot claimed to prevent "skipping a subsequent entry or visiting one twice" — `Map` iteration is already deletion-safe, iterating the live map passes every test, and the one case a snapshot changes (a re-entrant `register()` during a teardown) is neutralised by `register()` stamping `lastSeenAt` with the current time. It stays, now labelled defensive rather than load-bearing. No behaviour change; these comments are bundled into `dist/centrifuge.shared.worker.js`, which is why they are recorded rather than edited silently.
- Recorded so the next pass does not repeat the work: a seeded interleaving harness for this class was written, run, and deleted. Four invariants over register/touch/configure/remove/advance with an injected clock explored 2,000 seeds green in 331 ms (~6,000 seeds/s), then twelve mutants showed it killed none that the 19 existing unit tests do not also kill — nine die to both, `schedule()`'s idempotency guard dies only to the unit tests' `expect(sets).toEqual([])`, and the two survivors are the map-hygiene and snapshot cases above. An interleaving sweep feels like more coverage because it visits more states; the question that decides it is whether any mutant dies to it alone. `AGENTS.md` carries that rule.
- `docs/configuration.md` and `docs/zh/configuration.md` said the replay persistence retry delays "grow exponentially and are capped". Only the *growth* is capped. `withPersistenceRetry()` seeds its first wait from `replay.persistenceRetry.backoffMs` and applies `Math.min(delay * 2, 1_600)` **after** that wait, so a configured `backoffMs` above the ceiling is waited in full and the schedule then falls to it — with `backoffMs: 5000` the waits are 5000, 1600, 1600, which does not grow at all. `assertPersistenceRetryOptions` accepts any non-negative finite number, so this is a reachable configuration rather than a misuse. The sentence now says which of the two the ceiling bounds and names the measured sequence. Reading the old one the other way — clamping the first wait as well — was considered and rejected: it would silently ignore a value the integrator set, in the opposite direction from what `backoffMs` is documented to mean. No behaviour change.
- `docs/architecture.md` claimed, in six sentences (each mirrored in Chinese), that coordination traffic "never touch[es] localStorage" and that "publications are not written to localStorage". Under the opt-in `channelFallback: 'storage-event'` the opposite is structural: the envelope *is* the frame, so every `CONTROL` — plaintext topic and `PUBLISH` payload included — is written whole under `cross-tab-worker-databus:channel:*` and stays until the channel closes, which after a tab crash means indefinitely. Four other docs files already stated that trade-off; architecture.md was the outlier, and it is the file a security or data-residency review reads. It also carried a `WorkerRecord` block that omitted `protocolVersion` and `throughput` under a sentence asserting the block "matches the current protocol"; placed `rememberTopic()` on *every* inbound `CONTROL` message (it runs only on those surviving the `topicKey` pairing check, so an invalid pair cannot grow the map); said `confirmedAt` is written "after the owner processes the control message" (it is stamped before the action reaches the transport, which is precisely why an unconfirmed route gets re-sent); and attributed the storage-event envelope's delivery to "a monotonic sequence" when `environment.ts` names the sender nonce as the part that separates two tabs whose first frame is each `seq=1`.
- The capabilities matrix held the same shape twice more. "Does not persist URLs, raw Topic names, credentials, or publication payloads" is true of the coordination records and false of the exported `createIndexedDbReplayPersistence`, whose object store uses the plaintext topic as its `keyPath` and holds payloads in its rows; and "Durable Messages | Not Implemented | The SDK does not persist business payloads" conflated two capabilities that go opposite ways — outbound publish commands are indeed never persisted, inbound replay history is. That row is now two, each with its own status. The storage-recovery row said a failing key is dropped "without blocking other queued keys", while `flush()` `break`s at the first failure, so everything queued behind one poisoned key waits through four backoff passes (50+100+200+400 ms) before the pass that drops it.
- `docs/getting-started.md` sold `workerMode: 'shared'` as letting same-origin Tabs "reuse a single connection". Each connecting port gets its own `CentrifugeSession` and therefore its own WebSocket — that per-port isolation is the reason closing one tab leaves the others subscribed — so N Tabs are still N server connections and N channel subscriptions; what shared mode saves is the Worker process. For anyone writing a transport, `docs/transports.md` pointed at the wrong callback and the wrong guard: the recovery cooldown is driven by `onStatus('error')`, while `onError` only records and notifies, so a backend that reports a dead socket through `onError` alone is never reopened; and the generation counter is compared only by the asynchronous credential bridge, because `stop()`/`onWorkerFailed()` remove a superseded backend's listeners before it moves on. The same file's interface block omitted `publish`'s metadata argument, the optional `publishBatch`, and the two diagnostics labels, its Worker unions omitted `TOKEN_REQUEST`/`TOKEN_RESPONSE`/`TOKEN_ERROR`/`SESSION_REAPED`, and its wire sketch omitted the `publishBatch` frame that both the bundled transport and the demo server speak. The demo also defaults to its own local endpoint, not the public Centrifugo URL the page listed as the default (and which its own next paragraph already assumed was local), and the entry-point list omitted the `/vue` export plus the fourth hook each adapter exports. Corrected in both languages.

### Tests
- The one test that claimed to pin the retry ceiling never reached it. `honors the backoff delay between attempts, capped by the retry ceiling` advanced 50 ms then 100 ms from a `backoffMs` of 50, so the ceiling in its name was doing nothing and the sentence above had no witness in either direction. It is now `doubles the backoff delay between attempts`, which is what its assertions show, and two new tests carry the cap: `caps the doubled delay at the retry ceiling and holds it there` walks the whole schedule 50 → 100 → 200 → 400 → 800 → 1600 → 1600 with a 1 ms boundary probe on each step, and `waits the configured backoffMs verbatim even when it exceeds the ceiling` checks that a 5000 ms `backoffMs` is not clamped. Three mutants, each measured: deleting the cap kills **both** new tests (`expected 7 to be 8` on the last row, `expected 2 to be 3` on the third), clamping the initial delay kills only the verbatim test, and deleting the doubling kills only the ceiling test — which is the evidence that the two pin different halves and neither is a spare.

- `handleControlMessage`'s route check is `route && route.workerId !== this.workerId`, so a topic whose route cannot be read is **accepted**; three descriptions claimed the stricter "only when the route names the receiver". `accepts a CONTROL/SUBSCRIBE that has no durable route to check, then sweeps it` now pins both halves of what actually makes that safe — `confirmRoute` writes nothing without a route to stamp, so no durable ownership is minted, and the next reconcile withdraws the assignment. Measured: the strict reading fails this test *and two* pre-existing load-weighting tests that already depended on the tolerance, and deleting the sweep's route check fails only the new one.
- `stores the frame verbatim, which is the trade-off the docs price the fallback at` asserts what storage ends up holding after one `PUBLISH` frame on a storage-event channel — the topic plaintext and the payload, both present, and both gone after `close()`. No delivery test can see this class of claim, which is how six sentences in `architecture.md` stayed wrong while every fallback test in the suite stayed green.

## [0.21.10] - 2026-09-23

### Fixed
- `heartbeatIntervalMs: Infinity` did the opposite of what it documented, in shared mode. It is accepted by `assertHeartbeatInterval`, appears in `docs/configuration.md`'s option table as disabling the PING heartbeat "entirely", and does stop the PINGs — pinned by `disables PING entirely when heartbeatIntervalMs is Infinity` — and the transport *advertises* the choice, because `buildInitMessage()` includes `heartbeatIntervalMs` whenever it differs from the default. `PortReaper.setTimeout()` then ran that value through the same `Number.isFinite` guard as `NaN`, `0` and negatives, fell back to the 10 s default, and so installed a **30 s session timeout on the one port guaranteed never to send another message**. The configuration whose stated purpose is "the reaper is not needed" therefore guaranteed a reap 30 s after connecting, with no heartbeat left to prevent the next one. Now `Infinity` means "never judged silent" while `NaN`/`0`/negative keep the fallback, because those three are rejected by the transport constructor and can only reach the Worker from a main thread that is not this library — `Infinity` is the one non-finite value the public API both accepts and acts on. One new test kills three mutants at three different assertions (`never reaps a port whose heartbeat was disabled with Infinity`): the shipped behaviour fails `exempt.port.closed` after ten simulated minutes; a variant where an exempt port clears the reaper's interval fails the *second* tab's `normal.port.closed`, which is the per-port half of the contract; and a variant where the exempt port simply leaves the reaper's tracking maps fails the follow-up `dispose()` assertion, which the pre-existing dispose tests cannot supply because they never pass `Infinity`. That third mutant is worth the detail, because before this test existed it appeared to be caught already — by `falls back to the default interval for non-positive or NaN heartbeat configs`, whose bad-value loop calls `+Infinity` and then `-Infinity` on the same port, so the last call silently undid the exemption. An ordering accident, not an assertion, so `+Infinity` has been taken out of that list with a note saying why. One further assertion in the existing PING test pins the wire half — `INIT` must carry the `Infinity` — because a reaper-side fix alone would leave the main thread unable to say *why* it disabled reaping, and measured, normalising non-finite values out of `INIT` fails it. The old malformed-INIT test's comment had been listing `Infinity` among the malformed payloads, which is how two green tests hid one defect: a test that asserts a fallback is not evidence about which inputs deserve one. Whole-tree coverage unchanged at 99.01 / 96.90 / 99.26 / 99.69 over **891** tests, and `port-reaper.ts` still reports three zero-count branch arms — the two `??` fallbacks in `reap()` and a `dispose()` guard — so the arm this fix adds is exercised.

### Documentation
- Two sentences in the shipped `docs/configuration.md` and its Chinese counterpart said things the code does not do. **Shutdown cleanup** claimed that "when the SharedWorker shuts down, `PortReaper.dispose()` stops the timer and closes/stops every still-tracked session". `dispose()` has no Worker-side caller: `dispose` appears exactly once in `dist/centrifuge.shared.worker.js`, as the method definition, and no invocation of it exists anywhere in `dist/`. That is the same fact the reaper's own header records about the port — a `MessagePort` has no close event, so there is no "the SharedWorker is shutting down" signal for a hook to hang on — and the bullet now says so and names the two paths a port actually leaves tracking through. And the heartbeat and session-timeout bullets now state what `Infinity` does to the *reaper* rather than only to the PINGs, in both languages, together with the cost of choosing it: a tab configured that way and then crashed leaves its session and its WebSocket in place, because the one thing that would have noticed was switched off. The same sentence reached `docs/api.md` / `docs/zh/api.md`, whose option entries said only that `Infinity` "disables heartbeats". The **Failure isolation** bullet, written before 0.21.9's announcement, now covers `notify()` as well. No further behaviour change and no coverage movement.


### Tests
- One test in the IndexedDB replay harness passed while breaking the gate. Its three loads fail on real 0/15/40 ms timers, and the third rejection was asserted *after* a healthy reopen round trip — so on a runner where that round trip takes longer than 40 ms, the promise rejects while nothing is attached to it, and `pnpm test:coverage` exits 1 with `Unhandled Rejection: Error: transaction aborted` alongside a report of **34 passed** and a checkmark on every test. Observed locally at 1-minute load average 86–157; the same file at lower load had been clean all along, which is what makes this runner-dependent rather than deterministic. The three assertions are now created next to the three calls and awaited where the ordering belongs, and the causal link was measured on the real file with the round trip forced to 200 ms: attached at the assertion it exits 1 with the unhandled block and 34/34 passing, attached up front the same run exits 0. Nothing in `src/` is implicated — the orphaned promise is one the test itself created and had not yet awaited — and `AGENTS.md` gained the rule, because "every checkmark green, the run red" reads like infrastructure until someone attaches the exit code to it.

## [0.21.9] - 2026-09-23

### Fixed
- A SharedWorker tab whose main thread was starved — one long synchronous task, or the timer throttling a backgrounded tab gets — lost its transport with no signal whatsoever and never recovered on its own. A `MessagePort` has no close event, so when `PortReaper` reclaimed the silent port the main thread kept its backend, its cluster role and its topic routes, and every `postMessage` into the closed port succeeded and delivered nothing. Measured in a real browser before this changed: a 34 s stall left the tab owning its topic with **zero** server-side subscribers, publishing to nobody, while `getHealthSummary()` reported `state: healthy`, `status: connected`, `transportReady: true`, `recovery.attempt: 0` and `lastFailure: null`. Nothing inside the library could see it; the only things that healed it were user-level gestures — re-applying the connection, or a `pagehide`/`pageshow` pair — which is why it reads as a dead bus rather than a recovering one. The reaper now posts `SESSION_REAPED` on the port *before* closing it, and the transport turns that into the same backend loss a Worker crash produces (`onError` plus an `error` status), which is what lets the existing cooldown recovery rebuild the session on a fresh port. Browser-level, on desktop Chrome: after a 34 s stall the tab re-established its subscription by itself — no user gesture, no lifecycle event — with the replacement connection under a second old when observed, and with the announcement reduced to a no-op the same sequence never recovered. That E2E spec was written, measured at 36.7 s passing locally and failing at 90 s of polling without the fix, and then removed: the precondition it needs cannot be produced on headless Chromium, where the SharedWorker's reaper clock rides the same thread as the blocked page, so no tick lands during the stall and the queued PING is processed before the next one — measured across all three CI attempts of the run that caught this, each ending with the channel still held by the *original* socket and the demo's own health line reading `健康 · transport 就绪 · 恢复 0/Infinity · 无失败记录`. A gate that can only fail on the architecture it was written for would have been a coin flip, so the legs are pinned by unit tests instead — three mutants, each killing exactly its own test (deleting the notification, reordering it after the close, and disabling the transport handler) — with the browser behaviour recorded as a measurement rather than as a check. The message is additive and `handleOutput` has no else-branch, so an older main thread attached to a newer cached `SharedWorker` ignores it and behaves as before; `ignores a Worker output type it does not handle` pins that, because the other direction's compatibility is what makes adding a type safe at all. `docs/configuration.md`, `docs/architecture.md` and `docs/transports.md` (English and Chinese) describe the announcement — the shipped configuration page previously presented the discarded `disconnected` status as a benefit without saying the starved tab learned nothing. Branch coverage 96.89 → 96.90 over 890 tests.

### Tests
- SharedWorker mode had no browser coverage for a handover. `SharedWorker mode: one shared process, independent sessions, cross-tab delivery` asserts steady state, `shared-mode session closes server-side when a tab closes` asserts a closed tab's socket leaves, and every migration, reload and BFCache spec runs in dedicated mode. That left the one thing shared mode does differently untested: each tab has its own cluster identity *and* its own WebSocket, but all of those connections live in one shared worker process, so taking a topic over moves the single server-side subscription between connections that must survive it. `shared-mode owner migration moves the server subscription onto a surviving connection` now pins that with three shared tabs on one `uniqueTopic`: exactly one connection holds the channel before the close and after it, the post-migration holder is neither the closed tab's socket nor a connection opened after the close — so a survivor that tore its own session down and reconnected to get the channel fails instead of passing — and delivery still works in both directions across the handover. Measured on a clean tree: three sockets for three tabs with exactly one carrying the channel, takeover landing in ~2 s, the spec in 2.4 s alone and 4.1–4.7 s under `--repeat-each=3` (37 E2E tests pass either way); the pre-close snapshot grows to 5–9 sockets in the parallel run and set membership stays sound, because a `uniqueTopic` channel is only ever subscribed by this test's own tabs. Two mutations settled which assertion carries which load, and one of them changed the test. Deleting `handleControlMessage`'s `targetWorkerId` guard made every tab act on the owner's SUBSCRIBE, and the convergence poll for "exactly one holder" *still passed* — the failure surfaced 30 s later as a doubled delivery (`expected 1, received 2`), so the count is now re-read in steady state after each round trip rather than only polled on the way in. Skipping `handleRouteReleasedMessage`'s `onControl(SUBSCRIBE)` left the survivors' cluster view converged on exactly one owner while no connection held the channel, unrepaired by the reconcile loop inside the 60 s handoff budget, and the new post-close poll failed at zero holders — which is the whole reason for testing this at browser level: a coordination-side "who owns it" assertion cannot see a transport subscription that never moved. No behaviour change, so no release: `v0.21.8` stays current.

## [0.21.8] - 2026-09-23

### Coverage
- A guard in the cluster's load bookkeeping turned out to be reachable through the public API and had no test behind it. `sendControl()` dispatches a **self-addressed** SUBSCRIBE by calling `handlers.onControl` synchronously, which at the bus layer runs through `subscribeTransport()` into `transport.subscribe()` — a method the host implements. So application code can call `stop()` inside its own subscription path, and when the stack unwinds, `updateLoad()` still has a changed assignment set to act on. `if (this.started) this.writeRecord(true);` is what keeps that write from republishing the worker record `pause()` had just removed; the hazard is not cosmetic, because liveness is read out of that record, so a peer keeps routing topics and publications to a channel that is closed until the TTL expires. Deleting the guard now fails one test — `publishes no worker record when a control handler stops the cluster mid-subscribe`, which asserts both that no record survives the teardown and that a runtime joining afterwards sees only itself — with the other 883 green, and the site says so. The post-handler write surface was enumerated rather than assumed: `confirmRoute()` runs before the handler, and `notifyRegistry()` goes through `send()`, which returns early once the channel is null, so that one line is the whole window. `cluster.ts` uncovered branch arms 22 → 21 and its branch coverage 94.28% → 94.54%; whole tree 99.01 / 96.84 → 99.01 / 96.89 over 884 tests. No behaviour change. Two of this pass's mutation runs removed the call instead of only its guard, which broke four unrelated tests and let the new one pass — the inverted signature of a leg that is already pinned — so `AGENTS.md` now states the rule that settled it: diff the mutant before believing what it kills.
- The two `selectLeastLoadedWorker(…) ?? this.currentRecord` fallbacks on the cluster's ownership paths are now labelled with what makes them unreachable, because both look like a gap and neither is. `subscribe()` refuses to run before `start()`, `reconcileSubscriptions()` is reached only from `reconcile()` which refuses the same, and `readWorkers()` appends this worker's own record whenever storage names nobody while the runtime is started — so the candidate list cannot be empty and the election cannot answer undefined. Measured two ways: deleting both fallbacks leaves all 883 tests green (vitest does not type check), and `tsc --noEmit` then rejects `writeRoute(…, owner, …)` and `owner.workerId` as `WorkerRecord | undefined`. The compiler states the same fact the runtime cannot reach, which is why the fallback stays rather than becoming a non-null assertion. No behaviour change and no coverage movement; a probe of the scenario that looked like its counterexample — a peer expiring this worker's record and then departing, leaving nothing in storage — measured `readWorkers()` returning this worker's own record, so it never reaches the right arm at all.
- The IndexedDB replay adapter now has a test for the failure signals that arrive after its connection cache has moved on, and it closes two legs that had only ever run one way. `invalidate(db)` is called from every failure path in the adapter, and each time it ran the cached slot was non-null and named the same connection the caller held. A stale signal is reachable: one aborted transaction dispatches `error` and then `abort`, and a real implementation queues each as its own task, so an invalidation can land after an earlier one cleared the slot or after a healthy operation reopened a different connection. The second case is the one with teeth — without the `current === db` check the stale signal closes the *live* connection and evicts it, which the new test reports as a third reopen (`expected 3 to be 2`). Without the `if (dbPromise)` guard the empty-slot case throws a `TypeError` out of the IndexedDB handler and the operation never settles, so that assertion is raced against a 500 ms watchdog and reads `expected 'hung' to be 'rejected'` rather than as a bare test timeout that names nothing. `replay-persistence.ts` branch coverage 89.74% → 92.30%; whole tree 99.01 / 96.74 → 99.01 / 96.84 over 883 tests, with the module's ledger down to six zero-count arms and one uncovered function.
- The same pass measured the four `settled` latches in `load`/`clear`/`clearTopic`/`clearBefore`, which are what stop the second signal of one outcome from invalidating again, and they are dominated: deleting all four leaves the suite green (measured at 882 tests, before the test above existed) and the reopen count unchanged, because both signals are dispatched inside one microtask batch and their callbacks run before the serialized queue resumes. They stay, and the reason is recorded at the first of the four — that proof rests on dispatch timing outside the file, while a latch does not. Two remaining legs are likewise recorded rather than pinned: the false arms of the two `if (dbPromise …)` guards inside `open()` are excluded by the invariant that a slot is only replaced by the path that clears it, and `invalidate`'s rejection handler is the only thing between a racing open failure and an unhandled rejection, but reaching it needs a scheduled failure to land while a rejecting reopen is still in flight. No behaviour change.
- The trace reporter's `sink` default keeps its zero-count arm and now says what that zero measures. `sink` is a **required** member of `DataBusTraceOptions` and `docs/configuration.md` documents it as Required in en and zh, and `DataBusTraceReporter` has no package export, so the only caller that can select `?? (() => undefined)` on an active reporter is untyped JavaScript. The reason the arm reads 0 is narrower than it looks: the branch region begins inside the arrow's body, so the counter tracks that closure's **invocations**, not the `??` selection. Measured both ways — a coverage run of `tests/property.test.ts` alone selects the default 300 times (a no-arg reporter is inert, since `enabled` defaults to false) and still reports `[300, 0]`, while a single `enabled: true` construction that emits two events moves it to `[2, 2]`. Deleting the default — cast in place so the field type still checks out — leaves all 884 tests green and turns each of those two emissions into a `[cross-tab-worker-databus] trace sink threw:` `console.warn` carrying a `TypeError`. Nothing in the supported surface reaches it, so it is recorded at the site rather than pinned with a cast that fakes a forbidden call; the earlier classification stands, and what changed is that the site now carries the measurement instead of the prose. `AGENTS.md` gained the general rule, because a repo-wide scan for arms whose region opens on an arrow function found this one as the only instance and the shape is easy to misread as "no caller omits the sink". No behaviour change and no coverage movement.

### Tests
- Both seeded invariant harnesses were run far past the depth they ship with, to find out whether anything is left for them to find: `coordination-invariants` completed **400,000 of 400,000** seeds in 753.7 s and `lifecycle-invariants` **200,000 of 200,000** in 262.6 s, both green, with no owner-uniqueness, transport-holder, exactly-once-fan-out, departed-topic or lifecycle-flag violation and no entry in either failure list. The first attempt at that depth did not fail but looked like it: the runs died at exactly 120 s with a bare test timeout, because each `it()` passes its own ceiling as a third argument, and a wall-clock fuse, a seed cap, and that ceiling are three separate limits. The two harness headers now carry the measured rates and that three-limits note, so the next reader knows the shipped 5,000 / 1,500 are a CI-time compromise and not a sufficiency claim, and knows a unit run scheduled *beside* a sweep like this one starves (19 minutes without finishing, against 12.2 s on an idle machine). No change to the shipped constants.
- The shared-mode teardown E2E was asserting on the demo server's **global** connection count, and that is not a per-test number: `playwright.config.ts` runs specs in parallel, so every other spec with a live tab contributes. `--repeat-each=3` reproduces it — three copies of the test, each waiting for exactly two of six connections, and all three time out at the precondition. It also passed vacuously when it did pass: on a passing run the two sockets behind the "2" were one subscriber of the test's own channel and one subscribed to **nothing**, because in a shared cluster only the owner transport subscribes a channel. Neither defect is load, which is what every previous adjudication of this spec assumed. The assertions now address sockets by the channel each holds — `uniqueTopic()` already makes those names private to the test — and say the thing the name always claimed: the closed tab's socket id leaves the server's list, *and* the surviving tab's id is still in it after the close, which a count cannot distinguish from a server that dropped both and let the survivor reconnect. `/debug/connections` gained `details: [{ id, ageMs, channels }]` to make that addressable (`centrifugo` is unchanged), the socket's accept time is pinned in `tests/demo-centrifuge-server.test.ts` alongside its id, and the test polls the whole trajectory and logs the reap latency — measured at 27–32 ms in one poll, so the 45 s budget is three orders of magnitude of headroom and any future failure arrives with the evidence to say why. Ownership of each topic is waited for as a precondition rather than assumed, since channel-based addressing is only valid while the cluster keeps each topic with the tab that asked for it. 36 E2E tests pass, and the same spec now passes under `--repeat-each=3`, which is the run that broke the old version. `AGENTS.md`'s E2E bullet now states the counter rule beside the `uniqueTopic()` rule it broke, including why two tabs of one shared topic show as one channel-carrying socket and one with none.

### Documentation
- `docs/api.md` said that no public trace event contains a raw topic. It was false, in English and in Chinese, and `docs/configuration.md` documented the opposite in both languages: subscription events carry their topic so an integrator can correlate an ownership change with the channel it moved, and that page then tells the reader to redact topic conventions before forwarding a sink to telemetry. The code has always been with `configuration.md` — `traceSubscription()` puts the plaintext topic in the event, and the route-scoped `reliability` operations do the same. The corrected sentence in both languages now states what was measured instead: no event carries a message payload, a connection address, or an error body; topic plaintext appears in `subscription` and in `reliability` when it names a route; every other event is topic-free and `coordination` identifies routes by their opaque `topicKey`. Because a shipped document making a false privacy claim is what this is, the correction is a patch release on its own. Pinned by `keeps message payloads and error bodies out of trace events, and names the event that carries a topic` in `tests/data-bus.test.ts`, which drives a payload sentinel and an error-body sentinel through a real bus and asserts the sink sees neither: leaking `lastFailure.message` into the `error` event fails that test and nothing else in the file (1 failed, 187 passed), so the absence claim had no witness before this. The same test asserts which event types may name a topic, which is a duplicate of the existing coordination-format assertion for the route half — recorded as such rather than claimed as new coverage.

## [0.21.7] - 2026-09-23

### Changed
- Four more zero-count legs in three modules are now labelled with the enumeration that covers them, each measured by deleting it and running the suite: `PortReaper.reap()`'s two `??` fallbacks (the three maps gain a port only in `register()` and lose one only together, so a port in `targets` is in the other two; the fallback stays because a half-registered port would read as silent since the epoch and be closed on the next tick), `CentrifugeWorkerTransport.startHeartbeat()`'s already-armed guard (`start()` returns early while a backend exists, and the two routes to `backend === null` both clear the heartbeat first; the guard is the only thing preventing a double-armed interval that `clearHeartbeat()` — which holds one handle — could never cancel), and `CentrifugeSession.postPublication()`'s empty-topic drop (its two callers test emptiness or key a map this session only fills from a SUBSCRIBE frame, and an empty topic is undeliverable downstream anyway: `topicMatchesPattern` answers false for both `*` and `prefix.*` against `''`, measured, and `subscribe('')` throws). All four survive deletion with all 37 test files green, so none is a gap; none is counted closed, and there is no coverage movement. The TypeScript 7 re-check landed the same way — newest release 8.70.1 and newest canary 8.70.2-alpha.4 both still peer on `<6.1.0`, recorded in the roadmap with the date and the two versions that were queried.
- The WebSocket transport's connect-timeout guard now has a test, and now says what kind of leg it is. The callback opens with `if (this.socket !== socket || this.handlers !== handlers || handshakeCompleted) return;` and the third term had never executed, because a completed handshake has no live timer to fire: `onopen` cancels it directly and `settleConnect()` cancels it again. Measured — deleting only that term leaves the whole suite green, so it is dominated rather than untested; deleting the term *and* both cancellations makes the transport report `onStatus('error')`, call `onError`, and abort a socket that had already connected, which with the 30-second default budget is a healthy connection killed seconds after it opened. The term therefore stays, and `never lets the connect timer tear down a handshake that already completed` in `tests/websocket.test.ts` now pins the pair: measured, it passes with the term deleted, with the `onopen` cancellation deleted, and with both cancellations deleted, and fails only when the term goes with them. No behaviour change and no coverage movement.
- The re-subscribe loop's supersession `break` in `start()` now carries its own measurement, in the same spirit as the leg below: two re-entrant callbacks were built to reach it and neither made it observable. A `stop()` issued from the transport's own `subscribe()` leaves the subscribed set at `['first']` whether the `break` is live or disabled, because a stopped cluster's `subscribe()` is inert; a re-entrant `start()` leaves it at `['first', 'second']` either way, because the newer lifecycle replays the remaining topic itself and `subscribeTransport()` absorbs the duplicate the superseded loop would have issued. Verdict recorded: executing and redundant in the reachable scenarios, not dominated — kept because it is the only thing between a superseded opening and writing subscriptions into whichever transport is installed now. A test was written for the first scenario, passed, and was deleted once the same mutant passed it too, because pinning a sequence that does not depend on the leg would leave the next reader trusting a coverage win that is not there. No behaviour change and no coverage movement; `data-bus.ts` still reports twelve branch arms with a zero-count slot, unchanged by this pass and by the one below it — two of the twelve are the legs those passes measured, and the rest are recorded in earlier entries as dominated-by-enumeration or kept-for-asymmetric-failure.
- The `startDemandRecovery()` status guard now carries its measurement instead of silence. It is the one arm of the recovery ledger that resisted construction, and the reason matters for anyone tempted to delete it: `suspended` and `stopping` are excluded at both call sites by their own precondition checks, so only `status !== error` can take it, and that needs an `updateStatus()` away from error which neither releases the gate nor consumes the demand token. Two sequences were built against that description and both measured false — a transport-level reconnect after a failed automatic attempt (the token had already been consumed, so the earlier guard returned and the write went straight out), and the same with a `disconnected` status (a later automatic attempt reopened, so the reopen-count assertion failed). The first attempt also produced a test that passed while proving nothing, which is why the entry records the measurements rather than the arm being relabelled "dominated". It stays an open zero-count leg, kept because deleting it would let any of those futures reopen a connection that is reported up. No behaviour change, no coverage movement.

### Tests
- The coverage floors had drifted into advisory territory: `vitest.config.ts` required 96 / 92 / 96 / 97 while the tree measures 99.01 / 96.74 / 99.26 / 99.69, so a change could lose more than four points of branch coverage — most of one module — and still pass the release gate. Re-measured before tightening: three consecutive local runs agreed to the last decimal, and CI's own "Coverage thresholds" step reported the identical four numbers for the same tree, so the margin is not there for measurement noise. The floors are now 98 / 96 / 98 / 99, with the remaining headroom reserved for the one genuinely runner-dependent input (the seeded fuzzers bound depth by wall clock, so a loaded box explores fewer interleavings than this one). Teeth verified rather than assumed: raising `branches` to 99 fails the run with `ERROR: Coverage for branches (96.74%) does not meet global threshold (99%)` and a non-zero exit, so losing ~1.3 points of branch coverage now stops a build instead of sailing through. `docs/release-checklist.md` and its Chinese counterpart quote the new figures.

### Documentation
- `docs/architecture.md` and its Chinese counterpart gained a "Receiver-side frame validation" section: the three checks that are now part of the wire contract (`targetWorkerId` names this worker, `topicKey === createOpaqueKey(topic)` on both point-to-point frame types, and a batch frame must carry a non-empty array), what each one prevents, and — equally important for anyone debugging a silently ignored frame — the two things deliberately *not* checked (`EVENT` payload fields beyond shape, and batch item content). The rules existed only in code comments and `AGENTS.md`, which is the maintainer-facing document; an integrator running a non-JS peer or a custom `ClusterEnvironment` needs to know that a mismatched key/topic pair is dropped without any response, and that a batch with zero items is not a no-op but an ignored frame.
- `docs/api.md` (and its Chinese counterpart) promised that replay buffers are "cleared when the last handler for the topic unsubscribes", which is true of an exact topic and false of a wildcard: the rings a pattern fills are keyed by the concrete publication topics, so `unsubscribe("chat.*")` releases delivery only — the durable cleanup is called with `chat.*`, a key no row lives under, and the in-memory rings stay with whatever still owns them. Measured before rewriting the text: two concrete topics from three publications under one pattern stayed at `{ topics: 2, messages: 3 }` across the unsubscribe and were redelivered in full by a later `replay: true` subscribe. The docs now say which key each cleanup addresses, that `maxPerTopic` bounds ring *depth* and never the number of rings a wide pattern creates, and what to call instead (`clearReplay()` / `clearReplayTopic()` / `retentionMs`). No behaviour change: pattern-aware pruning would evict topics another live subscription still owns, which is a product decision rather than a doc fix. Pinned by `leaves the concrete topics a pattern filled when the pattern is unsubscribed` in `tests/data-bus.test.ts`.

### Coverage
- The hydration catch in `replay-manager.ts` had an arm that no test reached: `if (epoch !== this.hydrationEpoch) return;` inside the `catch`, which is what stops a load rejection belonging to a *superseded* snapshot from speaking for the session that replaced it. `resetBuffers()` bumps the epoch but not the retry generation, so the rejection arrives with the generation still current and the only thing between it and `onPersistenceError()` is that line — and the same arm also owns `hydrationComplete`/`hydrationFailed`, whose latch is what `requestHydration()` short-circuits on. Dropping it therefore reported a phantom persistence error *and* left durable history unloaded for the rest of the instance's life. Now pinned by `does not let a superseded hydration failure speak for the replacement session`, which fails against the deleted guard as `expected [ Error: stale load failed ] to deeply equal []`; `replay-manager.ts` branch coverage 95.15% → 95.75%, whole suite 98.98 / 96.69 → 99.01 / 96.74 over 881 tests.
- Four zero-count legs in the same module are now labelled with the condition that covers them instead of left as an open question, none of them deleted and none of them counted as closed: `hydrate()`'s own `!this.buffers || !this.persistence` (the single caller tests the identical pair immediately above, and it stays because the body reads both through `!` assertions); the post-`load()` generation check (the retry wrapper re-tests the same thing before returning, and the only bump site also raises the epoch, so the next line would catch it — the difference is a reported cancellation vs a silent drop); the `: new PersistenceRetryCancelledError()` wrap in the cancellation catch (the wrapper converts any error that arrives after a bump into that error first, so the value is already one); and `scheduleRetentionCleanup()`'s capability check (both callers test the same capability before calling). `withPersistenceRetry()`'s loop-top generation check is dominated on every pass by construction — iteration 1 captures the generation two statements earlier with no await between, and later iterations arrive only through the identical check at the end of the catch — and is kept as the loop's own statement of its contract.
- Re-derived the whole-repo zero-count ledger from `coverage/coverage-final.json` rather than from the per-module notes, which had drifted: `cluster.ts` 22 arms (the 0.21.4-era note said 19), `data-bus.ts` 12 (recorded), `replay-manager.ts` 8 → 7, `replay-persistence.ts` 8, `websocket.ts` 3, `centrifuge.ts` 2, `trace.ts` 3, `port-reaper.ts` 3, `centrifuge-session.ts` 1, `version.ts` 1, `validation.ts` 1. `version.ts`'s is the `SDK_VERSION` fallback and is statically dead in every artifact that ships — both bundles inject the `define`, so the `typeof` test can only read `'string'`; its `''` arm exists for a consumer that bundles `src/` with no define, which no in-tree build does.


## [0.21.6] - 2026-09-22

### Fixed
- A batched `PUBLISH` control frame is now dropped unless its `items` is a real, non-empty array. `handleControlMessage` gated the batch on `message.items && message.items.length > 0` and then either iterated it or handed it straight to the batch handler, and `publishBatch()` is the only producer — it builds `items` with `Array.prototype.map`. A hand-built frame could therefore carry a `length` without an iterator (`{ length: 2 }`), which threw a `TypeError: message.items is not iterable` out of the cluster's own `BroadcastChannel` listener, or an iterable non-array (`"ab"`), which reached the transport as two publications whose `data` was `undefined` — under the receiving worker's own session, on a channel the sender does not own. Presence and emptiness are checked in one place because a frame with `items` carries no `data`: previously an empty batch satisfied neither half of the old test and fell through to the single-publication tail, publishing `undefined` once instead of nothing. Legitimate traffic is untouched, including a cross-worker `publish(topic, undefined)`, whose frame simply has no `items` key. Item *content* stays unvalidated by decision, recorded in `AGENTS.md`: `{ data: anything }` is what a well-formed item looks like, so per-item shape checks stop nothing a conforming frame cannot do, and `messageId`/`timestamp` are only forwarded into `transport.publish()` where the receiving side already discards a non-string id and a non-finite timestamp. Pinned by two forged-frame tests that each fail three different ways against the old gate, and separately against a guard that keeps only the array check or only the empty check, so both halves are shown to be load-bearing on different legs.

- A `ROUTE_RELEASED` ACK can no longer complete a handoff under a channel name the recipient does not own. This is the second instance of the 0.21.5 substitution, in a handler the 0.21.5 guard never covered: the pairing check landed in `handleControlMessage`, while `handleRouteReleasedMessage` reads both `topicKey` and `topic` too — it authorizes itself against the durable route stored under the key, then writes the frame's plaintext into `assignedTopics` and subscribes the transport to it. Route records are ordinary localStorage, so a same-origin script that knows the cluster key can read the real `topicKey`, the previous owner's id and the generation, satisfy all three staleness checks, and answer an in-flight handoff with its own channel name; measured before the fix, the recipient's `onControl` fired twice for a topic nobody had subscribed. The ACK senders derive the pair (one of them reads it back out of `assignedTopics`, which only this hole could poison), so conforming peers are unaffected. Pinned by a forged-ACK test that fails without the guard, alongside the existing generation and previous-owner staleness pins that already covered this handler.

### Coverage
- The `recoveryExhausted` one-shot is now pinned, which closes the last arm on the `data-bus.ts` ledger that a mutation had been shown to survive. `caps automatic recovery attempts…` already asserted "exactly one `exhausted` diagnostic" a second time after the cap was spent, and that second assertion had never re-entered the branch: once the last reopen has failed, the handlers installed on the transport belong to a superseded lifecycle, so `isCurrentLifecycle()` drops a subsequent `setStatus('error')` before the attempt counter is reached — measured with a spy, `updateStatus` ran zero times for such a call. Deleting the guard therefore passed the whole suite. The test now drives a second failure through the path an application actually takes after exhaustion — an explicit retry, which reopens and installs a live closure — and while that reopen fails, `recoveryExhausted` is still set because the only reset on the path sits in the success arm. With the guard made unconditional the test now fails as `expected […] to have a length of 1 but got 2`. `data-bus.ts` uncovered branch arms 13 → 12 and its branch coverage 97.01% → 97.24%, both measured on this module before and after; on the rebased tree whole-suite coverage is 98.98 / 96.69 / 99.26 / 99.69 over 879 tests. No source change.

## [0.21.5] - 2026-09-22

### Changed
- The last two "hunt this for a test" items on the `data-bus.ts` arm ledger turned out to be unreachable by their own call sites, and now say so. `getQueuedStartReady()`'s `if (!queued)` rejection and `queueStartAfterStop()`'s `if (this.queuedStart) return this.queuedStart` dedupe each sit behind an *identical* check performed one statement earlier by the only caller (`ready()` and `start()` respectively), synchronously, with nothing in between that could run user code. Neither was deleted, for the asymmetric-failure reason: dropping the first replaces a documented `"No queued start is in flight."` rejection with `TypeError: Cannot read properties of null` for any future second caller, and dropping the second lets one burst of operations behind a single stop queue several restarts, which is exactly the contract that line states. Zero coverage movement, measured after rebasing onto #177: `data-bus.ts` stays at 14 uncovered branch arms and 2 uncovered functions, 37 files / 874 tests.
- Two `openTransport()` conditions with permanently false arms, one of which had a comment describing a case that cannot happen. The `this.pendingStop === chainedPendingStop` check explained itself by "a stop created concurrently (e.g. by `suspendTransport()`) is a different promise", and the `!this.suspended && !this.stopping` guard below it explained nothing at all; the enumeration that rules both out is the same one. `pendingStop` is written in four places — this line, the failed-open cleanup, `performStop()`'s finally and `suspendTransport()`'s chained stop — and of those, the three that could change it out from under this continuation all run behind a `lifecycleEpoch` increment, while `suspended` has one writer and `stopping` two and each raises its flag only after bumping the epoch. An opening whose captured epoch is still current therefore cannot observe either condition false. Both stay uncovered by construction, so this moves no number; both are kept, because the asymmetric failure is the one worth guarding — an unconditional `pendingStop = null` would drop a live stop and let `stop()` issue a second `transport.stop()` the moment any transition suspends without superseding, and a dropped ready-guard would mark a hidden transport ready.
- A comment in `createStopPromise()` that asserted the opposite of the truth: it claimed `performStop()` "never rejects", which had turned the rejection arm of the teardown gate's `.then(f, g)` into prose-evidenced defensive filler. It can reject. Its `catch` reports through `reportError()` → `notifyError()` → `invokeHandlers(errorHandlers, …, ERROR_HANDLER)`, and that leg absorbs a throwing error subscriber only by writing to `console.warn` — so a subscriber that throws *and* a `console.warn` that throws escape the `catch` and reject the teardown. The comment now names that chain, and names which half of the arm is load-bearing: `resolveGate()` is the only thing that ever settles `await bus.stop()` on this path (the transport shutdown has already finished, so nothing else can wake the caller), while the `stopPromise = null` beside it is defensive for the reason `stop()`'s own comment already gives — `stopping` is authoritative and a settled gate is stale — which is measured, not argued: deleting that line changes no assertion in the file.
- One redundant rejection handler deleted from `reopenTransport()`, on a proof that needs no enumeration: the `opening.then(onFulfilled, onRejected)` a few lines above passes an `onRejected`, which registers *that* as a handler of `opening` — so `opening` can never surface as an unhandled rejection on that path whatever it rejects with, and the trailing `void opening.catch(() => undefined)` could only ever duplicate a handler that was already installed. Unlike the `0.21.2` / `0.21.3` deletions this argument rests on Promise semantics rather than on a list of assignment sites, which is also why it does not depend on `reportError` staying total.
- The two rejection swallows that remain in that method are now each labelled with what they actually are, because they are two different kinds of leg and only one of them is deletable. The early-return arm's `void opening.catch(...)` is the *only* handler that opening ever gets on that path (`resumeTransport()` calls with `void`, and the `.then(f, g)` below is unreachable from the arm), so it is a guard, not a gap. The one at the top of the method is dominated — `pending` provably resolves — but is deliberately kept, and the reason is recorded with a measurement: forcing `pending` to reject fails exactly one test whether the line is present or deleted, so nothing asserts the premise; with the absorb a superseded resume still reopens, without it the bus silently stays closed after a pageshow. A guard whose deletion turns "degraded" into "stuck" is worth its uncovered function.
- Corrects a claim this pass initially made about itself: the deleted handler was **not** one of `data-bus.ts`'s three uncovered functions — its callback ran in existing tests, so the module's uncovered-function count stays at three and its uncovered-line count is unchanged. What was removed was a handler that executed and could not matter. Coverage movement here is zero, and saying so is the point: the change is justified by the proof, not by a number. (That count of three is the state *at that change*; the `createStopPromise()` arm below is what actually moved it.)

### Fixed
- A control frame can no longer rename the channel its recipient owns. `topicKey` is a pure function of `topic`, so every frame this library sends has the two agreeing — but `handleControlMessage` checked only `targetWorkerId` and the durable route, both keyed by `topicKey`, and then used the frame's `topic` as the plaintext to remember, assign, and hand to the transport. A `BroadcastChannel` is unauthenticated: any same-origin script can post into it, and one frame carrying a real `topicKey` next to an arbitrary `topic` would have that worker take ownership *under the substituted name*, because the route authorization passed. Incoming control frames are now rejected when `createOpaqueKey(topic) !== topicKey`. Legitimate peers are unaffected — measured on the full suite, including the coordination fuzzer, which forges frames with the two fields deliberately consistent — and the new test fails without the guard as `expected "vi.fn()" to not be called at all, but actually been called 1 times`.
- The seeded fuzzers' wall-clock fuse could not fire on exactly the runner it was written for. Both harnesses bounded depth with `if (completed >= MIN_SEEDS && elapsed > SEED_BUDGET_MS) break`, so a host too slow to clear the depth floor inside the budget never became eligible to stop: the sweep ran as long as the machine was slow and then died on the test's own 120s ceiling reporting nothing but `Test timed out`. Reproduced on `main` (1,046/5,000 seeds after 509s against a 60s fuse, no invariant violation) and twice on a PR that turned out not to be the cause. The budget is now unconditional and the floor stays an assertion, so a slow runner degrades depth and says so in ~60s instead of hanging for ~8 minutes; demonstrated locally by setting the budget to 0 — the gated form still ran 100 seeds and passed, the unconditional one stops at once and fails with `explored only 0 seeds`.
- The budget clock had a single source whose immunity was contextual rather than inherent. `realNowMs()` trusted `node:perf_hooks`' `performance`, which survives fake timers only because the global binding and that export are different objects in some Node contexts; a worker thread makes them the same object, so a fake-timer configuration that includes `performance` freezes the budget at 0 elapsed. It now takes the max of that source and `process.uptime()`, which no fake-timer toolbox replaces — measured by blocking 250ms of real time inside a fake window with `Atomics.wait`: `node:perf_hooks` 260, `process.uptime()` 260, and global `performance.now()`, `Date.now()` and `process.hrtime.bigint()` all 0.
- The clock's own pin asserted only the harmless direction. "60 simulated seconds must not cost 60 measured ones" passes trivially when the clock is frozen, so it could not have caught the bug above; the pin now also requires that real blocked time inside a fake window still measures as having passed. Verified against a mutant returning a constant: it passes the original assertion and fails only the new one.
- A truncated sweep now logs its slowest seed next to the depth reached. A fuse sampled between iterations cannot bound an iteration, so a seed that wedges on an `await` needing a timer the fake clock never advances was previously visible only as an unexplained total.

### Coverage
- `src/core/data-bus.ts` goes from 17 uncovered branch arms to 16 by pinning the right operand of `return this.stopPromise ?? Promise.resolve()` in `start()`'s superseded-resume arm. Only a re-entered `stop()` ever assigns `stopPromise`, and the re-entry that reaches *this* line is a re-entered `start()`, which bumps the epoch with no stop in flight and leaves it null — so the fallback had never been taken in any test. The contract it protects is `start()`'s declared `Promise<void>`: replacing the line with `return this.stopPromise!` makes the new assertion fail as `expected null to be an instance of Promise`, which is the shape a caller would meet at `bus.start(c).then(...)`. The count is re-measured on this branch rather than inherited from the `0.21.4` entry, since `reopenTransport()` changed the same file in between.
- Whole-suite 98.84 / 96.46 / 99.08 / 99.57 over 37 files / 872 tests, against unchanged ceilings of 96 / 92 / 96 / 97.
- `data-bus.ts` then goes 16 uncovered branch arms → 15 and, for the first time in this ledger, three uncovered functions → 2, because the leg that closed is a handler *function* that had never been entered: `createStopPromise()`'s rejection arm. Driving it needs the double failure that its corrected comment rules out — an error subscriber that throws plus a `console.warn` that throws — and its remaining half is the fall-through of `if (this.stopPromise === stopGate)`, i.e. a stop whose gate had already been replaced by a newer one. Module totals move 97.9 / 96.32 / 97.43 / 98.86 → 98.38 / 96.55 / 98.29 / 99.24 with the whole suite at 98.94 / 96.52 / 99.26 / 99.65 over 37 files / 873 tests. Teeth were checked on the load-bearing statement, not on the arm: deleting `resolveGate()` from that arm fails the new test as `expected 'hung' to be 'settled'` in 250ms, and deleting the `stopPromise = null` next to it leaves all 184 tests in the file passing, which is why the comment calls one a contract and the other defensive.
- `data-bus.ts` goes 15 uncovered branch arms → 14 (functions stay at 2) by pinning the second conjunct of `invokeHandlers()`' logging guard. A throwing error subscriber is absorbed by writing to `console.warn`, and that write is conditional on `typeof console.warn === 'function'`; with a console that has no `warn`, an unguarded call would raise `TypeError: console.warn is not a function` from inside the handler meant to contain the failure — out through `reportError()`, out of the dispatch loop, into the transport's message callback. The new test stubs such a console and asserts the publication dispatch does not throw and the dispatch failure still lands in the unified ledger. Mutation-checked: dropping the conjunct fails it as `expected [Function] to not throw an error but 'TypeError: console.warn is not a func…' was thrown`. Whole-suite branch coverage 96.52 → 96.57, statements/functions/lines unchanged, 37 files / 874 tests.
- One arm was *not* closed, and the attempt is recorded so it is not re-attempted blind: `if (!this.recoveryExhausted)` inside the exhausted-recovery branch still has no test that takes its false arm. The first hypothesis — that the existing `caps automatic recovery attempts` test never really reached the second exhaustion because its environment clock was a constant — was measured with a scratch probe against the unmodified test and was **false**: `attempt` reaches 3 and exactly one `exhausted` event is emitted even with the frozen clock, so the assertions there are not vacuous and the speculative rewrite of that test was reverted rather than shipped with its (now disproved) comments. What the probe did establish is that a fourth `setStatus('error')` does not advance the attempt counter at all, for reasons the ledger does not yet explain, and that making the guard unconditional emits no second event — so no current assertion depends on that leg either way.

- `data-bus.ts` goes 14 uncovered branch arms → 13 by pinning the `default:` arm of the cluster's `onControl` handler, which is a live leg rather than a defensive one: the BroadcastChannel a cluster listens on is unauthenticated, and `handleControlMessage` forwards `message.action` straight through — its own `switch` has a `default: break` that *falls through to the same call*, then runs load accounting because the verb is not `PUBLISH`. So the handler's `default: break` is the only thing preventing an unknown verb from being acted upon as one of the three known ones. The new test posts a `CONTROL` frame with `action: 'DESTROY'` at the bus's own worker id over the cluster channel and asserts no publication handler ran, no transport subscribe/unsubscribe/publish call appeared, and the bus still reports healthy. Teeth verified by mutation: making the arm act on the topic fails the test as `expected [ 'topic' ] to deeply equal []`. Suite is 37 files / 875 tests.

### Tests
- Both seeded fuzzers now announce their depth *while* sweeping, not only after: the first five seeds and then every fiftieth print `starting seed N at <elapsed>ms (depth D)`. This exists because a runner killed by the test's own 120s ceiling produces `Error: Test timed out in 120000ms` and nothing else — the truncation log the fuse writes sits after the loop, so it never runs on exactly the failure it was written to explain. With the heartbeat the same log says whether the sweep was merely slow (depth climbing, elapsed growing) or wedged inside one seed (last line `starting seed 7`, no successor), and those two have different fixes.

### Documentation
- `AGENTS.md` corrects the claim that the budget clock "is immune wherever it is called" to what was measured, records that the depth floor must never gate the fuse, and adds the rule that a clock guard has to be pinned in both directions — with `blockRealTimeMs()` as the way to do it, since a `while (Date.now() < stop)` busy wait never terminates inside a fake window where `Date` is frozen.
- `AGENTS.md` gains the tier distinction these two legs demonstrate (a guard that is dominated, a guard that is the only handler, and a handler that runs but is redundant are three different verdicts, and only the middle one is a coverage gap), and the stale cross-reference from `reopenTransport()`'s `activeConfig` guard to `performStop()`'s absorber — deleted in `0.21.2` — now points at the live comparison in the same method.
- `AGENTS.md` gains the rule this pass was written by: a comment that a promise "never rejects" is a claim about every path through the handler it runs, not about the happy path, and when such a leg is the only thing that settles an `await`, construct the throw instead of trusting the prose. It also records the shape to prefer for that pin — race the promise against a short real-timer watchdog, so deleting the leg fails as `expected 'hung' to be 'settled'` rather than as a test timeout that names nothing.
- `AGENTS.md` adds the discipline this pass's discarded change was bought with: measure a "this test passes vacuously" theory against the *unmodified* test before rewriting it, because the rewrite brings a comment that the next reader will trust. is a claim about every path through the handler it runs, not about the happy path, and when such a leg is the only thing that settles an `await`, construct the throw instead of trusting the prose. It also records the shape to prefer for that pin — race the promise against a short real-timer watchdog, so deleting the leg fails as `expected 'hung' to be 'settled'` rather than as a test timeout that names nothing.



## [0.21.4] - 2026-09-22

### Fixed
- Reporting a failure can no longer throw. `recordError()` rendered the rejection reason with `String(error)`, and that coercion is not total: `String(Object.create(null))` throws `TypeError: Cannot convert object to primitive value`, and any object can carry a `toString` that throws. Since a transport may reject with any value — `DataBusTransport` is a public, application-implemented port — one class of transport failure used to produce a second, unrelated failure from inside the code reporting the first. The same unguarded coercion also sat in `getRecoveryStats()`, so `getHealthSummary()` threw for a bus whose last failure was unstringifiable: the probe that is supposed to explain an outage refused to answer during one.
- Concretely, a retry after a failed open whose cleanup *also* failed never reopened the transport. `createStopPromise()`'s terminal `.catch(error => this.reportError(error))` ran the thrower, so `pendingStop` rejected, `start()`'s chained `.then()` was skipped, `transport.start()` was never reached, and the caller got `TypeError: Cannot convert object to primitive value` — a message about the formatter's limits rather than about their transport. Failure messages now go through `describeFailure()`, which is total and renders such a value as `[unstringifiable object]`; both ledgers are guaranteed to describe the same failure identically.
- This also restores the premise that `0.21.2` and `0.21.3` were built on. Both removed rejection-absorbers by enumerating `pendingStop`'s assignment sites and concluding each chain "ends in a terminal `.catch(error => this.reportError(error))`, therefore resolves". The enumeration was right; the last step silently assumed `reportError` cannot throw. It is now stated as what it is, in the comments at both sites and with a test that drives the double-failed-open chain end to end, so the removals rest on something checked rather than assumed.
- The same defect shape was fixed one layer out, in the option validators: `assertPositiveSafeInteger()`, `assertPruneStrategy()` and `assertHeartbeatInterval()` interpolated caller input with `String(value)`, so constructing a bus with a null-prototype option failed with the formatter's `TypeError` instead of the documented complaint about the option — and in `assertPruneStrategy()` the coercion is the membership test itself.

### Added
- `describeFailure(error)` in `src/utils/error-utils.ts`, alongside the `serializeError()` that already avoided this trap. Internal helper; no public export changed.
- `FakeTransport.stopRejection` selects the *reason* a failing `stop()` rejects with, where `stopShouldFail` only selected the fact. `toThrow(TypeError)` could not have caught this bug — the formatter's error is also a `TypeError` — so the new assertions check the message, and one of them asserts the pre-existing `toThrow(TypeError)` shape would have passed either way.

### Coverage
- Whole-suite 98.85 / 96.41 / 99.08 / 99.57 over 37 files / 871 tests, against unchanged ceilings of 96 / 92 / 96 / 97. `src/utils/error-utils.ts` is now clear at both tiers (zero uncovered lines, arms and functions); `src/core/data-bus.ts` keeps 17 uncovered branch arms, which is a different claim and is recorded as such.


## [0.21.3] - 2026-09-22

### Changed
- Two more unreachable rejection-absorbers removed from `CrossTabDataBus`, with no behavior change: `queueStartAfterStop()` swallowed a rejection of `stopPromise` (whose only non-null assignment is `stop()`'s hand-resolved gate, resolved from both settle arms — that is what keeps the public `stop()` non-rejecting), and `openTransport()` swallowed one for its `before` argument (either `Promise.resolve()` or `pendingStop`, and every non-null `pendingStop` chain ends in a terminal `.catch(error => this.reportError(error))`). Each arm had been permanently uncovered; the premises are enumerations of assignment sites and are written into the source next to the code.
- Whole-repository coverage ceilings unchanged (96 / 92 / 96 / 97) and met; `src/core/data-bus.ts` function coverage goes 115/120 → 115/118 by deleting the two dead handlers, with no test removed or weakened. The module's remaining uncovered handlers are now three, each documented with the reason it is kept (`performStop()`'s last-resort rejection arm) or the enumeration that still owes a proof.
- No export, protocol or observable behavior changed; `verify:compat` is green against `v0.21.2` by construction.

## [0.21.2] - 2026-09-22

### Changed
- One unreachable defensive branch removed, with no behavior change: `performStop()` awaited its pending transport stop through `.catch(() => undefined)`, but that absorption could never run — `pendingStop` is assigned non-null in exactly two places (`openTransport`'s failure path via `createStopPromise()`, and `suspendTransport()`'s stop chained behind the in-flight open) and both chains already end in a terminal `.catch(error => this.reportError(error))` that resolves, so the failure is recorded where it is produced. The neighbouring `startPromise?.catch(() => undefined)` is kept, because that promise *does* reject: it holds the opening a failing `ready()` reports to its caller. Naming which kind of arm each one is is now written into the source and into `AGENTS.md`, since the difference decides whether deleting it is a cleanup or a regression.
- No public surface, no observable behavior and no protocol changed; `verify:compat` is green against `v0.21.1` by construction. Whole-suite coverage moves from 98.68 / 96.16 / 98.54 / 99.45 to 98.71 / 96.16 / 98.72 / 99.45 (one fewer uncovered function, no test deleted or weakened).

## [0.21.1] - 2026-09-22

### Added
- `pnpm build:examples` bundles the React example page's framework dependencies (`react`, `react-dom/client`) out of the local install into `examples/react/vendor/react.esm.js`, which is gitignored and regenerated by `pnpm examples` and `pnpm test:e2e`. React ships no browser ESM build, so the page used to import React from `esm.sh` — which meant it could not load where CI has no network, and it was pinned to React 18 while the library's own React tests run against 19.

### Changed
- `e2e/adapters.spec.ts` now drives both example pages with one set of cases (fan-out, reactive rebind, delivery after the owning tab closes, and the cleared-topic-box fallback), because the two pages expose the same surface: `#topicInput`/`#publishButton`/`#messageList` ids, a `?topic=` override, and a `__vueBus`/`__reactBus` diagnostics hook. The React page gained those ids, the query override, a topic badge and the hook — it hand-wires the core API rather than importing `cross-tab-worker-databus/hooks`, so a failure that shows up for one page and not the other localizes to the adapter instead of to the library. All four cases pass against both pages, and the fallback leg was verified by mutation on each.
- `docs/getting-started.md` (en + zh) records that both adapter pages are browser-covered and need no network.
- One correction to the `0.21.0` entry below: it named the React adapter `cross-tab-worker-databus/react`, which is not an export this package has (`cross-tab-worker-databus/hooks` is). The published `0.21.0` release notes keep the original wording — npm versions and GitHub releases are not rewritten — so this fixes it for anyone reading between tags.

## [0.21.0] - 2026-09-22

### Breaking
- `subscribe("")`, `publish("")` and `publishBatch("")` now throw a `TypeError` instead of being accepted. This is the removal step of the cycle opened in `0.20.96`, which warned once per instance and changed nothing else; it follows the pre-1.0 policy, and no other behavior of those three calls moved. An empty topic routes as a literal channel that no transport can address, so the subscription it created could never receive anything and a publication to it was dropped without a trace — the call now fails where the mistake is made, the same way an invalid `replay.maxPerTopic` does. The guard runs as the first statement of each method, so a rejected call also starts no transport, registers no handler and writes no route record. `publishBatch("", [])` throws too: the argument is checked ahead of the documented empty-array no-op. **Migration:** pass a real channel name. Where the topic comes from user input or a config field, validate or fall back before calling — `input.trim() || 'demo.flow'`, which is what the bundled example pages do.

### Changed
- `examples/react` and `examples/vue` now resolve their topic as `topicInput.trim() || <default>`, matching what `examples/demo` already did, because their boxes feed a reactive subscription and would otherwise hand `""` straight to the bus. The failure mode the fallback prevents is measured rather than assumed: with it removed, the Vue page keeps rendering its *previous* topic while a `TypeError` escapes to `pageerror`, and the demo page lands on 错误 with an error-feed row that never mentions the field the user just emptied. Both pages are now driven in real browser tabs (`e2e/adapters.spec.ts`, `e2e/demo.spec.ts`), each arm of the guard killing a different mutant.
- `docs/getting-started.md` (en + zh) claimed the browser suite covers both adapter pages. It covers the Vue page only — the React page loads React from `esm.sh`, so it cannot run where CI has no network, and it hand-wires the demo page's pattern rather than using the shipped `cross-tab-worker-databus/hooks` adapter (covered in jsdom by `tests/hooks.test.tsx`). The paragraph now says exactly that.

## [0.20.97] - 2026-09-22

### Added
- `examples/vue/` — a runnable page for the shipped `cross-tab-worker-databus/vue` entry, served from the local `vue` install (no CDN) and driven by real browser tests in `e2e/adapters.spec.ts`: two tabs publish through `useCrossTabDataBus` / `useCrossTabStatus` / `useCrossTabSubscription`, a reactive topic change is shown to re-attach the subscription and release the old one on the server, and a publication still crosses tabs after the owning tab closes. Until now the Vue adapter was only ever exercised in jsdom, and the existing React example hand-rolls its own effect wiring rather than using the adapter.
- `docs/transports.md` (en + zh) states the publication addressing rule that the new tests bump into: a publication carrying its own string `topic` is re-addressed to it instead of the channel it arrived on — which is how a wildcard-channel delivery names a concrete topic, and why application data shaped `{ "topic": … }` can silently go nowhere.

### Changed
- Test infrastructure only; no runtime behavior or public surface changed. `tests/coordination-invariants.test.ts` fuzzes three buses over one shared storage registry and BroadcastChannel — subscribes, unsubscribes, publications, hide/show, stop/start, heartbeats, dropped and forged `CONTROL/SUBSCRIBE` frames — then asserts at quiescence that each live topic has exactly one owner holding exactly one transport subscription, that a departed topic leaves no owner, holder or route behind, and that one publication fans out to each live subscriber exactly once. Five separate mutations kill those arms (dropping the transport subscribe/unsubscribe, double dispatch, never pruning orphan routes, emptying the assignment-reconcile sweep); three guards survive it because `reconcileAssignedTopics()` repairs their removal before quiescence, and the harness header records that as the reason those guards belong to the frame-level regressions. `mulberry32()` and `flushMicrotasks()` moved into `tests/fakes.ts` and the two existing fuzzers import them.
- The Centrifuge transport's synchronous credential-failure guard is pinned by a regression test instead of being removed as dead code. `resolveTokenRequest`'s `catch` compares the captured backend before posting `TOKEN_ERROR`: the credential provider is application code, so it can stop or replace the transport *before* it throws, and the post then addresses a backend that is already gone — `post()` raises `start() must be called first` out of the Worker message listener, which in a page is an uncaught error rather than a closed connection. Deleting the check fails the new test with exactly that error (verified by mutation), so the leg is reclassified from "unreachable by construction" to load-bearing — and it lifts whole-suite branch coverage from 96.02% to 96.07%, the same uplift removing the guard would have produced.
- `tests/dual-format.test.ts` now pins the CommonJS-only default-Worker failure: esbuild shims `import.meta` to `{}` in the CJS bundle, so the bundled Worker URL cannot resolve there and `start()` has to report "provide workerFactory explicitly" rather than a bare `TypeError`. The case also drives the ESM artifact with a stubbed `Worker`/`SharedWorker` and asserts it resolves and constructs both default Workers, which is what ties the failure to the module *format* rather than to a wrong filename. Deleting either `catch` fails it (verified by mutation).
- Two unreachable defensive branches removed with it, with no behavior change: the `typeof Worker` and `typeof SharedWorker` throws in the default Worker factories. `start()` builds the selector's availability flags from exactly those globals (`worker: workerFactory !== undefined || typeof Worker !== 'undefined'`) and `selectWorkerBackend` never returns a backend its flags deny, so the factories only ever run where the global exists; the degradation is pinned where it is decided, by `tests/worker-mode.test.ts` and the transport's "falls back to the local session when the platform lacks both Worker APIs" case. This is the counterpart to the credential guard kept above: nothing — not even application code — runs between the check and the call here, so no re-entry can invalidate the fact it asserts.

### Fixed
- The CI `verify` gate no longer times out on the coordination fuzzer added in this range, and the reason turned out not to be runner load. The sweep bounded its depth with `Date.now()`, while this suite fakes `Date` in nearly every file and advances it ~45 simulated seconds per fuzz seed — so a faked clock surviving into the fuzz file's worker made the budget read either instantly exceeded (the same file stopped at its floor after 16.4s in one full run) or never exceeded (539s on CI, still mid-sweep). `tests/setup.ts` now restores real timers after every test globally, and both seeded fuzzers budget on `performance.now()`, which no test here fakes.
- Both seeded fuzzers also bound depth explicitly: a `MAX_SEEDS` cap, a 60s budget checked per seed, an asserted 100-seed floor so a slow runner cannot "pass" on a handful of interleavings, and a log line when the sweep is truncated. The floor is set from measured mutant kill depth, not preference — the heaviest mutant the coordination harness was proved against (an emptied assignment-reconcile sweep) is caught at seed 12.
- The hot-path performance gates no longer fail on scheduling. A single wall-clock sample measured the scheduler as much as the code — two of the five gates failed in a full coverage run while the same file passed alone — so they now assert the fastest of three repeats *and* run as their own sequential step (`pnpm test:perf`, part of `pnpm check`, excluded from `pnpm test` and `pnpm test:coverage`), because an absolute-millisecond ceiling is only meaningful on an unscheduled core. A quadratic routing regression still trips its ceiling (13.6s against 1s on the best repeat).

### Docs
- The `0.20.96` entry below undercounts its own test work. Its release range (`v0.20.95..v0.20.96`, PRs #137-#146) also shipped mutation-verified regressions for the WebSocket opt-out handshake budget, the cluster's private-topic handoff rule, the trace reporter's sink-error containment on a runtime without `console.warn`, and the wildcard probe that keeps an unrelated owned pattern from capturing a batch destined for a remote topic — eleven behaviors, not seven. The published `0.20.96` tarball keeps its original wording (npm versions are immutable); this corrects the record for anyone reading between tags, and the `0.20.96` delivered-scope sections in `docs/roadmap.md` and `docs/zh/roadmap.md` now carry the full list.

## [0.20.96] - 2026-09-22

### Deprecated
- An empty topic string (`""`) is deprecated in `subscribe()`, `publish()` and `publishBatch()`. It is still accepted and still flows through routing as a literal channel, but no transport can address such a channel, so the subscription it creates can never receive anything. The bus now logs one `console.warn` per instance the first time any of the three is called with `""`. Following the pre-1.0 deprecation policy, a future minor will reject it at that boundary with a `TypeError`, like the existing option guards. Callers using `""` as a topic should move to a real channel name.

### Changed
- Documentation and tests only, otherwise: seven behaviors that could not fail their tests are now mutation-verified — the departing-owner handoff that deletes an unserved route instead of migrating it onto a live peer, the owner's release of its transport subscription when the last remote subscriber leaves, a cancelled durable-retention sweep staying silent, a superseded hydration snapshot being dropped rather than merged, the default platform `WebSocket` construction (subprotocols included), `ready()` surfacing the recorded transport error once the recovery budget is spent, and the Vue adapter containing a rejected `ready()`. `docs/architecture.md` (en + zh) gains the **Unserved route drop** and **Last-subscriber release** invariants; `AGENTS.md` records the two `ChannelHub`/batching-writer traps and the duplicated-guard mutation trap that made early drafts decorative. `vue.ts` and `hooks.ts` are now at 100% on all four coverage metrics, and `cluster.ts` is down to one uncovered line.
- `typescript-eslint` refreshed to `8.70.1`. TypeScript stays at `6.0.3`: the lint toolchain's peer range is still `typescript >=4.8.4 <6.1.0`, so a 7.x install breaks the lint gate before it touches this project's own types.

## [0.20.95] - 2026-09-22

### Fixed
- The React adapter's `useCrossTabDataBus` no longer carries a lifecycle generation counter. React runs an effect's cleanup before its next invocation for the same hook and nothing inside the effect body yields, so neither comparison arm could ever be reached; the hook now relies on that ordering directly and behaves identically. `docs/configuration.md` claimed the adapter "applies the same generation guard … so stale effect cleanup cannot clear a newer bus" — that described the removed code and now states what the adapter actually depends on. The Vue adapter's guard is genuinely load-bearing (its body awaits a stop) and is unchanged.
- `docs/getting-started.md`'s opt-in storage-event coordination fallback is now known to work: the environment wiring that builds the fallback channel from `window.localStorage` and the window's `storage` events had never been executed by any test.

### Changed
- Unreachable defensive branches removed, with no behavior change: `BatchingStorageWriter.scheduleRetry`'s already-armed retry guard (`flush()` cancels any armed retry on entry and breaks right after re-arming), and the `oldest === undefined` breaks in `DedupManager`'s and `WorkerClusterRuntime`'s bounded-map eviction loops (`size > max` implies a non-empty map). `CentrifugeWorkerTransport`'s three Worker/port error handlers lost their `generation !== backendGeneration` checks — those two scalars are only unequal inside `stop()`, which detaches the listeners first, and a scalar comparison could not identify which Worker fired in any case.
- Six behaviors that could not fail their tests are now mutation-verified: the storage-event channel's malformed-payload guard, the BroadcastChannel-less fallback channel wiring, `BatchingStorageWriter.key()`/`keys()` enumeration, `DedupManager`'s partial sweep expiry (a sweep that expired everything passed the whole suite), `CentrifugeWorkerTransport`'s late credential failure, and `useCrossTabDataBus` publishing the newest bus across dependency changes.
- `await expect(promise).rejects.toThrow('message')` is documented as insufficient in this project: on the pinned Vitest it also passes when the rejection reason is `null` or `undefined`, which silently voided every `reason ?? new Error(...)` fallback-message assertion in the IndexedDB replay tests. `expectRejectionMessage()` in `tests/fakes.ts` asserts both the `Error` instance and the message, and the convention is recorded in `AGENTS.md`.
- Coverage floors hold with more margin: `src/core/environment.ts`, `storage-batch.ts`, `dedup-manager.ts` and `hooks.ts` are now at 100% on all four metrics, and whole-suite branch coverage rose from 94.59% to 95.38%.

## [0.20.94] - 2026-09-22

### Fixed
- `useCrossTabSubscription` in the Vue adapter no longer registers a watcher on its own `handler` parameter. That binding cannot change, so the effect was permanently inert while implying handlers could be swapped in place; the subscription now binds the handler directly with identical delivery behavior.
- The CI `verify` gate no longer fails on runner load. The package/compat gates spawn five subprocesses per case against vitest's 5000ms default and the seeded lifecycle fuzzer ran at 98% of its own 30s budget under coverage instrumentation; the unit-suite ceiling is now 15s and the fuzzer holds an explicit 120s.

### Changed
- Coverage thresholds moved from advisory to enforced: the floors were 85/80/90/85 while the suite measured 98.13/94.59/98.17/99.19, so a change could lose ten points of branch coverage and still pass the release gate. They are now 96/92/96/97.
- Nine previously unasserted behaviors now have mutation-verified regressions: route-owner-cache eviction and its LRU ordering (the old test passed with the eviction loop deleted outright), the failed-hydration retry on the next `start()`, the metadata-less item of an unpacked remote batch, the `replay.maxPerTopic` / `pruneStrategy` option guards, `serializeError`'s no-`structuredClone` branch, superseded-client `state` / `disconnected` isolation, the async credential-provider rejection reply, the WebSocket shared handshake gate, and the single-item batch frame shapes.

## [0.20.93] - 2026-09-19

### Fixed
- The compatibility gate now rejects disabled public exports, removed worker default conditions, conditional exports replaced with untyped strings or null type targets, incompatible package-level `types`/`typesVersions` metadata, unavailable unconditional targets, destructive fallback-array changes, and removed nested or custom export conditions.
- Storage capability detection now requires a complete write-read-delete round trip, so write-only or unreadable adapters enter the existing local-mode fallback instead of starting coordination against an unusable registry.
- Cluster startup now degrades safely when channel construction throws, and tab identity remains stable within the document when session storage is unavailable or unreadable.
- Storage writer cleanup now cancels pending retries and resets backoff before a failing clear and after final cluster teardown flushes, preventing background writes from surviving page hide or stop.

### Changed
- Refreshed patch-level development dependencies used by the test and lint toolchain.

## [0.20.92] - 2026-09-18

### Fixed
- Release automation now rejects mismatched tag/package versions and missing, duplicate or empty release notes before creating a release or publishing. Release guidance uses feature-branch PRs and immutable version tags.
- A rejected transport `stop()` is now retained consistently in both failure ledgers. `stop()` still resolves after reporting through `onError`, but `getRecoveryStats()` no longer reports `hasError: false` while `getHealthSummary().lastFailure` still describes the same stop failure; an explicit `start()` remains the boundary that clears both.
- Operations parked behind the recovery gate now remain queued when an explicit `start()` supersedes the automatic recovery timer. If that manual open also fails, the operations stay behind the still-closed gate and flush after the next successful automatic or demand-driven reopen instead of being silently dropped with the superseded opening.
- A transport operation parked behind the recovery gate is now invalidated when `stop()` / page-hide supersedes the recovery cycle. An immediate explicit `start()` can re-establish subscriptions on the replacement transport, but the stale waiter no longer replays its operation afterward, preventing a duplicate subscription from racing the restarted cluster.
- A delayed or replayed `CONTROL/SUBSCRIBE` can no longer make a worker subscribe when the durable route does not currently name it, and it can no longer confirm a pending graceful handoff before the matching `ROUTE_RELEASED`. Ownership now follows the route record instead of control-frame arrival order, preventing transient double subscriptions when an earlier assignment round is overtaken by a newer one.
- A restart queued behind an asynchronous `stop()` now stays suspended when `pagehide` lands during the stop cleanup. `WorkerClusterRuntime.start()` installs its lifecycle listeners before checking document visibility, so a hidden document waits for `pageshow` instead of opening a fresh transport in the background.
- `ROUTE_RELEASED` handoff acknowledgements are now accepted only when their route generation exactly matches the stored route. A delayed or replayed ACK carrying a newer generation could previously confirm a different handoff and release the new owner's `SUBSCRIBE` before the matching release arrived.
- Durable replay history loaded asynchronously can no longer overtake or evict publications recorded while `load()` is still pending. Hydration now places the durable snapshot ahead of that live tail before applying the retention/count policy, so a bounded ring keeps the newest messages instead of treating them as older history.
- Replay hydration now belongs to a replaceable lifecycle instead of one immutable constructor promise. A `clearAll()`, `clearTopic()`, topic unsubscribe, or `clearBefore()` issued while durable `load()` is pending is applied to the loaded snapshot, so cleared history cannot reappear. A load superseded by suspend/restart is cancelled without clobbering the replacement, and an explicit stop/start now performs a fresh hydration instead of leaving the restarted rings empty.
- A `start()` issued synchronously from the `DISCONNECTED` status callback during `pagehide` can no longer be undone by the stale hide continuation. `suspendTransport()` now abandons its stop chain when the status callback has already installed a newer lifecycle, so the replacement transport stays open and the health snapshot remains truthful instead of reporting `healthy` while the transport has been stopped again.
- Operations issued while a replacement transport is opening can no longer reach the closed connection. `reopenTransport()` now clears `transportReady` before its synchronous `CONNECTING` notification, so a second `publish()` / `subscribe()` in the same tick parks behind the opening gate instead of bypassing it. This also preserves operation order: the replacement receives the earlier parked operation before the later one.
- Replay retention cleanup queued after a suspend/resume cycle is no longer dropped when an older cleanup transaction is still unwinding. The old pass now hands a non-null queued cutoff to a fresh cleanup before releasing the in-flight slot, so the newest cutoff runs instead of waiting for an unrelated future publication.
- A transport operation that was already parked behind the recovery gate when an automatic recovery attempt failed is no longer stranded until an unrelated later operation arrives. `runTransport()` now counts the operations parked on the gate, and a failed automatic attempt immediately starts one on-demand reopen when any waiter is present, so an already-issued `publish()` / `subscribe()` itself drives recovery instead of waiting for a future operation that may never come. A failed on-demand reopen still re-arms the demand flag for a later operation rather than looping on its own failure, and every waiter is released in order once a reopen succeeds.
- A re-entrant `stop()` from the synchronous RESUME lifecycle trace event now cancels the rest of both an explicit `start()` resume and a native `pageshow` resume. Resume timers are only restarted when the callback still owns the lifecycle, and `WorkerClusterRuntime` now uses a lifecycle generation so its outer `pageshow` handler cannot reactivate a cluster already stopped or paused by `onResume`. Previously the callback's stop could settle first while the outer resume continued and left the bus reported as stopped with an active cluster.
- A re-entrant `stop()` from the synchronous CONNECTING status callback emitted during `reopenTransport()` now cancels that reopen instead of allowing it to install and start a new transport after teardown. The recovery lifecycle epoch and start promise are now installed before the status callback runs, so the stop gate observes the opening, its epoch guard abandons it, and health remains consistently stopped. Previously the callback's stop settled first while `reopenTransport()` continued and left `started: false` with a live connected transport.
- A re-entrant `stop()` from the synchronous START lifecycle trace event now supersedes the outer `start()` before it can open the transport. Lifecycle ownership and the shared start promise are installed before the trace event, and `start()` aborts the remaining timer/cluster setup if a callback stops or suspends the new lifecycle. Previously the stop settled while the outer start continued into `transport.start()`, leaving health reported as `stopped` with a live `connected` transport.
- `stop()` is now re-entrancy safe against a synchronous trace sink. The shared in-flight stop gate is installed before the teardown prelude runs, so a `stop()` re-entered from the synchronous STOP lifecycle trace event shares the single teardown instead of starting a second one. Previously the nested call ran before `stopPromise` was assigned and invoked `transport.stop()` a second time. The teardown still takes effect in the same tick, concurrent and repeated `stop()` calls keep returning the same promise, and a rejecting transport stop still resolves `stop()` through `onError`.

### Tests
- A parked-recovery cancellation regression covers page-hide followed by an immediate explicit `start()`: the replacement connection receives exactly one subscription for each assigned topic, and the stale recovery waiter cannot replay after that restart.
- A route-generation guard regression proves a `ROUTE_RELEASED` carrying a newer generation than the current handoff cannot enter `assignedTopics`, trigger `SUBSCRIBE`, or stamp `confirmedAt`.
- A delayed durable `load()` now has a direct replay ordering regression: a publication recorded while hydration is pending must remain newer than the loaded snapshot and survive a one-entry count cap.
- Hydration lifecycle regressions now cover `clearAll()`, `clearTopic()`, topic unsubscribe, and `clearBefore()` racing a pending load, plus explicit stop/start and immediate suspend/start re-entry. The replacement load must win, stale results must stay out of the rings, and durable history must be restored after an explicit restart.
- The documented storage and BroadcastChannel isolation boundary between different `clusterKey` values is now pinned by a two-runtime regression. It proves each tenant can independently own the same topic, publications do not cross, and persisted keys are namespaced under distinct opaque hashes without exposing the plaintext cluster identifier.

## [0.20.91] - 2026-09-16

### Fixed
- A malformed cross-tab `EVENT` frame can no longer break publication delivery. Publication payloads that are not objects with a string `topic`, and frames carrying an unknown `eventType`, are now ignored at the DataBus boundary; later valid events continue to dispatch. Legacy payloads without `originTabId` still inherit the frame-level attribution, while an explicit payload value takes precedence.
- `WebSocketTransport` now best-effort closes a socket after a connection error invalidates it. Automatic recovery can no longer leave a dead connection open when the socket implementation does not follow an `error` event with `close`.
- Centrifuge token-bridge callbacks are bound to the client lifecycle that created them. A credential request from a replaced client can no longer be routed into the replacement session or satisfy a fresh request with a stale token.
- `WorkerClusterRuntime.pause()` no longer schedules a deferred channel close when no channel exists, removing a stray timer left behind by an explicit `stop()`.

### Changed
- The browser benchmark trend documentation was refreshed from 24 archived reports. The release-gate comparison found no metric regression above the 50% ceiling; publish latency improved in both worker modes.

## [0.20.90] - 2026-09-16

### Fixed
- The `Release` workflow's blocking published-consumer gate no longer fails on ordinary npm CDN propagation lag. The 0.20.89 tag run published successfully and then still failed the gate because `npm pack cross-tab-worker-databus@0.20.89` kept returning `ETARGET` for the whole 24 x 5 s (2 min) budget; the budget is now 48 x 7.5 s (6 min). A genuinely missing or unimportable published package still exhausts the budget and fails the gate.
- The coverage gate no longer false-fails when V8 instrumentation pushes the 1,500-seed lifecycle fuzzer past Vitest's 5-second default. The fuzzer keeps every seed and now carries an explicit 30-second test budget.

### Changed
- Delivery semantics are now documented consistently: one accepted transport publication is fanned out once and dispatches at most once per matching local handler, but transport/server redelivery or loss and the bounded per-bus opt-in `messageId` dedup window still mean the SDK does not provide end-to-end at-least-once or exactly-once delivery. The architecture docs no longer claim exactly-once dispatch per subscriber, and the Chinese API reference now includes the deduplication boundary already documented in English.
- The browser benchmark trend docs were refreshed through the latest two-run release gate (23 archived reports). The final comparison found no metric regression above the 50% ceiling; full round-trip publish latency improved in both worker modes.

## [0.20.89] - 2026-09-16

### Fixed
- `getHealthSummary()` no longer reports `healthy` while an explicit `stop()` is still tearing down. The transport can keep reporting `connected` until its asynchronous `stop()` settles, so the verdict previously contradicted the stopping bus's own behavior: `publish()`/`subscribe()` were already routed through `onError`, and `ready()` already rejected. An in-flight stop is now surfaced as `state: 'stopped'` with `healthy: false`, matching the other lifecycle APIs; a restart queued behind that stop is reported as `starting` once it owns the lifecycle.
- A settled `stop()` gate can no longer swallow a subsequent teardown. `stop()` reused `stopPromise` whenever it was non-null, but that field is cleared in a microtask *after* `performStop()` has already finished and flipped `stopping` back to false. A `start()`/`stop()` issued inside that window therefore received the old settled promise, skipped teardown, and left the restarted bus running while `stop()` resolved. The in-flight gate is now reused only while `stopping` is true, so a stale gate falls through to a fresh stop.
- Replay batch flushes that are still queued in a microtask are now discarded when the bus suspends or stops. The queued callback previously started its persistence retry only after the lifecycle generation had already advanced, so it inherited the new session and could append stopped-session history to the durable store.
- A replay retention cleanup that is already in flight when the bus suspends or stops can no longer drain a newer cutoff queued behind it. The coalesced cleanup loop now captures the persistence lifecycle generation, the lifecycle transition clears its queued cutoff, and late failures from the superseded session are dropped instead of reaching the public persistence error ledger.
- Replay hydration results are now bound to the lifecycle generation that issued the load. A durable `load()` that resolves after `suspend()` or `stop()` can no longer append messages into buffers that teardown has already cleared; the stale operation is reported as a lifecycle cancellation and is filtered from the public error ledger.
- A stopped trace reporter now remains inert until `start()` explicitly begins a new session. Queued `asyncSink` events from the old session are discarded instead of flushing after teardown, metrics and ordinary events are ignored while stopped, and the stopped flag is cleared even for event-only mode so an explicit restart emits its new lifecycle `start` again.
- Centrifuge credential-provider results are now bound to the exact Worker, port, or local session that issued the request. A pending async token from a stopped backend could previously resolve after `stop()` / `start()` and satisfy the replacement session because request IDs restart at 1; late tokens and rejections are now dropped, while a provider that throws synchronously is converted into `TOKEN_ERROR` instead of escaping the worker-message handler.
- Async callbacks from a stopped in-process `CentrifugeSession` can no longer leak into the session created by a later `INIT`. Client lifecycle/publication/error events, subscription callbacks, and rejected local-fallback publishes now capture a lifecycle generation and are ignored once `STOP` or reinitialization supersedes their connection, preventing stale status, publications, or errors from reaching the replacement session.
- A WebSocket binary frame delivered as a `Blob` can no longer leak into a replacement connection after a `stop()` / `start()` cycle. `Blob.arrayBuffer()` is asynchronous, so a frame received by the old socket could finish converting after the new handlers were installed and be dispatched as if it belonged to the new connection. The transport now captures the socket/handler pair before conversion and drops the frame or its conversion error when either has been replaced or the socket is no longer active.

## [0.20.88] - 2026-09-16

### Fixed
- A transport that reports `error` synchronously during startup now lets `start()` retry from either the startup-failure `onStatus` callback or the startup-failure `onError` callback. The internal status is updated immediately, but the user-facing `onStatus('error')` notification is deferred until the failed open has cleared `transportReady`, torn down the initial cluster, installed the transport stop gate, recorded the failure, and cleared `startPromise`. The retry therefore opens a fresh lifecycle after cleanup and resets the failure ledger; the superseded opening's rejection is consumed by that lifecycle path and cannot repopulate the ledger after the retry succeeds.
- A synchronous `start()` retry issued from the startup-failure `onError` callback now opens a fresh lifecycle instead of returning the same rejecting open. `openTransport()` previously notified error handlers before clearing `startPromise`, so the retry shared the failed promise and never called `transport.start()` again. The failed open is now fully torn down and its lifecycle gate cleared before failure notification, and the retry is chained after the failed transport's stop cleanup.
- A bus whose initial transport open is still pending now recovers from repeated BFCache `pagehide`/`pageshow` cycles. Each suspend used to return early whenever a `pendingStop` gate existed, but a queued resume opening could already sit behind an older stop gate, so `startPromise` and `pendingStop` stopped being the same promise; the next `pageshow` then reused that superseded opening and the bus stayed suspended forever. `suspendTransport()` now reuses the gate only when it still represents this suspend, and otherwise chains a fresh serial `transport.stop()` that restores the `startPromise === pendingStop` invariant, so the following reopen actually restarts the transport.
- An explicit `start()` that resumes a BFCache-suspended bus now also resumes cross-tab coordination. `pagehide` pauses the bus *and* the `WorkerClusterRuntime` (closing the channel, stopping the heartbeat, releasing route assignments), but the started `start()` fast path only cleared `suspended` and reopened the transport, leaving `cluster.suspended` true. The bus then reported a healthy transport while every publication arriving from a peer tab was discarded by `isAssigned()` against the cleared assignment map, until a later `pageshow` happened to fire. `start()` now resumes the cluster whenever it is taking the bus out of suspension, so an explicit resume restores the full coordination plane.
- An explicit `start()` that resumes a BFCache-suspended bus now restarts every resource paused by `pagehide`, not only the transport and cluster. Trace metrics, the dedup expiry sweep, and replay retention cleanup were stopped by `onSuspend()`, while the native `pageshow` path restarted them through `onResume()`; the explicit resume bypassed that callback and could leave all three timers permanently off for the rest of a `healthy` session. Both resume paths now share one lifecycle helper.

## [0.20.87] - 2026-09-16

### Fixed
- Transport operations issued after a runtime `error` no longer reach the connection that just failed. While an automatic or demand-driven reopen is pending, `runTransport()` parks `subscribe()` / `publish()` behind a recovery gate and releases them only after a reopen succeeds (or the transport self-heals to `connected`). `transportReady` deliberately stays true through the error so `ready()` keeps tracking the installed transport, which meant a subscribe or publish inside the cooldown window was written to the dead connection and lost. A failed automatic attempt keeps the gate closed but now lets the next explicit operation start an immediate on-demand reopen instead of waiting out another cooldown, and parked operations flush behind that success; exhausting `recovery.maxAttempts`, or superseding the wait with `stop()` / page hide, releases the gate so the explicit-retry path and the documented suspend-drop semantics are unchanged. A clean `disconnected` still never schedules automatic recovery.
- An operation issued after a clean transport `disconnected` now reopens the transport on demand instead of being written to the closed connection. `runTransport()` previously exempted only `error`, so a `subscribe()` / `publish()` arriving after a clean `close` took the ready fast path and the backend dropped it (the WebSocket send guard reports dropped frames but never sends them). The fast path is now refused once the transport has actually reached `connected` and then reports `disconnected`: the clean close still schedules no background recovery, but the next explicit operation demands exactly one reopen and flushes the parked operation behind it. A transport that resolves `start()` before its first `connected` (worker-style backends report the connection asynchronously) keeps the previous behaviour, so the pre-connect window does not trigger a redundant reopen.
- `createWebSocketDataBus()` automatic recovery now actually reopens a failed WebSocket. `WebSocketTransport.start()` previously returned whenever `this.socket` was non-null, and an error/close left that reference in place, so every post-cooldown `reopenTransport()` was a no-op against the dead socket. The transport now tracks whether the current socket is active, replaces the stale connection on the next `start()`, re-sends subscriptions after the replacement opens, and ignores late callbacks from the superseded socket. An error followed by close also keeps the `error` status that schedules recovery.
- React and Vue `useCrossTabHealth` bindings now apply `intervalMs` changes without recreating the bus. React previously ignored an option change unless the bus identity changed, and the Vue composable ignored changes to a reactive options object; switching to `0` therefore left polling active, while changing a positive cadence kept the old timer. Both adapters now tear down the old listener/timer set and install the new cadence.
- `stop()` now resolves once the bus is torn down even when the transport's own `stop()` rejects or throws. The failure is routed through the same `onError` / unified `lastFailure` channel that page-hide suspension and open-failure cleanup already use, so the fire-and-forget `void bus.stop()` teardown in the React and Vue adapters can no longer surface as an unhandled rejection. The instance stays restartable either way.
- A failed transport open is now stamped once: `getRecoveryStats().errorAt` and the `lastFailure.at` of the same failure are equal instead of differing by a clock re-read. The open-failure path called the injected clock twice for one failure, so a consumer correlating the two ledgers (or a test using an advancing clock) saw two timestamps for one event. The open-failure path also clears `transportReady` before notifying status/error handlers, keeping the "transport is not accepting operations" verdict local to the failure block.
- `ready()` no longer reports a BFCache-suspended bus as ready. After `pagehide`, `suspendTransport()` chains `transport.stop()` and reuses `startPromise` as the stop gate; `ready()` previously returned that gate, so it resolved the moment cleanup finished even though the transport was intentionally stopped and publications were dropped. Readiness now rejects with a clear suspended-state error while hidden; `pageshow` (or an explicit `start()`) clears the flag and installs a real reopen promise, after which `ready()` resolves as before. This restores the documented invariant that `ready()` never resolves for a transport that cannot carry data.
- A runtime transport failure reported through `onError` now lands in the transport recovery ledger, not only in the unified `lastFailure` record. `getRecoveryStats().hasError` / `errorMessage` / `errorAt` were written exclusively by the transport-*open* failure path, so a failure raised after a successful open produced a self-contradicting health snapshot: `state: 'recovering'` and a retained `lastFailure` alongside `recovery.hasError: false, errorMessage: null`. The recovery ledger now tracks every transport-sourced failure (open or runtime) and still keeps non-transport failures (`persistence`, `dispatch`) out of it, where they remain visible through `lastFailure` and `getPersistenceStats()`.
- The native WebSocket backend now honors the `DataBusTransport.start()` contract: it resolves only after the socket `open` and rejects when the handshake errors, closes before opening, or exceeds the new `connectTimeoutMs` (default 30s). Previously `start()` returned while the socket was still `CONNECTING`, so `await bus.ready()` resolved before the connection was usable and an immediately following `publish()` was dropped by the not-open guard. A timed-out attempt now closes its half-open socket and ignores a late `open`; an in-place re-open after a successful handshake still re-asserts subscriptions.
- `getHealthSummary()` now treats a live `connected` transport as healthy even during the brief window before `start()` settles and `transportReady` flips to true. With a handshake-gated WebSocket start, the `connected` status event fires while `transportReady` is still false, so an event-driven `useCrossTabHealth` snapshot with `intervalMs: 0` could remain stuck in `starting`/`recovering`. `transportReady` remains a diagnostic field; operations are queued behind the in-flight start rather than dropped.


## [0.20.86] - 2026-09-16

### Added
- The configuration reference now documents the full public option surface: `replay.pruneStrategy` (previously absent entirely) and the replay options table (`maxPerTopic`, `persistence`, `retentionMs`, `pruneStrategy`, `retentionSweepMs`, `persistenceRetry`), plus a deduplication options table (`maxEntries`, `ttlMs`, `sweepMs`, `now`, `adaptiveTtl`) — in both languages. A guard derives the field list from the built declarations and fails when a `DataBusReplayOptions`/`DataBusDedupOptions` field is undocumented in either configuration reference. The `pruneStrategy` JSDoc no longer claims a default of `'both'` (the actual default is `'count'`).
- Property invariants for `selectActiveWorkers` / `selectRebalanceTarget`: the returned worker set is always a subset of the input, active selection stays within `maxActiveWorkers` and non-empty for a non-empty input, and neither helper throws on arbitrary corrupt worker records.

### Fixed
- `ready()` no longer reports readiness for a restart that a later `stop()` canceled. The queued `start()` promise retains its documented resolve-on-cancellation behavior, but readiness now rejects with a clear lifecycle error instead of resolving against a stopped bus.
- A failed restart queued behind an in-flight `stop()` now remains observable through `ready()`. Previously the failure cleared `started`, so a later `ready()` without `initialConfig` was masked by the generic "requires initialConfig" error; it now resurfaces the actual transport startup failure and preserves the explicit manual-retry path.
- `publish()` and non-empty `publishBatch()` calls issued while `stop()` is in flight now report through `onError` instead of silently returning once `runTransport()` refuses to touch the stopping transport. Empty batches remain no-ops, publications already queued behind an in-flight open are still canceled by the stop (latest lifecycle intent wins), and page-hide suspension keeps its documented drop-without-defer behavior.
- `subscribe()` and `ready()` now honor the explicit-stop barrier. A subscription requested while `stop()` is settling reports through `onError` and returns a no-op cleanup instead of being erased by teardown or leaking into a later restart; `ready()` rejects rather than resolving against the stopping transport. A `start()` already queued behind that stop remains the newest lifecycle intent, so `ready()` continues to follow its restart promise.
- A `stop()` that arrives before a restart queued behind an earlier in-flight `stop()` could run now cancels that queued restart instead of being swallowed by the in-flight stop gate. The queued continuation is invalidated with a monotonic token, so the latest lifecycle intent always wins: `stop → start → stop` ends stopped with no extra transport open, while a later `start()` still queues a fresh restart with a higher token.
- Superseded asynchronous transport opens can no longer tear down or detach a newer page-hide/pageshow reopen. Each open now carries a lifecycle epoch, so callbacks, failures, success telemetry, and cleanup from an older open are ignored once a newer suspend/resume/stop transition owns the lifecycle; `stop()` also waits for any pending open or reopen even when `started` has already been cleared. Previously an initial open failing after a queued resume reset `started` to false and nulled `startPromise`, making `stop()` resolve immediately while the queued transport could still start afterwards.
- `start()` now serialises correctly with both page-hide suspension and an in-flight explicit stop. A hidden bus whose asynchronous `transport.stop()` was still settling returned that cleanup promise from `start()` and never reopened the transport; an in-flight `stop()` likewise allowed `start()` to observe the old ready state and resolve as a no-op before the bus finished stopping. Both paths now queue one fresh start after cleanup, share concurrent start/stop promises, and preserve the existing degraded manual-recovery behavior.
- Explicit `start()` now performs a manual transport recovery when the bus has already started but its automatic recovery budget is exhausted; it preserves the cluster, subscriptions, and replay state while resetting the failure/recovery ledger before reopening. Previously `start()` returned a resolved no-op in the degraded state even though the public health contract documents it as the manual retry path. Covered by a regression that exhausts automatic recovery, succeeds through `start()`, and verifies the health summary returns to healthy.
- IndexedDB replay persistence now settles every mutation when a transaction aborts, including connection-loss aborts that fire `onabort` without a preceding request error. Previously the serialized mutation queue could remain blocked forever, preventing later appends and clears from running. Loads now resolve only after `transaction.oncomplete`, so a request that succeeds before a later abort cannot be reported as a successful read. Request/transaction failures without an `error` object use operation-specific fallback messages.
- Replay age pruning is now position-independent and uses one shared policy for the in-memory rings and IndexedDB adapter. Previously an expired timestamped entry after a timestamp-less legacy entry (or after a non-expired entry) was never removed, and hydrated history was always truncated to `maxPerTopic` even when `pruneStrategy: 'age'` was configured. Timestamp-less entries are still preserved for compatibility, but are now capped by `maxPerTopic` under AGE so they cannot grow without bound; timestamped entries remain bounded by the retention window. Covered across live recording, hydration without a `clearBefore` adapter, and durable append paths.

## [0.20.85] - 2026-09-13

### Added
- Seeded property suite (`tests/property.test.ts`) for the pure hot-path helpers and the stateful managers: `effectiveWorkerLoad`/`selectLeastLoadedWorker` totality and order-independence, `approximatePayloadBytes` finiteness (cycles included), `parseDataBusPublication` topic validity, `topicMatchesPattern` segment-boundary invariants, `serializeError` cloneability, `createOpaqueKey` shape, and `DedupManager`/`ReplayManager` bound invariants under long random operation sequences. Deterministic (fixed seeds), so failures reproduce and the suite is not flaky.

### Fixed
- Replay history is now bounded when `pruneStrategy: 'age'` is set without a `retentionMs`: neither the age pass nor the count cap applied, so the in-memory ring (and the persisted topic record) grew without limit while delivery stayed capped by `maxPerTopic`. The count cap now applies whenever there is no retention window to prune by. Pinned in both the in-memory manager and the IndexedDB adapter (mutation-checked).
- `serializeError` now guarantees its documented structured-cloneable result: a non-Error value was attached verbatim as `context`, so a function/symbol (or an object holding one) made the serialised error itself uncloneable and `postMessage` threw `DataCloneError` while reporting the original failure. Non-cloneable contexts are dropped (cloneable ones are still kept for diagnostics). Pinned by regression + property-suite cloneability invariants.
- `approximatePayloadBytes` no longer overflows the stack on deeply nested or cyclic payloads. Structured clone preserves cycles, so a cyclic publication can legitimately reach the replay-buffer byte estimate (`getDiagnostics().replay.bytes`) and the adaptive-load sampler; unbounded recursion there threw a `RangeError` and took down the diagnostics/reconcile path. The estimate is now depth-bounded (shallow results unchanged), pinned by a cycle/deep-nesting regression plus a finiteness invariant in the seeded property suite.

## [0.20.84] - 2026-09-13

### Added
- CI now enforces three gates that were documented but ran nowhere: `pnpm test:coverage` (the `vitest.config.ts` floors), `pnpm verify:compat`, and `pnpm verify:pack`. The `Release` workflow also runs `verify:compat` + `verify:pack` before publishing. Both workflows check out with `fetch-depth: 0` + `fetch-tags: true`, without which `verify:compat` fails to resolve its release-tag baseline. Documented in both release checklists.
- Focused `ReplayManager` unit suite (`tests/replay-manager.test.ts`): the disabled no-op contract, count/age/both pruning, wildcard replay fan-out, hydration with retention pre-pruning, append batch coalescing, `clear*` durable-failure propagation, retention-sweep coalescing and idempotence, and the persistence retry/backoff plus suspend-cancellation loop (86.95% -> 97.10% statements, 81.60% -> 96.00% branches).
- Additional IndexedDB replay adapter coverage: the unavailable-IndexedDB guard, ordering when a clear interleaves batch coalescing, the `onversionchange` connection drop that unblocks another tab's schema upgrade, transaction-construction failure on every mutation path, single-rejection semantics for a multi-read batched append (84.02% -> 93.29% statements), plus transaction-abort coverage — a quota-exceeded `put` aborts the whole transaction with no request error, so only `transaction.onerror` signals the failure (without it the append hangs), with a generic-message fallback when `transaction.error` is null.
- `CrossTabDataBus` lifecycle-contract coverage: `ready()` rejecting with the configuration error when no `initialConfig` exists and resurfacing the last transport failure once no start is in flight, `unsubscribe` no-ops for an unknown topic and an unregistered handler, `stop()` idempotence, and the third dispatch gate — an owning tab fans a publication out to a peer subscriber and records it *discarded* locally rather than counting it dispatched (mutation-checked).
- `WorkerClusterRuntime` publish-routing and lifecycle-guard coverage: wildcard publish-cache hits on repeat publishes and `publishBatch`, an empty batch as a no-op and a single-item batch delegating to `publish()` with metadata intact, `unsubscribe` on a topic with no route, `isActiveWorker()` eligibility before and after `stop()`, `start`/`stop` idempotence, and `hasLocalSubscriber` segment-boundary matching. Includes a two-runtime regression pinning the 0.20.58 fix: a `null` wildcard-cache entry must not short-circuit a publish whose topic is owned by a remote worker (mutation-checked). cluster.ts functions now 100%.
- `PortReaper` SharedWorker-shutdown coverage: `setTimeout`/`touch`/`remove` no-op for an untracked port (a STOP or INIT racing a reap must not resurrect it), duplicate `remove` clears the cadence timer once the last port goes, `dispose()` closes and stops every tracked session and is safe to repeat, `dispose()` keeps cleaning up after a target throws (a detached port must not strand the remaining WebSockets), and a non-finite/non-positive heartbeat falls back to the default session timeout. port-reaper.ts now 100% statements and functions; all three guards mutation-checked.
- `WebSocketTransport` frame-handling coverage: an empty `publishBatch` as a no-op, ArrayBuffer items embedded as byte arrays so a mixed batch stays one frame, a duplicate `start()` reusing the live socket instead of orphaning it, and non-string / non-object server frames ignored without an error report. websocket.ts 92.59 -> 96.29 statements, 85.54 -> 91.56 branches.
- `CentrifugeWorkerTransport` coverage: a duplicate `start()` reusing the live backend (a second Worker would mean two WebSocket connections), the SharedWorker-level failure and the port message-decode failure reported as distinct errors, a `channelToken` request satisfied from `getToken` when the provider has no `getChannelToken`, and a token request answered with `TOKEN_ERROR` rather than dropped when no `credentialProvider` is configured (a silent drop would hang the worker's connect). centrifuge.ts 93.12 -> 95.00 statements, 91.08 -> 93.06 branches; all four paths mutation-checked.
- `CentrifugeSession` coverage for the client-level `connected`/`disconnected`/`error` listeners, server-initiated `unsubscribed` cleanup, topic-less publication drops, the nested `push.channel` topic shape, and stale/duplicate token replies (85.18% -> 100% functions).
- Demo chaos toggles for lifecycle-failure coverage in a real browser: `#dropHandoffAck` drops outgoing `ROUTE_RELEASED` so a pagehide handoff can only converge through the TTL-gated stranded-handoff recovery, and `#simulateCrash` stops all outgoing coordination on a tab with no pagehide (zombie crash: heartbeats go stale, no handoff write, no worker-record removal) so survivors must re-elect through the heartbeat-TTL crash path. Both are covered by browser E2E (takeover timing corroborates the path taken: ~14 s recovery / ~13.6 s crash expiry vs 1–2 s graceful handoff), with exactly-once delivery asserted after each takeover. (A real renderer crash via CDP was evaluated and rejected: same-origin tabs share the renderer, so siblings die too.)
- Demo observability: the event feed now renders trace `reliability` events (route acknowledgments/migrations/recoveries, transport recovery attempts, persistence retries, dedup outcomes) with Chinese labels, so the new recovery diagnostics are visible in the product demo instead of only in the trace sink. Subscription (`subscription:subscribe/unsubscribe`) and cluster-coordination snapshots (`coordination`, counts only) render as bounded diagnostic rows too. Covered by a browser E2E asserting the acknowledgment, subscription, and coordination rows.
- Trace observability for handoff recovery: a re-election that recovers a stranded unconfirmed handoff now emits `reliability` trace events with `operation: 'route_migration_recovery'`, distinct from the routine graceful-handoff `route_migration`, so operators can tell recoveries apart from normal churn in the trace sink. Covered by unit tests on both paths plus a data-bus-level test proving the operation reaches the public trace sink end to end (mutation-checked); documented in the API reference (English and Chinese).
- Coverage-driven fault-injection suite for the storage utility layer (`tests/storage-utils.test.ts`): a fully-throwing storage backend and a corrupt-record backend pin every error-swallow branch of `readJson`/`writeJson`/`listKeys`/`readAllByPrefix` (storage-utils now 100% statements+branches).
- WebSocket transport regression coverage for two error paths: a Blob binary frame whose conversion rejects is isolated through `onError` (no crash, no delivery), and a binary publish whose encoded topic exceeds the 16-bit frame prefix reports "topic is too long" and sends nothing, with the exactly-0xffff boundary still framing successfully.
- Centrifuge transport coverage for factory-less degradation: with both Worker globals absent the transport resolves to the `local` backend without error (the documented SSR behavior), while an injected factory that throws surfaces the failure instead of degrading silently.
- Retention-cleanup regression coverage: a failing durable `clearBefore` pass is reported through `onError` once and does not wedge the pipeline (a later publication still flushes), and a cutoff queued while one pass is in flight is drained by the cleanup loop rather than dropped.
- IndexedDB replay persistence coverage for read-request failure paths: `load()` and `clearBefore()` reject with the request error and invalidate the connection; the fault-proxy transaction wrapper now forwards `oncomplete`/`onerror` so the previously untestable clear-path completion is exercisable.
- Dedup option validation coverage: invalid `maxEntries`/`ttlMs`/`sweepMs` and malformed `adaptiveTtl` bounds throw `TypeError` before the bus is constructed (validation.ts statements now 100%).
- `pnpm bench:trend` (`scripts/bench-trend.mjs`) generates a long-run browser benchmark trend doc (`docs/benchmarks.md` + Chinese mirror) from the archived `bench-results/` reports: per-metric latest/previous/delta plus an all-time best per latency. Both docs ship in the tarball and are indexed in the documentation READMEs; the release checklist (both languages) now includes the benchmark-regression gate step, and the Chinese checklist gained the previously missing browser-benchmark gate bullet (EN/ZH parity).
- Opt-in `loadWeighting` adaptive owner weighting (`messageRateWeight`, `byteRateWeight`, `scheduleLagWeight`): workers sample their own fan-out traffic and heartbeat scheduling overrun per window and publish it with the worker record; new-route owner selection adds the normalized rates and lag ratio to the topic count. Default (unset) keeps pure topic-count routing and existing routes stay sticky. `WorkerThroughputSample` gains `overrunMs`, a browser-native proxy for a starved event loop.
- Async credential refresh bridge for the Centrifuge worker: opt-in `credentialProvider` (`getToken` / `getChannelToken`) runs on the main thread, with the Worker requesting each fresh token over a `TOKEN_REQUEST` / `TOKEN_RESPONSE` / `TOKEN_ERROR` exchange. Function-valued Centrifuge options stay out of the structured-clone boundary; legacy configs keep byte-identical behavior; pending requests are settled on STOP.
- Synchronous trace visibility: `DataBusTraceReporter.getMetrics()` snapshots the current aggregation window without a sink or flush; `CrossTabDataBus.getMetrics()` and `getDiagnostics().metrics` expose it, and `getDiagnostics().trace` / `getHealthSummary().trace` report `asyncSink` mode and queued-event depth (back-pressure visibility).
- E2E: a real-Chromium scenario disables `window.BroadcastChannel` and verifies two tabs coordinate and deliver cross-tab over the localStorage storage-event channel; a Playwright `waitForSingleOwner` convergence helper replaces one-shot owner reads across the suite. A second fallback scenario drives a graceful `pagehide` handoff so the replacement route and REGISTRY nudge ride storage events and the standby takes ownership over the fallback plane.
- A 100-item × 3-tab `publishBatch` E2E asserts exactly-once fan-out per tab, guarding against the owner echo racing the EVENT broadcast and per-item frame decomposition on a larger burst.
- Getting-started guides (English and Chinese) gained an "Upgrading & Deprecation" section, the migration-guide payload behind the pre-1.0 deprecation policy in the release checklist.
- `getDiagnostics().replay` now reports `bytes`, the approximate in-memory footprint of the buffered replay rings (computed on demand, same sizing heuristic as adaptive load weighting).
- The demo's overview gains a live diagnostics row: the current trace-window throughput/dispatch P50 (`getMetrics()`) and the replay buffer footprint (`getDiagnostics().replay`), refreshed with the existing 1s render loop. A "负载加权" toggle (off by default) enables adaptive weighting in the demo and the workers table shows each worker's throughput sample (`msg/s` + scheduling-lag %) in a new 吞吐 column.
- QA: `verify:pack` now smoke-imports the full root public surface (12 functions incl. `effectiveWorkerLoad`, `approximatePayloadBytes`, `createIndexedDbReplayPersistence`) plus every subpath in ESM and CJS; a cluster integration test proves `scheduleLagWeight` steers a new route away from a scheduling-lagging worker; the `getMetrics()` test asserts full field parity with a flushed `message_metrics` event; README and Chinese roadmap feature lists were brought up to date with the recent additions.
- Packaging: the published tarball now enumerates the exact docs files (both languages) instead of the whole `docs/` directory, dropping the internal `docs/progress.md` tracking artifact from `npm pack` output.
- Security/CI infrastructure: a CodeQL workflow (javascript-typescript, push/PR/weekly) and a Dependabot config (weekly npm + GitHub Actions updates) were added; `verify:compat` now auto-derives its export-contract baseline from the latest release tag (with `COMPAT_BASE_TAG` override) instead of a hard-coded version.
- Dependency security: `pnpm audit` found two high dev-chain advisories (`glob <10.5.0`, `nanoid <3.3.18` via vitest/vite); pinned via `pnpm-workspace.yaml` overrides (the pnpm-v10 home for that setting) and the audit is clean.
- `verify:published` now smoke-imports the same full root public surface as `verify:pack`, so the release gate exercises the routing/observability exports end to end.
- Demo accessibility fixes (`examples/demo`): the run-mode segmented control is now an ARIA `radiogroup` with a `radio`/`aria-checked` state on each button, kept in sync by the click handler (previously only a CSS `active` class conveyed the selection, so assistive tech announced no selected mode at all and never announced a change). Its dangling `<label>` became a `<span id="modeSwitchLabel">` referenced via `aria-labelledby`, since a `<label>` with no form control has no accessible-name effect. Both `.state-table`s gained visually-hidden captions, and all eight `<th>` across the three tables gained `scope="col"` so cells are announced with their column header. Guarded by four browser E2E specs asserting no unnamed control, captions and column scopes on every table, and that `aria-checked` follows the selection. The group is also keyboard-operable per the radiogroup pattern: a roving tabindex makes it a single tab stop, and Arrow/Home/End move (and select) between options with a visible `:focus-visible` ring, which buttons previously lacked entirely.

### Fixed
- `effectiveWorkerLoad` is now total against a corrupt base load: the earlier non-finite-score guard fell back to `worker.load` itself, so a stored load of `Infinity` (JSON `1e999`) or a malformed record leaked a non-finite score back into owner selection — the exact array-order dependence the guard was added to prevent. Found by a new seeded property suite (`tests/property.test.ts`) that also pins order-independent minimum selection, `parseDataBusPublication` topic validity, `topicMatchesPattern` segment-boundary invariants, and `createOpaqueKey` shape.
- DataBus transport error isolation is now pinned: a transport whose `publish` throws synchronously, or whose `subscribe` rejects, is funnelled into `onError` instead of escaping the caller or being swallowed (mutation-checked by removing the synchronous catch). `parseDataBusPublication` now also pins the null branch for primitive/null/undefined frames when no fallback topic is available.
- Removed a second unreachable branch: `ReplayManager.schedulePersistenceFlush`'s per-message `append` fallback could never run, because the only queuer (`record()`) pushes to the batch only when the backend advertises `appendBatch`. The batched append is now unconditional there, with the reachability constraint documented. Behaviour-preserving (643 unit tests unchanged).
- Removed an unreachable branch in `WorkerClusterRuntime`'s wildcard publish path: the cache-hit guard queried `assignedTopics` (keyed by the opaque topic key) with the plaintext pattern, so `assignedTopics.has(cachedPattern)` was always false and the branch could never run. The memoisation is now documented as a scan-skip marker only (only the first, scanning call may dispatch a local-wildcard publish locally; later calls route through `resolvePublishTarget`, honouring a concrete remote owner). Behaviour-preserving removal (640 unit tests unchanged) and cluster branch/line coverage rose (90.21 → 90.50 branches, 97.61 → 98.24 lines).
- `CrossTabDataBus.unsubscribe(topic)` without a handler — the documented whole-topic teardown — is now pinned: it clears every handler, tears the transport subscription down exactly once, drops the topic's replay history (no stale replay on re-subscribe), and makes the previously returned per-handler closers no-ops. It previously had no direct coverage (only the with-handler and unknown-topic forms were exercised). Mutation-checked both ways.
- Centrifuge publication metadata is now pinned for the partial cases: a `messageId`-only or `timestamp`-only publish sends an envelope that omits the absent key entirely instead of serialising `undefined` into the server payload.
- Error-path coverage added for the WebSocket transport's separate binary framing path (a binary publish on a closed socket is reported through `onError`; mutation-checked) and for the structured-clone guard's documented skip when a runtime lacks `structuredClone` (older browsers must proceed rather than fail with a spurious `TypeError`; mutation-checked). `BatchingStorageWriter` now also pins that at most one backoff retry timer stays pending while writes keep failing.
- `scripts/bench-browser.mjs` ran the *entire* benchmark at module scope, so nothing could import it — a test, or any other script — without spawning the demo server and launching a Chromium instance. Its environment inputs were also `Number(...)`-coerced with no validation, the same defect class as the `bench:compare` gate: `BENCH_MESSAGES=abc` became `NaN`, the publish loop never executed, and the run died on a 30s `waitForFunction` timeout with no hint of the cause; `BENCH_MESSAGES=0` made `perMessageMs` `0/0`, a `NaN` that `JSON.stringify` archives as `null` and so poisons the trend comparison; `BENCH_MODES=,` silently ran *zero* modes and archived an empty `results` array, leaving `bench:compare` with nothing to compare while still reporting OK; and `PORT=abc` produced `http://localhost:NaN/...` and a server that failed to listen, far from the actual mistake. The runtime body now lives in `main()` behind an `invokedDirectly` guard (the pattern the other release scripts already used), and `PORT` / `BENCH_MESSAGES` / `BENCH_MODES` are parsed by an exported, validated `parseBenchEnv` — an empty value still means "use the default", as before. Covered by `tests/bench-browser.test.ts`, and a source-hygiene guard now fails when a package.json entry point that a test imports runs at import time.
- The new API-reference guard broke CI while passing locally. `pnpm check` runs `typecheck && build && test`, so `tsc --noEmit` sees a fresh checkout with no `dist/` and rejected the guard's literal `import('../dist/index.js')` with TS2307 — the directory existed locally, so the failure was invisible until CI ran. The specifier is now non-literal (`` import(`../dist/${'index.js'}`) ``), the same pattern `tests/dual-format.test.ts` already used for exactly this reason, and a new source-hygiene guard rejects any literal dynamic `import()` of `../dist/` from a test file so the trap cannot be reintroduced silently.
- Each adapter entry (`/hooks`, `/vue`) exported the same four composable names, and the API reference documented the health composable for only *one* adapter per language: English described it under React and never mentioned that `/vue` exports it, while Chinese described it under Vue and never mentioned it under React — and the Chinese Vue heading carried the React name (`useCrossTabHealth`) over a body describing a Vue `Ref`. Both adapters are now documented in both languages, with the Vue binding named `useVueCrossTabHealth` to match the aliasing convention already used throughout that section. The h2/table-row/list-item parity guards could not see this, because both languages have the same shape — a new guard splits the reference on h2 and requires each entry's own section to document every export of that entry.
- The API reference (English and Chinese) did not document the whole public surface: four of the nineteen root exports — `DEFAULT_MAX_ACTIVE_WORKERS`, `approximatePayloadBytes`, `effectiveWorkerLoad`, and `getOrCreateTabId` — were absent from `docs/api.md`, and `CrossTabDataBus.publishBatch` had no entry at all (only the transport-side optional `publishBatch?` hook was described, while the `WorkerClusterRuntime` "Main methods" list also omitted it). All are documented now, including the non-obvious guarantees: `getOrCreateTabId` deliberately does not reuse the stored value when `window.opener` is present (a `window.open()` child inherits the opener's `sessionStorage`, so a blind reuse would give two live tabs one identity), and `effectiveWorkerLoad` always returns a finite score. A new guard derives the export list from the built entry point and fails the suite when a public export is undocumented in either language, so the reference can no longer drift behind the code.
- `effectiveWorkerLoad` could return a non-finite score, which made owner selection depend on the *order* of the worker array. A `windowMs` of `NaN` slipped past the `sample.windowMs <= 0` guard (because `NaN <= 0` is false), and a corrupt sample field (a `NaN` `messageCount`/`overrunMs`) or a non-finite weight divided through to `NaN`. `selectLeastLoadedWorker` compares `byLoad !== 0` — true for `NaN` — and `NaN < 0` is false, so a `NaN` worker won or lost purely by its index: the same worker set produced different owners depending on storage listing order. The score is now total (a non-finite window or result falls back to the raw topic count), pinned by an order-independence regression test.
- The cluster coordination options were entirely unvalidated, so `maxActiveWorkers`, `heartbeatIntervalMs`, `workerTtlMs`, `routeOwnerCacheMax`, and the `loadWeighting` weights all accepted values that silently broke routing: `heartbeatIntervalMs: 0`/`NaN` degenerated the heartbeat `setInterval` into a 0ms busy loop (the exact hazard the Centrifuge PING guard already exists for, and `Infinity` is rejected here because a Worker that never refreshes its heartbeat is pruned by its own TTL), a non-positive `workerTtlMs` pruned every peer on the first reconcile, and a non-positive `maxActiveWorkers`/`routeOwnerCacheMax` disabled ownership or caching outright. A new `assertClusterOptions` runs in the `WorkerClusterRuntime` constructor (so it covers `CrossTabDataBus` and the transport factories too), and the `loadWeighting` weights must be non-negative finite numbers — a negative weight inverted the documented policy by biasing new routes toward the *busiest* Worker.
- `scripts/verify-packed-consumer.mjs` polluted the checkout and leaked its scratch space on every run. It called a bare `npm pack`, so each run wrote `cross-tab-worker-databus-<version>.tgz` into the repository root — a stale archive per version, left behind on every push because CI runs the smoke each time (its sibling `verify-published-consumer.mjs` already used `--pack-destination`). Neither verifier removed its `mkdtempSync` root either, so every run also left ~3 MB of unpacked package in the OS temp directory (five had accumulated locally, ~16 MB). The pack now targets the temp root, and both scripts remove it in a `finally` (best-effort — a blocked delete warns rather than throwing, so it cannot turn a passing verification into a failed release gate).
- The same smoke verified only a hardcoded `['.', './hooks', './vue', './centrifuge']` subpath list, so the two Worker artifacts — `./centrifuge.worker` and `./centrifuge.shared.worker`, the entry points the built-in Worker factory resolves at runtime — were never checked inside the tarball at all. The sweep is now derived from the packed manifest (every declared target must exist, string and conditional entries alike), so a new entry point is covered on the commit that adds it. Verified end to end by pointing a worker export at a missing file and watching the smoke exit 1 with `missing export target ./dist/centrifuge.worker.broken.js for ./centrifuge.worker`.
- `scripts/bench-compare.mjs` did not validate `--fail-above-pct`: the value was `Number(...)`-coerced, so a typo produced `NaN`, and since every `pct > NaN` comparison is false the documented release gate **silently passed** for every metric (`[bench] OK: no metric regressed more than NaN%`). A missing, empty, non-numeric, or negative threshold now throws instead. The same pass made the "one report path" case an error rather than silently comparing the two most recent reports, and split the CLI into validated, exported `parseArgs` / `compareReports` / `findRegressions` helpers covered by `tests/bench-compare.test.ts`.
- `scripts/` was in the ESLint `ignores` list, so the release-critical tooling (the bench gate, the packed/published consumer verifiers, the demo servers) was never linted. It is now covered with Node globals and `no-console` allowed (browser globals scoped to `bench-browser.mjs`, whose Playwright callback really does run in the page). Enabling it surfaced two real findings, both fixed: a `preserve-caught-error` in `verify-version-compat.mjs` (the original error was discarded instead of attached as `cause`) and a misindented `console.log` in `serve-examples.mjs`. A guard fails if `scripts/**` returns to the ignore list.
- `scripts/bench-trend.mjs` stamped the generated trend doc with `new Date()`, so `docs/benchmarks.md` and its Chinese mirror changed every day even when no new benchmark report existed — a spurious diff that also implied fresh data. The stamp is now derived from the latest report's own `generatedAt` (falling back to the `browser-<ISO>.json` filename date), making regeneration a no-op when nothing new was archived. The generated header also claimed "prose is maintained by hand" while the script overwrites the entire file; corrected to say so. The renderer is now a pure exported `buildDocs(entries)`, covered by `tests/bench-trend.test.ts` (stamp source, byte-determinism, delta + all-time-best math, and rejection of an archive with fewer than two reports).
- `BatchingStorageWriter` carried its class JSDoc twice — the first block a truncated copy left over from an earlier edit — so only the second was attached to the class and the first was dead documentation. Removed, with a source-hygiene guard that fails when a JSDoc block is stacked directly on another whose body it prefixes (a file-level header followed by a member's own doc is not flagged).
- Documentation parity (English and Chinese): the English release checklist was missing the "Security and dependency scanning" section (CodeQL + Dependabot) that only the Chinese copy carried; the Chinese roadmap had lost its entire `0.11.0` delivered-scope section and its `0.13.0` candidates section had lost all four items; the Chinese configuration reference omitted the `recovery.cooldownMs` and `recovery.maxAttempts` rows; and the Chinese documentation index's demo link carried a doubled slash. Five new structural guards now compare every localized doc pair (h2 section count, markdown-table row count, list-item count), reject any empty section, and require every shipped doc to be enumerated in `package.json` — this drift class fails the suite instead of shipping silently.
- `dedup.adaptiveTtl` bounds validation accepted non-finite values: `NaN <= 0` and `maxMs < NaN` are both false, so `{ minMs: NaN }` (or an `Infinity` `maxMs`) passed construction and left `currentTtl()` returning `NaN`, silently disabling expiry instead of failing loudly. Bounds must now be finite positive numbers with `minMs <= maxMs`.
- Manual release dispatch derived the release identity from the wrong ref: on `workflow_dispatch`, `GITHUB_REF_NAME` is the selected **branch**, not the `tag` input, so the release job would create a GitHub release named `main` and compute the npm version from the branch (with notes extracted for `main`). The release workflow now resolves `${ inputs.tag || github.ref_name }` once into `RELEASE_TAG` and every step uses it. Guarded by a new `tests/workflows.test.ts`.
- The capabilities matrix (English and Chinese) had a broken table row: the "Optional ArrayBuffer Transferable transport" description was orphaned onto the next row, leaving a 3-cell row beside a 5-cell row so the whole matrix rendered with shifted columns. The description is back on its own row, and a new documentation guard now fails the suite whenever a markdown table mixes cell counts (splitting on unescaped pipes only, so `\|` inside a cell is not mistaken for a separator).
- CHANGELOG structure: the `[Unreleased]` section carried two `### Changed` headings, and the `[0.20.60]` version heading was an h1 (`#`) instead of h2 (`##`) — invisible to the Release workflow's `## [<version>]` notes match. Both fixed, with guards that fail on a repeated subheading within one version section and on any version heading not written as an h2.
- Release checklists (both languages) now include `pnpm test:coverage` in the Before-tagging run so the local dry run matches the CI gate set, and note that `verify:compat` needs `git fetch --tags` in a shallow clone (otherwise it fails with "no version tag found"). A documentation test now asserts each checklist documents the full gate set.
- Vue `useCrossTabDataBus` no longer leaks a bus when the component unmounts inside the async start window. `start()` awaits `stop()` before calling `create()`; an unmount landing in that window ran `stop()` without bumping the lifecycle generation, so the pending continuation still created a bus that nobody owned or stopped. `onBeforeUnmount` now supersedes the pending start. Pinned by a regression test (fails without the fix). The React adapter is unaffected — its `create()` is synchronous inside `useEffect`.
- Stranded-handoff recovery no longer lets concurrent survivors ping-pong route generations: only the deterministically elected owner performs the re-election (peers stand down and wait for its write), and projected loads spread multi-topic recoveries across survivors like the graceful handoff does. When the elected owner has no local subscription — so it would never reconcile the topic — the recovering peer writes the route and notifies it directly instead of standing down forever. Without this, divergent cross-tab views made survivors rewrite the same route every pass, dropping each other's confirmations and piling topics onto one worker. Covered by distribution and unsubscribed-owner regression tests; the multi-round soak pins convergence.
- Stranded unconfirmed handoffs no longer stall forever when the previous owner's `ROUTE_RELEASED` never arrives (dropped channel message under load, or a crash between the route write and the ACK): the reconcile loop re-elects a live owner once the previous owner is gone and the handoff has been stuck longer than a worker TTL (10 s default), rewriting the route with a fresh generation and clearing the handoff marker so the normal confirmation path completes. While the previous owner is still alive the new owner keeps waiting, and a fresh handoff is never mistaken for a stranded one (age gate), so the strict handoff keeps its no-overlap guarantee. Pinned by two regression tests (recovery after the TTL vs. continued waiting while the previous owner lives); architecture docs (EN+ZH) updated.
- Adaptive dedup TTL now takes effect on the hot path: the opportunistic per-message expiry used the fixed `ttlMs` while the sweep and `getStats()` used the adaptive window, so a burst that shrank the effective TTL toward `minMs` still retained IDs for the full fixed TTL where nearly all traffic flows. The hot path now expires against `currentTtl()`. Pinned by a direct `DedupManager` suite (`tests/dedup-manager.test.ts`: acceptance/suppression, TTL expiry, FIFO eviction, sweep lifecycle, adaptive shrink/relax/window-reset; fails without the fix).

### Changed
- The demo's config panel now shows the active chaos mode (`丢弃交接确认` / `模拟崩溃` / `未启用`): a tab that is dropping handoff ACKs or simulating a crash was previously visually indistinguishable from a healthy one. Both chaos gates are now read live at call time (previously `dropHandoffAck` was captured at bus creation), so a toggle takes effect immediately and the panel cannot show a mode that is not actually active. Both chaos E2E specs assert the row.
- The `Release` workflow now re-runs `pnpm lint` before publishing (a version tag can point at a commit that never passed CI's lint job), alongside the existing `verify:compat` / `verify:pack` release gates. Both release checklists document it, and a workflow guard asserts the step exists.
- `package.json`'s `files` list now enumerates every shipped doc explicitly, adding the localized `docs/zh/README.md` and `README.zh.md` (mirroring the already-listed `docs/README.md` / `README.md`). npm auto-includes `README*` / `LICENSE*` / `CHANGELOG*` regardless of `files`, so these two were shipped anyway — but a *non*-README doc left off the list would silently vanish from the tarball, so a guard now fails when a doc on disk is not published.
- Dependency upgrades: vitest 4 → 5 (with the matching coverage provider) and the scoped lint-config package 9 → 10 to match eslint 10. Vitest 5 rewrote the benchmarking API (`bench` is now a test-context fixture instead of a module-scope import), so all 25 benchmarks in `tests/bench/` were migrated to the `test(name, async ({ bench }) => { await bench(name, fn).run(); })` form; the suite reports identical hot-path numbers under the new runner.
- Dependency security: vitest upgraded 3.2 → 4.1.11 (with the matching coverage provider) to clear the GHSA-82fw-gwwq-j7x9 path-traversal advisory in the vitest mocker package; the audit is clean again and the full suite (typecheck, 460 unit, bench, e2e) is green on the new major. One test helper's mock-factory return type needed explicit callback typing under Vitest 4's tighter mock generics.
- Playwright E2E default timeout raised 60 s → 90 s so convergence waits (30–45 s) can legitimately stack with `HANDOFF_TIMEOUT_MS` (60 s) polls inside one test; the storage-event handoff test — the one suite whose 45 s convergence + 60 s handoff previously exceeded the old ceiling — now carries an explicit 120 s budget. This removes the documented flake class where a healthy but slow handoff poll died on the test-level timeout rather than its own.
- The demo's config panel shows the load-weighting toggle state (启用 消息/字节/滞后 vs 禁用 纯 Topic 数), and the routing benchmark suite gains a `weighted + lag` owner-selection baseline.
- The COORDINATION trace event is now emitted after each transport open (start and recovery) with the settled route list; previously it fired synchronously at the top of `start()` where subscription writes were still coalesced, so its `routes` field was always empty.
- The CI verify job now runs `pnpm audit` (dependency security gate) and the release checklists document the audit step.
- IndexedDB replay persistence coalesces concurrent `appendBatch` calls into a single read-modify-write transaction (regression: ten concurrent batches = one readwrite transaction) while preserving order against `clear`/`clearTopic`/`clearBefore`.
- The root export surface is pinned by a regression test, making pre-1.0 API additions/removals deliberate.
- Benchmarks: load-weighting scoring, `getMetrics` snapshot, and `publishBatch` batch-size sensitivity (10/50/100 per call) baselines.
- GitHub Actions bumped to current majors (checkout/setup-node/upload-artifact v4 → v7, pnpm/action-setup v4 → v6), dropping the Node 20 deprecation warning on the forced Node 24 action runtime.
- Browser E2E handoff tests (owner migration, multi-tab soak, BFCache) wait up to 60 s for a pagehide owner takeover, absorbing shared-runner scheduling jitter.
- The demo WebSocket hub attributes wire-frame counters per topic (`/debug/wsstats.topics`) so the single-frame `publishBatch` assertion is immune to concurrent tests on a parallel local run.
- Browser benchmark databus matrix now measures real dispatch work: auto-start defers `transport.start` to a microtask, so the emit/publish cases previously ran before the transport was live (messages dropped, publishes queued) and reported sub-millisecond no-ops. Cases now `await ready()` plus a bounded assignment poll and assert exact delivery counts; the `publishBatch` case uses an echo stub to measure the full route → publish → dispatch round-trip, and a `firstPacketMs` cold-dispatch baseline was added.

## [0.20.83] - 2026-09-05

### Added
- `useCrossTabHealth` edge-case coverage for both adapters (React and Vue): interval polling refreshes the health snapshot, detaching a stopped bus resets it to `null` and unsubscribes its status/error listeners, and unmounting never leaks the polling timer.
- Browser benchmarks now archive every run under `bench-results/` (gitignored), and a new `scripts/bench-compare.mjs` prints per-metric deltas between two runs so publish-throughput and hot-path regressions can be checked locally.
- The demo gains a "批量 10" button that publishes ten JSON items through `CrossTabDataBus.publishBatch` with per-item `messageId`s; the demo WebSocket hub counts `publish` vs `publishBatch` wire frames and exposes them via `/debug/wsstats`, and a new E2E asserts the burst travels as exactly one frame with no per-item publishes.
- Documented the `asyncSink: true` delivery semantics in the API reference (English and Chinese): microtask-batched FIFO delivery, unchanged error isolation, and the ordering boundary versus the synchronous sink.
- Added the `src/utils/` toolbox: shared string constants with literal-derived types, `publicationMetadata`, fault-tolerant storage primitives (`readJson`/`writeJson`/`listKeys`/`readAllByPrefix`), option-validation asserts, and Worker-boundary error serialization.

### Changed
- Every runtime string literal in the SDK is centralized in `utils/constants.ts`; status/role/action unions and cluster/worker/message/trace discriminants are derived from those constants so values and types cannot drift apart, and the repeated magic strings across source and tests were unified.
- Replay buffering and inbound deduplication moved out of `CrossTabDataBus` into self-contained `ReplayManager` and `DedupManager` classes with their own lifecycle; the DataBus delegates to them and deliberately keeps its lifecycle state machine in place (`data-bus.ts` shrank from ~1440 to ~1094 lines).
- The release checklist (English and Chinese) now documents the tagged-release workflow's blocking published-consumer verification (`verify:published`, 24×5 s retry budget) instead of treating it as a post-publication side note.

## [0.20.82] - 2026-09-05

### Added
- The default Playwright assertion ceiling rose to 20 s, covering every remaining poll on slow shared runners.
- Added non-cloneable-config coverage (symbols) with `cause` preservation for the Worker transport's structured-clone guard.
- Added a `/debug/connections` endpoint to the examples server and an E2E asserting that a closed shared-mode tab's WebSocket is dropped server-side.

## [0.20.81] - 2026-09-05

### Added
- `bench:browser` now also runs the data-bus hot-path matrix (wildcard dispatch, `publishBatch`, dedup, trace-and-publish) inside a real browser against the built ESM bundle, reported alongside the publish-throughput results for Node-vs-browser comparison.
- The E2E suite asserts the health summary end to end: the demo's health line reads healthy and `window.__bus.getHealthSummary()` reports `{ healthy: true, state: 'healthy' }` on a connected tab.
- Documented `createStorageEventChannel` in the API reference (English and Chinese) and added the transport-level `publishBatch` row to the capabilities matrix.

## [0.20.80] - 2026-09-05

### Added
- E2E failure artifacts now include Playwright traces (retain-on-failure) and first-retry videos; diagnostics retention extended to 14 days.
- Reload-style E2E tests converge the cluster (exactly one owner) before publishing, removing the standby re-subscription race behind intermittent CI failures.
- Documented the loss-and-recovery matrix for every coordination message in the architecture docs (English and Chinese).

### Changed
- The concurrent-burst E2E staggers publishes within each tab: hammering one transport with a same-tick burst can push it into a documented disconnect window where dropped publishes are expected.

## [0.20.79] - 2026-09-05

### Added
- The Release workflow now fails when the published-package consumer verification fails (retry budget raised to 24 × 5 s to cover registry propagation); releases without an npm token keep skipping the check.
- Added a regression pinning the full lost-handoff-ACK recovery chain: TTL cleanup of the orphaned route followed by ownership re-election when the original owner resumes.

## [0.20.78] - 2026-09-05

### Added
- The demo now shows the REAL transport backend (`getDiagnostics().transport.backend`) and the E2E suite asserts dedicated/shared tabs actually run on Worker backends — a silent fallback to the local session fails CI instead of passing unnoticed.
- Added a regression pinning the deferred channel close in `pause()` so queued handoff frames always flush.
- Documented the close-ordering invariant in the architecture docs and added health-summary/fallback quick-start sections to the getting-started guide (English and Chinese).

## [0.20.77] - 2026-09-05

### Fixed
- Worker-backend availability now honors runtime capability in addition to injected factories: without the fix, a browser consumer that did not pass an explicit `workerFactory`/`sharedWorkerFactory` silently degraded to the main-thread local session and never used the bundled Dedicated/Shared Workers.

### Added
- Added default-backend coverage for the bundled Dedicated/Shared Worker paths and the `uninitialized` diagnostics identity.
- Added storage-event channel loss-recovery regressions: a silently dropped delivery is recovered by the heartbeat reconcile loop.
- The demo now surfaces coordination-channel diagnostics and an opt-in `channelFallback: 'storage-event'` toggle.

## [0.20.76] - 2026-09-05

### Added
- Added an opt-in coordination channel fallback for environments without BroadcastChannel: `createBrowserEnvironment({ channelFallback: 'storage-event' })` installs a localStorage storage-event `ClusterChannel` (exported as `createStorageEventChannel`), preserving cross-tab owner coordination instead of degrading to local mode. Coordination payloads persist to localStorage under a dedicated key namespace — a documented security trade-off, which is why the fallback is opt-in.

## [0.20.75] - 2026-09-05

### Added
- Added hot-path performance gates to the unit suite: generous-ceiling assertions over wildcard/exact topic matching, opaque-key hashing, and worker selection loops, so catastrophic hot-path regressions fail CI while real benchmarking stays in `pnpm bench`.
- Extended IndexedDB replay persistence tests with scripted fault injection (transaction-construction failure and failing store requests), covering the adapter's invalidate-and-recover error paths.

## [0.20.74] - 2026-09-05

### Added
- Added an optional `publishBatch` to the `DataBusTransport` contract: transports that can pack many items into one wire frame (the bundled WebSocket transport sends a single `publishBatch` frame) are used for burst publications, with automatic per-item `publish` fallback for transports without batch support.
- Added `useCrossTabHealth` to the React and Vue adapters, mirroring `getHealthSummary()` with interval polling (default 1 s, `intervalMs: 0` for event-driven only) plus event-driven refreshes on status changes and errors.
- The demo WebSocket server accepts `publishBatch` frames and re-fans them out as individual timestamped publications.

### Fixed
- `getHealthSummary()` now accounts for the live transport status, so a transport reporting `error`/`disconnected` no longer reads as `healthy` while the `transportReady` flag has not yet been cleared.

## [0.20.73] - 2026-09-05

### Added
- Added unit-test coverage for the IndexedDB replay persistence adapter via `fake-indexeddb`: round-trip, count/age/both pruning, `appendBatch` grouping, mutation-queue serialization of concurrent same-topic appends, `clear`/`clearTopic`/`clearBefore` semantics, and recovery after a transient open failure.
- Added real-browser E2E coverage for concurrent multi-publisher bursts across three tabs and for a full connection re-apply (bus stop/start) that rejoins the cluster without duplicate ownership.
- Added a "Stability Invariants" section to the architecture docs (English and Chinese) consolidating the handoff, cleanup-ordering, recovery-budget, and BFCache guarantees pinned by the regression suite.

## [0.20.72] - 2026-09-05

### Added
- Added advanced hot-path benchmarks for `publishBatch`, wildcard routing, deduplication, replay pruning, `appendBatch` persistence, and asynchronous trace sinks.
- Added `CrossTabDataBus.getHealthSummary()` with a single-object readiness verdict (`healthy`, lifecycle-derived `state`, unified `lastFailure` ledger, transport identity, and recovery context) for dashboards and readiness probes.
- Added `getPersistenceStats()` and surfaced persistence failure counters in `getDiagnostics()`; transport diagnostics now include the live connection `status` and `suspended` flag.
- Added long-session stability regression coverage for owner-handoff ACK validation, repeated BFCache round-trips, recovery exhaustion reset, storage write backoff recovery, and replay persistence cleanup races.

### Fixed
- Stale `ROUTE_RELEASED` ACKs whose generation is older than the current route record are now rejected; the comparison was inverted, so a replayed ACK from an earlier handoff round could confirm a newer handoff.
- Replay persistence cleanup no longer resurrects cleared history: a queued batch flush is filtered for topics cleared via `unsubscribe`/`clearReplayTopic` and for entries pruned via `clearReplayBefore`.
- Diagnostics report the released SDK version, injected from `package.json` at build time, instead of a stale hardcoded constant.

## [0.20.71] - 2026-09-05

### Added
- Added optional bulk replay persistence via `appendBatch`, with IndexedDB transaction coalescing for burst publications while preserving legacy adapters.

## [0.20.70] - 2026-09-05

### Added
- Added SDK version and transport/backend identity to `CrossTabDataBus.getDiagnostics()` for support bundles and health dashboards.

## [0.20.69] - 2026-09-05

### Added
- Exposed peer protocol capability versions in `WorkerClusterSnapshot.peerProtocolVersions` and `CrossTabDataBus.getDiagnostics().protocol.peers`; legacy peers are represented as `null`.
- Worker registration records now advertise `protocolVersion: 1` for runtime capability discovery.

## [0.20.68] - 2026-09-05

### Added
- Added explicit cluster protocol version metadata (`protocolVersion: 1`) to CONTROL, EVENT, REGISTRY, and ROUTE_RELEASED frames and worker snapshots.
- Legacy frames without the optional field remain accepted, while unknown message types continue to be safely ignored and diagnosed.
- Added cross-version protocol compatibility regression coverage.

## [0.20.67] - 2026-09-05

### Added
- Added bounded unknown protocol message diagnostics on `WorkerClusterRuntime` and `CrossTabDataBus.getDiagnostics()`, including count and last message type while preserving safe ignore behavior.

## [0.20.66] - 2026-09-05

### Added
- Extended IndexedDB replay persistence with optional `pruneStrategy` (`count`, `age`, `both`) and `retentionMs`, applying the same trimming semantics as in-memory replay.

## [0.20.65] - 2026-09-05

### Added
- Added opt-in adaptive dedup TTL sampling with bounded `minMs`/`maxMs` controls and diagnostics exposure.
- Added replay `pruneStrategy` configuration (`count`, `age`, `both`) for memory history trimming while preserving legacy defaults.

## [0.20.64] - 2026-09-05

### Added
- Added opt-in `asyncSink` trace mode, batching sink delivery onto a microtask while preserving event order and sink error isolation.
- Added regression coverage for asynchronous trace batching (339 unit tests).

## [0.20.63] - 2026-09-05

### Added
- Added an optional `onUnknownMessage` hook and forward-compatible protocol handling so older runtimes ignore future cluster message variants without throwing.
- Added regression coverage for unknown protocol variants (338 unit tests).

## [0.20.62] - 2026-09-05

### Added
- Added `CrossTabDataBus.getDiagnostics()` combining lifecycle status, transport readiness, recovery history, dedup counters, replay buffer usage, and cluster snapshot into one health-oriented view.
- Added coverage for the top-level diagnostics contract.

## [0.20.61] - 2026-09-05

### Added
- `originTabId?: string` on every `DataBusMessage` (and on the cluster `EVENT` wire frame) so cross-tab replay history is attributed to the tab that produced it.
- `WorkerClusterRuntime.broadcastEvent()` now defaults `originTabId` to the producing runtime's `tabId` so existing callers (and tests) get source-tab attribution without threading the value manually.
- `CrossTabDataBus.handleTransportMessage` stamps `originTabId = cluster.tabId` before broadcasting, so neighbors and IndexedDB-replayed late subscribers see the same attribution.
- Four unit tests under `CrossTabDataBus cross-tab replay consistency contract` cover the producing-tab stamp, local-handler parity, post-write late join with replay, and local-origin replay path.
- One e2e replay-persistence test now uses `toMatchObject` to tolerate the additional `originTabId` field on persisted entries.

### Changed
- `WorkerClusterRuntime.onEvent` handler signature now includes a fourth `originTabId?: string` argument; existing call sites use `toMatchObject` so the extra argument does not break strict equality.

## [0.20.60] - 2026-09-04

### Added
- `publishBatch(topic, items)` on both `CrossTabDataBus` and `WorkerClusterRuntime` packs multiple items into a single BroadcastChannel postMessage so the receiving owner can dispatch them in one tick instead of one channel post per item.
- Per-item `messageId` / `timestamp` is preserved across the batched wire frame, so dedup / replay / ordering still apply per item in the original order.
- Empty batch is a no-op; single-item batch delegates to `publish()` so callers do not have to special-case the boundary.
- Added a `data bus hot paths` bench case (`publishBatch / 1000 messages / 10 per call`) to give an upper-bound reference for the burst path.

## [0.20.59] - 2026-09-04

### Added
- Extended `CrossTabDataBus.getRecoveryStats()` with `generation` (monotonic counter incremented on every successful transport open) and `lastSuccessAt` (timestamp of the most recent successful open, or `null` until the transport reaches `ready`).
- Added a unit test asserting generation/lastSuccessAt advance on the initial start and after a recovery, and stay stable across failed recovery attempts.

## [0.20.58] - 2026-09-04

### Changed
- Bounded the publish route-owner cache to a configurable LRU cap (default 256), evicting the oldest entry on overflow.
- Surfaced route-owner cache diagnostics (`size`, `max`, `hits`, `misses`) on `WorkerClusterRuntime.getSnapshot()` so callers can observe warm vs. cold route resolution.
- Fixed a correctness bug where `wildcardPublishCache`'s `null` entry short-circuited the remote-owner publish path; topics with no local wildcard subscription now still consult the route-owner cache and forward to the remote owner.

### Added
- Added `routeOwnerCacheMax` to `WorkerClusterOptions` for tuning the route-owner cache size per workload.
- Added unit tests for LRU eviction, TTL-based cache invalidation, owner migration, and remote-owner cache hits.

## [0.20.57] - 2026-09-04

### Added
- Added warm/cold route-cache publish benchmark coverage to make owner-routing performance measurable.

## [0.20.56] - 2026-09-04

### Changed
- Added generation-checked route-owner caching for publish routing and cleared it across lifecycle teardown.

## [0.20.55] - 2026-09-04

### Changed
- Added a bounded wildcard publish decision cache with lifecycle-safe invalidation.

## [0.20.54] - 2026-09-04

### Added
- Added `errorAt` to `getRecoveryStats()` for recovery incident timing.


## [0.20.53] - 2026-09-04

### Added

- Extended `getRecoveryStats()` with a safe `errorMessage` summary for diagnostics without exposing the raw error object.

## [0.20.52] - 2026-09-04

### Added

- Extended `getRecoveryStats()` with `hasError`, exposing whether the current transport error is still retained.

## [0.20.51] - 2026-09-04

### Added

- Added a public recovery-state snapshot API via `getRecoveryStats()`.

## [0.20.50] - 2026-09-04

### Added

- Added owner-handoff unsubscribe coverage proving a handed-off route is not recreated after the surviving tab unsubscribes.

## [0.20.49] - 2026-09-04

### Added

- Added unsubscribe-before-reconnect coverage proving removed topics are not replayed after lifecycle recovery.

## [0.20.48] - 2026-09-04

### Added

- Added multi-topic recovery coverage proving every topic is restored exactly once after reconnect.

## [0.20.47] - 2026-09-04

### Added

- Added extended reconnect flapping coverage proving replay stays bounded and duplicate-free.

## [0.20.46] - 2026-09-04

### Added

- Added repeated worker capability-probe coverage proving auto backend selection remains deterministic across repeated checks.

## [0.20.45] - 2026-09-04

### Added

- Added repeated WebSocket error/restart coverage proving only the newest connection remains active.

## [0.20.44] - 2026-09-04

### Added

- Added a lifecycle contract regression proving stale WebSocket close/error callbacks cannot affect a restarted session.

## [0.20.43] - 2026-09-04

### Added

- Added repeated WebSocket stop/start cleanup coverage proving subscriptions and stale callbacks are cleared across lifecycle cycles.

## [0.20.42] - 2026-09-04

### Added

- Added repeated Dedicated Worker stop/start cleanup coverage proving STOP boundaries detach stale worker delivery across lifecycle cycles.

## [0.20.41] - 2026-09-04

### Added

- Added repeated SharedWorker stop/start resource-soak coverage proving listeners and heartbeat timers are released after every cycle.

本项目遵循 [Semantic Versioning](https://semver.org/)；变更记录格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [0.20.40] - 2026-09-04

### Added

- Added auto worker-mode repeated failure/recovery coverage proving SharedWorker preference remains stable and stale ports cannot deliver publications after successive reopen cycles.

## [0.20.39] - 2026-09-03

### Added

- Added repeated Dedicated Worker failure/recovery coverage proving stale messages from superseded workers cannot reach the reopened session.

## [0.20.38] - 2026-09-03

### Added

- Added repeated SharedWorker failure/recovery coverage proving stale messages from multiple superseded ports cannot reach the reopened session.

## [0.20.37] - 2026-09-03

### Added

- Added a repeated WebSocket replacement regression proving stale lifecycle/message callbacks from multiple superseded sockets cannot leak into the newest session.

## [0.20.36] - 2026-09-03

### Added

- Added a high-frequency publish regression proving local-owner fast-path publication preserves ordering and avoids storage reads across a 1,000-message burst.

## [0.20.35] - 2026-09-03

### Added

- Added public data-bus hot-path benchmarks for publish and receive/dispatch throughput, complementing routing and cluster coordination baselines.

## [0.20.34] - 2026-09-04

### Added

- Added a transport-recovery regression covering replay history, duplicate suppression, persistence append boundaries, and late-handler ordering after automatic resubscription.

## [0.20.33] - 2026-09-03

### Added

- Added `pnpm verify:compat` to compare the current package manifest with a prior release tag and reject removed public exports, module conditions, or type metadata.

## [0.20.32] - 2026-09-03

### Added

- Added a replay/dedup combination regression covering hydrated history, live delivery after recovery, duplicate suppression, persistence append boundaries, and late-handler replay ordering.

## [0.20.31] - 2026-09-04

### Fixed

- WebSocket transport now isolates stale socket lifecycle and message callbacks after stop/start replacement, preventing late frames from an old connection entering a new session.

### Added

- Added regression coverage for stale-socket isolation during transport replacement.

## [0.20.30] - 2026-09-04

### Added

- Extended the real IndexedDB replay persistence E2E through a BFCache round trip before reload, verifying ordered durable history and asynchronous replay hydration across both lifecycle transitions.

## [0.20.29] - 2026-09-04

### Added

- Added an exhaustive worker backend fallback matrix covering dedicated, shared, and auto preferences across every capability combination.

## [0.20.28] - 2026-09-04

### Added

- Expanded packed-consumer verification into a release compatibility matrix covering package version metadata, dual-format export targets, declaration files, and root/subpath consumers.

## [0.20.27] - 2026-09-04

### Added

- Added a real Chromium long-soak regression covering repeated BFCache pagehide/pageshow cycles, reloads, owner handoff, reconnect readiness, and duplicate-free delivery.

## [0.20.26] - 2026-09-04

### Added

- Added trace diagnostics contract coverage for privacy-safe fields, events/metrics mode isolation, repeated sink failures, reliability schema timestamps, bounded state, and lifecycle metrics windows.

### Fixed

- Stopped trace reporters no longer emit metrics from later manual flushes until explicitly started again.

## [0.20.25] - 2026-09-03

### Added

- Added WebSocket, Centrifuge, and shared publication-parser compatibility coverage for legacy frames, nested envelopes, unknown fields, invalid optional metadata, and unknown worker protocol variants.

## [0.20.24] - 2026-09-03

### Added

- Added a long-running replay/dedup regression covering quiet-period TTL sweeps, re-acceptance after expiry, durable retention cleanup, asynchronous hydration, and lifecycle timer shutdown.

## [0.20.23] - 2026-09-03

### Added

- Added a BFCache + transport-error owner-handoff regression covering recovery, takeover, and duplicate-free delivery across two tabs.

## [0.20.22] - 2026-09-03

### Fixed

- Explicit stop/restart lifecycles now reset recovery attempt and exhaustion state so a new session starts with a fresh diagnostic sequence.

## [0.20.21] - 2026-09-03

### Fixed

- Recovery exhaustion diagnostics are now emitted at most once per failed recovery sequence and reset after a successful reopen.

## [0.20.20] - 2026-09-03

### Added

- Automatic recovery now emits an `exhausted` reliability event when `recovery.maxAttempts` is reached, instead of stopping silently.

## [0.20.19] - 2026-09-03

### Added

- Added optional `recovery.maxAttempts` to cap automatic transport reopen attempts while preserving explicit demand-driven recovery.
- Added validation and regression coverage for capped recovery sequences.

## [0.20.18] - 2026-09-03

### Added

- Added optional `recovery.cooldownMs` to tune automatic transport reopen pacing for different runtime environments.
- Added validation and fake-timer coverage for custom recovery cooldowns.

## [0.20.17] - 2026-09-03

### Added

- Consecutive transport recovery traces now carry monotonic attempt numbers and reset after a successful reopen.
- Added regression coverage for multi-failure recovery sequences.

## [0.20.16] - 2026-09-03

### Added

- Transport recovery trace events now report `scheduled`, `succeeded`, and `failed` outcomes, making reconnect failures diagnosable without exposing payloads or connection details.
- Added regression coverage for failed recovery followed by a successful retry.

## [0.20.15] - 2026-09-03

### Added

- Added transport status-flapping regression coverage to ensure repeated connection state notifications do not duplicate or lose assigned topic subscriptions.

## [0.20.14] - 2026-09-03

### Changed

- Release jobs now preserve published-consumer verification failures as explicit summary diagnostics without marking an otherwise successful publish as failed; local verification remains strict.

## [0.20.13] - 2026-09-03

### Added

- CI now uploads Playwright reports and test results when browser E2E fails, preserving actionable diagnostics for flaky runner failures.

## [0.20.12] - 2026-09-03

### Added

- Published-consumer verification now reports package and optional peer-dependency link context when an import fails on CI.

## [0.20.11] - 2026-09-03

### Added

- Release workflow runs one serialized job per tag and records the exact npm version, tag, and commit in the GitHub step summary for easier failure diagnosis.

## [0.20.10] - 2026-09-02

### Added

- Added reconnect-cycle regression coverage proving every assigned topic is replayed exactly once per transport reconnect.

## [0.20.9] - 2026-09-02

### Fixed

- Published-consumer verification now accepts both npm versions (`0.20.9`) and Git tags (`v0.20.9`) as input.

## [0.20.8] - 2026-09-02

### Added

- Release verification now retries npm tarball resolution to tolerate registry propagation after publication.
- The release workflow always verifies the exact tagged package's ESM and CommonJS consumers after the publish-or-skip step.

## [0.20.7] - 2026-09-02

### Added

- Added published-package consumer verification that downloads the npm version, then imports every public ESM and CommonJS entry point from a clean temporary consumer.
- The verification can target `PUBLISHED_VERSION` explicitly, making release validation independent from the local checkout version.

## [0.20.6] - 2026-09-02

### Added

- Added a release checklist covering local gates, packed-consumer verification, tag creation, and manual npm publication.
- Added migration guidance for pre-0.20 consumers and clarified that historical npm versions are immutable and are not republished from the current tree.

## [0.20.5] - 2026-09-02

### Added

- Added public-consumer freeze coverage for root, hooks, Vue, and Centrifuge subpaths across ESM and CommonJS artifacts.
- Declaration checks now verify the shipped `.d.ts` files and key replay, deduplication, and publication metadata types.

## [0.20.4] - 2026-09-02

### Added

- Added a real Chromium multi-tab soak scenario covering repeated fan-out, owner migration, BFCache round trips, reload recovery, and duplicate-free delivery.
- Browser regression coverage now exercises lifecycle transitions as one continuous session instead of isolated one-shot checks.

## [0.20.3] - 2026-09-02

### Added

- Added React lifecycle coverage for dynamic topic changes.
- Topic replacement now verifies old subscriptions are removed before the new topic is delivered, including end-to-end WebSocket hook wiring.

## [0.20.2] - 2026-09-02

### Added

- Added protocol recovery coverage proving valid WebSocket publications continue after malformed binary and text frames.
- Binary truncation, JSON parse failures, nested envelopes, and error isolation are now exercised as one compatibility sequence.

## [0.20.1] - 2026-09-02

### Added

- Added persistence mutation-sequence soak coverage spanning hydration, retry recovery, topic cleanup, subsequent append, and full cleanup.
- Recovery tests now verify that serialized persistence operations remain usable after transient failures.

## [0.20.0] - 2026-09-02

### Added

- Formalized publication-envelope compatibility coverage across legacy, nested, fallback-topic, primitive payload, metadata, and unknown-field frames.
- Empty or missing topics are rejected consistently while transport-supplied fallback channels remain supported.

## [0.19.9] - 2026-09-02

### Added

- Added regression coverage for deduplication and replay/persistence composition.
- Duplicate publications are verified not to pollute replay history, while IDs can re-enter history after TTL expiry.

## [0.19.8] - 2026-09-02

### Fixed

- IndexedDB replay persistence now invalidates cached connections after transaction creation or request failures.
- Closed or otherwise unusable connections can recover through the existing persistence retry path without recreating the adapter.

## [0.19.7] - 2026-09-02

### Fixed

- IndexedDB replay persistence no longer permanently caches a rejected `open()` promise after transient initialization failures.
- Subsequent persistence operations can reopen the database and recover without recreating the adapter.

## [0.19.6] - 2026-09-02

### Fixed

- IndexedDB replay persistence now handles cross-tab `versionchange` events by closing stale connections and reopening on the next operation.
- Multi-tab schema changes no longer leave the adapter permanently bound to an invalid connection.

## [0.19.5] - 2026-09-02

### Fixed

- React `useCrossTabDataBus` now ignores stale effect generations during rapid dependency changes.
- Superseded asynchronous cleanup can no longer clear or overwrite the newest bus lifecycle.

## [0.19.4] - 2026-09-02

### Fixed

- Vue `useCrossTabDataBus` now guards against stale asynchronous stop/start completions during rapid reactive dependency changes.
- A superseded lifecycle no longer resurrects an obsolete bus instance after a newer dependency update.

## [0.19.3] - 2026-09-02

### Added

- Added optional `dedup.sweepMs` for periodic expiry cleanup during quiet periods.
- Dedup sweep timers follow start/resume and pagehide/stop lifecycle boundaries.

## [0.19.2] - 2026-09-02

### Fixed

- Pending persistence retries are cancelled across `stop()` and pagehide suspension boundaries.
- Lifecycle-cancelled retries no longer emit persistence errors or start another adapter attempt.

## [0.19.1] - 2026-09-01

### Fixed

- WebSocket transport now accepts browser `Blob` binary frames and decodes them through the existing ArrayBuffer protocol path.
- Blob conversion failures are isolated through the transport error handler without crashing the message callback.

## [0.19.0] - 2026-09-01

### Added

- Persistence retry now emits opt-in `reliability` trace events with the bounded operation name and retry attempt.
- Retry diagnostics cover `load`, `append`, `clear`, `clearTopic`, and `clearBefore` without exposing payloads or error bodies.

### Compatibility

- Tracing remains disabled by default; retry timing, adapter contracts, and final error behavior are unchanged.

## [0.18.0] - 2026-09-01

### Added

- Added opt-in `replay.persistenceRetry` with bounded attempts and exponential backoff for transient persistence failures.
- Replay append, hydrate, clear, topic cleanup, and retention cleanup now share the same retry policy.
- Exported `DataBusPersistenceRetryOptions` for typed configuration.

### Compatibility

- The default retry policy is one attempt, preserving existing persistence behavior and error timing.
- Persistence adapters remain unchanged; retry orchestration stays in `CrossTabDataBus`.

## [0.17.0] - 2026-09-01

### Added

- Added optional `replay.retentionSweepMs` for periodic durable replay retention cleanup when no new publications arrive.
- Retention sweeps follow the DataBus lifecycle: start/resume enables the timer, while pagehide/stop disables it.
- Added fake-clock lifecycle coverage for timer cleanup and invalid sweep intervals.

### Compatibility

- `retentionSweepMs` is opt-in and has no effect without both `retentionMs` and a persistence adapter implementing `clearBefore()`.
- Existing publication-triggered cleanup, manual cleanup, and replay persistence contracts remain unchanged.

## [0.16.0] - 2026-09-01

### Added

- Replay retention cleanup is coalesced during publication bursts; the newest cutoff wins while cleanup mutations remain serialized.
- WebSocket binary-frame compatibility coverage now verifies truncated, invalid-magic, and incomplete-header frames are ignored safely.

### Compatibility

- Retention cleanup remains opt-in through `replay.retentionMs`; manual `clearReplayBefore()` behavior is unchanged.
- Existing JSON, nested publication-envelope, and legacy binary payload formats remain supported.

## [0.15.0] - 2026-09-01

### Fixed

- Replay retention now preserves legacy messages that do not carry an explicit producer timestamp; only timestamped messages older than the cutoff are removed.

### Added

- Trace event timestamps accept an injectable `trace.now` clock for deterministic lifecycle and metrics tests.
- Added compatibility coverage for timestamp-less replay cleanup and injected trace clocks.

### Compatibility

- Existing `DataBusTraceOptions` and replay persistence adapters remain source-compatible; wall-clock behavior remains the default.

## [0.14.0] - 2026-09-01

### Fixed

- Vue `useCrossTabSubscription` now rebinds when a reactive topic changes on the same bus instance.

### Added

- Vue topic-switch lifecycle regression coverage.
- Release scope documents cross-page replay mutation ordering and adapter parity guarantees.

## [0.13.0] - 2026-09-01

### Added

- IndexedDB replay mutations are serialized per adapter instance, preventing concurrent append read-modify-write races from losing history.
- Dedup memory is reset as part of a full stop lifecycle, so a restarted bus begins with a clean delivery window.
- Added persistence-failure diagnostics and lifecycle regression coverage.

## [0.12.0] - 2026-09-01

### Added

- Deduplication TTL now accepts an injectable `dedup.now` clock for deterministic tests and host runtimes without a wall-clock dependency.
- Persistence failures in replay append/cleanup paths emit bounded `persistence_cleanup` reliability diagnostics before reaching error handlers.
- Publication parsing now accepts only non-empty message IDs and finite timestamps, while preserving legacy payload compatibility.
- Added protocol compatibility tests for legacy, nested, fallback-topic, and malformed metadata frames.

### Compatibility

- `dedup.now` is optional and existing configurations keep wall-clock behavior.
- Invalid metadata is ignored instead of poisoning a publication; the topic and payload remain deliverable.

## [0.11.0] - 2026-09-01

### Added

- Automatic durable replay retention via `replay.retentionMs` when a persistence adapter supports `clearBefore`.
- Deduplication accepted/suppressed counters in periodic `message_metrics` trace snapshots.
- Service Worker runtime boundary documented as intentionally deferred pending stable browser lifetime semantics.

### Compatibility

- Existing replay adapters remain valid; `retentionMs` is ignored when an adapter does not implement `clearBefore`.
- Existing trace consumers can continue reading the original metrics fields; dedup counters are additive.

## [0.10.0] - 2026-09-01

### Added

- Formal transport-neutral publication metadata types (`DataBusPublication`, `DataBusPublicationMetadata`, and `DataBusPublicationEnvelope`).
- Publication metadata (`messageId` and `timestamp`) now traverses cluster controls, Centrifuge Worker boundaries, and WebSocket publish frames.
- Demo WebSocket server emits the canonical nested publication envelope and preserves caller metadata; real-browser contract coverage added.

### Compatibility

- Flat WebSocket publication frames remain accepted.
- Existing payloads without metadata retain their legacy shape.

## [0.9.0] - 2026-09-01

### Added

- Dedup runtime statistics (`getDedupStats`) and reset API (`resetDedup`).
- Replay retention APIs: `clearReplayTopic` and `clearReplayBefore`; IndexedDB supports optional time-based pruning.
- Forward-compatible WebSocket publication envelope parsing with timestamp and message ID metadata.

## [0.4.0] - 2026-08-30

### Added

- 消息重放（有界本地历史）：`replay: { maxPerTopic }` 选项 + `subscribe(topic, handler, { replay: true | n })`，晚加入的 handler 立即收到缓冲历史（`message.replayed: true` 标记）；仅缓冲已分发消息，内存环形队列，最后一位 handler 退订即清空；通配订阅跨匹配 topic 回放。
- 性能基准套件：`pnpm bench`（routing 纯函数 / cluster 协调 / 通配匹配共 8 项基线）。
- e2e：二进制发布按钮 × WebSocket 后端跨 Tab 往返。

### Changed

- 校验 `replay.maxPerTopic` 必须为正安全整数，并从根入口导出 `DataBusReplayOptions`。
- CJS 产物在无法解析模块相对 Worker URL 时抛出可操作的错误信息，并补充使用说明。

- BFCache e2e 在 `pageshow` 后等待 transport 恢复完成，避免把合法的异步恢复窗口误判为重复投递。

## [0.8.0] - 2026-08-31

### Added

- 0.8.0 development: optional `publish(topic, data, { messageId })` metadata now propagates through cluster routing and supported transports.
- Explicit `bus.clearReplay()` retention cleanup for in-memory and durable replay stores.
- Dedup suppression is observable through reliability trace events (`dedup_suppressed`).

## [0.7.0] - 2026-08-31

### Added

- Replay persistence lifecycle cleanup (`clear` / `clearTopic`) with stale-history removal on unsubscribe.
- Opt-in reliability diagnostics for recovery retries, owner acknowledgments, and route migrations.
- Bounded, opt-in publication deduplication with caller-supplied message IDs.
- React/Vue and custom-transport compatibility fixtures plus browser/package regression coverage.

### Implemented in the current 0.7.0 worktree

- Replay persistence now supports optional `clear()` and `clearTopic()` lifecycle hooks; `CrossTabDataBus` invokes them on stop and final topic unsubscribe.
- Trace exports bounded `reliability` events for transport recovery attempts, route acknowledgments, and graceful route migrations.
- `DataBusMessage.messageId` plus opt-in `dedup: { maxEntries, ttlMs }` suppresses duplicate inbound publications with bounded memory.

## [0.6.0] - 2026-08-31

### Changed

- `publish()` 在当前 Worker 已同步持有 topic owner assignment 时走本地快路径，避免每条消息重复扫描 worker/route storage；跨 Tab 路由仍保留原有存储校验。
- 新增独立 `./vue` 入口，提供 `useCrossTabDataBus`、`useCrossTabSubscription` 和 `useCrossTabStatus`；Vue 3 作为可选 peer dependency，不影响核心入口。
- WebSocketTransport 与内置 demo 支持 `ArrayBuffer` 二进制帧往返；JSON payload 协议保持兼容。

## [0.5.0] - 2026-08-31

### Added

- 真实浏览器发布基准入口：`pnpm bench:browser`，在本地 Centrifuge 演示服务上用两个真实标签页分别测 dedicated/shared Worker 的跨 Tab 发布耗时。
- 可选 replay 持久化契约与 IndexedDB 实现：`createIndexedDbReplayPersistence({ maxPerTopic })`；默认仍为纯内存，持久化失败通过错误处理器报告。
- E2E：新增真实 Chrome reload 场景，验证 IndexedDB replay 历史在页面重建后恢复（总计 8 项 E2E）。

### Notes

- 当前基准包含页面点击、JSON 序列化、Worker/Storage/BroadcastChannel、服务端回显和接收端渲染，结果用于端到端回归趋势，不等同于核心 `publish()` 微基准。
- 2026-08-31 本机 Chrome 100 条消息采样：dedicated 约 34.03 ms/条，shared 约 33.89 ms/条；两者接近，暂不据此改动 publish 路径，避免在缺少核心 profile 时引入陈旧路由缓存。

## [0.3.0] - 2026-08-29

### Added

- 双格式发布：新增 CJS 构建（`dist/cjs/*.cjs`），`exports` 增加 `require` 条件，CommonJS 消费者（`require()`、CJS bundler 配置）可直接使用；新增构建产物冒烟测试（`pnpm check` 先构建后测试）。
- 原生 WebSocket 传输后端：`WebSocketTransport` + `createWebSocketDataBus`（零依赖，极简 JSON 帧协议），验证 `DataBusTransport` 多后端抽象；含 9 个单元测试。
- Topic 通配符订阅：`chat.*` 后缀通配与 `*` 全匹配。pattern 以字面量参与路由/归属/传输订阅（服务器需支持 channel pattern 并以具体 topic 标注发布，或直接以 pattern 标注）；dispatch 侧新增通配匹配——owner 门（`isAssigned`）、本地订阅门（`hasLocalSubscriber`）与 handler 分发均按 pattern 匹配具体 topic。新增纯函数 `isWildcardTopic` / `topicMatchesPattern` 与 10 个相关测试。
- React hooks 适配层：独立入口 `cross-tab-worker-databus/hooks`，导出 `useCrossTabDataBus`（StrictMode 安全的 bus 生命周期）、`useCrossTabSubscription`（handler 经 ref 读取，内联闭包不重订阅）、`useCrossTabStatus`；React（>=18）为可选 peer 依赖；jsdom 渲染测试 3 个。
- 示例与演示服务器：demo 页新增「WebSocket」后端模式（连接内置 `/ws/demo` 演示服务器，支持 pattern 订阅与发布回显）；新增 `scripts/demo-ws-server.mjs` 与 12 个契约测试；新增 WebSocket 后端跨 Tab 收发 e2e（全套 6 个）。

### Changed

- `main` 字段指向 CJS 入口（`./dist/cjs/index.cjs`），`module`/`exports.import` 仍为 ESM；worker 入口保持 ESM module worker 不变。

## [0.2.1] - 2026-08-29

### Added

- 发布自动化：tag 触发的 GitHub Actions release workflow（typecheck + 单测 + build 门禁 → 从 CHANGELOG 抽取版本说明创建 GitHub Release → `npm publish --provenance`）。
- 测试基建：ESLint（typescript-eslint flat config，含 `lint` 脚本）、Vitest 覆盖率（`pnpm test:coverage`，阈值 statements 85 / branches 80 / functions 90 / lines 85）、`.editorconfig`。
- 51 个新单元测试（137 → 188）：`CentrifugeSession` 协议分支（UNSUBSCRIBE、server-side publication、错误序列化）、浏览器环境适配层（`createBrowserEnvironment`/`getOrCreateTabId`/`canUseStorage`）、trace 上限截断与 sink 异常隔离、cluster 健壮性（损坏 JSON、存储写失败、TTL 清理、handoff UNSUBSCRIBE 短路、路由抢占 reconcile）、routing/storage-batch/port-reaper 边界分支、`CentrifugeWorkerTransport` 边界路径。
- 1 个新 E2E：BFCache 往返（pagehide 交接 + pageshow 恢复后双向收发）。
- React 18 使用示例（`examples/react`，StrictMode 安全的 bus 生命周期）；示例服务器支持 `.jsx`。
- README（中英）FAQ 与 0.1 → 0.2 迁移说明。

### Changed

- 包导出加固：`./centrifuge.worker` / `./centrifuge.shared.worker` 补 `types` 条件（指向 `dist/workers/*.d.ts`）；新增 `sideEffects` 白名单保护 worker 产物不被 tree-shake；`prepublishOnly` 门禁（`pnpm check`）。
- tsconfig 追加严格开关：`noFallthroughCasesInSwitch`、`noImplicitOverride`、`allowUnreachableCode: false`（零代码改动通过）。
- 测试总覆盖率：语句 89.9% → 96.6%，分支 86.3% → 90.9%（environment 32.9% → 100%，centrifuge-session 77.8% → 100%）。

### Fixed

- 清理 18 处 ESLint 违规：未使用变量/导入、注释中的 U+202F 不规则空白。
- `scripts/serve-examples.mjs` 之前不识别 `.jsx` MIME 导致模块脚本被拒（随新示例修复）。

## [0.2.0] - 2026-08-27

### Changed

- `centrifuge` 从 `dependencies` 改为 optional `peerDependencies`：仅在使用内置 Centrifuge 后端时需要安装，核心包零运行时依赖。
- `CentrifugeSession.handle()` 由连续 `if` 改为 `switch` + `default`，未知消息类型静默忽略，为未来协议扩展留出兼容余地。
- `routing.ts` 的 workerId 平局处理由 `localeCompare` 改为数值比较，消除宿主 locale 对路由确定性的影响。
- `port-reaper.ts` 提取 `computeMinHeartbeat()` 方法，reap 迭代改用 `Array.from` 快照，reaper 节奏计算与计时器逻辑解耦。
- `centrifuge-protocol.ts` 新增 `DEFAULT_SESSION_TIMEOUT_MS` 派生常量，消除 `port-reaper` 中重复的字面量计算。
- `CentrifugeWorkerTransport` 提取 `buildInitInput()` 与 `postToPortLike()` helper，消除 `start()`/`post()` 中的重复构造逻辑。
- `cluster.ts` 提取 `readAllByPrefix()` helper，统一 `readWorkers`/`cleanupOrphanedRoutes`/`cleanupOrphanedSubscribers`/`getSnapshot` 的 listKeys+readJson 循环；删除无调用点的 `listKeysSafe`。
- `cluster.ts` 提取 `buildLocalRoute()`，将 `readRoute` 的无 storage 降级分支独立命名并补文档；`readSubscriberTabIds` 同类分支拆为多行可读形式。
- `cluster.ts` 提取 `sendRouteReleased()` helper，消除三处 `ROUTE_RELEASED` 消息构造的重复；`handoffAssignedTopics` 的 generation 计算复用单次求值；`reconcileAssignedTopics` 去除同一 topicKey 的二次 `readRoute` 调用。
- `cluster.ts` `releaseSubscription` 返回 topicKey，`unsubscribe` 复用而非重新哈希；`handleMessage`/`handleControlMessage`/`sendControl` 连续 `if` 改 `switch`；`getSnapshot` 的序列化改用 `Array.from`。
- `data-bus.ts` `onControl` 连续 `if` 改 `switch`；提取 `invokeHandlers()` 统一 dispatch/status/error 三处 handler 遍历的 try-catch 隔离；提取 `formatWorkerTrace`/`formatRouteTrace` 格式化函数。
- `trace.ts` 提取 `metricsActive` getter，统一四个 record/flush 方法的守卫表达式。
- `cluster.ts` 提取 `routeOwnerIsLive()` 与 `isActiveAmong()`，消除 subscribe/publish 和 isActiveWorker/refreshRole 中的重复 route+workers.some / selectActiveWorkers+some 模式。
- `cluster.ts` 提取 `isStaleRouteRelease()`，命名 handleRouteReleasedMessage 的守卫条件。
- `cluster.ts` `activate()` 合并两个分支的 rememberTopic 调用为单循环；`handoffAssignedTopics` 去掉同一 topicKey 的二次 readRoute。
- `cluster.ts` `readSubscriberTabIds` 改用 `readAllByPrefix` + `Array.from`；`getSnapshot` 序列化改用 `Array.from` + mapping callback。
- `data-bus.ts` 提取 `formatWorkerTrace`/`formatRouteTrace` 格式化函数；`invokeHandlers` 的 label 参数改为联合类型字面量而非自由字符串。
- 多处 JSDoc/注释补全：writeRecord notify 参数、activate channel 判空、reconcileWorkers cleanup 顺序、rememberTopic eviction break、suspendTransport pendingStop 守卫、reopenTransport startPromise 检查、trace flushNow 条件、storage-batch flush break / scheduleFlush 降级 / scheduleRetry、port-reaper 各方法守卫、centrifuge assertHeartbeatInterval/assertStructuredCloneable/deserializeWorkerError、environment canUseStorage。

### Documentation (JSDoc 全覆盖)

- `hash.ts` 提取 seed/prime/avalanche 常量与 `avalancheMix()` 函数，补非 ASCII 字符处理注释。
- `types.ts` 全部类型（WorkerRecord/WorkerRoute/WorkerClusterMessage/DataBusTransport/DataBusMessage/handler 别名）字段级 JSDoc 补全。
- `centrifuge-protocol.ts` 全部协议变体（WorkerUnsafeOption/CentrifugeWorkerConfig/CentrifugeWorkerInput 各变体/CentrifugeWorkerOutput 各变体/SerializedWorkerError）JSDoc 补全。
- `worker-mode.ts` WorkerMode/WorkerBackend/WorkerAvailability/selectWorkerBackend JSDoc 补全。
- `routing.ts` DEFAULT_MAX_ACTIVE_WORKERS/selectLeastLoadedWorker JSDoc 增强。
- `storage-batch.ts` INITIAL/MAX_RETRY 常量 + BatchingStorageWriter 类 + pendingSize getter JSDoc 补全。
- `trace.ts` normalizeInterval/roundMs JSDoc 补全。
- `environment.ts` ClusterEnvironment 各字段 + canUseStorage JSDoc 补全。
- `cluster.ts` readJson/writeJson/WorkerClusterOptions 各字段 JSDoc 补全。
- `data-bus.ts` PUBLICATION_EVENT/getStatus/getClusterSnapshot/CrossTabDataBusOptions JSDoc 补全。
- `centrifuge.ts` handleOutput/onWorkerFailed JSDoc 补全。

### Documentation

- 架构运行时图（中英）补全 `BatchingStorageWriter`、`PortReaper`、`CentrifugeSession`、`CentrifugeWorkerTransport` 节点，与代码结构对齐。
- `AGENTS.md` 目录注释明确列出每个测试文件职责。
- `README`（中英）补充 `centrifuge` 为可选 peer 依赖的安装说明。
- `trace.ts`、`environment.ts` 补充 JSDoc：trace 模式与选项字段含义、SSR 场景的 storage/ BroadcastChannel 检测说明。

## [0.1.2] - 2026-08-24

### Fixed

- `BatchingStorageWriter` 在结构性写失败（如某 key 让底层 storage 持续抛错）时不再无限重试：每个 key 最多重试 5 次后丢弃并 `console.warn`，避免协调平面永久卡住。
- `PortReaper.setTimeout` 校验 `heartbeatIntervalMs` 为有限正数，`0`/`NaN`/负数回退默认值，防止 reaper 退化为忙循环或沉睡。
- `CentrifugeSession.unsubscribe` 先移除 subscription 监听器再退订，避免迟到的 `unsubscribed` 事件删除重订阅后的 subscription（幽灵订阅竞态）。
- `rememberTopic` FIFO 淘汰改为向前扫描首个非 own 条目，`knownTopics` 在有非 own 条目时真正不超 `MAX_KNOWN_TOPICS` 上限。
- `DataBusTraceReporter.pause()` 清零 `intervalStartedAt`，避免 stop 后手动 flush 算出异常大的 `durationMs`。

### Documentation

- 架构文档（中英）补充 transport 层 client 级与 subscription 级 publication 去重说明。
- 配置文档（中英）补充 SharedWorker reaper 的失败隔离与关闭清理行为。

## [0.1.1] - 2026-08-24

### Fixed

- 防止 centrifuge 客户端级 `publication` 与 subscription 级监听重复派发同一消息：client 级现在跳过已有 subscription 的 topic，仅处理 server-side subscription 的 publication。
- `PortReaper.dispose()` 关闭并停止所有追踪中的 session，避免 SharedWorker 关闭时遗留 WebSocket 连接。
- `PortReaper.reap()` 对 `target.close()`/`target.stop()` 加 try-catch，单个异常 port 不再瘫痪后续死 tab 的回收。

## [0.1.0] - 2026-08-24

首次公开发布。

### Added

- 框架无关的跨标签页发布/订阅数据总线，通过 BroadcastChannel 在同源标签页间分发消息
- Dedicated Worker / Shared Worker / 本地线程三档 transport 后端，`auto` 模式自动降级
- 基于 localStorage + BroadcastChannel 的 Worker 集群协调：粘性 Topic owner 路由、新 Topic 负载均衡、owner 崩溃 failover、`pagehide` 优雅交接
- 内置 Centrifuge WebSocket transport，连接、订阅、token 刷新、二进制数据均在 Worker 内处理，不阻塞主线程
- ArrayBuffer Transferable 支持，零拷贝传输二进制 publication
- 本地 handler 引用计数与订阅排队：连接期间订阅不丢失，去重 transport subscribe 调用
- 可选结构化 trace：生命周期、连接状态、协调快照、订阅事件，以及分桶延迟直方图（P50/P95/Max）与吞吐聚合指标
- localStorage 写入合并与指数退避重试，协调元数据写入移出热路径
- 连接 URL 与 Topic 通过 128 位非加密哈希转为不透明 key，明文不落入 localStorage 键名
- SharedWorker 端口回收器：主线程 PING 心跳 + 静默超时回收，崩溃 Tab 未发 STOP 也不泄漏 session
- 优雅降级：localStorage/BroadcastChannel 不可用时退化为本地单 Tab 模式

### Documentation

- 英文与中文文档：架构、API 参考、配置、快速上手、能力矩阵
- 多标签页浏览器演示页，可视化数据流、延迟指标与集群路由状态
