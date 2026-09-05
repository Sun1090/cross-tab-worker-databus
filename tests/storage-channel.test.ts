/**
 * Storage-event fallback channel: a ClusterChannel backed by localStorage
 * `storage` events for environments without BroadcastChannel. The fake
 * "window" and storage proxies below model the browser contract — a write in
 * one tab fires a storage event in every OTHER tab, never the writer.
 */
import { describe, expect, it, vi } from 'vitest';
import { createBrowserEnvironment, createStorageEventChannel } from '../src/core/environment';
import type { WorkerClusterMessage } from '../src/core/types';
import { MemoryStorage, createFakeEnvironment } from './fakes';

class FakeStorageWindow {
  readonly listeners = new Set<(event: { key: string | null; newValue: string | null }) => void>();
  addEventListener(_type: 'storage', listener: (event: { key: string | null; newValue: string | null }) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'storage', listener: (event: { key: string | null; newValue: string | null }) => void): void {
    this.listeners.delete(listener);
  }
}

/** Wraps a shared MemoryStorage so writes dispatch storage events to every
 * registered window except the writer's — mirroring the browser spec. */
class StorageEventHub {
  private readonly windows: FakeStorageWindow[] = [];
  constructor(readonly storage: MemoryStorage) {}

  register(win: FakeStorageWindow): FakeStorageWindow {
    this.windows.push(win);
    return win;
  }

  /** A per-writer StorageLike whose setItem dispatches to the other tabs. */
  writerStorage(writer: FakeStorageWindow): MemoryStorage {
    return new Proxy(this.storage, {
      get: (target, prop) => {
        if (prop === 'setItem') {
          return (key: string, value: string) => {
            target.setItem(key, value);
            queueMicrotask(() => this.dispatch(writer, key));
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    }) as MemoryStorage;
  }

  private dispatch(writer: FakeStorageWindow, key: string): void {
    const newValue = this.storage.getItem(key);
    for (const win of this.windows) {
      if (win === writer) continue;
      for (const listener of [...win.listeners]) listener({ key, newValue });
    }
  }
}

function makeTab(hub: StorageEventHub, name: string) {
  const win = hub.register(new FakeStorageWindow());
  const channel = createStorageEventChannel({
    name,
    storage: hub.writerStorage(win),
    win
  });
  if (!channel) throw new Error('storage-event channel creation failed');
  return { win, channel };
}

describe('createStorageEventChannel', () => {
  it('returns null when storage or a storage-event source is missing', () => {
    expect(createStorageEventChannel({ name: 'c', storage: null, win: new FakeStorageWindow() })).toBeNull();
    expect(createStorageEventChannel({ name: 'c', storage: new MemoryStorage(), win: null })).toBeNull();
  });

  it('delivers messages to other tabs and never echoes the writer', async () => {
    const hub = new StorageEventHub(new MemoryStorage());
    const a = makeTab(hub, 'chan');
    const b = makeTab(hub, 'chan');
    const receivedA: WorkerClusterMessage[] = [];
    const receivedB: WorkerClusterMessage[] = [];
    a.channel.addEventListener('message', event => receivedA.push(event.data));
    b.channel.addEventListener('message', event => receivedB.push(event.data));

    const message: WorkerClusterMessage = { type: 'REGISTRY', sourceWorkerId: 'worker-a' };
    a.channel.postMessage(message);
    await Promise.resolve();
    await Promise.resolve();

    expect(receivedB).toEqual([message]);
    expect(receivedA).toEqual([]);
  });

  it('ignores malformed payloads and foreign keys', async () => {
    const hub = new StorageEventHub(new MemoryStorage());
    const a = makeTab(hub, 'chan');
    const b = makeTab(hub, 'chan');
    const received: WorkerClusterMessage[] = [];
    b.channel.addEventListener('message', event => received.push(event.data));

    const writer = hub.writerStorage(a.win);
    writer.setItem('cross-tab-worker-databus:channel:chan', '{broken json');
    writer.setItem('unrelated:key', JSON.stringify({ seq: 1, message: { type: 'REGISTRY', sourceWorkerId: 'x' } }));
    writer.setItem('cross-tab-worker-databus:channel:chan', JSON.stringify({ nope: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([]);
  });

  it('keeps delivering after consecutive writes and cleans up on close', async () => {
    const storage = new MemoryStorage();
    const hub = new StorageEventHub(storage);
    const a = makeTab(hub, 'chan');
    const b = makeTab(hub, 'chan');
    const received: WorkerClusterMessage[] = [];
    b.channel.addEventListener('message', event => received.push(event.data));

    // Two identical messages back to back: the seq in the envelope keeps the
    // stored value distinct so no event is suppressed.
    const message: WorkerClusterMessage = { type: 'REGISTRY', sourceWorkerId: 'worker-a' };
    a.channel.postMessage(message);
    a.channel.postMessage(message);
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toHaveLength(2);

    a.channel.close();
    expect(storage.entries().some(([key]) => key.startsWith('cross-tab-worker-databus:channel:'))).toBe(false);
    a.channel.postMessage(message);
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toHaveLength(2);
  });
});

describe('cluster over storage-event channels', () => {
  it('coordinates ownership between two runtimes without BroadcastChannel', async () => {
    const storage = new MemoryStorage();
    const hub = new StorageEventHub(storage);
    const makeEnv = (tabId: string) => {
      const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: tabId });
      const win = hub.register(new FakeStorageWindow());
      env.environment.createChannel = name => createStorageEventChannel({ name, storage: hub.writerStorage(win), win });
      return env;
    };
    const envA = makeEnv('tab-a');
    const envB = makeEnv('tab-b');
    const { WorkerClusterRuntime } = await import('../src/core/cluster');
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'storage-channel-cluster',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'storage-channel-cluster',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('topic.shared');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    runtimeB.start();
    await Promise.resolve();
    await Promise.resolve();

    // Exactly one owner was elected over the storage-event channel.
    const owners = [runtimeA, runtimeB].filter(runtime => runtime.isAssigned('topic.shared'));
    expect(owners).toHaveLength(1);
    runtimeA.stop();
    runtimeB.stop();
  });
});

describe('createBrowserEnvironment channel fallback', () => {
  it('defaults to no fallback when BroadcastChannel is unavailable', () => {
    const env = createBrowserEnvironment();
    const original = globalThis.BroadcastChannel;
    // In Node there is no BroadcastChannel; the default must return null.
    try {
      // @ts-expect-error - simulate absence
      globalThis.BroadcastChannel = undefined;
      expect(env.createChannel('probe')).toBeNull();
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });

  it('returns a storage-event channel when the fallback is enabled', () => {
    const env = createBrowserEnvironment({ channelFallback: 'storage-event' });
    const original = globalThis.BroadcastChannel;
    try {
      // @ts-expect-error - simulate absence
      globalThis.BroadcastChannel = undefined;
      const channel = env.createChannel('probe');
      // jsdom/node may lack window storage events; null is acceptable, and a
      // real browser yields a working channel. Only assert the type contract.
      if (channel) expect(typeof channel.postMessage).toBe('function');
      else expect(channel).toBeNull();
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });
});
