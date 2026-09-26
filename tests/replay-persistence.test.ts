/**
 * IndexedDB replay persistence adapter tests.
 *
 * Runs against fake-indexeddb so the mutation-queue serialization, prune
 * strategies, and transient-open-failure recovery are covered in unit tests
 * without a real browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbReplayPersistence } from '../src/core/replay-persistence';
import type { DataBusMessage } from '../src/core/types';
import { expectRejectionMessage } from './fakes';

function message(topic: string, value: number, timestamp?: number): DataBusMessage<{ value: number }> {
  return { topic, data: { value }, ...(timestamp === undefined ? {} : { timestamp }) };
}

/** Assert a promise rejects with `expected`, raced against a real-timer
 * watchdog. Used where a leg's failure mode is an operation that never settles:
 * deleting the leg throws out of an IndexedDB handler, so the plain assertion
 * would report a bare test timeout that names nothing instead. */
async function expectRejectedSettling(promise: Promise<unknown>, expected: string) {
  const outcome = await Promise.race([
    promise.then(() => 'resolved', () => 'rejected'),
    new Promise<string>(resolve => setTimeout(() => resolve('hung'), 500))
  ]);
  expect(outcome).toBe('rejected');
  await expectRejectionMessage(promise, expected);
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

  it('shares one object store across clusterKeys unless the app names the database', async () => {
    // The adapter's database name defaults to the storage prefix and its store
    // name is the constant 'replay', so the store is keyed by the *plaintext
    // topic* and nothing else — no clusterKey, no tab, no session. Two adapters
    // built with default options therefore see each other's rows, which is what
    // this case states rather than asserts as desirable: the `clusterKey`
    // isolation the coordination plane provides does not extend here, and an
    // application running two clusters in one origin (two tenants, two
    // connections) has to pass `dbName` per cluster to get it.
    //
    // What makes it worth pinning rather than only documenting: the isolation
    // claim is a *structural* property of the coordination plane (every key
    // derives from `createOpaqueKey(clusterKey)`), so it is invisible here by
    // construction, and a future default that did namespace the store would
    // change what an application sees on upgrade without any other test failing.
    const first = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    const second = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    await first.append(message('orders', 1));
    expect(await second.load(), 'a second adapter must see the first adapter\'s rows').toEqual([
      message('orders', 1)
    ]);

    // Naming the database is the documented remedy, and it works: a third
    // adapter pointed at its own database sees an empty store.
    const other = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4, dbName: 'tenant-b' });
    expect(await other.load(), 'a named database must not read the default one').toEqual([]);
    await other.append(message('orders', 2));
    expect(await other.load()).toEqual([message('orders', 2)]);
    expect(await first.load(), 'the two must now be independent').toEqual([message('orders', 1)]);
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

  it('still caps persisted history when the age strategy has no retention window', async () => {
    // `pruneStrategy: 'age'` without `retentionMs` has nothing to prune by, so
    // the count cap must still apply to the stored topic record.
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({
      maxPerTopic: 3,
      pruneStrategy: 'age'
    });
    for (let index = 0; index < 6; index += 1) await persistence.append(message('t', index));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([3, 4, 5]);
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

  it('caps timestamp-less legacy history under age retention', async () => {
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({
      maxPerTopic: 2,
      pruneStrategy: 'age',
      retentionMs: 1_000
    });
    await persistence.appendBatch!([
      message('t', 0),
      message('t', 1),
      message('t', 2),
      message('t', 3),
      message('t', 4)
    ]);
    expect((await persistence.load()).map(item => item.data.value)).toEqual([3, 4]);
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

  it('coalesces concurrent appendBatch calls into one transaction', async () => {
    const { IDBDatabase } = await import('fake-indexeddb');
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    try {
      const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 100 });
      // All ten batches enqueue before the first transaction runs; the queue
      // merges the adjacent batch entries into a single read-modify-write.
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          persistence.appendBatch!([message('t', index), message('t', index + 100)])
        )
      );
      const readwrite = transactionSpy.mock.calls.filter(call => call[1] === 'readwrite').length;
      expect(readwrite).toBe(1);

      const loaded = await persistence.load();
      expect(loaded).toHaveLength(20);
      // Per-topic order is preserved across the merged batches (each batch i
      // contributed [i, i+100]).
      expect(loaded.map(item => item.data.value)).toEqual([
        0, 100, 1, 101, 2, 102, 3, 103, 4, 104, 5, 105, 6, 106, 7, 107, 8, 108, 9, 109
      ]);
    } finally {
      transactionSpy.mockRestore();
    }
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

  /** Wrap the real fake-indexeddb factory so the adapter's DB surface fails
   * in scripted ways. The open() stub resolves with a proxied IDBDatabase:
   * 'transaction-throws' breaks transaction construction, 'request-fails'
   * makes store requests error, 'request-then-success' lets a later grouped
   * read succeed before the transaction itself errors,
   * 'transaction-errors' constructs a healthy transaction whose own onerror
   * fires after the reads succeed, and 'transaction-aborts' does the same via
   * onabort. Only exists to drive the adapter's error/invalidation paths that
   * a healthy fake-indexeddb cannot reach. */
  function makeBrokenFactory(
    mode: 'transaction-throws' | 'request-fails' | 'request-then-success' | 'transaction-errors' | 'transaction-aborts',
    abortError: Error | null = new Error('transaction aborted'),
    requestError: Error | null = new Error('request failed')
  ) {
    // The adapter captures the factory at creation time, so recovery must go
    // through the same factory; `disabled` switches it back to healthy.
    const control = { disabled: false };
    const wrapped = {
      open(name: string, version?: number) {
        if (control.disabled) return factory.open(name, version);
        const stub: {
          onupgradeneeded: unknown;
          onsuccess: ((event: unknown) => void) | null;
          onerror: ((event: unknown) => void) | null;
          result: IDBDatabase | null;
          error: unknown;
        } = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null, error: null };
        const inner = factory.open(name, version);
        // Forward the upgrade handler so a fresh database still gets its
        // object store; the adapter's handler reads `request.result`, which
        // must point at the upgrading connection during the upgrade.
        inner.onupgradeneeded = () => {
          stub.result = inner.result;
          (stub.onupgradeneeded as ((event: unknown) => void) | null)?.({ target: stub });
        };
        inner.onsuccess = () => {
          const realDb = inner.result;
          stub.result = new Proxy(realDb, {
            get(target, prop) {
              if (prop === 'transaction') {
                if (mode === 'transaction-throws') {
                  return () => {
                    throw new DOMException('The connection is closed.', 'InvalidStateError');
                  };
                }
                return (storeNames: string, txMode: IDBTransactionMode) => {
                  const tx = target.transaction(storeNames, txMode);
                  if (mode === 'request-fails' || mode === 'request-then-success') {
                    const originalStore = tx.objectStore(storeNames);
                    let requestCount = 0;
                    const failingRequest = () => {
                      const requestStub: {
                        onsuccess: ((event: unknown) => void) | null;
                        onerror: ((event: unknown) => void) | null;
                        result: undefined;
                        error: Error | null;
                        readyState: string;
                      } = { onsuccess: null, onerror: null, result: undefined, error: requestError, readyState: 'done' };
                      queueMicrotask(() => requestStub.onerror?.({ target: requestStub }));
                      return requestStub;
                    };
                    const succeedingRequest = () => {
                      const requestStub: {
                        onsuccess: ((event: unknown) => void) | null;
                        onerror: ((event: unknown) => void) | null;
                        result: undefined;
                        error: null;
                        readyState: string;
                      } = { onsuccess: null, onerror: null, result: undefined, error: null, readyState: 'done' };
                      queueMicrotask(() => requestStub.onsuccess?.({ target: requestStub }));
                      return requestStub;
                    };
                    const request = () => (
                      mode === 'request-then-success' && requestCount++ > 0
                        ? succeedingRequest()
                        : failingRequest()
                    );
                    // The adapter attaches oncomplete/onerror on the
                    // transaction it got from db.transaction(); forward those
                    // to the real transaction so completion actually fires.
                    return {
                      objectStore: () => ({
                        get: request,
                        getAll: request,
                        put: originalStore.put.bind(originalStore),
                        delete: originalStore.delete.bind(originalStore),
                        clear: originalStore.clear.bind(originalStore)
                      }),
                      get oncomplete() { return tx.oncomplete; },
                      set oncomplete(value) { tx.oncomplete = value; },
                      get onerror() { return tx.onerror; },
                      set onerror(value) {
                        tx.onerror = value;
                        if (mode === 'request-then-success') {
                          const fire = value as unknown as ((event: unknown) => void) | null;
                          queueMicrotask(() => fire?.({ target: { error: new Error('transaction failed') } }));
                        }
                      }
                    };
                  }
                  if (mode === 'transaction-errors' || mode === 'transaction-aborts') {
                    // A quota-exceeded `put` aborts the whole transaction
                    // without any request the adapter attached a handler to
                    // erroring first, so `transaction.onerror` is the only
                    // signal. The reads must succeed so the adapter's
                    // `hasError` latch is still clear when the abort lands.
                    return {
                      objectStore: () => ({
                        get: () => {
                          const requestStub: { onsuccess: ((event: unknown) => void) | null; onerror: ((event: unknown) => void) | null; result: undefined } = {
                            onsuccess: null,
                            onerror: null,
                            result: undefined
                          };
                          queueMicrotask(() => requestStub.onsuccess?.({ target: requestStub }));
                          return requestStub;
                        },
                        getAll: () => {
                          const requestStub: { onsuccess: ((event: unknown) => void) | null; onerror: ((event: unknown) => void) | null; result: unknown[] } = {
                            onsuccess: null,
                            onerror: null,
                            result: []
                          };
                          queueMicrotask(() => requestStub.onsuccess?.({ target: requestStub }));
                          return requestStub;
                        },
                        put: () => {},
                        delete: () => {},
                        clear: () => {}
                      }),
                      get oncomplete() { return tx.oncomplete; },
                      set oncomplete(value) { tx.oncomplete = value; },
                      set onerror(value: IDBTransaction['onerror']) {
                        tx.onerror = value;
                        if (mode === 'transaction-errors') {
                          // Fired after the per-topic reads above, so the error
                          // is not masked by a request-error early return.
                          const fire = value as unknown as ((event: unknown) => void) | null;
                          queueMicrotask(() => fire?.({ target: { error: abortError } }));
                        }
                      },
                      set onabort(value: IDBTransaction['onabort']) {
                        if (mode === 'transaction-aborts') {
                          // A connection loss can abort without onerror. Fire
                          // only this handler so the test proves onabort settles
                          // each operation rather than relying on the onerror
                          // path as an accidental substitute.
                          const fire = value as unknown as ((event: unknown) => void) | null;
                          queueMicrotask(() => fire?.({ target: { error: abortError } }));
                        }
                      },
                      // The adapter reads `transaction.error` when building the
                      // rejection, so the wrapper must surface it too.
                      get error() { return abortError; }
                    };
                  }
                  return tx;
                };
              }
              const value = Reflect.get(target, prop);
              return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
            }
          });
          stub.onsuccess?.({ target: stub });
        };
        inner.onerror = () => stub.onerror?.({ target: stub });
        return stub;
      }
    };
    return Object.assign(wrapped, { disable: () => { control.disabled = true; } });
  }

  /** Wrap the real factory so the first transactions the adapter starts report
   * their abort on a schedule instead of on the next microtask. A real
   * implementation queues each event of an aborted transaction as its own task,
   * so a handler can run long after the adapter invalidated that connection and
   * opened another; `makeBrokenFactory` dispatches inside one microtask batch
   * and cannot express that gap. `delaysMs` is consumed per transaction in
   * creation order and a transaction past the end of the list is left healthy.
   * Signalled transactions are never forwarded to the real transaction, because
   * its own completion would settle the operation before the scheduled abort. */
  function makeScheduledFailureFactory(delaysMs: number[]) {
    // The adapter captures the factory at creation time, so a healthy reopen
    // still has to go through this object.
    const control = { disabled: false };
    let openCalls = 0;
    let transactions = 0;
    const wrapped = {
      open(name: string, version?: number) {
        openCalls += 1;
        if (control.disabled) return factory.open(name, version);
        const request = factory.open(name, version);
        const stub: {
          onupgradeneeded: unknown;
          onsuccess: ((event: unknown) => void) | null;
          onerror: ((event: unknown) => void) | null;
          result: IDBDatabase | null;
          error: unknown;
        } = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null, error: null };
        request.onupgradeneeded = () => {
          stub.result = request.result;
          (stub.onupgradeneeded as ((event: unknown) => void) | null)?.({ target: stub });
        };
        request.onsuccess = () => {
          const realDb = request.result;
          stub.result = new Proxy(realDb, {
            get(target, prop) {
              if (prop === 'transaction') {
                return (storeNames: string, txMode: IDBTransactionMode) => {
                  const delay = transactions < delaysMs.length ? delaysMs[transactions] : null;
                  transactions += 1;
                  if (delay === null) return target.transaction(storeNames, txMode);
                  const abortError = new Error('transaction aborted');
                  const succeed = () => {
                    const requestStub: {
                      onsuccess: ((event: unknown) => void) | null;
                      onerror: ((event: unknown) => void) | null;
                      result: unknown[];
                    } = { onsuccess: null, onerror: null, result: [] };
                    queueMicrotask(() => requestStub.onsuccess?.({ target: requestStub }));
                    return requestStub;
                  };
                  const dispatch = (handler: ((event: unknown) => void) | null) => {
                    if (handler === null) return;
                    if (delay === 0) queueMicrotask(() => handler({ target: { error: abortError } }));
                    else setTimeout(() => handler({ target: { error: abortError } }), delay);
                  };
                  return {
                    objectStore: () => ({
                      get: succeed,
                      getAll: succeed,
                      put: () => undefined,
                      delete: () => undefined,
                      clear: () => undefined
                    }),
                    oncomplete: null as IDBTransaction['oncomplete'],
                    set onerror(value: IDBTransaction['onerror']) {
                      dispatch(value as unknown as ((event: unknown) => void) | null);
                    },
                    set onabort(value: IDBTransaction['onabort']) {
                      dispatch(value as unknown as ((event: unknown) => void) | null);
                    },
                    get error() { return abortError; }
                  };
                };
              }
              const value = Reflect.get(target, prop);
              return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
            }
          });
          stub.onsuccess?.({ target: stub });
        };
        request.onerror = () => stub.onerror?.({ target: request });
        return stub;
      },
      get openCalls() { return openCalls; }
    };
    return Object.assign(wrapped, {
      disable: () => { control.disabled = true; }
    });
  }

  it('invalidates the connection when transaction construction fails', async () => {
    const broken = makeBrokenFactory('transaction-throws');
    // The adapter captures the factory at creation time, so the broken
    // factory must be installed first.
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    await expect(persistence.append(message('t', 1))).rejects.toThrow('connection is closed');
    // The failed connection was invalidated; disabling the fault recovers
    // through the same captured factory.
    broken.disable();
    await persistence.append(message('t', 2));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([2]);
  });

  it('rejects and invalidates when the store request fails mid-append', async () => {
    const broken = makeBrokenFactory('request-fails');
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    await expect(persistence.append(message('t', 1))).rejects.toThrow();
    broken.disable();
    await persistence.append(message('t', 2));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([2]);
  });

  it('throws when IndexedDB is unavailable in the environment', () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    expect(() => createIndexedDbReplayPersistence({ maxPerTopic: 4 })).toThrow('IndexedDB is unavailable');
  });

  it('preserves ordering when a clear is interleaved between appends', async () => {
    // The coalescing loop merges only *adjacent* batch entries; a queued
    // clear must break the merge so the pre-clear appends are not resurrected
    // into the post-clear transaction.
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 10 });
    const first = persistence.append(message('t', 1));
    const cleared = persistence.clear!();
    const second = persistence.append(message('t', 2));
    await Promise.all([first, cleared, second]);
    expect((await persistence.load()).map(item => item.data.value)).toEqual([2]);
  });

  it('closes and drops the cached connection on a versionchange from another tab', async () => {
    const dbName = 'versionchange-db';
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ dbName, maxPerTopic: 4 });
    await persistence.append(message('t', 1));

    // Another tab starts a schema upgrade. Without the adapter's
    // onversionchange handler the open v1 connection would block the upgrade
    // forever; the handler closes it so the upgrade can proceed.
    const upgrade = factory.open(dbName, 2);
    let blocked = false;
    upgrade.onblocked = () => { blocked = true; };
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      upgrade.onupgradeneeded = () => undefined;
      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () => reject(upgrade.error);
    });
    upgraded.close();
    expect(blocked).toBe(false);

    // The cached promise was cleared, so the next operation reopens rather
    // than reusing the closed connection. Version 1 is now stale, so the
    // reopen surfaces a clean rejection instead of an InvalidStateError on a
    // dead handle.
    await expect(persistence.append(message('t', 2))).rejects.toBeTruthy();
  });

  it('invalidates the connection when transaction construction fails on every mutation path', async () => {
    for (const operation of ['load', 'clear', 'clearTopic', 'clearBefore'] as const) {
      const broken = makeBrokenFactory('transaction-throws');
      (globalThis as { indexedDB?: unknown }).indexedDB = broken;
      const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
      const call = operation === 'load'
        ? persistence.load()
        : operation === 'clear'
          ? persistence.clear!()
          : operation === 'clearTopic'
            ? persistence.clearTopic!('t')
            : persistence.clearBefore!(1_000);
      await expect(call).rejects.toThrow('connection is closed');
      // Recovery through the same captured factory proves the connection was
      // invalidated rather than left cached in a dead state.
      broken.disable();
      await persistence.append(message('t', 1));
      expect((await persistence.load()).map(item => item.data.value)).toEqual([1]);
      await persistence.clear!();
    }
  });

  it('rejects a batched append only once when several store reads fail', async () => {
    // The hasError latch must keep the first failure authoritative: multiple
    // failing per-topic reads in one transaction must not double-reject or
    // resolve on completion.
    const broken = makeBrokenFactory('request-fails');
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    await expect(persistence.appendBatch!([message('a', 1), message('b', 2), message('c', 3)])).rejects.toThrow('request failed');
    broken.disable();
    await persistence.append(message('a', 9));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([9]);
  });

  it('rejects and invalidates when the transaction errors with no request error', async () => {
    // A quota-exceeded `put` aborts the entire transaction. The adapter only
    // attaches handlers to its `get` requests, so nothing it listens to errors
    // — `transaction.onerror` is the sole signal. Without it the append never
    // rejects: a real error-caused abort fires `onabort`, not `oncomplete`, so
    // the replay queue would hang (this stub completes instead, which is why
    // the guard fails as "promise resolved instead of rejecting").
    const broken = makeBrokenFactory('transaction-errors');
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });

    await expect(persistence.appendBatch!([message('a', 1), message('b', 2)])).rejects.toThrow('transaction aborted');

    // The aborted connection was invalidated, so the adapter recovers through
    // the same captured factory once the fault is lifted.
    broken.disable();
    await persistence.append(message('a', 9));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([9]);
  });

  it('rejects and invalidates when onabort fires without a preceding request error', async () => {
    // Connection loss may dispatch only `onabort`; the serialized mutation
    // queue must settle or every later append would remain permanently queued.
    const broken = makeBrokenFactory('transaction-aborts');
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });

    await expect(persistence.appendBatch!([message('a', 1), message('b', 2)])).rejects.toThrow('transaction aborted');

    broken.disable();
    await persistence.append(message('a', 9));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([9]);
  });

  it('rejects load and invalidates the connection when onabort fires', async () => {
    const broken = makeBrokenFactory('transaction-aborts');
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });

    await expect(persistence.load()).rejects.toThrow('transaction aborted');

    broken.disable();
    await persistence.append(message('t', 7));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([7]);
  });

  it('keeps the connection a later operation reopened when an older signal lands late', async () => {
    // Three loads share the first connection and its transactions report their
    // abort at 0ms, 15ms and 40ms. The first invalidation runs while the cache
    // still names that connection. The second finds the cache already empty —
    // `invalidate` has no pointer to drop, and reading it unguarded would throw
    // out of the abort handler. Only then does a healthy append reopen and
    // repopulate the cache, so the third finds a *different*, live connection
    // cached: the identity check is what keeps that stale signal from closing it
    // and evicting it, and the open count below is the observable of either
    // happening. Deleting the check makes this test report a third open.
    const scheduled = makeScheduledFailureFactory([0, 15, 40]);
    (globalThis as { indexedDB?: unknown }).indexedDB = scheduled;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({
      dbName: 'late-signal-db',
      maxPerTopic: 4
    });

    const first = persistence.load();
    const second = persistence.load();
    const third = persistence.load();

    // Attach every handler before awaiting anything. The 40 ms abort is dispatched
    // by a real timer, while `third`'s assertion used to sit *after* a healthy reopen
    // round trip — so on a loaded runner that round trip could take longer than 40 ms,
    // the rejection landed with no handler attached yet, and the run reported
    // `Unhandled Rejection: Error: transaction aborted` with **all** tests passing and
    // `pnpm test:coverage` exiting 1. Reproduced and settled in isolation: a rejection
    // that fires before its assertion is attached fails the run, the same timing with
    // the handler attached up front exits 0.
    const firstRejected = expectRejectedSettling(first, 'transaction aborted');
    const secondRejected = expectRejectedSettling(second, 'transaction aborted');
    const thirdRejected = expectRejectedSettling(third, 'transaction aborted');

    await firstRejected;
    await secondRejected;

    scheduled.disable();
    await persistence.append(message('a', 9));
    expect(scheduled.openCalls).toBe(2);

    await thirdRejected;

    expect(scheduled.openCalls).toBe(2);
    expect((await persistence.load()).map(item => item.data.value)).toEqual([9]);
    expect(scheduled.openCalls).toBe(2);
  });

  it('falls back to a generic message when opening fails without an error object', async () => {
    const flakyFactory = {
      open() {
        const request = { error: null, onerror: null } as unknown as IDBOpenDBRequest;
        queueMicrotask(() => request.onerror?.call(request, { target: request } as unknown as Event));
        return request;
      }
    };
    (globalThis as { indexedDB?: unknown }).indexedDB = flakyFactory;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });

    await expectRejectionMessage(persistence.append(message('t', 1)), 'Failed to open replay database.');
  });

  it('falls back to generic request messages when IndexedDB requests carry no error', async () => {
    const broken = makeBrokenFactory('request-fails', undefined, null);
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });

    await expectRejectionMessage(persistence.load(), 'Failed to load replay history.');
    await expectRejectionMessage(persistence.append(message('t', 1)), 'Failed to read replay history.');
    await expectRejectionMessage(persistence.clearBefore!(1_000), 'Failed to read replay history.');
  });

  it('keeps the first grouped-read failure authoritative after a later read succeeds and the transaction errors', async () => {
    const broken = makeBrokenFactory('request-then-success');
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });

    await expect(
      persistence.appendBatch!([message('a', 1), message('b', 2)])
    ).rejects.toThrow('request failed');

    broken.disable();
    await persistence.append(message('a', 9));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([9]);
  });

  it('uses domain fallback messages when clear mutations abort without an error', async () => {
    const cases = [
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clear!(),
        message: 'Failed to clear replay history.'
      },
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clearTopic!('t'),
        message: 'Failed to clear topic replay history.'
      },
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clearBefore!(1_000),
        message: 'Failed to prune replay history.'
      }
    ];

    for (const testCase of cases) {
      const broken = makeBrokenFactory('transaction-aborts', null);
      (globalThis as { indexedDB?: unknown }).indexedDB = broken;
      const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
      await expectRejectionMessage(testCase.run(persistence), testCase.message);
    }
  });

  it('rejects and invalidates when clear mutations fail at the transaction level', async () => {
    const cases = [
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clear!(),
        label: 'clear'
      },
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clearTopic!('t'),
        label: 'clearTopic'
      },
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clearBefore!(1_000),
        label: 'clearBefore'
      }
    ];

    for (const [index, testCase] of cases.entries()) {
      const broken = makeBrokenFactory('transaction-errors');
      (globalThis as { indexedDB?: unknown }).indexedDB = broken;
      const persistence = createIndexedDbReplayPersistence<{ value: number }>({
        dbName: `clear-transaction-error-${testCase.label}`,
        maxPerTopic: 4
      });

      await expect(testCase.run(persistence)).rejects.toThrow('transaction aborted');

      // The failed transaction invalidated the cached connection; the same
      // adapter must be able to reopen and persist once the fault is disabled.
      broken.disable();
      await persistence.append(message('recovered', index));
      expect((await persistence.load()).map(item => item.data.value)).toEqual([index]);
    }
  });

  it('uses domain fallback messages when clear transactions error without an error object', async () => {
    const cases = [
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clear!(),
        message: 'Failed to clear replay history.'
      },
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clearTopic!('t'),
        message: 'Failed to clear topic replay history.'
      },
      {
        run: (persistence: ReturnType<typeof createIndexedDbReplayPersistence<{ value: number }>>) => persistence.clearBefore!(1_000),
        message: 'Failed to prune replay history.'
      }
    ];

    for (const testCase of cases) {
      const broken = makeBrokenFactory('transaction-errors', null);
      (globalThis as { indexedDB?: unknown }).indexedDB = broken;
      const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
      await expectRejectionMessage(testCase.run(persistence), testCase.message);
    }
  });

  it('falls back to a generic message when an aborted transaction carries no error', async () => {
    // `transaction.error` is normally set on an error-caused abort, but the
    // adapter must still reject with a useful message if a browser leaves it
    // null rather than rejecting with `undefined`.
    const broken = makeBrokenFactory('transaction-aborts', null);
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    await expectRejectionMessage(persistence.append(message('a', 1)), 'Failed to persist replay history.');
  });

  it('falls back to a generic message when a read-only load transaction aborts without an error', async () => {
    // The load path builds its own rejection message, so it needs its own
    // null-error case: without the fallback `load()` rejects with `null`,
    // which surfaces to `ready()`/hydration callers as a failure with nothing
    // to report.
    const broken = makeBrokenFactory('transaction-aborts', null);
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });
    await expectRejectionMessage(persistence.load(), 'Failed to load replay history.');

    broken.disable();
    await persistence.append(message('t', 5));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([5]);
  });

  it('rejects and invalidates when a store request fails during load or clearBefore', async () => {
    const broken = makeBrokenFactory('request-fails');
    (globalThis as { indexedDB?: unknown }).indexedDB = broken;
    const persistence = createIndexedDbReplayPersistence<{ value: number }>({ maxPerTopic: 4 });

    // Load path: the getAll request errors and must propagate.
    await expect(persistence.load()).rejects.toThrow('request failed');

    // clearBefore reads records via getAll before pruning — the failed read
    // must reject the whole operation, not silently resolve.
    await expect(persistence.clearBefore!(1_000)).rejects.toThrow('request failed');

    // After the faults are disabled, the invalidated connection reopens and
    // the recovered adapter works again end to end.
    broken.disable();
    await persistence.append(message('t', 3));
    expect((await persistence.load()).map(item => item.data.value)).toEqual([3]);
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
  });
});
