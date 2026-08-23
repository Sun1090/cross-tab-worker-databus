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
});
