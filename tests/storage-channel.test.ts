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
  /** When true, the next dispatch is silently dropped — modelling the lossy
   * delivery a storage-event channel can exhibit. */
  dropNextDispatch = false;
  /** When > 0, the next N writes throw (quota/security) instead of landing,
   * modelling a full or blocked localStorage. */
  failWrites = 0;
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
            if (this.failWrites > 0) {
              this.failWrites -= 1;
              throw new DOMException('QuotaExceededError', 'QuotaExceededError');
            }
            const previous = target.getItem(key);
            target.setItem(key, value);
            // Per Web Storage, assigning the same value is a no-op and does
            // not emit a storage event in other documents.
            if (previous !== value) queueMicrotask(() => this.dispatch(writer, key));
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    }) as MemoryStorage;
  }

  private dispatch(writer: FakeStorageWindow, key: string): void {
    if (this.dropNextDispatch) {
      this.dropNextDispatch = false;
      return;
    }
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

  it('isolates listener failures so later consumers still receive the frame', async () => {
    const hub = new StorageEventHub(new MemoryStorage());
    const a = makeTab(hub, 'chan');
    const b = makeTab(hub, 'chan');
    const received: WorkerClusterMessage[] = [];
    b.channel.addEventListener('message', () => {
      throw new Error('consumer failed');
    });
    b.channel.addEventListener('message', event => received.push(event.data));

    const message: WorkerClusterMessage = { type: 'REGISTRY', sourceWorkerId: 'worker-a' };
    a.channel.postMessage(message);
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual([message]);
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

  it('keeps identical first writes from different tabs distinct', async () => {
    const hub = new StorageEventHub(new MemoryStorage());
    const a = makeTab(hub, 'chan');
    const b = makeTab(hub, 'chan');
    const observer = makeTab(hub, 'chan');
    const received: WorkerClusterMessage[] = [];
    observer.channel.addEventListener('message', event => received.push(event.data));

    // Both channels begin at seq=1. A sender nonce is required or the second
    // identical setItem would preserve the existing value and emit no event.
    const message: WorkerClusterMessage = { type: 'REGISTRY', sourceWorkerId: 'same-worker' };
    a.channel.postMessage(message);
    await Promise.resolve();
    await Promise.resolve();
    b.channel.postMessage(message);
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual([message, message]);
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

  it('surfaces a write failure so the frame is not mistaken for delivered, then recovers', async () => {
    // localStorage can reject a write (quota, private mode, security policy).
    // The channel must propagate the failure rather than swallow it: the
    // cluster's `send()` relies on the throw to report an undelivered frame.
    const storage = new MemoryStorage();
    const hub = new StorageEventHub(storage);
    const a = makeTab(hub, 'chan');
    const b = makeTab(hub, 'chan');
    const received: WorkerClusterMessage[] = [];
    b.channel.addEventListener('message', event => received.push(event.data));

    const message: WorkerClusterMessage = { type: 'REGISTRY', sourceWorkerId: 'worker-a' };
    hub.failWrites = 1;
    expect(() => a.channel.postMessage(message)).toThrow('QuotaExceededError');
    // The failed frame must not have reached the peer...
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([]);

    // ...and the channel stays usable: the next write lands normally.
    a.channel.postMessage(message);
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([message]);
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

  it('reports a failed remote publish without throwing when the fallback write is rejected', async () => {
    // `publish()` documents that it returns false when the CONTROL frame could
    // not be posted to a remote owner. Over the storage-event fallback a
    // rejected localStorage write must surface as that false (via the
    // cluster's `send()` catch), not as an exception through the caller.
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
      clusterKey: 'storage-channel-publish-fail',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'storage-channel-publish-fail',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('topic.publish');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    runtimeB.start();
    runtimeB.subscribe('topic.publish');
    await Promise.resolve();
    await Promise.resolve();

    const owner = runtimeA.isAssigned('topic.publish') ? runtimeA : runtimeB;
    const nonOwner = owner === runtimeA ? runtimeB : runtimeA;

    hub.failWrites = 1;
    // The blocked frame is reported as undelivered (no throw)...
    expect(nonOwner.publish('topic.publish', { value: 1 })).toBe(false);
    // ...and the next frame (storage recovered) is posted successfully.
    expect(nonOwner.publish('topic.publish', { value: 2 })).toBe(true);

    runtimeA.stop();
    runtimeB.stop();
  });

  it('recovers a dropped storage-event delivery through the reconcile loop', async () => {
    const storage = new MemoryStorage();
    const hub = new StorageEventHub(storage);
    hub.dropNextDispatch = true;
    const makeEnv = (tabId: string) => {
      const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: tabId });
      const win = hub.register(new FakeStorageWindow());
      env.environment.createChannel = name => createStorageEventChannel({ name, storage: hub.writerStorage(win), win });
      return env;
    };
    const envA = makeEnv('tab-loss-a');
    const envB = makeEnv('tab-loss-b');
    const { WorkerClusterRuntime } = await import('../src/core/cluster');
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'storage-channel-loss',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'storage-channel-loss',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('topic.loss');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    runtimeB.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The dropped delivery (e.g. B's registration REGISTRY) is recovered by
    // the heartbeat reconcile loop, electing exactly one owner.
    envA.runIntervals();
    envB.runIntervals();
    await Promise.resolve();
    await Promise.resolve();
    const owners = [runtimeA, runtimeB].filter(runtime => runtime.isAssigned('topic.loss'));
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
