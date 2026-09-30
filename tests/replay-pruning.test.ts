import { describe, expect, it } from 'vitest';
import { pruneReplayHistory } from '../src/core/replay-pruning';
import { PRUNE_STRATEGY } from '../src/utils/constants';
import type { DataBusMessage } from '../src/core/types';

/**
 * `pruneReplayHistory` is the shared pruning policy behind both the in-memory
 * ring and the durable IndexedDB store, so nothing imports it directly in the
 * suite and every case reaches it through a caller. That is the right structure
 * for its *semantics* and the wrong instrument for its **identity contract**,
 * which is what this file is for.
 *
 * The contract is stated in the function's own doc: *"The returned array is the
 * same instance when no entries need to be removed."* It is not decoration — both
 * callers use it as the condition for skipping work:
 *
 *   `replay-manager.ts` append:  `if (pruned !== buffer) { buffer = pruned; … }`
 *   `replay-manager.ts` hydrate: `if (pruned !== buffer) this.buffers.set(…)`
 *
 * So returning a fresh array on every call is a **hot-path regression with no
 * behavioural symptom**: one allocation and one `Map.set` per publication, plus a
 * `Map.set` per topic at hydration. And because the arrays are deep-equal either
 * way, `toEqual` cannot see it at all — measured: making the count path return
 * `[...messages]` leaves **all 1020 tests green**. That is why these cases use
 * `toBe`, and why they assert identity *through* the semantic expectations rather
 * than only on the empty case.
 */
function entry(topic: string, index: number, timestamp?: number): DataBusMessage<number> {
  return timestamp === undefined
    ? { topic, data: index }
    : { topic, data: index, timestamp };
}

describe('replay pruning: the same instance when nothing is removed', () => {
  const base = { maxPerTopic: 5, retentionMs: undefined, now: 1_000 };

  it('returns the caller\'s array under the count cap', () => {
    // No `pruneStrategy` variant reaches a copy here, so this is the one case
    // that pins the contract on its own rather than alongside a length check.
    const messages = [entry('t', 1), entry('t', 2)];
    const pruned = pruneReplayHistory(messages, { ...base, pruneStrategy: PRUNE_STRATEGY.COUNT });
    expect(pruned, 'nothing was removed, so the instance is the one the caller passed in').toBe(messages);
  });

  it('returns a new array once the count cap actually trims', () => {
    const messages = [entry('t', 1), entry('t', 2), entry('t', 3)];
    const pruned = pruneReplayHistory(messages, { ...base, maxPerTopic: 2, pruneStrategy: PRUNE_STRATEGY.COUNT });
    // Both halves: a copy *and* the documented newest-`maxPerTopic` behaviour, so
    // a mutation that copied unconditionally fails here rather than passing a
    // length check.
    expect(pruned).not.toBe(messages);
    expect(pruned.map(item => item.data)).toEqual([2, 3]);
  });

  it('returns the same instance on the age path when nothing has expired', () => {
    const messages = [entry('t', 1, 900), entry('t', 2, 950)];
    const pruned = pruneReplayHistory(messages, {
      ...base,
      pruneStrategy: PRUNE_STRATEGY.AGE,
      retentionMs: 5_000
    });
    expect(pruned, 'no entry is older than the cutoff, so no filter ran').toBe(messages);
  });

  it('returns a new array on the age path once the cutoff removes something', () => {
    // Its own `now`, because the shared base's `now: 1_000` puts the cutoff at
    // -4000 — where nothing can be expired and the same-instance answer is
    // correct. The first version of this case inherited `base` and asserted a
    // filter that could not run: a case that sets up no premise and then blames
    // the code is the failure mode, not the code.
    const messages = [entry('t', 1, 100), entry('t', 2, 9_000)];
    const pruned = pruneReplayHistory(messages, {
      maxPerTopic: 5,
      pruneStrategy: PRUNE_STRATEGY.AGE,
      retentionMs: 5_000,
      now: 10_000
    });
    expect(pruned).not.toBe(messages);
    expect(pruned.map(item => item.data)).toEqual([2]);
  });

  it('returns the same instance under `both` when neither the cutoff nor the cap trims', () => {
    const messages = [entry('t', 1, 900), entry('t', 2, 950)];
    const pruned = pruneReplayHistory(messages, {
      ...base,
      pruneStrategy: PRUNE_STRATEGY.BOTH,
      retentionMs: 5_000
    });
    expect(pruned).toBe(messages);
  });
});

/**
 * The semantic claims the same docstring and `docs/configuration.md` make about
 * *which* entries each strategy removes. These are here because they share the
 * module and because two of them are the boundaries a reader is most likely to
 * get wrong — a strict `<` at the cutoff, and `age` with no `retentionMs`
 * falling back to the count cap.
 */
describe('replay pruning: which entries each strategy removes', () => {
  const now = 10_000;

  it('keeps an entry exactly at the cutoff', () => {
    // The load-bearing comparison is the **filter's** `>= cutoff`, not the
    // detection loop's `< cutoff`. Measured: making the detection loop inclusive
    // (`<=`) changes nothing observable, because the entry it newly flags as
    // expired is then *kept anyway* by `>= cutoff` — so the two operands cannot be
    // told apart from the output, and a case asserting the `<` would be asserting
    // a difference that does not exist. This case therefore pins the filter, and
    // pins it in a way the inclusive detection loop cannot satisfy.
    const messages = [entry('t', 1, now - 100)];
    const pruned = pruneReplayHistory(messages, {
      maxPerTopic: 10,
      pruneStrategy: PRUNE_STRATEGY.AGE,
      retentionMs: 100,
      now
    });
    expect(pruned.map(item => item.data)).toEqual([1]);

    const expired = [entry('t', 1, now - 101)];
    expect(
      pruneReplayHistory(expired, {
        maxPerTopic: 10,
        pruneStrategy: PRUNE_STRATEGY.AGE,
        retentionMs: 100,
        now
      }).map(item => item.data),
      'one millisecond older is expired'
    ).toEqual([]);
  });

  it('keeps the at-cutoff entry when the filter actually runs', () => {
    // The case above cannot pin the filter's `>=`, and the reason is worth
    // stating because it is invisible: with one entry sitting exactly at the
    // cutoff, the detection loop's strict `<` finds nothing expired, so
    // `hasExpired` stays false and **the filter never executes**. Any mutation of
    // the filter is invisible to it. Making the filter reachable needs an
    // *expired sibling* in the same call, which is what this case adds — and the
    // first version of the boundary case survived exactly this mutation while
    // looking like it was testing the boundary.
    const messages = [entry('t', 1, now - 101), entry('t', 2, now - 100), entry('t', 3, now - 50)];
    const pruned = pruneReplayHistory(messages, {
      maxPerTopic: 10,
      pruneStrategy: PRUNE_STRATEGY.AGE,
      retentionMs: 100,
      now
    });
    // Entry 1 is expired and goes; entry 2 sits *on* the cutoff and stays;
    // entry 3 is newer and stays. With `> cutoff` in place of `>=`, entry 2 goes
    // too and this reads [3].
    expect(pruned.map(item => item.data)).toEqual([2, 3]);
  });

  it('keeps timestamp-less legacy entries under `age` while capping them by maxPerTopic', () => {
    // The documented asymmetry: `age` leaves timestamped entries bounded only by
    // the retention window, because timestamp-less entries can never expire by
    // age — so they are the ones the count still applies to.
    const messages = [entry('t', 1), entry('t', 2), entry('t', 3)];
    const pruned = pruneReplayHistory(messages, {
      maxPerTopic: 2,
      pruneStrategy: PRUNE_STRATEGY.AGE,
      retentionMs: 5_000,
      now
    });
    expect(pruned.map(item => item.data), 'the OLDEST timestamp-less entries are dropped').toEqual([2, 3]);
  });

  it('falls back to the count cap when `age` is chosen without a retention window', () => {
    // `docs/configuration.md` states this fallback, and it is the clause that
    // makes `retentionMs !== undefined` in `ageEnabled` load-bearing rather than
    // an optimisation: without it, `now - undefined` is `NaN`, every comparison
    // against it is false, nothing expires, and the count cap never applies to
    // timestamped entries at all.
    const messages = [entry('t', 1, 1), entry('t', 2, 2), entry('t', 3, 3)];
    const pruned = pruneReplayHistory(messages, {
      maxPerTopic: 2,
      pruneStrategy: PRUNE_STRATEGY.AGE,
      retentionMs: undefined,
      now
    });
    expect(pruned.map(item => item.data)).toEqual([2, 3]);
  });

  it('applies the cutoff before the count cap under `both`', () => {
    // The order is observable only when the cap *would* evict an entry the cutoff
    // is about to remove anyway. Cutoff is 10_000 - 100 = 9_900, so two fresh
    // entries and one expired, cap two:
    // Three fresh entries and one expired, cap two — the filtered result must be
    // *longer* than the cap, or the cap never binds and deleting it changes
    // nothing:
    //   cutoff then cap -> [2, 3]   (expired goes, then the cap keeps the newest two)
    //   cap then cutoff -> [3]      (cap evicts 1 and 2, keeping 3 and the expired 4)
    //   cap deleted    -> [1, 2, 3]
    // Two earlier versions of this case asserted nothing, and both are worth
    // recording because each *looked* like it was testing the source. The first
    // had two expired and one survivor, where the cap never binds. The second put
    // a "fresh" entry at 9_800, which is older than the 9_900 cutoff and so
    // expired — a wrong expectation that read as a code defect. The third had two
    // fresh entries against a cap of two, so after filtering the cap was exactly
    // satisfied and deleting it outright still passed. **Three attempts, one
    // lesson: a case that passes a mutation which deletes the whole clause proves
    // the clause was never under test.** The arithmetic is written out here so a
    // fourth reader can check it without running anything.
    const messages = [
      entry('t', 1, 9_900),
      entry('t', 2, 9_950),
      entry('t', 3, 9_990),
      entry('t', 4, 100)
    ];
    const pruned = pruneReplayHistory(messages, {
      maxPerTopic: 2,
      pruneStrategy: PRUNE_STRATEGY.BOTH,
      retentionMs: 100,
      now
    });
    expect(pruned.map(item => item.data)).toEqual([2, 3]);
  });
});
