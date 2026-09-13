/**
 * Property-based (seeded, deterministic) tests for the pure hot-path helpers.
 *
 * A bug class this repo has already hit twice is "a corrupt field read back
 * from a peer's stored record divides through to a non-finite number, making
 * owner selection depend on the array order" (routing.ts). Example-based tests
 * only cover the shapes the author thought of; these seeded generators explore
 * corrupt and adversarial inputs (NaN/±Infinity from JSON `1e999`, null,
 * strings, weights that are themselves non-finite) against the invariants the
 * code promises.
 *
 * The PRNG is seeded, so failures are reproducible and the suite is not flaky.
 */
import { describe, expect, it } from 'vitest';
import {
  approximatePayloadBytes,
  effectiveWorkerLoad,
  isWildcardTopic,
  selectLeastLoadedWorker,
  topicMatchesPattern
} from '../src/core/routing';
import type { LoadWeightingOptions, WorkerRecord } from '../src/core/types';
import { parseDataBusPublication } from '../src/core/publication';
import { serializeError } from '../src/utils/error-utils';
import { createOpaqueKey } from '../src/core/hash';
import { TAB_VISIBILITY, WORKER_ROLE, WORKER_STATUS } from '../src/utils/constants';

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(random: () => number, values: readonly T[]): T =>
  values[Math.floor(random() * values.length)] as T;

const CORRUPT_NUMBERS = [0, 1, 7, -3, NaN, Infinity, -Infinity, 0.5] as const;

function corruptNumber(random: () => number): number {
  return pick(random, CORRUPT_NUMBERS);
}

function arbitraryWorker(random: () => number): WorkerRecord {
  const withSample = random() < 0.6;
  const sample = withSample
    ? {
        windowMs: corruptNumber(random),
        messageCount: corruptNumber(random),
        byteCount: corruptNumber(random),
        overrunMs: corruptNumber(random),
        sampledAt: corruptNumber(random)
      }
    : undefined;
  return {
    workerId: `worker-${Math.floor(random() * 5)}`,
    tabId: `tab-${Math.floor(random() * 5)}`,
    load: corruptNumber(random),
    role: pick(random, [WORKER_ROLE.ACTIVE, WORKER_ROLE.STANDBY]),
    status: pick(random, [WORKER_STATUS.CONNECTED, WORKER_STATUS.CONNECTING, WORKER_STATUS.DISCONNECTED]),
    visibilityState: pick(random, [TAB_VISIBILITY.VISIBLE, TAB_VISIBILITY.HIDDEN]),
    heartbeatAt: corruptNumber(random),
    registeredAt: corruptNumber(random),
    ...(sample ? { throughput: sample } : {})
  };
}

function arbitraryWeighting(random: () => number): LoadWeightingOptions | undefined {
  if (random() < 0.3) return undefined;
  return {
    messageRateWeight: corruptNumber(random),
    byteRateWeight: corruptNumber(random),
    scheduleLagWeight: corruptNumber(random)
  };
}

function arbitraryValue(random: () => number, depth = 0): unknown {
  const roll = random();
  if (depth > 3 || roll < 0.5) {
    return pick(random, [
      null,
      undefined,
      true,
      false,
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      '',
      'topic',
      'data',
      'chat.*'
    ]);
  }
  if (roll < 0.7) return Array.from({ length: Math.floor(random() * 3) }, () => arbitraryValue(random, depth + 1));
  const obj: Record<string, unknown> = {};
  const keys = ['topic', 'data', 'messageId', 'timestamp', 'channel', 'push', 'publication', 'op', 'value'];
  for (let i = 0; i < Math.floor(random() * 4); i += 1) {
    obj[pick(random, keys)] = arbitraryValue(random, depth + 1);
  }
  return obj;
}

describe('approximatePayloadBytes is a total function', () => {
  it('returns a non-negative finite estimate for arbitrary values, including cycles', () => {
    const random = rng(0xbeef);
    for (let i = 0; i < 1_000; i += 1) {
      const value = arbitraryValue(random);
      const estimate = approximatePayloadBytes(value);
      expect(Number.isFinite(estimate), `non-finite estimate for ${JSON.stringify(value)}`).toBe(true);
      expect(estimate).toBeGreaterThanOrEqual(0);
    }
    // Structured clone preserves cycles, so a cyclic payload can reach the
    // estimator through the replay buffer and the adaptive-load sampler.
    const cyclic: Record<string, unknown> = { value: 1 };
    cyclic.self = cyclic;
    expect(Number.isFinite(approximatePayloadBytes(cyclic))).toBe(true);
  });
});

describe('effectiveWorkerLoad is a total function', () => {
  it('always returns a finite score for arbitrary (corrupt) worker records and weights', () => {
    const random = rng(0x5eed);
    for (let i = 0; i < 2_000; i += 1) {
      const worker = arbitraryWorker(random);
      const options = arbitraryWeighting(random);
      const score = effectiveWorkerLoad(worker, options);
      expect(
        Number.isFinite(score),
        `non-finite score ${String(score)} for load=${String(worker.load)} sample=${JSON.stringify(worker.throughput)} options=${JSON.stringify(options)}`
      ).toBe(true);
    }
  });
});

describe('selectLeastLoadedWorker is order-independent and total', () => {
  it('returns the minimum score with the workerId tie-break, regardless of input order', () => {
    const random = rng(0xc0ffee);
    for (let i = 0; i < 500; i += 1) {
      const size = 1 + Math.floor(random() * 6);
      const workers = Array.from({ length: size }, () => arbitraryWorker(random));
      const options = arbitraryWeighting(random);

      const chosen = selectLeastLoadedWorker(workers, undefined, options);
      expect(chosen).toBeDefined();

      // Recompute the expected winner from the same (sanitised) score.
      const scored = workers.map(worker => ({ worker, score: effectiveWorkerLoad(worker, options) }));
      const min = Math.min(...scored.map(entry => entry.score));
      const expected = scored
        .filter(entry => entry.score === min)
        .map(entry => entry.worker.workerId)
        .sort()[0];
      expect(chosen!.workerId, `winner mismatch for size ${size}`).toBe(expected);

      // Shuffling the input must not change the winner.
      const shuffled = [...workers].reverse();
      const chosenReversed = selectLeastLoadedWorker(shuffled, undefined, options);
      expect(chosenReversed!.workerId).toBe(expected);
    }
  });
});

describe('parseDataBusPublication never throws and yields a valid topic', () => {
  it('returns null or a publication whose topic is a non-empty string', () => {
    const random = rng(0x1dea);
    for (let i = 0; i < 2_000; i += 1) {
      const value = arbitraryValue(random);
      const fallback = random() < 0.5 ? pick(random, [undefined, '', 'fallback.topic', 'x'] as const) : undefined;
      let result: ReturnType<typeof parseDataBusPublication>;
      expect(() => {
        result = parseDataBusPublication(value, fallback as string | undefined);
      }).not.toThrow();
      if (result! === null) continue;
      expect(typeof result!.topic).toBe('string');
      expect(result!.topic.length).toBeGreaterThan(0);
      // A non-empty fallback is used only when the value carries no explicit
      // topic; an explicit topic takes precedence (documented behaviour).
      if (fallback) {
        const explicit = typeof value === 'object' && value !== null
          ? (value as Record<string, unknown>).topic
          : undefined;
        if (typeof explicit !== 'string') expect(result!.topic).toBe(fallback);
      }
    }
  });
});

describe('topicMatchesPattern invariants', () => {
  const topics = ['', 'a', 'a.b', 'a.b.c', 'chat', 'chat.room', 'chat.room.1', 'chatter.1', 'x.y.z'] as const;
  const patterns = ['', '*', 'a', 'a.*', 'chat.*', 'chat.room.*', 'chatter.*', 'x.*'] as const;

  it('is reflexive for exact non-empty topics and prefix-correct for wildcards', () => {
    for (const topic of topics) {
      if (topic) expect(topicMatchesPattern(topic, topic)).toBe(true);
      // `*` matches every non-empty topic and nothing else.
      if (topic) expect(topicMatchesPattern('*', topic)).toBe(true);
      for (const pattern of patterns) {
        const matched = topicMatchesPattern(pattern, topic);
        if (!matched) continue;
        if (!isWildcardTopic(pattern)) {
          // A non-wildcard match can only be self-equality.
          expect(pattern).toBe(topic);
        } else {
          // A wildcard match must share the literal prefix before `.*`.
          expect(topic.startsWith(pattern === '*' ? '' : pattern.slice(0, -1))).toBe(true);
        }
      }
    }
    expect(topicMatchesPattern('', '')).toBe(false);
    expect(topicMatchesPattern('*', '')).toBe(false);
    // Segment boundary: `chat.*` must not match `chatter.1`.
    expect(topicMatchesPattern('chat.*', 'chatter.1')).toBe(false);
  });
});

describe('serializeError is always structured-cloneable', () => {
  it('survives structuredClone for arbitrary values, including functions and symbols', () => {
    const random = rng(0xe44);
    const extras: unknown[] = [() => undefined, Symbol('s'), { fn: () => undefined }];
    for (let i = 0; i < 1_000; i += 1) {
      const value = i % 5 === 0 ? extras[i % extras.length] : arbitraryValue(random);
      const serialized = serializeError(value);
      expect(() => structuredClone(serialized), `uncloneable serialization for ${String(value)}`).not.toThrow();
    }
  });
});

describe('createOpaqueKey', () => {
  it('is deterministic and always a 32-char lowercase hex digest', () => {
    const random = rng(0xf00d);
    for (let i = 0; i < 1_000; i += 1) {
      const value = String(arbitraryValue(random));
      const key = createOpaqueKey(value);
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      expect(createOpaqueKey(value)).toBe(key);
    }
    expect(createOpaqueKey('a')).not.toBe(createOpaqueKey('b'));
  });
});
