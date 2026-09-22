/**
 * Seeded multi-tab coordination invariants.
 *
 * `lifecycle-invariants.test.ts` fuzzes one bus and proves it never
 * contradicts itself. The bug class left open there lives *between* tabs: two
 * transports subscribing the same topic (the backend then delivers twice, so
 * every handler in every tab fires twice) or none subscribing it (the topic
 * goes silent while every tab still reports healthy). Both break the cluster's
 * core promise — one owner per live topic, and that owner alone holds the
 * transport subscription — and every existing multi-tab scenario picks its own
 * ordering by hand, which is how an ordering-dependent hole survives review.
 *
 * This harness drives randomized interleavings through three buses sharing one
 * storage registry and one BroadcastChannel — subscribes, unsubscribes,
 * publications, hide/show, stop/start, heartbeats, dropped control frames and
 * *forged* `CONTROL/SUBSCRIBE` frames — lets them quiesce, then compares the
 * end state against the subscriptions the test itself installed:
 *
 *   1. a topic with at least one live local subscriber has exactly one owner,
 *      exactly one transport holding it, and those are the same tab;
 *   2. a topic nobody subscribes any more leaves no owner, no transport
 *      subscription and no route record, once the worker TTL has passed a
 *      dozen times over;
 *   3. a publication the owner's transport delivers reaches every live
 *      subscriber exactly once, and nobody else.
 *
 * What each arm was proved against — each mutation applied alone, `src/`
 * restored and verified clean afterwards: dropping the transport unsubscribe
 * kills arm 2 (a departed topic keeps its holder), dropping the transport
 * subscribe kills arm 1 (no holder at all), dispatching a topic's handlers
 * twice kills arm 3, never pruning orphan routes kills arm 2, and emptying
 * `reconcileAssignedTopics`' sweep kills arms 1 and 2 together.
 *
 * Three guards deliberately survive it: `handleControlMessage`'s "only the
 * worker the durable route names may accept a SUBSCRIBE", the route write in
 * `subscribe()`, and `subscribe()`'s ownership return value. Removing any of
 * them corrupts ownership *transiently*, and `reconcileAssignedTopics` — which
 * drops every assignment whose route no longer names this worker — repairs it
 * before quiescence, with or without the forged frames. That is why those three
 * belong to the frame-level regressions in `stability.test.ts` and not here:
 * this harness asserts what the cluster converges to, and the sweep that makes
 * convergence happen is the one thing it does catch.
 *
 * Concrete topics only: wildcard patterns have their own mutation-verified
 * pins, and folding them in here would replace a checkable expectation with a
 * hand-simulated matcher. Seeds are fixed, so a failure is replayable, and the
 * sweep stops on a wall-clock budget with an asserted floor — see the constants
 * below.
 */
import { describe, expect, it, vi } from 'vitest';
import { CrossTabDataBus } from '../src/core/data-bus';
import { createOpaqueKey } from '../src/core/hash';
import type { WorkerClusterMessage } from '../src/core/types';
import { CLUSTER_MESSAGE_TYPE, CONTROL_ACTION, DEFAULT_STORAGE_PREFIX, TAB_VISIBILITY } from '../src/utils/constants';
import {
  ChannelHub,
  FakeTransport,
  MemoryStorage,
  createFakeEnvironment,
  flushMicrotasks,
  mulberry32,
  realNowMs
} from './fakes';

const TOPICS = ['alpha', 'beta', 'gamma'];

const pick = <T,>(random: () => number, values: readonly T[]): T =>
  values[Math.floor(random() * values.length)] as T;

interface Tab {
  label: string;
  bus: CrossTabDataBus<object, number>;
  transport: FakeTransport<number>;
  env: ReturnType<typeof createFakeEnvironment>;
  /** Local handlers this test installed, mapped to their unsubscribe closure. */
  handlers: Map<string, () => void>;
  /** Deliveries counted per topic, so a duplicate dispatch is visible. */
  received: Map<string, number>;
  intent: 'running' | 'suspended' | 'stopped';
}

function createTab(label: string, storage: MemoryStorage, hub: ChannelHub, clock: { now: number }): Tab {
  const env = createFakeEnvironment({ storage, hub, now: () => clock.now, randomId: `coord-${label}` });
  const transport = new FakeTransport<number>();
  const bus = new CrossTabDataBus<object, number>({
    clusterKey: 'coordination-invariants',
    environment: env.environment,
    initialConfig: {},
    transport,
    heartbeatIntervalMs: 3_000,
    workerTtlMs: 10_000
  });
  bus.onError(() => undefined);
  return { label, bus, transport, env, handlers: new Map(), received: new Map(), intent: 'running' };
}

function subscribe(tab: Tab, topic: string): void {
  if (tab.handlers.has(topic)) return;
  const release = tab.bus.subscribe(topic, () => {
    tab.received.set(topic, (tab.received.get(topic) ?? 0) + 1);
  });
  tab.handlers.set(topic, release);
}

function unsubscribe(tab: Tab, topic: string): void {
  const release = tab.handlers.get(topic);
  if (!release) return;
  tab.handlers.delete(topic);
  release();
}

function hide(tab: Tab): void {
  tab.env.setVisibility(TAB_VISIBILITY.HIDDEN);
  tab.env.pageHide();
  if (tab.intent !== 'stopped') tab.intent = 'suspended';
}

function show(tab: Tab): void {
  tab.env.setVisibility(TAB_VISIBILITY.VISIBLE);
  tab.env.pageShow();
  if (tab.intent === 'suspended') tab.intent = 'running';
}

async function settle(tabs: Tab[], clock: { now: number }, rounds: number): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    clock.now += 3_000;
    await vi.advanceTimersByTimeAsync(3_000);
    for (const tab of tabs) tab.env.runIntervals();
    await flushMicrotasks();
  }
}

/** Post a CONTROL/SUBSCRIBE straight onto the cluster channel, as a delayed
 * frame from an earlier assignment round would. Real tabs only ever send one
 * to the worker the durable route names, so without forging the frame the
 * "authorize by route, not by frame arrival" rule has no state to violate —
 * every in-process send is already addressed to the right worker.
 * `protocolVersion` is omitted deliberately: that is what a legacy peer sends,
 * and the receiver treats it as version 1. */
function forgeSubscribe(hub: ChannelHub, targetWorkerId: string, topic: string): void {
  const channel = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('coordination-invariants')}`);
  channel.postMessage({
    type: CLUSTER_MESSAGE_TYPE.CONTROL,
    sourceWorkerId: 'forged-peer',
    targetWorkerId,
    action: CONTROL_ACTION.SUBSCRIBE,
    topic,
    topicKey: createOpaqueKey(topic)
  } as WorkerClusterMessage);
  channel.close();
}

describe('cross-tab coordination invariants', () => {
  // Depth is bounded by wall clock, not by seed count, because the two clocks
  // this sweep runs on differ by an order of magnitude: the same 5,000 seeds
  // measured 58.7s on an idle desktop with no instrumentation and 27.6s under
  // CI's coverage run, while a full local coverage run needed 164ms per seed —
  // i.e. a count that fits here does not fit there, and one such run spent 539s
  // and hit CI's 120s per-test ceiling. Seeds still stop at MAX_SEEDS, and
  // MIN_SEEDS stops a machine from "passing" on a handful of interleavings. The
  // floor is not arbitrary — the heaviest mutant this harness was proved against
  // (an emptied `reconcileAssignedTopics` sweep) is caught at seed 12, so 100
  // keeps 8x the depth that detects a regression while the budget bounds cost.
  //
  // The floor is an assertion, never a precondition on the fuse. It used to be
  // both (`completed >= MIN_SEEDS && elapsed > budget`), which is exactly
  // backwards: on a runner too slow to clear 100 seeds inside the budget the
  // condition cannot fire while the budget is the only thing that matters, so the
  // sweep runs as long as the machine is slow and dies on the test's own timeout
  // with nothing to show for it. Observed that way — 1,046 seeds in 485s against
  // a 60s fuse. Demonstrated locally: with the budget set to 0 the gated form
  // still ran its 100 seeds and *passed*, the unconditional one stops at once and
  // fails with "explored only 0 seeds".
  const MAX_SEEDS = 5_000;
  const MIN_SEEDS = 100;
  const SEED_BUDGET_MS = 60_000;

  it('budgets on a clock that fake timers cannot move', async () => {
    // Every seed opens its own fake-timer window and advances ~45 simulated
    // seconds through it, so a budget reading the faked clock stops the sweep
    // for reasons that have nothing to do with how long anything took — which is
    // what a per-operation check did when it was tried (three seeds, 48ms of
    // real time). The immunity has to come from the source, not from where the
    // read happens, so this pins the source itself: 60 simulated seconds must
    // not cost 60 measured ones. 5s is deliberately loose next to 60 — it still
    // fails on the mutant that reads the fake clock, and never on load.
    vi.useFakeTimers();
    const before = realNowMs();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(realNowMs() - before).toBeLessThan(5_000);
  });

  it('keeps one owner, one transport subscription and exactly-once fan-out per live topic across randomized multi-tab interleavings', async () => {
    const failures: string[] = [];
    let completed = 0;
    // `realNowMs()`, never `Date.now()` and never the global
    // `performance.now()`: both move under this suite's fake timers, and the
    // budget check sits right where a seed's `vi.useRealTimers()` has just
    // restored them, which is the only reason a live read used to work. The
    // test above pins the source instead of the placement.
    const startedAt = realNowMs();
    let slowestSeedMs = 0;
    for (let seed = 1; seed <= MAX_SEEDS && failures.length < 6; seed += 1) {
      const seedStartedAt = realNowMs();
      if (seedStartedAt - startedAt > SEED_BUDGET_MS) break;
      const random = mulberry32(seed);
      vi.useFakeTimers();
      const storage = new MemoryStorage();
      const hub = new ChannelHub();
      const clock = { now: 1_000 };
      const tabs = [
        createTab('a', storage, hub, clock),
        createTab('b', storage, hub, clock),
        createTab('c', storage, hub, clock)
      ];
      const ops: string[] = [];
      try {
        const steps = 6 + Math.floor(random() * 10);
        for (let step = 0; step < steps; step += 1) {
          const tab = pick(random, tabs);
          const topic = pick(random, TOPICS);
          const roll = random();
          if (roll < 0.2) {
            ops.push(`${tab.label}:sub:${topic}`);
            subscribe(tab, topic);
          } else if (roll < 0.32) {
            ops.push(`${tab.label}:unsub:${topic}`);
            unsubscribe(tab, topic);
          } else if (roll < 0.42) {
            ops.push(`${tab.label}:publish:${topic}`);
            tab.bus.publish(topic, step);
          } else if (roll < 0.52) {
            ops.push(`${tab.label}:hide`);
            hide(tab);
          } else if (roll < 0.62) {
            ops.push(`${tab.label}:show`);
            show(tab);
          } else if (roll < 0.68) {
            ops.push(`${tab.label}:stop`);
            tab.intent = 'stopped';
            // `stop()` destroys the instance's handlers, routes and cluster
            // registration, so the expectation has to forget them too — a
            // restart comes back subscribed to nothing.
            tab.handlers.clear();
            void tab.bus.stop().catch(() => undefined);
          } else if (roll < 0.76) {
            ops.push(`${tab.label}:start`);
            tab.intent = 'running';
            void tab.bus.start({}).catch(() => undefined);
          } else if (roll < 0.88) {
            ops.push('tick');
            clock.now += 3_000;
            await vi.advanceTimersByTimeAsync(3_000);
            for (const each of tabs) each.env.runIntervals();
          } else if (roll < 0.905) {
            ops.push(`${tab.label}:forge:${topic}`);
            forgeSubscribe(hub, tab.bus.getClusterSnapshot().currentWorker.workerId, topic);
          } else if (roll < 0.93) {
            ops.push('drop-control');
            hub.dropNextControl();
          } else {
            ops.push('flush');
          }
          await flushMicrotasks();
        }

        // Bring every tab back so there is one well-defined end state: three
        // visible, running tabs holding whatever the sequence left installed.
        for (const tab of tabs) {
          show(tab);
          if (tab.intent !== 'running') {
            tab.intent = 'running';
            void tab.bus.start({}).catch(() => undefined);
          }
          await flushMicrotasks();
        }
        await settle(tabs, clock, 12);

        const state = tabs.map(tab => ({ tab, cluster: tab.bus.getClusterSnapshot() }));
        const trace = ops.join(',');
        const labels = (list: Tab[]) => `[${list.map(tab => tab.label).join(' ')}]`;
        for (const topic of TOPICS) {
          const topicKey = createOpaqueKey(topic);
          const expecters = tabs.filter(tab => tab.handlers.has(topic));
          const owners = state.filter(entry => entry.cluster.assignedTopics.includes(topic)).map(entry => entry.tab);
          const holders = tabs.filter(tab => tab.transport.subscribed.has(topic));
          const routes = state.map(entry =>
            entry.cluster.routes.filter(route => route.topicKey === topicKey).map(route => route.workerId)
          );
          const context = `seed=${seed} topic=${topic} ops=${trace}`;

          if (expecters.length === 0) {
            // Nobody subscribes any more: the topic has to leave no owner, no
            // transport subscription and no route record behind once the
            // worker TTL has passed a dozen times over.
            if (owners.length || holders.length || routes.some(workers => workers.length > 0)) {
              failures.push(
                `${context}: no subscriber left but owners=${labels(owners)} ` +
                  `transportSubscriptions=${labels(holders)} routes=${JSON.stringify(routes)}`
              );
            }
            continue;
          }

          // The cluster's promise: exactly one owner, exactly one transport
          // holding the topic, and those are the same tab. One condition,
          // because every way it breaks — a stale holder, a foreign holder, no
          // holder — also makes the publication below impossible to aim.
          if (owners.length !== 1 || holders.length !== 1 || owners[0] !== holders[0]) {
            failures.push(
              `${context}: ${expecters.length} subscriber(s) need one owner that holds the transport, got ` +
                `owners=${labels(owners)} transportSubscriptions=${labels(holders)}`
            );
            continue;
          }

          const carrier = owners[0] as Tab;
          const before = tabs.map(tab => tab.received.get(topic) ?? 0);
          carrier.transport.emit(topic, seed);
          await flushMicrotasks();
          for (const [index, tab] of tabs.entries()) {
            const delivered = (tab.received.get(topic) ?? 0) - (before[index] ?? 0);
            const expected = tab.handlers.has(topic) ? 1 : 0;
            if (delivered !== expected) {
              failures.push(
                `${context}: a publication on the owner delivered ${delivered} message(s) to ` +
                  `${tab.label}, expected ${expected}`
              );
            }
          }
        }
      } finally {
        for (const tab of tabs) await tab.bus.stop().catch(() => undefined);
        vi.useRealTimers();
        completed += 1;
        // A fuse sampled between seeds cannot bound a seed that wedges — an
        // `await` in its teardown that needs a timer the fake clock never
        // advances bypasses the check entirely, and used to show up only as a
        // huge total. Recording the worst seed makes that a line in the log.
        const seedMs = realNowMs() - seedStartedAt;
        if (seedMs > slowestSeedMs) slowestSeedMs = seedMs;
      }
    }
    // A truncated sweep is the interesting case, and the one that is invisible
    // from a pass/fail CI line: log the depth actually reached so a runner that
    // is too slow to clear the floor is diagnosable instead of mysterious.
    if (completed < MAX_SEEDS) {
      console.log(
        `[coordination-invariants] stopped at ${completed}/${MAX_SEEDS} seeds after ` +
          `${Math.round(realNowMs() - startedAt)}ms (slowest seed ${Math.round(slowestSeedMs)}ms)`
      );
    }
    // A budget that always fires early would let the suite go quiet on a slow
    // runner without anyone noticing, so depth is floored as well as capped.
    expect(completed, `explored only ${completed} seeds`).toBeGreaterThanOrEqual(MIN_SEEDS);
    expect(failures).toEqual([]);
  }, 120_000);
});
