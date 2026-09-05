/**
 * IndexedDB replay persistence adapter tests.
 *
 * Runs against fake-indexeddb so the mutation-queue serialization, prune
 * strategies, and transient-open-failure recovery are covered in unit tests
 * without a real browser.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbReplayPersistence } from '../src/core/replay-persistence';
import type { DataBusMessage } from '../src/core/types';

function message(topic: string, value: number, timestamp?: number): DataBusMessage<{ value: number }> {
  return { topic, data: { value }, ...(timestamp === undefined ? {} : { timestamp }) };
}

describe('createIndexedDbReplayPersistence', () => {
  let factory: IDBFactory;

  beforeEach(() => {
    factory = new IDBFactory();
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = factory;
  });

  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('round-trips appended messages through load', async () => {
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    await persistence.append(message('t', 1));
    await persistence.append(message('t', 2));
    expect(await persistence.load()).toEqual([message('t', 1), message('t', 2)]);
  });

  it('rejects invalid configuration', () => {
    expect(() => createIndexedDbReplayPersistence({ maxPerTopic: 0 })).toThrow('maxPerTopic');
    expect(() => createIndexedDbReplayPersistence({ maxPerTopic: 4, pruneStrategy: 'bogus' as 'count' })).toThrow('pruneStrategy');
    expect(() => createIndexedDbReplayPersistence({ maxPerTopic: 4, retentionMs: 0 })).toThrow('retentionMs');
  });

  it('trims history by count when the ring overflows', async () => {
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 3 });
    for (let index = 0; index < 5; index += 1) await persistence.append(message('t', index));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([2, 3, 4]);
  });

  it('trims history by age when retention is configured', async () => {
    // Timestamps relative to the real clock: the adapter cuts off at
    // Date.now() - retentionMs, so anything older than 1s is pruned.
    const now = Date.now();
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 10, pruneStrategy: 'age', retentionMs: 1_000 });
    await persistence.append(message('t', 1, now - 5_000));
    await persistence.append(message('t', 2, now - 500));
    await persistence.append(message('t', 3, now - 100));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([2, 3]);
  });

  it('applies count and age pruning together with the both strategy', async () => {
    const now = Date.now();
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 2, pruneStrategy: 'both', retentionMs: 1_000 });
    await persistence.append(message('t', 1, now - 5_000));
    await persistence.append(message('t', 2, now - 500));
    await persistence.append(message('t', 3, now - 100));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([2, 3]);
  });

  it('groups appendBatch entries per topic in one mutation', async () => {
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 10 });
    await persistence.appendBatch!([message('a', 1), message('b', 2), message('a', 3)]);
    const loaded = await persistence.load();
    expect(loaded.filter(item => item.topic === 'a').map(item => item.data.value)).toEqual([1, 3]);
    expect(loaded.filter(item => item.topic === 'b').map(item => item.data.value)).toEqual([2]);
  });

  it('returns without touching the database for an empty batch', async () => {
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    await persistence.appendBatch!([]);
    expect(await persistence.load()).toEqual([]);
  });

  it('serializes concurrent same-topic appends so read-modify-write cannot lose updates', async () => {
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 100 });
    await Promise.all(Array.from({ length: 20 }, (_, index) => persistence.append(message('t', index))));
    const loaded = await persistence.load();
    expect(loaded).toHaveLength(20);
    expect(new Set(loaded.map(item => item.data.value)).size).toBe(20);
  });

  it('clears all history, one topic, and prunes by cutoff', async () => {
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 10 });
    await persistence.appendBatch!([message('a', 1, 100), message('a', 2, 900), message('b', 3, 500)]);

    await persistence.clearTopic!('a');
    expect((await persistence.load()).map(item => item.topic)).toEqual(['b']);

    await persistence.appendBatch!([message('a', 4, 100), message('a', 5, 900)]);
    // Cutoff 300 prunes a:4 (ts 100) but keeps a:5 (900) and b:3 (500).
    await persistence.clearBefore!(300);
    const loaded = await persistence.load();
    expect(loaded.map(item => item.data.value).sort()).toEqual([3, 5]);

    await persistence.clear!();
    expect(await persistence.load()).toEqual([]);
  });

  it('drops a topic record entirely when pruning removes its last message', async () => {
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 10 });
    await persistence.append(message('a', 1, 100));
    await persistence.append(message('b', 2, 900));
    await persistence.clearBefore!(500);
    expect((await persistence.load()).map(item => item.topic)).toEqual(['b']);
  });

  it('recovers after a transient open failure instead of caching the rejection', async () => {
    let failures = 1;
    const flakyFactory = {
      open(name: string, version?: number) {
        if (failures > 0) {
          failures -= 1;
          const request = { error: new Error('transient open failure') } as IDBOpenDBRequest;
          queueMicrotask(() => request.onerror?.call(request, { target: request } as unknown as Event));
          return request;
        }
        return factory.open(name, version);
      }
    };
    (globalThis as { indexedDB?: unknown }).indexedDB = flakyFactory;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });

    await expect(persistence.append(message('t', 1))).rejects.toThrow('transient open failure');
    await persistence.append(message('t', 2));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([2]);
  });
});
