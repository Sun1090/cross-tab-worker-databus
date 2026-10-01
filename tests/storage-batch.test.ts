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

  it('falls back to setTimeout when queueMicrotask is unavailable', async () => {
    // Older runtimes and non-browser environments lack queueMicrotask; the
    // coalescing window must still flush exactly once on a macrotask. Draining
    // microtasks first proves the microtask path was not taken.
    const original = globalThis.queueMicrotask;
    vi.stubGlobal('queueMicrotask', undefined);
    try {
      const storage = new MemoryStorage();
      const writer = new BatchingStorageWriter(storage);
      writer.setItem('heartbeat', '1');
      writer.setItem('route', '2');
      await Promise.resolve();
      await Promise.resolve();
      expect(storage.entries()).toEqual([]);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(storage.entries()).toEqual([
        ['heartbeat', '1'],
        ['route', '2']
      ]);
      expect(writer.pendingSize).toBe(0);
    } finally {
      vi.stubGlobal('queueMicrotask', original);
      vi.unstubAllGlobals();
    }
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

  it('does not let a re-entrant write extend the current flush pass', async () => {
    // The `Array.from(this.pending)` snapshot is the only thing standing between a
    // re-entrant adapter and an unbounded pass, and `StorageLike` is a
    // **consumer-implemented port** — nothing stops an application's storage from
    // calling back into the writer while a write is in flight. This case is
    // therefore a *reach* fixture, not a shape check: without it the snapshot is
    // untested because no existing case re-enters, and the comment above the loop
    // is a claim with nothing behind it.
    const storage = new MemoryStorage();
    const writer = new BatchingStorageWriter(storage);
    const original = storage.setItem.bind(storage);
    let reentered = false;
    storage.setItem = (key: string, value: string) => {
      original(key, value);
      if (!reentered) {
        reentered = true;
        writer.setItem('late', 'L');
      }
    };

    writer.setItem('first', 'A');
    await Promise.resolve();

    // The entry added *during* the pass must not be visited by it — a live Map
    // iterator does reach keys added after its position.
    expect(storage.getItem('late')).toBeNull();
    expect(writer.pendingSize).toBe(1);
    // And the flush that re-entrant write scheduled writes it, so nothing is lost.
    await Promise.resolve();
    expect(storage.getItem('late')).toBe('L');
    expect(writer.pendingSize).toBe(0);
  });

  it('subtracts a pending delete from the enumerated key range', () => {
    // `keys()` is documented as "union of persisted keys and pending writes, minus
    // pending deletes". The `minus` clause is the whole reason a delete is visible
    // to an enumerator *before* the flush lands, and a caller reading the range
    // would otherwise keep acting on a key it has already asked to remove.
    const storage = new MemoryStorage();
    storage.setItem('route:a', '{"owner":"a"}');
    storage.setItem('route:b', '{"owner":"b"}');
    const writer = new BatchingStorageWriter(storage);

    expect(writer.length).toBe(2);
    writer.removeItem('route:a');

    expect(writer.length, 'a pending delete must not keep reporting its key').toBe(1);
    expect(writer.key(0)).toBe('route:b');
    expect(writer.key(1)).toBeNull();
  });

  it('restarts the backoff at the initial delay after a failure episode drains', async () => {
    // The backoff comment claims "50ms -> 100ms -> ... -> capped at 1600ms". That
    // schedule only holds for the *first* failure episode if the reset below
    // works: without it the grown delay persists forever, so an unrelated failure
    // much later in the page's life would wait 1600ms on its first retry — and
    // nothing observable says so, because a slow retry still eventually lands.
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const original = storage.setItem.bind(storage);
    let failing = true;
    storage.setItem = (key, value) => {
      if (failing) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      original(key, value);
    };
    const writer = new BatchingStorageWriter(storage);

    // Episode one: three failures grow the delay 50 -> 100 -> 200, then a drain.
    writer.setItem('route:a', '1');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(100);
    failing = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(writer.pendingSize, 'the first episode must have drained').toBe(0);

    // Episode two: a fresh failure must retry at 50ms, not at the grown delay.
    let attempts = 0;
    storage.setItem = () => {
      attempts += 1;
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    };
    writer.setItem('route:b', '2');
    await Promise.resolve();
    attempts = 0;
    await vi.advanceTimersByTimeAsync(50);
    expect(attempts, 'the backoff must restart at the initial delay').toBe(1);
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

  it('cancels retries even when the underlying clear throws', async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      storage.setItem = () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      };
      storage.clear = () => {
        throw new DOMException('SecurityError', 'SecurityError');
      };
      const writer = new BatchingStorageWriter(storage);

      writer.setItem('route', 'pending');
      await Promise.resolve();
      await Promise.resolve();
      expect(writer.pendingSize).toBe(1);
      expect(vi.getTimerCount()).toBe(1);

      expect(() => writer.clear()).toThrow('SecurityError');
      expect(writer.pendingSize).toBe(0);
      expect(vi.getTimerCount()).toBe(0);

      // A later write starts from the initial backoff rather than inheriting
      // state from the failed clear.
      writer.setItem('route-next', 'pending');
      await Promise.resolve();
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(49);
      expect(writer.pendingSize).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(writer.pendingSize).toBe(1);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it('discards pending teardown retries without clearing persisted storage', async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      storage.setItem('persisted', 'keep');
      storage.setItem = () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      };
      const writer = new BatchingStorageWriter(storage);

      writer.setItem('route', 'pending');
      await Promise.resolve();
      expect(writer.pendingSize).toBe(1);
      expect(vi.getTimerCount()).toBe(1);

      writer.discardPending();

      expect(writer.pendingSize).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(storage.getItem('persisted')).toBe('keep');
    } finally {
      vi.useRealTimers();
    }
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

  it('schedules a single retry timer for multiple failing keys in one flush', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    };
    const writer = new BatchingStorageWriter(storage);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writer.setItem('doomed-a', '1');
    writer.setItem('doomed-b', '2');
    await vi.advanceTimersByTimeAsync(10_000);

    // Both keys are eventually dropped, and the drop happens through one
    // shared retry timer rather than one timer per key.
    expect(writer.pendingSize).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('keeps at most one retry timer pending while writes keep failing', async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      storage.setItem = () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      };
      const writer = new BatchingStorageWriter(storage);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First failing flush arms the backoff timer. Drain the coalescing
      // microtask explicitly so the assertion observes the flush result.
      writer.setItem('a', '1');
      await Promise.resolve();
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(1);

      // A write that fails while the retry is still pending must not stack a
      // second timer: flush() cancels the armed retry on entry and re-arms
      // exactly once, so the observable timer count stays at one.
      writer.setItem('b', '2');
      await Promise.resolve();
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(1);

      // Eventually both keys are dropped through the shared timer chain.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(writer.pendingSize).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      warnSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports no key past the end of the enumerated range', () => {
    // StorageLike.key(index) is specified to return null once the index is out
    // of range, and storage-utils' listKeys/readAllByPrefix loop `for
    // (index < length)` and stop on that null. Returning undefined instead
    // would leave those callers reading `undefined` as if it were a key.
    const storage = new MemoryStorage();
    storage.setItem('a', '1');
    const writer = new BatchingStorageWriter(storage);

    expect(writer.key(0)).toBe('a');
    expect(writer.key(1)).toBeNull();
    // A pending write is enumerated too, so the range grows before it flushes.
    writer.setItem('b', '2');
    expect(writer.key(1)).toBe('b');
    expect(writer.key(2)).toBeNull();
  });

  it('skips a null slot reported while enumerating the underlying storage', () => {
    // A storage adapter can report a length it no longer backs (a concurrent
    // clear between the length read and the key read). The null slot must be
    // dropped, not added to the key set as an enumerable entry.
    const storage = new MemoryStorage();
    storage.setItem('a', '1');
    storage.setItem('b', '2');
    storage.key = index => (index === 1 ? null : 'a');
    const writer = new BatchingStorageWriter(storage);

    expect(writer.length).toBe(1);
    expect(writer.key(0)).toBe('a');
    expect(writer.key(1)).toBeNull();
  });

  it('still drops a doomed key when the runtime has no console to warn with', async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      storage.setItem = () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      };
      const writer = new BatchingStorageWriter(storage);
      // Some webview shells strip console methods. Losing the last write must
      // be reported when it can be, but never at the cost of throwing inside
      // the retry path — that surfaces as an unhandled error on a timer.
      vi.stubGlobal('console', { log: () => {} });

      writer.setItem('doomed', 'x');
      await vi.advanceTimersByTimeAsync(2_000);

      expect(writer.pendingSize).toBe(0);
      expect(storage.getItem('doomed')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
