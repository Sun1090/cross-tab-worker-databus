/**
 * BatchingStorageWriter — coalesced, resilient localStorage writes.
 *
 * Decorates a StorageLike with write coalescing: mutations within the same task
 * are merged by key and flushed once via a microtask, with exponential backoff
 * on quota/failure. Keeps the coordination metadata writes off the hot path.
 */
import type { StorageLike } from './environment';

const INITIAL_RETRY_DELAY_MS = 50;
const MAX_RETRY_DELAY_MS = 1_600;

/**
 * Coalesces synchronous storage writes and applies them in one pass, with
 * exponential backoff when the underlying storage rejects a write.
 */
export class BatchingStorageWriter implements StorageLike {
  /** Coalesced write set. A `null` value represents a pending delete. */
  private readonly pending = new Map<string, string | null>();
  private flushScheduled = false;
  private retryHandle: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = INITIAL_RETRY_DELAY_MS;

  constructor(private readonly storage: StorageLike) {}

  get pendingSize(): number {
    return this.pending.size;
  }

  get length(): number {
    return this.keys().length;
  }

  clear(): void {
    this.pending.clear();
    this.flushScheduled = false;
    this.storage.clear();
    this.cancelRetry();
    // Reset backoff so a burst of clear()/flush() cycles does not leave the
    // writer stuck at an elevated retry delay.
    this.retryDelayMs = INITIAL_RETRY_DELAY_MS;
  }

  // Reads always see the pending value first (task-local consistency), then
  // fall back to the underlying storage.
  getItem(key: string): string | null {
    if (this.pending.has(key)) return this.pending.get(key) ?? null;
    return this.storage.getItem(key);
  }

  key(index: number): string | null {
    return this.keys()[index] ?? null;
  }

  removeItem(key: string): void {
    this.pending.set(key, null);
    this.scheduleFlush();
  }

  setItem(key: string, value: string): void {
    this.pending.set(key, value);
    this.scheduleFlush();
  }

  flush(): void {
    this.flushScheduled = false;
    this.cancelRetry();
    // Apply writes from a snapshot so a concurrent scheduleFlush during the
    // loop cannot re-enter or corrupt the pending map mid-iteration.
    for (const [key, value] of [...this.pending]) {
      try {
        if (value === null) this.storage.removeItem(key);
        else this.storage.setItem(key, value);
        this.pending.delete(key);
      } catch {
        // A failed write (e.g. quota exceeded) retries with backoff; remaining
        // pending writes stay queued for the next attempt.
        this.scheduleRetry();
        break;
      }
    }
    if (this.pending.size === 0) this.retryDelayMs = INITIAL_RETRY_DELAY_MS;
  }

  /** Union of persisted keys and pending writes, minus pending deletes. */
  private keys(): string[] {
    const keys = new Set<string>();
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key !== null) keys.add(key);
    }
    for (const [key, value] of this.pending) {
      if (value === null) keys.delete(key);
      else keys.add(key);
    }
    return [...keys];
  }

  // Coalesce all synchronous writes within one task into a single microtask
  // flush, avoiding a localStorage write per heartbeat/route/subscriber update.
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const flush = () => {
      this.flushScheduled = false;
      this.flush();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(flush);
    else setTimeout(flush, 0);
  }

  private scheduleRetry(): void {
    if (this.retryHandle !== null) return;
    this.retryHandle = setTimeout(() => {
      this.retryHandle = null;
      this.flush();
    }, this.retryDelayMs);
    // Exponential backoff: 50ms → 100ms → … → capped at 1600ms.
    this.retryDelayMs = Math.min(MAX_RETRY_DELAY_MS, this.retryDelayMs * 2);
  }

  private cancelRetry(): void {
    if (this.retryHandle !== null) {
      clearTimeout(this.retryHandle);
      this.retryHandle = null;
    }
  }
}
