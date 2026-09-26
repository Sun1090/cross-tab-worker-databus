/**
 * Every persistent write in `src/`, enumerated — because "these two and no
 * others" is a claim about the source, and the sweep in
 * `coordination-invariants.test.ts` can only see the plane that does *not* leak.
 *
 * The library documents two opt-ins that put a topic's plaintext into a durable
 * store: `channelFallback: 'storage-event'` writes every coordination frame whole
 * into localStorage, and `replay.persistence` keys its IndexedDB object store by
 * the plaintext topic. Everything else the coordination plane persists is derived
 * from `topicKey`. That was prose until this file, and the gap it leaves is
 * specific: the sweep's fourth arm drives the BroadcastChannel-shaped hub with no
 * persistence adapter, so **both** opt-in sites are outside it by construction —
 * a *third* writer would be outside it too, and nothing in the suite would notice.
 *
 * So this is a static enumeration with two halves. (1) The set of write sites is
 * pinned to a table: adding a `setItem`/`.put`/`writeJson` call anywhere in `src/`
 * fails here, which turns a new durable writer into a deliberate act with a
 * comment attached rather than an accident. (2) The sites whose statement text
 * carries a topic are re-derived by a word test and must equal the two documented
 * opt-ins, so a new site that mentions a topic cannot be added quietly even if
 * someone updates the table — the word test and the table have to agree.
 *
 * ## The other half: what those records hold
 *
 * The second `describe` below pins the *contents* of the coordination records,
 * which is the claim `docs/configuration.md` states as a four-item list of things
 * they "never hold" (connection URL, topic names, credentials, publication data)
 * behind a list of what they do. The writers tell you where the bytes go; only a
 * reader of the written records can say what is in them, and the two opt-ins that
 * *do* put plaintext there are the reason the difference matters: the same claim,
 * asserted about the wrong half, would pass.
 *
 * What the word test is and is not: it is a *pointer*, not the judgment, and it
 * is why the two opt-ins are named in this file rather than discovered by it. A
 * writer that leaks a topic without naming one still passes it, so the table's
 * per-site reason is the other load-bearing half, and a new row is a claim a
 * reviewer reads rather than a match a regex confirms. The two halves are kept
 * because they fail in opposite directions: the enumeration cannot tell you
 * *which* unlisted site is a leak, and the word test cannot see an unlisted site
 * at all. `TOPIC_CARRIER` carries its own record of the mutant that shaped it.
 *
 * Anchors are the whitespace-collapsed call text rather than line numbers, since
 * a line number here would decay on the first edit above it — the failure this
 * repository has already paid for in `src/` comments. A reformatted statement
 * reddens this case, which is a cost worth naming: the diff shows both the old and
 * the new text, so the fix is to confirm the reformat changed nothing about what
 * is written.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CrossTabDataBus } from '../src/core/data-bus'
import { createOpaqueKey } from '../src/core/hash'
import { DEFAULT_STORAGE_PREFIX } from '../src/utils/constants'
import { ChannelHub, FakeTransport, MemoryStorage, createFakeEnvironment, flushMicrotasks } from './fakes'

/** The call shapes that put something into a store that outlives the call. */
const WRITE_PATTERNS: readonly RegExp[] = [/\.setItem\(/g, /\.put\(/g, /\bwriteJson\(/g];

/** A `function` keyword before the identifier marks a declaration, not a call. */
const DECLARATION = /\bfunction\s+$/;

/**
 * Does this statement carry a topic, by name?
 *
 * `knownTopics` is the load-bearing half, and it is there because the obvious
 * version of this test was measured failing. A first form matched a bare `topic`
 * (never `topicKey`, which is a hash) plus `message`/`data` — the exclusion being
 * what keeps the coordination plane's four hashed records off the carrier list.
 * Then a leak was admitted into the table above whose text mentions `topicKey`
 * and nothing else, because `topicKey` was the *variable* carrying the plaintext
 * into the key: the scan, the table and the assertion all agreed, and a topic
 * reached localStorage. So the test now also matches `knownTopics`, which is the
 * one map in the library that turns a hash back into a name — a write statement
 * that reads it is carrying a topic whatever its variables are called.
 *
 * The remaining blind spot, stated so nobody mistakes this for a proof: a leak
 * through a reverse map with some other name would pass, and the only thing that
 * rules that out is `knownTopics` being the only such map, which is a claim about
 * the class rather than about this regex. The enumeration half is what catches a
 * site nobody thought to name — an unlisted writer fails there whether or not
 * this test can see it.
 */
const TOPIC_CARRIER = /\bknownTopics\b|\b(topic(?!Key)|message|data)\b/;

interface WriteSite {
  file: string;
  /** Byte offset of the call, so the enumeration reads in source order. */
  index: number;
  /** The whole call, opening callee through its closing paren, whitespace collapsed. */
  statement: string;
}

const repoFile = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/** Every tracked `src/` file, from the repository's own index rather than a
 * directory walk — the same source `documentation.test.ts` uses, and for the same
 * reason: a walk reads generated output that a clean checkout does not have. */
const sourceFiles = (): string[] =>
  execFileSync('git', ['ls-files', 'src/**/*.ts'], { encoding: 'utf8' })
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.endsWith('.ts'));

/** Find every persistent write statement in `sources`, keyed by file. */
function findWriteSites(sources: ReadonlyMap<string, string>): WriteSite[] {
  const sites: WriteSite[] = [];
  for (const [file, text] of sources) {
    for (const pattern of WRITE_PATTERNS) {
      // A fresh regex per file: these carry `lastIndex`, and a shared one would
      // resume mid-file and silently skip the first match in every file after the
      // first. (The `g` flag is what makes `exec` advance at all — without it the
      // loop below never terminates, which is how this file's first draft of the
      // scanner behaved.)
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        if (DECLARATION.test(text.slice(Math.max(0, match.index - 12), match.index))) continue;
        const open = text.indexOf('(', match.index + match[0].length - 1);
        let close = open;
        let depth = 0;
        for (; close < text.length; close += 1) {
          if (text[close] === '(') depth += 1;
          else if (text[close] === ')') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        sites.push({
          file,
          index: match.index,
          statement: text.slice(match.index, close + 1).replace(/\s+/g, ' ')
        });
      }
    }
  }
  // Source order, not pattern order: the scan walks one pattern at a time, so
  // without this the table below would group every `setItem` together and the
  // diff on a new site would not read as "this line in this file".
  return sites.sort((left, right) =>
    left.file === right.file ? left.index - right.index : left.file < right.file ? -1 : 1
  );
}

const anchor = (site: WriteSite): string => `${site.file} :: ${site.statement}`;

/**
 * Every persistent write in `src/`, with what it actually stores. This is the
 * claim the gate enforces; the two `topic`-carrying rows are the documented
 * opt-ins and are the only places a topic's plaintext reaches a durable store.
 */
const WRITE_SITES: ReadonlyArray<{ site: string; stores: string; optIn?: string }> = [
  {
    site: 'src/core/cluster.ts :: writeJson(this.storage, this.routeStorageKey(topicKey), this.buildRouteRecord(topicKey, owner, handoffFromWorkerId, generation))',
    stores: 'the route record — a `topicKey`, a worker id, a generation'
  },
  {
    site: 'src/core/cluster.ts :: writeJson(this.storage, this.routeStorageKey(topicKey), { ...route, confirmedAt: this.nowMs() } satisfies WorkerRoute)',
    stores: 'the same route record with a confirmation stamp added'
  },
  {
    site: 'src/core/cluster.ts :: writeJson(this.storage, this.subscriberStorageKey(topicKey, this.tabId), { tabId: this.tabId, updatedAt: this.nowMs() } satisfies TopicSubscriberRecord)',
    stores: 'a subscriber marker — the topic is present only as `topicKey`'
  },
  {
    site: 'src/core/cluster.ts :: writeJson(this.storage, this.workerStorageKey(this.workerId), this.currentRecord)',
    stores: 'the worker record — ids, role, status, heartbeat, no topic at all'
  },
  {
    site: 'src/core/environment.ts :: .setItem(key, JSON.stringify({ senderId, seq: sequence, message }))',
    stores: 'a whole coordination frame, topic and payload included',
    optIn: "channelFallback: 'storage-event'"
  },
  {
    site: 'src/core/environment.ts :: .setItem(probeKey, \'1\')',
    stores: 'the literal `1`, to test that storage is usable at all'
  },
  {
    site: 'src/core/environment.ts :: .setItem(key, created)',
    stores: 'this tab\'s id, under a constant key'
  },
  { site: 'src/core/storage-batch.ts :: .setItem(key, value)', stores: 'whatever a caller queued — the coalescing passthrough' },
  { site: 'src/utils/storage-utils.ts :: .setItem(key, JSON.stringify(value))', stores: 'the funnel every `writeJson` caller goes through' },
  {
    site: 'src/core/replay-persistence.ts :: .put({ topic, messages: history })',
    stores: 'replay history keyed by the plaintext topic, payloads in the rows',
    optIn: 'replay.persistence'
  },
  {
    site: 'src/core/replay-persistence.ts :: .put({ topic: record.topic, messages })',
    stores: 'a rewrite of that same topic row when the cache cannot serve it',
    optIn: 'replay.persistence'
  }
];

describe('persistent storage writers', () => {
  it('finds the write sites a reader can check by hand', () => {
    // The scanner is an instrument, and an instrument that reads nothing reports
    // the same empty set as a tree with no writers. Four decisions are pinned here
    // on fabricated text rather than left to the suite's own sources: a `setItem`,
    // a `.put` and a `writeJson` are each found, a `function` declaration is not
    // counted as a call, and a `topicKey` site does not count as carrying a topic
    // while a bare `topic` one does. The last two are the pair that decides
    // whether the enumeration below means anything.
    const sources = new Map([
      [
        'probe.ts',
        [
          'function writeJson(storage: unknown, key: string, value: unknown): void {}',
          'storage.setItem(key, JSON.stringify(value));',
          'store.put({ topic, messages: history });',
          'writeJson(this.storage, this.routeStorageKey(topicKey), record);',
          'storage.setItem(other, JSON.stringify({ message }));',
          'storage.setItem(this.knownTopics.get(key) ?? key, key);',
          'const untouched = readJson(storage, key);'
        ].join('\n')
      ]
    ]);
    const sites = findWriteSites(sources);
    // In source order, which is the order the scan walks the fixture in: the
    // declaration on line 1 is skipped, and the `put` on line 3 comes before the
    // `setItem` on line 5 even though the pattern loop visits `setItem` first.
    expect(sites.map(anchor)).toEqual([
      'probe.ts :: .setItem(key, JSON.stringify(value))',
      'probe.ts :: .put({ topic, messages: history })',
      'probe.ts :: writeJson(this.storage, this.routeStorageKey(topicKey), record)',
      'probe.ts :: .setItem(other, JSON.stringify({ message }))',
      'probe.ts :: .setItem(this.knownTopics.get(key) ?? key, key)'
    ]);
    // Declaration filtered, five calls kept, and the `topicKey` site on the
    // carrier test's *negative* side while the three topic/message/map sites are
    // on its positive side.
    expect(sites.filter(site => TOPIC_CARRIER.test(site.statement)).map(anchor)).toEqual([
      'probe.ts :: .put({ topic, messages: history })',
      'probe.ts :: .setItem(other, JSON.stringify({ message }))',
      // The leg that was measured missing: the text names no topic at all, and
      // the leak travels through the hash→name map instead.
      'probe.ts :: .setItem(this.knownTopics.get(key) ?? key, key)'
    ]);
  });

  it('writes nothing durable outside the table, and no topic outside the two opt-ins', () => {
    const files = sourceFiles();
    // Floors first, so a scan that matched nothing is a failure rather than a
    // clean bill — the same defect this repository has now found in three
    // separate gates, and the reason each of them asserts a row count of its own.
    expect(files.length, 'the src/ index came back nearly empty').toBeGreaterThanOrEqual(20);
    const sources = new Map(files.map(file => [file, repoFile(file)]));
    const sites = findWriteSites(sources);
    expect(sites.length, 'no write site was found — the patterns or the index are wrong').toBeGreaterThanOrEqual(8);

    // Half one: the set is closed. A new durable writer anywhere in `src/` lands
    // here first, with its own statement in the diff.
    expect(sites.map(anchor).sort(), 'a persistent write in src/ is not in the table').toEqual(
      WRITE_SITES.map(entry => entry.site).sort()
    );
    // And every row has to say what it stores, so the table cannot be satisfied by
    // a list of anchors and silence.
    expect(WRITE_SITES.filter(entry => entry.stores.trim().length === 0)).toEqual([]);

    // Half two: the topic half, re-derived rather than restated. A site whose text
    // carries a topic must be one of the two documented opt-ins, so adding a
    // leaking row to the table is not enough — the word test has to agree, which
    // means the failure lands on the opt-in list.
    const carrying = sites.filter(site => TOPIC_CARRIER.test(site.statement)).map(anchor).sort();
    expect(carrying, 'a write site carrying a topic is not one of the two documented opt-ins').toEqual(
      WRITE_SITES.filter(entry => entry.optIn !== undefined).map(entry => entry.site).sort()
    );
    // The opt-ins are counted by *surface*, not by row: three of the sites above
    // belong to the two opt-ins (the replay store has a second `put` for the
    // rewrite it does when its cache cannot serve a read), and the assertion that
    // matters is that those rows name exactly the two documented surfaces — so a
    // table that quietly dropped a row's `optIn` marker fails here instead of
    // narrowing the set above.
    expect([...new Set(WRITE_SITES.map(entry => entry.optIn).filter(Boolean))].sort()).toEqual([
      "channelFallback: 'storage-event'",
      'replay.persistence'
    ]);
  });
});

/** The record interfaces, read from `src/core/types.ts` rather than restated here,
 * so the comparison is between what the code declares and what it writes, not
 * between two copies of a list. Optional members are reported separately: they
 * are the ones a scenario has to provoke (`confirmedAt` needs an owner to
 * acknowledge a handoff), and folding them in would make the test assert that a
 * hard-to-reach field is always present. */
function recordFields(interfaceName: string): { required: string[]; optional: string[] } {
  const types = repoFile('src/core/types.ts');
  const start = types.indexOf(`export interface ${interfaceName} `);
  expect(start, `interface ${interfaceName} not found in src/core/types.ts`).toBeGreaterThanOrEqual(0);
  // The block runs to the first line that closes the interface at column 0.
  const block = types.slice(start).split('\n').slice(1).join('\n');
  const end = block.search(/^}/m);
  const body = end === -1 ? block : block.slice(0, end);
  const required: string[] = [];
  const optional: string[] = [];
  for (const match of body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)(\??):/gm)) {
    (match[2] === '?' ? optional : required).push(match[1]!);
  }
  return { required, optional };
}

/** Every persisted record under `prefix`, parsed. */
function readRecords(storage: MemoryStorage, prefix: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const [key, value] of storage.entries()) {
    if (!key.includes(prefix)) continue;
    records.push(JSON.parse(value) as Record<string, unknown>);
  }
  return records;
}

describe('coordination record contents', () => {
  /** One bus, one fake environment, a full lifecycle: subscribe, publish, tick,
   * hide and show, so every writer in `cluster.ts` has run at least once.
   *
   * Async on purpose, and for a reason this repository has already paid for twice:
   * every record write goes through `BatchingStorageWriter`, which coalesces
   * same-task writes and flushes in a microtask. A synchronous lifecycle reads a
   * registry nothing has been flushed into yet, and the "no record was written"
   * floor below is what catches that — it is the difference between a red case and
   * a case that passes for the wrong reason. */
  async function lifecycle(): Promise<{ whileRunning: Array<[string, string]>; afterStop: Array<[string, string]> }> {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'record-contents' });
    const bus = new CrossTabDataBus<object, { secret: string }>({
      // The two strings the shipped list says these records never hold. A URL and
      // a token are what an application actually puts in here, so the premise is
      // the real shape rather than a marker chosen to be easy to find.
      clusterKey: 'record-contents',
      environment: env.environment,
      initialConfig: { url: 'wss://example.invalid/connection', token: 'super-secret-credential' },
      transport: new FakeTransport<{ secret: string }>(),
      replay: { maxPerTopic: 4 }
    });
    bus.start({});
    await flushMicrotasks();
    bus.subscribe('orders', () => undefined);
    await flushMicrotasks();
    bus.publish('orders', { secret: 'payload-plaintext' });
    await flushMicrotasks();
    now += 3_000;
    env.runIntervals();
    await flushMicrotasks();
    env.pageHide();
    await flushMicrotasks();
    env.pageShow();
    await flushMicrotasks();
    // Snapshot *before* `stop()`, because `stop()` is a teardown and a clean one:
    // measured on this tree, it leaves the registry holding none of the worker's
    // own records, so a snapshot taken afterwards reads as an empty boundary and
    // the case would pass for the wrong reason. The post-stop state is returned
    // too, and asserted empty below — as a control on the lifecycle rather than as
    // a second claim, since a teardown that stopped cleaning up would otherwise
    // leave these cases reading a registry of leftovers.
    const whileRunning = storage.entries();
    await bus.stop();
    await flushMicrotasks();
    return { whileRunning, afterStop: storage.entries() };
  }

  const PREFIX = `${DEFAULT_STORAGE_PREFIX}:${createOpaqueKey('record-contents')}`;

  it('writes no field outside the interface each record declares', async () => {
    // Both directions, because each catches a different mistake. A field that is
    // written but not declared is the security-relevant one: it is invisible to
    // every type-level reading of the record, and it is exactly how a `topic` or
    // a URL would get into a record that still "only holds" identity. A declared
    // field that is never written is the other: a record silently narrower than
    // its own type, which is how `confirmedAt` and `throughput` go missing.
    const { whileRunning, afterStop } = await lifecycle();
    const storage = new MemoryStorage();
    for (const [key, value] of whileRunning) storage.setItem(key, value);
    expect(afterStop, 'the teardown left records behind, so the snapshot above is not what a running tab holds').toEqual([]);
    for (const [prefix, interfaceName] of [
      [':worker:', 'WorkerRecord'],
      [':route:', 'WorkerRoute'],
      [':subscriber:', 'TopicSubscriberRecord']
    ] as const) {
      const records = readRecords(storage, `${PREFIX}${prefix}`);
      expect(records.length, `no ${interfaceName} was written — the lifecycle stopped short`).toBeGreaterThan(0);
      const { required, optional } = recordFields(interfaceName);
      expect(required.length, `${interfaceName} declared no required field`).toBeGreaterThan(0);
      const declared = new Set([...required, ...optional]);
      for (const record of records) {
        const undeclared = Object.keys(record).filter(field => !declared.has(field));
        expect(
          undeclared,
          `a ${interfaceName} carries field(s) its interface does not declare`
        ).toEqual([]);
      }
      // The required fields must all be present in at least one written record,
      // which also proves the parse above produced real objects.
      const observed = new Set(records.flatMap(record => Object.keys(record)));
      expect(
        required.filter(field => !observed.has(field)),
        `a required ${interfaceName} field was never written`
      ).toEqual([]);
    }
  });

  it('never writes the connection URL, a credential or a publication payload', async () => {
    // The other three items of the shipped four-item list. The topic item is the
    // one the coordination sweep fuzzes after every operation
    // (`tests/coordination-invariants.test.ts`); this is its deterministic
    // counterpart for the two values that only exist once a transport config
    // carries them, and it is the only place in the suite where a URL and a token
    // are handed to a bus that then runs a lifecycle and has its storage read.
    const { whileRunning } = await lifecycle();
    const seen = whileRunning;
    // A floor, so a lifecycle that persisted nothing reports "clean" below
    // rather than passing for the right reason.
    expect(seen.length, 'the lifecycle wrote nothing to storage').toBeGreaterThan(0);
    for (const [key, value] of seen) {
      expect(key, 'a coordination key carries the connection URL').not.toContain('example.invalid');
      expect(key, 'a coordination key carries a credential').not.toContain('super-secret-credential');
      expect(value, 'a coordination record carries the connection URL').not.toContain('example.invalid');
      expect(value, 'a coordination record carries a credential').not.toContain('super-secret-credential');
      expect(value, 'a coordination record carries publication data').not.toContain('payload-plaintext');
    }
  });
});
