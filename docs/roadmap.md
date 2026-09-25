# Roadmap

0.21.35 was released on September 25, 2026. The project is intentionally continuing through reliability-focused releases before a 1.0.0 stability freeze.

## 0.21.35 delivered scope

- **A citation to a test is now checked against the suite.** `tests/documentation.test.ts` gained "resolve to a case that exists in the file they name": every `tests/<file>`'s `<name>` in `src/**`, `AGENTS.md`, `README.md` and the public docs must match exactly one `it()`/`test()` title in the file it names (17 citations across 52 files today; a trailing `…` may prefix-match, against one hit). Both halves of the scan are controlled, because both can go empty and an empty failure list looks like a clean bill either way — the title collector must find the suite's cases (976 across 40 files, floored at 500 rather than at the corpus size), the citation pattern must examine at least one, and the `e2e` corpus is asserted on its own since 936 of those 976 come from `tests/` and the total could not notice it going empty. Two scope decisions are measured: `docs/` holds 8 of these citations and the only 4 unresolved in the tree are all in `docs/progress.md`, exempt for the reason a release note is; and the looser `filename … ('a name')` window was tried and rejected — across the whole scope it yields exactly one candidate, and that candidate is the `new Error(…)` message inside the very function whose doc comment names the test. Five mutants, each with its own named failure; one earlier mutant was discarded for not compiling (a dropped backslash made the regex unterminated, which reports as a suite collection error rather than as a killed behavior). The gate reddened the `AGENTS.md` bullet written about it, because the first draft quoted the two defective tokens in citation form — so the rule now says to name a token bare when the sentence is about a defect.
- **Two shipped comments named a fixture instead of a case, and both are published.** `src/core/routing.ts` cited `sticky-existing-routes` and `src/core/trace.ts` cited `no-trace`; neither is an `it()` title, both are `clusterKey` literals written inside a test body, so each pointer landed mid-case and the first rename of either arbitrary string would have pointed nowhere — with nothing in the build, the type check or the suite to contradict it, which is the same silence as a drifted `:NNN`. Both sit in declaration JSDoc, so the corrected text reaches consumers: after the build the case titles are in `dist/core/routing.d.ts` and `dist/core/trace.d.ts` and the fixture strings are not. `AGENTS.md` gained the decay rule for this citation class beside the one for line numbers.
- **The last copy of the `knownTopics` cap absolute is retired.** `AGENTS.md`, the surface that steers every future session, still read "max 500 entries" and "never evicts a key the worker still owns" two releases after `src/` and both architecture languages were corrected. It now carries the measured rule: the 500 bound covers entries this worker does not own, the scan skips two candidates (an owned key, and the key being remembered — a fresh `Map.set` lands at the back, so the front-scan reaches it only when everything older is owned), and in that state the cap slips. 1,200 adopted peer `CONTROL/SUBSCRIBE` frames grew `knownTopics` and `assignedTopics` to 1,200 together and one reconcile tick returned both to `0`, so for a flood the bound is the sweep. Both skips keep their own named case.
- **The publication samples are eight gaps and nine durations, and the ceiling's derivation is unchanged.** `0.21.34`: `Publish to npm` completed `02:46:35Z`, the registry recorded the version at `02:47:50.782Z` (**75.8 s**), and `Verify published npm consumers` took **304 s**. The three newest record lags — 76.1, 75.5, 75.8 s — span half a second across three consecutive releases while the step still consumes ~304 s each time, which puts the variance in the reader's blindness rather than in the registry's write; that reading is now in all four copies beside the `gh api` lookup that re-derives it. 75.8 s does not beat the 310 s that sizes the 720 s budget, so `maxMeasuredAckToRecordMs` stays put and the floor passes unmodified.
- **What did not move.** No library code, export, option, default, frame or storage key changed; `verify:compat`, `verify:types` and `verify:pack` run against `v0.21.34`, and the arm ledger and coverage aggregates are `0.21.34`'s. The suite is 37 files / 951 tests. `docs/benchmarks.md` and its zh mirror were re-generated and came back byte-identical (91 archived reports), so the generated tables and the committed copies have not drifted — the archive itself is untracked, which is why that check is a run rather than a gate. A sweep of every `name()` token in the living docs (955 of them) found no fabricated symbol: the 3 that resolve nowhere are one `e2e/` helper and two Playwright methods. Dependency patrol: no known vulnerabilities against `registry.npmjs.org`, and `typescript@7.0.2` stays blocked upstream because `typescript-eslint@8.70.1` declares `>=4.8.4 <6.1.0`. The completeness gate now reports 48 gated releases rather than 47, because `0.21.34` joined the set it audits.

## 0.21.34 delivered scope

- **A tag can now be refused because the release record names a version npm never had.** `scripts/verify-release-version.mjs` reads the packument's `time` map beside the checks it already made and fails when a CHANGELOG section at or above `firstGatedRelease = 0.20.85` has no registry record. The in-flight release is exempt, a duplicated section reports once, and a failed registry read warns and skips rather than turning a good release red — the deliberate half of the design. The floor comes from a count, not taste: 40 of the 164 sections name unpublished versions (`0.9.0`, each minor's first patch from `0.12.0` to `0.18.0`, all ten `0.19.x`, `0.20.0`–`0.20.5`, `0.20.54`, `0.20.55`, `0.20.69`, `0.20.72`–`0.20.84`; 1 + 7 + 10 + 6 + 2 + 1 + 13 = 40) — 41 counting the release in flight, which is why the gate exempts it — and every one sits below it, while the 47 sections from `0.20.85` through `0.21.33` are all present (that count is this tag's own reading — it rises by one with every release, and the script prints it). Four mutants, four named tests, one failure each.
- **One eviction skip had no test that could see it.** `rememberTopic()` skips owned keys *and* the key being remembered; deleting the second term left all 944 tests green. It is reachable only when every older entry is owned, because a fresh `Map.set` lands at the back of the insertion-ordered Map and that is the one case where the front-scan reaches it — and there the mutant throws away the mapping the call exists to install. The new case stages 500 adopted peer SUBSCRIBE frames plus one PUBLISH and fails at `expected [ 'owned.0', …(498) ] to include 'evict.extra'`; the owned term keeps its own pre-existing case, so both skips are individually attributed. Two earlier designs are recorded in the test's comment because both were plausible and neither reached the leg: an inbound SUBSCRIBE cannot produce an unowned entry, and re-remembering a key already present cannot overflow the cap.
- **Three shipped sentences about caps described protections the code does not provide.** `MAX_KNOWN_TOPICS = 500` was documented as stopping a malicious peer from exhausting memory through control messages; measured, 1,200 peer `CONTROL/SUBSCRIBE` frames grew `knownTopics` and `assignedTopics` to 1,200, because each frame is adopted, adoption makes its key owned, and the loop then refuses to drop anything — one reconcile tick took both back to `0`, so the flood's bound is the sweep and the cap's bound is over unowned entries. `trace.ts` credited both of its caps with guarding "a single misbehaving topic", when `MAX_PENDING_TOPICS` is an admission gate over *distinct* topics (1,001 topics → 1,000 queues, while an admitted topic still grows to 256) and the `topics` Set carries neither cap by design, bounded by the window flush. And the identifier table in the same architecture doc still restated the eviction rule in its pre-correction form while the row beside it omitted `reconcileAssignedTopics`, the only path that ends a flood. All of it is fixed in both languages, and the `src/` comments now point at the loop and at the tests rather than restating the rule twice.
- **A candidate test that duplicates an existing one is deleted, not kept.** The trace caps looked unpinned because the grep used the constants' names, and the two cases that do pin them write the numbers in a comment and never mention the identifiers. Both new cases were written, then the mutation run reported that deleting the admission guard failed **two** tests — the new one and `caps the number of topics tracked for pending receives`, which uses more inputs than the new one did. They were removed; the comment cites the existing names. The release therefore adds one test (the eviction pin) and removes none.
- **The publication samples are seven gaps and eight durations, and the ceiling's derivation is unchanged.** `0.21.33`: ack `00:31:20Z`, registry record `00:32:35.519Z` (**75.5 s**), verify step **304 s** — the eighth green sample in the 304–308 s band and one 300 s lifetime plus command time from that runner's own first fetch. 75.5 s does not beat the 310 s that sizes the 720 s budget, so `maxMeasuredAckToRecordMs` stays put and `tests/workflows.test.ts` passes unmodified.
- **What did not move.** No library code, export, option, default, frame or storage key changed; `verify:compat`, `verify:types` and `verify:pack` run against `v0.21.33`, and the arm ledger and coverage aggregates are `0.21.33`'s. The suite is 37 files / 950 tests. The only new blocking behavior is inside the release workflow's own version gate, which skips itself when the registry read fails.

## 0.21.33 delivered scope

- **A measurement cited as evidence against a model turned out to join two machines.** The publish-lag prose argued that a purely-local npm cache account was refuted because "the retry resolved before a fresh 21:44 fetch's 300 s lifetime had run out". Against the run records, the fresh read was a laptop's `npm pack` at 21:44:35Z and the 1 s green was a **new runner job** at 21:47:10Z — and a new job's cache starts empty, which is what the local model predicts rather than what refutes it. The claim is withdrawn, and what a local account still cannot explain is stated as the single reading it is: the runner's own `ETARGET` at 21:45:07Z, 364 s after its poll loop opened at 21:39:03Z and ~60 s after a copy taken then must have expired. The verdict stays *not established*.
- **`0.21.32` supplied the model's cleanest sample while this was being written.** Ack 23:34:46Z, registry record 23:36:02.091Z (**76.1 s**), a laptop reading the new `latest` at 151 s with `no-cache`, and the runner's blocking step finishing at **304 s** — one lifetime plus command time, measured from its own first fetch. The verify-duration band is now seven green samples at 304–308 s; both sample lists were extended in both languages, in the workflow comment and in the test that enforces the floor.
- **Three of those numbers named the wrong quantity, and all three went before the tag.** "the second-smallest of the **seven** now listed" had borrowed the duration list's size for the gap list, which carries six values (the seven is 307 / 304 / 305 / 304 / 304 / 308 / 304 s of *step duration*), and the sentence's own parenthesis already enumerated six. Three copies described 0.21.30 as spending "its whole **364 s** budget", but that run's ceiling was 360 s (48 × 7.5 s) and 364 s is only the span from its first poll to its last `ETARGET` — a budget and a reading written as one number. And `docs/progress.md` still carried the superseded first draft of that span, "about 5 min 40 s after the fetch that should have gone stale by 21:44:05Z", matching neither the 364 s span nor the ~60 s past expiry every other copy states. Checking the first of those meant sampling the two releases below the gap list's stated range for the first time: 0.21.25 is **157.8 s** (ack 17:56:53Z, record 17:59:30.781Z) and 0.21.26 **96.1 s** (ack 18:41:40Z, record 18:43:16.084Z) — and their verify steps come back at 307 s and 304 s, exactly the two values the duration list already carries, so the run↔version attribution is confirmed by a number already on file rather than by the new ones. Eight gaps now exist, none beats 310.0 s, and the two new readings are recorded here and in `CHANGELOG.md` rather than added to every restatement of the list, because a fifth copy of a set of numbers is a fifth thing to keep in sync.
- **What did *not* change, and the check that proves it.** 76.1 s does not beat the 310 s that sizes the 720 s ceiling, so `maxMeasuredAckToRecordMs` stays at 310 s and `tests/workflows.test.ts` passes 6/6 unmodified — widening the sample list without moving the derivation is the result this release was looking for, not a reason to raise the budget again.
- **History corrected by pointer, not by rewrite.** `CHANGELOG.md`'s `0.21.31` entry and both `docs/roadmap.md` copies still carry the sentence they got wrong, each with a note naming `0.21.33` as what superseded it, so the record reads as the sequence it actually was. `AGENTS.md` gained the general rule beside the one it already had: before citing an observation against a model, check both halves came from the same machine and the same path.
- **What did not move.** No library code, export, option, default, frame or storage key changed; `verify:compat`, `verify:types` and `verify:pack` run against `v0.21.32`, and the arm ledger and coverage aggregates are `0.21.32`'s (46 zero-count arms of 1951; 99.02 / 97.64 / 99.27 / 99.69).

## 0.21.32 delivered scope

- **A publication could be lost on the first send, and only on the first.** `publish()` and `publishBatch()` each held a fast path that scanned the local wildcard patterns when a topic had no `wildcardPublishCache` entry yet and, on a match, addressed the control frame to this worker without consulting the durable route; every *later* publication for that topic did consult it. Measured with one runtime holding `chat.*` and a peer concretely owning `chat.room.1` — both `isAssigned`, the route naming the peer — three publications from the wildcard holder landed `1,0,0` on the sender and `0,1,1` on the owner, and delivery is at-most-once. The same reproduced for a two-item batch, whose frame the receiver unpacks per item.
- **Why the fix is a deletion rather than a bound.** This is `0.20.58` from the other side: there a cached `null` short-circuited the owner lookup, here a cache *miss* did. Neither stored value decided anything — `pattern` and `null` were both read only as "have I scanned this topic" — so no eviction rule could have both bounded the map and fixed the ordering. `resolvePublishTarget()` now answers for every non-owned publication, and wildcard ownership still holds where there is no live concrete route, because that call returns this worker and the receiving gate matches the pattern. As a side effect this closes the unbounded-growth item recorded in 0.21.31: the map is gone, so the eviction rule it was framed as needing has nothing left to evict.
- **Pinned one publication at a time, and the pre-existing pair relabelled.** The two new regressions (one per entry point) each assert on a single publication, so a regression names *which* send was lost rather than reporting a count short by one; without the fix they fail at `expected +0 to be 1` and `expected [] to deeply equal [1, 2]`. Three older cases that named the removed cache in their titles now say what they assert, and the single-runtime pair among them is marked characterization — a lone runtime always wins its own election, so it cannot tell the two paths apart.
- **The release-gate prose caught up with its own samples.** 0.21.31 was the first tag run under the raised 720 s published-consumer ceiling: green on attempt 1 at 308 s, registry record 127.2 s after the ack and ~181 s more against the cache lifetime, which leaves the 310 s maximum the ceiling is sized from unbeaten. Correcting that also exposed an undercount of the same regularity — the checklist and `AGENTS.md` said "three consecutive green tag runs at 304–305 s" where the five runs from 0.21.25 to 0.21.29 took 307, 304, 305, 304 and 304 s, so six samples sit in a 5-second band. Both the lag list and the per-run durations are now written out with the lookup that re-derives them, in both languages, in the workflow comment and in the test that enforces the floor. `trace.ts`'s flush-guard note likewise gained the file each kill comes from, after all four operand deletions were re-run on this tree (3 / 2 / 1 / 1, every restore byte-identical).
- **What did move, and what did not.** This is the first change to library *behaviour* since `0.21.25` — 0.21.26 through 0.21.31 touched `src/` only in comments — and `src/core/cluster.ts` lost a field and two fast paths. The public surface is unchanged: `verify:compat`, `verify:types` and `verify:pack` against `v0.21.31`, and the removed `wildcardPublishCache` was a private field absent from the emitted declarations.

## 0.21.31 delivered scope

- **The release gate that failed on a good publish, sized by measurement instead of by feel.** `0.21.30`'s tag run consumed the whole 48 × 7.5 s published-consumer budget on `ETARGET` and then passed in 1 s when the same tag was re-run. The ceiling turns out to be a sum of two lags, both now measured: `npm publish`'s ack precedes the registry's own `time[<version>]` record by 74.8 s (0.21.29), 96.8 s (0.21.28), 248.7 s (0.21.27) and 310.0 s (0.21.30), and the packument `npm pack` resolves against is served `cache-control: public, max-age=300`, so a copy of it anywhere in the path may be a full cache lifetime stale by design. That second term is also what the three preceding green runs had been reporting with their suspiciously identical 305 / 304 / 304 s — a regularity that reads as noise until something explains it. The budget is now 96 × 7.5 s = 720 s, clearing 610 s. Which copy served the stale views is deliberately left open: a purely npm-local-cache account predicts the retry should have waited for the same 300 s object and it did not. *(Superseded by `0.21.33`: that inference joined a laptop's `npm pack` read with a new runner job's 1 s green, i.e. two machines, and a new job starting with an empty cache is what the local account predicts. Its surviving anomaly is one reading — the runner's `ETARGET` ~60 s after its own copy must have expired — and 0.21.32's 304 s verify is the model's cleanest sample, with the band now seven releases wide at 304–308 s.)*
- **A floor that blessed the value which had just failed.** `tests/workflows.test.ts` asserted `totalMs >= 5 * 60 * 1000`, so the 360 s budget that had just turned a good release red satisfied the gate whose only job is to prevent that, and a further lowering would have gone unnoticed. The floor is now the two terms above, as named constants beside the rule for re-deriving each. Mutation-checked in both directions: reverting the workflow to 48 fails exactly that test with a message naming both lags, and the same floor rejects the 360 s budget that failed here and the 120 s one 0.20.89 exhausted.
- **A note about that failure, retracted against its own timestamps.** The checklist paragraph written during the same release said the package document endpoint and the tarball URL had disagreed "in the same minute". The readings it quotes put the stale-document read at 21:43:15Z and the registry's record of the version at 21:44:12.987Z — so that read was not lagging an artifact that already existed; it was correctly reporting a publish the registry had not finished writing, and no `no-cache` request could have helped. The genuine disagreement is one machine fetching the tarball by 21:44:35Z while the runner was still on `ETARGET` at 21:45:07Z, which is why the text now says to probe from the machine that is failing, and why absence from `versions`/`latest` minutes after a green publish step is documented as the *expected* state of a successful release.
- **`wildcardPublishCache`: the per-topic map the documented cap does not cover, and why a cap is not free.** It maps a concrete topic to the local wildcard pattern that matched it, or `null` for "scanned, nothing matched"; it has no bound, and is cleared only by the two lifecycle teardowns beside each `routeOwnerCache.clear()`. Measured: 1,200 `publish()` calls on distinct topic names leave `knownTopics` at its 500-entry cap and this map holding 1,200. The cost of evicting either half is asymmetric — dropping a *pattern* re-runs the first local dispatch the entry exists to prevent, dropping a `null` re-scans and, if a wildcard was assigned in between, hands that publication the fan-out a first one gets — so the note records that bounding it needs a rule about which half may be forgotten rather than a number, and `docs/architecture.md` says the same in the paragraph after "Cap and eviction".
- **Kill sets named by test instead of counted.** `trace.ts`'s flush-activity note carried "(three cases for `received`, two for `dispatched`)"; five verbatim test names replace those multiplicities, and one of them records what the count hid — `dispatched`'s two cases sit in two different files.
- **What did not move.** No library code changed. `verify:compat`, `verify:types` and `verify:pack` report the public surface closed against `v0.21.30`, and the arm ledger and the four coverage percentages are 0.21.30's. The behavioural changes are `.github/workflows/release.yml`, `tests/workflows.test.ts` and `tests/version-compat.test.ts` (a per-file timeout, whose binding was proven by driving it to `1` ms and watching 17 of its 18 cases fail), none of which ships inside the package.

## 0.21.30 delivered scope

- **Two shipped absolutes that the code contradicts.** `touchRouteOwnerCache()`'s eviction loop was justified by "the cache is at least one entry over the cap here, so the iterator always yields a key to drop" — measured at `routeOwnerCacheMax: 2` with two remote owners, filling to the cap and re-resolving either owner leaves `size` at 2 and the loop breaks without deleting, because a call adds at most one *net* entry and exceeds the cap only when a new key arrives while the cache already sits at it; the inequality was backwards for every re-touch and every fill below the cap. And six comments said a deletion left "all 37 test files green" — a count that carries nothing the sentence lacks, and goes false on the commit that adds a file rather than on any change to the code described, so all six now say "the whole suite green".
- **Two differential vectors that could not be rebuilt from the sentence beside them.** `validation.ts` quoted "a 23-value vector (numeric strings, booleans, `±Infinity`, …)" — plural categories, no multiplicities, so a reader cannot count 23 or tell it from 21. Rebuilt as an explicit 25 inputs *including `3000`*, because a differential where nothing is accepted proves nothing; each guard as written and with only its `typeof` operand deleted answered identically on all 25, same accept/reject and same message. `environment.ts`'s envelope guard got the same treatment and a surprise worth naming: 26 writes but **23 distinct documents**, because `1e999` is `Infinity` and `JSON.stringify` emits it as `null`, so three rows store the same bytes as their `null` twins — which is also why no non-finite `seq` can reach the `typeof` test, the fact that row exists to check.
- **The reopen absorb's four legs, re-run — and the forcing had to be rebuilt first.** The `51 tests fail` leg had carried that number since its file held 194 tests; at 198 the same 51 came back, and the other three legs reproduce green. The first construction replaced `pending` with a fresh promise, and both of the legs that must be green then failed three tests each (the queued-behind-a-pending-stop case, the repeated hide/show case, the async-stop recovery case) — those assert on *which* promise a reopen waits for, not on whether it rejects. A broken mutant in a control leg reads as a finding rather than as a broken instrument; appending the link to the real `startPromise ?? pendingStop` is the only faithful forcing, and the note now says so.
- **The reopen gate's four operands survive deletion — and so does `tsc`.** Each single-operand deletion at `runTransport()`'s reopen gate left the whole suite green, as the note claimed. Newly measured: every one of the four also typechecks clean, which separates this guard from the `?? fallback` legs elsewhere in the file that only the compiler holds. Neither gate stands between those deletions and a merge; only the callee argument does, and the comment now says which.
- **A release gate that could pass while verifying the wrong artifact.** `verify-published-consumer.mjs` inferred its target from `npm view <pkg> version` when `PUBLISHED_VERSION` was unset, and that read comes from npm's local packument cache when the cache has something to give: minutes after a publish it returned the superseded version twice while `versions dist-tags --json` on the same registry reported the new one. The gate would download and import the previous artifact and exit 0, its only witness the version in the line it prints. An inferred version is now trusted only when it agrees with `package.json`, and an empty read is refused rather than becoming `pkg@`, which npm resolves as `latest`. The `Release` workflow never took that path — it passes the tag — so the exposure was on the manual repeat the checklist prescribes. Five tests, all mutation-checked (the four legs die at two, one, one and two tests respectively), with the script's body now behind the same `main()`/`invokedDirectly` gate its sibling uses.
- **What did not move.** No library code changed: `verify:compat` and `verify:types` report the surface closed against `v0.21.29` (6 entries, 90 importable names), and the ledger is still **46 zero-count arms of 1963** at 99.02 / 97.65 / 99.27 / 99.69. The suite grew to 941 tests across the same 37 files — the five new ones went into an existing file deliberately, since adding a file is what makes a count like "37 test files" false in the six comments just retired.

## 0.21.29 delivered scope

- **The claim queue itself was the work: every quoted measurement re-run, one mutant at a time.** Every "measured: deleting X leaves the suite green" and "dies to N tests" sentence in `src/` is a result from some past tree, so this pass took them one at a time against the current suite, restoring and byte-checking between each. Most held exactly — `port-reaper`'s `touch()` guard and its non-null fallback, `centrifuge-session`'s empty-topic drop, `cluster`'s unconditional `clearInterval`, both dominated terms of the `stop()` entry guard, `websocket`'s `handshakeCompleted` term, `centrifuge`'s double-arm guard (with its caller enumeration: `startHeartbeat()` only from `startSharedWorker()`, `clearHeartbeat()` only from `stop()` and `onWorkerFailed()`), and `trace`'s `metricsActive` term, which still fails precisely its two named tests while `stopped` is read in exactly the two places its comment says. Four did not.
- **The `tsc`-held legs came back with the numbers they quoted.** `cluster`'s nil-owner guard: suite green, and five type errors landing on the three expressions the note names. The three election `?? this.currentRecord` fallbacks: **3, 2 and 7** errors respectively, as written, with the whole suite green when all three arms go at once. The `projectedLoads` pair: one error each, in the two forms the comment describes. These are the legs where the compiler, not a test, is the only check that exists — which is exactly why their counts were worth re-taking.
- **A four/five mismatch, an off-by-one, and a citation that matched no installed file.** The IndexedDB settlement note said "all four latches"; there are four latch variables but **five** guarded closures, because `load()`'s `oncomplete` shares its latch with its own `fail` — so the deletion it measures is a five-statement edit (re-run that way: green, connection count unchanged). `CentrifugeSession`'s "four statements later" names three and the code has three. And its citations to the SDK's `build/index.js:762` / `:162` were checked against the store: the no-op `error` listener is at 763-764 in the pinned 5.7.4 and at 748 in 5.7.0, so the number matched nothing and how it got there is unrecoverable. Both are now the dependency's own quoted comment text, which is searchable and does not rot on a reflow — a rule that also had to be applied to `AGENTS.md`, whose own copy of that citation was equally stale.
- **The rotted file count and the host-specific timing.** `queueStartAfterStop()`'s note quoted "194/194 green"; the file is at 198 now, and re-running the mutation reproduced both halves — green in full, and the lifecycle fuzz dying with `Ineffective mark-compacts near heap limit`. The crash landed at 26.8 s of worker life here against the recorded ~40 s, so the sentence now says the timing is host-dependent and the crash is the load-bearing half — and the same two numbers were standing in two other places, the test file's own header note and the `AGENTS.md` bullet that cites this case as guidance, both corrected in the same pass. The neighbouring four-way absorb measurement's three `194/194` mentions became "green in full", with the one failing leg keeping its count plus the file size it was taken against, since that leg has not been re-run.
- **What did not move.** No code changed: `git diff -U0 -- src/` with comment lines filtered returns nothing across the five files, the suite is at 936 tests with 5/5 perf gates, and the ledger is still 46 zero-count arms of 1963 at 99.02 / 97.65 / 99.27 / 99.69 with the same per-file distribution as `0.21.28`.

## 0.21.28 delivered scope

- **"The only handler this opening ever gets" was not the only handler.** `reopenTransport()`'s early-return arm carried a `.catch(() => undefined)` justified by a claim that nothing else handles the promise. Five sites call the method, and three of them (`startDemandRecovery()`, `updateStatus()`'s recovery-timer arm, `runTransport()`) chain their own `opening.then(f, g)` onto that same object — so `g` is already a handler of `opening` by Promise semantics, and this absorb decides nothing on those paths. `start()` returns it to its caller. Only `resumeTransport()`'s `void` call needs it, and the note now names that caller rather than claiming exclusivity. It also records the symmetric measurement: deleting either absorb leaves all 37 test files green with zero unhandled-rejection reports, so what separates the two lines is the caller list — an enumeration, not a pin.
- **A clock sentence that was wrong twice over.** `ClusterEnvironment.now` said "the injected clock is the only monotonic one in the picture". The picture has no monotonic clock — the browser adapter binds the field straight to `Date.now`, and `performance.now()`/`hrtime` are read nowhere in `src/` — and the injected clocks are not monotonic either: a census of every clock the tests supply found one that steps backwards deliberately (`tests/trace.test.ts`'s backwards-dispatch case). The replacement states what is actually load-bearing, which is the consumers: `cluster.ts` is the field's only reader in `src/`, seven of its ten reads only stamp a record, and the three that subtract each fail their comparison on a backwards jump, so a record stamped before one survives until the clock climbs back past its stamp.
- **Census rows nobody could decode, and a kill count that had rotted.** The `runTransport()` guard quoted rows `1000`/`0000`/`0100`/`1001`/`1010` without ever saying the four bits are its four premises in source order. The encoding is now stated, the row set was re-derived with a first-sight log over one whole-suite run (identical five rows), and the `1001` origin is named as the stack it is: `handoffAssignedTopics()` → `onControl` → `unsubscribeTransport()`. Re-running the operand mutants found `droppedAfterConnect` still dying to exactly its two named tests, but `transportReady` killing **nine** where the note said eight — and the eight were never named, so the newcomer is unidentifiable. Both numbers are now written as "run the mutant".
- **A teardown note that said a port is a chance.** `ReapTarget`'s "a port that is about to be closed is the only chance its owner gets to learn why" was a broken compression of `reap()`'s measured reasoning; it now names the three steps, their order, and what the shared `try`/`catch` costs a target that throws in `notify`.
- **What did not move.** No code changed: the comment-filtered diff of `src/` returns nothing, the suite is at 936 tests with 5/5 perf gates, and the branch-arm ledger is still 46 zero-count arms of 1963 (99.02 / 97.65 / 99.27 / 99.69) with the same per-file distribution as `0.21.27` — which is the control that makes "comment-only" a measurement rather than a description.

## 0.21.27 delivered scope

- **A reason that was wrong about code that was right.** `reconcile()` opens with `if (!this.started) return;`, and its note explained the REGISTRY leg as closed because nothing between `pause()` clearing `started` and `pause()` removing the message listener "can hand the stack to consumer code". One of the three statements in that span is `environment.clearInterval(…)` — adapter code, which this file's own `activate()` comment treats as consumer-supplied and untrustable. The guard is therefore not redundant decoration behind an impossible window: it is the thing that closes it. The comment now argues for the guard instead of accidentally arguing against it.
- **A covered arm whose provenance was an argument, now a measurement.** `pause()`'s null-`heartbeatHandle` branch is taken only from the activation window — that is what its comment claimed and what no counter shows, since the arm is covered either way. Instrumenting the branch and running the suite printed exactly two lines and no third: one origin inside the adapter's `createChannel`, one inside the storage-less self-SUBSCRIBE's `handlers.onControl`, which is one per seam and matches the two tests by name. Both names are quoted at the site so a third origin is visible as a difference rather than as a re-derivation.
- **A number that had rotted without contradicting anything.** The `reopenTransport()` note said its two guard legs had never fired "0 of 5041 calls in the coverage run", a figure written in `b0354e4`. Re-running the same lookup gave 5046. The count only ever supported the claim *hot method, cold arms*, so the sentence now points at the lookup (`coverage/coverage-final.json`'s function count) instead of preserving a stale constant that reads like evidence. `AGENTS.md` carries the general rule.
- **What did not move.** No code changed: `git diff -U0 src/` with the comment lines filtered returns nothing, the suite is at 936 tests with 5/5 perf gates, the branch-arm ledger is still 46 zero-count arms of 1963 (99.02 / 97.65 / 99.27 / 99.69), and no consumer-facing doc needed a rewrite because every corrected sentence is about an internal method.

## 0.21.26 delivered scope

- **Who cancels a persistence retry, and who does not.** Four comments in `replay-manager.ts` said the cancellation generation was bumped "on suspend/stop". The class defines both methods and only `suspend()` writes the field; `stop()` clears the retention-sweep timer and supersedes nothing. The true half — a hidden tab and a stopped bus *do* both cancel their queued durable appends — belongs to the DataBus, which reaches `ReplayManager.suspend()` from the cluster's `onSuspend` handler and from `beginStop()`. That mismatch is also why nothing ever contradicted the sentence: the test covering the behavior is a bus-level one.
- **False from birth, not stale.** At `0cb8572`, the commit that split this file out, `stop()` had the body it has now — clear the timer, nothing else — and `suspend()` was already the field's only writer, so the pair never described code that existed. The class is internal (`ReplayManager` is nowhere in the barrel), which is the reason this is a maintainer-facing correction rather than a consumer-facing one.
- **The scan that produced the work list was the defect of the pass.** It asked which zero-count branch arms still lacked a verdict by reading the line above each site, and reported 21 unvisited legs out of a 46-arm ledger in which every arm already carries one — verdict comments run five to fifteen lines, and the measurement they cite is the point. Reading the same sites with a window turned a re-audit into one real find. `AGENTS.md` now carries the rule: a scan is a probe, so give it the control a probe needs — run it on a site known to be answered and check it says "present".
- **Nothing to test, and that is classified rather than waved away.** The diff is comment lines only, the suite is unchanged at 936 tests, the ledger at 46 of 1963, the aggregate at 99.02 / 97.65 / 99.27 / 99.69. Where the corrected text *does* reach consumers was measured instead: it appears in `dist/core/replay-manager.d.ts`, in the ESM chunk and in both CJS bundles, because esbuild keeps comments in the JS and every one of those paths is published.

## 0.21.25 delivered scope

- **A fan-out that did not terminate.** Handler lists are `Set`s and `dispatch()` iterated the live collection, so a handler that registered a *fresh* closure for its own topic was served the message that caused the registration — and that handler registered another, and so on. Measured: **500 handlers invoked for one publication** (the probe's ceiling, not a limit the library had) and **999 for the next**, since the registrations persist. The pattern behind it is ordinary application code: re-arming a one-shot handler on every message.
- **Both halves of the same mutation.** `Set` iteration also skips entries deleted before the cursor, so an `unsubscribe()` issued by an earlier handler used to remove a later one from a delivery already in flight (measured as the pair delivering `['first']`). The contract is now fixed in the predictable direction: a message is delivered to the subscribers that existed when its delivery began.
- **Why no earlier pass saw it.** Re-subscribing the *same* function reference is a no-op by `Set` identity, and the first probe written for this question used a named function and measured exactly one invocation. The defect only appears with distinct closures, which is the difference between a probe that confirms a suspicion and one that invents it — the measurement, not the reasoning, is what settled it.
- **Sized rather than assumed.** None of the five perf gates covers dispatch, so the snapshot was measured directly: 9-23 ns per dispatch for 1-20 handlers, +15 ns for a matching wildcard pattern with two handlers, against a per-message budget in the tens of microseconds. Three new tests each fail with the number that was measured (`expected 500 to be 1` and two array comparisons), the 933 existing tests are untouched by the change, and coverage stayed at 46 zero-count arms of 1963.

## 0.21.24 delivered scope

- **Two lifecycle defects, both found by tiering the coverage ledger.** `WorkerClusterRuntime.stop()` arriving while the runtime was still activating rebuilt everything the teardown had removed — a live channel with its listener, a worker record no peer would ever prune, a heartbeat interval no later `stop()` could clear, and a stopped tab accepting frames addressed to it — because `activate()` sets `started = true` and only then calls consumer code. And a `stop()` issued from `handlers.onResume` was dropped outright, since `handlePageShow()` clears `suspended` on the statement before that callback and `started` is set only by the `activate()` its generation bump then skips: the next hide/show pair re-fired `onResume` on a runtime the caller had stopped.
- **The caller enumeration was right and useless.** In the first defect every *caller* of the guarded method respected the invariant; the re-entering code was inside it. That is the shape a ledger of zero-count arms can hand you without pointing at, and it is why the two new tests construct the window from the seams that open it (a channel adapter that stops the runtime, a control handler that stops the runtime) rather than driving it from outside.
- **The ledger moved for the first time in six phases: 47 → 46 zero-count branch arms** (denominator 1958 → 1963, branches 97.59 → 97.65, tests 930 → 933). One arm became reachable-and-covered through the fix; the rest now carry a verdict written at the site — a caller enumeration for `writeRoute()`'s storage guard, `routeOwnerIsLive()`'s own conjunct for the publish-target fallback, the Map seeding for the two handoff projected-load reads, and the three-flag invariant stated once at `stop()` with the other sites pointing at it.
- **Measured rather than inherited, everywhere it was cheap.** A flag-vector census over one full suite run produced the reach rows (four distinct `pause()` vectors, one each for `activate()`'s entry and the listener removal, two each for `reconcile()` and `writeRoute()`), a `tsc --noEmit` run per leg produced the type-verdict counts, and re-deleting the handoff owner guard re-measured the five errors its comment had been claiming. The census rows that *do* occur are the control on the rows that do not: every probed flag reads false somewhere, so an absent row means "no test reached it" and not "the probe is blind".
- **Two dominated terms kept on purpose.** Deleting either of `stop()`'s original flags leaves the suite green, because each is implied by the new `lifecycleListening` term. They stay on an asymmetry: a redundant term in a disjunction costs one boolean test, a missing one drops a teardown silently — which is t

## 0.21.23 delivered scope

- **The per-operand guard queue is closed.** All four of `data-bus.ts`'s four-term state chains — `stop()`'s early return, the recovery-timer callback gate, `runTransport()`'s ready shortcut and the demand reopen under it — were measured one deletion at a time against the whole suite: sixteen mutants, of which four were already pinned by a named test, eleven are closed by construction, and **one** was a live behavior no test had ever named. `sends no unsubscribe to a transport while the bus is stopping` pins it and dies to that mutant alone.
- **A census replaced the input differential, and a stack trace made the test.** State guards have no caller input to vary, so the operands were classified by recording the guard's flag vector at every evaluation across one full suite run (7589 `stop()` calls over seven distinct vectors, 49 timer entries over two) and comparing the rows against what each surviving operand would need to be the decider. Where a premise occurred and its deletion still passed, printing a stack on first sight named the production path reaching the guard — `unsubscribeTransport()` ← a control frame ← `WorkerClusterRuntime.stop()`'s handoff. The test needed a second tab, because with no remaining subscriber the handoff removes the route instead of posting a frame, and the single-tab draft passed against its own mutation.
- **Two new shapes of "this operand cannot decide".** Dominated by the *callee*: three of the demand reopen's four legs restate guards `reopenTransport()` runs first, so deleting one hands the caller the same promise. And dominated by *absence of a seam*: `stop()`'s `!started` premise is true for the length of every `start()`, with no caller boundary inside it to observe it — the same invariant `reopenTransport()` already documents for its own pair, in the copy that had a comment.
- **A comment that justified a dead operand became a gate.** The `typeof value !== 'number'` legs in `validation.ts` exist, on the record, to catch someone writing the coercing global `isFinite(value)` for `Number.isFinite(value)`; `no-restricted-globals` now refuses that at lint time, verified by introducing the swap and watching the rule report it. The two live copies of the claim that no such rule existed were rewritten rather than deleted, and the operand is now documented as defended twice with the two defences covering different removals.
- **What did not go into the suite, and why.** Two candidate tests — one aimed at the `status !== ERROR` leg, one an early version of the unsubscribe test — passed under the mutation they were written for and were deleted. Their replacements say "no route found, held against this branch being relaxed or reordered" rather than claiming unreachability, which is the half that was actually established.

## 0.21.22 delivered scope

- **One method, applied to every multi-term guard the previous scan ranked**: delete a single operand, run the whole suite, and classify which of three answers that mutant gave — pinned, incapable of deciding, or live and unnamed. Nine behaviors are now named that no test had named (three socket-staleness terms in `websocket.ts`, two of `trace.ts`'s four dedup/activity counters, two operands of the `storage-event` envelope, two option legs of `DedupManager.start()`'s sweep gate), and the suite went 923 → 929.
- **The ledger did not move, and that is the result.** `src/` holds the same **47** zero-count branch arms at the end of six phases as at the start, with only the denominator changing (1962 → 1958, from two dominated operands being deleted). Every operand probed is evaluated on every call, so no coverage total distinguishes "runs" from "decides" — the class is invisible to the arm ledger and visible only to a whole-suite mutant.
- **A joint assertion was the recurring cause, not an absent test.** `trace.ts`'s activity check looked pinned because one existing case raised *both* dedup counters in the same window, so whichever operand survived still emitted; the storage envelope's `seq` and `message` tests were both tripped by its single malformed write. Splitting the inputs, not adding coverage, is what made each leg die on its own.
- **Five operands closed as incapable of deciding anything, by differential.** Two in the envelope and all three `typeof value !== 'number'` tests in `validation.ts` were proven rather than argued: a fixed input vector (23 stored payloads; 23 values × 3 validators × 4 variants) produced byte-identical accept/reject-and-message results for the guard as written and for each mutant. The kept `typeof` leg then had its own justification tested both ways — construct the coercing-global swap it exists to catch, and observe that it kills nothing while the leg is present and turns `heartbeatIntervalMs: '3000'` into an accepted option once the leg is gone.
- **Two dominated operands deleted, and a clean bill plus a thin pin recorded instead of averaged away.** `getMetrics()` and `flush()` each re-read a field the same expression had just computed, which cannot decide anything and was silently absorbing the mutation that would have proved the getter's contract; deleted, with both kill sets in the comment. `ReplayManager.start()`'s four-term gate turned out fully pinned all along — the parity check between two same-shaped managers, which is exactly where `DedupManager`'s gap was. And five of `validation.ts`'s six surviving-leg deaths come from several cases while the sixth comes from one, so the site says so instead of reporting "six of nine".

## 0.21.21 delivered scope

- **One more branch arm closed by a call no test had made** — and this one needed a caller that does not exist in a browser. `queueStartAfterStop()`'s `stopPromise ?? Promise.resolve()` had never taken its fallback, which is the state a *failed initial open* lives in (its teardown is owned by `pendingStop`, so no gate exists); the only synchronous application-code seam inside that window is the caller's own `ClusterEnvironment` port, so the case wraps the port and calls back into `start()` from a storage write. `src/` goes from 48 zero arms to 47.
- **Which half of that expression has teeth.** Not the leg the test was written for. The fallback operand is consequence-free — `start()` chains the reopen behind `pendingStop` independently, so the measured `start` → `stop` → `start` order survives deleting the read entirely. What the case does pin is the routing one line above it: `if (this.stopping)` → `if (this.stopPromise)` reddens it, and 192 of the file's other tests stay green doing it.
- **A candidate test written, measured, and deleted.** A second case queued a restart behind a transport whose `stop()` was held open, which is the obvious pin for the gate operand — and it passed under all four single-leg mutations tried. A bounded number of awaited microtasks cannot see a wait whose wakeup needs the timer queue, so the test was removed and its zero kill rate recorded at the site, which is the finding; the number 194/194 under deletion is the statement, not a gap waiting for a better test.
- **The guard whose deletion is a crash rather than a failed assertion.** Removing that read turns the restart's "wake, discover we are still stopping, re-queue" into a microtask busy-wait that starves the macrotask the transport stop needs: `tests/lifecycle-invariants.test.ts` aborts its worker ~40 s later inside `Builtins_RunMicrotasks` with an out-of-memory, and every test in `data-bus` still passes. The site comment now says the fuzz is that line's only witness, which is also a warning to anyone who trims its stop/restart interleavings for speed.
- **Three shipped claims retracted against the code, in the two ways claims go stale.** A count that had drifted (the `?? this.currentRecord` fallbacks are three, not "the identical pair", and the third carried no site text at all), a measurement that no longer reproduces (the reopen absorb's "fails exactly one test" is 194/194, 194/194, 51-of-194 and 194/194 across the four experiments now recorded in its place), and eleven line-number citations into our own files of which six pointed at the wrong place — two of them into another comment. Every position is now a symbol or a condition, the surviving numbers are the dependency's (`centrifuge@5.7.4`, re-verified to its last `emit('error')`), and the whole prose change is proven code-free by comparing esbuild's emitted JavaScript against the previous revision.

## 0.21.20 delivered scope

- **Six uncovered branch arms closed by calls no test had ever made** — not by harder-to-reach guards. `publish(topic, data, messageId: string)` is a declared overload on the exported runtime and its normalization had never executed, because the bus always passes an object and nothing called the runtime with a string. Same for a single-item `publishBatch`: every case had supplied both `messageId` and `timestamp`, so the "one of them", "the other one" and "neither" shapes had never been delegated.
- **Which of those has a consequence, and which only has coverage.** An absent metadata reaches `sendControl` as `undefined`, which calls the handler with **three** arguments instead of five — the arity is how a listener tells "no id at all" from "an id of `undefined`". The two partial shapes are covered and have no assertion that separates them from always building the object, because the receiving side re-normalizes with `metadata?.x === undefined ? {} : …`: an omitted key and an `undefined` value are the same wire frame.
- **`clusterKey: ''` is a namespace alias, and the shipped sentence said otherwise.** The namespace is derived from `options.clusterKey || '__default__'`, so an empty key hashes the literal string and shares storage and BroadcastChannel with `'__default__'` — while the option's own JSDoc said different cluster keys "operate in isolation", an absolute that reaches consumers through the declarations and the bundles. Both sides are now pinned (the alias, and that a third key still isolates) and the exception is stated where the option is declared. The behavior is documented rather than changed: moving `''` would silently relocate storage for anyone already passing it.
- **The ledger's third tier, established per arm by deleting the fallback and running `tsc`.** `noUncheckedIndexedAccess` makes an index read `T | undefined` whether or not a hole is reachable, and `exactOptionalPropertyTypes` forbids the always-present form of a conditional spread (`TS2769`) while the whole suite stays green — so those legs can neither run nor be deleted, and the compiler is the only check that exists for them. Applying the probe inside the route-write block separated five compiler-held legs from one that compiles bare: `(previous?.generation ?? 0)` is unreachable because of a null filter three lines above it, not because of its own expression. In a coverage report the two are indistinguishable.
- **What moved, and what did not.** `cluster.ts` 20 → 14 zero arms and `src/` **54 → 48 of 1962**, with aggregate branches at 97.55. No frame, default, storage key, export or behavior changed, so mixed-version peers see nothing new.

## 0.21.19 delivered scope

- **A clamp that clamped nothing, and the metrics window it corrupted.** `recordDispatched()` counted every dispatch with a matching receive as a latency sample, and the `Math.max(0, …)` sitting there was added for a *backwards* clock — `NaN` passes straight through it. The sample count rose while the bucket write landed on the non-index property `"NaN"`, which no percentile walk reaches. Measured: one bad reading of the public `trace.now()` clock blanked `dispatchAvgMs` (a JSON sink renders `NaN` as `null`, so the field vanishes) and pinned `dispatchP95Ms` and `dispatchMaxMs` at the histogram ceiling, while `dispatchP50Ms` still printed a plausible number. An unmeasurable delay now records no sample, on the same terms as a dispatch with no matching receive; a negative one is still clamped to 0, because that pair is real and only its order is wrong.
- **Two capability checks that a partial persistence adapter was never asked to make.** `clearAll()` and `clearBefore()` each put their durable operation behind an optional-method check, and both methods are optional on `DataBusReplayPersistence` — yet every case in the suite injected a full adapter or issued one cutoff per lifecycle, so neither "no durable operation" leg had executed. One new case asserts a local clear that has nothing durable to do succeeds *without* reporting a persistence error; the other asserts the newest `clearBefore` cutoff wins, which is where the in-memory filter is the only enforcement of a cutoff the caller already asked for.
- **A third tier in the coverage ledger: arms that can neither run nor be deleted.** With `noUncheckedIndexedAccess` on, an index read is `T | undefined` whether or not a hole is reachable, so a `?? fallback` satisfying an assignment is a type artifact, not a gap. Four of the legs this pass looked at are that shape (`TS2532`/`TS2322`, measured by writing the bare field), and `AGENTS.md` now names the tier beside the other two so a later hunt checks the compiler before hunting a test.
- **Six legs now say why they read 0, at the site.** `websocket.ts`'s `connectPromise ?? undefined`, `replay-persistence.ts`'s `dbPromise === pending` fall-through, `port-reaper.ts`'s null-handle arm, `version.ts`'s `''` arm, and three `invalidate`+`reject` latches that now point at the enumeration which already covered all four of them but sat only in `load()`. Each one carried a real enumeration that had been written nowhere a reader would look.
- **What the ledger count cannot tell you.** This release closed **no** uncovered branch arm: `src/` went from 54 of 1960 to 54 of 1962, because the fix adds one `if` with both of its arms covered. The defect lived in a fully covered line, next to three zero arms that were each already explained. A ledger is a queue of questions, not a list of bugs.

## 0.21.18 delivered scope

- **Five legs that no test named, each pinned with its mutation attribution.** A non-string frame `type` normalized to `null` before it reaches `getDiagnostics().protocol.lastUnknownMessageType` (and `getUnknownMessageStats()`, which had no reader at all); a `replay.persistenceRetry` block that names one field and must inherit the documented default for the other; the connect-timer cancel inside `failConnect()`; a `channelToken` credential request that names no channel; and a `Blob` frame whose conversion fails after its connection was replaced. The records say which assertion each mutant reaches and name the three legs that have **no mutant of their own**.
- **The lesson about partial option objects.** Both defaulting sites read *hot* in coverage — a bus with no policy takes the fallback, a bus with both fields takes the supplied value — and the shape in between, one field given, had never been read. A counter that moves does not mean the configuration space is covered; the pin has to name which default it can see, which is why each of the two defaults needed its own case.
- **The lesson about async completions.** Two of the five legs are the same shape in different files: a guard that discards a result from a superseded attempt, where the reachability of the guard is owned by a *cancel somewhere else* — and that cancel was the untested line. The connect-timer guard is now documented as unreachable-by-construction, with the construction it depends on pinned by name.
- **One shipped comment rewritten, and one numeric claim retired.** `src/websocket.ts`'s timeout-callback comment now enumerates why all three of its terms cannot fire rather than explaining only one, and drops its "all 880 tests green" count instead of refreshing a number that rots. Comment text ships: it reaches consumers through the bundles as well as the declarations.
- **What did not move.** No behavior, public API, protocol frame, default, storage key, or export changed, so mixed-version peers see nothing new. `src/` holds 56 zero-count branch slots of 1960 (down four), and `validation.ts` reports full branch coverage for the first time.

## 0.21.17 delivered scope

- **A confirmed route that named a live Worker holding nothing no longer orphans its Topic.** `pause()` clears
  `assignedTopics` unconditionally but rewrites only the routes it can hand off, so a handoff whose final storage
  flush fails leaves the durable record pointing at the departing owner — confirmed, with its old generation. When
  that worker id registers again, every peer defers to a live confirmed owner that holds nothing, no tab's transport
  subscribes the channel, and inbound delivery stops everywhere while publishing still looks healthy. The named
  Worker now repairs it on each reconcile: reclaim when it still has a local handler, release the record otherwise,
  with the deletion flushed before the `REGISTRY` nudge so the peer that reconciles on it reads repaired state.
- **Why neither reconcile pass could have noticed, written down at the site.** One walks `subscribedTopics` and the
  other `assignedTopics`, and the phantom is in neither; `isAssigned()` then answers `true` for it through its
  durable-route fallback, which is what made the state silent rather than merely slow.
- **Four gates on a sweep that deletes shared state**, each measured separately: the confirmation must be present (a
  route still awaiting its ACK is an election in flight), the worker must be the named one, the assignment map is
  consulted first so the legitimate elected-owner-without-local-handler case is left alone, and `knownTopics` — a map
  this worker filled itself — is the only source of the plaintext. Mutating them one at a time fails 6, 28, 7 and 1
  tests respectively, and the reclaim/release/flush/nudge legs each die to exactly one assertion.
- **One pre-existing test's premise corrected**: its hand-written takeover route carried the previous owner's
  `confirmedAt`, a state no worker writes and precisely the shape the new pass releases, so its assertion was passing
  by a mechanism other than the one it named.
- **The `storage-fail` fuzz interleaving that found this is measured and deliberately not shipped** — it reddens the
  sweep on the pre-fix code from seed 414 onward, which is four times below the sweep's depth floor, so it is a finder
  rather than a guard; its knob (`MemoryStorage.failNextWrites`) and the recipe are committed.
- **A classification, comment-only:** `handoffAssignedTopics()`'s unreachable `if (!owner) continue;` now names the
  four links that make it unreachable, the test that pins each, and the measured counterfactual — deleting it keeps
  the suite green and fails the type check five times, so it is a narrowing rather than a branch.

## 0.21.16 delivered scope

- **A deferred transport operation is cancelable by its own release.** `subscribeTransport()` and
  `unsubscribeTransport()` recorded intent in `transportSubscribedTopics` and then handed `runTransport()` a
  captured call, so a subscribe parked behind a pending opening could flush *after* the unsubscribe that cancelled
  it. The connection then held a channel that no local handler, cluster assignment, or route record owns — and
  nothing recovers, because the dedupe that prevents double-subscribes reads the same stale set. `runTransport()`
  now also takes the desired state as a predicate and re-reads it at each place that resumes on a later task. Three
  regression cases, with per-leg mutation attribution: the two resume points have disjoint kill sets (1 test versus
  2), and inverting the guard fails 20 cases including the pre-existing startup-queueing test.
- **The coordination fuzz now delivers frames the way a browser does.** `ChannelHub.setAsyncDelivery(true)` defers
  each post by one microtask; it is opt-in because 15 tests post a frame and assert without awaiting. Enabling it
  on the sweep's hub is what turned the previous release's unresolved observation into the defect above — measured
  as a control in both directions, six seeds failing before the fix and zero after, with the synchronous hub
  passing on the broken code.
- **What the raised fidelity did *not* claim is recorded at the sites.** The async hub adds no standing mutant kill
  on the fixed code, the member-set re-read inside the deferred pump is defensive rather than observable through
  this fake, and the unsubscribe direction's measured cost is a redundant wire frame rather than a stranded
  channel.
- **Shipped prose the fix invalidated**, corrected in English and Chinese: both subscription propagation chains
  wrote the set *after* the transport call (the code does it before), the recovery-gate paragraph credited only the
  cancellation-generation guard, and `api.md`'s `subscribe()` row promised queueing without cancellation.

## 0.21.15 delivered scope

- Both point-to-frame addressee guards are now pinned by name. `handleMessage` dispatches on `type` alone and
  the cluster channel is broadcast, so `targetWorkerId !== this.workerId` is the only thing keeping a runtime
  from acting on a frame meant for someone else; measured by deleting each line in turn, 369 and then 358
  tests stayed green, and the coordination fuzz cannot assert either one because its invariants are end-state
  checks and a slower convergence still passes.
- The `ROUTE_RELEASED` pin needed a construction its staleness test could not refuse: a durable route that
  genuinely names this runtime, with a matching `generation` and `handoffFromWorkerId`, and the ACK addressed
  to a third worker. That is also why the older forged-`topicKey` case never reached the line.
- The coordination fuzz gained a third limit, placed where neither half of a loop owns it. Its two existing
  bounds were both made of time, and the failure that had been turning `verify` red spent its time in
  microtasks, where no same-thread deadline can reach it; `ChannelHub` now stops delivering past 50,000
  posts in one seed, with the threshold taken from a measured distribution (p50 = 28, p99 = 90, max = 16,763)
  rather than from the size of the wedge, and a cut seed is printed by name and excluded from the depth floor.
- What that loop actually is was then measured instead of inferred, and it is the harness rather than the
  library: 11,542 accepts against 11,538 `confirmRoute` skips and 6 writes reaching storage, because the
  owner's confirmation sits in its own batching writer while a peer reads the flushed record — and the cycle
  cannot yield to a microtask because the test hub delivers every frame on the caller's stack. Deferring
  delivery by one microtask removes the storm outright. The earlier note in this file that called it an open
  product defect is corrected here, and the six injected-frame seeds that correction leaves behind are named
  as the next question rather than resolved.
- `docs/release-checklist.md`, in both languages, now records that `pnpm bench:compare` can be closed by the
  act of investigating it: its baseline is drawn from the same rolling archive every `bench:browser` run
  appends to, so the instruction is to read the host load first and record a suspect failure as deferred
  instead of chasing a green.
- `docs/progress.md` has a structural gate. Two PRs for one phase had left two `## Phase 142` blocks, with one
  of them pushed below the anchor every entry is appended at; `tests/documentation.test.ts` now requires each
  phase number to be new, later than the previous entry, and above the standing sections.

No behavior, wire-format, storage-layout or cluster-protocol change: `src/` is untouched in this version, and
the release is owed to `docs/release-checklist.md` and `CHANGELOG.md`, both of which ship in the package.

## 0.21.14 delivered scope

- The published Chinese mirrors were read against `src/` for the first time. `package.json` `files`
  ships ten `docs/*.md` plus their `docs/zh/` copies and both READMEs, and earlier passes had applied
  their corrections sentence by sentence to whichever language they were reading — so the Chinese
  paragraphs kept claims English had already retracted, and English kept claims only its own tables had
  corrected. Twenty-two claim classes came out of that reading, in both directions.
- The coordination fuzz can now bound a single seed. A `verify` run reported
  `stopped at 1046/5000 seeds after 158476ms (slowest seed 151850ms)` and then the 120s per-test
  ceiling: 1,045 seeds summed to ~6.6 ms each while one interleaving ate 96% of the sweep, and the
  between-seeds fuse could not reach inside it. Each awaiting step now races a 2s deadline and a seed
  that trips it is counted, named by its operation list, and left unasserted rather than judged on a
  state that never quiesced.
- What that guard cannot do was measured instead of assumed. Forcing the deadline to 12 ms over a full
  5,000-seed sweep trips it zero times, because every locally reproducible slow seed is *synchronous*
  cost inside the first tab's `stop()` — nothing a same-thread deadline can preempt. So the mechanism is
  pinned directly in both directions, and three mutants die at three separate assertions: a cap that
  never expires, one that expires eagerly, and one that reports settled work as expired.
- The `knownTopics` section of `docs/architecture.md` enumerated three of the six in-process call sites
  that populate the cache; `publishBatch` and `activate()` appeared nowhere in it, in either language.
- The storage absolute this cycle retracted elsewhere turned out to be hiding in a **table cell**: the
  identifier table's `topic` row said "No; kept in Runtime memory and control messages" while the row
  later in the same table says each storage-event frame, topic plaintext included, is written to
  `localStorage`. Four passes had been through that file, including one that corrected the contradicting
  row. `configuration.md`'s boundary list had also filed the tab-id key with the `localStorage` records;
  it is written to `sessionStorage`.
- No behavior, wire-format, storage-layout or cluster-protocol change. The only executable edit is in
  `tests/`, which the package does not publish; the shipped diff in `src/` is comments only.

## 0.21.13 delivered scope

- The prose audit reached the last published surface it had not read: comments *inside function
  bodies* in `src/**`. They ship because esbuild preserves them into `dist/**/*.js` and
  `dist/cjs/*.cjs`, both listed in `package.json` `files`, so the 0.21.11/0.21.12 sweep (docs +
  READMEs) and the declaration-JSDoc sweep had each left this half of the published text unread.
  Thirty-three claims were corrected after each was re-read against the code it describes, and a
  dozen more candidates were cleared on inspection and recorded with the reason.
- Two of those corrections change how a maintainer reads the code, not just its prose. A proof that
  a chained `.catch` resolves rested on "`reportError` cannot throw", which the same file contradicts
  500 lines lower and a shipped test pins; and three comments credited themselves with preventing
  something the adjacent code already handles — most consequentially `isAssigned`, whose real reason
  for preferring the in-memory map is a `CONTROL/SUBSCRIBE` accepted with no durable route, the state
  `tests/cluster.test.ts` already pins.
- Claims about a *dependency* now name it. Against `centrifuge@5.7.4` there is one client-level
  credential hook and no `getChannelToken` in the package at all, so that request kind has never
  fired outside a test fake; and `CentrifugeSession.unsubscribe()` removes the emitter's own no-op
  `error` guard under a comment claiming internals were preserved. The second was first recorded as
  an open question — the test double cannot exhibit the guard, so no existing test could see it
  either way — and has since been closed against the same pinned version: all twelve `emit('error')`
  sites in `BaseSubscription` but one sit behind a `_isSubscribing()`/`_isSubscribed()` test, and the
  three ways back into that one after `unsubscribe()` are closed by a state re-test, by the client's
  `Subscribing`-only reconnect pass, and by the refresh timer `_clearSubscribedState()` cancels. The
  enumeration is in the comment, and no defensive re-attach was warranted.
- `pnpm bench:compare --fail-above-pct 50` gained the leg its median baseline could not supply: a
  value must now also exceed the highest sample in its own baseline window, because a median over a
  bimodal metric is stable only while the modes stay mixed. What that excuses is printed rather than
  passed silently, and the cost is written down beside it — a sustained shift inside the observed
  range is now invisible to the gate. Both legs were attributed by mutation: removing the new one
  fails exactly one test, suppressing everything fails four including the pre-existing pair path.
- No behavior, wire-format, storage-layout or cluster-protocol change. The only executable edit in
  the release is inside `scripts/`, which the package does not publish; coverage stays at
  99.01 / 96.90 / 99.26 / 99.69 over **897** tests.

## 0.21.12 delivered scope

- The prose sweep finished where it started: the README. `README.md` and `README.zh.md` promised
  "the persistence layer does not store connection addresses, raw Topic text, or message content"
  two bullets under the line advertising the durable replay persistence that does precisely that —
  its IndexedDB store is created with `keyPath: 'topic'` and its rows carry the publication payloads,
  and the factory is a public export. The claim is now scoped to the coordination records it is true
  of, and both opt-ins that persist real content are named beside it. The Chinese list also gained
  the two feature bullets it never had, so the promise no longer stands without its disclosure.
- `docs/release-checklist.md`, which ships in the tarball, held three traps. The published-consumer
  gate was said to run "with the same budget as a manual run" — the workflow passes 48 × 7500 ms as
  its own env while the script defaults to 6 × 5000 ms, so a hand-run repeat hits `ETARGET` after 30
  seconds on a tag whose CI run was green. Measured on `v0.21.11`: 39 retries of 48 in a successful
  run, and the offline repeat passed first try. Both budgets are now stated, with the command that
  reproduces the CI one. CI was described as running on "every push and pull request" although both
  triggers are filtered to `branches: [main]`, and `bench:trend` was missing from the local-only list
  despite rewriting `docs/benchmarks.md` from the local archive.
- The `ci.yml` comment naming the coverage floors still said 96/92/96/97 after 0.21.7 raised them to
  98/96/98/99; the config, the shipped checklist and `AGENTS.md` already agreed, so only the comment
  had drifted. Corrected, and `AGENTS.md` now records how the sweep concluded: an audit of "the option
  surface" covers the tables, while the paragraph under the same heading and the README's summary
  bullets are separate claims — and the sentence shape worth hunting first is an absolute about
  storage, because one opt-in is enough to break it.
- No behaviour, wire-format, storage-layout or cluster-protocol change, and no `src/` or `tests/`
  file was touched. Coverage stays at 99.01 / 96.90 / 99.26 / 99.69 over **895** tests.
## 0.21.11 delivered scope

- A prose audit of the four docs files no earlier sweep had covered — `architecture.md`,
  `capabilities.md`, `getting-started.md`, `transports.md`, plus the `api.md` entry they lean on —
  produced roughly fifteen sentences the code does not support, corrected in English and Chinese. The
  load-bearing ones are all of the "never persists" family. `architecture.md` promised in six sentences
  that coordination traffic never touches localStorage, which `channelFallback: 'storage-event'`
  contradicts by construction: the envelope *is* the frame, so plaintext topics and publication
  payloads live under the channel key until the channel closes and indefinitely after a tab crash. The
  matrix said the SDK does not persist business payloads, which its own exported
  `createIndexedDbReplayPersistence` disproves (its object store is keyed by the plaintext topic), and
  it sold `workerMode: 'shared'` as reusing one connection when every port gets its own
  `CentrifugeSession` and its own WebSocket — shared mode saves the process, never the socket.
- Two instructions written for people implementing a transport pointed at the wrong callback and the
  wrong guard. Auto-recovery is started by `onStatus('error')` and paced by the recovery cooldown;
  `onError` records and notifies and does nothing else, so a backend that reports a dead socket only
  there is never reopened. The generation counter is compared only by the asynchronous credential
  bridge — a superseded Worker cannot reach the transport, because its listeners are removed first.
  The same file's interface block, Worker unions and wire sketch each omitted members that ship
  (`publish`'s metadata argument, optional `publishBatch`, the diagnostics labels, the `TOKEN_*` and
  `SESSION_REAPED` types, the batch frame).
- One over-absolute claim sat in three places, a `cluster.ts` comment among them: the route check
  drops a `CONTROL/SUBSCRIBE` naming a *different* worker, and a topic whose route cannot be read is
  accepted. The tolerance is bounded — `confirmRoute` writes nothing without a route to stamp and the
  next reconcile withdraws the assignment — and is now pinned by a test. Measured, the stricter rule
  the prose described fails that test *and* two load-weighting tests that already relied on it.
- Also in this release, from the same "measure the claim rather than re-read it" pass: the
  persistence-retry sentence in `configuration.md` now says which half the 1600 ms ceiling bounds, two
  tests carry the full doubling schedule and the verbatim first wait, and two `PortReaper` comments
  describe what their legs actually protect.
- No behaviour, wire-format, storage-layout or cluster-protocol change. Whole-tree coverage is
  unchanged at 99.01 / 96.90 / 99.26 / 99.69 over **895** tests.

## 0.21.10 delivered scope

- `heartbeatIntervalMs: Infinity` — the documented way to switch the SharedWorker PING
  heartbeat off — was being read by the reaper as a malformed number. It fell through the
  same `Number.isFinite` guard as `NaN`, `0` and negatives and took the default 10 s, so
  the port was given a 30 s session timeout on the strength of being the one port that would
  never send another message: the option whose stated purpose is "the reaper is not needed"
  guaranteed a reap 30 s after connecting. `Infinity` now exempts that port from reaping,
  while the three values the transport constructor rejects (and which therefore cannot come
  from this library at all) keep the fallback. Pinned by one test that kills three mutants at
  three different assertions, plus an assertion that the `INIT` actually carries the value —
  the two halves of this defect were each covered by a green test, which is how it survived.
- The shipped reaper documentation stopped promising things the code does not do, in both
  languages: no `PortReaper.dispose()` shutdown hook runs "when the SharedWorker shuts down"
  (nothing calls it — a `MessagePort` has no close event, so there is no such signal to hang a
  hook on), and what disabling the heartbeat costs is stated next to what it disables (a tab
  configured that way and then crashed keeps its session and its WebSocket).
- A test that passed while breaking the gate: an IndexedDB replay assertion attached its
  rejection handler after an await that a real 40 ms timer could overtake, so on a loaded
  runner `pnpm test:coverage` exited 1 with `Unhandled Rejection` and every test green. The
  handlers are created next to their promises now, measured in both directions by forcing the
  round trip to 200 ms.
- No wire-format, storage-layout or cluster-protocol change. The behaviour change is confined
  to shared mode configured with `heartbeatIntervalMs: Infinity`, which could not work as
  documented before.

## 0.21.9 delivered scope

- A SharedWorker tab whose main thread was starved — a long synchronous task, or the timer
  throttling a backgrounded tab gets — used to lose its transport and never come back. The
  SharedWorker's reaper reclaimed the silent port, and because a `MessagePort` has no close
  event and a closed port accepts every post while delivering nothing, the tab went on owning
  its routes and reporting `healthy` / `connected` while its publications vanished. The reaper
  now announces the reclaim on the port before closing it, which the transport turns into an
  ordinary backend loss so the existing recovery rebuilds the session. Measured in a real
  browser both ways (desktop Chrome; on headless Chromium the reaper cannot fire while the
  page is blocked, so the precondition does not occur there): rebuilt automatically in 36.7 s with the
  announcement, and never within 90 s without it.
- Shared-mode owner migration had no browser coverage at all. Three shared tabs now pin that
  closing the owner moves the single server-side subscription onto a connection that was
  already open, and that the handover keeps delivering in both directions.
- No wire-format, storage-layout or cluster-protocol change: the added message travels between
  a page and its own Worker, and a main thread that does not know the type ignores it.

## 0.21.8 delivered scope

- A second sentence that ships inside the package was wrong, in the same class as 0.21.7's. `docs/api.md` promised that no public trace event contains a raw topic, in English and in Chinese, while `docs/configuration.md` documented the opposite in both languages and went on to tell integrators to redact topic names before forwarding a sink to telemetry. Subscription events do carry the topic they report, and so do the route-scoped `reliability` operations. The corrected text states what was measured: no event carries a message payload, a connection address, or an error body; topic plaintext appears in exactly those two event types; `coordination` names routes by their opaque key. A test now drives a payload sentinel and an error-body sentinel through a real bus and asserts the sink sees neither — the first witness either half of that claim ever had.
- The suite's long-standing "loaded-runner" E2E failure was not load. The shared-mode teardown spec asserted on the demo server's *global* connection count while specs run in parallel, so every other live tab contributed to the number; and it passed vacuously when it passed, because only a topic's owner transport subscribes its channel, so a "2" could be one channel-carrying socket plus one subscribed to nothing. Sockets are now addressed by the channel each holds, and the test asserts both halves: the closed tab's socket leaves the server's list, and the surviving tab's stays in it. Repeating that one spec three times, which failed 3 of 3 against the old assertions, now passes.
- Both seeded invariant harnesses were run 80x and 133x past the depth they ship with — 400,000 and 200,000 seeds, 753.7 s and 262.6 s — and surfaced no violation, so the zero-count legs that remain are classification work rather than a hidden coordination bug. Their headers now record the available depth and the three separate limits that can end a deep run.
- One coverage zero that had been read backwards is now labelled with what it actually counts: where a `??` fallback is an arrow function, the branch region spans that closure's body, so the arm counts invocations rather than the callers that omitted the argument. Repo-wide this is the only leg of that shape, and the rule now lives in `AGENTS.md`.
- No behaviour, wire format, or storage layout changed in this release.

## 0.21.7 delivered scope

- A statement that ships inside the package was wrong. `docs/api.md` promised replay buffers are "cleared when the last handler for the topic unsubscribes" while also saying a wildcard replays across every matching buffered topic — and a pattern is not a topic: history is recorded under the concrete publication topic, so releasing `chat.*` clears none of it, and the durable cleanup is asked for a key no row lives under. The English and Chinese references now name which key each cleanup addresses, state that `maxPerTopic` bounds ring depth and never ring count, and list the calls that do reclaim it. The behaviour is unchanged (pattern-aware pruning would evict topics another live subscription owns), and a test pins the boundary so the text cannot drift back.
- One genuine test gap closed: the hydration epoch check in `ReplayManager`'s catch had never executed. A buffer reset leaves the retry generation current, so a load failure arriving after it could report through the *replacement* session and latch the completion state that suppresses its load — a phantom persistence error plus durable history missing for the rest of the instance's life.
- The receiver-side frame-validation rules (0.21.5 / 0.21.6) moved from maintainer notes into `docs/architecture.md` in both languages, including the two deliberate non-checks and what a non-JS peer must do to be accepted — the fail-closed guards drop frames without any response, which is invisible to an integrator unless it is written down.
- Roughly a dozen zero-count legs across five modules were settled by experiment rather than assumption: one was pinned, and the rest were labelled at the site with the condition that covers them and what deleting it would cost. None was deleted, and no release claims a coverage win that was not measured.
- The coverage gate went back to being a gate: floors of 96 / 92 / 96 / 97 had drifted 4.7 points under the tree's measured branch coverage, enough for a module's worth of lost tests to pass every check including the release one. Now 98 / 96 / 98 / 99, with the remaining margin reserved for the one runner-dependent input, and verified to fail when raised above measurement.
- No behaviour, wire format, or storage layout changed in this release.

## 0.21.6 delivered scope

- The 0.21.5 protocol fix turned out to cover one of the two handlers that read the fields in question. A `ROUTE_RELEASED` ACK authorizes itself the same way — against the durable route stored under `topicKey` — and then writes the frame's `topic` into `assignedTopics` and subscribes the transport to it, so a same-origin script that reads the real key, the recorded previous owner and the generation off localStorage can answer a live handoff with a channel name of its own. Both point-to-point handlers now enforce `createOpaqueKey(topic) === topicKey`; `EVENT` and `REGISTRY` need no such check because neither carries a key/plaintext pair.
- The batched `PUBLISH` frame's `items` was gated on truthiness plus a length, and `publishBatch()`'s `Array.prototype.map` is the only producer. A hand-built `{ length: 2 }` threw `message.items is not iterable` out of the cluster's own `BroadcastChannel` listener; an iterable `"ab"` reached the transport as two publications whose `data` was `undefined`, sent under the receiving worker's session; and an empty batch fell through to the single-publication tail and published `undefined` once instead of nothing. A frame that carries `items` must now carry a non-empty array.
- One coverage-ledger item closed by proving the assertion behind it was inert: the recovery-exhaustion one-shot had a second "exactly one `exhausted` diagnostic" count that never reached its branch, because after a failed reopen the handlers installed on the transport belong to a superseded lifecycle. Driving the post-cap failure through the demand path an application actually takes makes the pin real — deleting the guard now fails the suite. `data-bus.ts` uncovered branch arms 13 → 12.
- `AGENTS.md` records the process lesson next to the invariants: a guard that protects a *protocol* invariant belongs to the protocol, so pinning one means enumerating every reader of the fields it constrains — which is exactly what a release of "the fix" missed.

## 0.21.5 delivered scope

- A protocol hole closed, not a coverage leg: `handleControlMessage` authorized ownership from the durable route keyed by `message.topicKey` and then used `message.topic` as the plaintext to remember, assign, and hand to the transport. Because `topicKey` is `createOpaqueKey(topic)`, a single post onto a cluster's `BroadcastChannel` — unauthenticated, same-origin, no credentials — carrying a real key next to an arbitrary topic passed the check that was keyed by the key and renamed the channel the receiving worker subscribes to. Control frames are now dropped unless the pair agrees, which conforming senders satisfy by construction.
- The same audit answered its follow-up question in the other direction and said so: `EVENT` is validated by shape only, because delivery still requires a local subscriber and the worst a forged frame buys is a publication on a topic this tab already watches — strictly inside what a same-origin script can do through the page's own bus. `AGENTS.md` records that distinction so the path is not "hardened" into breaking mixed-version peers.
- A hang contract made explicit: `createStopPromise()`'s comment claimed `performStop()` "never rejects", and the rejection arm of the teardown gate had therefore never run in any test. It can reject — its `catch` reports through `reportError()`, which runs error subscribers, which are absorbed only by writing to `console.warn` — and on that path `resolveGate()` is the only thing that ever settles `await bus.stop()`. The comment now names the chain, and the test races the stop against a watchdog so deleting the leg fails loudly in 250ms instead of as a timeout.
- The last leg of that reporting path is pinned too: with a console that has no `warn`, an unguarded log call would have raised a `TypeError` from inside the handler meant to contain a failure, escaping the dispatch loop into the transport's message callback.
- Harness diagnosability, from a CI failure that could not be diagnosed: both seeded fuzzers now report sweep depth *while* running, because the post-loop truncation log cannot fire on the one event it exists to explain (a host killing the test on its own ceiling prints only `Test timed out`). A budget or ceiling change was deliberately deferred until that heartbeat says which of the two causes it is.
- Ledger movement over the release: `data-bus.ts` uncovered branch arms 17 → 13 and uncovered functions 3 → 2, with three legs reclassified as dominated-by-enumeration rather than hunted, and one attempted construction measured, disproved, and reverted. Whole-suite branch coverage 96.41 → 96.63; 876 tests.

## 0.21.4 delivered scope

- A real defect closed rather than a coverage leg: the failure recorder rendered reasons with `String(error)`, which is not total — `Object.create(null)` has no primitive conversion, and `DataBusTransport` is a public port that may reject with any value. Reporting a failure therefore produced a second failure, and `getHealthSummary()` threw for a bus whose last failure could not be stringified, so the outage-explaining probe refused to answer during the outage.
- The observable case: a retry after a failed open whose cleanup also failed never reopened the transport, because `createStopPromise()`'s terminal `.catch(error => this.reportError(error))` ran the thrower, `pendingStop` rejected, and `start()`'s chained `.then()` — the one whose absorber `0.21.3` removed — was skipped. `describeFailure()` makes the recorder total, which is what the chained await actually needed.
- That also repairs the load-bearing step of the argument `0.21.2` and `0.21.3` used to delete two absorbers. Their enumeration of `pendingStop`'s assignment sites was correct; the conclusion that a chain ending in `.catch(error => this.reportError(error))` therefore resolves silently assumed `reportError` cannot throw. Both comments now say so, and a test drives the double-failed-open chain end to end, so those removals rest on something checked.
- The same shape was fixed in the option validators (`assertPositiveSafeInteger`, `assertPruneStrategy`, `assertHeartbeatInterval`), where `String(value)` on caller input turned a documented config complaint into a formatter `TypeError` — and, in `assertPruneStrategy`, the coercion *was* the membership test.
- A testing lesson came out of it: `toThrow(TypeError)` passes whether the validator rejects the option or the message builder throws while naming it, so the new assertions pin the message, and `FakeTransport.stopRejection` was added because `stopShouldFail` could only fail with a real `Error`.

## 0.21.3 delivered scope

- Two more dead rejection-absorbers deleted from `CrossTabDataBus`, each proven by enumerating the assignment sites of the promise it swallowed: `stopPromise` has exactly one non-null assignment (`stop()`'s hand-resolved gate, resolved from both settle arms), and every non-null `pendingStop` chain already ends in a terminal `.catch(error => this.reportError(error))`. `data-bus.ts` function coverage went 115/120 → 115/118 with no test removed.
- The module is now down to three uncovered handlers, each carrying its own written reason — one kept deliberately as the last-resort guard against an unhandled rejection in `performStop()`, the others still owing a call-site enumeration before they can be called dominated or pinned.

## 0.21.2 delivered scope

- A dead absorber deleted rather than left to show up as an uncovered function forever: `performStop()` awaited its pending transport stop through `.catch(() => undefined)`, and the proof that arm cannot run is the enumeration of `pendingStop`'s two non-null assignment sites, each chain ending in a terminal `.catch(error => this.reportError(error))`. The sibling absorb one line above stays, because `startPromise` does reject — it is the opening a failing `ready()` hands to its caller.
- Both verdicts, and the method that produced them, are now written where the next reader looks: in the source comment and as an `AGENTS.md` convention alongside the existing rule for synchronous-`catch` guards. Whole-suite coverage went 98.68 / 96.16 / 98.54 / 99.45 → 98.71 / 96.16 / 98.72 / 99.45 with no test deleted, no ceiling lowered and no behavior change.

## 0.21.1 delivered scope

- No library behavior changed; the shipped delta is the example, test and documentation surface. `pnpm build:examples` bundles `react` + `react-dom/client` out of the local install into a gitignored vendor module, replacing the `esm.sh` imports that had kept `examples/react` unloadable on a network-less CI runner — and had it running React 18 while the adapter tests run 19.
- One set of four browser cases now drives both example pages (fan-out, reactive rebind that leaves the old channel with no server subscriber, delivery after the owning tab closes, and the cleared-topic-box fallback), because the React page gained the ids, the `?topic=` override and the `__reactBus` diagnostics hook the Vue page already exposed. A failure that hits one page and not the other now localizes to the adapter rather than to the library, and the fallback leg is mutation-checked on each page.
- `docs/getting-started.md` (en + zh) states which pages the browser suite covers, and the `0.21.0` release notes' reference to a `cross-tab-worker-databus/react` export — one this package never had, the real subpath being `cross-tab-worker-databus/hooks` — is corrected in `Unreleased`, since published notes are not rewritten.

## 0.21.0 delivered scope

- The project's first deprecation cycle is closed: `subscribe("")`, `publish("")` and `publishBatch("")` throw a `TypeError` where `0.20.96` warned once per instance. The guard sits beside the option-validation asserts and runs before every other effect, so a rejected call starts no transport, registers no handler and writes no route record — and `publishBatch("", [])` is rejected ahead of the documented empty-array no-op.
- That boundary is carried by two tests rather than one. The empty-array case exists because every other empty-topic batch is still refused *by `publish()`* through the single-item delegation, so a guard sitting below the no-op returns silently and nothing else notices; each message naming the operation the caller used is pinned for the same reason.
- The React and Vue example pages gained the topic fallback the demo page already had, and the two new browser tests first recorded what its absence actually does — `TypeError: CrossTabDataBus.subscribe("")` surfacing as a `pageerror` while the Vue tab keeps rendering its previous topic, and an 错误 event-feed row on the demo page. `||` versus `??` and trim versus no-trim each die at a different arm, verified by mutation.
- `docs/getting-started.md` (en + zh) no longer overstates the browser suite's reach: only the Vue adapter page is driven in a browser, because the React page loads React itself from `esm.sh` and cannot load where CI has no network. That page's topic fallback is consequently the one path in this change checked by hand rather than by a gate.
- Coverage ceilings untouched and still met (98.68 / 96.16 / 98.54 / 99.45 against 96 / 92 / 96 / 97); the release adds one unit test to `pnpm check` and two cases to the browser job.

## 0.20.97 delivered scope

- No public surface and no observable runtime behavior changed. The shipped `src/` delta is `centrifuge.ts` only: two unreachable `typeof Worker` / `typeof SharedWorker` throws removed, and comments recording why one guard survives while another does not. Everything else is example, test, CI and documentation work.
- The Vue adapter finally runs where it ships: `examples/vue/` mounts the real `cross-tab-worker-databus/vue` composables against the local demo endpoint from the installed `vue` package (no CDN), and `e2e/adapters.spec.ts` drives it in real Chromium tabs — publish/receive across two tabs, a reactive topic change releasing the old channel server-side, and delivery surviving the owning tab's close. Before this the Vue entry had never executed outside jsdom.
- The cluster's promise *between* tabs is now fuzzed rather than hand-ordered: three buses over one storage registry and BroadcastChannel through randomized subscribe/unsubscribe/publish/hide/show/stop/start/heartbeat/dropped-frame/forged-`SUBSCRIBE` interleavings, asserting at quiescence one owner and one transport holder per live topic, no residue for a departed topic, and exactly-once fan-out. Five mutations kill those arms; three guards survive because `reconcileAssignedTopics()` repairs them, which is recorded as the reason those belong to frame-level regressions.
- Two release-gate timing failures were traced to their causes instead of retried. The coordination fuzzer's `Date.now()` budget was reading a clock the suite fakes — a leaked fake `Date` in a reused worker made the same file stop at its floor after 16.4s and burn 539s on CI — so `tests/setup.ts` now restores real timers after every test and the fuzzers budget on `performance.now()`. The hot-path performance gates moved to their own sequential step, because an absolute-millisecond ceiling only measures code on an unscheduled core.
- The credential-guard investigation ended with the guard kept: a PR proposing its deletion as unreachable was shown to be reachable through application code (`getToken()` may `stop()` the transport before throwing), so it gained a mutation-proved regression test, and the rule distinguishing that from a genuinely dominated branch is now written into `AGENTS.md` and the source.
- The CommonJS-only default-Worker failure is pinned from the built artifacts: `dist/cjs` cannot resolve a Worker URL through esbuild's `import.meta` shim, so `start()` must report the actionable "provide workerFactory explicitly" rather than `TypeError: Invalid URL` — asserted on both factories, with the ESM artifact checked in the same case to tie the failure to the module format.
- Whole-suite coverage moved from 98.62 / 96.02 / 98.54 / 99.38 to 98.68 / 96.17 / 98.54 / 99.46 without lowering any ceiling; `docs/transports.md` (en + zh) documents that a publication carrying its own string `topic` is re-addressed to it, which is how wildcard delivery names a concrete topic and why `{ "topic": … }` payloads can go nowhere.

## 0.20.96 delivered scope

- Opened the project's first deprecation cycle: an empty topic (`""`) now warns once per bus in `subscribe()`, `publish()` and `publishBatch()` instead of silently registering a channel no transport can address. Behaviour is unchanged; a future minor rejects it at that boundary, following the pre-1.0 policy — which `0.21.0` did. The contract is documented in the API reference and in the upgrading guide, in both languages.
- Closed the coverage-leg ledger with proof instead of assumption: eleven behaviors that could not fail their tests are now mutation-verified — the departing-owner handoff that deletes an unserved route rather than migrating it onto a live peer, the owner releasing its transport subscription when the last remote subscriber leaves, a cancelled durable-retention sweep staying silent, a superseded hydration snapshot being dropped instead of merged, the default platform `WebSocket` construction including subprotocols, `ready()` surfacing the recorded transport error after the recovery budget is spent, the Vue adapter containing a rejected `ready()`, a `connectTimeoutMs` of `0` or `Infinity` genuinely waiting forever, a private topic leaving no route record when its only holder hides, the trace reporter containing a throwing sink on a runtime with no `console.warn`, and an unrelated owned wildcard pattern failing to capture a batch bound for a remote topic.
- Every remaining zero-count branch in `src` is now classified as dominated, unreachable by construction, or a missing boundary check (which is what produced the deprecation above). `vue.ts` and `hooks.ts` reach 100% on all four metrics and `cluster.ts` is down to a single uncovered line.
- `AGENTS.md` records the traps that made early drafts decorative: a `ChannelHub`-sharing peer heals the state under observation, a peer started without a microtask flush is invisible, and textually duplicated guards let a non-global mutation edit the wrong copy.
- `typescript-eslint` refreshed to `8.70.1`; TypeScript stays at `6.0.3` while the lint toolchain's peer range excludes 7.x.

## 0.20.95 delivered scope

- Removed unreachable defensive branches instead of leaving them to inflate coverage: the storage writer's already-armed retry guard, the `undefined` breaks in both bounded-map eviction loops, and the Centrifuge transport's three Worker/port generation checks — the last of which could not identify which Worker fired even when reachable.
- Dropped the React adapter's lifecycle generation ref, which no React effect ordering can reach, and corrected the configuration doc that had been describing it. The Vue adapter's guard is genuinely load-bearing and stays.
- Closed a Vitest assertion hole that had voided every `reason ?? new Error(...)` fallback-message test in the IndexedDB replay suite: `rejects.toThrow('message')` also passes on a `null` or `undefined` rejection reason. `expectRejectionMessage()` now asserts the `Error` instance as well, and the convention is recorded in `AGENTS.md`.
- Six more behaviors are pinned by mutation-verified regressions — the storage-event channel's malformed-payload guard, the BroadcastChannel-less fallback wiring documented in the getting-started guide, storage-writer key enumeration, dedup sweep partial expiry, the late credential failure path, and the React hook publishing the newest bus. `environment.ts`, `storage-batch.ts`, `dedup-manager.ts` and `hooks.ts` are now at 100% coverage on all four metrics.

## 0.20.94 delivered scope

- Fixed the Vue subscription composable's permanently inert watcher on its own handler parameter, and pinned the same-target rebind guard that prevents a torn-down-and-recreated subscription when the bus and topic change in one tick.
- Made the CI unit gate survivable under runner load: a 15s ceiling for the subprocess-spawning package/compat gates and an explicit 120s budget for the seeded lifecycle fuzzer, which had reached 98% of its own limit under coverage instrumentation.
- Raised the coverage floors from advisory to enforced, keeping them a few points under the measured values instead of ten.
- Added mutation-verified regressions for nine behaviors that had no effective test, including a route-owner-cache eviction assertion that passed with the eviction loop deleted, the failed-hydration retry on the next start, the metadata-less item of an unpacked remote batch, and superseded-client status isolation.

## 0.20.93 delivered scope

- Strengthen package compatibility checks across package metadata, unconditional and fallback-array targets, and recursive nested or custom export conditions.
- Require a readable storage capability probe, degrade safely when channel construction fails, and preserve a stable in-memory tab identity when session storage is unavailable.
- Cancel failed storage retries during clear and cluster teardown, with cluster-level restart regression coverage.
- Refresh patch-level development dependencies and complete the full release, browser, packaging, compatibility, and security gates.

## 0.20.92 frozen scope

The current line continues lifecycle error-path verification around predecessor reopen settlement, queued-start readiness, and stop-promise cleanup. Sixteen fixes have now landed. First, the shared stop gate is installed before the synchronous teardown prelude, so a `stop()` re-entered from the synchronous STOP lifecycle trace event shares the one teardown instead of running `transport.stop()` twice. Second, lifecycle ownership and `startPromise` are installed before the synchronous START trace: if a trace or status callback re-enters `stop()`, the outer `start()` immediately stops later timer, cluster, and topic setup; the epoch guard abandons the old opening before `transport.start()`. Third, the same ownership-before-callback ordering now applies to `reopenTransport()`'s synchronous CONNECTING status notification, so a stop from that callback cancels recovery instead of letting it open a replacement transport after teardown. Fourth, a stop from the synchronous RESUME lifecycle trace now invalidates both explicit and native pageshow resumes; `WorkerClusterRuntime` uses a lifecycle generation so the outer pageshow handler cannot reactivate a cluster already stopped or paused by `onResume`. Previously each outer operation could settle after the nested stop and leave a stopped bus with a live connected transport or an active cluster. Fifth, transport operations already parked on the recovery gate are no longer stranded when the automatic recovery attempt they were waiting on fails: `runTransport()` now counts the parked operations, and a failed automatic attempt starts one on-demand reopen immediately when any waiter is present, so a `publish()` / `subscribe()` issued during the cooldown itself drives recovery instead of waiting for an unrelated later operation. A failed on-demand reopen still re-arms the demand flag for a later operation rather than looping on its own failure, and every waiter flushes in order once a reopen succeeds. The cluster-key isolation guarantee now has a dedicated two-runtime regression: same-topic ownership remains independent across tenants, publications do not cross the namespace boundary, and persisted keys use distinct opaque hashes without exposing the plaintext key. A sixth replay-retention fix now hands a cutoff queued during a suspend/resume cycle to a fresh cleanup when the older transaction is still unwinding, so the newest cutoff is not stranded until an unrelated future publication. A seventh fix clears `transportReady` before `reopenTransport()` emits its synchronous CONNECTING notification, so a second operation in the same tick cannot mistake the still-closing old transport for a usable connection; all operations remain parked on the opening and flush against the replacement in order. An eighth fix makes the pagehide suspension continuation epoch-aware: if the synchronous DISCONNECTED status callback invokes public `start()` as the documented resume path, the stale hide continuation is abandoned instead of stopping the replacement transport after it opens and leaving a false healthy state. A ninth fix preserves replay ordering when durable hydration is slower than live traffic: the loaded snapshot is placed ahead of publications recorded while `load()` was pending, so count pruning retains the newest live message instead of evicting it as older history. A tenth fix makes replay hydration replaceable across lifecycle boundaries: clear/clear-topic/unsubscribe/clear-before mutations are applied to an in-flight snapshot so they cannot be resurrected, a suspend/restart cancels the superseded load and starts a fresh hydration generation, and an explicit stop/start restores durable history instead of leaving the restarted rings empty. An eleventh fix closes the strict-handoff generation gap: `ROUTE_RELEASED` must exactly match the stored route generation, so an ACK from another handoff round cannot confirm the current route or release its `SUBSCRIBE` early. A twelfth fix closes the queued-restart/BFCache race: `WorkerClusterRuntime.start()` installs lifecycle listeners before checking visibility, so a restart queued behind an asynchronous stop observes a `pagehide` that arrives during cleanup and waits suspended for `pageshow` instead of reconnecting the hidden page.
A fifteenth fix preserves operations parked on that gate when an explicit `start()` supersedes the automatic timer: cancelling the timer no longer releases the gate, so if the manual open also fails those operations stay queued for the next automatic or demand-driven recovery instead of being silently dropped.
A sixteenth fix keeps a rejected teardown in both failure ledgers: `stop()` still resolves and reports through `onError`, but the recovery ledger now retains the same stop failure as the unified `lastFailure` record until an explicit `start()` resets both.
A thirteenth fix binds every inbound `CONTROL/SUBSCRIBE` to the durable route: a delayed frame from an earlier assignment round can no longer make a non-owner subscribe, and it cannot confirm a pending graceful handoff before the matching `ROUTE_RELEASED`; legitimate same-route subscriptions and normal handoff ACKs remain unchanged.
A fourteenth fix invalidates operations parked on the recovery gate when page-hide/stop cancels the recovery cycle: an immediate explicit `start()` can re-establish subscriptions on the replacement transport, but a stale waiter can no longer replay afterward and race that restart with a duplicate subscription.


## 0.20.91 delivered scope

The reliability line continues with error-path coverage and release-gate maintenance. IndexedDB replay cleanup now has regressions for transaction-level errors on `clear()`, `clearTopic()`, and `clearBefore()`, including connection invalidation/recovery and fallback rejections when the browser exposes no transaction error object. The WebSocket transport now best-effort closes a socket after connection invalidation so automatic recovery cannot orphan a dead connection; the published-consumer gate normal path was audited with no fixed wait or redundant registry round-trip found. Centrifuge token-bridge providers are now bound to the lifecycle of the client that created them, so a replaced client cannot route a late credential request into a new session. Subscription-level callbacks and publish rejections from a replaced client are also pinned not to mutate or report into its replacement.
The DataBus lifecycle audit now also pins failed-reopen stop-gate reuse, late rejection isolation for a superseded initial open, generation isolation for late message/status/error callbacks from a retired transport, and the readiness/recovery contract (`stop()`-then-`pageshow` must not restart background work, automatic-recovery failure must surface through `ready()`, a canceled queued start must not satisfy a replacement restart, a queued restart suspended before usable must reject `ready()`, and a stale recovery timer must not reopen the transport). The audit also surfaced and fixed a real timer leak: `WorkerClusterRuntime.pause()` no longer schedules a deferred `channel.close()` when there is no channel. Mutation checks prove each regression fails when its lifecycle guard is removed. This phase additionally pins failed-open stop-gate reuse, page-hide stop-rejection recovery, replay-handler dispatch isolation, and in-flight recovery reopen reuse, with mutation coverage for the reopen guard.

The queued transport-operation audit now pins that a `subscribe()` parked behind the initial open reports its rejection through `onError` exactly once and does not escape as an unhandled rejection, while the still-opening transport is never touched before the start gate opens.
The DataBus lifecycle audit now also pins rejection ownership when an in-flight initial `transport.start()` is superseded by `stop()` and rejects while teardown is waiting: the abandoned `start()` call observes its own failure, `stop()` still resolves, the transport is closed exactly once, and the stale rejection never enters the new lifecycle's error ledger.
The cross-tab `EVENT` boundary now rejects publication payloads that are not objects with a string `topic`, so one malformed same-origin frame cannot throw from the BroadcastChannel listener and break later delivery. Unknown event types remain forward-compatible, legacy payloads inherit frame-level `originTabId`, and payload-level attribution takes precedence; both behaviors are pinned by regressions.

## 0.20.90 delivered scope

The line hardens the release pipeline uncovered by the 0.20.89 tag run and aligns the documented delivery semantics with the implementation.

- Release-gate propagation budget: the blocking published-consumer verification waited 48 x 7.5 s (6 min) instead of 24 x 5 s (2 min). The 0.20.89 tag run published successfully and then still failed the gate because `npm pack` returned `ETARGET` for the whole old budget; a genuinely missing package still exhausts the budget. (Superseded by 0.21.31, which sizes the ceiling from two measured lags.)
- Delivery semantics: the API, architecture, and capabilities docs now consistently state the bounded local fan-out guarantee and the lack of end-to-end at-least-once or exactly-once delivery; the Chinese API reference documents the opt-in `messageId` deduplication window.
- Release performance evidence: the benchmark trend docs were refreshed from 23 archived reports; the latest two-run comparison stayed inside the 50% ceiling, with per-message publish latency improving in both worker modes.

## 0.20.89 delivered scope

The line continues the async-callback isolation audit: every fix below binds a callback, queued microtask, or promise continuation to the lifecycle generation that created it, so a superseded session cannot write into its replacement.

- Async teardown and restart boundaries: a settled `stop()` gate can no longer swallow a later teardown (`stop → start → stop` now ends stopped), and `getHealthSummary()` reports `state: 'stopped'` for a stopping bus instead of contradicting the `publish()` / `subscribe()` / `ready()` rejections it is already issuing.
- Replay persistence isolation: microtask-queued batch flushes and a queued retention cleanup are discarded once `suspend()` / `stop()` supersedes their generation, so stopped-session history cannot be appended to the durable store.
- Durable hydration cancellation: a `load()` that resolves after `suspend()` or `stop()` can no longer append into buffers teardown has already cleared, and is reported as a lifecycle cancellation rather than a persistence failure.
- Trace session isolation: a stopped trace reporter stays inert — queued `asyncSink` events from the old session are dropped and the stopped flag is cleared by an explicit restart so its lifecycle `start` is emitted again.
- Transport and Worker callback isolation: Centrifuge credential-provider results are bound to the exact Worker/port/session that requested them, async `CentrifugeSession` client/subscription callbacks are ignored after `STOP` or reinit, and a `Blob` binary frame from a replaced WebSocket connection can no longer be dispatched as if it belonged to the new one.
- Regression safety net: the seeded lifecycle fuzzer now covers 1_500 interleavings and asserts that a sequence whose last explicit intent was `stop()` settles in `state: 'stopped'` with no live transport.

## 0.20.88 delivered scope

- Startup-failure recovery is now re-entrant. A transport that reports `error` synchronously while its initial `openTransport()` is still settling can be retried from either the `onStatus('error')` or `onError` callback; the failed open finishes cleanup first, the retry starts a fresh lifecycle, and the stale rejection cannot repopulate the reset failure ledger.
- Repeated BFCache `pagehide`/`pageshow` cycles during an in-flight initial open no longer strand the bus in a permanently suspended state. Suspend reuses the existing stop gate only when it still represents the current lifecycle, otherwise it installs a fresh serial stop so the next resume actually reopens the transport.
- Explicit `start()` is now a complete resume path after BFCache suspension: it restores cross-tab coordination as well as the transport, and restarts trace metrics, dedup expiry, and replay retention work that `pagehide` had paused.

## 0.20.87 delivered scope

- Transport recovery/readiness hardening: the native WebSocket backend now honors the `DataBusTransport.start()` contract (resolves only after `open`, rejects on a failed handshake or `connectTimeoutMs`), automatic recovery actually creates a replacement socket after a failure, and `getHealthSummary()` follows the live transport status instead of the `transportReady` diagnostic flag.
- No operation is written to a connection that is gone. A recovery gate parks `subscribe()` / `publish()` through automatic and on-demand reopens (including an automatic attempt that failed but left the budget open), and a clean `disconnected` after a real connection now demands exactly one on-demand reopen instead of being handed to a closed socket — while a worker-style backend that reports the connection asynchronously keeps its pre-connect window unreopened.
- Lifecycle/`ready()` boundary fixes: `ready()` rejects while the tab is BFCache-suspended, `stop()` resolves even when the transport's own `stop()` rejects or throws, a failed open is stamped once across both recovery ledgers, runtime transport errors land in the recovery ledger, and superseded asynchronous opens can no longer tear down a newer suspend/resume transition.
- Adapter and toolchain: React/Vue `useCrossTabHealth` apply `intervalMs` changes without recreating the bus, and `vitest` and its coverage-v8 provider moved to the 5.0.1 patch.

## 0.20.86 delivered scope

- Lifecycle hardening across explicit stop/start boundaries: queued restarts are serialized with in-flight stops, canceled by a newer stop, and observable through `ready()`; superseded asynchronous opens cannot tear down newer suspend/resume transitions; stop-time `subscribe()` and non-empty `publish()`/`publishBatch()` calls now report through `onError` instead of mutating teardown state or being silently dropped.
- Explicit `start()` now performs the documented manual recovery after automatic recovery exhaustion, while preserving cluster state, subscriptions, and replay history.
- IndexedDB replay persistence settles all mutations on transaction abort (including connection-loss aborts) so the serialized queue cannot remain blocked, and replay age pruning now uses one shared, position-independent policy for in-memory and persisted history.
- The configuration reference documents the full replay/dedup public option surface in both languages, with declaration-derived documentation guards; seeded property invariants cover active-worker selection and rebalance targets.

## 0.20.85 delivered scope

- A seeded property suite (`tests/property.test.ts`) for the pure hot-path helpers and the stateful managers: finiteness/totality, order-independent selection, cycle-safe sizing, publication topic/metadata validity, `serializeError` cloneability, and dedup/replay bounds under long random operation sequences.
- `effectiveWorkerLoad` is total against a corrupt stored base load — a non-finite value (JSON `1e999` → `Infinity`) can no longer leak into owner selection and re-introduce array-order dependence.
- `approximatePayloadBytes` is depth-bounded, so a cyclic payload (structured clone preserves cycles) can no longer overflow the stack in the replay-buffer footprint or the adaptive-load sampler.
- `serializeError` always produces a structured-cloneable result; a non-cloneable context (function/symbol) is dropped instead of making the error report itself throw `DataCloneError`.
- Replay history is bounded when `pruneStrategy: 'age'` is set without a `retentionMs`: the count cap now applies in both the in-memory ring and the IndexedDB record.

## 0.20.84 delivered scope

- Release/CI gates are enforced instead of advisory: `pnpm test:coverage`, `pnpm verify:compat`, and `pnpm verify:pack` run in the CI verify job, the Release workflow re-runs lint + compat + pack before publishing, and both checkouts fetch full history and tags so the compat baseline resolves.
- Coordination recovery hardening: a lost handoff ACK, a crashed owner, or the previous owner's departure now recovers through a worker-TTL-gated re-election with a single writer and projected-load spreading, and each route acknowledgment / migration / recovery is observable as a bounded `reliability` trace event.
- Three real correctness fixes: the Vue `useCrossTabDataBus` unmount leak (a pending start could create a bus with no owner), the adaptive dedup TTL not taking effect on the hot path, and `effectiveWorkerLoad` leaking a non-finite score from a corrupt stored load back into owner selection.
- Product-demo observability: the event feed renders reliability / subscription / coordination trace events, chaos toggles exercise the dropped-ACK and crash recovery paths in a real browser, and the config panel shows the active chaos mode.
- Coverage and toolchain: direct `ReplayManager` / `DedupManager` suites, transport error-isolation and partial-metadata coverage, vitest 5 (benchmark API migrated) and the eslint 10 lint config, with TypeScript 7 deferred until typescript-eslint supports it.

## 0.20.83 delivered scope

- Adapter edge-case coverage for the health hook, archived browser benchmarks with a comparison script, and a README feature list aligned with current capabilities.
- A large internal cleanup: every runtime string literal centralized in `utils/constants.ts` with literal-derived types, and replay/dedup split out of `CrossTabDataBus` into self-contained `ReplayManager` / `DedupManager` classes.
- The demo's "批量 10" publishBatch button with `/debug/wsstats` frame counting and a single-frame E2E, `asyncSink: true` delivery-semantics documentation, and a release checklist aligned with the blocking published-consumer gate.

## 0.20.82 delivered scope

- A 20 s default E2E assertion ceiling, structured-clone rejection coverage, and shared-mode session lifecycle verified end to end through the examples server's connection-count endpoint.

## 0.20.81 delivered scope

- The browser benchmark gained the data-bus hot-path matrix, health summaries are asserted end to end in E2E, and the storage-event channel plus transport batching joined the API docs and capabilities matrix.

## 0.20.80 delivered scope

- E2E reliability governance: failure traces/videos with longer retention, converge-before-publish patterns for reload tests, a staggered burst pattern within documented guarantees, and the loss-and-recovery matrix in the architecture docs.

## 0.20.79 delivered scope

- Published-consumer verification became a blocking release gate, and the lost-handoff-ACK recovery chain (TTL cleanup + resume re-election) is pinned by a regression.

## 0.20.78 delivered scope

- E2E now asserts the real transport backend per tab, the deferred-close handoff invariant is pinned by a regression test and documented, and the getting-started guide covers health summaries and the coordination fallback.

## 0.20.77 delivered scope

- Fixed a silent local-session degradation for factory-less consumers (bundled Workers are now actually used), added default-backend and channel loss-recovery coverage, and surfaced coordination-channel diagnostics plus the fallback toggle in the demo.

## 0.20.76 delivered scope

- Opt-in storage-event coordination fallback for BroadcastChannel-less environments, with an owner-election integration test over the fallback channel and updated degradation documentation and capabilities matrix.

## 0.20.75 delivered scope

- Hot-path performance gates joined the unit suite, and IndexedDB replay persistence gained scripted fault-injection coverage for its invalidate-and-recover error paths. The Release workflow's published-consumer verification was audited and confirmed complete.

## 0.20.74 delivered scope

- Optional `DataBusTransport.publishBatch` with a one-frame WebSocket implementation, demo-server support, and per-item fallback; `useCrossTabHealth` bindings for React and Vue; health verdict now honors the live transport status.

## 0.20.73 delivered scope

- IndexedDB replay persistence is now covered by unit tests (via `fake-indexeddb`) across pruning strategies, batch grouping, mutation serialization, cleanup semantics, and transient open-failure recovery.
- Real-browser E2E now covers concurrent multi-publisher bursts and full connection re-apply; the architecture docs gained a stability-invariants reference (English and Chinese).

## 0.20.72 delivered scope

- Expanded the benchmark matrix across publish batching, wildcard routing, deduplication, replay pruning, bulk persistence, and asynchronous trace sinks.
- Long-session stability hardening: regression coverage for handoff ACK generation validation, repeated BFCache round-trips, recovery exhaustion reset, storage write backoff recovery, and replay persistence cleanup races; fixed an inverted stale-ACK generation check and a batch-flush resurrection race in replay cleanup.
- Production capabilities: `getHealthSummary()` readiness verdict, `getPersistenceStats()`, transport status/suspended granularity in diagnostics, and a build-time injected SDK version.

## 0.20.71 delivered scope

- Added optional `appendBatch` replay persistence and IndexedDB transaction coalescing for publication bursts.

## 0.20.70 delivered scope

- Added SDK version and transport/backend identity to the unified diagnostics snapshot.

## 0.20.69 delivered scope

- Added peer protocol capability discovery to cluster snapshots and diagnostics. Current runtimes advertise protocol version 1; legacy peers remain visible as `null`.

## 0.20.68 delivered scope

- Added protocol version metadata and compatibility behavior for mixed-version cluster peers.

## 0.20.67 delivered scope

- Added bounded unknown protocol message diagnostics on `WorkerClusterRuntime` and `CrossTabDataBus.getDiagnostics()`, including count and last message type while preserving safe ignore behavior.

## 0.20.66 delivered scope

- Extended IndexedDB replay persistence with optional `pruneStrategy` (`count`, `age`, `both`) and `retentionMs`, applying the same trimming semantics as in-memory replay.

## 0.20.65 delivered scope

- Added opt-in adaptive dedup TTL sampling with bounded min/max controls and diagnostics exposure. Added replay `pruneStrategy` (`count`, `age`, `both`) for memory history trimming while preserving legacy defaults.

## 0.20.64 delivered scope

- Added opt-in `asyncSink` trace mode, batching sink delivery onto a microtask while preserving event order and sink error isolation (339 unit tests).

## 0.20.63 delivered scope

- Added optional `onUnknownMessage` handling so older runtimes safely ignore future cluster message variants without throwing, with regression coverage (338 unit tests).

## 0.20.62 delivered scope

- Added `CrossTabDataBus.getDiagnostics()` combining lifecycle status, transport readiness, recovery history, dedup counters, replay buffer usage, and cluster snapshot into one health-oriented view (337 unit tests).

## 0.20.61 delivered scope

- Added `originTabId?: string` to every `DataBusMessage` and to the cluster `EVENT` wire frame so cross-tab replay history is attributed to the tab that produced it.
- `WorkerClusterRuntime.broadcastEvent()` now defaults `originTabId` to the producing runtime's `tabId`, and `CrossTabDataBus.handleTransportMessage` stamps `originTabId = cluster.tabId` before broadcasting so neighbors and IndexedDB-replayed late subscribers observe the same attribution.
- `onEvent` handler signature now includes a fourth `originTabId?: string` argument; existing call sites use `toMatchObject` so the extra argument does not break strict equality.
- New unit tests under `CrossTabDataBus cross-tab replay consistency contract` cover the producing-tab stamp, local-handler parity, post-write late join with replay, and local-origin replay path (336 unit tests, 11 e2e tests).

## 0.20.60 delivered scope

- Added `publishBatch(topic, items)` to `CrossTabDataBus` and `WorkerClusterRuntime` so callers can pack many items into a single BroadcastChannel postMessage. Per-item `messageId` / `timestamp` survive the wire frame, dedup / replay / ordering apply per item in source order. Empty batch is a no-op; single-item batch delegates to `publish()`. Bench case `publishBatch / 1000 messages / 10 per call` gives an upper-bound reference for the burst path (332 unit tests).

## 0.20.59 delivered scope

- Extended `CrossTabDataBus.getRecoveryStats()` with `generation` and `lastSuccessAt`, exposing the lifetime transport-open history for diagnostics.

## 0.20.58 delivered scope

- Bounded the publish route-owner cache with a configurable LRU cap (default 256) and surfaced size/max/hits/misses diagnostics on `WorkerClusterRuntime.getSnapshot()`.
- Fixed a remote-owner publish correctness bug where `wildcardPublishCache`'s `null` entry short-circuited the route-owner lookup; topics with no local wildcard subscription now correctly forward to the remote owner.
- Added unit tests for LRU eviction, TTL-based cache invalidation, owner migration, and remote-owner cache hits (319 → 321 unit tests).

## 0.20.57 delivered scope

- Added warm/cold route-cache publish benchmarks to make owner-routing performance measurable.

## 0.20.56 delivered scope

- Added generation-checked route-owner caching for publish routing and cleared it across lifecycle teardown.

## 0.20.55 delivered scope

- Added a lifecycle-safe wildcard publish decision cache; benchmark variance remains under investigation before claiming a throughput win.

## 0.20.53 delivered scope

- Extended recovery diagnostics with a safe serializable `errorMessage` summary.

## 0.20.52 delivered scope

- Extended `getRecoveryStats()` with `hasError`, making the currently retained transport error observable.

## 0.20.51 delivered scope

- Added a public recovery-state snapshot API via `getRecoveryStats()`.

- Added owner-handoff unsubscribe coverage proving a handed-off route is not recreated after the surviving tab unsubscribes.

- Added unsubscribe-before-reconnect coverage proving removed topics are not replayed after lifecycle recovery.

- Added multi-topic recovery coverage proving every topic is restored exactly once after reconnect.

- Added extended reconnect flapping coverage proving replay stays bounded and duplicate-free.

- Added repeated worker capability-probe coverage proving auto backend selection remains deterministic across repeated checks.

## 0.20.45 delivered scope

- Added repeated WebSocket error/restart coverage proving only the newest connection remains active.

## 0.20.44 delivered scope

- Added a lifecycle contract regression proving stale WebSocket close/error callbacks cannot affect a restarted session.

## 0.20.43 delivered scope

- Added repeated WebSocket stop/start cleanup coverage proving subscriptions and stale callbacks are cleared across lifecycle cycles.

## 0.20.42 delivered scope

- Added repeated Dedicated Worker stop/start cleanup coverage proving STOP boundaries detach stale worker delivery across lifecycle cycles.

## 0.20.41 delivered scope

- Added repeated SharedWorker stop/start resource-soak coverage proving listeners and heartbeat timers are released after every cycle.

## 0.20.40 delivered scope

- Added auto worker-mode repeated failure and recovery coverage verifying SharedWorker preference remains stable and stale ports cannot deliver publications after successive reopen cycles.

## 0.20.39 delivered scope

- Added repeated Dedicated Worker failure and recovery coverage verifying only the newest worker can deliver publications.

## 0.20.38 delivered scope

- Added repeated SharedWorker failure and recovery coverage verifying only the newest worker port can deliver publications.

## 0.20.37 delivered scope

- Added repeated WebSocket stop/start replacement coverage verifying stale callbacks from multiple superseded sockets are ignored.

## 0.20.36 delivered scope

- Added a 1,000-message publish burst regression covering ordering and storage-read avoidance on the local-owner fast path.

## 0.20.35 delivered scope

- Added publish and receive/dispatch hot-path benchmarks to establish repeatable throughput baselines alongside routing and cluster coordination measurements.

## 0.20.34 delivered scope

- Added a transport-recovery composition regression covering automatic reopen/resubscription, replay history, duplicate suppression, persistence append boundaries, and late-handler ordering.

## 0.20.33 delivered scope

- Added a tag-based release compatibility check for public exports, ESM/CJS conditions, and type metadata.

## 0.20.32 delivered scope

- Added replay/dedup combined coverage for hydration, post-recovery live delivery, duplicate suppression, persistence append boundaries, and late-handler ordering.

## 0.20.31 delivered scope

- WebSocket lifecycle and message callbacks are isolated by socket identity after replacement.
- Added stale-connection regression coverage for transport stop/start recovery.

## 0.20.30 delivered scope

- Extended IndexedDB replay persistence E2E across BFCache, stop, reload, asynchronous hydration, ordered history, and replay markers.

## 0.20.29 delivered scope

- Added exhaustive Dedicated/Shared/auto worker backend fallback coverage across all capability combinations.

## 0.20.28 delivered scope

- Expanded packed-consumer verification into a release compatibility matrix for package metadata, ESM/CJS export targets, declaration files, and all public subpaths.

## 0.20.27 delivered scope

- Added a real Chromium repeated BFCache/reload/owner-handoff soak that verifies reconnect readiness and exactly-once cross-tab delivery across consecutive lifecycle cycles.

## 0.20.26 delivered scope

- Added trace privacy, mode-isolation, sink-failure, reliability-schema, bounded-state, and lifecycle metrics-window regression coverage.
- Stopped trace reporters now remain inert until explicitly started again.

## 0.20.25 delivered scope

- Added protocol compatibility coverage for legacy and nested WebSocket/Centrifuge publication frames, unknown fields, invalid metadata, and unknown worker messages.

## 0.20.24 delivered scope

- Added a combined replay/dedup quiet-period regression covering TTL expiry, periodic sweeps, durable retention cleanup, async hydration, and timer shutdown.

## 0.20.23 delivered scope

- Added a two-tab BFCache and transport-error handoff regression covering owner takeover, resume, and duplicate-free delivery.

## 0.20.22 delivered scope

- Explicit stop/restart boundaries reset recovery attempt and exhaustion diagnostics for a fresh session.

## 0.20.21 delivered scope

- Recovery exhaustion diagnostics are deduplicated within each failure sequence and reset after success.

## 0.20.20 delivered scope

- Capped automatic recovery now emits an explicit `exhausted` diagnostic when the configured attempt limit is reached.

## 0.20.19 delivered scope

- Automatic recovery attempts can be bounded with `recovery.maxAttempts`; explicit subscription demand can still reopen a failed transport.
- Invalid attempt limits and capped recovery sequences are covered by tests.

## 0.20.18 delivered scope

- Automatic transport recovery pacing is configurable through `recovery.cooldownMs`.
- Custom cooldown validation and timer-boundary regression coverage are included.

## 0.20.17 delivered scope

- Recovery diagnostics now number consecutive reopen attempts and reset the sequence after success.
- Added multi-failure recovery regression coverage.

## 0.20.16 delivered scope

- Transport recovery reliability traces now distinguish scheduled, failed, and successful reopen attempts.
- Recovery regression coverage now spans a failed reopen followed by a successful retry.

## 0.20.15 delivered scope

- Added transport status-flapping coverage for duplicate `connected`/`disconnected`/`error` notifications and exact topic resubscription behavior.

## 0.20.14 delivered scope

- Release jobs keep publishing successful when only the post-publish consumer diagnostic fails, while preserving the exact check outcome in the step summary; local checks remain strict.

## 0.20.13 delivered scope

- Browser CI failures now retain Playwright reports and test results as workflow artifacts for post-run diagnosis.

## 0.20.12 delivered scope

- Published-consumer verification now emits package and peer-dependency link diagnostics when CI imports fail, making runner-only failures actionable.

## 0.20.11 delivered scope

- Release jobs are serialized per tag and always record npm version, tag, and commit context in the GitHub step summary, making registry or workflow failures easier to diagnose.

## 0.20.10 delivered scope

- Added repeated reconnect-cycle coverage for multi-topic subscription replay, guarding against duplicate or missing transport subscriptions during recovery.

## 0.20.9 delivered scope

- Published-package verification accepts both semver and `v`-prefixed tag inputs, keeping release-triggered checks aligned with local commands.

## 0.20.8 delivered scope

- Release verification retries npm tarball resolution during registry propagation and validates the exact tagged version after publish or skip.
- GitHub Release now runs the same ESM/CJS published-consumer check used locally, including manually published releases.

## 0.20.7 delivered scope

- Added `pnpm verify:published` to download the npm package and verify root, hooks, Vue, and Centrifuge ESM/CJS consumers in a clean temporary directory.
- Published verification accepts `PUBLISHED_VERSION` for release-specific checks and otherwise follows npm's current version.

## 0.20.6 delivered scope

- Added bilingual release checklists covering local validation, packed consumers, tagging, manual npm publication, and post-release verification.
- Documented immutable npm history and the requirement to rebuild missing historical versions from their exact git tags.

## 0.20.5 delivered scope

- Public-consumer freeze coverage now exercises root, hooks, Vue, and Centrifuge subpaths in both ESM and CommonJS builds.
- Shipped declaration files are checked for existence and key replay, deduplication, and publication metadata types.

## 0.20.4 delivered scope

- Added a real Chromium multi-tab soak scenario covering repeated fan-out, owner migration, BFCache round trips, reload recovery, and duplicate-free delivery.
- Browser lifecycle transitions are now exercised as one continuous session, catching timer and route cleanup regressions that isolated checks can miss.

## 0.20.3 delivered scope

- Added React lifecycle coverage for dynamic topic changes.
- Topic replacement verifies old subscriptions are removed before the new topic is delivered through WebSocket hook wiring.

## 0.20.2 delivered scope

- Added protocol recovery coverage proving valid WebSocket publications continue after malformed binary and text frames.
- Binary truncation, JSON parse failures, nested envelopes, and error isolation are exercised as one compatibility sequence.

## 0.20.1 delivered scope

- Added persistence mutation-sequence soak coverage spanning hydration, retry recovery, topic cleanup, subsequent append, and full cleanup.
- Serialized persistence operations remain usable after transient failures.

## 0.20.0 delivered scope

- Publication envelope compatibility is covered for legacy, nested, fallback-topic, primitive payload, metadata, and unknown-field frames.
- Empty or missing topics are rejected consistently while transport-supplied fallback channels remain supported.

## 0.19.9 delivered scope

- Added combined deduplication and replay/persistence regression coverage.
- Dedup-suppressed publications cannot pollute replay history, while TTL expiry permits the same message ID to be accepted again.

## 0.19.8 delivered scope

- IndexedDB replay adapters invalidate cached connections after transaction or request failures.
- Closed connections can recover through the existing persistence retry path without recreating the adapter.

## 0.19.7 delivered scope

- IndexedDB replay adapters discard rejected open promises so transient open failures can recover on the next operation.
- Recovery remains compatible with the existing cross-tab `versionchange` connection reset behavior.

## 0.19.6 delivered scope

- IndexedDB replay adapters recover from cross-tab `versionchange` events by reopening on the next operation.
- Stale database connections are closed instead of being reused after schema changes.

## 0.19.5 delivered scope

- React bus effects are generation-guarded across StrictMode and rapid dependency changes.
- Superseded asynchronous cleanup cannot overwrite the newest active bus.

## 0.19.4 delivered scope

- Vue bus recreation is generation-guarded across rapid reactive dependency changes.
- Stale asynchronous lifecycle completions cannot resurrect an obsolete bus instance.

## 0.19.3 delivered scope

- Added optional `dedup.sweepMs` to remove expired message IDs during quiet periods.
- Sweep timers follow DataBus lifecycle and remain disabled by default.

## 0.19.2 delivered scope

- Persistence retries are cancelled across `stop()` and pagehide suspension transitions.
- Cancelled retry waits do not trigger another adapter call or surface as persistence failures.

## 0.19.1 delivered scope

- WebSocket binary publication handling accepts browser `Blob` frames in addition to `ArrayBuffer` frames.
- Blob conversion failures remain isolated through the transport error callback.

## 0.19.0 delivered scope

- Persistence retries emit bounded, opt-in `persistence_retry` reliability events with the operation and attempt number.
- Diagnostics cover hydration, append, full/topic cleanup, and retention cleanup without exposing payloads or error bodies.
- Existing retry timing, default single-attempt behavior, adapter contracts, and final error handling remain compatible.

## 0.18.0 delivered scope

- Opt-in replay persistence retry policy with bounded attempts and exponential backoff.
- Append, hydration, manual cleanup, topic cleanup, and retention cleanup share one recovery path.
- Public retry option type is exported while persistence adapter contracts remain source-compatible.

## 0.17.0 delivered scope

- Optional periodic replay retention sweeps run without requiring a new publication.
- Sweep timers follow start/resume and pagehide/stop lifecycle boundaries.
- Fake-timer coverage protects cleanup scheduling, teardown, and invalid configuration behavior.

## 0.16.0 delivered scope

- Retention cleanup is coalesced during publication bursts and executes serialized mutations using the newest requested cutoff.
- WebSocket binary protocol boundaries now have regression coverage for truncated and invalid frames.
- Existing legacy replay, JSON metadata, and manual cleanup compatibility guarantees remain documented.

## 0.15.0 delivered scope

- Replay retention preserves legacy timestamp-less messages while pruning only explicitly timestamped records older than the cutoff.
- Trace timestamps accept an injectable `trace.now` clock, aligned with the existing dedup clock injection.
- Compatibility and lifecycle regression coverage protects replay cleanup, diagnostics, and adapter behavior.

## 0.14.0 delivered scope

- Vue subscription parity for reactive topic changes on a stable bus.
- Cross-page replay mutation ordering and lifecycle guarantees are documented and regression-tested.

## 0.13.0 delivered scope

- IndexedDB replay mutation serialization prevents concurrent append loss.
- Dedup state is reset on full stop/restart boundaries.
- Persistence failure and lifecycle regression coverage is included.

## 0.12.0 delivered scope

- Injectable deduplication TTL clock for deterministic lifecycle and expiry tests.
- Structured persistence cleanup diagnostics for append, hydration, unsubscribe, and retention failures.
- Strict-but-compatible publication metadata normalization (non-empty IDs and finite timestamps only).
- Protocol compatibility fixtures and expanded package-consumption coverage.

## 0.11.0 delivered scope

- Automatic durable replay retention through `replay.retentionMs` when the persistence adapter supports `clearBefore`.
- Deduplication accepted/suppressed counters in periodic trace metrics.
- Publication metadata compatibility coverage across WebSocket, Centrifuge, Worker boundaries, and browser E2E.
- Service Worker transport decision: remain deliberately unimplemented until a stable connection-lifetime contract exists across target browsers.

## 0.20.69 candidates

1. ~~Publish a peer capability matrix and expose SDK/backend/transport identity in diagnostics.~~ Delivered: `getDiagnostics()` carries protocol version, unknown-message stats, peer protocol versions, and transport identity; `getHealthSummary()`/`getMetrics()` now ship live trace metrics and sink state.
2. ~~Unify replay, deduplication, trace, recovery, and cluster health counters.~~ Delivered: `getDiagnostics()` + `getMetrics()` + `getHealthSummary()` cover lifecycle, recovery, dedup, replay, persistence, protocol, transport, cluster, trace metrics, and sink back-pressure in single snapshots.
3. ~~Optimize IndexedDB concurrent append and cleanup paths.~~ Delivered: adjacent `appendBatch` mutations coalesce into one transaction; clear/clearTopic/clearBefore ordering preserved.
4. ~~Add performance baselines for adaptive dedup, async trace, pruning, and long-running multi-tab workloads.~~ Delivered: bench covers load-weighting scoring, `getMetrics`, publishBatch batch-size sensitivity, adaptive dedup TTL, age-strategy replay pruning, a two-worker cross-tab fan-out, and the existing dedup/async-sink/persistence cases.

## 0.13.0 candidates

1. ~~Freeze the public export surface and transport-neutral publication envelope.~~ Delivered: the root export surface is pinned by a regression test and the tag-to-tag `verify:compat` gate, and the transport-neutral publication envelope (with legacy/nested frame compatibility) is documented and covered by protocol fixtures.
2. ~~Document at-least-once delivery and deduplication guarantees precisely.~~ Delivered: architecture/API/capability docs now distinguish at-most-once local fan-out per accepted transport publication from end-to-end delivery, document transport/server loss and redelivery, and describe bounded opt-in `messageId` dedup without claiming at-least-once or exactly-once.
3. ~~Add long-running browser soak coverage for replay retention, reconnect, BFCache, and owner migration.~~ Delivered: the real-Chromium multi-tab soak and the repeated BFCache/reload/owner-handoff scenarios exercise one continuous session across the full lifecycle.
4. ~~Publish a migration guide and deprecation policy for any pre-1.0 protocol aliases.~~ Delivered: the deprecation policy lives in the release checklist, the "Upgrading & Deprecation" guide is published in both getting-started references, and legacy protocol frames are parsed for one minor with the active version surfaced in `getDiagnostics().protocol`.

## Longer-term candidates

1. **Replay lifecycle and retention** — add explicit persistence cleanup (`clear`, `clearTopic`), make unsubscribe/replacement remove stale history, and surface persistence failures through trace and error handlers.
2. **Reliability diagnostics** — emit structured recovery/retry, owner-acknowledgment, and route-migration events with bounded metadata while keeping tracing opt-in.
3. **Publication deduplication** — design and implement an opt-in, bounded message-ID window that works across local dispatch, BroadcastChannel fan-out, WebSocket, and replay without changing the default behavior.
4. **Adapter and protocol parity** — align React/Vue lifecycle and type contracts, document binary framing and recovery semantics, and add compatibility fixtures for custom transports.
5. **Operational validation** — extend browser and package-consumption tests, add regression benchmarks for dedup/recovery/replay cleanup, and keep push CI as a release gate.
6. **TypeScript 7 toolchain migration** — blocked upstream, not here. Re-checked 2026-09-25 against the registry: `typescript-eslint`'s newest release (8.70.1) and its newest canary (8.70.2-alpha.7) both declare `typescript >=4.8.4 <6.1.0`, so installing TypeScript 7 (latest 7.0.2) breaks the lint gate before it breaks our own types — and no release that admits 7.x exists on either channel to test against. Read the `dist-tags.canary` field rather than sorting version strings: that sort puts `8.9.1-alpha.9` last, because `9` sorts after `70`, and the alpha line one actually needs is 8.70.x. Re-check when either line widens that ceiling, then migrate in an isolated branch (TS 7 still exposes a `tsc` bin, so `pnpm typecheck` itself needs no change).

## Release checklist

- Update the `[Unreleased]` section and version date.
- Run `pnpm check`, `pnpm lint`, `pnpm test:e2e`, `pnpm bench`, and `pnpm bench:browser`.
- Run ESM/CJS package-consumption smoke tests from the packed tarball.
- Tag the release and verify the GitHub Release and npm `latest` dist-tag.
