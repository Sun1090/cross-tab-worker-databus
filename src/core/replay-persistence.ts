import type { DataBusMessage } from './types';

/** Optional persistence backend for replay history. */
export interface DataBusReplayPersistence<TData = unknown> {
  load(): Promise<ReadonlyArray<DataBusMessage<TData>>>;
  append(message: DataBusMessage<TData>): Promise<void>;
  /** Remove all persisted replay history. */
  clear?(): Promise<void>;
  /** Remove persisted replay history for one exact topic. */
  clearTopic?(topic: string): Promise<void>;
  /** Remove persisted messages older than the given epoch-millisecond cutoff. */
  clearBefore?(timestamp: number): Promise<void>;
}

export interface IndexedDbReplayPersistenceOptions {
  dbName?: string;
  maxPerTopic: number;
}

/** Create a browser IndexedDB-backed replay store. */
export function createIndexedDbReplayPersistence<TData = unknown>(
  options: IndexedDbReplayPersistenceOptions
): DataBusReplayPersistence<TData> {
  const indexedDb = globalThis.indexedDB;
  if (!indexedDb) throw new Error('IndexedDB is unavailable in this environment.');
  const dbName = options.dbName ?? 'cross-tab-worker-databus';
  const storeName = 'replay';
  const maxPerTopic = options.maxPerTopic;
  if (!Number.isSafeInteger(maxPerTopic) || maxPerTopic <= 0) {
    throw new TypeError(`maxPerTopic must be a positive safe integer, got ${String(maxPerTopic)}.`);
  }
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'topic' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open replay database.'));
    });
    return dbPromise;
  };
  return {
    async load() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result.flatMap(record => record.messages as DataBusMessage<TData>[]));
        request.onerror = () => reject(request.error ?? new Error('Failed to load replay history.'));
      });
    },
    async append(message) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.get(message.topic);
        request.onsuccess = () => {
          const messages = ((request.result?.messages ?? []) as DataBusMessage<TData>[]).concat(message).slice(-maxPerTopic);
          store.put({ topic: message.topic, messages });
        };
        request.onerror = () => reject(request.error ?? new Error('Failed to read replay history.'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Failed to persist replay history.'));
      });
    },
    async clear() {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Failed to clear replay history.'));
      });
    },
    async clearTopic(topic) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(topic);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Failed to clear topic replay history.'));
      });
    },
    async clearBefore(timestamp) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => {
          for (const record of request.result as Array<{ topic: string; messages: DataBusMessage<TData>[] }>) {
            const messages = record.messages.filter(message => (message.timestamp ?? 0) >= timestamp);
            if (messages.length === 0) store.delete(record.topic);
            else if (messages.length !== record.messages.length) store.put({ topic: record.topic, messages });
          }
        };
        request.onerror = () => reject(request.error ?? new Error('Failed to read replay history.'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Failed to prune replay history.'));
      });
    }
  };
}
