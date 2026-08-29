import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  canUseStorage,
  createBrowserEnvironment
} from '../src/core/environment';
import { MemoryStorage } from './fakes';

describe('createBrowserEnvironment (bare Node / SSR)', () => {
  it('degrades to null storage/channels and no-op listeners without browser globals', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const env = createBrowserEnvironment();
    expect(env.storage).toBeNull();
    expect(env.sessionStorage).toBeNull();
    expect(env.createChannel('cluster')).toBeNull();
    expect(env.getVisibilityState()).toBe('visible');
    // Listener registration must not throw without document/window.
    const listener = () => {};
    expect(() => {
      env.addVisibilityChangeListener(listener);
      env.removeVisibilityChangeListener(listener);
      env.addPageHideListener(listener);
      env.removePageHideListener(listener);
      env.addPageShowListener(listener);
      env.removePageShowListener(listener);
    }).not.toThrow();
    vi.unstubAllGlobals();
  });

  it('uses the runtime BroadcastChannel when one exists (Node 18+)', () => {
    const env = createBrowserEnvironment();
    const channel = env.createChannel('cluster-node');
    expect(channel).not.toBeNull();
    expect(typeof channel!.postMessage).toBe('function');
    channel!.close();
  });

  it('exposes Date.now and global interval handles', () => {
    const env = createBrowserEnvironment();
    expect(env.now()).toBe(Date.now());
    const callback = vi.fn();
    const handle = env.setInterval(callback, 10);
    expect(handle).toBeTruthy();
    env.clearInterval(handle);
  });
});

describe('createBrowserEnvironment (with browser globals)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves window-backed storage', () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const env = createBrowserEnvironment();
    expect(env.storage).toBe(localStorage);
    expect(env.sessionStorage).toBe(sessionStorage);
  });

  it('returns null when storage property access throws (disabled storage)', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('SecurityError: storage disabled');
      },
      get sessionStorage(): never {
        throw new Error('SecurityError: storage disabled');
      }
    });
    const env = createBrowserEnvironment();
    expect(env.storage).toBeNull();
    expect(env.sessionStorage).toBeNull();
  });

  it('creates a BroadcastChannel when supported and null when the constructor throws', () => {
    class FakeBroadcastChannel {
      readonly name: string;
      constructor(name: string) {
        this.name = name;
      }
      postMessage(): void {}
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const env = createBrowserEnvironment();
    const channel = env.createChannel('cluster-x');
    expect(channel).toBeInstanceOf(FakeBroadcastChannel);
    expect((channel as unknown as FakeBroadcastChannel).name).toBe('cluster-x');

    vi.stubGlobal('BroadcastChannel', function () {
      throw new Error('BroadcastChannel unavailable');
    });
    expect(env.createChannel('cluster-x')).toBeNull();
  });

  it('wires visibility and page lifecycle listeners to document/window', () => {
    const documentListener = { calls: [] as string[] };
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      addEventListener: (type: string) => documentListener.calls.push(`add:${type}`),
      removeEventListener: (type: string) => documentListener.calls.push(`remove:${type}`)
    });
    const windowListener = { calls: [] as string[] };
    vi.stubGlobal('window', {
      addEventListener: (type: string) => windowListener.calls.push(`add:${type}`),
      removeEventListener: (type: string) => windowListener.calls.push(`remove:${type}`)
    });
    const env = createBrowserEnvironment();
    expect(env.getVisibilityState()).toBe('hidden');

    const listener = () => {};
    env.addVisibilityChangeListener(listener);
    env.removeVisibilityChangeListener(listener);
    expect(documentListener.calls).toEqual(['add:visibilitychange', 'remove:visibilitychange']);

    env.addPageHideListener(listener);
    env.removePageHideListener(listener);
    env.addPageShowListener(listener);
    env.removePageShowListener(listener);
    expect(windowListener.calls).toEqual([
      'add:pagehide',
      'remove:pagehide',
      'add:pageshow',
      'remove:pageshow'
    ]);
  });
});

describe('randomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid' });
    const env = createBrowserEnvironment();
    expect(env.randomId()).toBe('fixed-uuid');
  });

  it('falls back to Math.random when randomUUID is missing', () => {
    vi.stubGlobal('crypto', {});
    const env = createBrowserEnvironment();
    const id = env.randomId();
    expect(id).toBeTruthy();
    expect(id).not.toContain('-');
  });

  it('falls back to Math.random when randomUUID throws', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('not allowed');
      }
    });
    const env = createBrowserEnvironment();
    expect(env.randomId()).toBeTruthy();
  });
});

describe('canUseStorage', () => {
  it('rejects null storage', () => {
    expect(canUseStorage(null, 'probe')).toBe(false);
  });

  it('accepts storage that survives a write-read-delete round-trip', () => {
    const storage = new MemoryStorage();
    expect(canUseStorage(storage, 'probe-key')).toBe(true);
    expect(storage.getItem('probe-key')).toBeNull();
  });

  it('rejects storage that throws on write (quota / private mode)', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(canUseStorage(storage, 'probe-key')).toBe(false);
  });
});

describe('getOrCreateTabId', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function freshModule() {
    return await import('../src/core/environment');
  }

  it('creates and persists a new tab id', async () => {
    const { getOrCreateTabId: get } = await freshModule();
    const sessionStorage = new MemoryStorage();
    const id = get({
      sessionStorage,
      randomId: () => 'abc123'
    } as never);
    expect(id).toBe('tab-abc123');
    expect(sessionStorage.getItem('cross-tab-worker-databus:tab-id')).toBe('tab-abc123');
  });

  it('reuses an existing tab id on subsequent calls', async () => {
    const { getOrCreateTabId: get } = await freshModule();
    const sessionStorage = new MemoryStorage();
    sessionStorage.setItem('cross-tab-worker-databus:tab-id', 'tab-existing');
    const env = { sessionStorage, randomId: () => 'new' } as never;
    expect(get(env)).toBe('tab-existing');
    expect(get(env)).toBe('tab-existing');
  });

  it('regenerates a cloned id once when window.opener is present, then stabilises', async () => {
    vi.stubGlobal('window', { opener: {} });
    const { getOrCreateTabId: get } = await freshModule();
    const sessionStorage = new MemoryStorage();
    sessionStorage.setItem('cross-tab-worker-databus:tab-id', 'tab-cloned-from-opener');
    let counter = 0;
    const env = { sessionStorage, randomId: () => `fresh-${++counter}` } as never;

    // First lookup in this document must NOT trust the cloned value.
    const first = get(env);
    expect(first).toBe('tab-fresh-1');
    expect(sessionStorage.getItem('cross-tab-worker-databus:tab-id')).toBe('tab-fresh-1');

    // Subsequent runtimes in the same document share the regenerated id.
    expect(get(env)).toBe('tab-fresh-1');
  });

  it('falls back to a random id when sessionStorage throws', async () => {
    const { getOrCreateTabId: get } = await freshModule();
    const env = {
      sessionStorage: {
        getItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => {
          throw new Error('storage blocked');
        }
      },
      randomId: () => 'fallback'
    } as never;
    expect(get(env)).toBe('tab-fallback');
  });
});
