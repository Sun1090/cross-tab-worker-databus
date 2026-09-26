import { describe, expect, it, vi } from 'vitest';
import { WorkerClusterRuntime } from '../src/core/cluster';
import { approximatePayloadBytes } from '../src/core/routing';
import type { WorkerControlAction, WorkerRecord } from '../src/core/types';
import type { WorkerClusterMessage } from '../src/core/types';
import { createOpaqueKey } from '../src/core/hash';
import { CLUSTER_MESSAGE_TYPE, CONTROL_ACTION, DEFAULT_STORAGE_PREFIX } from '../src/utils/constants';
import { ChannelHub, createFakeEnvironment, MemoryStorage } from './fakes';

describe('WorkerClusterRuntime', () => {
  it('degrades to local mode when channel construction throws', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'channel-throw' });
    env.environment.createChannel = () => {
      throw new DOMException('BroadcastChannel blocked', 'SecurityError');
    };
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'channel-construction-failure',
      environment: env.environment,
      tabId: 'tab-channel-throw',
      workerId: 'worker-channel-throw',
      handlers: { onControl, onEvent: vi.fn() }
    });

    expect(() => runtime.start()).not.toThrow();
    runtime.subscribe('local-topic');

    expect(runtime.getSnapshot()).toMatchObject({ coordinated: false, suspended: false });
    expect(runtime.isAssigned('local-topic')).toBe(true);
    expect(onControl).toHaveBeenCalledWith('SUBSCRIBE', 'local-topic', undefined);
    expect(storage.entries()).toEqual([]);

    runtime.stop();
  });

  it('abandons activation when the channel adapter tears the runtime down mid-start', async () => {
    // `createChannel` is consumer adapter code and it is called from inside
    // `activate()` with `started` already true, so it is one of the two
    // synchronous extension points in that method — the other is the
    // storage-less `handlers.onControl` below. A teardown arriving in this
    // window has already run `pause()` *before* the channel existed, so
    // `pause()` could not close it, and the rest of activation would then
    // attach a message listener to it, write the worker record `pause()` had
    // just removed, and arm a heartbeat that no later `stop()` can clear.
    // Measured with the two liveness checks in `activate()` deleted: the
    // stopped runtime read `coordinated: true`, its record was back in storage
    // at the first tick (so no peer would ever TTL-prune the tab), and a
    // `CONTROL/SUBSCRIBE` frame addressed to it after the stop added a topic to
    // `assignedTopics` — a phantom owner with nothing behind it.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'activate-reentry' });
    const createChannel = env.environment.createChannel.bind(env.environment);
    let reentered = false;
    env.environment.createChannel = name => {
      const channel = createChannel(name);
      if (reentered) {
        reentered = false;
        runtime.stop();
      }
      return channel;
    };
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'activate-reentry',
      environment: env.environment,
      tabId: 'tab-activate-reentry',
      workerId: 'worker-activate-reentry',
      handlers: { onControl, onEvent: vi.fn() }
    });
    reentered = true;
    runtime.subscribe('owned-topic');
    runtime.start();
    await Promise.resolve();

    // Nothing survives the abandoned activation: no registration, no channel.
    expect(storage.entries(), 'a stopped runtime must not be registered').toEqual([]);
    expect(runtime.getSnapshot()).toMatchObject({ coordinated: false, suspended: false });
    expect(onControl).not.toHaveBeenCalled();

    // The heartbeat must not have been armed: a tick would re-register the
    // runtime, so move the clock and pump every interval in this environment.
    env.environment.now = () => 9_000;
    env.runIntervals();
    await Promise.resolve();
    expect(storage.entries(), 'no interval may outlive the abandoned activation').toEqual([]);
    expect(runtime.getSnapshot().currentWorker.heartbeatAt).toBe(1_000);

    // And the channel it built after the teardown must not be a live listener:
    // post an assignment addressed at this worker on the cluster channel a peer
    // would use. Before the fix this landed in `assignedTopics`.
    const forger = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('activate-reentry')}`);
    forger.postMessage({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: 'worker-peer',
      targetWorkerId: 'worker-activate-reentry',
      action: CONTROL_ACTION.SUBSCRIBE,
      topic: 'injected',
      topicKey: createOpaqueKey('injected')
    } satisfies WorkerClusterMessage);
    forger.close();
    await Promise.resolve();
    expect(onControl, 'a stopped runtime must not act on a control frame').not.toHaveBeenCalled();
    expect(runtime.getSnapshot().assignedTopics).toEqual([]);
  });

  it('abandons the heartbeat when a handler stops the runtime during the storage-less re-subscribe', async () => {
    // The other extension point, and the one an application reaches without
    // replacing an adapter: with storage unavailable, `activate()` re-sends
    // SUBSCRIBE for topics subscribed before start, and a self-addressed
    // control message calls `handlers.onControl` on this same stack.
    const brokenStorage = new (class extends MemoryStorage {
      override setItem(): void {
        throw new Error('QuotaExceededError');
      }
    })();
    let now = 1_000;
    const env = createFakeEnvironment({ storage: brokenStorage, now: () => now, randomId: 'activate-stop-from-handler' });
    const onControl = vi.fn((action: WorkerControlAction, topic: string) => {
      if (action === CONTROL_ACTION.SUBSCRIBE && topic === 'owned-topic') runtime.stop();
    });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'activate-stop-from-handler',
      environment: env.environment,
      tabId: 'tab-handler-stop',
      workerId: 'worker-handler-stop',
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.subscribe('owned-topic');
    expect(onControl, 'the handler must be reached during activation, not after it').not.toHaveBeenCalled();

    runtime.start();
    expect(onControl).toHaveBeenCalledWith(CONTROL_ACTION.SUBSCRIBE, 'owned-topic', undefined);
    expect(runtime.getSnapshot()).toMatchObject({ coordinated: false, suspended: false });
    // The assignment the loop made before calling the handler is gone: `stop()`
    // ran inside it, and `pause()` clears `assignedTopics` after the handoff.
    expect(runtime.getSnapshot().assignedTopics).toEqual([]);

    now = 9_000;
    env.runIntervals();
    expect(runtime.getSnapshot().currentWorker.heartbeatAt, 'no heartbeat may outlive the abandoned activation').toBe(1_000);
  });

  it('takes effect when a handler stops the runtime from inside onResume', () => {
    // `handlePageShow()` clears `suspended` before it calls the consumer's
    // `onResume`, and `started` is set only by the `activate()` that the
    // generation bump below then skips — so for the duration of that callback
    // both of `stop()`'s original entry conditions read false and the stop was
    // simply dropped. The lifecycle listeners stayed attached, and the next
    // visibility toggle brought the runtime back: measured with `stop()`'s
    // third term removed, `onResume` fired a second time after the explicit
    // stop and `coordinated` returned to true on a runtime the caller had
    // given up on.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'resume-stop' });
    let stopInResume = false;
    let resumeCount = 0;
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'resume-stop',
      environment: env.environment,
      tabId: 'tab-resume-stop',
      workerId: 'worker-resume-stop',
      handlers: {
        onControl: vi.fn(),
        onEvent: vi.fn(),
        onResume: () => {
          resumeCount += 1;
          if (stopInResume) {
            stopInResume = false;
            runtime.stop();
          }
        }
      }
    });
    runtime.start();
    env.pageHide();
    expect(resumeCount).toBe(0);

    stopInResume = true;
    env.pageShow();
    expect(resumeCount).toBe(1);
    expect(runtime.getSnapshot()).toMatchObject({ coordinated: false, suspended: false });

    // The listeners must be gone, so a further hide/show pair cannot resurrect
    // either the callbacks or the coordination state.
    env.pageHide();
    env.pageShow();
    expect(resumeCount, 'a stopped runtime must not fire onResume again').toBe(1);
    expect(runtime.getSnapshot().coordinated, 'a stopped runtime must not re-activate').toBe(false);
    runtime.stop();
  });

  it('drops a control frame whose topicKey disagrees with its topic', async () => {
    // `topicKey` is a pure function of `topic`, so every frame the library sends
    // has the two agreeing. A cluster channel is a BroadcastChannel, which any
    // same-origin script can post into, so a frame is the only place an attacker
    // can name the channel this worker subscribes and owns — and the durable
    // route is keyed by `topicKey`, which authorizes the substitution while
    // `topic` supplies the plaintext it would be replaced with.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const onControl = vi.fn();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'key-mismatch' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'key-mismatch',
      environment: env.environment,
      tabId: 'tab-key-mismatch',
      workerId: 'worker-key-mismatch',
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('chat.a');
    await Promise.resolve();
    onControl.mockClear();

    const channel = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('key-mismatch')}`);
    channel.postMessage({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: 'forged-peer',
      targetWorkerId: 'worker-key-mismatch',
      action: 'SUBSCRIBE' as WorkerControlAction,
      topic: 'substituted-channel',
      topicKey: createOpaqueKey('chat.a')
    } as WorkerClusterMessage);
    channel.close();
    await Promise.resolve();

    expect(onControl).not.toHaveBeenCalled();
    expect(runtime.isAssigned('chat.a')).toBe(true);
    expect(runtime.getSnapshot().assignedTopics).toContain('chat.a');
    expect(runtime.getSnapshot().assignedTopics).not.toContain('substituted-channel');
    runtime.stop();
  });

  it('drops a control frame that carries no topicKey at all', async () => {
    // The sibling case above posts a frame whose pair *disagrees*. This one posts
    // a frame with half the pair missing, and it is the shape the guard as written
    // let through: `handleControlMessage` skipped the check whenever `topicKey`
    // was `undefined`, while `handleRouteReleasedMessage` — the other reader of
    // the same pair — has no such tolerance. So the invariant both handlers were
    // documented to enforce held on one and not the other.
    //
    // What the tolerance bought, measured rather than argued: the frame reaches
    // `assignedTopics` under the key `undefined` and `knownTopics` caches its
    // plaintext, so `getSnapshot().assignedTopics` reports a topic this tab never
    // subscribed, and `reconcileAssignedTopics()` then dispatches an
    // `UNSUBSCRIBE` for a channel that was never subscribed. No durable ownership
    // is minted (there is no route under that key) and nothing reaches storage,
    // so the window closes on the next reconcile tick — the cost is a public
    // snapshot that lies plus an attacker-chosen string held in two in-memory
    // maps until the sweep, not a hole in the routing itself.
    //
    // The tolerance had no referent to protect: `topicKey` has been a required
    // field of `WorkerClusterMessage`'s CONTROL variant since the initial commit,
    // so no released version ever sent a frame without one, and the tolerance was
    // introduced *with* the check in the same commit rather than inherited from a
    // legacy-peer concern. Its only reachable traffic is a forger.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const onControl = vi.fn();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'key-absent' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'key-absent',
      environment: env.environment,
      tabId: 'tab-key-absent',
      workerId: 'worker-key-absent',
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('chat.a');
    await Promise.resolve();
    onControl.mockClear();

    const channel = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('key-absent')}`);
    // The forged frame is widened at the call site, not per field: the message
    // type requires `topicKey`, so a conforming cast here would typecheck and
    // the case would be testing a frame the compiler believes in.
    const postForged = (channel.postMessage as (message: unknown) => void).bind(channel);
    postForged({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: 'forged-peer',
      targetWorkerId: 'worker-key-absent',
      action: CONTROL_ACTION.SUBSCRIBE,
      topic: 'no-key-channel'
    });
    channel.close();
    await Promise.resolve();

    expect(onControl, 'a keyless frame must not reach the control dispatch').not.toHaveBeenCalled();
    expect(runtime.getSnapshot().assignedTopics, 'the snapshot must not claim the topic').not.toContain(
      'no-key-channel'
    );
    // The reverse cache is the other half: it is what turns a hash back into a
    // name, so a frame that never got past the guard must not have planted one.
    expect(runtime.getSnapshot().knownTopics.map(entry => entry.topic)).not.toContain('no-key-channel');
    // And the tab keeps exactly the assignment it made for itself.
    expect(runtime.isAssigned('chat.a')).toBe(true);
    expect(runtime.getSnapshot().assignedTopics).toEqual(['chat.a']);
    runtime.stop();
  });

  it('keeps the topic it is remembering when the cache is full and every older entry is owned', async () => {
    // `rememberTopic()` overflows its cap on a NEW key, which lands at the back of
    // the Map, so the eviction scan walks every older entry before it reaches the
    // one just written. Each of those is skipped when it is owned, so there is one
    // reachable state where the only candidate left is the key the caller is about
    // to use: a cache whose older entries are all owned. Without the loop's
    // `candidate === topicKey` term, that write evicts itself — and the loss is
    // silent, because `readRoute()` and the storage-less paths then resolve a
    // `topicKey` they can no longer name, which is exactly what the
    // `assignedTopics` guard in the same loop exists to prevent for owned keys.
    // The cap's value is not a constant this module exports, so the 500 below is
    // the number the sibling case 'caps knownTopics at MAX_KNOWN_TOPICS and evicts
    // the oldest non-owned entries first (FIFO)' already pins through
    // `expect(known.length).toBe(500)`; raising `MAX_KNOWN_TOPICS` reddens that
    // test first, and this owned prefix has to be raised with it. What the
    // assertions below care about is *which* entry survives, not how many.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'evict-self' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'evict-self',
      environment: env.environment,
      tabId: 'tab-evict-self',
      workerId: 'worker-evict-self',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();

    const channel = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('evict-self')}`);
    const post = (topic: string, action: WorkerControlAction, extra: Record<string, unknown>) => {
      channel.postMessage({
        type: CLUSTER_MESSAGE_TYPE.CONTROL,
        sourceWorkerId: 'peer-evict',
        targetWorkerId: 'worker-evict-self',
        action,
        topic,
        topicKey: createOpaqueKey(topic),
        ...extra
      } as WorkerClusterMessage);
    };

    // A peer SUBSCRIBE with no durable route is adopted (`assignedTopics.set`), so
    // these fill the cache with keys eviction must never drop. PUBLISH is used for
    // the last write because it remembers the topic without claiming it.
    const ownedCount = 500;
    for (let index = 0; index < ownedCount; index += 1) post(`owned.${index}`, 'SUBSCRIBE', {});
    await Promise.resolve();

    const before = runtime.getSnapshot();
    expect(before.knownTopics.length).toBe(ownedCount);
    expect(before.assignedTopics.length).toBe(ownedCount);

    post('evict.extra', 'PUBLISH', { data: 'filler' });
    await Promise.resolve();

    const after = runtime.getSnapshot().knownTopics;
    expect(after.map(entry => entry.topic)).toContain('evict.extra');
    expect(after.length).toBe(ownedCount + 1);
    channel.close();
    runtime.stop();
  });

  it('drops a batched PUBLISH whose items are not a usable batch', async () => {
    // The batched branch gates on `message.items.length`, then iterates. Every
    // sender builds `items` with `Array.prototype.map`, so a value with a length
    // and no iterator reaches only from a hand-built frame — and here it throws
    // out of the cluster's own message listener instead of publishing.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const onControl = vi.fn();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'batch-shape' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'batch-shape',
      environment: env.environment,
      tabId: 'tab-batch-shape',
      workerId: 'worker-batch-shape',
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();

    const channel = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('batch-shape')}`);
    const arrayLike = { length: 2, 0: { data: 'first' } };
    expect(() => {
      channel.postMessage({
        type: CLUSTER_MESSAGE_TYPE.CONTROL,
        sourceWorkerId: 'forged-peer',
        targetWorkerId: 'worker-batch-shape',
        action: 'PUBLISH' as WorkerControlAction,
        topic: 'chat.a',
        topicKey: createOpaqueKey('chat.a'),
        items: arrayLike
      } as unknown as WorkerClusterMessage);
    }).not.toThrow();
    // An empty batch is the other unusable shape, and the one the old gate let
    // through: `items: []` failed `length > 0` and fell out of the switch into
    // the single-publication tail, so the owner published the frame's absent
    // `data` instead of nothing at all.
    channel.postMessage({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: 'forged-peer',
      targetWorkerId: 'worker-batch-shape',
      action: 'PUBLISH' as WorkerControlAction,
      topic: 'chat.a',
      topicKey: createOpaqueKey('chat.a'),
      items: []
    } as unknown as WorkerClusterMessage);
    channel.close();
    await Promise.resolve();

    expect(onControl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('never hands a non-array batch to the transport publish path', async () => {
    // A string satisfies both `items.length > 0` and iteration, so this frame
    // does not throw — it walks the batch handler with one-character items whose
    // `data` is `undefined`. The consequence is worse than the array-like case:
    // the owner publishes nothing-of-interest to the backend under its own
    // session, and the same-origin sender never had that channel at all.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const onControl = vi.fn();
    const onPublishBatch = vi.fn();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'batch-string' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'batch-string',
      environment: env.environment,
      tabId: 'tab-batch-string',
      workerId: 'worker-batch-string',
      handlers: { onControl, onPublishBatch, onEvent: vi.fn() }
    });
    runtime.start();

    const channel = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('batch-string')}`);
    channel.postMessage({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: 'forged-peer',
      targetWorkerId: 'worker-batch-string',
      action: 'PUBLISH' as WorkerControlAction,
      topic: 'chat.a',
      topicKey: createOpaqueKey('chat.a'),
      items: 'ab'
    } as unknown as WorkerClusterMessage);
    // The empty batch is the shape that only this leg can falsify: with no batch
    // handler the loop below runs zero times either way, so `length === 0` is
    // dominated there. Here it is the difference between dropping the frame and
    // handing `[]` to a batch-capable transport, which posts a wire frame for it.
    channel.postMessage({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: 'forged-peer',
      targetWorkerId: 'worker-batch-string',
      action: 'PUBLISH' as WorkerControlAction,
      topic: 'chat.a',
      topicKey: createOpaqueKey('chat.a'),
      items: []
    } as unknown as WorkerClusterMessage);
    channel.close();
    await Promise.resolve();

    expect(onPublishBatch).not.toHaveBeenCalled();
    expect(onControl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('keeps one topic owner and migrates it when the owner stops', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'wss://example.test/connection',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'wss://example.test/connection',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });

    runtimeA.start();
    now += 1;
    runtimeB.start();
    runtimeA.subscribe('market.tick.BTCUSDT');
    await Promise.resolve();
    runtimeB.subscribe('market.tick.BTCUSDT');
    await Promise.resolve();

    expect(controlA).toHaveBeenCalledWith('SUBSCRIBE', 'market.tick.BTCUSDT', undefined);
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'market.tick.BTCUSDT', undefined);
    expect(runtimeA.isAssigned('market.tick.BTCUSDT')).toBe(true);
    expect(runtimeB.isAssigned('market.tick.BTCUSDT')).toBe(false);

    runtimeA.stop();

    expect(runtimeB.isAssigned('market.tick.BTCUSDT')).toBe(true);
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'market.tick.BTCUSDT', undefined);
    expect(runtimeB.getSnapshot().workers.map(worker => worker.workerId)).toEqual(['worker-b']);
  });

  it('isolates storage keys and channels between different clusterKeys', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envAlpha = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'alpha' });
    const envBeta = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'beta' });
    const controlAlpha = vi.fn();
    const controlBeta = vi.fn();
    const runtimeAlpha = new WorkerClusterRuntime({
      clusterKey: 'tenant-alpha',
      environment: envAlpha.environment,
      tabId: 'tab-alpha',
      workerId: 'worker-alpha',
      handlers: { onControl: controlAlpha, onEvent: vi.fn() }
    });
    const runtimeBeta = new WorkerClusterRuntime({
      clusterKey: 'tenant-beta',
      environment: envBeta.environment,
      tabId: 'tab-beta',
      workerId: 'worker-beta',
      handlers: { onControl: controlBeta, onEvent: vi.fn() }
    });

    runtimeAlpha.start();
    now += 1;
    runtimeBeta.start();
    runtimeAlpha.subscribe('shared-topic');
    await Promise.resolve();
    runtimeBeta.subscribe('shared-topic');
    await Promise.resolve();

    // Both tenants own the same topic inside their own cluster: the control
    // plane never crosses the cluster-key boundary, so neither tenant's
    // subscribe is handed off to the other tenant's worker.
    expect(runtimeAlpha.isAssigned('shared-topic')).toBe(true);
    expect(runtimeBeta.isAssigned('shared-topic')).toBe(true);
    expect(controlAlpha).toHaveBeenCalledWith('SUBSCRIBE', 'shared-topic', undefined);
    expect(controlBeta).toHaveBeenCalledWith('SUBSCRIBE', 'shared-topic', undefined);
    expect(runtimeAlpha.getSnapshot().workers.map(worker => worker.workerId)).toEqual(['worker-alpha']);
    expect(runtimeBeta.getSnapshot().workers.map(worker => worker.workerId)).toEqual(['worker-beta']);

    // A publish on one tenant stays local: it never surfaces on the other
    // tenant's control plane.
    controlBeta.mockClear();
    expect(runtimeAlpha.publish('shared-topic', { value: 1 })).toBe(true);
    expect(controlAlpha).toHaveBeenLastCalledWith('PUBLISH', 'shared-topic', { value: 1 });
    expect(controlBeta).not.toHaveBeenCalled();

    // Storage keys are namespaced by the opaque cluster hash, never overlap
    // between tenants, and never expose the plaintext cluster identifier.
    const alphaBase = `${DEFAULT_STORAGE_PREFIX}:${createOpaqueKey('tenant-alpha')}`;
    const betaBase = `${DEFAULT_STORAGE_PREFIX}:${createOpaqueKey('tenant-beta')}`;
    expect(alphaBase).not.toBe(betaBase);
    const keys = storage.entries().map(([key]) => key);
    const alphaKeys = keys.filter(key => key.startsWith(alphaBase));
    const betaKeys = keys.filter(key => key.startsWith(betaBase));
    expect(alphaKeys.length).toBeGreaterThan(0);
    expect(betaKeys.length).toBeGreaterThan(0);
    expect(alphaKeys.filter(key => betaKeys.includes(key))).toEqual([]);
    expect(keys.every(key => key.startsWith(alphaBase) || key.startsWith(betaBase))).toBe(true);
    expect(keys.some(key => key.includes('tenant-alpha') || key.includes('tenant-beta'))).toBe(false);
  });

  it('publishes through the synchronous local assignment without rereading storage', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'fast-publish' });
    const control = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'publish-fast-path',
      environment: env.environment,
      tabId: 'tab-fast-publish',
      workerId: 'worker-fast-publish',
      handlers: { onControl: control, onEvent: vi.fn() }
    });

    runtime.start();
    runtime.subscribe('hot-topic');
    await Promise.resolve();
    const getItem = vi.spyOn(storage, 'getItem');

    expect(runtime.publish('hot-topic', { value: 1 })).toBe(true);
    expect(control).toHaveBeenLastCalledWith('PUBLISH', 'hot-topic', { value: 1 });
    expect(getItem).not.toHaveBeenCalled();
  });

  it('preserves publish order and avoids storage reads during a burst', async () => {
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'publish-burst' });
    const control = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'publish-burst',
      environment: env.environment,
      tabId: 'tab-publish-burst',
      workerId: 'worker-publish-burst',
      handlers: { onControl: control, onEvent: vi.fn() }
    });

    runtime.start();
    runtime.subscribe('hot-topic');
    await Promise.resolve();
    control.mockClear();
    const getItem = vi.spyOn(storage, 'getItem');

    for (let index = 0; index < 1_000; index += 1) {
      expect(runtime.publish('hot-topic', { sequence: index })).toBe(true);
    }

    expect(getItem).not.toHaveBeenCalled();
    expect(control).toHaveBeenCalledTimes(1_000);
    expect(control.mock.calls.map(call => (call[2] as { sequence: number }).sequence)).toEqual(
      Array.from({ length: 1_000 }, (_, index) => index)
    );
  });

  it('preserves publication metadata across a remote owner control message', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'metadata-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'metadata-b' });
    const controlA = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'metadata-routing',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'metadata-routing',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('market.tick');
    await Promise.resolve();
    now += 1;
    runtimeB.start();

    expect(runtimeB.publish('market.tick', { price: 1 }, {
      messageId: 'm-1',
      timestamp: 42
    })).toBe(true);
    expect(controlA).toHaveBeenLastCalledWith(
      'PUBLISH',
      'market.tick',
      { price: 1 },
      'm-1',
      42
    );
  });

  it('treats an empty clusterKey as the default cluster, and every other key as isolated', async () => {
    // The namespace is `createOpaqueKey(options.clusterKey || '__default__')`, so
    // the falsy key is not its own cluster: it hashes the literal string. That
    // makes "different clusterKeys operate in isolation" true of hashes and false
    // of one specific pair, and the pair is the one a caller can reach by leaving
    // a config field empty. Both halves are pinned because the interesting
    // failure is silent in either direction — a merge that should not happen, or
    // an isolation that quietly stops holding.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const make = (clusterKey: string, tab: string) => {
      const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: tab });
      return new WorkerClusterRuntime({
        clusterKey,
        environment: env.environment,
        tabId: `tab-${tab}`,
        workerId: `worker-${tab}`,
        handlers: { onControl: vi.fn(), onEvent: vi.fn() }
      });
    };
    const empty = make('', 'empty');
    const named = make('__default__', 'named');
    const other = make('another-namespace', 'other');
    empty.start();
    await Promise.resolve();
    now += 1;
    named.start();
    await Promise.resolve();
    now += 1;
    other.start();
    await Promise.resolve();

    empty.subscribe('alias.topic');
    await Promise.resolve();
    now += 1;
    named.subscribe('alias.topic');
    await Promise.resolve();
    // One cluster, so the topic has exactly one owner between them: a peer that
    // shares the route record defers to the sticky assignment rather than taking
    // a second ownership of the same channel.
    const sharedOwners = [empty, named]
      .filter(runtime => runtime.getSnapshot().assignedTopics.includes('alias.topic'))
      .map(runtime => (runtime === empty ? 'empty-key' : 'default-name'));
    expect(sharedOwners).toEqual(['empty-key']);
    // The control: an unrelated key owns its own copy of the same topic name,
    // which is what the isolation sentence means, and what would break if the
    // fallback ever matched more than the empty string.
    other.subscribe('alias.topic');
    await Promise.resolve();
    expect(other.getSnapshot().assignedTopics).toEqual(['alias.topic']);
    empty.stop();
    named.stop();
    other.stop();
  });

  it('keeps existing topic owners and balances only newly introduced topics', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'sticky-existing-routes',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'sticky-existing-routes',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    const existingTopics = ['public:STONEX:GCZ6', 'public:SCP01:XAUUSD', 'public:AutoGen:XAUFutureSpot.032'];

    runtimeA.start();
    for (const topic of existingTopics) runtimeA.subscribe(topic);
    await Promise.resolve();
    now += 1;
    runtimeB.start();
    for (const topic of existingTopics) runtimeB.subscribe(topic);
    await Promise.resolve();

    expect(runtimeA.getSnapshot().assignedTopics).toEqual(expect.arrayContaining(existingTopics));
    expect(runtimeB.getSnapshot().assignedTopics).toEqual([]);
    for (const topic of existingTopics) {
      expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', topic, undefined);
    }

    runtimeB.subscribe('public:new-topic');
    await Promise.resolve();

    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'public:new-topic', undefined);
    expect(runtimeB.isAssigned('public:new-topic')).toBe(true);
  });

  it('unsubscribes the old owner before handing off an owned topic on pagehide', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'reload-handoff',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'reload-handoff',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    now += 1;
    runtimeB.start();
    runtimeA.subscribe('shared-topic');
    await Promise.resolve();
    runtimeB.subscribe('shared-topic');
    await Promise.resolve();
    controlA.mockClear();
    controlB.mockClear();

    envA.pageHide();
    await Promise.resolve();

    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'shared-topic');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'shared-topic', undefined);
    expect(runtimeB.isAssigned('shared-topic')).toBe(true);
  });

  it('does not recreate a handed-off route after the surviving tab unsubscribes', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'handoff-unsub' });
    const control = vi.fn();
    const runtime = new WorkerClusterRuntime({ clusterKey: 'handoff-unsub', environment: env.environment, tabId: 'tab-a', workerId: 'worker-a', handlers: { onControl: control, onEvent: vi.fn() } });
    runtime.start();
    runtime.subscribe('topic');
    await Promise.resolve();
    runtime.unsubscribe('topic');
    env.runIntervals();
    expect(runtime.isAssigned('topic')).toBe(false);
    expect(control).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic', undefined);
  });

  it('publishes no worker record when a control handler stops the cluster mid-subscribe', async () => {
    // `sendControl()` dispatches a self-addressed SUBSCRIBE synchronously, and
    // that handler is application code: at the bus layer it runs through
    // `subscribeTransport()` into `transport.subscribe()`, which a host
    // implements. So `stop()` can be called between recording an assignment and
    // `updateLoad()` noticing the load changed. The guard that writes the record
    // only while started is what stops that later write from resurrecting the
    // worker the teardown had just removed — and peers read liveness out of that
    // record, so a stale one keeps routes and publications pointed at a closed
    // channel until the TTL expires. Measured by deleting the guard: the record
    // is back in storage after `stop()`, and the second runtime below lists this
    // worker as live.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'reentrant-stop' });
    let selfSubscribes = 0;
    // The handler references the instance its own initializer builds; it only
    // ever runs after that assignment, from `start()`/`subscribe()`.
    const runtimeA: WorkerClusterRuntime = new WorkerClusterRuntime({
      clusterKey: 'reentrant-stop',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: {
        onControl: (action: string) => {
          // Stopping on the second self-addressed assignment is what leaves
          // `currentRecord.load` ahead of the assignment set: the first one
          // records load 1, and the teardown clears the set right after, so the
          // mismatch is what `updateLoad()` still has to handle.
          if (action !== 'SUBSCRIBE') return;
          selfSubscribes += 1;
          if (selfSubscribes === 2) runtimeA.stop();
        },
        onEvent: vi.fn()
      }
    });
    runtimeA.start();
    await Promise.resolve();
    expect(runtimeA.subscribe('topic-a')).toBe(true);
    await Promise.resolve();
    runtimeA.subscribe('topic-b');
    await Promise.resolve();

    const workerRecords = () => storage.entries()
      .filter(([key]) => key.includes(':worker:'))
      .map(([, value]) => (JSON.parse(value) as { workerId: string }).workerId);
    expect(workerRecords()).toEqual([]);
    expect(runtimeA.getSnapshot().assignedTopics).toEqual([]);

    // A peer that joins afterwards is the consumer of that record, so the
    // assertion above is stated in its terms too: nothing may still name the
    // stopped worker as a live cluster member.
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'reentrant-observer' });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'reentrant-stop',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeB.start();
    await Promise.resolve();
    expect(runtimeB.getSnapshot().workers.map(worker => worker.workerId)).toEqual(['worker-b']);

    runtimeB.stop();
  });

  it('keeps a tab\'s private topic from migrating to a peer on pagehide', async () => {
    // A's solo topic must not reach a peer: migrating it would open a server
    // subscription nothing serves, and the route would outlive every subscriber.
    // The observable contract is what is pinned here — whichever teardown pass
    // drops the record first (releaseSubscription's own no-subscribers branch,
    // or handoffAssignedTopics' guard) both satisfy it, and only this case
    // exercises "owns a private topic across a pagehide" at all.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'orphan-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'orphan-b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'orphaned-route-handoff',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'orphaned-route-handoff',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    now += 1;
    runtimeB.start();
    runtimeA.subscribe('solo-topic');
    runtimeA.subscribe('shared-topic');
    await Promise.resolve();
    runtimeB.subscribe('shared-topic');
    await Promise.resolve();
    expect(runtimeA.isAssigned('solo-topic')).toBe(true);
    controlA.mockClear();
    controlB.mockClear();

    envA.pageHide();
    await Promise.resolve();

    // The shared topic migrates; the solo one disappears with its route record.
    expect(runtimeB.isAssigned('shared-topic')).toBe(true);
    expect(runtimeB.isAssigned('solo-topic')).toBe(false);
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'solo-topic', undefined);
    // Routes are keyed by an opaque hash, so count the surviving records instead
    // of matching plaintext: only the migrated shared topic may remain.
    const routeRecords = storage
      .entries()
      .filter(([key]) => key.includes(':route:'))
      .map(([, value]) => JSON.parse(value as string) as {
        workerId?: string;
        handoffFromWorkerId?: string;
        generation?: number;
      });
    expect(routeRecords.map(record => [record.workerId, record.handoffFromWorkerId, record.generation])).toEqual([
      ['worker-b', 'worker-a', 2]
    ]);

    runtimeB.stop();
  });

  it('deletes an unserved route when the owner leaves with no subscriber to hand to', async () => {
    // A owns `topic`; the only other subscriber is a tab that stopped
    // heartbeating without releasing — a frozen/killed tab. It is modelled on
    // its own BroadcastChannel hub so it can neither hear A's teardown nor
    // reclaim the route afterwards; only its storage records remain, which is
    // the residue the handoff has to sort out. C is a healthy peer with no
    // interest in the topic: the guard must drop the route instead of handing a
    // subscription to it. A's `pause()` runs no orphan-route cleanup (that lives
    // in `reconcile`), so this guard is the only code that can remove the record.
    const storage = new MemoryStorage();
    let now = 1_000;
    const hubAB = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub: hubAB, now: () => now, randomId: 'dead-a' });
    const envC = createFakeEnvironment({ storage, hub: hubAB, now: () => now, randomId: 'dead-c' });
    const envB = createFakeEnvironment({ storage, hub: new ChannelHub(), now: () => now, randomId: 'dead-b' });
    const diagnosticsA: Array<{ operation: string; topic: string }> = [];
    const controlC = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'dead-subscriber-handoff',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn(), onDiagnostic: event => diagnosticsA.push(event) }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'dead-subscriber-handoff',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeC = new WorkerClusterRuntime({
      clusterKey: 'dead-subscriber-handoff',
      environment: envC.environment,
      tabId: 'tab-c',
      workerId: 'worker-c',
      handlers: { onControl: controlC, onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('topic');
    await Promise.resolve();
    now += 1;
    runtimeB.start();
    runtimeB.subscribe('topic');
    await Promise.resolve();
    expect(runtimeA.isAssigned('topic')).toBe(true);

    // A stops subscribing but keeps owning the route for B.
    runtimeA.unsubscribe('topic');
    await Promise.resolve();
    const routeOf = () => storage
      .entries()
      .filter(([key]) => key.includes(':route:'))
      .map(([, value]) => {
        const route = JSON.parse(value as string) as { workerId?: string; generation?: number };
        return { workerId: route.workerId, generation: route.generation };
      });
    expect(routeOf()).toEqual([{ workerId: 'worker-a', generation: 1 }]);

    // C joins well after B went silent, then A's page closes while B is the
    // only record older than the worker TTL.
    now = 11_000;
    runtimeC.start();
    await Promise.resolve();
    now = 20_500;
    runtimeA.stop();
    await Promise.resolve();

    expect(routeOf()).toEqual([]);
    // C is never asked to serve a topic it has no subscriber for.
    expect(controlC).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic', undefined);
    expect(runtimeC.isAssigned('topic')).toBe(false);
    expect(diagnosticsA).not.toContainEqual({ operation: 'route_migration', topic: 'topic' });
    runtimeB.stop();
    runtimeC.stop();
  });

  it('releases ownership and the transport subscription when the last remote subscriber leaves', async () => {
    // A owns `topic` and the peer that shared it is now the only subscriber. When
    // even that tab unsubscribes, its CONTROL/UNSUBSCRIBE is A's only signal that
    // nobody is listening any more: A must drop the assignment *and* dispatch the
    // release to its transport, or a departed peer leaves a live server
    // subscription — and its inbound publications keep fanning out — forever.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'last-sub-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'last-sub-b' });
    const controlA = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'last-subscriber-release',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'last-subscriber-release',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeA.subscribe('topic');
    await Promise.resolve();
    runtimeB.subscribe('topic');
    await Promise.resolve();
    expect(runtimeA.isAssigned('topic')).toBe(true);

    // A stops listening itself, so B's record is the only thing keeping the route.
    runtimeA.unsubscribe('topic');
    await Promise.resolve();
    expect(runtimeA.isAssigned('topic')).toBe(true);
    controlA.mockClear();

    runtimeB.unsubscribe('topic');
    await Promise.resolve();
    await Promise.resolve();

    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic', undefined);
    expect(runtimeA.isAssigned('topic')).toBe(false);
    expect(storage.entries().filter(([key]) => key.includes(':route:'))).toEqual([]);
    runtimeA.stop();
    runtimeB.stop();
  });

  it('completes a four-tab handoff when the pagehide control message is lost', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const controls = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const diagnostics: Array<Array<{ operation: string; topic: string }>> = [[], [], [], []];
    const environments = ['a', 'b', 'c', 'd'].map(randomId =>
      createFakeEnvironment({ storage, hub, now: () => now, randomId })
    );
    const runtimes = environments.map((environment, index) =>
      new WorkerClusterRuntime({
        clusterKey: 'notice-failover',
        environment: environment.environment,
        tabId: `tab-${index}`,
        workerId: `worker-${index}`,
        maxActiveWorkers: 3,
        handlers: {
          onControl: controls[index]!,
          onEvent: vi.fn(),
          onDiagnostic: event => diagnostics[index]!.push(event)
        }
      })
    );

    for (const runtime of runtimes) {
      runtime.start();
      runtime.subscribe('notice-token-topic');
      now += 1;
      await Promise.resolve();
    }
    expect(runtimes[0]!.isAssigned('notice-token-topic')).toBe(true);
    controls.forEach(control => control.mockClear());

    hub.dropNextControl();
    environments[0]!.pageHide();
    await Promise.resolve();

    expect(runtimes[1]!.isAssigned('notice-token-topic')).toBe(true);
    expect(controls[1]).toHaveBeenCalledWith('SUBSCRIBE', 'notice-token-topic', undefined);
    expect(runtimes[1]!.getSnapshot().routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workerId: 'worker-1', confirmedAt: expect.any(Number) })
      ])
    );
    // A graceful handoff reports the plain migration operation — the
    // recovery variant is reserved for TTL-gated stranded re-elections.
    expect(diagnostics.flat()).toContainEqual({ operation: 'route_migration', topic: 'notice-token-topic' });
    expect(diagnostics.flat()).not.toContainEqual({
      operation: 'route_migration_recovery',
      topic: 'notice-token-topic'
    });
  });

  it('does not unsubscribe the owner when a non-owner tab reloads', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_001, randomId: 'b' });
    const controlA = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'non-owner-reload',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'non-owner-reload',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeA.subscribe('shared-topic');
    await Promise.resolve();
    runtimeB.subscribe('shared-topic');
    await Promise.resolve();
    controlA.mockClear();

    envB.pageHide();
    await Promise.resolve();

    expect(controlA).not.toHaveBeenCalledWith('UNSUBSCRIBE', 'shared-topic', undefined);
    expect(runtimeA.isAssigned('shared-topic')).toBe(true);
  });

  it('retries an unconfirmed remote assignment after a control message is lost', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_001, randomId: 'b' });
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'assignment-confirmation',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'assignment-confirmation',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeA.subscribe('first-topic');
    await Promise.resolve();
    hub.dropNextControl();

    runtimeA.subscribe('second-topic');
    await Promise.resolve();
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'second-topic', undefined);
    expect(runtimeA.getSnapshot().routes.find(route => route.workerId === 'worker-b')?.confirmedAt).toBeUndefined();

    envA.runIntervals();
    await Promise.resolve();
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'second-topic', undefined);
    expect(runtimeA.getSnapshot().routes.find(route => route.workerId === 'worker-b')?.confirmedAt).toBe(1_001);
  });

  it('removes expired routes that no longer have subscriber tabs', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const environment = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'cleanup' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'route-cleanup',
      environment: environment.environment,
      tabId: 'tab-cleanup',
      workerId: 'worker-cleanup',
      workerTtlMs: 10_000,
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('expired-topic');
    await Promise.resolve();
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'));
    const subscriberEntry = storage.entries().find(([key]) => key.includes(':subscriber:'));
    expect(routeEntry).toBeDefined();
    expect(subscriberEntry).toBeDefined();
    runtime.unsubscribe('expired-topic');
    if (routeEntry) storage.setItem(routeEntry[0], routeEntry[1]);
    if (subscriberEntry) {
      storage.setItem(subscriberEntry[0], JSON.stringify({ tabId: 'expired-tab', updatedAt: now }));
    }

    now += 10_001;
    environment.runIntervals();
    await Promise.resolve();

    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(false);
    expect(storage.entries().some(([key]) => key.includes(':subscriber:'))).toBe(false);
  });

  it('forwards events to other tabs without persisting topic or payload text', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_001, randomId: 'b' });
    const onEvent = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'private-connection-context',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'private-connection-context',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeA.subscribe('secret-topic');
    runtimeB.subscribe('secret-topic');
    runtimeA.broadcastEvent('publication', { topic: 'secret-topic', value: 'payload-secret' });

    expect(onEvent).toHaveBeenCalledWith(
      'publication',
      { topic: 'secret-topic', value: 'payload-secret' },
      'worker-a',
      'tab-a'
    );
    const persisted = storage.entries().flat().join('\n');
    expect(persisted).not.toContain('private-connection-context');
    expect(persisted).not.toContain('secret-topic');
    expect(persisted).not.toContain('payload-secret');
  });

  it('ignores unknown protocol message variants and reports them to the opt-in hook', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'unknown' });
    const onUnknownMessage = vi.fn();
    const runtime = new WorkerClusterRuntime({ clusterKey: 'unknown', environment: env.environment, tabId: 'tab-unknown', workerId: 'worker-unknown', handlers: { onControl: vi.fn(), onEvent: vi.fn(), onUnknownMessage } });
    runtime.start();
    (runtime as unknown as { handleMessage: (event: MessageEvent) => void }).handleMessage({ data: { type: 'FUTURE_PROTOCOL_V2', sourceWorkerId: 'other', payload: { value: 1 } } } as MessageEvent);
    expect(onUnknownMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'FUTURE_PROTOCOL_V2' }));
    runtime.stop();
  });

  it('exposes protocol version and accepts legacy and versioned frames', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'versioned' });
    const onControl = vi.fn();
    const onEvent = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'versioned', environment: env.environment, tabId: 'tab-versioned', workerId: 'worker-versioned',
      handlers: { onControl, onEvent }
    });
    runtime.start();
    expect(runtime.getSnapshot().protocolVersion).toBe(1);
    const handleMessage = (runtime as unknown as { handleMessage: (event: MessageEvent) => void }).handleMessage;
    handleMessage({ data: { type: 'EVENT', sourceWorkerId: 'peer', eventType: 'publication', payload: { value: 1 }, protocolVersion: 1 } } as MessageEvent);
    handleMessage({ data: { type: 'EVENT', sourceWorkerId: 'peer', eventType: 'publication', payload: { value: 2 } } } as MessageEvent);
    expect(onEvent).toHaveBeenCalledTimes(2);
    runtime.stop();
  });

  it('reports versioned and legacy peer capabilities in its snapshot', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'capability-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'capability-b' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'capabilities', environment: envA.environment, tabId: 'tab-a', workerId: 'worker-a',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'capabilities', environment: envB.environment, tabId: 'tab-b', workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeB.start();
    await Promise.resolve();

    expect(runtimeA.getSnapshot().peerProtocolVersions).toEqual({ 'worker-a': 1, 'worker-b': 1 });
    const legacyEntry = storage.entries().find(([key, value]) => key.includes(':worker:worker-b') && value.includes('worker-b'));
    expect(legacyEntry).toBeDefined();
    const [legacyKey, legacyValue] = legacyEntry!;
    const legacyRecord = JSON.parse(legacyValue) as Record<string, unknown>;
    delete legacyRecord.protocolVersion;
    storage.setItem(legacyKey, JSON.stringify(legacyRecord));

    expect(runtimeA.getSnapshot().peerProtocolVersions).toEqual({ 'worker-a': 1, 'worker-b': null });
    runtimeA.stop();
    runtimeB.stop();
  });

  it('falls back to the local worker when BroadcastChannel is unavailable', () => {
    const storage = new MemoryStorage();
    const env = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'local' });
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'cluster',
      environment: env.environment,
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('topic');

    expect(runtime.getSnapshot().coordinated).toBe(false);
    expect(onControl).toHaveBeenCalledWith('SUBSCRIBE', 'topic', undefined);
    expect(runtime.isAssigned('topic')).toBe(true);
  });

  it('keeps subscription intent across pagehide and restores it on pageshow', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lifecycle' });
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'lifecycle',
      environment: env.environment,
      tabId: 'tab-lifecycle',
      workerId: 'worker-lifecycle',
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('topic');
    await Promise.resolve();
    env.pageHide();
    await Promise.resolve();

    expect(runtime.getSnapshot().suspended).toBe(true);
    expect(runtime.getSnapshot().subscribedTopics).toEqual(['topic']);

    env.pageShow();
    expect(runtime.getSnapshot().suspended).toBe(false);
    expect(onControl).toHaveBeenCalledWith('SUBSCRIBE', 'topic', undefined);
  });

  it('preserves a pagehide re-entered from onResume for the next pageshow', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'resume-rehide' });
    let rehideOnResume = false;
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'resume-rehide',
      environment: env.environment,
      tabId: 'tab-resume-rehide',
      workerId: 'worker-resume-rehide',
      handlers: {
        onControl: vi.fn(),
        onEvent: vi.fn(),
        onResume: () => {
          if (rehideOnResume) env.pageHide();
        }
      }
    });

    runtime.start();
    runtime.subscribe('topic');
    await Promise.resolve();
    env.pageHide();
    expect(runtime.getSnapshot().suspended).toBe(true);

    // The document hides again while pageshow is synchronously notifying its
    // resume callback. That newer lifecycle must keep the cluster suspended
    // instead of leaving it inactive with `suspended: false`.
    rehideOnResume = true;
    env.pageShow();
    expect(runtime.getSnapshot()).toMatchObject({ suspended: true, coordinated: false });

    rehideOnResume = false;
    env.pageShow();
    expect(runtime.getSnapshot()).toMatchObject({ suspended: false, coordinated: true });
    expect(runtime.isAssigned('topic')).toBe(true);
    runtime.stop();
  });

  it('flushes batched storage writes before pagehide returns', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'flush' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'flush-before-hide',
      environment: env.environment,
      tabId: 'tab-flush',
      workerId: 'worker-flush',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    runtime.subscribe('topic');
    await Promise.resolve();

    expect(storage.entries().length).toBeGreaterThan(0);
    env.pageHide();
    await Promise.resolve();

    expect(runtime.getSnapshot().suspended).toBe(true);
    expect(storage.entries()).toEqual([]);
  });

  it('does not retry failed storage removals after pagehide teardown', async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      const hub = new ChannelHub();
      const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'failed-hide' });
      const runtime = new WorkerClusterRuntime({
        clusterKey: 'failed-pagehide-flush',
        environment: env.environment,
        tabId: 'tab-failed-hide',
        workerId: 'worker-failed-hide',
        handlers: { onControl: vi.fn(), onEvent: vi.fn() }
      });
      runtime.start();
      runtime.subscribe('topic');
      await Promise.resolve();

      const originalRemoveItem = storage.removeItem.bind(storage);
      let failedRemovals = 0;
      storage.removeItem = () => {
        failedRemovals += 1;
        throw new DOMException('storage blocked', 'SecurityError');
      };

      env.pageHide();
      const attemptsAtTeardown = failedRemovals;
      expect(attemptsAtTeardown).toBeGreaterThan(0);

      // The zero-delay channel close may still run, but the discarded batching
      // state must not perform any delayed storage retry after teardown.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(failedRemovals).toBe(attemptsAtTeardown);

      storage.removeItem = originalRemoveItem;
      env.pageShow();
      expect(runtime.getSnapshot()).toMatchObject({ suspended: false, coordinated: true });
      runtime.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the cluster channel synchronously when the environment has no setTimeout', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'no-settimeout' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'no-settimeout',
      environment: env.environment,
      tabId: 'tab-no-timeout',
      workerId: 'worker-no-timeout',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    const channel = `${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('no-settimeout')}`;
    expect(hub.liveChannelCount(channel)).toBe(1);

    // The deferral exists so a handoff's ROUTE_RELEASED can flush before the
    // channel goes away; the fallback is that same close without the deferral. A
    // timerless host that skipped the fallback would leave the channel attached
    // to the hub, which keeps routing frames to it — a behavioural leak, not just
    // a counter that never reaches zero.
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as { setTimeout: unknown }).setTimeout = undefined;
    try {
      runtime.stop();
      expect(hub.liveChannelCount(channel)).toBe(0);
    } finally {
      (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
    }
  });

  it('keeps a live topic owner when its tab becomes hidden', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'visibility',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'visibility',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    now += 1;
    runtimeB.start();
    runtimeA.subscribe('topic');
    await Promise.resolve();
    expect(runtimeA.isAssigned('topic')).toBe(true);

    envA.setVisibility('hidden');
    runtimeB.subscribe('topic');
    await Promise.resolve();

    expect(runtimeA.isAssigned('topic')).toBe(true);
    expect(runtimeB.isAssigned('topic')).toBe(false);
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic', undefined);
    expect(runtimeB.publish('topic', { value: 1 })).toBe(true);
    expect(controlA).toHaveBeenCalledWith('PUBLISH', 'topic', { value: 1 });
  });

  it('caps knownTopics at MAX_KNOWN_TOPICS and evicts the oldest non-owned entries first (FIFO)', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'fifo' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'known-topics-fifo',
      environment: env.environment,
      tabId: 'tab-fifo',
      workerId: 'worker-fifo',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    // publish() fills knownTopics via rememberTopic without creating ownership,
    // so all 600 entries stay non-owned and become eligible for FIFO eviction.
    for (let index = 0; index < 600; index += 1) {
      runtime.publish(`fifo-topic-${index}`, { value: index });
    }

    const known = runtime.getSnapshot().knownTopics;
    const topics = new Set(known.map(entry => entry.topic));
    // Cache is capped at 500 entries.
    expect(known.length).toBe(500);
    // Oldest 100 published topics were evicted first.
    for (let index = 0; index < 100; index += 1) {
      expect(topics.has(`fifo-topic-${index}`)).toBe(false);
    }
    // The most recent 500 survive.
    for (let index = 100; index < 600; index += 1) {
      expect(topics.has(`fifo-topic-${index}`)).toBe(true);
    }
  });

  it('never evicts a topic the worker still owns from knownTopics', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'owner' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'known-topics-owner',
      environment: env.environment,
      tabId: 'tab-owner',
      workerId: 'worker-owner',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    // The subscribed topic is self-owned and inserted first.
    runtime.subscribe('owned-topic');
    expect(runtime.isAssigned('owned-topic')).toBe(true);
    // Flood the cache with non-owned entries that would evict the oldest key.
    for (let index = 0; index < 600; index += 1) {
      runtime.publish(`fill-topic-${index}`, { value: index });
    }

    const known = runtime.getSnapshot().knownTopics;
    expect(known.some(entry => entry.topic === 'owned-topic')).toBe(true);
  });

  it('keeps the storage-less path coherent when knownTopics caps out', async () => {
    // A storage that rejects every write makes canUseStorage fail, so the
    // Runtime runs in storage-less mode where readRoute/readSubscriberTabIds
    // rely on the knownTopics reverse cache.
    const brokenStorage = new (class extends MemoryStorage {
      override setItem(): void {
        throw new Error('QuotaExceededError');
      }
    })();
    const env = createFakeEnvironment({ storage: brokenStorage, now: () => 1_000, randomId: 'nolocal' });
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'known-topics-nostorage',
      environment: env.environment,
      tabId: 'tab-nolocal',
      workerId: 'worker-nolocal',
      handlers: { onControl, onEvent: vi.fn() }
    });
    runtime.start();
    expect(runtime.getSnapshot().coordinated).toBe(false);

    // Subscribe to a topic and flood the cache past the cap.
    runtime.subscribe('owned-topic');
    for (let index = 0; index < 600; index += 1) {
      runtime.publish(`fill-topic-${index}`, { value: index });
    }
    await Promise.resolve();

    // The owned topic must still resolve as assigned even though the reverse
    // cache held >500 entries, and isAssigned must agree with readRoute.
    expect(runtime.isAssigned('owned-topic')).toBe(true);
    expect(onControl).toHaveBeenCalledWith('SUBSCRIBE', 'owned-topic', undefined);
    // A published-but-unowned topic resolves through rememberTopic's cache path.
    expect(runtime.isAssigned('fill-topic-599')).toBe(false);
  });

  it('evicts the least-recently-resolved route owner once the cap is reached', async () => {
    // Only *remote* owners populate this cache: a locally owned topic takes the
    // `assignedTopics` fast path in `publish()` and never reaches
    // `resolvePublishTarget()`. So the cap has to be driven from a peer.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-cap-A' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-cap-B' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'lru-cap',
      environment: envA.environment,
      tabId: 'tab-cap-A',
      workerId: 'worker-cap-A',
      routeOwnerCacheMax: 2,
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'lru-cap',
      environment: envB.environment,
      tabId: 'tab-cap-B',
      workerId: 'worker-cap-B',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeB.subscribe('bench.cap.a');
    runtimeB.subscribe('bench.cap.b');
    runtimeB.subscribe('bench.cap.c');
    await Promise.resolve();
    envB.runIntervals();
    envA.runIntervals();

    // Fill to the cap, then refresh `a` so `b` becomes the oldest entry.
    runtimeA.publish('bench.cap.a', { value: 1 });
    runtimeA.publish('bench.cap.b', { value: 2 });
    runtimeA.publish('bench.cap.a', { value: 3 });
    // Inserting `c` overflows the cap and must drop `b`, not `a`.
    runtimeA.publish('bench.cap.c', { value: 4 });

    const snapshot = runtimeA.getSnapshot().routeOwnerCache;
    expect(snapshot?.max).toBe(2);
    expect(snapshot?.size).toBe(2);
    expect(snapshot?.hits).toBe(1);
    expect(snapshot?.misses).toBe(3);

    // The refreshed entry survives the overflow, and the evicted one resolves
    // as a miss again — the distinction between LRU and plain insertion-order
    // eviction. `a` is probed first because re-resolving `b` overflows the cap
    // again and would itself drop `a`.
    runtimeA.publish('bench.cap.a', { value: 5 });
    runtimeA.publish('bench.cap.b', { value: 6 });
    const after = runtimeA.getSnapshot().routeOwnerCache;
    expect(after?.size).toBe(2);
    expect(after?.hits).toBe(2);
    expect(after?.misses).toBe(4);

    runtimeA.stop();
    runtimeB.stop();
  });

  it('clears route owner cache diagnostics when stopped', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-stop' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'lru-stop',
      environment: env.environment,
      tabId: 'tab-stop',
      workerId: 'worker-stop',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtime.start();
    runtime.publish('bench.stop.topic', { value: 1 });
    expect(runtime.getSnapshot().routeOwnerCache?.misses).toBe(1);
    runtime.stop();
    expect(runtime.getSnapshot().routeOwnerCache?.size).toBe(0);
  });

  it('route owner cache populates for a remote owner and serves subsequent publishes from cache', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-remote-A' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-remote-B' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'lru-remote',
      environment: envA.environment,
      tabId: 'tab-remote-A',
      workerId: 'worker-remote-A',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'lru-remote',
      environment: envB.environment,
      tabId: 'tab-remote-B',
      workerId: 'worker-remote-B',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeB.subscribe('bench.remote.topic');
    await Promise.resolve();
    envA.runIntervals();
    envB.runIntervals();
    runtimeA.publish('bench.remote.topic', { value: 1 });
    const after1 = runtimeA.getSnapshot().routeOwnerCache;

    expect(after1?.misses).toBe(1);
    expect(after1?.hits).toBe(0);

    runtimeA.publish('bench.remote.topic', { value: 2 });
    const after2 = runtimeA.getSnapshot().routeOwnerCache;

    expect(after2?.hits).toBeGreaterThanOrEqual(1);
    runtimeA.stop();
    runtimeB.stop();
  });

  it('route owner cache misses on the first publish and reuses a fresh route', () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const env = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-miss' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'lru-miss',
      environment: env.environment,
      tabId: 'tab-miss',
      workerId: 'worker-miss',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtime.start();
    const before = runtime.getSnapshot().routeOwnerCache;
    expect(before?.misses).toBe(0);
    runtime.publish('bench.miss.topic', { value: 1 });
    const after = runtime.getSnapshot().routeOwnerCache;
    expect(after?.misses).toBe(1);
  });

  it('route owner cache falls back when the cached worker TTL expires', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const environmentA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'lru-ttl-A' });
    const environmentB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'lru-ttl-B' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'lru-ttl',
      environment: environmentA.environment,
      tabId: 'tab-ttl-A',
      workerId: 'worker-ttl-A',
      workerTtlMs: 5_000,
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'lru-ttl',
      environment: environmentB.environment,
      tabId: 'tab-ttl-B',
      workerId: 'worker-ttl-B',
      workerTtlMs: 5_000,
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeB.subscribe('bench.ttl.topic');
    await Promise.resolve();
    environmentA.runIntervals();
    environmentB.runIntervals();
    runtimeA.publish('bench.ttl.topic', { value: 1 });
    const firstSnapshot = runtimeA.getSnapshot().routeOwnerCache;
    expect(firstSnapshot?.misses).toBe(1);
    // Worker B 'crashes' (no pagehide, no stop): we stop ticking B and jump
    // time past its 5s TTL, then let only A reconcile. A's route cache for B
    // should now be invalid; the next publish must re-resolve.
    now += 5_001;
    environmentA.runIntervals();
    await Promise.resolve();
    runtimeA.publish('bench.ttl.topic', { value: 2 });
    const secondSnapshot = runtimeA.getSnapshot().routeOwnerCache;
    expect(secondSnapshot?.misses).toBeGreaterThanOrEqual(2);
    expect(secondSnapshot?.size).toBeLessThanOrEqual(1);
    runtimeA.stop();
    runtimeB.stop();
  });

  it('route owner cache survives an owner migration and routes to the new owner', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-mig-A' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-mig-B' });
    const envC = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'lru-mig-C' });
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'lru-mig',
      environment: envA.environment,
      tabId: 'tab-mig-A',
      workerId: 'worker-mig-A',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'lru-mig',
      environment: envB.environment,
      tabId: 'tab-mig-B',
      workerId: 'worker-mig-B',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    const runtimeC = new WorkerClusterRuntime({
      clusterKey: 'lru-mig',
      environment: envC.environment,
      tabId: 'tab-mig-C',
      workerId: 'worker-mig-C',
      handlers: { onControl: () => {}, onEvent: () => {} }
    });
    runtimeA.start();
    runtimeB.start();
    runtimeC.start();
    // B subscribes first; A and C publish to its topic.
    runtimeB.subscribe('bench.mig.topic');
    await Promise.resolve();
    envA.runIntervals();
    envB.runIntervals();
    envC.runIntervals();
    runtimeA.publish('bench.mig.topic', { value: 1 });
    const cacheA = runtimeA.getSnapshot().routeOwnerCache;
    expect(cacheA?.misses).toBe(1);
    // B hands off (pagehide) and C takes ownership. B's pagehide triggers a
    // graceful handoff; C is the least-loaded worker so it wins the race.
    envB.pageHide();
    await Promise.resolve();
    envA.runIntervals();
    envB.runIntervals();
    envC.runIntervals();
    await Promise.resolve();
    await Promise.resolve();
    // After migration the route owner should have changed. A's next publish
    // must miss (cached owner is stale) and successfully route to the new owner.
    runtimeA.publish('bench.mig.topic', { value: 2 });
    const cacheA2 = runtimeA.getSnapshot().routeOwnerCache;
    expect(cacheA2?.misses).toBeGreaterThanOrEqual(2);
    runtimeA.stop();
    runtimeB.stop();
    runtimeC.stop();
  });
});


describe('WorkerClusterRuntime publishBatch', () => {
  function makeBatchRuntime(options: {
    clusterKey: string;
    tabId: string;
    workerId: string;
    onControl: (action: WorkerControlAction, topic: string, data?: unknown, messageId?: string, timestamp?: number) => void;
    onEvent?: (eventType: string, payload: unknown, sourceWorkerId: string, originTabId?: string) => void;
  }): { runtime: WorkerClusterRuntime; env: ReturnType<typeof createFakeEnvironment> } {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const env = createFakeEnvironment({
      storage,
      hub,
      now: () => now,
      randomId: options.workerId
    });
    const runtime = new WorkerClusterRuntime({
      clusterKey: options.clusterKey,
      environment: env.environment,
      tabId: options.tabId,
      workerId: options.workerId,
      handlers: { onControl: options.onControl, onEvent: options.onEvent ?? vi.fn() }
    });
    return { runtime, env };
  }

  it('treats an empty batch as a no-op', () => {
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-empty',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: vi.fn()
    });
    runtime.start();
    expect(runtime.publishBatch('any', [])).toBe(true);
    runtime.stop();
  });

  it('delegates a single-item batch to publish()', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-single',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('feed.tick');
    await Promise.resolve();
    const before = control.mock.calls.length;
    expect(runtime.publishBatch('feed.tick', [{ data: { p: 1 }, messageId: 'm-single', timestamp: 7 }])).toBe(true);
    await Promise.resolve();
    expect(control).toHaveBeenLastCalledWith('PUBLISH', 'feed.tick', { p: 1 }, 'm-single', 7);
    expect(control.mock.calls.length).toBe(before + 1);
    runtime.stop();
  });

  it('forwards the string form of the third publish() argument as the message id', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'publish-legacy-id',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('feed.legacy');
    await Promise.resolve();
    control.mockClear();
    // `publish(topic, data, messageId)` is a declared overload on the exported
    // runtime, and the normalization is the only thing that turns it into the
    // metadata object every downstream reader expects. `CrossTabDataBus.publish`
    // always passes an object, so nothing reaches this through the bus.
    expect(runtime.publish('feed.legacy', { v: 1 }, 'legacy-id')).toBe(true);
    expect(control).toHaveBeenCalledTimes(1);
    expect(control).toHaveBeenCalledWith('PUBLISH', 'feed.legacy', { v: 1 }, 'legacy-id', undefined);
    runtime.stop();
  });

  it('delegates a single-item batch whose item carries partial or no metadata', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-single-partial',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('feed.partial');
    await Promise.resolve();
    control.mockClear();
    // No metadata at all: `publish()` must be handed `undefined`, not an empty
    // object, because the arity of the handler call is what tells a listener
    // "this publication arrived without an id" from "it arrived with an id of
    // undefined". `sendControl` takes the three-argument branch only for a falsy
    // metadata, so an always-built object would pass this test's other two
    // assertions and fail only this one.
    expect(runtime.publishBatch('feed.partial', [{ data: 1 }])).toBe(true);
    expect(control).toHaveBeenLastCalledWith('PUBLISH', 'feed.partial', 1);
    expect(runtime.publishBatch('feed.partial', [{ data: 2, messageId: 'm2' }])).toBe(true);
    expect(control).toHaveBeenLastCalledWith('PUBLISH', 'feed.partial', 2, 'm2', undefined);
    expect(runtime.publishBatch('feed.partial', [{ data: 3, timestamp: 33 }])).toBe(true);
    expect(control).toHaveBeenLastCalledWith('PUBLISH', 'feed.partial', 3, undefined, 33);
    expect(control).toHaveBeenCalledTimes(3);
    runtime.stop();
  });

  it('dispatches every item locally when the topic is assigned to this worker', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-local',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('feed.live');
    await Promise.resolve();
    control.mockClear();
    expect(runtime.publishBatch('feed.live', [
      { data: 1, messageId: 'a' },
      { data: 2, timestamp: 99 },
      { data: 3, messageId: 'c', timestamp: 100 }
    ])).toBe(true);
    await Promise.resolve();
    const publishCalls = control.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishCalls).toHaveLength(3);
    expect(publishCalls[0]).toEqual(['PUBLISH', 'feed.live', 1, 'a', undefined]);
    expect(publishCalls[1]).toEqual(['PUBLISH', 'feed.live', 2, undefined, 99]);
    expect(publishCalls[2]).toEqual(['PUBLISH', 'feed.live', 3, 'c', 100]);
    runtime.stop();
  });

  it('routes a batch through a remote owner and unpacks every item on the receiver', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'batch-remote-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'batch-remote-b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'batch-remote',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'batch-remote',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('remote.feed');
    await Promise.resolve();
    now += 1;
    runtimeB.start();
    controlA.mockClear();

    expect(runtimeB.publishBatch('remote.feed', [
      { data: { i: 0 }, messageId: 'm0' },
      { data: { i: 1 }, timestamp: 11 },
      { data: { i: 2 }, messageId: 'm2', timestamp: 22 },
      { data: { i: 3 } }
    ])).toBe(true);
    await Promise.resolve();
    const publishCalls = controlA.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishCalls).toHaveLength(4);
    expect(publishCalls[0]).toEqual(['PUBLISH', 'remote.feed', { i: 0 }, 'm0', undefined]);
    expect(publishCalls[1]).toEqual(['PUBLISH', 'remote.feed', { i: 1 }, undefined, 11]);
    expect(publishCalls[2]).toEqual(['PUBLISH', 'remote.feed', { i: 2 }, 'm2', 22]);
    // The plain item is the common case (publishBatch without any metadata),
    // and it must still dispatch — the receiver's metadata-less branch.
    expect(publishCalls[3]).toEqual(['PUBLISH', 'remote.feed', { i: 3 }]);
    runtimeA.stop();
    runtimeB.stop();
  });

  it('hands a batched CONTROL to onPublishBatch once when the receiver supports it', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'batch-owner-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'batch-owner-b' });
    const controlA = vi.fn();
    const batchA = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'batch-owner',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onPublishBatch: batchA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'batch-owner',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtimeA.start();
    runtimeA.subscribe('remote.batch');
    await Promise.resolve();
    now += 1;
    runtimeB.start();

    expect(runtimeB.publishBatch('remote.batch', [
      { data: { i: 0 }, messageId: 'm0' },
      { data: { i: 1 }, timestamp: 11 }
    ])).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(batchA).toHaveBeenCalledTimes(1);
    expect(batchA).toHaveBeenCalledWith('remote.batch', [
      { data: { i: 0 }, messageId: 'm0' },
      { data: { i: 1 }, timestamp: 11 }
    ]);
    expect(controlA).not.toHaveBeenCalledWith('PUBLISH', expect.anything(), expect.anything());
    runtimeA.stop();
    runtimeB.stop();
  });

  it('dispatches a batch through a wildcard assignment when the concrete topic is not owned', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-wildcard',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('feed.*');
    await Promise.resolve();
    control.mockClear();
    expect(runtime.publishBatch('feed.room-1', [
      { data: 'a' },
      { data: 'b' },
      { data: 'c' }
    ])).toBe(true);
    await Promise.resolve();
    const publishCalls = control.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishCalls.map(call => call[1])).toEqual(['feed.room-1', 'feed.room-1', 'feed.room-1']);
    expect(publishCalls.map(call => call[2])).toEqual(['a', 'b', 'c']);
    runtime.stop();
  });

  it('preserves item order for large batches', async () => {
    const control = vi.fn();
    const { runtime } = makeBatchRuntime({
      clusterKey: 'batch-order',
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: control
    });
    runtime.start();
    runtime.subscribe('order.topic');
    await Promise.resolve();
    control.mockClear();
    const N = 50;
    const items = Array.from({ length: N }, (_, i) => ({ data: i, messageId: `id-${i}` }));
    expect(runtime.publishBatch('order.topic', items)).toBe(true);
    await Promise.resolve();
    const publishCalls = control.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishCalls).toHaveLength(N);
    publishCalls.forEach((call, index) => {
      expect(call[2]).toBe(index);
      expect(call[3]).toBe(`id-${index}`);
    });
    runtime.stop();
  });
});


describe('WorkerClusterRuntime resilience', () => {
  function makeRuntime(options: {
    storage: MemoryStorage;
    hub?: ChannelHub;
    now?: () => number;
    clusterKey?: string;
    tabId: string;
    workerId: string;
    workerTtlMs?: number;
    onControl?: (action: string, topic: string, data?: unknown) => void;
    onDiagnostic?: (event: { operation: string; topic: string }) => void;
    onUnknownMessage?: (message: unknown) => void;
  }) {
    const env = createFakeEnvironment({
      storage: options.storage,
      ...(options.hub ? { hub: options.hub } : {}),
      now: options.now ?? (() => 1_000),
      randomId: options.workerId
    });
    const runtime = new WorkerClusterRuntime({
      clusterKey: options.clusterKey ?? 'resilience',
      environment: env.environment,
      tabId: options.tabId,
      workerId: options.workerId,
      ...(options.workerTtlMs !== undefined ? { workerTtlMs: options.workerTtlMs } : {}),
      handlers: {
        onControl: options.onControl ?? vi.fn(),
        onEvent: vi.fn(),
        ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
        ...(options.onUnknownMessage ? { onUnknownMessage: options.onUnknownMessage } : {})
      }
    });
    return { env, runtime };
  }

  it('treats a corrupt route record as absent instead of throwing', () => {
    const storage = new MemoryStorage();
    const { runtime } = makeRuntime({ storage, tabId: 'tab-a', workerId: 'worker-a' });
    runtime.start();
    runtime.subscribe('topic-a');
    // Corrupt every route record on disk.
    for (const [key, value] of storage.entries()) {
      if (key.includes(':route:')) storage.setItem(key, `${value}{corrupted`);
    }
    expect(() => runtime.getSnapshot()).not.toThrow();
    expect(runtime.getSnapshot().routes).toEqual([]);
    // isAssigned falls back to the in-memory assignment.
    expect(runtime.isAssigned('topic-a')).toBe(true);
  });

  it('keeps the runtime usable when storage writes start failing mid-session', async () => {
    vi.useFakeTimers();
    try {
      let failWrites = false;
      const flaky = new (class extends MemoryStorage {
        override setItem(key: string, value: string): void {
          if (failWrites) throw new Error('QuotaExceededError');
          super.setItem(key, value);
        }
        override removeItem(key: string): void {
          if (failWrites) throw new Error('QuotaExceededError');
          super.removeItem(key);
        }
      })();
      const setItemSpy = vi.spyOn(flaky, 'setItem');
      // Pass the flaky adapter at construction so the runtime's batching writer
      // actually wraps it. Replacing environment.storage afterwards would only
      // mutate the test harness; the runtime has already captured its adapter.
      const { env, runtime } = makeRuntime({ storage: flaky, hub: new ChannelHub(), tabId: 'tab-a', workerId: 'worker-a' });
      runtime.start();
      runtime.subscribe('topic-a');
      await vi.advanceTimersByTimeAsync(0);
      const successfulWrites = setItemSpy.mock.calls.length;

      failWrites = true;
      expect(() => {
        runtime.subscribe('topic-b');
        env.runIntervals();
        runtime.unsubscribe('topic-a');
      }).not.toThrow();
      await vi.advanceTimersByTimeAsync(10_000);

      // Coordination persistence is best-effort: repeated quota failures are
      // contained, while the local assignment and control plane remain usable.
      expect(runtime.isAssigned('topic-b')).toBe(true);
      expect(runtime.getSnapshot().subscribedTopics).toEqual(['topic-b']);
      expect(setItemSpy.mock.calls.length).toBeGreaterThan(successfulWrites);
      failWrites = false;
      runtime.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reclaims a confirmed self-route whose assignment was lost with its handoff write', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const onControlA = vi.fn();
    const a = makeRuntime({ storage, hub, tabId: 'tab-a', workerId: 'worker-a', onControl: onControlA });
    const b = makeRuntime({ storage, hub, tabId: 'tab-b', workerId: 'worker-b' });
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    b.runtime.start();
    b.runtime.subscribe('topic-a');
    await Promise.resolve();

    // A owns the topic and B is a second subscriber, so A's pagehide has to hand
    // the route over. Failed writes cut that flush short, and the teardown ends
    // with `discardPending()`, so the durable record still names worker-a — while
    // `pause()` has cleared the in-memory assignment map, and a handoff the new
    // owner cannot confirm (the route it authorizes against names somebody else)
    // leaves no worker holding the transport either.
    storage.failNextWrites(2);
    a.env.pageHide();
    await Promise.resolve();
    const routeOf = (topic: string) =>
      JSON.parse(storage.entries().find(([key]) => key.includes(`:route:${createOpaqueKey(topic)}`))![1]!) as Record<string, unknown>;
    expect(routeOf('topic-a')).toMatchObject({ workerId: 'worker-a', generation: 1 });
    expect(a.runtime.getSnapshot().assignedTopics).toEqual([]);

    // The tab comes back — a BFCache restore, so the same worker id registers
    // again with its local subscription intact.
    a.env.pageShow();
    await Promise.resolve();

    expect(a.runtime.getSnapshot().assignedTopics).toEqual(['topic-a']);
    expect(onControlA).toHaveBeenLastCalledWith(CONTROL_ACTION.SUBSCRIBE, 'topic-a', undefined);
    // Reclaiming is not re-electing: the owner and its generation are untouched,
    // so peers see no churn on a route that already named this worker.
    expect(routeOf('topic-a')).toMatchObject({ workerId: 'worker-a', generation: 1, confirmedAt: 1_000 });
    expect(b.runtime.getSnapshot().assignedTopics).toEqual([]);
  });

  it('releases a confirmed self-route that names this worker for a topic it no longer subscribes', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const a1 = makeRuntime({ storage, hub, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({ storage, hub, tabId: 'tab-b', workerId: 'worker-b' });
    a1.runtime.start();
    a1.runtime.subscribe('topic-a');
    await Promise.resolve();
    b.runtime.start();
    b.runtime.subscribe('topic-a');
    await Promise.resolve();
    storage.failNextWrites(2);
    a1.env.pageHide();
    await Promise.resolve();

    // The same route survives into a *new* runtime that carries the same worker
    // id (an explicit `workerId`, or a worker that rebuilds its runtime) and does
    // not subscribe the topic. Nothing in that worker visits it any more:
    // `reconcileSubscriptions` walks local subscriptions and
    // `reconcileAssignedTopics` walks the assignment map, and it has neither —
    // while B, which does subscribe, defers to a route whose owner is alive.
    const a2 = makeRuntime({ storage, hub, tabId: 'tab-a', workerId: 'worker-a' });
    const routeOfTopicA = () => {
      const entry = storage.entries().find(([key]) => key.includes(`:route:${createOpaqueKey('topic-a')}`));
      return entry ? (JSON.parse(entry[1]) as { workerId: string; confirmedAt?: number }) : null;
    };
    const holders = () => [a2, b].filter(worker => worker.runtime.getSnapshot().assignedTopics.includes('topic-a'));

    a2.runtime.start();
    // Synchronously, before any other task can run: the release pass is over and
    // its deletion is already on disk, so a peer reading storage now sees the
    // repaired state rather than the record still queued in this worker's writer.
    expect(routeOfTopicA()).toBeNull();
    await Promise.resolve();
    await Promise.resolve();

    // B's heartbeat has not run once, so the record below can only exist because
    // the release nudged it: B reconciled on the REGISTRY frame, found no owner,
    // and elected one.
    expect(routeOfTopicA()).not.toBeNull();
    a2.env.runIntervals();
    b.env.runIntervals();
    await Promise.resolve();
    a2.env.runIntervals();
    b.env.runIntervals();
    await Promise.resolve();

    // The phantom is broken and the ownership is real: exactly one live worker
    // holds the assignment, and the durable route names that worker and is
    // confirmed for it. Which one it is follows from the election (both records
    // report load 0, and an equal-load tie breaks on the worker id) — either
    // answer is correct, so the assertion names the holder rather than the id.
    const owners = holders();
    expect(owners).toHaveLength(1);
    expect(routeOfTopicA()?.workerId).toBe(owners[0] === a2 ? 'worker-a' : 'worker-b');
    expect(routeOfTopicA()?.confirmedAt).toBeDefined();
  });

  it('leaves a route naming this worker alone while it still holds the assignment', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const onControlA = vi.fn();
    const a = makeRuntime({ storage, hub, tabId: 'tab-a', workerId: 'worker-a', onControl: onControlA });
    const b = makeRuntime({ storage, hub, tabId: 'tab-b', workerId: 'worker-b' });
    a.runtime.start();
    await Promise.resolve();
    b.runtime.start();
    // Only B subscribes, and the election still lands on A: both records report
    // load 0, and an equal-load tie is broken by the worker id, where `worker-a`
    // sorts first. A therefore owns a topic it has no local handler for — the
    // documented exception, and the state a self-route sweep that stopped at
    // `subscribedTopics` would delete every pass.
    b.runtime.subscribe('topic-a');
    await Promise.resolve();
    expect(a.runtime.getSnapshot().assignedTopics).toEqual(['topic-a']);
    expect(a.runtime.getSnapshot().subscribedTopics).toEqual([]);

    for (let pass = 0; pass < 3; pass += 1) {
      a.env.runIntervals();
      b.env.runIntervals();
      await Promise.resolve();
    }

    // The assignment survives: this is the state a sweep that keyed on
    // `subscribedTopics` instead of the assignment map would delete every pass,
    // and the durable route is not rewritten, so no peer sees a re-election.
    expect(a.runtime.getSnapshot().assignedTopics).toEqual(['topic-a']);
    const route = JSON.parse(
      storage.entries().find(([key]) => key.includes(`:route:${createOpaqueKey('topic-a')}`))![1]!
    ) as { workerId: string; generation: number };
    expect(route).toMatchObject({ workerId: 'worker-a', generation: 1 });
  });

  it('prunes a crashed worker and its records after the TTL expires', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', workerTtlMs: 5_000 });
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b', workerTtlMs: 5_000 });
    a.runtime.start();
    b.runtime.start();
    a.env.runIntervals();
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().workers.map(w => w.workerId)).toEqual(['worker-a', 'worker-b']);

    // Worker A crashes: no pagehide, no stop — heartbeats just stop.
    now += 5_001;
    b.env.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    expect(b.runtime.getSnapshot().workers.map(w => w.workerId)).toEqual(['worker-b']);
  });

  it('removes subscriber records whose tab is no longer active', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', workerTtlMs: 5_000 });
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b', workerTtlMs: 5_000 });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();

    // Worker A crashes with a subscriber record on disk.
    const subscriberEntry = storage.entries().find(([key]) => key.includes(':subscriber:'));
    expect(subscriberEntry).toBeDefined();
    now += 5_001;
    b.env.runIntervals();
    await Promise.resolve();

    expect(storage.entries().some(([key]) => key.includes(':subscriber:'))).toBe(false);
  });

  it('prunes a dead-tab subscriber inside pause() without a prior reconcile', async () => {
    // readSubscriberTabIds carries its own orphan-prune branch even though
    // reconcile's cleanupOrphanedSubscribers normally runs first: pause()
    // never runs that cleanup, so a subscriber record whose tab has no
    // worker record must be ignored (and removed) right there — otherwise
    // the dead tab would count as a remaining subscriber and the route
    // would be handed off instead of deleted.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();

    // A ghost subscriber with no worker record anywhere in storage.
    const ownEntry = storage.entries().find(([key]) => key.includes(':subscriber:'))!;
    const ghostKey = ownEntry[0].replace(':tab-a', ':tab-ghost');
    storage.setItem(ghostKey, JSON.stringify({ tabId: 'tab-ghost', updatedAt: now }));
    await Promise.resolve();

    a.env.pageHide();
    await Promise.resolve();

    // Both the owner's own record and the ghost are gone, and with no live
    // subscribers left the route is deleted rather than handed off.
    expect(storage.entries().some(([key]) => key.includes(':subscriber:'))).toBe(false);
    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(false);
  });

  it('forwards an unknown CONTROL action through the generic dispatch without crashing', async () => {
    // A future-protocol CONTROL action must not break the receiver: the
    // switch falls through to the generic metadata + onControl dispatch.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const channelNames: string[] = [];
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    b.env.environment.createChannel = name => {
      channelNames.push(name);
      return hub.create(name);
    };
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    const topicKey = JSON.parse(storage.entries().find(([key]) => key.includes(':route:'))![1]).topicKey as string;

    expect(() =>
      hub.create(channelNames[0]!).postMessage({
        type: 'CONTROL',
        sourceWorkerId: 'worker-a',
        targetWorkerId: 'worker-b',
        // A future protocol version's action: not part of the local union,
        // exactly what the wire-compat path must tolerate.
        action: 'FUTURE-ACTION' as WorkerControlAction,
        topic: 'topic-a',
        topicKey
      })
    ).not.toThrow();
    expect(controlB).toHaveBeenCalledWith('FUTURE-ACTION', 'topic-a', undefined);
  });

  it('normalizes a non-string frame type to null in the unknown-message diagnostic', async () => {
    // `handleMessage` dispatches on `type` alone, and the cluster channel is a
    // BroadcastChannel any same-origin script can post into, so the value that
    // reaches the default arm is not constrained by this library. What it becomes
    // is: `getUnknownMessageStats().lastType`, published as
    // `getDiagnostics().protocol.lastUnknownMessageType` under a declared
    // `string | null`. Forwarding the raw value would put a number, or an object
    // with no `Object.prototype` behind it, into a field consumers report by name
    // — the failure class `0.21.4` had to fix in the error reporter, where
    // `String(Object.create(null))` throws while trying to describe a bad value.
    // The *string* arm already has a sibling: "ignores unknown protocol message
    // variants and reports them to the opt-in hook" above dispatches a future
    // protocol type and asserts the handler sees it. What had never executed is the
    // `null` side of the normalization, and no test at all read
    // `getUnknownMessageStats()`, so the string case is asserted again here on
    // purpose — the frame has to *report*, not only dispatch.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const unknown = vi.fn();
    const channelNames: string[] = [];
    const a = makeRuntime({
      storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', onUnknownMessage: unknown
    });
    a.env.environment.createChannel = name => {
      channelNames.push(name);
      return hub.create(name);
    };
    a.runtime.start();
    await Promise.resolve();
    const forged = hub.create(channelNames[0]!);
    // Every frame below is deliberately outside `WorkerClusterMessage` — that is the
    // whole scenario — so posting it needs a widening the channel's own signature
    // forbids. Keep it on the post rather than on a frame: `Object.create(null)` is
    // `any`, so the union would accept it silently and the cast's absence would be the
    // only thing distinguishing a forged frame from a legal one.
    const postForged = (forged.postMessage as (message: unknown) => void).bind(forged);
    expect(a.runtime.getUnknownMessageStats()).toEqual({ count: 0, lastType: null });

    // This frame leads on purpose. The mutant it exists to catch is a coercion at the
    // write or read site rather than a `typeof` check, and that mutant *throws* here
    // where it only mismatches a value on the others — measured, `String(unknown.type)`
    // in place of the `typeof` guard raises out of the post. Posted second or third it
    // is never reached, because the numeric assertion below fails first, so the order
    // decides whether the test can report a crash at all.
    postForged({ type: Object.create(null), sourceWorkerId: 'forged-peer' });
    expect(a.runtime.getUnknownMessageStats(), 'a prototype-less object has no String()').toEqual({
      count: 1, lastType: null
    });

    // The two shapes a real poster can deliver that a value check has to name: a
    // recognized-looking frame whose `type` is not a string, and a bare primitive,
    // which is truthy so it passes the null-frame guard and simply has no `type`.
    // The numeric one is what kills a raw forward on a *value* (`lastType: 42`); no
    // mutant was found that dies only to the bare primitive — every variant that
    // mishandles it mishandles the two frames above it too — so it is kept as the one
    // input carrying no `type` property at all, not as a separate claim.
    postForged({ type: 42, sourceWorkerId: 'forged-peer' });
    expect(a.runtime.getUnknownMessageStats(), 'a numeric type is not a string').toEqual({ count: 2, lastType: null });
    postForged('junk');
    expect(a.runtime.getUnknownMessageStats(), 'a posted primitive must not throw out of the listener').toEqual({
      count: 3, lastType: null
    });

    // And the arm that does have a value to report: an older or future SDK's frame
    // type, named exactly as it arrived.
    postForged({ type: 'FUTURE_MESSAGE', sourceWorkerId: 'forged-peer' });
    expect(a.runtime.getUnknownMessageStats(), 'a string type is reported verbatim').toEqual({
      count: 4, lastType: 'FUTURE_MESSAGE'
    });

    // Every one of them is still forwarded to the handler raw, the posted
    // primitive included: the counter is the only place the shape is judged, and an
    // application collecting the frames has to see what actually arrived.
    expect(unknown).toHaveBeenCalledTimes(4);
    expect(unknown.mock.calls.map(([message]) => message)).toEqual([
      { type: Object.create(null), sourceWorkerId: 'forged-peer' },
      { type: 42, sourceWorkerId: 'forged-peer' },
      'junk',
      { type: 'FUTURE_MESSAGE', sourceWorkerId: 'forged-peer' }
    ]);
  });

  it('drops a CONTROL frame addressed to another worker instead of acting on it', async () => {
    // `handleMessage` dispatches on `type` alone and the cluster channel is
    // broadcast, so every peer sees every CONTROL: the addressee check at the top
    // of `handleControlMessage` is the only thing that keeps a non-target from
    // acting on it. Nothing asserted that. Measured by deleting the guard: 369
    // tests across `cluster`/`stability`/`data-bus`/`centrifuge`/`worker-mode`
    // stayed green, while the three-tab fuzz churned 16+ minutes of CPU against a
    // ~1-minute baseline. The fuzz exercises the leg and cannot assert it — its
    // invariants are end-state checks, and a slower convergence still passes.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlA = vi.fn();
    const controlB = vi.fn();
    const a = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: controlA
    });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    a.runtime.start();
    b.runtime.start();
    await Promise.resolve();

    // Legitimate in every other respect: a known action, and a `topicKey` that is
    // genuinely `createOpaqueKey(topic)`, so the pairing guard passes too. Only the
    // addressee is wrong — nothing here names `worker-a`.
    const topic = 'topic-remote';
    const channel = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('resilience')}`);
    channel.postMessage({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: 'worker-c',
      targetWorkerId: 'worker-b',
      action: CONTROL_ACTION.SUBSCRIBE,
      topic,
      topicKey: createOpaqueKey(topic)
    } as WorkerClusterMessage);
    channel.close();
    await Promise.resolve();

    // The non-target reaches neither the dispatch nor the reverse cache. Both sit
    // downstream of the guard, and caching a plaintext this worker was never meant
    // to serve is the same substitution surface the pairing check bounds.
    expect(controlA).not.toHaveBeenCalled();
    expect(a.runtime.isAssigned(topic)).toBe(false);
    expect(a.runtime.getSnapshot().assignedTopics).not.toContain(topic);
    expect(a.runtime.getSnapshot().knownTopics.some(entry => entry.topic === topic)).toBe(false);
    // The addressee does act on it, which is what shows the frame was deliverable
    // and well-formed rather than rejected for some unrelated reason.
    expect(controlB).toHaveBeenCalledWith(CONTROL_ACTION.SUBSCRIBE, topic, undefined);
    expect(b.runtime.getSnapshot().assignedTopics).toContain(topic);
  });

  it('cleans up an orphaned route once no subscriber tab remains alive', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', workerTtlMs: 5_000 });
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(true);

    // Worker A crashes. A peer that comes online after the TTL reconciles the
    // registry: dead worker, dead subscriber, then the orphaned route go away.
    now += 5_001;
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b', workerTtlMs: 5_000 });
    b.runtime.start();
    await Promise.resolve();
    b.env.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(false);
    expect(storage.entries().some(([key]) => key.includes(':subscriber:'))).toBe(false);
    // Only the live peer's worker record remains.
    const workerRecords = storage.entries().filter(([key]) => key.includes(':worker:'));
    expect(workerRecords).toHaveLength(1);
    expect(JSON.parse(workerRecords[0]![1]).workerId).toBe('worker-b');
  });

  it('short-circuits a handoff UNSUBSCRIBE on the old owner and ACKs ROUTE_RELEASED', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlA = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', onControl: controlA });
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b' });
    const channelNames: string[] = [];
    a.env.environment.createChannel = name => {
      channelNames.push(name);
      return hub.create(name);
    };
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();
    const topicKey = JSON.parse(storage.entries().find(([key]) => key.includes(':route:'))![1]).topicKey as string;
    controlA.mockClear();

    // Simulate a graceful handoff record: the route now belongs to worker-b
    // and names worker-a as the previous owner that must release.
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({ ...route, workerId: 'worker-b', tabId: 'tab-b', generation: 2, handoffFromWorkerId: 'worker-a', updatedAt: now })
    );

    // The new owner asks the old owner to release via a point-to-point CONTROL.
    hub.create(channelNames[0]!).postMessage({
      type: 'CONTROL',
      sourceWorkerId: 'worker-b',
      targetWorkerId: 'worker-a',
      action: 'UNSUBSCRIBE',
      topic: 'topic-a',
      topicKey
    });

    // The old owner releases locally exactly once (no generic double dispatch)
    // and ACKs with ROUTE_RELEASED, which lets worker-b confirm ownership.
    expect(controlA).toHaveBeenCalledTimes(1);
    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic-a', undefined);
    await Promise.resolve();
    expect(b.runtime.isAssigned('topic-a')).toBe(true);
    expect(b.runtime.getSnapshot().routes[0]?.confirmedAt).toBe(now);
  });

  it('rejects a ROUTE_RELEASED whose generation is newer than the current handoff', async () => {
    // A ROUTE_RELEASED is an authorization for one exact route generation.
    // Accepting a future generation would let a delayed/replayed ACK from a
    // superseded handoff confirm a different route and release the new owner's
    // SUBSCRIBE before the matching release arrived.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    let bChannelName = '';
    b.env.environment.createChannel = name => {
      bChannelName = name;
      return hub.create(name);
    };

    a.runtime.start();
    a.runtime.subscribe('generation-guard');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();

    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    const topicKey = route.topicKey as string;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    hub.create(bChannelName).postMessage({
      type: 'ROUTE_RELEASED',
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-b',
      topic: 'generation-guard',
      topicKey,
      generation: 3
    });

    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('generation-guard');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'generation-guard', undefined);
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)).toMatchObject({ generation: 2 });
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)?.confirmedAt).toBeUndefined();
  });

  it('drops a ROUTE_RELEASED whose topicKey disagrees with its topic', async () => {
    // 0.21.5 put the key/topic pairing check in `handleControlMessage`, which is
    // the only place it looked at the time — but `handleRouteReleasedMessage`
    // reads both fields too, and this is the frame that *completes* a handoff.
    // A route record is plain localStorage, so a same-origin script can read the
    // real `topicKey`, the previous owner's id and the generation, and answer an
    // in-flight handoff with its own channel name: the durable route authorizes
    // the ACK, `assignedTopics` then stores the attacker's plaintext under the
    // real key, and `onControl(SUBSCRIBE)` subscribes the transport to it.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    let bChannelName = '';
    b.env.environment.createChannel = name => {
      bChannelName = name;
      return hub.create(name);
    };

    a.runtime.start();
    a.runtime.subscribe('release-guard');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();

    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    const topicKey = route.topicKey as string;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );
    expect(topicKey).toBe(createOpaqueKey('release-guard'));

    hub.create(bChannelName).postMessage({
      type: 'ROUTE_RELEASED',
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-b',
      topic: 'substituted-release',
      topicKey,
      generation: 2
    });

    expect(controlB).not.toHaveBeenCalled();
    expect(b.runtime.isAssigned('substituted-release')).toBe(false);
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('substituted-release');
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)?.confirmedAt).toBeUndefined();
  });

  it('drops a ROUTE_RELEASED addressed to another worker even when its route authorizes this one', async () => {
    // The sibling of `handleControlMessage`'s addressee guard, and the one that
    // is not dominated by anything below it. `isStaleRouteRelease` compares the
    // *durable route* against the frame, so it rejects a non-target that does
    // not own the topic — which is exactly why the forged-`topicKey` test above
    // could not stand in for this one: here the route genuinely names `worker-b`,
    // the release genuinely comes from the recorded previous owner, and the
    // generation matches, so every staleness term passes. Only the addressee
    // check keeps `worker-b` from completing an ACK meant for `worker-c`.
    // Measured: deleting that one line left 357 tests across
    // `cluster`/`stability`/`data-bus`/`centrifuge` green. `tests/coordination-invariants.test.ts`
    // cannot cover it either — its forgery vocabulary is `CONTROL/SUBSCRIBE`
    // (`forgeSubscribe()` is the only frame the harness forges), so no seed ever
    // sends a `ROUTE_RELEASED` to the wrong worker.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    let bChannelName = '';
    b.env.environment.createChannel = name => {
      bChannelName = name;
      return hub.create(name);
    };

    a.runtime.start();
    a.runtime.subscribe('misrouted-ack');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();

    // A pending handoff of `misrouted-ack` to worker-b: no `confirmedAt`, so the
    // ACK is still wanted, and `handoffFromWorkerId` names the sender.
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    const topicKey = route.topicKey as string;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    // Legitimate in every field the handler checks against storage — the
    // key/topic pair hashes, the generation and previous owner agree — and
    // addressed to a third worker. `worker-c` does not exist in this cluster,
    // which is what makes the drop observable here: whoever acts on it is acting
    // on a frame the protocol never sent their way.
    hub.create(bChannelName).postMessage({
      type: CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED,
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-c',
      topic: 'misrouted-ack',
      topicKey,
      generation: 2
    });
    await Promise.resolve();

    expect(controlB).not.toHaveBeenCalled();
    // `assignedTopics` (the in-memory map) rather than `isAssigned()`: the route
    // written above already names `worker-b`, and `isAssigned` falls through to
    // `readRoute(topicKey)?.workerId === this.workerId`, so it reads true here
    // whether or not the frame was acted on. The map is the state the handler
    // writes, so it is the one that can distinguish the two.
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('misrouted-ack');
    // No durable ownership either: `confirmRoute` stamps the route that authorizes
    // the next round, so writing it from a mis-addressed ACK would take shared
    // state with the frame, not just local state.
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)?.confirmedAt).toBeUndefined();
  });

  it('ignores a stale CONTROL/SUBSCRIBE while a handoff is awaiting ROUTE_RELEASED', async () => {
    // Regression: a delayed CONTROL/SUBSCRIBE from an earlier assignment round
    // must not authorize a pending handoff before its ROUTE_RELEASED ACK. The
    // strict handoff protocol keeps the old and new owners from overlapping;
    // accepting the stale control frame would subscribe the new owner early
    // and confirm the route without the old owner ever acknowledging release.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    let bChannelName = '';
    b.env.environment.createChannel = name => {
      bChannelName = name;
      return hub.create(name);
    };

    a.runtime.start();
    a.runtime.subscribe('stale-subscribe-guard');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();

    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    const topicKey = route.topicKey as string;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    // A stale SUBSCRIBE from a previous round reaches the pending new owner
    // before the matching ROUTE_RELEASED.
    hub.create(bChannelName).postMessage({
      type: 'CONTROL',
      sourceWorkerId: 'worker-stale',
      targetWorkerId: 'worker-b',
      action: 'SUBSCRIBE',
      topic: 'stale-subscribe-guard',
      topicKey
    });

    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('stale-subscribe-guard');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'stale-subscribe-guard', undefined);
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)?.confirmedAt).toBeUndefined();

    // Only the matching generation ACK may authorize the handoff.
    hub.create(bChannelName).postMessage({
      type: 'ROUTE_RELEASED',
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-b',
      topic: 'stale-subscribe-guard',
      topicKey,
      generation: 2
    });
    await Promise.resolve();

    expect(b.runtime.getSnapshot().assignedTopics).toContain('stale-subscribe-guard');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'stale-subscribe-guard', undefined);
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)).toMatchObject({
      generation: 2,
      confirmedAt: now
    });
  });

  it('ignores a CONTROL/SUBSCRIBE when the route now names another worker', async () => {
    // A delayed SUBSCRIBE from an earlier assignment round can arrive after a
    // newer round has moved the route elsewhere. The receiver must verify the
    // durable route before mutating its in-memory ownership, otherwise it
    // subscribes the transport without owning the route and overlaps the real
    // owner until the next reconcile drops the stale assignment.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    let bChannelName = '';
    b.env.environment.createChannel = name => {
      bChannelName = name;
      return hub.create(name);
    };

    a.runtime.start();
    a.runtime.subscribe('stale-route-owner');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();

    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    const topicKey = route.topicKey as string;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-c',
        tabId: 'tab-c',
        generation: 2,
        updatedAt: now
      })
    );

    hub.create(bChannelName).postMessage({
      type: 'CONTROL',
      sourceWorkerId: 'worker-stale',
      targetWorkerId: 'worker-b',
      action: 'SUBSCRIBE',
      topic: 'stale-route-owner',
      topicKey
    });

    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('stale-route-owner');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'stale-route-owner', undefined);
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)).toMatchObject({
      workerId: 'worker-c',
      generation: 2
    });
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)?.confirmedAt).toBeUndefined();

    // A later legitimate assignment back to worker-b is still authorized by
    // its own CONTROL/SUBSCRIBE once the route names worker-b again.
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 3,
        updatedAt: now
      })
    );
    hub.create(bChannelName).postMessage({
      type: 'CONTROL',
      sourceWorkerId: 'worker-c',
      targetWorkerId: 'worker-b',
      action: 'SUBSCRIBE',
      topic: 'stale-route-owner',
      topicKey
    });
    await Promise.resolve();

    expect(b.runtime.getSnapshot().assignedTopics).toContain('stale-route-owner');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'stale-route-owner', undefined);
    expect(b.runtime.getSnapshot().routes.find(entry => entry.topicKey === topicKey)).toMatchObject({
      workerId: 'worker-b',
      generation: 3,
      confirmedAt: now
    });
  });

  it('accepts a CONTROL/SUBSCRIBE that has no durable route to check, then sweeps it', async () => {
    // The guard reads `route && route.workerId !== this.workerId`, so a *missing*
    // route is a pass, not a drop. That is a tolerance rather than a hole:
    // `confirmRoute` returns without writing when there is no route
    // (`if (!route || route.workerId !== this.workerId …)`), so the frame cannot
    // mint durable ownership, and `reconcileAssignedTopics` drops any assignment
    // whose route does not name this worker — including no route at all — so the
    // grant lasts at most one reconcile tick. What it buys is that coordination
    // still works when a route cannot be read: expired, corrupted, or a storage
    // that is not there. `docs/architecture.md` and the capabilities matrix claimed
    // the stricter rule ("accepted only when the durable route names the receiver"),
    // which is not what ships; both now state this.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const onControl = vi.fn();
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b', onControl });
    let bChannelName = '';
    b.env.environment.createChannel = name => {
      bChannelName = name;
      return hub.create(name);
    };
    b.runtime.start();
    await Promise.resolve();

    hub.create(bChannelName).postMessage({
      type: 'CONTROL',
      sourceWorkerId: 'worker-a',
      targetWorkerId: 'worker-b',
      action: 'SUBSCRIBE',
      topic: 'routeless-topic',
      topicKey: createOpaqueKey('routeless-topic')
    });
    await Promise.resolve();

    expect(b.runtime.getSnapshot().assignedTopics).toContain('routeless-topic');
    expect(onControl).toHaveBeenCalledWith('SUBSCRIBE', 'routeless-topic', undefined);
    expect(storage.entries().some(([key]) => key.includes(':route:'))).toBe(false);

    b.env.runIntervals();
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('routeless-topic');
    expect(onControl).toHaveBeenCalledWith('UNSUBSCRIBE', 'routeless-topic', undefined);
  });

  it('recovers a stranded unconfirmed handoff once the previous owner is dead', async () => {
    // Regression: if the previous owner's ROUTE_RELEASED never arrives
    // (dropped channel message under load, or a crash between the route
    // write and the ACK), the route sat unconfirmed forever — the new owner
    // kept waiting for the ACK while peers treated the live new owner as
    // authoritative and stayed out. Reconcile must re-elect a live owner
    // once the previous owner is gone AND the handoff has been stuck longer
    // than a worker TTL (the age gate keeps a fresh handoff — whose
    // confirmation may simply not have flushed yet — from being mistaken
    // for a stranded one).
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const controlB = vi.fn();
    const diagnosticsB: Array<{ operation: string; topic: string }> = [];
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB,
      onDiagnostic: event => diagnosticsB.push(event)
    });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-handoff-recovery');
    await Promise.resolve();
    b.runtime.subscribe('topic-handoff-recovery');
    await Promise.resolve();
    expect(a.runtime.isAssigned('topic-handoff-recovery')).toBe(true);

    // Strand the handoff mid-flight: the route names worker-b with worker-a
    // as the previous owner, but the ACK is never delivered. The original
    // route was confirmed by worker-a, so confirmedAt must be stripped —
    // otherwise the crafted record is not actually unconfirmed.
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    // The original route was confirmed by worker-a; drop the stamp so the
    // crafted record is genuinely unconfirmed.
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    // Kill the previous owner. Its pause() sees the route no longer points
    // at itself, so it sends no ACK — exactly the stranded state. The
    // immediate reconcile (driven by the REGISTRY nudge) must NOT recover
    // yet: the handoff is brand new and the ACK could still be in flight.
    // (Assertions use the snapshot's in-memory assignment list — the same
    // signal the e2e owner poll reads — because isAssigned() also returns
    // true for a storage route that merely points at this worker.)
    a.runtime.stop();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('topic-handoff-recovery');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-recovery', undefined);

    // Past the worker TTL with no confirmation, the next reconcile re-elects.
    now += 10_001;
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-recovery');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-recovery', undefined);
    const recovered = b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b');
    expect(recovered).toMatchObject({ generation: 3, confirmedAt: now });
    expect(recovered).not.toHaveProperty('handoffFromWorkerId');
    // The recovery is observable as its own diagnostic operation, distinct
    // from a routine graceful migration.
    expect(diagnosticsB).toContainEqual({ operation: 'route_migration_recovery', topic: 'topic-handoff-recovery' });
    expect(diagnosticsB).not.toContainEqual({ operation: 'route_migration', topic: 'topic-handoff-recovery' });

    // A further reconcile round stays converged on the single owner.
    controlB.mockClear();
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-recovery');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-recovery', undefined);
  });

  it('recovers a real pagehide handoff whose ROUTE_RELEASED is lost on the wire', async () => {
    // End-to-end version of the stranded-handoff regression: a genuine
    // pageHide() writes the handoff route, but the ACK itself is dropped in
    // transit (the CI soak failure mode) — no hand-crafted storage. The new
    // owner must still converge once the handoff goes stale.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-handoff-wire-loss');
    await Promise.resolve();
    b.runtime.subscribe('topic-handoff-wire-loss');
    await Promise.resolve();
    expect(a.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-wire-loss');

    // Drop exactly one ROUTE_RELEASED: the handoff route lands, the ACK does not.
    const originalSend = hub.send.bind(hub);
    let ackDropped = false;
    hub.send = (source: { name: string }, message: WorkerClusterMessage) => {
      if (!ackDropped && message.type === CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED) {
        ackDropped = true;
        return;
      }
      originalSend(source as never, message);
    };
    a.env.pageHide();
    await Promise.resolve();
    expect(ackDropped).toBe(true);

    // The route really did move to worker-b, unconfirmed, with the handoff
    // marker — written by the actual handoff code, not the test.
    const stranded = b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b');
    expect(stranded).toMatchObject({ handoffFromWorkerId: 'worker-a' });
    expect(stranded?.confirmedAt).toBeUndefined();
    // Fresh handoff: the new owner waits, no premature recovery.
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('topic-handoff-wire-loss');

    now += 10_001;
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-wire-loss');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-wire-loss', undefined);
    expect(
      b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b')?.confirmedAt
    ).toBe(now);
  });

  it('converges repeated pagehides with every handoff ACK lost', async () => {
    // Soak over the stranded-handoff recovery: three consecutive owners each
    // go through pageHide() with the ACK dropped, and every round must still
    // converge on exactly one confirmed holder with no handoff marker left
    // behind and a monotonically increasing generation (no reset/duplication
    // across recovery cycles).
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const topic = 'topic-handoff-soak';
    const tabs = (['a', 'b', 'c'] as const).map(id =>
      makeRuntime({ storage, hub, now: () => now, tabId: `tab-${id}`, workerId: `worker-${id}` })
    );
    for (const tab of tabs) tab.runtime.start();
    for (const tab of tabs) {
      tab.runtime.subscribe(topic);
      await Promise.resolve();
    }
    const holders = () => tabs.filter(tab => tab.runtime.getSnapshot().assignedTopics.includes(topic));
    expect(holders()).toHaveLength(1);

    const originalSend = hub.send.bind(hub);
    let lastGeneration = 1;
    // Advance time in 1 s steps with a heartbeat round and a microtask flush
    // per step: heartbeats must keep propagating (as they do in a real
    // browser every 3 s) so live peers never look TTL-dead to each other. A
    // single +11 s jump would strand every peer's heartbeat write in its own
    // writer's pending queue while the others reconcile — an artifact of the
    // shared fake clock, not of the recovery logic.
    const stepTime = async (ms: number) => {
      const steps = Math.ceil(ms / 1000);
      for (let step = 0; step < steps; step += 1) {
        now += 1000;
        for (const tab of tabs) tab.env.runIntervals();
        await Promise.resolve();
      }
    };
    for (let round = 0; round < 3; round += 1) {
      const owners = holders();
      expect(owners).toHaveLength(1);
      // Drop this round's ACK; the handoff route still lands.
      let ackDropped = false;
      hub.send = (source: { name: string }, message: WorkerClusterMessage) => {
        if (!ackDropped && message.type === CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED) {
          ackDropped = true;
          return;
        }
        originalSend(source as never, message);
      };
      const suspended = owners[0]!;
      suspended.env.pageHide();
      await Promise.resolve();
      expect(ackDropped).toBe(true);

      await stepTime(11_000);
      // One settle round: if two survivors re-elected on the same stale view
      // (last-writer-wins, mirroring the pre-existing crash-recovery race),
      // the holder's next reconcile completes confirmation through the normal
      // unconfirmed-route retry path.
      for (const tab of tabs) tab.env.runIntervals();
      await Promise.resolve();
      const converged = holders();
      expect(converged).toHaveLength(1);
      const route = converged[0]!.runtime
        .getSnapshot()
        .routes.find(entry => entry.topic === topic);
      expect(route?.confirmedAt).toBeDefined();
      expect(route).not.toHaveProperty('handoffFromWorkerId');
      expect(route!.generation).toBeGreaterThan(lastGeneration);
      lastGeneration = route!.generation;

      // The suspended owner rejoins as a subscriber (mirroring the e2e
      // pageshow step): the sticky route must stay with the survivor — the
      // returning tab reuses the replacement owner instead of taking back.
      suspended.env.pageShow();
      await Promise.resolve();
      const afterRejoin = holders();
      expect(afterRejoin).toHaveLength(1);
      expect(afterRejoin[0]).toBe(converged[0]);
    }
  });

  it('distributes stranded multi-topic recovery across survivors', async () => {
    // Two topics strand on the same dead owner. Recovery must spread them
    // across the survivors (projected loads within the pass, mirroring the
    // graceful handoff, plus the single-writer rule) instead of piling both
    // onto one worker — routes are sticky, so a pile-up would persist.
    // Time advances in heartbeat-sized steps so peer heartbeats keep
    // propagating: a single jump would strand every heartbeat write in its
    // own writer's pending queue, making live peers look TTL-dead to a
    // nested reconcile (see the soak test's fake-clock discipline note).
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const diagnosticsB: Array<{ operation: string; topic: string }> = [];
    const diagnosticsC: Array<{ operation: string; topic: string }> = [];
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onDiagnostic: event => diagnosticsB.push(event)
    });
    const c = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-c',
      workerId: 'worker-c',
      onDiagnostic: event => diagnosticsC.push(event)
    });
    // A subscribes first while it is the only worker record: least-loaded
    // election (all loads zero, tie broken by workerId) gives it both topics.
    a.runtime.start();
    a.runtime.subscribe('topic-dist-1');
    await Promise.resolve();
    a.runtime.subscribe('topic-dist-2');
    await Promise.resolve();
    // B and C join afterwards as standbys on the live routes.
    b.runtime.start();
    c.runtime.start();
    for (const topic of ['topic-dist-1', 'topic-dist-2']) {
      b.runtime.subscribe(topic);
      await Promise.resolve();
      c.runtime.subscribe(topic);
      await Promise.resolve();
    }
    expect(a.runtime.getSnapshot().assignedTopics).toEqual(
      expect.arrayContaining(['topic-dist-1', 'topic-dist-2'])
    );

    // Strand both handoffs toward worker-b with no ACK ever sent.
    for (const entry of storage.entries()) {
      if (!entry[0].includes(':route:')) continue;
      const route = JSON.parse(entry[1]) as Record<string, unknown>;
      delete route.confirmedAt;
      storage.setItem(
        entry[0],
        JSON.stringify({
          ...route,
          workerId: 'worker-b',
          tabId: 'tab-b',
          generation: 2,
          handoffFromWorkerId: 'worker-a',
          updatedAt: now
        })
      );
    }
    a.runtime.stop();
    await Promise.resolve();

    for (let step = 0; step < 11; step += 1) {
      now += 1000;
      b.env.runIntervals();
      c.env.runIntervals();
      await Promise.resolve();
    }
    // One settle round so the last writer's confirmation flushes through.
    b.env.runIntervals();
    c.env.runIntervals();
    await Promise.resolve();

    // Spread, not piled: one topic per survivor, both confirmed, markers out.
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-dist-1');
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('topic-dist-2');
    expect(c.runtime.getSnapshot().assignedTopics).toContain('topic-dist-2');
    expect(c.runtime.getSnapshot().assignedTopics).not.toContain('topic-dist-1');
    for (const [holder, topic] of [
      [b, 'topic-dist-1'],
      [c, 'topic-dist-2']
    ] as const) {
      const route = holder.runtime.getSnapshot().routes.find(entry => entry.topic === topic);
      expect(route).toMatchObject({ generation: 3 });
      expect(route?.confirmedAt).toBeDefined();
      expect(route).not.toHaveProperty('handoffFromWorkerId');
    }
    // Each survivor performed exactly its own share of the recovery.
    expect(diagnosticsB).toContainEqual({ operation: 'route_migration_recovery', topic: 'topic-dist-1' });
    expect(diagnosticsB).not.toContainEqual({ operation: 'route_migration_recovery', topic: 'topic-dist-2' });
    expect(diagnosticsC).toContainEqual({ operation: 'route_migration_recovery', topic: 'topic-dist-2' });
    expect(diagnosticsC).not.toContainEqual({ operation: 'route_migration_recovery', topic: 'topic-dist-1' });
  });

  it('recovers to an unsubscribed elected owner instead of standing down forever', async () => {
    // Single-writer liveness hole: when the elected owner has no local
    // subscription it will never reconcile the topic, so standing down
    // would stall forever. The recovering peer must write the route and
    // notify it directly (assigning without a local subscription is what
    // the graceful handoff and the crash path already do).
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const diagnosticsB: Array<{ operation: string; topic: string }> = [];
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onDiagnostic: event => diagnosticsB.push(event)
    });
    // B owns an unrelated topic first so the later election prefers the
    // zero-load, never-subscribed C for the stranded one.
    b.runtime.start();
    b.runtime.subscribe('topic-other');
    await Promise.resolve();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const c = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-c', workerId: 'worker-c' });
    a.runtime.start();
    a.runtime.subscribe('topic-lonely');
    await Promise.resolve();
    b.runtime.subscribe('topic-lonely');
    await Promise.resolve();
    c.runtime.start();
    await Promise.resolve();
    expect(a.runtime.getSnapshot().assignedTopics).toContain('topic-lonely');
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-other');

    // Strand the lonely topic's handoff toward worker-b with no ACK ever.
    // (Identified by owner: it is the only route pointing at worker-a.)
    const routeEntry = storage
      .entries()
      .find(([key, value]) => key.includes(':route:') && (JSON.parse(value) as { workerId: string }).workerId === 'worker-a')!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );
    a.runtime.stop();
    await Promise.resolve();

    // Heartbeat-sized steps so peer heartbeats keep propagating.
    for (let step = 0; step < 11; step += 1) {
      now += 1000;
      b.env.runIntervals();
      c.env.runIntervals();
      await Promise.resolve();
    }
    b.env.runIntervals();
    c.env.runIntervals();
    await Promise.resolve();

    // C was elected (zero load) despite never subscribing: B wrote the
    // route and notified it instead of standing down, so C holds the
    // topic with a confirmed, marker-free route.
    expect(c.runtime.getSnapshot().assignedTopics).toContain('topic-lonely');
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('topic-lonely');
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-other');
    const recovered = c.runtime.getSnapshot().routes.find(entry => entry.topic === 'topic-lonely');
    expect(recovered).toMatchObject({ workerId: 'worker-c', generation: 3 });
    expect(recovered?.confirmedAt).toBeDefined();
    expect(recovered).not.toHaveProperty('handoffFromWorkerId');
    expect(diagnosticsB).toContainEqual({ operation: 'route_migration_recovery', topic: 'topic-lonely' });
  });

  it('has the old owner release and re-ACK when it still holds a handed-off assignment', async () => {
    // Covers reconcileAssignedTopics' cooperative path: an old owner that
    // still lists the topic as assigned while the route already names a new
    // owner with itself as handoff source drops the assignment and re-sends
    // ROUTE_RELEASED, letting the new owner confirm.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlA = vi.fn();
    const controlB = vi.fn();
    const a = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-a',
      workerId: 'worker-a',
      onControl: controlA
    });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-handoff-coop');
    await Promise.resolve();
    b.runtime.subscribe('topic-handoff-coop');
    await Promise.resolve();
    expect(a.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-coop');

    // A handoff record naming worker-b is visible, but worker-a never
    // processed the release (e.g. it missed its own pause): it still holds
    // the in-memory assignment while the route already moved on.
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    a.env.runIntervals();
    await Promise.resolve();
    // The old owner drops its stale assignment and the re-sent ACK lets the
    // new owner confirm: exactly one holder, confirmed route, no re-election
    // churn (generation stays 2 — no new write happened).
    expect(a.runtime.getSnapshot().assignedTopics).not.toContain('topic-handoff-coop');
    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic-handoff-coop', undefined);
    expect(b.runtime.getSnapshot().assignedTopics).toContain('topic-handoff-coop');
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-coop', undefined);
    expect(b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b')).toMatchObject({
      generation: 2,
      confirmedAt: now
    });
  });

  it('keeps waiting for ROUTE_RELEASED while the previous owner is still alive', async () => {
    // The recovery above must not fire while the previous owner is live:
    // retrying SUBSCRIBE then would recreate the overlap the strict handoff
    // exists to prevent.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlB = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a' });
    const b = makeRuntime({
      storage,
      hub,
      now: () => now,
      tabId: 'tab-b',
      workerId: 'worker-b',
      onControl: controlB
    });
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('topic-handoff-wait');
    await Promise.resolve();
    b.runtime.subscribe('topic-handoff-wait');
    await Promise.resolve();

    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    delete route.confirmedAt;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        ...route,
        workerId: 'worker-b',
        tabId: 'tab-b',
        generation: 2,
        handoffFromWorkerId: 'worker-a',
        updatedAt: now
      })
    );

    // Previous owner alive: reconcile must not re-elect and must not
    // re-send SUBSCRIBE for the unconfirmed route.
    b.env.runIntervals();
    await Promise.resolve();
    expect(b.runtime.getSnapshot().assignedTopics).not.toContain('topic-handoff-wait');
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'topic-handoff-wait', undefined);
    const waiting = b.runtime.getSnapshot().routes.find(entry => entry.workerId === 'worker-b');
    expect(waiting).toMatchObject({ generation: 2, handoffFromWorkerId: 'worker-a' });
    expect(waiting?.confirmedAt).toBeUndefined();
  });

  it('drops a locally assigned topic when the route no longer points at this worker', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = 1_000;
    const controlA = vi.fn();
    const a = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-a', workerId: 'worker-a', onControl: controlA });
    const b = makeRuntime({ storage, hub, now: () => now, tabId: 'tab-b', workerId: 'worker-b' });
    a.runtime.start();
    a.runtime.subscribe('topic-a');
    await Promise.resolve();
    b.runtime.start();
    await Promise.resolve();
    expect(a.runtime.isAssigned('topic-a')).toBe(true);

    // Simulate the route being taken over by another live worker in this
    // tab's absence (e.g. a peer that won the race after a pause). The record is
    // left unconfirmed on purpose: a *confirmed* route naming worker-b while
    // worker-b holds no assignment is a phantom, and
    // `reconcileStrandedSelfRoutes()` releases it, which would have this same
    // assertion pass by a different route — and hide the sweep it names.
    const routeEntry = storage.entries().find(([key]) => key.includes(':route:'))!;
    const route = JSON.parse(routeEntry[1]) as Record<string, unknown>;
    storage.setItem(
      routeEntry[0],
      JSON.stringify({
        topicKey: route.topicKey,
        workerId: 'worker-b',
        tabId: 'tab-b',
        updatedAt: now,
        generation: (route.generation as number) + 1
      })
    );

    a.env.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    // A releases its local subscription and stops claiming the topic.
    expect(controlA).toHaveBeenCalledWith('UNSUBSCRIBE', 'topic-a', undefined);
    expect(a.runtime.isAssigned('topic-a')).toBe(false);
  });
});

describe('WorkerClusterRuntime adaptive load weighting', () => {
  const loadWeighting = { messageRateWeight: 1 };

  function workerRecordOf(storage: MemoryStorage, workerId: string): WorkerRecord {
    const entry = storage.entries().find(([key]) => key.includes(`:worker:${workerId}`));
    expect(entry).toBeDefined();
    return JSON.parse(entry![1]) as WorkerRecord;
  }

  it('leaves the worker record byte-identical to legacy when weighting is unset', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'legacy' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'weighting-legacy',
      environment: env.environment,
      tabId: 'tab-legacy',
      workerId: 'worker-legacy',
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    runtime.broadcastEvent('evt', { n: 1 });
    now += 3_000;
    env.runIntervals();
    await Promise.resolve();

    expect(workerRecordOf(storage, 'worker-legacy').throughput).toBeUndefined();
    runtime.stop();
  });

  it('publishes a rolling traffic sample when weighting is configured', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'sampled' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'weighting-sampled',
      environment: env.environment,
      tabId: 'tab-sampled',
      workerId: 'worker-sampled',
      loadWeighting,
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    const payload = { kind: 'flow', seq: 7 };
    runtime.broadcastEvent('evt', payload);
    now += 3_000;
    env.runIntervals();
    await Promise.resolve();

    const record = workerRecordOf(storage, 'worker-sampled');
    expect(record.throughput).toEqual({
      windowMs: 3_000,
      messageCount: 1,
      byteCount: approximatePayloadBytes(payload),
      overrunMs: 0,
      sampledAt: now
    });
    runtime.stop();
  });

  it('reports positive scheduling overrun when the heartbeat lands late', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'overrun' });
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'weighting-overrun',
      environment: env.environment,
      tabId: 'tab-overrun',
      workerId: 'worker-overrun',
      heartbeatIntervalMs: 3_000,
      loadWeighting,
      handlers: { onControl: vi.fn(), onEvent: vi.fn() }
    });
    runtime.start();
    // A starved event loop delays the heartbeat far past its nominal interval.
    now += 9_000;
    env.runIntervals();
    await Promise.resolve();

    expect(workerRecordOf(storage, 'worker-overrun').throughput).toMatchObject({
      windowMs: 9_000,
      overrunMs: 6_000
    });
    runtime.stop();
  });

  it('steers a new route to a quieter worker despite a higher topic count', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'weighting-steer',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      loadWeighting,
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'weighting-steer',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      loadWeighting,
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });

    runtimeA.start();
    runtimeA.subscribe('topic-1');
    runtimeA.subscribe('topic-2');
    await Promise.resolve();
    runtimeB.start();
    runtimeB.subscribe('topic-3');
    await Promise.resolve();

    // A owns two topics, B owns one — but B handles a heavy fan-out burst.
    expect(runtimeA.isAssigned('topic-1')).toBe(true);
    expect(runtimeA.isAssigned('topic-2')).toBe(true);
    expect(runtimeB.isAssigned('topic-3')).toBe(true);
    for (let index = 0; index < 50; index += 1) runtimeB.broadcastEvent('evt', { n: index });
    now += 3_000;
    envA.runIntervals();
    envB.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    // The quieter worker wins the new route despite carrying more topics.
    runtimeA.subscribe('steer-topic');
    await Promise.resolve();
    expect(runtimeA.isAssigned('steer-topic')).toBe(true);
    expect(runtimeB.isAssigned('steer-topic')).toBe(false);
    expect(controlA).toHaveBeenCalledWith('SUBSCRIBE', 'steer-topic', undefined);
    expect(controlB).not.toHaveBeenCalledWith('SUBSCRIBE', 'steer-topic', undefined);

    runtimeA.stop();
    runtimeB.stop();
  });

  it('steers a new route away from a scheduling-lagging worker despite fewer topics', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const scheduleLagOptions = { scheduleLagWeight: 3 };
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'weighting-lag-steer',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      loadWeighting: scheduleLagOptions,
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'weighting-lag-steer',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      loadWeighting: scheduleLagOptions,
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });

    // B owns two topics, A owns one — legacy would place a new route on A.
    runtimeB.start();
    runtimeB.subscribe('topic-2');
    runtimeB.subscribe('topic-3');
    await Promise.resolve();
    runtimeA.start();
    runtimeA.subscribe('topic-1');
    await Promise.resolve();
    expect(runtimeB.isAssigned('topic-2')).toBe(true);
    expect(runtimeB.isAssigned('topic-3')).toBe(true);
    expect(runtimeA.isAssigned('topic-1')).toBe(true);

    // One healthy heartbeat: both records carry a lag-free sample.
    now += 3_000;
    envA.runIntervals();
    envB.runIntervals();
    await Promise.resolve();

    // Starve A only: its next heartbeat lands far past the interval, so its
    // record publishes a sample with positive scheduling overrun.
    now += 9_000;
    envA.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    // A's effective load (1 topic + 3 × 0.667 lag) now exceeds B's (2 topics
    // + 3 × 0), so the route with fewer topics still lands on the healthier B.
    runtimeA.subscribe('steer-lag');
    await Promise.resolve();
    await Promise.resolve();
    expect(runtimeB.isAssigned('steer-lag')).toBe(true);
    expect(runtimeA.isAssigned('steer-lag')).toBe(false);
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'steer-lag', undefined);
    expect(controlA).not.toHaveBeenCalledWith('SUBSCRIBE', 'steer-lag', undefined);

    runtimeA.stop();
    runtimeB.stop();
  });

  it('falls back to the legacy fewest-topics rule when weighting is unset', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const controlA = vi.fn();
    const controlB = vi.fn();
    const runtimeA = new WorkerClusterRuntime({
      clusterKey: 'weighting-legacy-steer',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      handlers: { onControl: controlA, onEvent: vi.fn() }
    });
    const runtimeB = new WorkerClusterRuntime({
      clusterKey: 'weighting-legacy-steer',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      handlers: { onControl: controlB, onEvent: vi.fn() }
    });

    runtimeA.start();
    runtimeA.subscribe('topic-1');
    runtimeA.subscribe('topic-2');
    await Promise.resolve();
    runtimeB.start();
    runtimeB.subscribe('topic-3');
    await Promise.resolve();

    // Identical traffic, no weighting → the fewest-topics worker (B) wins.
    for (let index = 0; index < 50; index += 1) runtimeB.broadcastEvent('evt', { n: index });
    now += 3_000;
    envA.runIntervals();
    envB.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    runtimeA.subscribe('legacy-steer-topic');
    await Promise.resolve();
    expect(runtimeB.isAssigned('legacy-steer-topic')).toBe(true);
    expect(controlB).toHaveBeenCalledWith('SUBSCRIBE', 'legacy-steer-topic', undefined);

    runtimeA.stop();
    runtimeB.stop();
  });
});

describe('WorkerClusterRuntime publish routing cache and lifecycle guards', () => {
  function makeRuntime(id: string, storage = new MemoryStorage(), hub = new ChannelHub()) {
    let now = 1_000;
    const env = createFakeEnvironment({ storage, hub, now: () => now, randomId: id });
    const onControl = vi.fn();
    const runtime = new WorkerClusterRuntime({
      clusterKey: 'publish-cache',
      environment: env.environment,
      tabId: `tab-${id}`,
      workerId: `worker-${id}`,
      handlers: { onControl, onEvent: vi.fn() }
    });
    return { runtime, onControl, env, storage, hub, advance: (ms: number) => { now += ms; } };
  }

  it('delivers both publishes to a wildcard-covered topic', async () => {
    const { runtime, onControl } = makeRuntime('wild');
    runtime.start();
    runtime.subscribe('chat.*');
    await Promise.resolve();
    expect(runtime.isAssigned('chat.room.1')).toBe(true);

    // A count of two, which is what this asserts and no more: the removed memo
    // produced the same two deliveries here, because a single runtime always wins
    // its own election. What separated the old first call from the later ones was
    // *which* target each addressed, and that is what the two FIRST-publish cases
    // below pin — with a second runtime holding the concrete route.
    runtime.publish('chat.room.1', { n: 1 });
    runtime.publish('chat.room.1', { n: 2 });
    const publishes = onControl.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'chat.room.1');
    expect(publishes).toHaveLength(2);
    runtime.stop();
  });

  it('forwards a publish whose topic matches no local wildcard to the remote owner', async () => {
    // The 0.20.58 regression, kept for its behaviour rather than its mechanism:
    // back then a `null` memo entry short-circuited the route lookup, so a topic
    // owned by another worker was dispatched locally. The whole memo is gone now,
    // so the condition it could not be trusted with no longer exists to test —
    // which is exactly why this case stays: it is the behaviour the memo was
    // supposed to make cheap, and it must survive without it.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const a = makeRuntime('remote-a', storage, hub);
    const b = makeRuntime('remote-b', storage, hub);
    a.runtime.start();
    b.runtime.start();

    // A holds a wildcard subscription that does NOT match this topic, so it is the
    // sender with a live `assignedTopics` scan and no claim on the route.
    a.runtime.subscribe('chat.*');
    // B owns 'metrics.cpu' outright.
    b.runtime.subscribe('metrics.cpu');
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      a.env.runIntervals();
      b.env.runIntervals();
    }
    expect(b.runtime.isAssigned('metrics.cpu')).toBe(true);
    expect(a.runtime.isAssigned('metrics.cpu')).toBe(false);

    // A publishes twice: the first call writes the null cache entry, the second
    // reads it back. Both must be forwarded to B, never handled by A.
    a.runtime.publish('metrics.cpu', { n: 1 });
    a.runtime.publish('metrics.cpu', { n: 2 });
    await Promise.resolve();

    const ownerDeliveries = b.onControl.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'metrics.cpu');
    expect(ownerDeliveries).toHaveLength(2);
    expect(a.onControl.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'metrics.cpu')).toHaveLength(0);

    a.runtime.stop();
    b.runtime.stop();
  });

  it('forwards a topic\'s FIRST publish to its concrete remote owner, not to a matching local wildcard', async () => {
    // The mirror of the case above, and the reason the per-topic wildcard memo is
    // gone. The replaced code scanned `assignedTopics` only when a topic had no
    // memo entry yet and, on a pattern match, dispatched locally without ever
    // consulting the durable route; every later publish for that topic did consult
    // it. So a wildcard holder lost exactly one publication per topic to itself.
    // Measured before the fix, with this setup: publish 1 -> atA=1 atB=0; publish 2
    // -> atA=1 atB=1; publish 3 -> atA=1 atB=2. Delivery is at-most-once, so the
    // first is gone for good — this is not a latency assertion.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const a = makeRuntime('first-wild-a', storage, hub);
    const b = makeRuntime('first-wild-b', storage, hub);
    a.runtime.start();
    b.runtime.start();

    a.runtime.subscribe('chat.*');       // A owns the pattern...
    b.runtime.subscribe('chat.room.1');  // ...B owns this concrete topic outright
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      a.env.runIntervals();
      b.env.runIntervals();
    }
    // Both report the topic as assigned, which is the whole difficulty: the
    // wildcard legitimately covers it and the concrete owner legitimately owns it.
    expect(a.runtime.isAssigned('chat.room.1')).toBe(true);
    expect(b.runtime.isAssigned('chat.room.1')).toBe(true);

    const tally = (mock: ReturnType<typeof vi.fn>) =>
      mock.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'chat.room.1').length;

    // Asserted one publication at a time so a regression names which one was lost
    // rather than reporting a count that is short by one.
    a.runtime.publish('chat.room.1', { n: 1 });
    await Promise.resolve();
    expect(tally(b.onControl), 'first publish must reach the concrete owner').toBe(1);
    expect(tally(a.onControl), 'first publish must not be handled by the sender').toBe(0);

    a.runtime.publish('chat.room.1', { n: 2 });
    await Promise.resolve();
    expect(tally(b.onControl), 'second publish must reach the concrete owner').toBe(2);
    expect(tally(a.onControl)).toBe(0);

    a.runtime.stop();
    b.runtime.stop();
  });

  it('forwards a batch\'s FIRST publish to the concrete remote owner as well', async () => {
    // `publishBatch()` carried a textually identical copy of the memo block, so the
    // same loss applied to it — with the extra trap that a one-item batch delegates
    // to `publish()` and so never reached that code at all. Two items, first call.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const a = makeRuntime('first-batch-a', storage, hub);
    const b = makeRuntime('first-batch-b', storage, hub);
    a.runtime.start();
    b.runtime.start();

    a.runtime.subscribe('chat.*');
    b.runtime.subscribe('chat.room.2');
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      a.env.runIntervals();
      b.env.runIntervals();
    }

    const items = [{ data: 1 }, { data: 2 }];
    const batchesTo = (mock: ReturnType<typeof vi.fn>) =>
      mock.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'chat.room.2').length;

    expect(a.runtime.publishBatch('chat.room.2', items)).toBe(true);
    await Promise.resolve();
    const received = b.onControl.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'chat.room.2');
    // A received batch is presented to the handler one call per item (the frame
    // carries `items`; the cluster unpacks it), so two items means two calls.
    expect(received.map(call => call[2]), 'the first batch must be delivered to the concrete owner')
      .toEqual([1, 2]);
    expect(batchesTo(a.onControl), 'the first batch must not be handled by the sender').toBe(0);

    a.runtime.stop();
    b.runtime.stop();
  });

  it('delivers both publishes of a repeat batch on a wildcard-covered topic', async () => {
    const { runtime, onControl } = makeRuntime('batch');
    runtime.start();
    runtime.subscribe('feed.*');
    await Promise.resolve();

    const items = [{ data: 1 }, { data: 2 }, { data: 3 }];
    expect(runtime.publishBatch('feed.eu', items)).toBe(true);
    // A one-item batch delegates to `publish()`; two items reach this path.
    expect(runtime.publishBatch('feed.eu', items)).toBe(true);
    const delivered = onControl.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'feed.eu');
    expect(delivered).toHaveLength(6);
    runtime.stop();
  });

  it('does not let an unrelated owned pattern capture a batch for a remote topic', async () => {
    // publishBatch's wildcard probe walks every pattern this worker owns. A's
    // `chat.*` says nothing about `metrics.cpu`, which B owns outright, so A must
    // forward the batch. Drop the matcher and the first owned pattern wins: the
    // batch is captured into a local dispatch and stops reaching its owner.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const a = makeRuntime('capture-a', storage, hub);
    const b = makeRuntime('capture-b', storage, hub);
    a.runtime.start();
    b.runtime.start();
    a.runtime.subscribe('chat.*');
    b.runtime.subscribe('metrics.cpu');
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      a.env.runIntervals();
      b.env.runIntervals();
    }
    expect(b.runtime.isAssigned('metrics.cpu')).toBe(true);
    expect(a.runtime.isAssigned('metrics.cpu')).toBe(false);
    // A's owned pattern is what the probe below has to walk past.
    expect(a.runtime.isAssigned('chat.*')).toBe(true);

    expect(a.runtime.publishBatch('metrics.cpu', [{ data: 1 }, { data: 2 }])).toBe(true);
    await Promise.resolve();

    const toOwner = b.onControl.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'metrics.cpu');
    expect(toOwner).toHaveLength(2);
    expect(a.onControl.mock.calls.filter(call => call[0] === 'PUBLISH' && call[1] === 'metrics.cpu')).toHaveLength(0);

    a.runtime.stop();
    b.runtime.stop();
  });

  it('publishBatch treats an empty batch as a no-op and a single item as publish()', async () => {
    const { runtime, onControl } = makeRuntime('single');
    runtime.start();
    runtime.subscribe('t');
    await Promise.resolve();

    expect(runtime.publishBatch('t', [])).toBe(true);
    expect(onControl.mock.calls.filter(call => call[0] === 'PUBLISH')).toHaveLength(0);

    // A single-item batch delegates to publish() and must still carry metadata.
    expect(runtime.publishBatch('t', [{ data: 9, messageId: 'm1', timestamp: 42 }])).toBe(true);
    const publishes = onControl.mock.calls.filter(call => call[0] === 'PUBLISH');
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.slice(3)).toEqual(['m1', 42]);
    runtime.stop();
  });

  it('unsubscribing a topic that has no route is a no-op', async () => {
    const { runtime } = makeRuntime('noroute');
    runtime.start();
    // Never subscribed, so no route record exists — releaseSubscription must
    // return early rather than reading subscribers off a missing route.
    expect(() => runtime.unsubscribe('never.subscribed')).not.toThrow();
    expect(runtime.isAssigned('never.subscribed')).toBe(false);
    runtime.stop();
  });

  it('reports active-worker eligibility and drops out once stopped', async () => {
    const { runtime } = makeRuntime('active');
    runtime.start();
    await Promise.resolve();
    expect(runtime.isActiveWorker()).toBe(true);
    runtime.stop();
    // After stop the worker record is removed, so it is no longer eligible to
    // own topics.
    expect(runtime.isActiveWorker()).toBe(false);
  });

  it('start() and stop() are idempotent', async () => {
    const { runtime } = makeRuntime('idem');
    runtime.start();
    runtime.start();
    await Promise.resolve();
    expect(runtime.getSnapshot().coordinated).toBe(true);
    runtime.stop();
    expect(() => runtime.stop()).not.toThrow();
  });

  it('hasLocalSubscriber matches through a wildcard pattern but not across segment boundaries', async () => {
    const { runtime } = makeRuntime('local');
    runtime.start();
    runtime.subscribe('chat.*');
    await Promise.resolve();
    expect(runtime.hasLocalSubscriber('chat.room.1')).toBe(true);
    expect(runtime.hasLocalSubscriber('chat.*')).toBe(true);
    // Segment-boundary rule: 'chat.*' must not swallow 'chatter.1'.
    expect(runtime.hasLocalSubscriber('chatter.1')).toBe(false);
    expect(runtime.hasLocalSubscriber('unrelated')).toBe(false);
    runtime.stop();
  });
});

describe('WorkerClusterRuntime cluster option validation', () => {
  // These options were previously accepted unvalidated. Their failure modes are
  // silent rather than loud: a 0ms heartbeat interval degenerates into a busy
  // loop (the exact hazard the Centrifuge PING guard exists for), a
  // non-positive TTL prunes every peer on the first reconcile, and a
  // non-positive maxActiveWorkers disables ownership entirely.
  const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'worker' });
  const build = (options: Record<string, unknown>): (() => WorkerClusterRuntime) => {
    return () =>
      new WorkerClusterRuntime({
        clusterKey: 'validation',
        environment: env.environment,
        tabId: 'tab',
        workerId: 'worker',
        handlers: { onControl: vi.fn(), onEvent: vi.fn() },
        ...options
      } as never);
  };

  it('rejects a non-positive or non-finite heartbeatIntervalMs', () => {
    for (const value of [0, -1, NaN, Infinity, '3000']) {
      expect(build({ heartbeatIntervalMs: value }), `heartbeatIntervalMs: ${String(value)}`).toThrow(
        /heartbeatIntervalMs must be a positive finite number/
      );
    }
    expect(build({ heartbeatIntervalMs: 3_000 })).not.toThrow();
  });

  it('rejects a non-positive or non-finite workerTtlMs', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      expect(build({ workerTtlMs: value }), `workerTtlMs: ${String(value)}`).toThrow(
        /workerTtlMs must be a positive finite number/
      );
    }
    expect(build({ workerTtlMs: 10_000 })).not.toThrow();
  });

  it('rejects a maxActiveWorkers that is not a positive safe integer', () => {
    for (const value of [0, -1, 1.5, NaN, Infinity]) {
      expect(build({ maxActiveWorkers: value }), `maxActiveWorkers: ${String(value)}`).toThrow(
        /maxActiveWorkers must be a positive safe integer/
      );
    }
    expect(build({ maxActiveWorkers: 3 })).not.toThrow();
  });

  it('rejects a routeOwnerCacheMax that is not a positive safe integer', () => {
    for (const value of [0, -1, NaN]) {
      expect(build({ routeOwnerCacheMax: value }), `routeOwnerCacheMax: ${String(value)}`).toThrow(
        /routeOwnerCacheMax must be a positive safe integer/
      );
    }
    expect(build({ routeOwnerCacheMax: 256 })).not.toThrow();
  });

  it('rejects a negative or non-finite loadWeighting weight', () => {
    // A negative weight inverts the documented policy (new routes would favour
    // the busiest worker) and a non-finite one poisons the score.
    for (const weight of [-1, NaN, Infinity]) {
      expect(
        build({ loadWeighting: { messageRateWeight: weight } }),
        `messageRateWeight: ${String(weight)}`
      ).toThrow(/loadWeighting\.messageRateWeight must be a non-negative finite number/);
    }
    expect(build({ loadWeighting: { byteRateWeight: -0.5 } })).toThrow(
      /loadWeighting\.byteRateWeight must be a non-negative finite number/
    );
    expect(build({ loadWeighting: { scheduleLagWeight: NaN } })).toThrow(
      /loadWeighting\.scheduleLagWeight must be a non-negative finite number/
    );
    // The documented shape (0 disables a signal) stays accepted.
    expect(build({ loadWeighting: {} })).not.toThrow();
    expect(build({ loadWeighting: { messageRateWeight: 0, byteRateWeight: 0, scheduleLagWeight: 0 } })).not.toThrow();
    expect(
      build({ loadWeighting: { messageRateWeight: 0.5, byteRateWeight: 0.001, scheduleLagWeight: 2 } })
    ).not.toThrow();
  });
});
