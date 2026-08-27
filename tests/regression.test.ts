import { describe, expect, it } from 'vitest';
import { createOpaqueKey } from '../src/core/hash';
import { hasActiveOwner, selectLeastLoadedWorker } from '../src/core/routing';
import type { WorkerRecord } from '../src/core/types';

/**
 * Regression tests for the deep-refactor batch. These exercise the helpers and
 * code paths introduced/extracted during the second optimization pass so a
 * future change cannot silently break them.
 */

const makeWorker = (overrides: Partial<WorkerRecord> = {}): WorkerRecord => ({
  workerId: 'w1',
  tabId: 't1',
  load: 0,
  role: 'active',
  status: 'connected',
  visibilityState: 'visible',
  heartbeatAt: 0,
  registeredAt: 0,
  ...overrides
});

describe('routing: locale-independent tie-break', () => {
  // selectLeastLoadedWorker now compares workerId with < rather than localeCompare.
  // Ensure the tie-break is a plain ascending code-unit comparison, unaffected by
  // the host's collation order.
  it('picks the workerId with the smallest code-unit ordering regardless of locale', () => {
    const upper = makeWorker({ workerId: 'Zeta', load: 1 });
    const lower = makeWorker({ workerId: 'alpha', load: 1 });
    // Code-unit comparison: uppercase 'Z' (90) < lowercase 'a' (97), so 'Zeta'
    // wins — the opposite of a case-insensitive locale sort.
    expect(selectLeastLoadedWorker([upper, lower])?.workerId).toBe('Zeta');
    expect(selectLeastLoadedWorker([lower, upper])?.workerId).toBe('Zeta');
  });

  it('hasActiveOwner accepts a route shaped like the storage record', () => {
    const route = { topicKey: 'k', workerId: 'w1', tabId: 't1', updatedAt: 0, generation: 1 };
    expect(hasActiveOwner(route, [makeWorker({ workerId: 'w1' })])).toBe(true);
    expect(hasActiveOwner(route, [makeWorker({ workerId: 'w2' })])).toBe(false);
  });
});

describe('hash: regression invariants after refactor', () => {
  it('createOpaqueKey stays stable across calls in the same process', () => {
    const key = createOpaqueKey('regression.topic');
    expect(createOpaqueKey('regression.topic')).toBe(key);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});
