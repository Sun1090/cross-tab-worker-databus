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
 * that do not — and the fuzzers additionally budget on `performance.now()`,
 * which no test in this repository fakes, so a future leak cannot move their
 * depth again.
 */
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});
