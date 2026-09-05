/**
 * BatchingStorageWriter — coalesced, resilient localStorage writes.
 *
 * Decorates a StorageLike with write coalescing: mutations within the same task
 * are merged by key and flushed once via a microtask, with exponential backoff
 * on quota/failure. Keeps the coordination metadata writes off the hot path.
 */
import type { StorageLike } from './environment';
import { DEFAULT_STORAGE_PREFIX } from '../utils/constants';

/** Initial retry delay for a failed storage write (ms). */
const INITIAL_RETRY_DELAY_MS = 50;
/** Maximum retry delay after exponential backoff (ms). Caps at 1.6 s so a
 * persistently failing key retries roughly every 1-2 s, not every minute. */
const MAX_RETRY_DELAY_MS = 1_600;
// Max retry attempts per key before giving up and dropping the write, so a
// structurally failing key (e.g. a payload the underlying storage rejects)
// cannot stall coordination forever. The local transport remains usable.
const MAX_RETRY_ATTEMPTS = 5;

/**
 * Coalesces synchronous storage writes and applies them in one pass, with
 * exponential backoff when the underlying storage rejects a write.
 */
/**
 * Coalesces synchronous storage writes and applies them in one pass, with
 * exponential backoff when the underlying storage rejects a write.
 *
 * Wraps a {@link StorageLike} so callers (WorkerClusterRuntime) see a normal
 * storage interface; reads transparently see pending writes before they flush.
 * The coalescing window is one microtask, so a burst of heartbeat + route +
 * subscriber writes in the same task becomes a single localStorage flush.
 */
export class BatchingStorageWriter implements StorageLike {
  /** Coalesced write set. A `null` value represents a pending delete. */
  private readonly pending = new Map<string, string | null>();
  /** Per-key retry counter, reset on a successful write. */
  private readonly retryCount = new Map<string, number>();
  private flushScheduled = false;
  private retryHandle: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = INITIAL_RETRY_DELAY_MS;

  constructor(private readonly storage: StorageLike) {}

  /** Number of writes queued in memory but not yet flushed to storage.
   * Used by tests to assert the coalescing window and by flush() to detect
   * the all-drained state. */
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
    this.retryCount.clear();
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
    // Array.from is preferred over [...this.pending] here: it avoids the
    // spread's intermediate iterator allocation on a hot path that heartbeats
    // and route writes hit every few seconds.
    for (const [key, value] of Array.from(this.pending)) {
      try {
        if (value === null) this.storage.removeItem(key);
        else this.storage.setItem(key, value);
        this.pending.delete(key);
        this.retryCount.delete(key);
      } catch {
        const attempts = (this.retryCount.get(key) ?? 0) + 1;
        // A persistently failing key (e.g. a payload the storage rejects)
        // is dropped after MAX_RETRY_ATTEMPTS so coordination is not stuck
        // forever. Best-effort: the local transport stays usable without it.
        if (attempts >= MAX_RETRY_ATTEMPTS) {
          this.pending.delete(key);
          this.retryCount.delete(key);
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn(`[${DEFAULT_STORAGE_PREFIX}] storage write gave up after retries, dropping key:`, key);
          }
          continue;
        }
        this.retryCount.set(key, attempts);
        // Remaining pending writes stay queued for the next attempt, which
        // retries with backoff. Coalescing is preserved by setting the gate
        // so a concurrent scheduleFlush cannot start a second overlapping pass.
        // `break` stops the flush at the first failure so the retry loop can
        // re-attempt this key (and the remaining pending entries) together,
        // rather than continuing to apply later keys while an earlier one is
        // still in a failed-and-retrying state.
        this.scheduleRetry();
        break;
      }
    }
    if (this.pending.size === 0) {
      this.retryDelayMs = INITIAL_RETRY_DELAY_MS;
      this.retryCount.clear();
    }
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
    return Array.from(keys);
  }

  // Coalesce all synchronous writes within one task into a single microtask
  // flush, avoiding a localStorage write per heartbeat/route/subscriber update.
  // The queueMicrotask fallback to setTimeout handles older runtimes and
  // non-browser environments where queueMicrotask is absent.
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

  // Schedule a single retry timer. The guard ensures only one retry is in
  // flight at a time; subsequent scheduleRetry calls during the wait are
  // no-ops because the first retry will re-flush all pending keys together.
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
