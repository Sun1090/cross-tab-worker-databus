import { describe, expect, it, vi } from 'vitest';
import { BatchingStorageWriter } from '../src/core/storage-batch';
import { MemoryStorage } from './fakes';

describe('BatchingStorageWriter', () => {
  it('coalesces synchronous writes into one underlying flush', async () => {
    const storage = new MemoryStorage();
    const writer = new BatchingStorageWriter(storage);

    writer.setItem('heartbeat', '1');
    writer.setItem('route', '2');
    writer.setItem('heartbeat', '3');
    expect(storage.entries()).toEqual([]);

    await Promise.resolve();
    expect(storage.entries()).toEqual([
      ['heartbeat', '3'],
      ['route', '2']
    ]);
    expect(writer.pendingSize).toBe(0);
  });

  it('reads pending values before the microtask flush lands', () => {
    const storage = new MemoryStorage();
    const writer = new BatchingStorageWriter(storage);

    writer.setItem('route', '{"owner":"a"}');
    writer.setItem('worker', '{"load":1}');

    expect(writer.getItem('route')).toBe('{"owner":"a"}');
    expect(writer.getItem('worker')).toBe('{"load":1}');
    expect(writer.length).toBe(2);
    expect(writer.key(0)).toBe('route');
  });

  it('makes flushed writes visible to a separate reader instance', async () => {
    const storage = new MemoryStorage();
    const writerA = new BatchingStorageWriter(storage);
    const writerB = new BatchingStorageWriter(storage);

    writerA.setItem('route', '{"owner":"worker-a"}');
    expect(writerB.getItem('route')).toBeNull();

    await Promise.resolve();
    expect(writerB.getItem('route')).toBe('{"owner":"worker-a"}');
  });

  it('merges removals with pending writes and flushes them together', async () => {
    const storage = new MemoryStorage();
    storage.setItem('stale', 'x');
    storage.setItem('kept', 'y');
    const writer = new BatchingStorageWriter(storage);

    writer.removeItem('stale');
    writer.setItem('fresh', 'z');
    expect(writer.getItem('stale')).toBeNull();

    await Promise.resolve();
    expect(storage.entries()).toEqual([
      ['kept', 'y'],
      ['fresh', 'z']
    ]);
  });

  it('retries failed writes with exponential backoff until they land', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const originalSetItem = storage.setItem.bind(storage);
    let failures = 2;
    storage.setItem = (key, value) => {
      if (failures > 0) {
        failures -= 1;
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }
      originalSetItem(key, value);
    };
    const writer = new BatchingStorageWriter(storage);

    writer.setItem('route', '{"owner":"a"}');
    await Promise.resolve();
    expect(storage.getItem('route')).toBeNull();
    expect(writer.pendingSize).toBe(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(storage.getItem('route')).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(storage.getItem('route')).toBe('{"owner":"a"}');
    expect(writer.pendingSize).toBe(0);
    vi.useRealTimers();
  });

  it('clears pending writes and the underlying storage together', () => {
    const storage = new MemoryStorage();
    storage.setItem('existing', 'value');
    const writer = new BatchingStorageWriter(storage);
    writer.setItem('pending', 'value');

    writer.clear();

    expect(writer.pendingSize).toBe(0);
    expect(writer.getItem('pending')).toBeNull();
    expect(storage.entries()).toEqual([]);
  });

  it('drops a persistently failing key after MAX_RETRY_ATTEMPTS', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    // This key always fails — the writer should give up after 5 attempts.
    storage.setItem = () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    };
    const writer = new BatchingStorageWriter(storage);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writer.setItem('doomed', 'x');
    // Drive the retry loop: initial flush + 5 retries (50,100,200,400,800 ms).
    await vi.advanceTimersByTimeAsync(2_000);

    expect(writer.pendingSize).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    expect(storage.getItem('doomed')).toBeNull();
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('reads pending value even when the underlying storage holds an older value', () => {
    const storage = new MemoryStorage();
    storage.setItem('route', '{"owner":"old"}');
    const writer = new BatchingStorageWriter(storage);

    // A pending write shadows the persisted value before flush.
    writer.setItem('route', '{"owner":"new"}');
    expect(writer.getItem('route')).toBe('{"owner":"new"}');
    expect(storage.getItem('route')).toBe('{"owner":"old"}');
  });

  it('treats removeItem as a null pending value that shadows a stored value', () => {
    const storage = new MemoryStorage();
    storage.setItem('route', '{"owner":"old"}');
    const writer = new BatchingStorageWriter(storage);

    writer.removeItem('route');
    // Pending delete shadows the stored value before flush.
    expect(writer.getItem('route')).toBeNull();
    expect(storage.getItem('route')).toBe('{"owner":"old"}');
  });

  it('does not start a second overlapping flush from concurrent scheduleFlush calls', async () => {
    const storage = new MemoryStorage();
    const setItemSpy = vi.spyOn(storage, 'setItem');
    const writer = new BatchingStorageWriter(storage);

    // Multiple synchronous writes within one task coalesce into one flush.
    writer.setItem('a', '1');
    writer.setItem('b', '2');
    writer.setItem('c', '3');
    await Promise.resolve();

    // Three keys written, but only one flush pass — one setItem call per key.
    expect(setItemSpy).toHaveBeenCalledTimes(3);
    expect(writer.pendingSize).toBe(0);
  });
});
