/**
 * Global test setup: restore real timers after every test.
 *
 * This suite fakes `Date` constantly, and the seeded fuzzers sample a wall
 * clock to bound how deep they sweep. When a faked clock is what they end up
 * reading, the budget stops meaning anything: the same coordination file
 * measured 60.2s on its own and 16.4s inside a full run, where both its own
 * 100-seed floor and CI's 120s ceiling were decided by a clock that had been
 * advanced ~45 simulated seconds per seed elsewhere. Per-file `afterEach` hooks
 * only cover the describes that declare them, so this is the net for the ones
 * that do not.
 *
 * What this net does *not* cover is a clock read while a fake window is still
 * open — and `vi.useFakeTimers()` moves `performance` as well as `Date` on the
 * pinned Vitest 5 (measured: global `performance.now()` and
 * `process.hrtime.bigint()` both advanced by the full 60 simulated seconds,
 * while `node:perf_hooks`' untouched object read 216ms of real time). Restoring
 * here is what makes a read at the *top* of a seed loop real; anything that
 * samples inside a window uses `realNowMs()` from `tests/fakes.ts` instead.
 */
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});
