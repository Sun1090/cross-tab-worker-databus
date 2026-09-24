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

  it('accepts a legacy envelope without senderId from an older peer', async () => {
    // `senderId` was added to the envelope so two tabs writing the same first
    // frame still change the stored value. A peer on an older version omits it;
    // the receiver must still deliver the frame (the sequence alone is enough
    // to parse), keeping mixed-version tabs compatible.
    const hub = new StorageEventHub(new MemoryStorage());
    const b = makeTab(hub, 'chan');
    const received: WorkerClusterMessage[] = [];
    b.channel.addEventListener('message', event => received.push(event.data));

    const rawWriter = hub.writerStorage(hub.register(new FakeStorageWindow()));
    const frame: WorkerClusterMessage = { type: 'REGISTRY', sourceWorkerId: 'worker-legacy' };
    rawWriter.setItem(
      'cross-tab-worker-databus:channel:chan',
      JSON.stringify({ seq: 1, message: frame })
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([frame]);
  });

  it('ignores malformed payloads and foreign keys', async () => {
    const hub = new StorageEventHub(new MemoryStorage());
    const a = makeTab(hub, 'chan');
    const b = makeTab(hub, 'chan');
    const received: WorkerClusterMessage[] = [];
    b.channel.addEventListener('message', event => received.push(event.data));

    const writer = hub.writerStorage(a.win);
    // Each write has to settle before the next one: the hub dispatches with the
    // value currently stored under the key, so three writes queued in the same
    // tick would all deliver the last value and the invalid JSON below would
    // never reach the listener at all.
    writer.setItem('cross-tab-worker-databus:channel:chan', '{broken json');
    await Promise.resolve();
    await Promise.resolve();
    expect(received, 'a frame that cannot be parsed must be ignored').toEqual([]);

    writer.setItem('unrelated:key', JSON.stringify({ seq: 1, message: { type: 'REGISTRY', sourceWorkerId: 'x' } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(received, 'another tenant key must be ignored').toEqual([]);

    writer.setItem('cross-tab-worker-databus:channel:chan', JSON.stringify({ nope: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(received, 'a valid frame with no seq/message must be ignored').toEqual([]);

    // The envelope's two required fields, rejected **one at a time**. The write
    // above fails both checks at once, so deleting either condition from the guard
    // still drops it — measured, all four operands of that guard survived the suite
    // before these two cases. A `seq` that is a numeric string is rejected on the
    // same terms as a missing one: the envelope's field is a number, not a value
    // that can be coerced.
    writer.setItem('cross-tab-worker-databus:channel:chan', JSON.stringify({ message: { type: 'REGISTRY', sourceWorkerId: 'x' } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(received, 'an envelope with no sequence number must be ignored').toEqual([]);

    writer.setItem('cross-tab-worker-databus:channel:chan', JSON.stringify({ seq: '1', message: { type: 'REGISTRY', sourceWorkerId: 'x' } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(received, 'a string sequence number must not be coerced').toEqual([]);

    writer.setItem('cross-tab-worker-databus:channel:chan', JSON.stringify({ seq: 2 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(received, 'an envelope with no message must be ignored').toEqual([]);

    // The channel is still usable afterwards: containment, not a one-way shut
    // down of the listener.
    a.channel.postMessage({ type: 'REGISTRY', sourceWorkerId: 'worker-a' });
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([{ type: 'REGISTRY', sourceWorkerId: 'worker-a' }]);
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

  it('stores the frame verbatim, which is the trade-off the docs price the fallback at', async () => {
    // `channelFallback: 'storage-event'` is opt-in because the envelope *is* the
    // frame: topic plaintext and a publication payload both land in localStorage
    // under the channel key, where they stay until `close()` and indefinitely if
    // the tab dies first. No delivery test can notice that, because it is a claim
    // about what storage holds rather than about what peers receive — so it is
    // asserted here, against the corrected absolutes in `docs/architecture.md`.
    const storage = new MemoryStorage();
    const hub = new StorageEventHub(storage);
    const a = makeTab(hub, 'chan');
    a.channel.postMessage({
      type: 'CONTROL',
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-b',
      action: 'PUBLISH',
      topic: 'chat.private',
      topicKey: 'opaque-topic-key',
      data: { body: 'payload plaintext' }
    });

    const written = storage.entries().find(([key]) => key === 'cross-tab-worker-databus:channel:chan');
    expect(written, 'the fallback must have written its frame into storage').toBeDefined();
    const [, value] = written!;
    expect(value).toContain('chat.private');
    expect(value).toContain('payload plaintext');

    // The flip side the docs promise: closing removes the key.
    a.channel.close();
    expect(storage.entries().some(([key]) => key.startsWith('cross-tab-worker-databus:channel:'))).toBe(false);
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

  it('keeps other channels delivering after one channel closes', async () => {
    // close() removes the shared channel key. In a browser that removal fires a
    // storage event with a null newValue, which onStorage ignores; regardless,
    // a closing channel must not disturb frames between the remaining tabs.
    const hub = new StorageEventHub(new MemoryStorage());
    const a = makeTab(hub, 'chan');
    const b = makeTab(hub, 'chan');
    const c = makeTab(hub, 'chan');
    const receivedB: WorkerClusterMessage[] = [];
    b.channel.addEventListener('message', event => receivedB.push(event.data));

    a.channel.close();
    // close() is idempotent: a second call must not throw or re-run cleanup.
    expect(() => a.channel.close()).not.toThrow();
    const frame: WorkerClusterMessage = { type: 'REGISTRY', sourceWorkerId: 'worker-c' };
    c.channel.postMessage(frame);
    await Promise.resolve();
    await Promise.resolve();
    expect(receivedB).toEqual([frame]);
  });

  it('does not deliver to a sibling channel in the same document', async () => {
    // Storage events fire in other documents only, so two bus runtimes sharing
    // a clusterKey within one document do not exchange channel frames here.
    // They still converge through the shared localStorage coordination records
    // and the reconcile loop; this test pins the cross-document-only boundary
    // (and guards against accidentally double-delivering if same-document
    // dispatch were ever added).
    const hub = new StorageEventHub(new MemoryStorage());
    const win = hub.register(new FakeStorageWindow());
    const a = createStorageEventChannel({ name: 'same-doc', storage: hub.writerStorage(win), win });
    const b = createStorageEventChannel({ name: 'same-doc', storage: hub.writerStorage(win), win });
    if (!a || !b) throw new Error('storage-event channel creation failed');
    const received: WorkerClusterMessage[] = [];
    b.addEventListener('message', event => received.push(event.data));

    a.postMessage({ type: 'REGISTRY', sourceWorkerId: 'worker-a' });
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([]);
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

  it('returns a working storage-event channel when the fallback is enabled', () => {
    // This case used to read `if (channel) expect(...postMessage...).toBe
    // ('function'); else expect(channel).toBeNull();` — both branches of the
    // union were accepted, so no value of `channel` could fail it and the
    // browser path it names was unpinned. Stub a live window + localStorage so
    // the fallback has what a real document provides, then assert the wiring:
    // which storage the envelope lands in and which event source delivers it.
    const localStorage = new MemoryStorage();
    const listeners = new Set<(event: { key: string | null; newValue: string | null }) => void>();
    vi.stubGlobal('window', {
      localStorage,
      addEventListener: (_type: string, listener: (event: { key: string | null; newValue: string | null }) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: { key: string | null; newValue: string | null }) => void) => {
        listeners.delete(listener);
      }
    });
    vi.stubGlobal('BroadcastChannel', undefined);
    try {
      const env = createBrowserEnvironment({ channelFallback: 'storage-event' });
      const channel = env.createChannel('probe-fb');
      expect(channel, 'a window with localStorage must yield the fallback channel').not.toBeNull();

      const key = 'cross-tab-worker-databus:channel:probe-fb';
      const received: WorkerClusterMessage[] = [];
      channel!.addEventListener('message', event => received.push(event.data));
      const frame: WorkerClusterMessage = { type: 'REGISTRY', sourceWorkerId: 'worker-fb' };
      channel!.postMessage(frame);

      const stored = localStorage.getItem(key);
      expect(stored, 'the envelope must travel through window.localStorage').toBeTruthy();
      expect(JSON.parse(stored!).message).toEqual(frame);

      for (const listener of [...listeners]) listener({ key, newValue: stored });
      expect(received).toEqual([frame]);

      channel!.close();
      expect(listeners.size, 'close must detach the window storage listener').toBe(0);
      expect(localStorage.getItem(key), 'close must not leave the payload behind').toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('degrades to null when the window has no event source to listen on', () => {
    // A storage-event channel needs both a store and an event source. With a
    // window that exposes localStorage but cannot dispatch `storage` (a
    // stripped webview shell), the fallback must return null so the runtime
    // degrades to local mode instead of building a channel that never fires.
    vi.stubGlobal('window', { localStorage: new MemoryStorage() });
    vi.stubGlobal('BroadcastChannel', undefined);
    try {
      const env = createBrowserEnvironment({ channelFallback: 'storage-event' });
      expect(env.createChannel('probe-no-events')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
