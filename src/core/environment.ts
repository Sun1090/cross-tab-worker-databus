/**
 * Browser environment adapters — storage, BroadcastChannel, timers, lifecycle.
 *
 * Separates platform-specific APIs from the core coordination logic so the
 * same Runtime can run in a browser, in a test, or in an embedded context
 * with custom adapters injected via `ClusterEnvironment`.
 */
import type { TabVisibilityState, WorkerClusterMessage } from './types';

/** Minimal storage interface compatible with both localStorage and MemoryStorage. */
export interface StorageLike {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

/** Minimal BroadcastChannel interface. The cluster uses it for control messages and event fan-out. */
export interface ClusterChannel {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerClusterMessage>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<WorkerClusterMessage>) => void): void;
  postMessage(message: WorkerClusterMessage): void;
  close(): void;
}

/**
 * Environment abstraction that lets the cluster operate in Node, SSR, or
 * test environments without touching browser globals directly.
 * Tests inject a fake environment to control timing, storage, and lifecycle.
 */
export interface ClusterEnvironment {
  /** localStorage (or null if unavailable). Wrapped by BatchingStorageWriter. */
  storage: StorageLike | null;
  /** sessionStorage (or null if unavailable). Used for stable tab IDs. */
  sessionStorage: StorageLike | null;
  /** Monotonic clock; injected so tests can control time. */
  now: () => number;
  /** Generates a random ID (UUID when crypto is available, else Math.random). */
  randomId: () => string;
  /** Creates a BroadcastChannel by name, or null if unsupported. */
  createChannel: (name: string) => ClusterChannel | null;
  /** Sets an interval; returns a handle for clearInterval. */
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  /** Clears a handle from setInterval. */
  clearInterval: (handle: unknown) => void;
  /** Current tab visibility ('visible' or 'hidden'). */
  getVisibilityState: () => TabVisibilityState;
  /** Register a listener for visibilitychange events. */
  addVisibilityChangeListener: (listener: () => void) => void;
  /** Remove a previously-added visibilitychange listener. */
  removeVisibilityChangeListener: (listener: () => void) => void;
  /** Register a listener for pagehide (BFCache entry). */
  addPageHideListener: (listener: () => void) => void;
  /** Remove a previously-added pagehide listener. */
  removePageHideListener: (listener: () => void) => void;
  /** Register a listener for pageshow (BFCache exit / restore). */
  addPageShowListener: (listener: () => void) => void;
  /** Remove a previously-added pageshow listener. */
  removePageShowListener: (listener: () => void) => void;
}

/** Resolve a Web Storage interface by name, or null in non-browser contexts.
 * The `typeof window` guard short-circuits in SSR / Node (where `window` is
 * undefined) before touching it; the try/catch covers sandboxed or
 * storage-disabled browsers that throw on property access. */
function getStorage(name: 'localStorage' | 'sessionStorage'): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window[name];
  } catch {
    return null;
  }
}

function randomId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

// A document can create multiple DataBus runtimes (for example market and
// notice connections). Regenerate a copied opener id only on the first lookup
// in that document; subsequent runtimes must continue sharing the same tabId.
let tabIdentityInitialized = false;

/**
 * Default environment adapter for browser runtimes.
 * Probes for localStorage, BroadcastChannel, document, and window APIs
 * and gracefully returns null / no-ops when they are absent (SSR, Node).
 */
export function createBrowserEnvironment(): ClusterEnvironment {
  return {
    storage: getStorage('localStorage'),
    sessionStorage: getStorage('sessionStorage'),
    now: Date.now,
    randomId,
    createChannel: name => {
      try {
        return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name);
      } catch {
        return null;
      }
    },
    setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
    clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    getVisibilityState: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'hidden' : 'visible',
    addVisibilityChangeListener: listener => {
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', listener);
    },
    removeVisibilityChangeListener: listener => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', listener);
    },
    addPageHideListener: listener => {
      if (typeof window !== 'undefined') window.addEventListener('pagehide', listener);
    },
    removePageHideListener: listener => {
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', listener);
    },
    addPageShowListener: listener => {
      if (typeof window !== 'undefined') window.addEventListener('pageshow', listener);
    },
    removePageShowListener: listener => {
      if (typeof window !== 'undefined') window.removeEventListener('pageshow', listener);
    }
  };
}

/**
 * Probe a storage instance with a write-read-delete round-trip.
 * Returns a type guard so the caller can narrow the type after a successful check.
 * Catches quota errors, disabled-storage (Safari private mode), or opaque
 * exceptions — any of which means the storage is not usable for coordination
 * and the Runtime must degrade to local mode.
 */
export function canUseStorage(storage: StorageLike | null, probeKey: string): storage is StorageLike {
  if (!storage) return false;
  try {
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get-or-create a stable tab ID stored in sessionStorage.
 * sessionStorage is scoped to the tab and survives refresh, so the same tab
 * retains its identity across the page lifecycle without coordination overhead.
 * Falls back to a random ID when sessionStorage is unavailable.
 */
export function getOrCreateTabId(
  environment: ClusterEnvironment,
  key = 'cross-tab-worker-databus:tab-id'
): string {
  const storage = environment.sessionStorage;
  try {
    const existing = storage?.getItem(key);
    // `window.open()` may clone the opener's sessionStorage into the new tab.
    // A child page therefore must not blindly reuse the copied value: the
    // value identifies a page/tab instance, not an account or browser window.
    // `noopener` is still recommended by applications, but this guard keeps
    // the SDK safe when an opener is present.
    const hasOpener = typeof window !== 'undefined' && Boolean(window.opener);
    if (existing && (!hasOpener || tabIdentityInitialized)) {
      tabIdentityInitialized = true;
      return existing;
    }
    const created = `tab-${environment.randomId()}`;
    storage?.setItem(key, created);
    tabIdentityInitialized = true;
    return created;
  } catch {
    return `tab-${environment.randomId()}`;
  }
}
