import type { DataBusMessage } from './types';
import { DEFAULT_STORAGE_PREFIX, PRUNE_STRATEGY } from '../utils/constants';
import { assertPositiveFiniteNumber, assertPositiveSafeInteger, assertPruneStrategy } from '../utils/validation';

/** Optional persistence backend for replay history. */
export interface DataBusReplayPersistence<TData = unknown> {
  load(): Promise<ReadonlyArray<DataBusMessage<TData>>>;
  append(message: DataBusMessage<TData>): Promise<void>;
  /** Optional bulk append used to amortize IndexedDB transaction overhead. */
  appendBatch?(messages: ReadonlyArray<DataBusMessage<TData>>): Promise<void>;
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
  pruneStrategy?: (typeof PRUNE_STRATEGY)[keyof typeof PRUNE_STRATEGY];
  retentionMs?: number;
}

/** Create a browser IndexedDB-backed replay store. */
export function createIndexedDbReplayPersistence<TData = unknown>(
  options: IndexedDbReplayPersistenceOptions
): DataBusReplayPersistence<TData> {
  const indexedDb = globalThis.indexedDB;
  if (!indexedDb) throw new Error('IndexedDB is unavailable in this environment.');
  const dbName = options.dbName ?? DEFAULT_STORAGE_PREFIX;
  const storeName = 'replay';
  const maxPerTopic = options.maxPerTopic;
  const pruneStrategy = options.pruneStrategy ?? PRUNE_STRATEGY.COUNT;
  const retentionMs = options.retentionMs;
  assertPruneStrategy(pruneStrategy);
  if (retentionMs !== undefined) assertPositiveFiniteNumber(retentionMs, 'retentionMs');
  assertPositiveSafeInteger(maxPerTopic, 'maxPerTopic');
  let dbPromise: Promise<IDBDatabase> | null = null;
  const invalidate = (db: IDBDatabase): void => {
    if (dbPromise) {
      void dbPromise.then(current => {
        if (current === db) {
          current.close();
          dbPromise = null;
        }
      }, () => undefined);
    }
  };
  // IndexedDB transactions are atomic, but a read-modify-write append can
  // still lose updates when callers start several appends concurrently.
  // Serialize all mutations per adapter instance while keeping reads free.
  let mutationQueue: Promise<void> = Promise.resolve();
  const serializeMutation = (mutation: () => Promise<void>): Promise<void> => {
    const next = mutationQueue.then(mutation, mutation);
    mutationQueue = next.catch(() => undefined);
    return next;
  };
  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDb.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'topic' });
      request.onsuccess = () => {
        const db = request.result;
        // A schema upgrade in another tab invalidates this connection. Close
        // it and clear the cached promise so the next operation reopens a
        // usable connection instead of repeatedly targeting a dead database.
        db.onversionchange = () => {
          db.close();
          if (dbPromise) dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to open replay database.'));
    });
    dbPromise = pending;
    // Do not permanently cache a rejected open promise. IndexedDB can fail
    // transiently (quota, private-mode initialization, a closing connection,
    // or a browser shutdown); the next operation must be able to retry.
    void pending.catch(() => {
      if (dbPromise === pending) dbPromise = null;
    });
    return pending;
  };
  return {
    async load() {
      const db = await open();
      return new Promise((resolve, reject) => {
        let request: IDBRequest;
        try {
          request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        } catch (error) {
          invalidate(db);
          reject(error);
          return;
        }
        request.onsuccess = () => resolve((request.result as Array<{ messages: DataBusMessage<TData>[] }>).flatMap(record => record.messages));
        request.onerror = () => {
          invalidate(db);
          reject(request.error ?? new Error('Failed to load replay history.'));
        };
      });
    },
    append(message) {
      return serializeMutation(async () => {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
        let transaction: IDBTransaction;
        try { transaction = db.transaction(storeName, 'readwrite'); }
        catch (error) { invalidate(db); reject(error); return; }
        const store = transaction.objectStore(storeName);
        const request = store.get(message.topic);
        request.onsuccess = () => {
          let messages = ((request.result?.messages ?? []) as DataBusMessage<TData>[]).concat(message);
          if (pruneStrategy !== PRUNE_STRATEGY.COUNT && retentionMs !== undefined) {
            const cutoff = Date.now() - retentionMs;
            messages = messages.filter(item => item.timestamp === undefined || item.timestamp >= cutoff);
          }
          if (pruneStrategy !== PRUNE_STRATEGY.AGE) messages = messages.slice(-maxPerTopic);
          store.put({ topic: message.topic, messages });
        };
        request.onerror = () => { invalidate(db); reject(request.error ?? new Error('Failed to read replay history.')); };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => { invalidate(db); reject(transaction.error ?? new Error('Failed to persist replay history.')); };
        });
      });
    },
    appendBatch(messages) {
      if (messages.length === 0) return Promise.resolve();
      return serializeMutation(async () => {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
          let transaction: IDBTransaction;
          try { transaction = db.transaction(storeName, 'readwrite'); }
          catch (error) { invalidate(db); reject(error); return; }
          const store = transaction.objectStore(storeName);
          const grouped = new Map<string, DataBusMessage<TData>[]>();
          for (const message of messages) grouped.set(message.topic, [...(grouped.get(message.topic) ?? []), message]);
          for (const [topic, topicMessages] of grouped) {
            const request = store.get(topic);
            request.onsuccess = () => {
              let history = ((request.result?.messages ?? []) as DataBusMessage<TData>[]).concat(topicMessages);
              if (pruneStrategy !== PRUNE_STRATEGY.COUNT && retentionMs !== undefined) {
                const cutoff = Date.now() - retentionMs;
                history = history.filter(item => item.timestamp === undefined || item.timestamp >= cutoff);
              }
              if (pruneStrategy !== PRUNE_STRATEGY.AGE) history = history.slice(-maxPerTopic);
              store.put({ topic, messages: history });
            };
            request.onerror = () => { invalidate(db); reject(request.error ?? new Error('Failed to read replay history.')); };
          }
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => { invalidate(db); reject(transaction.error ?? new Error('Failed to persist replay history batch.')); };
        });
      });
    },
    clear() {
      return serializeMutation(async () => {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
        let transaction: IDBTransaction;
        try { transaction = db.transaction(storeName, 'readwrite'); }
        catch (error) { invalidate(db); reject(error); return; }
        transaction.objectStore(storeName).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => { invalidate(db); reject(transaction.error ?? new Error('Failed to clear replay history.')); };
        });
      });
    },
    clearTopic(topic) {
      return serializeMutation(async () => {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
        let transaction: IDBTransaction;
        try { transaction = db.transaction(storeName, 'readwrite'); }
        catch (error) { invalidate(db); reject(error); return; }
        transaction.objectStore(storeName).delete(topic);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => { invalidate(db); reject(transaction.error ?? new Error('Failed to clear topic replay history.')); };
        });
      });
    },
    clearBefore(timestamp) {
      return serializeMutation(async () => {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
        let transaction: IDBTransaction;
        try { transaction = db.transaction(storeName, 'readwrite'); }
        catch (error) { invalidate(db); reject(error); return; }
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => {
          for (const record of request.result as Array<{ topic: string; messages: DataBusMessage<TData>[] }>) {
            const messages = record.messages.filter(message => message.timestamp === undefined || message.timestamp >= timestamp);
            if (messages.length === 0) store.delete(record.topic);
            else if (messages.length !== record.messages.length) store.put({ topic: record.topic, messages });
          }
        };
        request.onerror = () => { invalidate(db); reject(request.error ?? new Error('Failed to read replay history.')); };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => { invalidate(db); reject(transaction.error ?? new Error('Failed to prune replay history.')); };
        });
      });
    }
  };
}
