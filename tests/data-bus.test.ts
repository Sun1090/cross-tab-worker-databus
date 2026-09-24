import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataBusTraceReporter } from '../src/core/trace';
import type { DataBusTraceEvent } from '../src/core/trace';
import { CrossTabDataBus } from '../src/core/data-bus';
import type { DataBusTransport, DataBusTransportHandlers, WorkerClusterMessage } from '../src/core/types';
import { SDK_VERSION } from '../src/core/version';
import {
  CLUSTER_MESSAGE_TYPE,
  DEFAULT_STORAGE_PREFIX,
  PUBLICATION_EVENT,
  TRACE_EVENT_TYPE,
  TRACE_LIFECYCLE_ACTION,
  WORKER_STATUS
} from '../src/utils/constants';
import { createOpaqueKey } from '../src/core/hash';
import { ChannelHub, createFakeEnvironment, expectRejectionMessage, flushMicrotasks, FakeTransport, MemoryStorage } from './fakes';

describe('CrossTabDataBus', () => {
  afterEach(() => vi.useRealTimers());

  it('starts automatically and queues subscriptions until the transport is ready', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'lazy' });
    let releaseStart!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const transport = new FakeTransport<number>(startGate);
    const bus = new CrossTabDataBus({
      autoStart: true,
      clusterKey: 'transparent-start',
      environment: environment.environment,
      initialConfig: {},
      transport
    });

    bus.subscribe('topic', vi.fn());
    await vi.waitFor(() => expect(transport.startCalls).toBe(1));
    expect(transport.subscribeCalls).toEqual([]);

    releaseStart();
    await bus.ready();
    expect(transport.subscribeCalls).toEqual(['topic']);
  });

  it('never delivers a queued subscribe after the unsubscribe that cancelled it', async () => {
    vi.useFakeTimers();
    // The subscribe is parked behind a pending open while the release goes out on
    // the immediate path once that open resolves, so the pair arrives out of order
    // and a Set-valued transport is left holding a channel no local handler,
    // cluster assignment or route record owns. How many microtasks separate the
    // two depends on where the open's promise chain happens to be, so every offset
    // in the window is asserted rather than only the ones that reproduced here.
    for (const offset of [0, 1, 2, 3, 4]) {
      const storage = new MemoryStorage();
      const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: `stale-sub-${offset}` });
      let releaseStart!: () => void;
      const startGate = new Promise<void>(resolve => {
        releaseStart = resolve;
      });
      const transport = new FakeTransport<number>(startGate);
      const bus = new CrossTabDataBus<object, number>({
        clusterKey: 'stale-sub',
        environment: environment.environment,
        initialConfig: {},
        transport
      });
      bus.onError(() => undefined);

      const release = bus.subscribe('topic', vi.fn());
      releaseStart();
      for (let i = 0; i < offset; i += 1) await flushMicrotasks(1);
      release();
      await vi.advanceTimersByTimeAsync(10_000);
      await flushMicrotasks();

      expect(transport.unsubscribeCalls, `offset ${offset}`).toEqual(['topic']);
      expect(
        transport.channelCalls.lastIndexOf('sub:topic'),
        `offset ${offset}: the wire was ${transport.channelCalls.join(' → ')}, so the released channel stayed open`
      ).toBeLessThan(transport.channelCalls.lastIndexOf('uns:topic'));
      expect(transport.subscribed.has('topic'), `offset ${offset}`).toBe(false);
      expect(bus.getClusterSnapshot().assignedTopics, `offset ${offset}`).toEqual([]);
      await bus.stop();
    }
  });

  it('sends no unsubscribe for a topic re-subscribed before the deferred release flushed', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stale-uns' });
    let releaseStart!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const transport = new FakeTransport<number>(startGate);
    const bus = new CrossTabDataBus<object, number>({
      clusterKey: 'stale-uns',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.onError(() => undefined);

    const release = bus.subscribe('topic', vi.fn());
    release();
    bus.subscribe('topic', vi.fn());
    releaseStart();
    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    // All three calls deferred together, so the flush cannot strand a channel either
    // way; what the cancelled release must not do is reach the transport, where it
    // would sit between the two SUBSCRIBEs and tear down a channel this tab holds.
    expect(transport.unsubscribeCalls).toEqual([]);
    expect(transport.subscribeCalls.length).toBeGreaterThan(0);
    expect(transport.subscribed.has('topic')).toBe(true);
    await bus.stop();
  });

  it('applies the same cancellation to an operation parked behind a recovery gate', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'gate-stale-uns' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus<object, number>({
      clusterKey: 'gate-stale-uns',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 500 }
    });
    bus.onError(() => undefined);
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // A second, independent resume path: `runTransport` checks its guard before
    // re-entering for each gate waiter, and that check — not the one on the opening
    // flush — is what drops the cancelled release here.
    transport.setStatus('error');
    const release = bus.subscribe('topic-2', vi.fn());
    release();
    bus.subscribe('topic-2', vi.fn());
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();

    expect(transport.unsubscribeCalls).toEqual([]);
    expect(transport.subscribed.has('topic-2')).toBe(true);
    await bus.stop();
  });

  it('reference-counts local handlers and subscribes the transport once', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'local' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'cluster',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    await bus.ready();
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = bus.subscribe('topic', first);
    const removeSecond = bus.subscribe('topic', second);

    expect(transport.subscribeCalls).toEqual(['topic']);
    transport.emit('topic', 42);
    expect(first.mock.calls[0]![0]).toMatchObject({ topic: 'topic', data: 42 });
    expect(second.mock.calls[0]![0]).toMatchObject({ topic: 'topic', data: 42 });

    removeFirst();
    expect(transport.unsubscribeCalls).toEqual([]);
    removeSecond();
    expect(transport.unsubscribeCalls).toEqual(['topic']);
  });

  it('replays assigned topics after the transport reconnects', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reconnect' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'reconnect',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.subscribeCalls).toEqual(['topic']);

    transport.setStatus('disconnected');
    transport.setStatus('connected');
    expect(transport.subscribeCalls).toEqual(['topic', 'topic']);
  });

  it('replays each assigned topic exactly once per reconnect cycle', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reconnect-cycles' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'reconnect-cycles',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic-a', vi.fn());
    bus.subscribe('topic-b', vi.fn());
    await bus.ready();

    expect(transport.subscribeCalls).toEqual(['topic-a', 'topic-b']);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      transport.setStatus('disconnected');
      transport.setStatus('connected');
    }

    expect(transport.subscribeCalls).toEqual([
      'topic-a', 'topic-b',
      'topic-a', 'topic-b',
      'topic-a', 'topic-b',
      'topic-a', 'topic-b'
    ]);
    expect(new Set(transport.subscribeCalls).size).toBe(2);
  });

  it('keeps reconnect replay bounded and duplicate-free across extended flapping', async () => {
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'reconnect-extended' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'reconnect-extended', environment: environment.environment, initialConfig: {}, transport });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    for (let cycle = 0; cycle < 20; cycle += 1) {
      transport.setStatus('disconnected');
      transport.setStatus('connected');
    }
    expect(transport.subscribeCalls).toHaveLength(21);
    expect(new Set(transport.subscribeCalls)).toEqual(new Set(['topic']));
  });

  it('drops an unsubscribed topic before the next reconnect replay', async () => {
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'unsubscribe-replay' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'unsubscribe-replay', environment: environment.environment, initialConfig: {}, transport });
    const remove = vi.fn();
    const unsubscribe = bus.subscribe('remove', remove);
    await bus.ready();
    unsubscribe();
    environment.runIntervals();
    transport.setStatus('disconnected');
    transport.setStatus('connected');
    expect(transport.subscribeCalls).toEqual(['remove']);
    transport.emit('remove', 1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('restores every topic exactly once after multi-topic recovery', async () => {
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'multi-topic-recovery' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'multi-topic-recovery', environment: environment.environment, initialConfig: {}, transport });
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe('alpha', first);
    bus.subscribe('beta', second);
    await bus.ready();
    transport.setStatus('disconnected');
    transport.setStatus('connected');
    expect(transport.subscribeCalls).toEqual(['alpha', 'beta', 'alpha', 'beta']);
    transport.emit('alpha', 1);
    transport.emit('beta', 2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate subscriptions during status flapping', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'status-flap' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'status-flap',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    transport.setStatus('connected');
    transport.setStatus('connected');
    transport.setStatus('disconnected');
    transport.setStatus('disconnected');
    transport.setStatus('error');
    transport.setStatus('connected');

    expect(transport.subscribeCalls).toEqual(['topic', 'topic']);
    expect(new Set(transport.subscribeCalls)).toEqual(new Set(['topic']));
  });

  it('routes one transport subscription across tabs and migrates after owner shutdown', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'wss://example.test',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'wss://example.test',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB
    });
    await busA.start({});
    now += 1;
    await busB.start({});
    const receivedA: number[] = [];
    const receivedB: number[] = [];
    busA.subscribe('market.tick', message => receivedA.push(message.data));
    busB.subscribe('market.tick', message => receivedB.push(message.data));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(transportA.subscribeCalls).toEqual(['market.tick']);
    expect(transportB.subscribeCalls).toEqual([]);
    transportA.emit('market.tick', 1);
    expect(receivedA).toEqual([1]);
    expect(receivedB).toEqual([1]);

    await busA.stop();
    expect(transportB.subscribeCalls).toEqual(['market.tick']);
    transportB.emit('market.tick', 2);
    expect(receivedB).toEqual([1, 2]);
  });

  it('traces a subscription only when the owner transport state changes', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'trace-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'trace-b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const eventsA: DataBusTraceEvent[] = [];
    const busA = new CrossTabDataBus({
      clusterKey: 'subscription-trace',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      trace: { enabled: true, sink: event => eventsA.push(event) },
      transport: transportA
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'subscription-trace',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB
    });

    await busA.start({});
    now += 1;
    await busB.start({});
    busA.subscribe('market.tick', vi.fn());
    busB.subscribe('market.tick', vi.fn());

    expect(transportA.subscribeCalls).toEqual(['market.tick']);
    expect(
      eventsA.filter(
        event => event.type === 'subscription' && event.action === 'subscribe' && event.topic === 'market.tick'
      )
    ).toHaveLength(1);

    await Promise.all([busA.stop(), busB.stop()]);
  });

  it('surfaces stranded-handoff recovery in the trace sink as route_migration_recovery', async () => {
    // End-to-end of the recovery diagnostic: two live buses, the owner's
    // ROUTE_RELEASED dropped on the wire, owner suspended. Past the worker
    // TTL the survivor re-elects and the trace sink — the public surface —
    // must carry the recovery operation, not the graceful-migration one.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'trace-rec-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'trace-rec-b' });
    const eventsB: DataBusTraceEvent[] = [];
    const busA = new CrossTabDataBus({
      clusterKey: 'trace-recovery',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: new FakeTransport<number>()
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'trace-recovery',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: new FakeTransport<number>(),
      trace: { enabled: true, sink: event => eventsB.push(event) }
    });
    await busA.start({});
    await busB.start({});
    busA.subscribe('t', vi.fn());
    busB.subscribe('t', vi.fn());
    await busA.ready();
    await busB.ready();
    expect(busA.getClusterSnapshot().assignedTopics).toContain('t');

    const originalSend = hub.send.bind(hub);
    let ackDropped = false;
    hub.send = (source: { name: string }, message: WorkerClusterMessage) => {
      if (!ackDropped && message.type === CLUSTER_MESSAGE_TYPE.ROUTE_RELEASED) {
        ackDropped = true;
        return;
      }
      originalSend(source as never, message);
    };
    envA.pageHide();
    await Promise.resolve();
    expect(ackDropped).toBe(true);

    // Heartbeat-sized steps so peer heartbeats keep propagating (mirrors the
    // cluster soak test's fake-clock discipline).
    for (let step = 0; step < 11; step += 1) {
      now += 1000;
      envA.runIntervals();
      envB.runIntervals();
      await Promise.resolve();
    }
    envB.runIntervals();
    await Promise.resolve();

    expect(busB.getClusterSnapshot().assignedTopics).toContain('t');
    const recoveries = eventsB.filter(
      event => event.type === 'reliability' && event.operation === 'route_migration_recovery' && event.topic === 't'
    );
    expect(recoveries.length).toBeGreaterThanOrEqual(1);
    expect(
      eventsB.filter(
        event => event.type === 'reliability' && event.operation === 'route_migration' && event.topic === 't'
      )
    ).toHaveLength(0);

    await Promise.all([busA.stop(), busB.stop()]);
  });

  it('keeps business subscriptions transparent across visibility and page cache lifecycle', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'lifecycle-bus',
      environment: envA.environment,
      initialConfig: {},
      tabId: 'tab-a',
      transport: transportA,
      workerId: 'worker-a'
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'lifecycle-bus',
      environment: envB.environment,
      initialConfig: {},
      tabId: 'tab-b',
      transport: transportB,
      workerId: 'worker-b'
    });
    const receivedA: number[] = [];
    const receivedB: number[] = [];
    busA.subscribe('topic', message => receivedA.push(message.data));
    await busA.ready();
    now += 1;
    busB.subscribe('topic', message => receivedB.push(message.data));
    await busB.ready();

    envA.setVisibility('hidden');
    expect(transportA.subscribed.has('topic')).toBe(true);
    expect(transportB.subscribed.has('topic')).toBe(false);
    transportA.emit('topic', 1);
    expect(receivedA).toEqual([1]);
    expect(receivedB).toEqual([1]);

    const unsubscribeCallsBeforePageHide = transportA.unsubscribeCalls.length;
    envA.pageHide();
    expect(transportA.unsubscribeCalls).toHaveLength(unsubscribeCallsBeforePageHide + 1);
    expect(transportA.unsubscribeCalls.at(-1)).toBe('topic');
    expect(transportB.subscribed.has('topic')).toBe(true);
    transportB.emit('topic', 2);
    expect(receivedA).toEqual([1]);
    expect(receivedB).toEqual([1, 2]);

    envA.setVisibility('visible');
    envA.pageShow();
    await busA.ready();
    expect(transportA.startCalls).toBe(2);
    expect(transportA.subscribed.has('topic')).toBe(false);
    expect(transportB.subscribed.has('topic')).toBe(true);
    transportB.emit('topic', 3);
    expect(receivedA).toEqual([1, 3]);
    expect(receivedB).toEqual([1, 2, 3]);
  });

  it('resumes cluster coordination when an explicit start() takes a hidden tab out of suspension', async () => {
    // pagehide() pauses the cluster (channel closed, routes handed off, worker
    // record removed) and stops the transport. An explicit start() is a
    // documented resume path: it clears `suspended` and reopens the transport.
    // It must restart the paused cluster too. Otherwise the bus reports a
    // healthy transport while cross-tab coordination stays dormant until the
    // next pageshow, and every incoming publication is discarded by
    // isAssigned() against the cleared assignment map.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'explicit-start-resume',
      environment: envA.environment,
      initialConfig: {},
      tabId: 'tab-a',
      transport: transportA,
      workerId: 'worker-a'
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'explicit-start-resume',
      environment: envB.environment,
      initialConfig: {},
      tabId: 'tab-b',
      transport: transportB,
      workerId: 'worker-b'
    });
    const receivedA: number[] = [];
    const receivedB: number[] = [];
    busA.subscribe('topic', message => receivedA.push(message.data));
    await busA.ready();
    now += 1;
    busB.subscribe('topic', message => receivedB.push(message.data));
    await busB.ready();

    envA.pageHide();
    expect(busA.getClusterSnapshot().suspended).toBe(true);
    transportB.emit('topic', 2);
    expect(receivedA).toEqual([]);
    expect(receivedB).toEqual([2]);

    await busA.start({});
    await busA.ready();
    expect(busA.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy', suspended: false });
    expect(busA.getClusterSnapshot().suspended).toBe(false);

    // The resumed cluster re-registers its subscriber, so the peer owner's
    // fan-out reaches this tab again.
    transportB.emit('topic', 3);
    expect(receivedA).toEqual([3]);
    expect(receivedB).toEqual([2, 3]);
    await Promise.all([busA.stop(), busB.stop()]);
  });

  it('lets a stop() re-entered from the RESUME trace cancel the rest of an explicit resume', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const environment = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'reentrant-resume' });
    const transport = new FakeTransport<number>();
    let nestedStop: Promise<void> | undefined;
    let resumeArmed = false;
    let resumeSinkHits = 0;
    const bus = new CrossTabDataBus({
      clusterKey: 'reentrant-resume',
      environment: environment.environment,
      initialConfig: {},
      trace: {
        enabled: true,
        sink: event => {
          if (
            resumeArmed &&
            event.type === TRACE_EVENT_TYPE.LIFECYCLE &&
            event.action === TRACE_LIFECYCLE_ACTION.RESUME
          ) {
            resumeSinkHits += 1;
            if (resumeSinkHits === 1) nestedStop = bus.stop();
          }
        }
      },
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    environment.pageHide();
    expect(bus.getClusterSnapshot().suspended).toBe(true);

    resumeArmed = true;
    const resuming = bus.start({});
    expect(nestedStop).toBeDefined();
    await Promise.all([resuming, nestedStop!]);
    await Promise.resolve();

    expect(resumeSinkHits).toBe(1);
    expect(transport.startCalls).toBe(1);
    expect(transport.stopCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: false,
      state: 'stopped',
      started: false,
      suspended: false,
      transport: { ready: false, status: WORKER_STATUS.DISCONNECTED }
    });
    // The stop from the RESUME trace must also prevent the outer explicit
    // resume from restarting the cluster after teardown.
    expect(bus.getClusterSnapshot()).toMatchObject({ coordinated: false, suspended: false });

    await bus.stop();
  });

  it('returns a promise from a resume that a re-entered start() has already superseded', async () => {
    // The sibling of the case above, and it reaches the other half of the same
    // early return. A re-entered `stop()` leaves `stopPromise` set, so
    // `return this.stopPromise ?? Promise.resolve()` takes the first operand; a
    // re-entered `start()` bumps `lifecycleEpoch` with no stop in flight at all,
    // so nothing had assigned `stopPromise` and only the fallback keeps `start()`
    // returning the Promise its signature promises. Without it the call returns
    // `null`, and `bus.start(c).then(...)` — a documented usage in the adapters —
    // throws `TypeError: Cannot read properties of null`.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const environment = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'reentrant-resume-start' });
    const transport = new FakeTransport<number>();
    let resumeArmed = false;
    let resumeSinkHits = 0;
    let nestedStart: Promise<void> | undefined;
    const bus = new CrossTabDataBus({
      clusterKey: 'reentrant-resume-start',
      environment: environment.environment,
      initialConfig: {},
      trace: {
        enabled: true,
        sink: event => {
          if (
            resumeArmed &&
            event.type === TRACE_EVENT_TYPE.LIFECYCLE &&
            event.action === TRACE_LIFECYCLE_ACTION.RESUME
          ) {
            resumeSinkHits += 1;
            // Once, from the outer resume's own event. The nested start emits a
            // RESUME of its own; an unguarded sink would recurse forever.
            if (resumeSinkHits === 1) nestedStart = bus.start({});
          }
        }
      },
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    environment.pageHide();
    expect(bus.getClusterSnapshot().suspended).toBe(true);
    const opensBeforeResume = transport.startCalls;

    resumeArmed = true;
    const outer = bus.start({});
    expect(outer).toBeInstanceOf(Promise);
    await outer;
    await nestedStart!;
    await Promise.resolve();

    // Outer + inner RESUME events, and exactly one of them opens the transport:
    // the outer cancelled itself because the nested start owns the lifecycle now.
    expect(resumeSinkHits).toBe(2);
    expect(transport.startCalls).toBe(opensBeforeResume + 1);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, started: true, suspended: false });
    // The subscription intent survives the doubled resume.
    expect(transport.subscribed.has('topic')).toBe(true);

    await bus.stop();
  });

  it('queues a start() re-entered from the environment port behind a failed open teardown', async () => {
    // The sibling of the case above, at the *other* `stopPromise ?? Promise.resolve()`
    // site: `queueStartAfterStop()` waits on the gate an explicit `stop()` installs,
    // and no test had reached it while that field was still null. A failed *initial*
    // open is exactly that state — its teardown is owned by `pendingStop`, not by
    // `stopPromise` — and the only application-code seam inside the `stopping` window
    // is the caller-supplied `ClusterEnvironment` port (a browser `localStorage`
    // never re-enters the bus), so the storage below wraps it. The scenario is the
    // port's contract, not a browser page.
    //
    // Two claims here are measured, and they land on different lines.
    //
    // The order asserted below is NOT this expression's protection. Deleting the read
    // outright (`const stop = Promise.resolve()`) leaves this file 194/194 green, and
    // so does moving the `pendingStop` installation below the `cluster.stop()` window,
    // because `start()` chains the reopen behind `this.pendingStop` on its own: the
    // `start` → `stop` → `start` order survives both mutations. That makes the
    // fallback leg executing-and-redundant rather than dominated. The same mutation
    // does have a consequence elsewhere — it aborts `tests/lifecycle-invariants.test.ts`
    // with an out-of-memory after ~40 s, because a restart woken too early re-queues
    // through `start()`'s `stopping` routing forever — and that is the *gate* operand's
    // job, recorded at `queueStartAfterStop()`.
    //
    // What this case does have teeth on is one line above that leg: routing on the
    // gate instead of the flag (`if (this.stopping)` → `if (this.stopPromise)` in
    // `start()`) reddens it, as an escaped `Transport failed during startup.` from the
    // fresh-open path `start()` then takes. Measured against that single mutation:
    // exactly this test and the pre-existing "performs a fresh stop when the previous
    // stop gate is settled but not yet cleared" fail, 192 pass.
    const storage = new (class extends MemoryStorage {
      onWorkerRemoval: (() => void) | null = null;

      override removeItem(key: string): void {
        if (key.includes(':worker:')) this.onWorkerRemoval?.();
        super.removeItem(key);
      }
    })();
    const hub = new ChannelHub();
    const environment = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'reentrant-port-start' });
    const transport = new FakeTransport<number>();
    transport.startShouldFail = true;
    const calls: string[] = [];
    const openTransport = transport.start.bind(transport);
    const shutTransport = transport.stop.bind(transport);
    transport.start = (config, handlers) => {
      calls.push('start');
      return openTransport(config, handlers);
    };
    transport.stop = () => {
      calls.push('stop');
      return shutTransport();
    };

    const bus = new CrossTabDataBus({
      clusterKey: 'reentrant-port-start',
      environment: environment.environment,
      initialConfig: {},
      transport
    });

    let reentered = 0;
    let startCallsAtReentry = -1;
    let restart: Promise<void> | undefined;
    storage.onWorkerRemoval = () => {
      if (reentered > 0) return;
      reentered += 1;
      startCallsAtReentry = transport.startCalls;
      // The retry this one stands for: the port write happens while the first
      // attempt's failure is still being cleaned up, and the open now succeeds.
      transport.startShouldFail = false;
      restart = bus.start({});
    };
    bus.subscribe('feed', vi.fn());

    await expect(bus.ready()).rejects.toThrow('Transport failed during startup.');
    expect(restart).toBeInstanceOf(Promise);
    await restart!;
    await flushMicrotasks();

    expect(startCallsAtReentry).toBe(1);
    expect(calls).toEqual(['start', 'stop', 'start']);
    expect(transport.startCalls).toBe(2);
    expect(transport.stopCalls).toBe(1);
    expect(bus.getStatus()).toBe(WORKER_STATUS.CONNECTED);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, started: true, suspended: false });
    // The intent registered on the failed lifecycle is replayed by the retry, so a
    // reordered teardown that stopped the fresh transport would also lose this.
    expect(transport.subscribed.has('feed')).toBe(true);

    await bus.stop();
  });

  it('lets a stop() re-entered from the RESUME trace keep pageshow from reactivating the cluster', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const environment = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'reentrant-page-show' });
    const transport = new FakeTransport<number>();
    let nestedStop: Promise<void> | undefined;
    let resumeArmed = false;
    let resumeSinkHits = 0;
    const bus = new CrossTabDataBus({
      clusterKey: 'reentrant-page-show',
      environment: environment.environment,
      initialConfig: {},
      trace: {
        enabled: true,
        sink: event => {
          if (
            resumeArmed &&
            event.type === TRACE_EVENT_TYPE.LIFECYCLE &&
            event.action === TRACE_LIFECYCLE_ACTION.RESUME
          ) {
            resumeSinkHits += 1;
            if (resumeSinkHits === 1) nestedStop = bus.stop();
          }
        }
      },
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    environment.pageHide();
    expect(bus.getClusterSnapshot().suspended).toBe(true);

    resumeArmed = true;
    environment.pageShow();
    expect(nestedStop).toBeDefined();
    await nestedStop!;
    await Promise.resolve();

    expect(resumeSinkHits).toBe(1);
    expect(transport.startCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: false,
      state: 'stopped',
      started: false,
      transport: { ready: false, status: WORKER_STATUS.DISCONNECTED }
    });
    // pageshow must not reactivate the cluster after the RESUME callback has
    // stopped the new lifecycle.
    expect(bus.getClusterSnapshot()).toMatchObject({ coordinated: false, suspended: false });
  });

  it('resumes replay retention sweeps when an explicit start() leaves BFCache suspension', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'explicit-start-retention' });
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined),
      clearBefore: vi.fn(async (_timestamp: number) => undefined)
    };
    const traceEvents: DataBusTraceEvent[] = [];
    const bus = new CrossTabDataBus({
      clusterKey: 'explicit-start-retention',
      environment: environment.environment,
      initialConfig: {},
      replay: { retentionMs: 60_000, retentionSweepMs: 1_000, persistence },
      trace: { enabled: true, sink: event => traceEvents.push(event) },
      transport: new FakeTransport<number>()
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    persistence.clearBefore.mockClear();

    environment.pageHide();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persistence.clearBefore).not.toHaveBeenCalled();

    await bus.start({});
    await bus.ready();
    expect(traceEvents.some(event => event.type === 'lifecycle' && event.action === 'resume')).toBe(true);
    persistence.clearBefore.mockClear();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persistence.clearBefore).toHaveBeenCalledOnce();

    await bus.stop();
  });

  it('aggregates message metrics at the configured interval without leaking content', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'trace' });
    const transport = new FakeTransport<{ secret: string }>();
    const events: DataBusTraceEvent[] = [];
    const bus = new CrossTabDataBus({
      clusterKey: 'trace-metrics',
      environment: environment.environment,
      initialConfig: {},
      trace: {
        enabled: true,
        mode: 'metrics',
        metricsIntervalMs: 2_000,
        sink: event => events.push(event)
      },
      transport
    });
    bus.subscribe('private-topic', vi.fn());
    await bus.ready();

    transport.emit('private-topic', { secret: 'private-payload' });
    transport.emit('private-topic', { secret: 'private-payload' });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(events).toEqual([
      expect.objectContaining({
        type: 'message_metrics',
        durationMs: 2_000,
        received: 2,
        dispatched: 2,
        topics: 1,
        dispatchSamples: 2,
        dispatchAvgMs: expect.any(Number),
        dispatchP50Ms: expect.any(Number),
        dispatchP95Ms: expect.any(Number),
        dispatchMaxMs: expect.any(Number)
      })
    ]);
    expect(JSON.stringify(events)).not.toContain('private-topic');
    expect(JSON.stringify(events)).not.toContain('private-payload');
    await bus.stop();
  });

  it('aggregates receive-to-dispatch latency percentiles', () => {
    let nowMs = 1_000;
    const now = () => nowMs;
    const events: DataBusTraceEvent[] = [];
    const trace = new DataBusTraceReporter(
      {
        enabled: true,
        mode: 'metrics',
        metricsIntervalMs: 1_000,
        sink: event => events.push(event)
      },
      now
    );

    trace.start();
    trace.recordReceived('topic');
    nowMs = 1_010;
    trace.recordDispatched('topic');
    trace.recordReceived('topic');
    nowMs = 1_040;
    trace.recordDispatched('topic');
    trace.flush();
    trace.stop();

    const metric = events.find(event => event.type === 'message_metrics');
    expect(metric).toEqual(
      expect.objectContaining({
        received: 2,
        dispatched: 2,
        dispatchSamples: 2,
        dispatchMaxMs: 25,
        dispatchAvgMs: 20
      })
    );
  });

  it('does not pair latency with receives that are never dispatched', () => {
    let nowMs = 1_000;
    const now = () => nowMs;
    const events: DataBusTraceEvent[] = [];
    const trace = new DataBusTraceReporter(
      {
        enabled: true,
        mode: 'metrics',
        metricsIntervalMs: 1_000,
        sink: event => events.push(event)
      },
      now
    );

    trace.start();
    trace.recordReceived('topic');
    nowMs = 1_010;
    trace.recordDiscarded('topic');
    trace.recordReceived('topic');
    nowMs = 1_020;
    trace.recordDispatched('topic');
    trace.flush();
    trace.stop();

    const metric = events.find(event => event.type === 'message_metrics');
    expect(metric).toEqual(
      expect.objectContaining({
        received: 2,
        dispatched: 1,
        dispatchSamples: 1,
        dispatchMaxMs: 25,
        dispatchAvgMs: 10
      })
    );
  });

  it('does not emit latency samples for dispatches without a local receive', () => {
    let nowMs = 1_000;
    const now = () => nowMs;
    const events: DataBusTraceEvent[] = [];
    const trace = new DataBusTraceReporter(
      {
        enabled: true,
        mode: 'metrics',
        metricsIntervalMs: 1_000,
        sink: event => events.push(event)
      },
      now
    );

    trace.start();
    nowMs = 4_900;
    trace.recordDispatched('topic');
    trace.flush();
    trace.stop();

    const metric = events.find(event => event.type === 'message_metrics');
    expect(metric).toEqual(
      expect.objectContaining({
        received: 0,
        dispatched: 1,
        dispatchSamples: 0,
        dispatchAvgMs: 0
      })
    );
  });

  it('pauses metrics during pagehide and resumes with a fresh window on pageshow', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'lifecycle-trace' });
    const transport = new FakeTransport<number>();
    const events: DataBusTraceEvent[] = [];
    const bus = new CrossTabDataBus({
      clusterKey: 'trace-lifecycle',
      environment: environment.environment,
      initialConfig: {},
      trace: { enabled: true, sink: event => events.push(event) },
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.emit('topic', 1);

    environment.pageHide();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.some(event => event.type === 'message_metrics')).toBe(false);

    environment.pageShow();
    await bus.ready();
    transport.emit('topic', 2);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(events.filter(event => event.type === 'message_metrics')).toEqual([
      expect.objectContaining({ received: 1, dispatched: 1, topics: 1 })
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'lifecycle', action: 'suspend' }),
        expect.objectContaining({ type: 'lifecycle', action: 'resume' })
      ])
    );
    await bus.stop();
  });

  it('does not report ready while the tab is BFCache-suspended', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'ready-suspended' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'ready-suspended',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    environment.pageHide();
    await expect(bus.ready()).rejects.toThrow(/suspended/i);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: false, state: 'suspended' });

    environment.pageShow();
    await expect(bus.ready()).resolves.toBeUndefined();
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy' });
    await bus.stop();
  });

  it('does not restart background resources when pageshow arrives after an explicit stop', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'pageshow-after-stop' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'pageshow-after-stop',
      environment: environment.environment,
      initialConfig: {},
      transport,
      trace: { sink: () => {}, metricsIntervalMs: 10 },
      dedup: { sweepMs: 10 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    await bus.stop();
    expect(vi.getTimerCount()).toBe(0);

    // A pagehide/page show pair is not an implicit start. An explicit stop
    // clears activeConfig and must keep every background resource dormant even
    // when the browser later restores a BFCache page.
    environment.pageShow();
    await Promise.resolve();

    expect(transport.startCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(bus.getHealthSummary()).toMatchObject({ started: false, state: 'stopped' });
  });

  it('keeps tracing disabled by default', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'no-trace' });
    const transport = new FakeTransport<number>();
    const events: DataBusTraceEvent[] = [];
    const bus = new CrossTabDataBus({
      clusterKey: 'no-trace',
      environment: environment.environment,
      initialConfig: {},
      trace: { sink: event => events.push(event) },
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.emit('topic', 1);
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await bus.stop();
  });

  it('resets startPromise after successful start so start() can be called again', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reset' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'start-promise-reset',
      environment: environment.environment,
      transport
    });

    await bus.start({});
    expect(transport.startCalls).toBe(1);

    // startPromise should be null after success, so a second start() is a no-op
    // (returns resolved) rather than returning the first call's resolved promise.
    const second = bus.start({});
    // Must resolve immediately, not hang on the first call's promise.
    await expect(second).resolves.toBeUndefined();
    expect(transport.startCalls).toBe(1); // still only one transport start

    // After stop, start() starts fresh.
    await bus.stop();
    await bus.start({});
    expect(transport.startCalls).toBe(2);
  });

  it('isolates a throwing message handler so other handlers still receive the message', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'isolate' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'handler-isolation',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    const handler1 = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const handler2 = vi.fn();
    bus.subscribe('topic', handler1);
    bus.subscribe('topic', handler2);
    await bus.ready();

    transport.emit('topic', 42);
    // handler2 should still receive the message even though handler1 threw
    expect(handler2.mock.calls[0]![0]).toMatchObject({ topic: 'topic', data: 42 });
    // The error should be reported to the error handler
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe('boom');
    await bus.stop();
  });

  it('isolates a throwing status handler so other handlers still receive the update', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'isolate-status' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'status-isolation',
      environment: environment.environment,
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    const statusHandler1 = vi.fn().mockImplementation(() => { throw new Error('status-boom'); });
    const statusHandler2 = vi.fn();
    bus.onStatus(statusHandler1);
    bus.onStatus(statusHandler2);

    // Start triggers 'connecting' → 'connected' status updates
    await bus.start({});

    // Both handlers should have been called with 'connected'
    expect(statusHandler2).toHaveBeenCalledWith('connected');
    // The error should be reported
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe('status-boom');
    await bus.stop();
  });

  it('isolates a throwing error handler so other error handlers still receive the error', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'isolate-error' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'error-isolation',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const throwingHandler = vi.fn().mockImplementation(() => { throw new Error('handler-boom'); });
    const normalHandler = vi.fn();
    bus.onError(throwingHandler);
    bus.onError(normalHandler);
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // A throwing message handler should trigger onError, which should not be
    // blocked by the throwing error handler.
    const handler = vi.fn().mockImplementation(() => { throw new Error('msg-boom'); });
    bus.subscribe('topic', handler);
    transport.emit('topic', 42);

    expect(normalHandler).toHaveBeenCalled();
    await bus.stop();
  });

  it('recovers from transport error status by reopening the transport', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'recover' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'recovery',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);
    expect(transport.subscribeCalls).toEqual(['topic']);

    // Simulate a worker crash — transport error triggers auto-recovery
    transport.startShouldFail = true;
    transport.setStatus('error');

    // Advance past the recovery cooldown so the auto-recovery fires
    await vi.advanceTimersByTimeAsync(1_500);
    // Recovery attempted but failed (startShouldFail was true)
    expect(transport.startCalls).toBe(2);

    // After the recovery failed, the transport is down. Make the next start
    // succeed and subscribe to a new topic — runTransport should trigger a reopen.
    transport.startShouldFail = false;
    bus.subscribe('topic2', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(3);
    expect(transport.subscribeCalls).toContain('topic2');
    await bus.stop();
  });

  it('defers transport operations while a runtime recovery is in cooldown', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'defer-recovery' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'defer-recovery',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 500, maxAttempts: 2 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);
    expect(transport.subscribeCalls).toEqual(['topic']);

    // The transport is dead, but automatic recovery cannot run until the
    // cooldown expires. Operations issued in that window must wait for the
    // scheduled attempt instead of being written to the dead connection.
    transport.setStatus('error');
    bus.publish('topic', 42);
    bus.subscribe('topic-2', vi.fn());

    expect(transport.startCalls).toBe(1);
    expect(transport.publishCalls).toEqual([]);
    expect(transport.subscribeCalls).toEqual(['topic']);

    await vi.advanceTimersByTimeAsync(500);

    expect(transport.startCalls).toBe(2);
    expect(transport.publishCalls).toHaveLength(1);
    expect(transport.publishCalls[0]).toMatchObject({ topic: 'topic', data: 42 });
    expect(transport.subscribeCalls).toEqual(expect.arrayContaining(['topic', 'topic-2']));
    await bus.stop();
    vi.useRealTimers();
  });

  it('sends no unsubscribe to a transport while the bus is stopping', async () => {
    // `WorkerClusterRuntime.stop()` releases local subscriptions and then hands off
    // the topics it owned, and the handoff posts an UNSUBSCRIBE through the same
    // control seam a live unsubscribe uses - which is how `runTransport` comes to be
    // evaluated with `stopping` already set (`!this.stopping` is also why the
    // demand-reopen leg under it cannot decide anything, since the reopen it would
    // fall through to re-checks the flag itself).
    //
    // Two tabs are required, not one: `handoffAssignedTopics()` looks up the
    // remaining subscribers for the route and, finding none, just removes the route
    // without posting anything. Only a peer that will take the topic over turns the
    // handoff into a control frame.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'unsub-a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'unsub-b' });
    const transportA = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'stopping-unsub',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'stopping-unsub',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: new FakeTransport<number>()
    });
    await busA.start({});
    await busB.start({});
    busA.subscribe('t', vi.fn());
    busB.subscribe('t', vi.fn());
    await busA.ready();
    await busB.ready();
    expect(busA.getClusterSnapshot().assignedTopics).toContain('t');
    expect(transportA.subscribeCalls).toContain('t');
    expect(transportA.unsubscribeCalls).toEqual([]);

    await busA.stop();
    expect(transportA.unsubscribeCalls, 'a stopping transport must not be sent an UNSUBSCRIBE').toEqual([]);
    await busB.stop();
  });

  it('lets an explicit operation drive an immediate reopen after a failed auto attempt', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'demand-recovery' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'demand-recovery',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 500, maxAttempts: 3 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // The first automatic attempt fails while the failure is still inside the
    // cooldown window, so the next auto timer is another full cooldown away.
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(500);
    expect(transport.startCalls).toBe(2);

    // An explicit operation must not wait for that next timer: it starts an
    // on-demand reopen immediately and is delivered once the transport is
    // actually ready again.
    transport.startShouldFail = false;
    bus.publish('topic', 7);
    expect(transport.startCalls).toBe(2);
    expect(transport.publishCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(0);
    expect(transport.startCalls).toBe(3);
    expect(transport.publishCalls).toHaveLength(1);
    expect(transport.publishCalls[0]).toMatchObject({ topic: 'topic', data: 7 });

    // The superseded automatic timer must not open a second transport.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(transport.startCalls).toBe(3);
    await bus.stop();
    vi.useRealTimers();
  });

  it('keeps a queued operation parked until a demand-driven reopen succeeds', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'demand-recovery-retry' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'demand-recovery-retry',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 500, maxAttempts: 5 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // Automatic attempt fails; the cooldown window is still open.
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(500);
    expect(transport.startCalls).toBe(2);

    // The queued publish drives a reopen that also fails. It must stay queued
    // instead of being written to the dead transport or discarded.
    bus.publish('topic', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.startCalls).toBe(3);
    expect(transport.publishCalls).toEqual([]);

    transport.startShouldFail = false;
    bus.publish('topic', 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.startCalls).toBe(4);
    expect(transport.publishCalls.map(call => call.data)).toEqual([1, 2]);
    await bus.stop();
    vi.useRealTimers();
  });

  it('retries an operation that was already queued when automatic recovery fails', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'queued-demand' });
    const transport = new FakeTransport<number>();
    const originalStart = transport.start.bind(transport);
    transport.start = (config, handlers) => {
      // Initial start succeeds, the scheduled automatic recovery fails, and
      // the queued operation's demand recovery succeeds immediately.
      transport.startShouldFail = transport.startCalls === 1;
      return originalStart(config, handlers);
    };
    const bus = new CrossTabDataBus({
      clusterKey: 'queued-demand',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 500, maxAttempts: 3 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // This operation arrives during the automatic cooldown. The automatic
    // attempt fails; the operation must still drive one demand recovery rather
    // than waiting forever for some unrelated future operation.
    transport.setStatus(WORKER_STATUS.ERROR);
    bus.publish('topic', 7);
    await vi.advanceTimersByTimeAsync(500);

    expect(transport.startCalls).toBe(3);
    expect(transport.publishCalls).toHaveLength(1);
    expect(transport.publishCalls[0]).toMatchObject({ topic: 'topic', data: 7 });
    await bus.stop();
    vi.useRealTimers();
  });

  it('issues a single demand reopen for multiple operations parked behind a failed automatic attempt', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'queued-demand-batch' });
    const transport = new FakeTransport<number>();
    const originalStart = transport.start.bind(transport);
    transport.start = (config, handlers) => {
      // Only the scheduled automatic attempt (the second start) fails; the one
      // demand reopen then succeeds for every parked operation.
      transport.startShouldFail = transport.startCalls === 1;
      return originalStart(config, handlers);
    };
    const bus = new CrossTabDataBus({
      clusterKey: 'queued-demand-batch',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 500, maxAttempts: 3 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // Three operations arrive during the automatic cooldown and park together.
    transport.setStatus(WORKER_STATUS.ERROR);
    bus.publish('topic', 1);
    bus.publish('topic', 2);
    bus.publish('topic', 3);
    await vi.advanceTimersByTimeAsync(500);

    // One reopen drains all three parked operations — not one reopen each.
    expect(transport.startCalls).toBe(3);
    expect(transport.publishCalls.map(call => call.data)).toEqual([1, 2, 3]);
    await bus.stop();
    vi.useRealTimers();
  });

  it('preserves operations parked on a recovery gate when an explicit start supersedes the automatic attempt', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'manual-start-parked' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'manual-start-parked',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 500, maxAttempts: 3 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // The operation parks during the automatic cooldown. An explicit start
    // supersedes that timer, but if the explicit attempt also fails the parked
    // operation must remain queued for the next automatic attempt instead of
    // being silently dropped with the superseded opening.
    transport.startShouldFail = true;
    transport.setStatus(WORKER_STATUS.ERROR);
    bus.publish('topic', 7);
    await expect(bus.start({})).rejects.toThrow('Transport failed during startup.');
    expect(transport.publishCalls).toEqual([]);

    transport.startShouldFail = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(transport.publishCalls).toHaveLength(1);
    expect(transport.publishCalls[0]).toMatchObject({ topic: 'topic', data: 7 });
    await bus.stop();
    vi.useRealTimers();
  });

  it('drops a parked recovery operation when pagehide and an immediate explicit start supersede it', async () => {
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'parked-recovery-cancel'
    });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'parked-recovery-cancel',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 1_000, maxAttempts: 5 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.subscribeCalls).toEqual(['topic']);

    // This subscribe parks behind the recovery gate rather than reaching the
    // failed transport. pagehide cancels recovery; the explicit start below
    // clears `suspended` before the gate's continuation microtask runs.
    transport.setStatus(WORKER_STATUS.ERROR);
    bus.subscribe('topic-2', vi.fn());
    expect(transport.subscribeCalls).toEqual(['topic']);
    const callsBeforeReconnect = transport.subscribeCalls.length;

    environment.pageHide();
    await bus.start({});
    await bus.ready();

    // Resuming must subscribe each assigned topic once for the new connection.
    // A canceled recovery waiter must not replay a second copy afterward.
    const reconnectCalls = transport.subscribeCalls.slice(callsBeforeReconnect);
    expect(reconnectCalls.filter(topic => topic === 'topic')).toHaveLength(1);
    expect(reconnectCalls.filter(topic => topic === 'topic-2')).toHaveLength(1);
    await bus.stop();
  });

  it('does not auto-reopen a cleanly disconnected transport', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'clean-disconnect' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'clean-disconnect',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 100 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // A clean close maps to `disconnected`, which is not a recoverable runtime
    // error: the bus must not schedule an automatic reopen for it.
    transport.setStatus('disconnected');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(transport.startCalls).toBe(1);
    expect(bus.getHealthSummary().status).toBe('disconnected');

    // Recovery remains explicit: the caller's next start() reopens.
    await bus.start({});
    expect(transport.startCalls).toBe(2);
    await bus.stop();
    vi.useRealTimers();
  });

  it('reopens a cleanly disconnected transport when an explicit operation demands it', async () => {
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'disconnect-demand'
    });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'disconnect-demand',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    // A clean close does not schedule background recovery, but the next
    // operation must not be written to the disconnected connection. It should
    // demand one reopen and flush only after the replacement is connected.
    transport.setStatus('disconnected');
    bus.publish('topic', 42);

    await vi.waitFor(() => expect(transport.startCalls).toBe(2));
    expect(transport.publishCalls).toEqual([{ topic: 'topic', data: 42 }]);
    await bus.stop();
  });

  it('parks every operation behind a demanded reopen instead of writing to the closed connection', async () => {
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'disconnect-demand-order'
    });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'disconnect-demand-order',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    transport.setStatus('disconnected');
    // The first operation starts the asynchronous reopen. The second arrives
    // before openTransport() can clear transportReady, so it must still be
    // parked behind that opening instead of being sent to the closed socket.
    bus.publish('topic', 1);
    bus.publish('topic', 2);
    expect(transport.publishCalls).toEqual([]);

    await bus.ready();
    expect(transport.startCalls).toBe(2);
    expect(transport.publishCalls.map(call => call.data)).toEqual([1, 2]);
    await bus.stop();
  });

  it('keeps handing operations to a transport that resolves start() before reporting connected', async () => {
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'pre-connect-window'
    });
    // Worker-style backends resolve start() once the worker is spawned and
    // report the connection asynchronously, so a publish can arrive while the
    // live status is still the initial `disconnected`. That is "not connected
    // yet", not a lost connection, and must not trigger a redundant reopen.
    const published: Array<{ topic: string; data: unknown }> = [];
    let startCalls = 0;
    const workerStyle: DataBusTransport<object, number> = {
      start: () => {
        startCalls += 1;
      },
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      publish: (topic, data) => {
        published.push({ topic, data });
      },
      stop: () => undefined
    };
    const bus = new CrossTabDataBus({
      clusterKey: 'pre-connect-window',
      environment: environment.environment,
      initialConfig: {},
      transport: workerStyle
    });

    await bus.start({});
    await bus.ready();
    bus.publish('topic', 7);

    expect(published).toEqual([{ topic: 'topic', data: 7 }]);
    expect(startCalls).toBe(1);
    await bus.stop();
  });

  it('traces scheduled, failed, and successful transport recovery outcomes', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'recovery-trace' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'recovery-trace', environment: environment.environment, initialConfig: {}, transport,
      trace: { enabled: true, mode: 'events', sink: event => events.push(event) }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(events).toContainEqual(expect.objectContaining({ type: 'reliability', operation: 'transport_recovery', outcome: 'scheduled' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'reliability', operation: 'transport_recovery', outcome: 'failed' }));
    transport.startShouldFail = false;
    bus.subscribe('topic-2', vi.fn());
    await bus.ready();
    expect(events).toContainEqual(expect.objectContaining({ type: 'reliability', operation: 'transport_recovery', outcome: 'succeeded' }));
    await bus.stop();
  });

  it('emits a coordination trace event with formatted workers and routes', async () => {
    const events: unknown[] = [];
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), hub: new ChannelHub(), now: () => Date.now(), randomId: 'coord-trace' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'coord-trace',
      environment: environment.environment,
      initialConfig: {},
      transport,
      trace: { enabled: true, mode: 'events', sink: event => events.push(event) }
    });
    bus.subscribe('t', () => {});
    await bus.ready();

    const coords = events.filter(event => (event as { type?: string }).type === 'coordination') as Array<Record<string, unknown>>;
    const withRoute = coords.find(coord => (coord.routes as unknown[]).length > 0);
    expect(withRoute).toBeTruthy();
    expect(typeof withRoute!.coordinated).toBe('boolean');
    expect((withRoute!.workers as unknown[]).length).toBeGreaterThan(0);
    // Routes are formatted by formatRouteTrace as topicKey@workerId|confirmed=…
    const routes = withRoute!.routes as string[];
    expect(routes[0]).toMatch(/^[0-9a-f]{32}@worker-.+\|confirmed=(true|false)$/);
    await bus.stop();
  });

  it('keeps message payloads and error bodies out of trace events, and names the event that carries a topic', async () => {
    // Two shipped documents make opposite promises about this surface: `docs/api.md`
    // says no public event contains a raw topic, a payload, or an error body, while
    // `docs/configuration.md` says subscription events carry their topic so an
    // integrator can correlate ownership changes — and tells the integrator to
    // redact topic names before shipping a sink to telemetry. The code is with
    // `configuration.md`, so this test pins both halves: the strings that must never
    // appear, and the one event type allowed to name a topic.
    const topic = 'trace.redaction.channel';
    const payloadMarker = 'payload-must-not-reach-the-sink';
    const errorMarker = 'error-body-must-not-reach-the-sink';
    const events: DataBusTraceEvent[] = [];
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      hub: new ChannelHub(),
      now: () => Date.now(),
      randomId: 'trace-redaction'
    });
    const transport = new FakeTransport<string>();
    const bus = new CrossTabDataBus<object, string>({
      clusterKey: 'trace-redaction',
      environment: environment.environment,
      initialConfig: {},
      transport,
      trace: { enabled: true, mode: 'all', metricsIntervalMs: 1_000, sink: event => events.push(event) }
    });
    const delivered: string[] = [];
    bus.subscribe(topic, message => {
      delivered.push(message.data);
    });
    bus.onError(() => {});
    await bus.ready();

    transport.emit(topic, payloadMarker);
    transport.emitError(new Error(errorMarker));
    await Promise.resolve();
    await Promise.resolve();
    // The payload really did travel through the instrumented path, so the absence
    // assertion below is about the events and not about a message that never arrived.
    expect(delivered).toEqual([payloadMarker]);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(payloadMarker);
    expect(serialized).not.toContain(errorMarker);
    const namingTheTopic = [
      ...new Set(events.filter(event => JSON.stringify(event).includes(topic)).map(event => event.type))
    ].sort();
    // Measured, and the reason this assertion exists rather than a sentence in a doc:
    // exactly two event types name a topic. `subscription` reports the transition,
    // and `reliability` names the route it is about (`route_ack` here; the
    // `route_migration` and recovery variants are pinned in the test above). Every
    // other event the sink sees is topic-free, and `coordination` describes routes
    // under the opaque key instead.
    expect(namingTheTopic).toEqual(['reliability', 'subscription']);
    // Ownership is reported under the opaque key: this is the event that would carry
    // a route, and it carries the hash instead of the name.
    const coordination = events.find(event => event.type === 'coordination') as { routes: string[] } | undefined;
    expect(coordination).toBeTruthy();
    expect(coordination!.routes.join(',')).toContain(createOpaqueKey(topic));
    await bus.stop();
  });

  it('numbers consecutive failed recovery attempts and resets after success', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => Date.now(), randomId: 'recovery-attempts' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'recovery-attempts', environment: environment.environment, initialConfig: {}, transport,
      trace: { enabled: true, mode: 'events', sink: event => events.push(event) }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(1_500);
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(1_500);
    const failed = events.filter((event): event is { outcome: string; attempt: number } =>
      typeof event === 'object' && event !== null && 'outcome' in event && 'attempt' in event && (event as { outcome: string }).outcome === 'failed');
    expect(failed.map(event => event.attempt).slice(0, 2)).toEqual([1, 2]);
    transport.startShouldFail = false;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(1_500);
    const succeeded = events.filter((event): event is { outcome: string; attempt: number } =>
      typeof event === 'object' && event !== null && 'outcome' in event && 'attempt' in event && (event as { outcome: string }).outcome === 'succeeded');
    expect(succeeded.at(-1)?.attempt).toBeGreaterThanOrEqual(3);
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(1_500);
    const scheduled = events.filter((event): event is { outcome: string; attempt: number } =>
      typeof event === 'object' && event !== null && 'outcome' in event && 'attempt' in event && (event as { outcome: string }).outcome === 'scheduled');
    expect(scheduled.at(-1)?.attempt).toBe(1);
    await bus.stop();
  });

  it('honours a custom recovery cooldown and validates it', async () => {
    expect(() => new CrossTabDataBus({ clusterKey: 'bad-recovery', transport: new FakeTransport(), recovery: { cooldownMs: 0 } })).toThrow('recovery.cooldownMs');
    vi.useFakeTimers();
    let now = 1_000;
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => now, randomId: 'custom-recovery' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'custom-recovery', environment: environment.environment, initialConfig: {}, transport, recovery: { cooldownMs: 250 } });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(249);
    expect(transport.startCalls).toBe(1);
    now += 249;
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.startCalls).toBe(2);
    await bus.stop();
  });

  it('caps automatic recovery attempts while keeping explicit retry available', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'recovery-cap' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'recovery-cap', environment: environment.environment, initialConfig: {}, transport, recovery: { cooldownMs: 250, maxAttempts: 2 }, trace: { enabled: true, mode: 'events', sink: event => events.push(event) } });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.startShouldFail = true;
    for (let i = 0; i < 3; i += 1) {
      transport.setStatus('error');
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(transport.startCalls).toBe(3);
    expect(events).toContainEqual(expect.objectContaining({ type: 'reliability', operation: 'transport_recovery', outcome: 'exhausted' }));
    expect(events.filter(event => typeof event === 'object' && event !== null && 'outcome' in event && (event as { outcome?: string }).outcome === 'exhausted')).toHaveLength(1);
    // A second report must not follow. Feeding it another `setStatus('error')`
    // looks like it re-enters and does not: once the last reopen has failed, the
    // handlers installed on the transport belong to a superseded lifecycle, so
    // `isCurrentLifecycle()` drops the status before the attempt counter is
    // reached — measured, `updateStatus` ran 0 times for such a call. The one
    // caller that can put a live closure back on a spent sequence is an
    // application retry, which takes the demand path and reopens. Keep that
    // reopen failing and `recoveryExhausted` is still set when the new status
    // arrives, because the only reset on this path sits in the success arm.
    bus.publish('topic', 99);
    await vi.advanceTimersByTimeAsync(250);
    // 4 rather than an exact count: the retry reopens once, and a reopen that
    // fails while operations are parked on the gate runs one more on demand.
    expect(transport.startCalls).toBeGreaterThanOrEqual(4);
    expect(events.filter(event => typeof event === 'object' && event !== null && 'outcome' in event && (event as { outcome?: string }).outcome === 'exhausted')).toHaveLength(1);
    transport.startShouldFail = false;
    const startsBeforeExplicitRetry = transport.startCalls;
    bus.subscribe('topic-2', vi.fn());
    await bus.ready();
    // The point of the cap is that it caps the *automatic* retries, not the
    // application's. Relative rather than absolute because the demand retry
    // above may itself reopen more than once.
    expect(transport.startCalls).toBe(startsBeforeExplicitRetry + 1);
    await bus.stop();
  });

  it('surfaces the recorded transport error from ready() once recovery is spent', async () => {
    // With no start in flight and the transport down, ready() has two possible
    // rejections: the real failure or a generic "not ready" string. The docs
    // promise callers can tell a transient retry from a dead transport, so the
    // recorded error must win.
    vi.useFakeTimers();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'ready-last-error'
    });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'ready-last-error',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 250, maxAttempts: 1 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.startShouldFail = true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      transport.setStatus('error');
      await vi.advanceTimersByTimeAsync(250);
    }
    const { errorMessage } = bus.getRecoveryStats();
    expect(errorMessage, 'the exhausted transport must carry a recorded failure').toBeTypeOf('string');
    expect(errorMessage).not.toContain('no start operation is in flight');

    await expectRejectionMessage(bus.ready(), errorMessage!);
    await bus.stop();
  });

  it('allows an explicit start() retry after automatic recovery is exhausted', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'recovery-explicit-start'
    });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'recovery-explicit-start',
      environment: environment.environment,
      transport,
      recovery: { cooldownMs: 250, maxAttempts: 1 }
    });

    await bus.start({});
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(250);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: false, state: 'degraded' });
    expect(transport.startCalls).toBe(2);

    transport.startShouldFail = false;
    await bus.start({});

    expect(transport.startCalls).toBe(3);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: true,
      state: 'healthy',
      lastFailure: null,
      recovery: { attempt: 0, exhausted: false, hasError: false, errorMessage: null, errorAt: null }
    });
    await bus.stop();
    vi.useRealTimers();
  });

  it('rejects invalid recovery attempt limits', () => {
    expect(() => new CrossTabDataBus({ clusterKey: 'bad-max', transport: new FakeTransport(), recovery: { maxAttempts: 0 } })).toThrow('recovery.maxAttempts');
    expect(() => new CrossTabDataBus({ clusterKey: 'bad-max-float', transport: new FakeTransport(), recovery: { maxAttempts: 1.5 } })).toThrow('recovery.maxAttempts');
  });

  it('rejects an empty topic at every public boundary without touching the lifecycle', async () => {
    // Deprecated in 0.20.96 with a warning, rejected from 0.21.0. Two things are
    // under test: each boundary throws, and it throws *before* any side effect —
    // an argument bug must not autostart a transport, register a handler, or
    // write a route record for a channel nothing can address.
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'empty-topic' });
    const transport = new FakeTransport<unknown>(undefined, { supportsPublishBatch: true });
    const bus = new CrossTabDataBus({
      clusterKey: 'empty-topic',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const handler = vi.fn();

    expect(() => bus.subscribe('', handler)).toThrow(TypeError);
    expect(() => bus.subscribe('', handler)).toThrow('CrossTabDataBus.subscribe("") addresses a channel no transport can route');
    expect(() => bus.publish('', { a: 1 })).toThrow('CrossTabDataBus.publish("")');
    // Each message names the operation the caller used: a single-item batch
    // delegates to publish(), so without its own guard it would be reported as
    // `publish("")`.
    expect(() => bus.publishBatch('', [{ data: { b: 2 } }])).toThrow('CrossTabDataBus.publishBatch("")');
    expect(() => bus.publishBatch('', [{ data: { b: 2 } }, { data: { c: 3 } }])).toThrow('CrossTabDataBus.publishBatch("")');

    expect(transport.startCalls).toBe(0);
    expect(transport.subscribeCalls).toEqual([]);
    expect(transport.publishCalls).toEqual([]);
    expect(transport.publishBatchCalls).toEqual([]);
    expect(bus.getHealthSummary().state).not.toBe('connected');

    // A real topic is unaffected, including through the same code paths.
    await bus.ready();
    bus.subscribe('real.topic', handler);
    bus.publish('real.topic', { a: 1 });
    bus.publishBatch('real.topic', [{ data: { b: 2 } }, { data: { c: 3 } }]);
    await Promise.resolve();
    expect(transport.subscribeCalls).toEqual(['real.topic']);
    expect(transport.publishCalls.map(call => call.topic)).toEqual(['real.topic']);
    expect(transport.publishBatchCalls.map(call => call.topic)).toEqual(['real.topic']);
    expect(handler).not.toHaveBeenCalled();
    await bus.stop();
  });

  it('validates the batch topic ahead of the empty-array no-op', () => {
    // `publishBatch(topic, [])` is documented to do nothing, and this is the only
    // probe that distinguishes a guard placed before that return from one placed
    // after it: with the guard moved down, every other empty-topic batch call
    // still throws through publish()'s own check, because a non-empty batch
    // funnels through publish() item by item.
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'empty-batch' });
    const transport = new FakeTransport<unknown>(undefined, { supportsPublishBatch: true });
    const bus = new CrossTabDataBus({
      clusterKey: 'empty-batch',
      environment: environment.environment,
      initialConfig: {},
      transport
    });

    expect(() => bus.publishBatch('', [])).toThrow('CrossTabDataBus.publishBatch("")');
    expect(transport.startCalls).toBe(0);
    expect(transport.publishBatchCalls).toEqual([]);
  });

  it('resets recovery diagnostics after an explicit stop and restart', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'recovery-reset' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'recovery-reset', environment: environment.environment, initialConfig: {}, transport, recovery: { cooldownMs: 100, maxAttempts: 1 }, trace: { enabled: true, mode: 'events', sink: event => events.push(event) } });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(100);
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(100);
    await bus.stop();
    transport.startShouldFail = false;
    await bus.start({});
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(100);
    const scheduled = events.filter(event => typeof event === 'object' && event !== null && 'outcome' in event && (event as { outcome?: string }).outcome === 'scheduled') as Array<{ attempt: number }>;
    expect(scheduled.at(-1)?.attempt).toBe(1);
    await bus.stop();
  });

  it('exposes the current recovery error state and configured attempt limit', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'recovery-stats' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'recovery-stats', environment: environment.environment, initialConfig: {}, transport,
      recovery: { cooldownMs: 100, maxAttempts: 2 }
    });
    expect(bus.getRecoveryStats()).toEqual({ attempt: 0, exhausted: false, maxAttempts: 2, hasError: false, errorMessage: null, errorAt: null, generation: 0, lastSuccessAt: null });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    transport.startShouldFail = true;
    transport.setStatus('error');
    expect(bus.getRecoveryStats()).toMatchObject({ attempt: 1, exhausted: false, maxAttempts: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(bus.getRecoveryStats()).toMatchObject({ attempt: 2, exhausted: false, maxAttempts: 2, hasError: true, errorMessage: expect.any(String) });
    transport.startShouldFail = false;
    bus.subscribe('topic-2', vi.fn());
    await bus.ready();
    expect(bus.getRecoveryStats()).toMatchObject({ attempt: 0, exhausted: false, maxAttempts: 2, hasError: true, errorMessage: 'Transport failed during startup.', errorAt: expect.any(Number), generation: expect.any(Number), lastSuccessAt: expect.any(Number) });
    await bus.stop();
  });

  it('records a runtime transport onError in the recovery ledger, not just lastFailure', async () => {
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'runtime-error-ledger' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'runtime-error-ledger', environment: environment.environment, initialConfig: {}, transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: true,
      lastFailure: null,
      recovery: { hasError: false, errorMessage: null, errorAt: null }
    });

    // A failure surfaced by the transport *after* a successful open used to
    // land only in lastFailure, so the same health snapshot reported a
    // retained transport error while recovery claimed hasError: false.
    transport.emitError(new Error('socket died mid-stream'));
    expect(bus.getRecoveryStats()).toMatchObject({
      hasError: true,
      errorMessage: 'socket died mid-stream',
      errorAt: expect.any(Number)
    });
    expect(bus.getHealthSummary()).toMatchObject({
      lastFailure: { source: 'transport', message: 'socket died mid-stream', at: expect.any(Number) },
      recovery: { hasError: true, errorMessage: 'socket died mid-stream', errorAt: expect.any(Number) }
    });
    await bus.stop();
  });

  it('renders a non-Error transport failure as a message in both ledgers', async () => {
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'non-error-ledger' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'non-error-ledger', environment: environment.environment, initialConfig: {}, transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // A Worker or a hand-written transport is allowed to report a bare string,
    // and both ledgers render it through `String(error)` rather than reading
    // `.message` off it. Rendering through `.message` does not throw — it yields
    // `undefined`, which then survives into `lastFailure.message` as the absence
    // of any explanation, so the diagnostics are the assertion here.
    transport.emitError('backend said no');
    expect(bus.getRecoveryStats()).toMatchObject({
      hasError: true,
      errorMessage: 'backend said no',
      errorAt: expect.any(Number)
    });
    expect(bus.getHealthSummary()).toMatchObject({
      lastFailure: { source: 'transport', message: 'backend said no', at: expect.any(Number) },
      recovery: { hasError: true, errorMessage: 'backend said no', errorAt: expect.any(Number) }
    });
    await bus.stop();
  });

  it('records a failure that has no primitive conversion without throwing from the ledger', async () => {
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'unstringifiable-ledger' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'unstringifiable-ledger', environment: environment.environment, initialConfig: {}, transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    // `Object.create(null)` has no `toString` and no `Symbol.toPrimitive`, so
    // `String(reason)` throws `TypeError: Cannot convert object to primitive
    // value`. A transport may reject with any value, so the failure-recording
    // path has to be total: a throw from *reporting* turns one transport failure
    // into two, escapes synchronously through the transport's `onError` callback
    // into whatever the transport was doing, and leaves `lastFailure` unset so
    // the next health snapshot has nothing to explain the outage with.
    const reason = Object.create(null);
    expect(() => transport.emitError(reason)).not.toThrow();

    // Both read sides render the same ledger, so both must survive the value too.
    expect(() => bus.getRecoveryStats()).not.toThrow();
    expect(() => bus.getHealthSummary()).not.toThrow();
    expect(bus.getRecoveryStats()).toMatchObject({ hasError: true, errorAt: expect.any(Number) });
    expect(typeof bus.getRecoveryStats().errorMessage).toBe('string');
    expect(bus.getHealthSummary().lastFailure).toMatchObject({
      source: 'transport', message: expect.any(String)
    });
    // Two ledgers, one rendering: a support bundle that reads both must not see
    // the same failure described two different ways.
    expect(bus.getRecoveryStats().errorMessage).toBe(bus.getHealthSummary().lastFailure?.message);
    await bus.stop();
  });

  it('settles stop() when the teardown failure cannot be reported either', async () => {
    // `createStopPromise()` chains the public gate to performStop() with
    // `.then(onFulfilled, onRejected)`, and *both* handlers resolve the gate.
    // performStop() was believed never to reject — its catch reports the failure
    // and its finally completes the teardown — so the rejection arm had never
    // run in any test. It can reject: the catch calls reportError(), which runs
    // the error subscribers through invokeHandlers(), and a throwing subscriber
    // is absorbed only by logging to console.warn. A console.warn that throws
    // therefore escapes the catch and rejects the teardown.
    //
    // The consequence of that arm missing is not a wrong value but a hang:
    // resolveGate() is the only thing that settles `await bus.stop()` on this
    // path, and the transport stop is already done, so nothing else can wake
    // the caller. The race below turns that into an assertion instead of a
    // test timeout; verified by deleting resolveGate() from the arm, which makes
    // it read 'hung'.
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'unreportable-stop' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'unreportable-stop', environment: environment.environment, transport
    });
    await bus.start({});
    bus.onError(() => {
      throw new Error('error subscriber exploded');
    });

    const warn = console.warn;
    console.warn = () => {
      throw new Error('the logging shim failed too');
    };
    transport.stopShouldFail = true;
    try {
      expect(await Promise.race([
        bus.stop().then(() => 'settled'),
        new Promise<string>(resolve => setTimeout(() => resolve('hung'), 250))
      ])).toBe('settled');
    } finally {
      console.warn = warn;
    }

    // The transport failure still reached both ledgers, because recordError()
    // runs before notifyError() and only the notification blew up. A caller
    // that survives the hang must still be able to explain it.
    expect(bus.getRecoveryStats()).toMatchObject({ hasError: true });
    expect(bus.getRecoveryStats().errorMessage).toBe('transport stop failed');
    expect(bus.getHealthSummary().lastFailure).toMatchObject({
      source: 'transport', message: 'transport stop failed'
    });

    // And the bus is restartable: the rejection arm cleared the gate field and
    // the finally completed the teardown, so a later open is a fresh operation
    // rather than a stale lifecycle.
    transport.stopShouldFail = false;
    await expect(bus.start({})).resolves.toBeUndefined();
    expect(transport.startCalls).toBe(2);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy' });
    await bus.stop();
  });

  it('keeps a throwing error subscriber from escaping when there is nowhere to log', async () => {
    // The leg above survives a throwing subscriber only because
    // `invokeHandlers()` absorbs it by writing to `console.warn`, and that write
    // is guarded by `typeof console.warn === 'function'`. With no console method
    // to fall back on, an unguarded call would raise a `TypeError` from inside
    // the handler that was meant to contain the failure — out through
    // `reportError()`, out of the dispatch loop, and into the transport's
    // message callback as a second, unrelated error.
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'no-console-warn' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'no-console-warn', environment: environment.environment, initialConfig: {}, transport
    });
    bus.subscribe('topic', () => {
      throw new Error('handler exploded');
    });
    bus.onError(() => {
      throw new Error('error subscriber exploded');
    });
    await bus.ready();
    // A console object with no `warn` at all: the first conjunct of the guard
    // still passes, so this is the arm that decides whether the failure stays
    // contained.
    vi.stubGlobal('console', { log: () => {}, error: () => {} });
    try {
      expect(() => transport.emit('topic', 1)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    // Contained, and still recorded: the dispatch failure reaches the unified
    // ledger with its own message rather than the formatter's.
    expect(bus.getHealthSummary().lastFailure).toMatchObject({
      source: 'dispatch', message: 'handler exploded'
    });
    await bus.stop();
  });

  it('ignores a control frame whose action the cluster does not recognise', async () => {
    // The cluster channel is unauthenticated: any same-origin script or tab can
    // post into it, and `handleControlMessage` forwards `message.action` to the
    // DataBus switch without validating it against the union — its own `default`
    // arm falls through to the same `onControl` call, then runs load accounting
    // because the action is not PUBLISH. So the switch's `default: break` is the
    // only thing between a newer or hostile peer and an unknown verb being acted
    // upon as if it were one of the three known ones.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const environment = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'unknown-action' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'unknown-action', environment: environment.environment, initialConfig: {}, transport
    });
    const handler = vi.fn();
    bus.subscribe('topic', handler);
    await bus.ready();

    const workers = bus.getClusterSnapshot().workers;
    expect(workers).toHaveLength(1);
    const self = workers[0]?.workerId;
    expect(typeof self).toBe('string');

    const subscribeCalls = [...transport.subscribeCalls];
    const unsubscribeCalls = [...transport.unsubscribeCalls];
    const publishCalls = [...transport.publishCalls];

    const channel = hub.create(`${DEFAULT_STORAGE_PREFIX}:bus:${createOpaqueKey('unknown-action')}`);
    channel.postMessage({
      type: CLUSTER_MESSAGE_TYPE.CONTROL,
      sourceWorkerId: 'hostile-peer',
      targetWorkerId: self,
      action: 'DESTROY' as never,
      topic: 'topic',
      topicKey: createOpaqueKey('topic')
    } as unknown as WorkerClusterMessage);
    channel.close();
    await flushMicrotasks();

    expect(handler).not.toHaveBeenCalled();
    expect(transport.subscribeCalls).toEqual(subscribeCalls);
    expect(transport.unsubscribeCalls).toEqual(unsubscribeCalls);
    expect(transport.publishCalls).toEqual(publishCalls);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy' });
    await bus.stop();
  });

  it('opens the transport on a retry when the failed open stop also failed unrecordably', async () => {
    // `start()` chains the new open behind `pendingStop` with no `.catch`, on the
    // documented premise that every `pendingStop` ends in a terminal
    // `.catch(error => this.reportError(error))` and therefore resolves. A stop
    // rejecting with a value that `reportError` cannot stringify breaks that
    // premise: the handler's own throw makes `pendingStop` reject, the chained
    // `.then()` is skipped so `transport.start()` is never reached, and the retry
    // comes back as `TypeError: Cannot convert object to primitive value` — a
    // message about the formatter's limits rather than about the transport.
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'unrecordable-stop' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'unrecordable-stop', environment: environment.environment, transport
    });
    transport.startShouldFail = true;
    transport.stopShouldFail = true;
    transport.stopRejection = Object.create(null);
    await expect(bus.start({})).rejects.toThrow(/failed during startup/i);
    expect(transport.startCalls).toBe(1);
    expect(transport.stopCalls).toBe(1);

    transport.startShouldFail = false;
    transport.stopShouldFail = false;
    await expect(bus.start({})).resolves.toBeUndefined();
    expect(transport.startCalls).toBe(2);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy' });
    await bus.stop();
  });

  it('keeps non-transport failures out of the transport recovery ledger', async () => {
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'dispatch-error-ledger' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'dispatch-error-ledger', environment: environment.environment, initialConfig: {}, transport
    });
    // The handler throws while dispatching a publication, which is reported as
    // a dispatch failure. That must stay visible through lastFailure without
    // pretending the transport recovery ledger has an error to explain.
    transport.subscribe('topic');
    bus.subscribe('topic', () => { throw new Error('handler exploded'); });
    await bus.ready();
    transport.emit('topic', 1);
    expect(bus.getHealthSummary()).toMatchObject({
      lastFailure: { source: 'dispatch', message: 'handler exploded', at: expect.any(Number) },
      recovery: { hasError: false, errorMessage: null, errorAt: null }
    });
    await bus.stop();
  });

  it('clears the ready flag before reporting a failed recovery open', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'failed-reopen-ready' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'failed-reopen-ready', environment: environment.environment, initialConfig: {}, transport,
      recovery: { cooldownMs: 100, maxAttempts: 1 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(bus.getHealthSummary()).toMatchObject({ state: 'healthy', transport: { ready: true } });

    const snapshots: Array<ReturnType<typeof bus.getHealthSummary>> = [];
    bus.onError(() => snapshots.push(bus.getHealthSummary()));

    // The live transport dies, then the automatic recovery open fails. The
    // error callback must observe the failed open — not the `ready` flag left
    // over from the transport instance the recovery replaced.
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0]).toMatchObject({
      transport: { ready: false },
      recovery: { hasError: true }
    });
    await bus.stop();
  });

  it('surfaces the last transport error from ready() after automatic recovery fails', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'ready-failed-recovery' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'ready-failed-recovery',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 100, maxAttempts: 1 }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();

    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(100);

    expect(bus.getHealthSummary()).toMatchObject({
      started: true,
      transport: { ready: false },
      recovery: { hasError: true, errorMessage: 'Transport failed during startup.' }
    });
    // No open is in flight, but the retained transport error is actionable.
    // ready() must not hide it behind a generic "no start operation" message.
    await expect(bus.ready()).rejects.toThrow('Transport failed during startup.');
    await bus.stop();
  });

  it('stamps one failed open once across both failure ledgers', async () => {
    // A clock that advances on every read exposes any path that samples `now()`
    // twice for a single failure. `getRecoveryStats().errorAt` and
    // `getHealthSummary().lastFailure.at` describe the same failure and must
    // agree.
    let clock = 5_000;
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'single-failure-stamp' });
    const transport = new FakeTransport<number>();
    transport.startShouldFail = true;
    const bus = new CrossTabDataBus({
      clusterKey: 'single-failure-stamp', environment: environment.environment, transport,
      dedup: { now: () => clock++ }
    });
    await expect(bus.start({})).rejects.toThrow('Transport failed during startup.');
    const recovery = bus.getRecoveryStats();
    expect(recovery.errorAt).toBe(bus.getHealthSummary().lastFailure?.at);
    await bus.stop();
  });

  it('exposes generation and lastSuccessAt that increment on each successful open', async () => {
    vi.useFakeTimers();
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'recovery-gen' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'recovery-gen', environment: environment.environment, initialConfig: {}, transport,
      recovery: { cooldownMs: 100, maxAttempts: 3 }
    });
    expect(bus.getRecoveryStats()).toMatchObject({ generation: 0, lastSuccessAt: null });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    const first = bus.getRecoveryStats();
    expect(first.generation).toBe(1);
    expect(first.lastSuccessAt).toBeTypeOf('number');
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(bus.getRecoveryStats().generation).toBe(1);
    transport.startShouldFail = false;
    bus.subscribe('topic-2', vi.fn());
    await bus.ready();
    const second = bus.getRecoveryStats();
    expect(second.generation).toBe(2);
    expect(second.lastSuccessAt).not.toBe(first.lastSuccessAt);
    await bus.stop();
  });

    it('reopens transport on subscribe when resume failed and transport is down', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'resume-fail' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'resume-fail-reopen',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    // Make the transport fail on start, then trigger an error → auto-recovery
    // will attempt to reopen and fail.
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(1_500);
    // Recovery failed — transport is down
    expect(transport.startCalls).toBe(2);

    // Now make the next start succeed. The transport is down (started=true,
    // transportReady=false, startPromise=null). A new subscribe should trigger
    // reopenTransport automatically.
    transport.startShouldFail = false;
    bus.subscribe('topic2', vi.fn());
    await bus.ready();
    // The transport should have been reopened and the new subscription sent
    expect(transport.startCalls).toBe(3);
    expect(transport.subscribeCalls).toContain('topic2');
    await bus.stop();
  });

  it('opens only one transport when retrying a failed start with existing subscriptions', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'retry' });
    let releaseStart!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const transport = new FakeTransport<number>(startGate);
    transport.startShouldFail = true;
    const bus = new CrossTabDataBus({
      clusterKey: 'retry-start',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());

    releaseStart();
    await expect(bus.ready()).rejects.toThrow('Transport failed during startup');
    expect(transport.startCalls).toBe(1);

    transport.startShouldFail = false;
    await expect(bus.start({})).resolves.toBeUndefined();
    expect(transport.startCalls).toBe(2);
    expect(transport.subscribeCalls).toEqual(['topic']);
    await bus.stop();
  });

  it('starts a fresh lifecycle when start() retries from the failure onError callback', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'onerror-retry' });
    const transport = new FakeTransport<number>();
    transport.startShouldFail = true;
    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'onerror-retry',
      environment: environment.environment,
      initialConfig: {},
      transport
    });

    let retry: Promise<void> | null = null;
    bus.onError(() => {
      if (retry) return;
      transport.startShouldFail = false;
      retry = bus.start({});
    });
    bus.subscribe('topic', vi.fn());

    await expect(bus.ready()).rejects.toThrow('Transport failed during startup.');
    expect(retry).not.toBeNull();
    // The retry must not overlap the failed open's transport.stop() cleanup.
    expect(transport.startCalls).toBe(1);

    releaseStop();
    await retry;
    expect(transport.startCalls).toBe(2);
    await expect(bus.ready()).resolves.toBeUndefined();
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: true,
      started: true,
      transport: { ready: true },
      recovery: { hasError: false },
      lastFailure: null
    });
    await bus.stop();
  });

  it('starts a fresh lifecycle when start() retries from the failure onStatus callback', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'onstatus-retry' });
    const transport = new FakeTransport<number>();
    transport.startShouldFail = true;
    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'onstatus-retry',
      environment: environment.environment,
      initialConfig: {},
      transport
    });

    let retry: Promise<void> | null = null;
    bus.onStatus(status => {
      if (status !== WORKER_STATUS.ERROR || retry) return;
      transport.startShouldFail = false;
      retry = bus.start({});
    });
    bus.subscribe('topic', vi.fn());

    await expect(bus.ready()).rejects.toThrow('Transport failed during startup.');
    expect(retry).not.toBeNull();
    // The retry must not overlap the failed open's transport.stop() cleanup.
    expect(transport.startCalls).toBe(1);

    releaseStop();
    await retry;
    expect(transport.startCalls).toBe(2);
    await expect(bus.ready()).resolves.toBeUndefined();
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: true,
      started: true,
      transport: { ready: true },
      recovery: { hasError: false },
      lastFailure: null
    });
    await bus.stop();
  });

  it('does not deliver transport operations while suspended during an async start', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'suspend-async' });
    let releaseStart!: () => void;
    let releaseStop!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const transport = new FakeTransport<number>(startGate);
    transport.stopGate = stopGate;
    const bus = new CrossTabDataBus({
      clusterKey: 'suspend-async',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());

    environment.pageHide();
    releaseStart();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    bus.publish('topic', 1);
    await Promise.resolve();
    expect(transport.publishCalls).toEqual([]);

    releaseStop();
    // The suspension stop gate proves cleanup finished, not that the transport
    // can carry data, so ready() must not report the hidden bus as usable.
    await expect(bus.ready()).rejects.toThrow(/suspended/i);
    expect(transport.publishCalls).toEqual([]);
    await bus.stop();
  });

  it('explicit start() reopens after an in-flight suspend stop settles', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'start-during-suspend' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'start-during-suspend',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });

    environment.pageHide();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    const restarting = bus.start({});
    await Promise.resolve();
    expect(transport.startCalls).toBe(1);

    releaseStop();
    await restarting;
    expect(transport.startCalls).toBe(2);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy', suspended: false });
    await bus.stop();
  });

  it('lets start() from the suspend status callback supersede the pending hide', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reentrant-suspend-start' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'reentrant-suspend-start',
      environment: environment.environment,
      initialConfig: {},
      transport
    });

    let restart: Promise<void> | null = null;
    bus.onStatus(status => {
      if (status === WORKER_STATUS.DISCONNECTED && restart === null) restart = bus.start({});
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    // The pagehide path publishes DISCONNECTED synchronously before it chains
    // its transport stop. A status handler may use public start() as the
    // documented resume path; that newer intent must prevent the stale hide
    // continuation from stopping the replacement transport after it opens.
    environment.pageHide();
    expect(restart).not.toBeNull();
    await restart;
    // Let the stale suspend continuation run. Awaiting openTransport's promise
    // alone can resume before its chained stop callback executes.
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.startCalls).toBe(2);
    expect(transport.stopCalls).toBe(0);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: true,
      state: 'healthy',
      started: true,
      suspended: false,
      transport: { ready: true, status: WORKER_STATUS.CONNECTED }
    });

    await bus.stop();
  });

  it('explicit start() waits for an in-flight stop() and restarts', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'start-during-stop' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'start-during-stop',
      environment: environment.environment,
      transport
    });
    await bus.start({});
    expect(transport.startCalls).toBe(1);

    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });

    const stopping = bus.stop();
    expect(bus.stop()).toBe(stopping);
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    const restarting = bus.start({});
    expect(bus.start({})).toBe(restarting);
    const readiness = bus.ready();
    await Promise.resolve();
    expect(transport.startCalls).toBe(1);

    releaseStop();
    await stopping;
    await restarting;
    await readiness;
    expect(transport.startCalls).toBe(2);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy', suspended: false });
    await bus.stop();
  });

  it('keeps a queued restart suspended when pagehide lands during async stop cleanup', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({
      storage,
      now: () => 1_000,
      randomId: 'queued-restart-pagehide'
    });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'queued-restart-pagehide',
      environment: environment.environment,
      transport
    });
    await bus.start({});
    expect(transport.startCalls).toBe(1);

    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });

    const stopping = bus.stop();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));
    const restarting = bus.start({});

    // stop() removes the cluster's lifecycle listeners synchronously, but its
    // transport cleanup is still pending. The browser can enter BFCache in that
    // window; the queued restart must observe the hidden visibility instead of
    // reconnecting a background page.
    environment.setVisibility('hidden');
    environment.pageHide();

    releaseStop();
    await stopping;
    await restarting;

    expect(transport.startCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: false,
      state: 'suspended',
      started: true,
      suspended: true,
      transport: { ready: false, status: WORKER_STATUS.DISCONNECTED }
    });
    await expect(bus.ready()).rejects.toThrow(/suspended/i);

    environment.setVisibility('visible');
    environment.pageShow();
    await bus.ready();
    expect(transport.startCalls).toBe(2);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy', suspended: false });
    await bus.stop();
  });

  it('invalidates a canceled queued-start readiness gate for the replacement restart', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'queued-ready-cancel' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'queued-ready-cancel',
      environment: environment.environment,
      transport
    });
    await bus.start({});

    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const stopping = bus.stop();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    const canceledRestart = bus.start({});
    const canceledReady = bus.ready();
    expect(bus.ready()).toBe(canceledReady);
    const canceledReadyFailure = canceledReady.catch(error => error as Error);

    expect(bus.stop()).toBe(stopping);
    const finalRestart = bus.start({});
    const finalReady = bus.ready();
    expect(finalReady).not.toBe(canceledReady);

    releaseStop();
    await stopping;
    await canceledRestart;
    await finalRestart;
    await finalReady;
    await expect(canceledReadyFailure).resolves.toMatchObject({
      message: expect.stringMatching(/canceled by a later stop/i)
    });
    expect(transport.startCalls).toBe(2);
    await bus.stop();
  });

  it('rejects ready() when a queued restart is suspended before it becomes usable', async () => {
    let releaseStop!: () => void;
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    let releaseRestart!: () => void;
    const restartGate = new Promise<void>(resolve => {
      releaseRestart = resolve;
    });
    let startCalls = 0;
    let stopCalls = 0;
    const transport: DataBusTransport<object, number> = {
      start(_config, handlers) {
        startCalls += 1;
        if (startCalls === 1) {
          handlers.onStatus(WORKER_STATUS.CONNECTED);
          return;
        }
        return restartGate.then(() => handlers.onStatus(WORKER_STATUS.CONNECTED));
      },
      subscribe() {},
      unsubscribe() {},
      publish() {},
      stop() {
        stopCalls += 1;
        return stopCalls === 1 ? stopGate : undefined;
      }
    };
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'queued-restart-suspended'
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'queued-restart-suspended',
      environment: environment.environment,
      transport
    });
    await bus.start({});

    const stopping = bus.stop();
    await vi.waitFor(() => expect(stopCalls).toBe(1));
    const restarting = bus.start({});
    const readiness = bus.ready();
    const readinessFailure = readiness.catch(error => error as Error);

    releaseStop();
    await stopping;
    await vi.waitFor(() => expect(startCalls).toBe(2));

    // The queued restart owns a new lifecycle, then the tab hides before its
    // open settles. ready() must not report the restart as usable while the
    // replacement transport has already been stopped by suspension.
    environment.pageHide();
    releaseRestart();
    await restarting;
    await expect(readinessFailure).resolves.toMatchObject({
      message: expect.stringMatching(/without a ready transport/i)
    });
    expect(bus.getHealthSummary()).toMatchObject({
      started: true,
      suspended: true,
      transport: { ready: false }
    });
    await bus.stop();
  });

  it('cancels a queued restart when stop() arrives before it can run', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-cancels-queued-start' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-cancels-queued-start',
      environment: environment.environment,
      transport
    });
    await bus.start({});
    expect(transport.startCalls).toBe(1);

    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });

    const stopping = bus.stop();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    // A resume queues a fresh start behind the in-flight stop...
    const restarting = bus.start({});
    const readiness = bus.ready();
    await Promise.resolve();
    expect(transport.startCalls).toBe(1);

    // ...but a subsequent stop() is the latest lifecycle intent and must
    // cancel the queued restart instead of letting it reopen afterwards.
    const canceling = bus.stop();
    releaseStop();
    await stopping;
    await canceling;
    await restarting;
    await expect(readiness).rejects.toThrow(/canceled by a later stop/i);
    expect(transport.startCalls).toBe(1);
    expect(transport.stopCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({
      started: false,
      state: 'stopped',
      transport: { ready: false }
    });
  });

  it('lets a start() issued after a canceling stop() queue a fresh restart', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'restart-after-cancel' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'restart-after-cancel',
      environment: environment.environment,
      transport
    });
    await bus.start({});
    expect(transport.startCalls).toBe(1);

    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });

    const stopping = bus.stop();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    // stop -> start -> stop -> start: the final intent is to be running, so the
    // canceled queue slot must be reusable by the second start().
    const canceledRestart = bus.start({});
    expect(bus.stop()).toBe(stopping);
    const finalRestart = bus.start({});
    expect(finalRestart).not.toBe(canceledRestart);
    await Promise.resolve();
    expect(transport.startCalls).toBe(1);

    releaseStop();
    await stopping;
    await canceledRestart;
    await finalRestart;
    expect(transport.startCalls).toBe(2);
    expect(bus.getHealthSummary()).toMatchObject({ started: true, state: 'healthy', suspended: false });
    await bus.stop();
  });

  it('performs a fresh stop when the previous stop gate is settled but not yet cleared', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stale-stop-gate' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'stale-stop-gate',
      environment: environment.environment,
      transport
    });
    await bus.start({});
    expect(transport.startCalls).toBe(1);

    const firstStop = bus.stop();
    // Two microtask turns: performStop() finishes its teardown (stopping === false)
    // while the settlement handler that clears stopPromise has not run yet.
    await Promise.resolve();
    await Promise.resolve();

    // start() reopens the transport while the previous stop gate is still
    // retained; the following stop() must not reuse that settled gate.
    const restarted = bus.start({});
    const secondStop = bus.stop();
    await secondStop;
    await Promise.resolve();
    await restarted;

    expect(bus.getHealthSummary()).toMatchObject({
      started: false,
      state: 'stopped',
      transport: { ready: false }
    });
    expect(transport.stopCalls).toBe(2);
    await Promise.allSettled([firstStop]);
  });

  it('shares one teardown when stop() is re-entered from a trace sink', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reentrant-stop' });
    const transport = new FakeTransport<number>();
    let nestedStop: Promise<void> | undefined;
    let stopSinkHits = 0;
    const bus = new CrossTabDataBus({
      clusterKey: 'reentrant-stop',
      environment: environment.environment,
      transport,
      trace: {
        enabled: true,
        sink: event => {
          if (
            event.type === TRACE_EVENT_TYPE.LIFECYCLE &&
            event.action === TRACE_LIFECYCLE_ACTION.STOP
          ) {
            stopSinkHits += 1;
            // The STOP lifecycle event is emitted synchronously from stop();
            // a re-entrant stop() must not kick off a second teardown.
            if (stopSinkHits === 1) nestedStop = bus.stop();
          }
        }
      }
    });
    await bus.start({});
    expect(transport.startCalls).toBe(1);

    const stopping = bus.stop();
    expect(nestedStop).toBe(stopping);
    await stopping;
    await Promise.resolve();

    expect(stopSinkHits).toBe(1);
    expect(transport.stopCalls).toBe(1);
    expect(bus.getStatus()).toBe(WORKER_STATUS.DISCONNECTED);
    expect(bus.getHealthSummary()).toMatchObject({
      started: false,
      state: 'stopped',
      suspended: false,
      transport: { ready: false }
    });
  });

  it('lets a stop() re-entered from the START trace own a fresh lifecycle', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reentrant-start' });
    const transport = new FakeTransport<number>();
    let nestedStop: Promise<void> | undefined;
    let startSinkHits = 0;
    const bus = new CrossTabDataBus({
      clusterKey: 'reentrant-start',
      environment: environment.environment,
      transport,
      trace: {
        enabled: true,
        sink: event => {
          if (
            event.type === TRACE_EVENT_TYPE.LIFECYCLE &&
            event.action === TRACE_LIFECYCLE_ACTION.START
          ) {
            startSinkHits += 1;
            // The START lifecycle event is emitted synchronously before the
            // transport opens. A stop() from the sink must supersede the whole
            // outer start without allowing it to reopen a stopped bus later.
            if (startSinkHits === 1) nestedStop = bus.stop();
          }
        }
      }
    });

    const starting = bus.start({});
    expect(nestedStop).toBeDefined();
    await Promise.all([starting, nestedStop!]);
    await Promise.resolve();

    expect(startSinkHits).toBe(1);
    expect(transport.startCalls).toBe(0);
    expect(transport.stopCalls).toBe(1);
    expect(bus.getStatus()).toBe(WORKER_STATUS.DISCONNECTED);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: false,
      state: 'stopped',
      started: false,
      suspended: false,
      transport: { ready: false, status: WORKER_STATUS.DISCONNECTED }
    });

    // The explicit stop must leave the bus reusable rather than stuck with a
    // half-open transport or a stale lifecycle gate.
    await bus.start({});
    await bus.ready();
    expect(transport.startCalls).toBe(1);
    await bus.stop();
  });

  it('lets a stop() from the CONNECTING status callback cancel the rest of start', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reentrant-connecting' });
    const transport = new FakeTransport<number>();
    let nestedStop: Promise<void> | undefined;
    let connectingHits = 0;
    const bus = new CrossTabDataBus<object, number>({
      clusterKey: 'reentrant-connecting',
      environment: environment.environment,
      transport
    });
    bus.onStatus(status => {
      if (status === WORKER_STATUS.CONNECTING) {
        connectingHits += 1;
        if (connectingHits === 1) nestedStop = bus.stop();
      }
    });

    const starting = bus.start({});
    expect(nestedStop).toBeDefined();
    await Promise.all([starting, nestedStop!]);
    await Promise.resolve();

    expect(connectingHits).toBe(1);
    expect(transport.startCalls).toBe(0);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: false,
      state: 'stopped',
      started: false,
      transport: { ready: false, status: WORKER_STATUS.DISCONNECTED }
    });

    await bus.start({});
    await bus.ready();
    expect(transport.startCalls).toBe(1);
    await bus.stop();
  });

  it('lets a stop() from the reconnect CONNECTING callback cancel the reopen', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reentrant-reopen' });
    const transport = new FakeTransport<number>();
    let nestedStop: Promise<void> | undefined;
    let reconnecting = false;
    let reconnectConnectingHits = 0;
    const bus = new CrossTabDataBus<object, number>({
      clusterKey: 'reentrant-reopen',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.onStatus(status => {
      if (!reconnecting || status !== WORKER_STATUS.CONNECTING) return;
      reconnectConnectingHits += 1;
      if (reconnectConnectingHits === 1) nestedStop = bus.stop();
    });

    await bus.ready();
    expect(transport.startCalls).toBe(1);

    transport.setStatus(WORKER_STATUS.ERROR);
    reconnecting = true;
    const reopening = bus.start({});
    expect(nestedStop).toBeDefined();
    await Promise.all([reopening, nestedStop!]);
    await Promise.resolve();

    expect(reconnectConnectingHits).toBe(1);
    expect(transport.startCalls).toBe(1);
    expect(transport.stopCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: false,
      state: 'stopped',
      started: false,
      suspended: false,
      transport: { ready: false, status: WORKER_STATUS.DISCONNECTED }
    });

    reconnecting = false;
    await bus.start({});
    await bus.ready();
    expect(transport.startCalls).toBe(2);
    await bus.stop();
  });

  it('drops the failure report of a reopen that a reentrant start has already replaced', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => Date.now(), randomId: 'superseded-reopen-failure' });
    const transport = new FakeTransport<number>();
    let errorHits = 0;
    const bus = new CrossTabDataBus({
      clusterKey: 'superseded-reopen-failure',
      environment: environment.environment,
      initialConfig: {},
      transport,
      trace: { enabled: true, mode: 'events', sink: event => events.push(event) }
    });
    // A failed reopen publishes ERROR from its own teardown, and that
    // notification runs before its rejection settles — so an application that
    // retries from the callback owns a newer lifecycle by the time
    // reopenTransport()'s rejection handler runs. The handler must then stay
    // silent: reporting `failed` for the attempt it replaced would put a
    // recovery failure *after* the start that superseded it, which is the one
    // ordering a reader of the trace cannot recover from. Hit #1 is the runtime
    // failure that arms recovery; hit #2 is the failing reopen's own teardown.
    bus.onStatus(status => {
      if (status !== WORKER_STATUS.ERROR) return;
      errorHits += 1;
      if (errorHits !== 2) return;
      transport.startShouldFail = false;
      void bus.start({}).catch(() => undefined);
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    transport.startShouldFail = true;
    transport.setStatus(WORKER_STATUS.ERROR);
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();

    expect(errorHits).toBeGreaterThanOrEqual(2);
    // 1 = the initial open, 2 = the reopen that failed, 3 = the reentrant start.
    expect(transport.startCalls).toBe(3);
    const reliability = events.filter((event): event is { outcome: string } =>
      typeof event === 'object' && event !== null && 'outcome' in event);
    expect(reliability.filter(event => event.outcome === 'failed')).toEqual([]);
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy' });
    await bus.stop();
  });

  it('does not report a healthy bus while an explicit stop is still tearing down', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stopping-health' });
    const transport = new FakeTransport<number>();
    let releaseStop!: () => void;
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'stopping-health',
      environment: environment.environment,
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    await bus.start({});
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy' });

    const stopping = bus.stop();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    // The transport still reports connected because stop() is async, but every
    // operation is already rejected during teardown: the health verdict must
    // not contradict that by claiming the bus is usable.
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: false,
      state: 'stopped',
      started: true,
      transport: { status: 'connected', ready: true }
    });
    bus.publish('topic', 1);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/is stopping; publish\(\) was not sent/);

    releaseStop();
    await stopping;
    expect(bus.getHealthSummary()).toMatchObject({ healthy: false, state: 'stopped', started: false });
  });

  it('reuses a failed-reopen stop gate when the tab hides before cleanup settles', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'failed-reopen-hide' });
    let releaseStop!: () => void;
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'failed-reopen-hide',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 100, maxAttempts: 1 }
    });
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    // The live transport dies, then the automatic recovery open fails. Unlike
    // an initial-start failure, this path is not inside performStop(), so a
    // pagehide can arrive while its cleanup stop is still pending.
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.startCalls).toBe(2);
    expect(transport.stopCalls).toBe(1);

    // The failed reopen already owns the asynchronous stop. Hiding here must
    // reuse that gate instead of chaining a second stop behind it; otherwise a
    // later pageshow can invoke transport.stop() again during replacement.
    environment.pageHide();
    transport.startShouldFail = false;
    environment.pageShow();
    releaseStop();
    await bus.ready();

    expect(transport.startCalls).toBe(3);
    expect(transport.stopCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: true,
      state: 'healthy',
      started: true,
      suspended: false,
      transport: { ready: true, status: 'connected' }
    });
    await bus.stop();
    vi.useRealTimers();
  });

  it('ignores a rejected superseded open without clobbering the replacement lifecycle', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'superseded-open-reject' });
    let rejectFirst!: (error: unknown) => void;
    let startCalls = 0;
    let stopCalls = 0;
    const transport: DataBusTransport<object, number> = {
      start(_config, handlers) {
        startCalls += 1;
        if (startCalls === 1) {
          return new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        handlers.onStatus(WORKER_STATUS.CONNECTED);
      },
      subscribe() {},
      unsubscribe() {},
      publish() {},
      stop() {
        stopCalls += 1;
      }
    };
    const bus = new CrossTabDataBus({
      clusterKey: 'superseded-open-reject',
      environment: environment.environment,
      transport
    });

    const firstOpen = bus.start({});
    const firstFailure = firstOpen.then(() => null, error => error);
    await vi.waitFor(() => expect(startCalls).toBe(1));

    // Supersede the first open while its start promise is still pending. The
    // stop gate is chained to that old promise; the resume opening is chained
    // to the stop. A late rejection from the old open must be swallowed by its
    // own lifecycle rather than tearing down the replacement.
    environment.pageHide();
    environment.pageShow();
    rejectFirst(new Error('superseded open failed'));

    expect(await firstFailure).toMatchObject({ message: 'superseded open failed' });
    await bus.ready();
    expect(startCalls).toBe(2);
    expect(stopCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({
      healthy: true,
      state: 'healthy',
      started: true,
      transport: { ready: true, status: 'connected' }
    });
    await bus.stop();
  });

  it('keeps a queued resume owned by the bus when a superseded initial open fails', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stale-open-resume' });
    let releaseStart!: () => void;
    let releaseStop!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const transport = new FakeTransport<number>(startGate);
    transport.startShouldFail = true;
    transport.stopGate = stopGate;
    const bus = new CrossTabDataBus({
      clusterKey: 'stale-open-resume',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await vi.waitFor(() => expect(transport.startCalls).toBe(1));

    // Queue a resume while the initial open is still pending, then let that
    // superseded open fail. The resume must remain part of the lifecycle.
    environment.pageHide();
    environment.pageShow();
    releaseStart();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));
    expect(transport.startCalls).toBe(1);

    const stopping = bus.stop();
    let settled = false;
    void stopping.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    transport.startShouldFail = false;
    releaseStop();
    await stopping;
    await Promise.resolve();
    expect(transport.startCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({
      started: false,
      state: 'stopped',
      transport: { ready: false }
    });
  });

  it('ends a page-hide/page-show round trip over a pending open with a ready transport', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'superseded-open-ready' });
    let releaseStart!: () => void;
    let releaseStop!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const transport = new FakeTransport<number>(startGate);
    transport.stopGate = stopGate;
    const bus = new CrossTabDataBus({
      clusterKey: 'superseded-open-ready',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await vi.waitFor(() => expect(transport.startCalls).toBe(1));

    // Hide and show while the first open is still pending. That pending open is
    // superseded: when it settles, its continuation must neither abort the
    // queued resume nor clear the ready state the resume establishes.
    environment.pageHide();
    environment.pageShow();
    releaseStart();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));
    releaseStop();
    await vi.waitFor(() => expect(transport.startCalls).toBe(2));
    await bus.ready();
    expect(bus.getHealthSummary()).toMatchObject({
      started: true,
      state: 'healthy',
      suspended: false,
      transport: { ready: true }
    });
    await bus.stop();
  });

  it('reopens after repeated hide/show cycles that all precede a pending initial open', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'repeated-suspend-open' });
    let releaseStart!: () => void;
    let releaseStop!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const transport = new FakeTransport<number>(startGate);
    transport.stopGate = stopGate;
    const bus = new CrossTabDataBus({
      clusterKey: 'repeated-suspend-open',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await vi.waitFor(() => expect(transport.startCalls).toBe(1));

    // Both pagehide/pageShow rounds happen while the initial open is pending.
    // The second pageShow must supersede the superseded resume opening rather
    // than returning its promise and leaving the bus suspended forever.
    environment.pageHide();
    environment.pageShow();
    environment.pageHide();
    environment.pageShow();

    releaseStart();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));
    releaseStop();
    await vi.waitFor(() => expect(transport.startCalls).toBe(2));
    await bus.ready();
    expect(bus.getHealthSummary()).toMatchObject({
      started: true,
      state: 'healthy',
      suspended: false,
      transport: { ready: true }
    });
    await bus.stop();
  });

  it('isolates message and failure callbacks from a replaced transport generation', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stale-transport-callbacks' });
    const generations: Array<DataBusTransportHandlers<number>> = [];
    const transport: DataBusTransport<object, number> = {
      start(_config, handlers) {
        generations.push(handlers);
        handlers.onStatus(WORKER_STATUS.CONNECTED);
      },
      subscribe() {},
      unsubscribe() {},
      publish() {},
      stop() {}
    };
    const bus = new CrossTabDataBus({
      clusterKey: 'stale-transport-callbacks',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const handler = vi.fn();
    const errors: unknown[] = [];
    bus.subscribe('topic', handler);
    bus.onError(error => errors.push(error));
    await bus.ready();

    // Replace the live transport while retaining the first generation's
    // handlers, then let the replacement become healthy. Late callbacks from
    // the retired generation must not dispatch data, downgrade status, or
    // enter the current failure ledger.
    environment.pageHide();
    environment.pageShow();
    await bus.ready();
    expect(generations).toHaveLength(2);
    expect(bus.getStatus()).toBe(WORKER_STATUS.CONNECTED);

    const retired = generations[0]!;
    retired.onMessage({ topic: 'topic', data: 99, messageId: 'stale-generation' });
    retired.onStatus(WORKER_STATUS.ERROR);
    retired.onError(new Error('stale transport callback'));
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    expect(bus.getStatus()).toBe(WORKER_STATUS.CONNECTED);
    expect(errors).toEqual([]);
    await bus.stop();
  });

  it('resolves stop() and reports through onError when the transport stop rejects', async () => {
    // The React/Vue adapters tear the bus down with a fire-and-forget
    // `void bus.stop()`. A transport whose stop() rejects must therefore not
    // reject the shared stop promise, or every unmount could surface an
    // unhandled rejection even though the bus is fully torn down. The failure
    // is routed through the same ledger/onError channel that suspendTransport()
    // and createStopPromise() already use.
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-failure' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-failure',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    await bus.ready();
    transport.stopShouldFail = true;

    await expect(bus.stop()).resolves.toBeUndefined();
    expect(transport.stopCalls).toBe(1);
    expect(errors.map(String).some(message => message.includes('transport stop failed'))).toBe(true);
    const failureSummary = bus.getHealthSummary();
    expect(failureSummary).toMatchObject({
      started: false,
      state: 'stopped',
      lastFailure: { source: 'transport', message: 'transport stop failed' },
      transport: { ready: false }
    });
    // The unified and recovery ledgers describe the same retained failure.
    // Clearing one while the other survives makes the same health snapshot
    // contradict itself.
    expect(failureSummary.recovery).toMatchObject({
      hasError: true,
      errorMessage: 'transport stop failed',
      errorAt: failureSummary.lastFailure?.at
    });

    // A failed teardown must still leave the instance restartable.
    transport.stopShouldFail = false;
    await bus.start({});
    await expect(bus.ready()).resolves.toBeUndefined();
    expect(transport.startCalls).toBe(2);
    await bus.stop();
  });

  it('contains a stop rejection while cleaning up a failed startup and stays restartable', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'failed-start-stop-error' });
    const transport = new FakeTransport<number>();
    transport.startShouldFail = true;
    transport.stopShouldFail = true;
    const bus = new CrossTabDataBus({
      clusterKey: 'failed-start-stop-error',
      environment: environment.environment,
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));

    await expect(bus.start({})).rejects.toThrow('Transport failed during startup.');
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));
    expect(errors.map(String).some(message => message.includes('transport stop failed'))).toBe(true);

    // The failed cleanup must not poison the shared pending-stop gate: once the
    // transport is healthy again, the same instance must restart cleanly.
    transport.startShouldFail = false;
    transport.stopShouldFail = false;
    await bus.start({});
    await expect(bus.ready()).resolves.toBeUndefined();
    expect(transport.startCalls).toBe(2);
    await bus.stop();
  });

  it('stops once when an explicit stop follows a failed-open cleanup', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-after-failed-open' });
    const transport = new FakeTransport<number>();
    transport.startShouldFail = true;
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-after-failed-open',
      environment: environment.environment,
      transport
    });

    await expect(bus.start({})).rejects.toThrow('Transport failed during startup.');
    // The failed open already ran transport.stop(); that cleanup stays the
    // single shared stop gate.
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    await bus.stop();

    // stop() must settle through the existing gate instead of issuing a
    // second, redundant transport.stop().
    expect(transport.stopCalls).toBe(1);
    expect(bus.getHealthSummary()).toMatchObject({ started: false, state: 'stopped' });
  });

  it('keeps stop() successful when a superseded in-flight start rejects', async () => {
    // stop() serialises behind an opening that has already called start().
    // If that superseded opening rejects after stop owns the lifecycle, stop()
    // must absorb the stale rejection, close the transport once, and leave the
    // abandoned start failure on the caller's start() promise instead of the
    // new lifecycle's error ledger.
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-superseded-start' });
    let rejectStart!: (error: unknown) => void;
    const startGate = new Promise<void>((_resolve, reject) => {
      rejectStart = reject;
    });
    const start = vi.fn(() => startGate);
    const stop = vi.fn(() => undefined);
    const transport: DataBusTransport<object, number> = {
      start,
      stop,
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      publish: () => undefined
    };
    const errors: unknown[] = [];
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-superseded-start',
      environment: environment.environment,
      transport
    });
    bus.onError(error => errors.push(error));

    const starting = bus.start({});
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    const stopping = bus.stop();
    // The stop has incremented the lifecycle epoch and is now waiting for the
    // in-flight opening to settle.
    rejectStart(new Error('superseded start boom'));

    await expect(starting).rejects.toThrow('superseded start boom');
    await expect(stopping).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
    expect(bus.getHealthSummary()).toMatchObject({ started: false, state: 'stopped' });
  });

  it('contains a transport stop rejection during page-hide suspension and still resumes', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'suspend-stop-reject' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'suspend-stop-reject',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    transport.stopShouldFail = true;
    environment.pageHide();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    // A rejecting page-hide stop is reported rather than thrown, and the bus
    // still ends up in a clean suspended state.
    await vi.waitFor(() =>
      expect(errors.map(error => String(error)).some(message => message.includes('transport stop failed'))).toBe(true)
    );
    await expect(bus.ready()).rejects.toThrow(/suspended/i);

    // Resume must open a fresh transport even though the suspend stop failed.
    transport.stopShouldFail = false;
    environment.pageShow();
    await bus.ready();
    expect(transport.startCalls).toBe(2);
    expect(bus.getStatus()).toBe('connected');
    await bus.stop();
  });

  it('reuses an in-flight recovery reopen instead of opening a second transport', async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => now, randomId: 'reopen-reuse' });
    let startCalls = 0;
    let handlers: DataBusTransportHandlers<number> | null = null;
    let releaseReopen!: () => void;
    const reopenGate = new Promise<void>(resolve => {
      releaseReopen = resolve;
    });
    const transport: DataBusTransport<object, number> = {
      start(_config, nextHandlers) {
        startCalls += 1;
        handlers = nextHandlers;
        if (startCalls === 1) {
          nextHandlers.onStatus(WORKER_STATUS.CONNECTED);
          return;
        }
        return reopenGate.then(() => nextHandlers.onStatus(WORKER_STATUS.CONNECTED));
      },
      subscribe() {},
      unsubscribe() {},
      publish() {},
      stop() {}
    };
    const bus = new CrossTabDataBus({
      clusterKey: 'reopen-reuse',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 100, maxAttempts: 5 },
      // The recovery clock is injected so a second error can pass the cooldown
      // while the first reopen is still in flight.
      dedup: { now: () => now }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(startCalls).toBe(1);

    // The first failure arms automatic recovery; its timer opens a
    // replacement transport that stays connecting behind the gate.
    handlers!.onStatus(WORKER_STATUS.ERROR);
    await vi.advanceTimersByTimeAsync(100);
    expect(startCalls).toBe(2);

    // A second error lands past the cooldown while that reopen is still in
    // flight. Its recovery timer must reuse the opening instead of starting a
    // second transport that would orphan the first.
    now = 1_200;
    handlers!.onStatus(WORKER_STATUS.ERROR);
    await vi.advanceTimersByTimeAsync(100);
    expect(startCalls).toBe(2);

    releaseReopen();
    await bus.ready();
    expect(bus.getStatus()).toBe('connected');
    expect(startCalls).toBe(2);
    await bus.stop();
  });

  it('waits for an async transport stop before automatic recovery reopens', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'async-stop' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'async-stop',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    let releaseStop!: () => void;
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    transport.stopGate = stopGate;
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(transport.startCalls).toBe(2);
    expect(transport.stopCalls).toBe(1);

    transport.startShouldFail = false;
    await vi.advanceTimersByTimeAsync(1_500);
    expect(transport.startCalls).toBe(2);

    releaseStop();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.startCalls).toBe(3);
    await bus.ready();
    await bus.stop();
  });

  it('does not reopen a transport queued behind a pending stop when stop() is called', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-queued-reopen' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-queued-reopen',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    let releaseStop!: () => void;
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    transport.stopGate = stopGate;
    transport.startShouldFail = true;
    transport.setStatus('error');

    // First recovery opens and fails, leaving an in-flight stop behind.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(transport.startCalls).toBe(2);
    expect(transport.stopCalls).toBe(1);

    // Second recovery queues a reopen behind the still-pending stop.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(transport.startCalls).toBe(2);

    // stop() arrives before the queued reopen may proceed.
    transport.startShouldFail = false;
    const stopPromise = bus.stop();
    releaseStop();
    await stopPromise;

    expect(transport.startCalls).toBe(2);
    expect(transport.stopCalls).toBe(1);
  });

  it('does not auto-recover the transport while the tab is suspended', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'suspend-recovery' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'suspend-recovery',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    transport.startShouldFail = true;
    transport.setStatus('error');
    environment.pageHide();

    // The recovery timer fires while hidden, but must not reopen the transport.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(transport.startCalls).toBe(1);
    expect(transport.stopCalls).toBe(1);

    // Once visible again, resume reopens the transport.
    transport.startShouldFail = false;
    environment.pageShow();
    await bus.ready();
    expect(transport.startCalls).toBe(2);
    await bus.stop();
  });

  it('does not reopen twice when a recovery timer races an explicit resume', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'reopen-race' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'reopen-race',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    // Runtime failure schedules an automatic recovery timer.
    transport.startShouldFail = true;
    transport.setStatus('error');
    environment.pageHide();

    // Before the timer fires, the tab returns and explicitly reopens the
    // transport; the connection is healthy again.
    transport.startShouldFail = false;
    environment.pageShow();
    await bus.ready();
    expect(transport.startCalls).toBe(2);
    expect(bus.getStatus()).toBe('connected');

    // The stale recovery timer must not open a second transport.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(transport.startCalls).toBe(2);
    await bus.stop();
  });

  it('ignores a stale recovery timer when a newer error schedules another attempt', async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => now, randomId: 'stale-recovery-timer' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'stale-recovery-timer',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 100, maxAttempts: 5 },
      // Inject the recovery clock so a second error can advance past the
      // cooldown without also advancing the fake timer clock past timer A.
      dedup: { now: () => now }
    });
    bus.subscribe('topic', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(1);

    transport.startShouldFail = true;
    // First error arms timer A at t=1000; A comes due 100ms of fake timer
    // clock later.
    transport.setStatus('error');

    // Advance the fake timer clock partway toward A, then let a second error
    // arrive past the cooldown (t=1100). The newer error arms timer B, due
    // later than A, and invalidates A's token.
    await vi.advanceTimersByTimeAsync(50);
    now = 1_100;
    transport.setStatus('error');

    // Advance to timer A's due time only, leaving timer B pending. A stale
    // timer that skipped the token check would reopen here; the guard must
    // keep it inert, so no extra start attempt is observable yet.
    await vi.advanceTimersByTimeAsync(50);
    expect(transport.startCalls).toBe(1);

    // The newer timer is the only one allowed to reopen the transport.
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.startCalls).toBe(2);
    await bus.stop();
  });

  it('serialises a single stop when the tab hides during a failing start', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'suspend-fail-stop' });
    let releaseStart!: () => void;
    let releaseStop!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const transport = new FakeTransport<number>(startGate);
    transport.startShouldFail = true;
    transport.stopGate = stopGate;
    const bus = new CrossTabDataBus({
      clusterKey: 'suspend-fail-stop',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('topic', vi.fn());

    environment.pageHide();
    releaseStart();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));

    // Resume while the stop is still in flight: the reopen must wait for it.
    environment.pageShow();
    await Promise.resolve();
    // The hidden tab never started the transport, so the queued reopen is the
    // only start and must wait for the in-flight stop before it runs.
    expect(transport.startCalls).toBe(0);

    transport.startShouldFail = false;
    releaseStop();
    await bus.ready();
    expect(transport.startCalls).toBe(1);
    expect(transport.stopCalls).toBe(1);
    await bus.stop();
  });

  it('rejects instead of throwing when ready() is called before explicit start without initialConfig', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'ready-reject' });
    const bus = new CrossTabDataBus({
      clusterKey: 'ready-reject',
      environment: environment.environment,
      transport: new FakeTransport()
    });

    await expect(bus.ready()).rejects.toThrow('requires initialConfig');
  });

  it('reports a failed remote publish through onError instead of silently dropping it', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'publish-failure',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'publish-failure',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB
    });
    await busA.start({});
    now += 1;
    await busB.start({});
    busA.subscribe('topic', vi.fn());
    busB.subscribe('topic', vi.fn());
    await Promise.all([busA.ready(), busB.ready()]);
    expect(transportA.subscribeCalls).toEqual(['topic']);

    const errors: unknown[] = [];
    busB.onError(error => errors.push(error));
    hub.failNextPost();
    busB.publish('topic', 1);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(transportA.publishCalls).toEqual([]);
    await Promise.all([busA.stop(), busB.stop()]);
  });

  it('hands off after an owner transport error during BFCache and avoids duplicate recovery delivery', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'bfcache-recovery-handoff',
      environment: envA.environment,
      initialConfig: {},
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA,
      recovery: { cooldownMs: 100_000 }
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'bfcache-recovery-handoff',
      environment: envB.environment,
      initialConfig: {},
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB,
      recovery: { cooldownMs: 100_000 }
    });
    const receivedA: number[] = [];
    const receivedB: number[] = [];

    await busA.start({});
    busA.subscribe('market.tick', message => receivedA.push(message.data));
    now += 1;
    await busB.start({});
    busB.subscribe('market.tick', message => receivedB.push(message.data));
    await Promise.resolve();

    expect(transportA.subscribeCalls).toEqual(['market.tick']);
    expect(transportB.subscribeCalls).toEqual([]);

    transportA.setStatus('error');
    envA.pageHide();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(transportA.subscribed.has('market.tick')).toBe(false);
    expect(transportB.subscribeCalls).toEqual(['market.tick']);

    transportB.emit('market.tick', 1, 'handoff-1', now);
    expect(receivedA).toEqual([]);
    expect(receivedB).toEqual([1]);

    envA.pageShow();
    await busA.ready().catch(() => undefined);
    expect(transportA.startCalls).toBe(2);
    expect(transportA.subscribeCalls).toEqual(['market.tick']);
    expect(transportB.subscribeCalls).toEqual(['market.tick']);

    transportB.emit('market.tick', 2, 'handoff-2', now + 1);
    expect(receivedA).toEqual([2]);
    expect(receivedB).toEqual([1, 2]);

    await Promise.all([busA.stop(), busB.stop()]);
  });
});


describe('CrossTabDataBus publishBatch', () => {
  function makeBus(workerId: string) {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const environment = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: workerId });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: workerId,
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    return { bus, transport };
  }

  it('is a no-op when the batch is empty', async () => {
    const { bus, transport } = makeBus('bus-batch-empty');
    await bus.start({});
    bus.publishBatch('topic', []);
    await Promise.resolve();
    expect(transport.publishCalls).toEqual([]);
    await bus.stop();
  });

  it('delegates a single-item batch to publish()', async () => {
    const { bus, transport } = makeBus('bus-batch-single');
    await bus.start({});
    bus.subscribe('topic', vi.fn());
    bus.publishBatch('topic', [{ data: 1, options: { messageId: 'b-0' } }]);
    await Promise.resolve();
    expect(transport.publishCalls).toEqual([{ topic: 'topic', data: 1, options: { messageId: 'b-0' } }]);
    await bus.stop();
  });

  it('publishes every batch item via a per-item transport call', async () => {
    const { bus, transport } = makeBus('bus-batch-multi');
    await bus.start({});
    bus.subscribe('topic', vi.fn());
    bus.publishBatch('topic', [
      { data: 1, options: { messageId: 'a' } },
      { data: 2 },
      { data: 3, options: { messageId: 'c', timestamp: 9 } }
    ]);
    await Promise.resolve();
    expect(transport.publishCalls).toHaveLength(3);
    expect(transport.publishCalls.map(call => call.topic)).toEqual(['topic', 'topic', 'topic']);
    expect(transport.publishCalls.map(call => call.data)).toEqual([1, 2, 3]);
    expect(transport.publishCalls.map(call => call.options)).toEqual([
      { messageId: 'a' },
      undefined,
      { messageId: 'c', timestamp: 9 }
    ]);
    await bus.stop();
  });

  it('routes a multi-item batch through a batch-capable transport in one call', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'bus-batch-transport' });
    const transport = new FakeTransport<number>(undefined, { supportsPublishBatch: true });
    const bus = new CrossTabDataBus({
      clusterKey: 'bus-batch-transport',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    await bus.start({});
    bus.subscribe('topic', vi.fn());
    bus.publishBatch('topic', [
      { data: 1, options: { messageId: 'a' } },
      { data: 2 },
      { data: 3, options: { messageId: 'c', timestamp: 9 } }
    ]);
    await Promise.resolve();
    expect(transport.publishBatchCalls).toHaveLength(1);
    expect(transport.publishBatchCalls[0]).toEqual({
      topic: 'topic',
      items: [
        { data: 1, messageId: 'a' },
        { data: 2 },
        { data: 3, messageId: 'c', timestamp: 9 }
      ]
    });
    expect(transport.publishCalls).toEqual([]);
    await bus.stop();
  });

  it('reports an error when the cluster publishBatch reports failure', async () => {
    const { bus } = makeBus('bus-batch-err');
    await bus.start({});
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    // Stub the runtime method via casting to any — cluster is private.
    const runtime = (bus as unknown as { cluster: { publishBatch: ReturnType<typeof vi.fn> } }).cluster;
    const spy = vi.spyOn(runtime, 'publishBatch').mockReturnValue(false);
    bus.publishBatch('topic', [{ data: 1 }, { data: 2 }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    spy.mockRestore();
    await bus.stop();
  });
});


describe('CrossTabDataBus wildcard subscriptions', () => {
  function makeBus(workerId: string, storage: MemoryStorage, hub: ChannelHub) {
    const environment = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: workerId });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      autoStart: true,
      clusterKey: 'wildcards',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    return { bus, transport };
  }

  it('delivers concrete-topic publications to wildcard subscribers on the owning tab', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const { bus, transport } = makeBus('owner', storage, hub);
    const wildcardHandler = vi.fn();
    bus.subscribe('chat.*', wildcardHandler);
    await bus.ready();

    // The pattern is subscribed at the transport as a literal channel.
    expect(transport.subscribeCalls).toContain('chat.*');

    // A pattern-aware server delivers a publication under the concrete topic.
    transport.emit('chat.room.1', 7);
    expect(wildcardHandler).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'chat.room.1', data: 7 })
    );

    // Non-matching topics stay discarded.
    transport.emit('other.topic', 8);
    expect(wildcardHandler).toHaveBeenCalledTimes(1);

    // The exact topic still flows to exact subscribers.
    const exactHandler = vi.fn();
    bus.subscribe('chat.room.1', exactHandler);
    await Promise.resolve();
    transport.emit('chat.room.1', 9);
    expect(exactHandler).toHaveBeenCalledTimes(1);
    expect(wildcardHandler).toHaveBeenCalledTimes(2);

    await bus.stop();
  });

  it('delivers wildcard-matched publications to non-owner tabs via EVENT fan-out', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    let now = 1_000;
    const envA = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'a' });
    const envB = createFakeEnvironment({ storage, hub, now: () => now, randomId: 'b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'wildcards',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'wildcards',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB
    });
    await busA.start({});
    now += 1;
    await busB.start({});

    const receivedA: number[] = [];
    const receivedB: number[] = [];
    busA.subscribe('chat.*', message => receivedA.push(message.data));
    busB.subscribe('chat.*', message => receivedB.push(message.data));
    await Promise.resolve();

    // A owns the pattern channel; B is a standby wildcard subscriber.
    expect(transportA.subscribeCalls).toContain('chat.*');
    expect(transportB.subscribeCalls).not.toContain('chat.*');

    // A's transport receives a concrete-topic publication from a pattern-aware
    // server; B must receive it through the EVENT fan-out + wildcard match.
    transportA.emit('chat.room.2', 42);
    await Promise.resolve();
    expect(receivedA).toEqual([42]);
    expect(receivedB).toEqual([42]);

    await busA.stop();
    await busB.stop();
  });

  it('stops delivering after the wildcard subscription is removed', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const { bus, transport } = makeBus('owner', storage, hub);
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('chat.*', handler);
    await bus.ready();

    transport.emit('chat.room.1', 1);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    await Promise.resolve();
    expect(transport.unsubscribeCalls).toContain('chat.*');
    transport.emit('chat.room.1', 2);
    expect(handler).toHaveBeenCalledTimes(1);

    await bus.stop();
  });

  it('delivers a publication to the handlers that existed when its delivery began', async () => {
    // A handler that registers a fresh closure for its own topic on every
    // invocation used to grow the fan-out it was being iterated through: the
    // handler lists are `Set`s, and `Set` iteration visits entries appended after
    // the cursor. Measured before the snapshot in `dispatch()`, one publication ran
    // 500 handlers here — the test's own ceiling, not a bound the library imposed —
    // and the next one delivered to 999, because those registrations persist. An
    // assertion that fails as `expected 500 to be 1` is the legible form of that;
    // without the ceiling the same test would simply never finish.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const { bus, transport } = makeBus('owner', storage, hub);
    const CEILING = 500;
    let addedDuringDelivery = 0;
    const makeHandler = (): (() => void) => () => {
      if (addedDuringDelivery < CEILING) {
        addedDuringDelivery += 1;
        bus.subscribe('grow', makeHandler());
      }
    };
    bus.subscribe('grow', makeHandler());
    await bus.ready();

    transport.emit('grow', 1);
    expect(addedDuringDelivery, 'one publication must invoke one handler').toBe(1);
    // The handler the first delivery registered is live for the next one, so this
    // is where the growth the fix stops is still visible — by one, per message.
    addedDuringDelivery = 0;
    transport.emit('grow', 2);
    expect(addedDuringDelivery).toBe(2);

    await bus.stop();
  });

  it('keeps a handler in a delivery that another handler already started', async () => {
    // The other half of the snapshot: `Set` iteration also skips entries deleted
    // before the cursor, so an `unsubscribe()` issued by an earlier handler used to
    // remove a later one from the publication already in flight (measured: the pair
    // delivered `['first']`). The contract is now one-sided in the predictable
    // direction — the delivery set is fixed when delivery begins — so a late
    // unsubscribe takes effect on the next publication instead of mid-message.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const { bus, transport } = makeBus('owner', storage, hub);
    const seen: string[] = [];
    let dropSecond: () => void = () => {};
    bus.subscribe('pair', () => {
      seen.push('first');
      dropSecond();
    });
    const second = bus.subscribe('pair', () => seen.push('second'));
    dropSecond = second;
    await bus.ready();

    transport.emit('pair', 1);
    expect(seen, 'a handler must not be cut out of a delivery in flight').toEqual(['first', 'second']);

    seen.length = 0;
    transport.emit('pair', 2);
    expect(seen, 'the same unsubscribe must hold from the next publication on').toEqual(['first']);

    await bus.stop();
  });

  it('does not deliver a publication to a wildcard subscription made during it', async () => {
    // `dispatch()` also iterates `topicHandlers` for matching patterns, so a
    // pattern registered by a handler in the same delivery used to be reached for
    // the very message that caused it. Both passes are collected before the first
    // handler runs, which is why this needs the collection loop to precede the
    // invocations rather than only snapshotting the exact-topic list.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const { bus, transport } = makeBus('owner', storage, hub);
    const seen: string[] = [];
    let dropPattern: () => void = () => {};
    let armed = false;
    bus.subscribe('chat.room.1', () => {
      seen.push('exact');
      if (!armed) {
        armed = true;
        dropPattern = bus.subscribe('chat.*', () => seen.push('pattern'));
      }
    });
    await bus.ready();

    transport.emit('chat.room.1', 1);
    expect(seen, 'the pattern created by this delivery must not receive it').toEqual(['exact']);

    seen.length = 0;
    transport.emit('chat.room.1', 2);
    expect(seen).toEqual(['exact', 'pattern']);
    dropPattern();

    await bus.stop();
  });
});

describe('CrossTabDataBus replay (bounded local history)', () => {
  function makeReplayBus(replay?: { maxPerTopic?: number; retentionMs?: number; retentionSweepMs?: number; persistenceRetry?: { maxAttempts?: number; backoffMs?: number }; persistence?: { load: () => Promise<ReadonlyArray<{ topic: string; data: unknown; timestamp?: number }>>; append: (message: { topic: string; data: unknown; timestamp?: number }) => Promise<void>; clearTopic?: () => Promise<void>; clearBefore?: (timestamp: number) => Promise<void>; clear?: () => Promise<void> } }, dedup?: { maxEntries?: number; ttlMs?: number; sweepMs?: number; adaptiveTtl?: { minMs: number; maxMs: number }; now?: () => number }, trace?: (event: Parameters<NonNullable<ConstructorParameters<typeof CrossTabDataBus>[0]['trace']>['sink']>[0]) => void) {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'replay' });
    const transport = new FakeTransport<unknown>();
    const bus = new CrossTabDataBus({
      autoStart: true,
      clusterKey: 'replay',
      environment: environment.environment,
      initialConfig: {},
      transport,
      ...(trace ? { trace: { enabled: true, sink: trace } } : {}),
      ...(dedup ? { dedup } : {}),
      ...(replay ? { replay } : {})
    });
    return { bus, transport };
  }

  it('delivers buffered history to a late-joining handler, marked replayed', async () => {
    const { bus, transport } = makeReplayBus({});
    const early: unknown[] = [];
    bus.subscribe('t', message => early.push(message.data));
    await bus.ready();
    transport.emit('t', 1);
    transport.emit('t', 2);

    const late: Array<{ data: unknown; replayed?: boolean | undefined }> = [];
    bus.subscribe('t', message => late.push({ data: message.data, replayed: message.replayed }), {
      replay: true
    });
    // Live dispatches still reach both handlers.
    transport.emit('t', 3);

    expect(early).toEqual([1, 2, 3]);
    expect(late).toEqual([
      { data: 1, replayed: true },
      { data: 2, replayed: true },
      { data: 3, replayed: undefined }
    ]);
    await bus.stop();
  });

  it('isolates a throwing replay handler and reports it as a dispatch failure', async () => {
    const { bus, transport } = makeReplayBus({ maxPerTopic: 4 });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    // Keep a sink subscriber so the topic stays owned and its publications are
    // buffered instead of being dropped as unowned.
    bus.subscribe('t', () => {});
    await bus.ready();
    transport.emit('t', 1);
    transport.emit('t', 2);

    const seen: number[] = [];
    const boom = new Error('replay handler failed');
    bus.subscribe('t', message => {
      seen.push(message.data as number);
      if (message.data === 1) throw boom;
    }, { replay: true });

    // A throwing replay delivery must not stop the remaining buffered history
    // from reaching the handler...
    expect(seen).toEqual([1, 2]);
    // ...and it surfaces through the dispatch failure channel, not a throw.
    expect(errors).toContain(boom);
    await bus.stop();
  });

  it('honours a per-subscription limit and the bus-level ring cap', async () => {
    const { bus, transport } = makeReplayBus({ maxPerTopic: 4 });
    await bus.ready();
    // Only dispatched publications are buffered: keep a sink subscriber on
    // the topic so the messages are not dropped as unowned.
    bus.subscribe('t', () => {});
    for (let index = 0; index < 10; index += 1) transport.emit('t', index);

    const seen: unknown[] = [];
    bus.subscribe('t', message => seen.push(message.data), { replay: true });
    // Ring holds the last 4 publications; the request cannot exceed it.
    expect(seen).toEqual([6, 7, 8, 9]);

    const limited: unknown[] = [];
    bus.subscribe('t', message => limited.push(message.data), { replay: 2 });
    expect(limited).toEqual([8, 9]);
    await bus.stop();
  });

  it('replays wildcard subscriptions across all matching buffered topics', async () => {
    const { bus, transport } = makeReplayBus({});
    await bus.ready();
    bus.subscribe('chat.room.1', () => {});
    transport.emit('chat.room.1', 'a');
    transport.emit('other.topic', 'b');
    transport.emit('chat.room.2', 'c');

    const seen: Array<{ topic: string; data: string | number }> = [];
    bus.subscribe(
      'chat.*',
      message => seen.push({ topic: message.topic, data: message.data as string }),
      { replay: true }
    );
    // Only dispatched publications are buffered: chat.room.2 had no local
    // subscriber, so it was dropped as unowned and never entered the ring.
    expect(seen).toEqual([{ topic: 'chat.room.1', data: 'a' }]);
    await bus.stop();
  });

  it('buffers nothing when replay is not enabled, and clears on unsubscribe', async () => {
    const noReplay = makeReplayBus();
    await noReplay.bus.ready();
    noReplay.transport.emit('t', 1);
    const late = vi.fn();
    noReplay.bus.subscribe('t', late, { replay: true });
    expect(late).not.toHaveBeenCalled();
    await noReplay.bus.stop();

    const { bus, transport } = makeReplayBus({});
    await bus.ready();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('t', handler, { replay: true });
    transport.emit('t', 1);
    unsubscribe();
    const rejoin = vi.fn();
    bus.subscribe('t', rejoin, { replay: true });
    expect(rejoin).not.toHaveBeenCalled();
    await bus.stop();
  });

  it('rejects invalid replay buffer limits', () => {
    for (const maxPerTopic of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => makeReplayBus({ maxPerTopic })).toThrow(TypeError);
    }
    expect(() => makeReplayBus({ maxPerTopic: 1 })).not.toThrow();
  });

  it('hydrates and persists replay history through an optional backend', async () => {
    const appended: Array<{ topic: string; data: unknown }> = [];
    const persistence = {
      load: vi.fn(async () => [{ topic: 't', data: 'old' }]),
      append: vi.fn(async (message: { topic: string; data: unknown }) => {
        appended.push(message);
      })
    };
    const { bus, transport } = makeReplayBus({ persistence });
    await bus.ready();
    const seen: unknown[] = [];
    bus.subscribe('t', message => seen.push(message.data), { replay: true });
    await Promise.resolve();
    expect(seen).toEqual(['old']);
    bus.subscribe('t', () => {});
    transport.emit('t', 'new');
    await Promise.resolve();
    expect(persistence.load).toHaveBeenCalledOnce();
    expect(appended[0]).toMatchObject({ topic: 't', data: 'new' });
    await bus.stop();
  });

  it('clears persisted topic history when the last handler unsubscribes and clears all on stop', async () => {
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined),
      clearTopic: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    };
    const { bus } = makeReplayBus({ persistence });
    await bus.ready();
    const unsubscribe = bus.subscribe('t', () => {});
    unsubscribe();
    await Promise.resolve();
    expect(persistence.clearTopic).toHaveBeenCalledWith('t');
    await bus.stop();
    expect(persistence.clear).not.toHaveBeenCalled();
  });

  it('leaves the concrete topics a pattern filled when the pattern is unsubscribed', async () => {
    // The test above is the exact-topic case. A pattern is not a topic: the
    // rings it fills are keyed by the concrete publication topics, so
    // `unsubscribe('chat.*')` can only address the pattern key — the durable
    // cleanup names a row that was never written, and the in-memory rings stay
    // with whatever still owns them. That is deliberate (any of those topics may
    // have a live exact subscriber this one must not evict), and it is pinned
    // here so the documentation cannot drift back to an unqualified "cleared
    // when the last handler for the topic unsubscribes".
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined),
      clearTopic: vi.fn(async () => undefined)
    };
    const { bus, transport } = makeReplayBus({ persistence, maxPerTopic: 10 });
    await bus.ready();
    bus.subscribe('chat.*', () => undefined);
    await Promise.resolve();

    transport.emit('chat.room.1', 7);
    transport.emit('chat.room.2', 8);
    await Promise.resolve();
    expect(bus.getDiagnostics().replay).toMatchObject({ topics: 2, messages: 2 });

    bus.unsubscribe('chat.*');
    await Promise.resolve();
    expect(persistence.clearTopic).toHaveBeenCalledWith('chat.*');
    expect(bus.getDiagnostics().replay).toMatchObject({ topics: 2, messages: 2 });

    const seen: string[] = [];
    bus.subscribe(
      'chat.*',
      message => seen.push(`${message.topic}:${String(message.data)}`),
      { replay: true }
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(['chat.room.1:7', 'chat.room.2:8']);
    await bus.stop();
  });

  it('exposes explicit replay retention cleanup', async () => {
    const persistence = { load: vi.fn(async () => []), append: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
    const { bus } = makeReplayBus({ persistence });
    await bus.ready();
    await bus.clearReplay();
    expect(persistence.clear).toHaveBeenCalledOnce();
    await bus.stop();
  });

  it('supports topic-scoped replay cleanup and dedup statistics reset', async () => {
    const persistence = { load: vi.fn(async () => []), append: vi.fn(async () => undefined), clearTopic: vi.fn(async () => undefined) };
    const { bus, transport } = makeReplayBus({ persistence }, { maxEntries: 4 });
    await bus.ready();
    bus.subscribe('t', () => {});
    transport.emit('t', 1, 'id-1');
    transport.emit('t', 2, 'id-1');
    expect(bus.getDedupStats()).toMatchObject({ enabled: true, tracked: 1, accepted: 1, suppressed: 1 });
    bus.resetDedup();
    expect(bus.getDedupStats()).toMatchObject({ tracked: 0, accepted: 0, suppressed: 0 });
    await bus.clearReplayTopic('t');
    expect(persistence.clearTopic).toHaveBeenCalledWith('t');
    await bus.stop();
  });

  it('supports time-based replay cleanup when the persistence adapter opts in', async () => {
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined),
      clearBefore: vi.fn(async (_timestamp: number) => undefined)
    };
    const { bus, transport } = makeReplayBus({ persistence });
    await bus.ready();
    bus.subscribe('t', () => {});
    transport.emit('t', 1);
    await bus.clearReplayBefore(Date.now() + 1);
    expect(persistence.clearBefore).toHaveBeenCalledOnce();
    await bus.stop();
  });

  it('preserves legacy replay messages without producer timestamps during cleanup', async () => {
    const { bus, transport } = makeReplayBus({ maxPerTopic: 4 });
    const early: unknown[] = [];
    bus.subscribe('t', message => early.push(message.data));
    await bus.ready();
    transport.emit('t', 'legacy');
    transport.emit('t', 'dated', undefined, 1_700_000_000_000);
    await bus.clearReplayBefore(1_700_000_000_001);
    const replayed: unknown[] = [];
    bus.subscribe('t', message => replayed.push(message.data), { replay: true });
    expect(replayed).toEqual(['legacy']);
    await bus.stop();
  });

  it('automatically prunes durable replay history when retention is configured', async () => {
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined),
      clearBefore: vi.fn(async (_timestamp: number) => undefined)
    };
    const { bus, transport } = makeReplayBus({ retentionMs: 60_000, persistence });
    await bus.ready();
    bus.subscribe('t', () => {});
    transport.emit('t', 1, undefined, 1_700_000_000_000);
    await Promise.resolve();
    expect(persistence.clearBefore).toHaveBeenCalled();
    expect(persistence.clearBefore.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
    await bus.stop();
  });

  it('runs periodic retention sweeps without requiring a publication', async () => {
    vi.useFakeTimers();
    try {
      const persistence = {
        load: vi.fn(async () => []),
        append: vi.fn(async () => undefined),
        clearBefore: vi.fn(async (_timestamp: number) => undefined)
      };
      const { bus } = makeReplayBus({ retentionMs: 60_000, retentionSweepMs: 1_000, persistence });
      await bus.ready();
      persistence.clearBefore.mockClear();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(persistence.clearBefore).toHaveBeenCalledOnce();
      await bus.stop();
      persistence.clearBefore.mockClear();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(persistence.clearBefore).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces retention cleanup during a publication burst', async () => {
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined),
      clearBefore: vi.fn(async (_timestamp: number) => undefined)
    };
    const { bus, transport } = makeReplayBus({ retentionMs: 60_000, persistence });
    await bus.ready();
    persistence.clearBefore.mockClear();
    bus.subscribe('t', () => {});
    transport.emit('t', 1, undefined, 1_700_000_000_000);
    transport.emit('t', 2, undefined, 1_700_000_000_001);
    transport.emit('t', 3, undefined, 1_700_000_000_002);
    // All three synchronous dispatches share the first in-flight cleanup.
    expect(persistence.clearBefore).toHaveBeenCalledOnce();
    await Promise.resolve();
    await bus.stop();
  });

  it('reports a failing retention cleanup through onError and still completes later flushes', async () => {
    const persistenceErrors: unknown[] = [];
    const failures = new Set<number>();
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined),
      clearBefore: vi.fn(async () => {
        if (failures.has(persistence.clearBefore.mock.calls.length)) throw new Error('retention flush failed');
      })
    };
    const { bus, transport } = makeReplayBus({ retentionMs: 60_000, persistence });
    bus.onError(error => persistenceErrors.push(error));
    await bus.ready();
    // Hydration issues its own pre-load retention pass at construction; wait it
    // out so the baseline below counts only it.
    await vi.waitFor(() => expect(persistence.clearBefore.mock.calls.length).toBeGreaterThanOrEqual(1));
    const baseline = persistence.clearBefore.mock.calls.length;
    failures.add(baseline + 1); // the next cleanup pass fails exactly once

    bus.subscribe('t', () => {});
    transport.emit('t', 1, undefined, 1_700_000_000_000);
    await vi.waitFor(() => expect(persistence.clearBefore.mock.calls.length).toBe(baseline + 1));
    await vi.waitFor(() => expect(persistenceErrors).toHaveLength(1));
    expect((persistenceErrors[0] as Error).message).toBe('retention flush failed');

    // A later publication still gets a working cleanup — one failure does not
    // wedge the retention pipeline.
    failures.clear();
    transport.emit('t', 2, undefined, 1_700_000_000_100);
    await vi.waitFor(() => expect(persistence.clearBefore.mock.calls.length).toBe(baseline + 2));
    expect(persistenceErrors).toHaveLength(1);
    await bus.stop();
  });

  it('keeps draining retention cleanups queued while one pass was in flight', async () => {
    // The second publication lands while the first clearBefore is still
    // pending; the cleanup loop must drain the newer cutoff afterwards with a
    // strictly greater cutoff (the coalesced queue, not a lost update).
    const resolvers: Array<() => void> = [];
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined),
      clearBefore: vi.fn(
        () => new Promise<void>(resolve => resolvers.push(resolve))
      )
    };
    const { bus, transport } = makeReplayBus({ retentionMs: 60_000, persistence });
    await bus.ready();
    // Let the hydration pass (construction-time) resolve first.
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    resolvers[0]!();
    // The pre-load cleanup has no queued successor, so the drain ends here.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(persistence.clearBefore).toHaveBeenCalledOnce();

    bus.subscribe('t', () => {});
    transport.emit('t', 1, undefined, 1_700_000_000_000);
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    transport.emit('t', 2, undefined, 1_700_000_000_100);
    // Still one pass in flight — the newer cutoff is coalesced.
    expect(persistence.clearBefore).toHaveBeenCalledTimes(2);
    resolvers[1]!();
    // Microtask drain: the loop picks up the queued newer cutoff and issues
    // the second pass instead of dropping the coalesced update.
    await vi.waitFor(() => expect(persistence.clearBefore).toHaveBeenCalledTimes(3));
    resolvers[2]!();
    await bus.stop();
  });

  it('rejects invalid replay retention windows', () => {
    for (const retentionMs of [0, -1, NaN, Infinity]) {
      expect(() => makeReplayBus({ retentionMs })).toThrow(TypeError);
    }
  });

  it('rejects invalid retention sweep intervals', () => {
    for (const retentionSweepMs of [0, -1, NaN, Infinity]) {
      expect(() => makeReplayBus({ retentionMs: 60_000, retentionSweepMs })).toThrow(TypeError);
    }
  });

  it('rejects an invalid replay ring size and prune strategy through the public options', () => {
    // These two documented guards had no assertion at all. Dropping the
    // `pruneStrategy` check would let a typo ('ages') fall through to count
    // pruning silently, and an invalid `maxPerTopic` would size every ring to
    // 0/NaN instead of failing on construction.
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'replay-validation' });
    const build = (replay: Record<string, unknown>) => () =>
      new CrossTabDataBus({
        autoStart: true,
        clusterKey: 'replay-validation',
        environment: environment.environment,
        initialConfig: {},
        transport: new FakeTransport<unknown>(),
        replay
      } as never);

    for (const maxPerTopic of [0, -1, 1.5, NaN, Infinity]) {
      expect(build({ maxPerTopic })).toThrow(/replay\.maxPerTopic must be a positive safe integer/);
    }
    for (const pruneStrategy of ['ages', '', null, 0, {}]) {
      expect(build({ pruneStrategy })).toThrow(/pruneStrategy must be count, age, or both/);
    }
    // The documented value set stays accepted, with the optional fields alone.
    for (const pruneStrategy of ['count', 'age', 'both']) {
      expect(build({ pruneStrategy })).not.toThrow();
    }
    expect(build({ maxPerTopic: 1 })).not.toThrow();
  });

  it('reports the offending option when the value itself cannot be stringified', () => {
    // Same defect shape as the failure ledger, one layer out: the validators built
    // their messages with `String(value)` over arbitrary caller input. A
    // null-prototype object has no primitive conversion, so construction failed
    // with "Cannot convert object to primitive value" — a TypeError that names no
    // option — instead of the documented complaint. `pruneStrategy` is the worse
    // half: there the coercion is the membership test itself.
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'unstringifiable-option' });
    const build = (replay: Record<string, unknown>) => () =>
      new CrossTabDataBus({
        autoStart: true,
        clusterKey: 'unstringifiable-option',
        environment: environment.environment,
        initialConfig: {},
        transport: new FakeTransport<unknown>(),
        replay
      } as never);

    const value = Object.create(null);
    expect(build({ maxPerTopic: value })).toThrow(
      /replay\.maxPerTopic must be a positive safe integer, got \[unstringifiable object\]/
    );
    expect(build({ pruneStrategy: value })).toThrow(/pruneStrategy must be count, age, or both/);
  });

  it('suppresses duplicate message IDs only when dedup is enabled and evicts oldest entries', async () => {
    const { bus, transport } = makeReplayBus(undefined, { maxEntries: 2 });
    const seen: unknown[] = [];
    bus.subscribe('t', message => seen.push(message.data));
    await bus.ready();
    transport.emit('t', { value: 1 }, 'dup');
    transport.emit('t', { value: 2 }, 'dup');
    transport.emit('t', { value: 3 }, 'other');
    expect(seen).toEqual([{ value: 1 }, { value: 3 }]);
    await bus.stop();
  });

  it('evicts the oldest tracked ID when the bounded dedup set overflows', async () => {
    const { bus, transport } = makeReplayBus(undefined, { maxEntries: 2 });
    const seen: unknown[] = [];
    bus.subscribe('t', message => seen.push(message.data));
    await bus.ready();
    transport.emit('t', { value: 1 }, 'a');
    transport.emit('t', { value: 2 }, 'b');
    transport.emit('t', { value: 3 }, 'b'); // still tracked → suppressed
    transport.emit('t', { value: 4 }, 'c'); // set would exceed 2 → evicts 'a'
    transport.emit('t', { value: 5 }, 'a'); // evicted → delivered again
    expect(seen).toEqual([{ value: 1 }, { value: 2 }, { value: 4 }, { value: 5 }]);
    await bus.stop();
  });

  it('rejects invalid dedup options before the bus is constructed', () => {
    for (const maxEntries of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => makeReplayBus(undefined, { maxEntries })).toThrow(TypeError);
    }
    for (const ttlMs of [0, -1, NaN, Infinity]) {
      expect(() => makeReplayBus(undefined, { ttlMs })).toThrow(TypeError);
    }
    expect(() => makeReplayBus(undefined, { sweepMs: 0 })).toThrow(TypeError);
    expect(() => makeReplayBus(undefined, { maxEntries: 1, ttlMs: 1_000, sweepMs: 1_000 })).not.toThrow();
  });

  it('rejects invalid cluster options through the public bus, loadWeighting included', () => {
    // `loadWeighting` is a documented public option that had no validation at
    // all, so a negative weight silently inverted the routing policy and a
    // non-finite one silently poisoned the load score. The other cluster
    // options were equally unguarded.
    const environment = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'cluster-validation' });
    const build = (options: Record<string, unknown>): (() => CrossTabDataBus<unknown, unknown>) => {
      return () =>
        new CrossTabDataBus({
          autoStart: true,
          clusterKey: 'cluster-validation',
          environment: environment.environment,
          initialConfig: {},
          transport: new FakeTransport<unknown>(),
          ...options
        } as never);
    };
    expect(build({ heartbeatIntervalMs: 0 })).toThrow(/heartbeatIntervalMs must be a positive finite number/);
    expect(build({ workerTtlMs: 0 })).toThrow(/workerTtlMs must be a positive finite number/);
    expect(build({ maxActiveWorkers: 0 })).toThrow(/maxActiveWorkers must be a positive safe integer/);
    expect(build({ routeOwnerCacheMax: 0 })).toThrow(/routeOwnerCacheMax must be a positive safe integer/);
    expect(build({ loadWeighting: { messageRateWeight: -1 } })).toThrow(
      /loadWeighting\.messageRateWeight must be a non-negative finite number/
    );
    // The documented defaults and example weights stay accepted.
    expect(
      build({ heartbeatIntervalMs: 3_000, workerTtlMs: 10_000, maxActiveWorkers: 3, routeOwnerCacheMax: 256 })
    ).not.toThrow();
    expect(build({ loadWeighting: { messageRateWeight: 0.5, byteRateWeight: 0.001, scheduleLagWeight: 2 } })).not.toThrow();
  });

  it('rejects invalid adaptive dedup TTL bounds with a distinct message', () => {
    expect(() => makeReplayBus(undefined, { ttlMs: 1_000, adaptiveTtl: { minMs: 0, maxMs: 1_000 } })).toThrow(TypeError);
    expect(() => makeReplayBus(undefined, { ttlMs: 1_000, adaptiveTtl: { minMs: 2_000, maxMs: 1_000 } })).toThrow(
      'dedup.adaptiveTtl bounds are invalid.'
    );
    // Non-finite bounds previously slipped through the plain `<=` comparisons
    // (`NaN <= 0` and `maxMs < NaN` are both false), leaving `currentTtl()`
    // returning NaN and silently disabling expiry instead of failing loudly.
    for (const adaptiveTtl of [
      { minMs: NaN, maxMs: 1_000 },
      { minMs: 100, maxMs: NaN },
      { minMs: NaN, maxMs: NaN },
      { minMs: 100, maxMs: Infinity },
      { minMs: Infinity, maxMs: Infinity }
    ]) {
      expect(
        () => makeReplayBus(undefined, { ttlMs: 1_000, adaptiveTtl }),
        `adaptiveTtl ${JSON.stringify(adaptiveTtl)} must be rejected`
      ).toThrow('dedup.adaptiveTtl bounds are invalid.');
    }
    expect(() => makeReplayBus(undefined, { ttlMs: 1_000, adaptiveTtl: { minMs: 100, maxMs: 1_000 } })).not.toThrow();
  });

  it('does not add dedup-suppressed publications to replay history or persistence', async () => {
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined)
    };
    const { bus, transport } = makeReplayBus({ maxPerTopic: 8, persistence }, { maxEntries: 8 });
    const replayed: unknown[] = [];
    bus.subscribe('t', message => replayed.push(message.data), { replay: true });
    await bus.ready();
    transport.emit('t', 'first', 'same-id');
    transport.emit('t', 'duplicate', 'same-id');
    expect(replayed).toEqual(['first']);
    expect(persistence.append).toHaveBeenCalledTimes(1);
    expect(bus.getDedupStats()).toMatchObject({ accepted: 1, suppressed: 1, tracked: 1 });
    await bus.stop();
  });

  it('keeps replay and dedup consistent when a live duplicate follows hydration', async () => {
    const persistence = {
      load: vi.fn(async () => [{ topic: 't', data: 'hydrated', messageId: 'hydrated-id' }]),
      append: vi.fn(async () => undefined)
    };
    const { bus, transport } = makeReplayBus({ maxPerTopic: 8, persistence }, { maxEntries: 8 });
    const seen: Array<{ data: unknown; replayed?: boolean | undefined }> = [];
    bus.subscribe('t', message => seen.push({ data: message.data, replayed: message.replayed }), { replay: true });
    await bus.ready();

    // Hydrated history is replayed once, while the same live publication is
    // accepted only once by dedup and is then appended to replay history.
    expect(seen).toEqual([{ data: 'hydrated', replayed: true }]);
    transport.emit('t', 'live', 'live-id');
    transport.emit('t', 'live-duplicate', 'live-id');
    const late: unknown[] = [];
    bus.subscribe('t', message => late.push(message.data), { replay: true });
    await Promise.resolve();

    expect(seen).toEqual([
      { data: 'hydrated', replayed: true },
      { data: 'live', replayed: undefined }
    ]);
    expect(late).toEqual(['hydrated', 'live']);
    expect(persistence.append).toHaveBeenCalledTimes(1);
    expect(bus.getDedupStats()).toMatchObject({ accepted: 1, suppressed: 1 });
    await bus.stop();
  });

  it('keeps replay and dedup stable across transport recovery and resubscription', async () => {
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => undefined)
    };
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'recovery-replay-dedup'
    });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'recovery-replay-dedup',
      environment: environment.environment,
      initialConfig: {},
      transport,
      recovery: { cooldownMs: 100 },
      replay: { maxPerTopic: 8, persistence },
      dedup: { maxEntries: 8 }
    });
    const seen: unknown[] = [];
    bus.subscribe('t', message => seen.push(message.data), { replay: true });
    await bus.ready();

    transport.emit('t', 1, 'message-1');
    transport.setStatus('error');
    await new Promise(resolve => setTimeout(resolve, 120));

    // Recovery reopens the transport and replays the assigned subscription.
    expect(transport.startCalls).toBe(2);
    expect(transport.subscribeCalls).toEqual(['t', 't']);

    // A duplicate delivered after reconnect must be suppressed, while a new
    // publication is delivered and persisted exactly once.
    transport.emit('t', 1_000, 'message-1');
    transport.emit('t', 2_000, 'message-2');
    expect(seen).toEqual([1, 2_000]);
    expect(persistence.append).toHaveBeenCalledTimes(2);

    const late: unknown[] = [];
    bus.subscribe('t', message => late.push(message.data), { replay: true });
    await Promise.resolve();
    expect(late).toEqual([1, 2_000]);
    expect(bus.getDedupStats()).toMatchObject({ accepted: 2, suppressed: 1 });
    await bus.stop();
  });

  it('allows the same message ID to enter replay again after dedup TTL expiry', async () => {
    let now = 1_000;
    const { bus, transport } = makeReplayBus({ maxPerTopic: 8 }, { ttlMs: 100, now: () => now });
    bus.subscribe('t', () => {});
    await bus.ready();
    transport.emit('t', 'first', 'same-id');
    now += 101;
    transport.emit('t', 'second', 'same-id');

    const replayed: unknown[] = [];
    bus.subscribe('t', message => replayed.push(message.data), { replay: true });
    expect(replayed).toEqual(['first', 'second']);
    expect(bus.getDedupStats()).toMatchObject({ accepted: 2, suppressed: 0 });
    await bus.stop();
  });

  it('uses the injected dedup clock for TTL expiry', async () => {
    let now = 1_000;
    const { bus, transport } = makeReplayBus(undefined, { ttlMs: 100, now: () => now });
    const seen: unknown[] = [];
    bus.subscribe('t', message => seen.push(message.data));
    await bus.ready();
    transport.emit('t', 1, 'same');
    now += 101;
    transport.emit('t', 2, 'same');
    expect(seen).toEqual([1, 2]);
    expect(bus.getDedupStats()).toMatchObject({ accepted: 2, suppressed: 0 });
    await bus.stop();
  });

  it('sweeps expired dedup IDs during quiet periods and validates sweep interval', async () => {
    let now = 1_000;
    const { bus, transport } = makeReplayBus(undefined, { ttlMs: 100, sweepMs: 25, now: () => now });
    bus.subscribe('t', () => {});
    await bus.ready();
    transport.emit('t', 1, 'quiet-id');
    now += 101;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(bus.getDedupStats()).toMatchObject({ tracked: 0 });
    await bus.stop();
    for (const sweepMs of [0, -1, NaN, Infinity]) {
      expect(() => makeReplayBus(undefined, { sweepMs })).toThrow(TypeError);
    }
  });

  it('keeps replay history consistent when dedup TTL expires during a quiet retention window', async () => {
    vi.useFakeTimers();
    try {
      let now = 1_000;
      const persistence = {
        load: vi.fn(async () => []),
        append: vi.fn(async (_message: { topic: string; data: unknown; timestamp?: number }) => undefined),
        clearBefore: vi.fn(async (_timestamp: number) => undefined)
      };
      const storage = new MemoryStorage();
      const environment = createFakeEnvironment({ storage, now: () => now, randomId: 'replay-dedup-combo' });
      const transport = new FakeTransport<unknown>();
      const bus = new CrossTabDataBus({
        autoStart: true,
        clusterKey: 'replay-dedup-combo',
        environment: environment.environment,
        initialConfig: {},
        transport,
        replay: { maxPerTopic: 8, retentionMs: 100, retentionSweepMs: 25, persistence },
        dedup: { ttlMs: 100, sweepMs: 25, now: () => now }
      });
      const live: unknown[] = [];
      bus.subscribe('t', message => live.push(message.data));
      await bus.ready();

      transport.emit('t', 'first', 'same-id', now);
      transport.emit('t', 'duplicate', 'same-id', now);
      expect(live).toEqual(['first']);
      expect(bus.getDedupStats()).toMatchObject({ accepted: 1, suppressed: 1, tracked: 1 });

      now += 101;
      await vi.advanceTimersByTimeAsync(25);
      expect(bus.getDedupStats()).toMatchObject({ tracked: 0 });
      transport.emit('t', 'second', 'same-id', now);
      expect(live).toEqual(['first', 'second']);
      await Promise.resolve();
      await Promise.resolve();

      const replayed: unknown[] = [];
      bus.subscribe('t', message => replayed.push(message.data), { replay: true });
      await vi.runAllTicks();
      expect(replayed).toEqual(['first', 'second']);
      expect(persistence.append).toHaveBeenCalledTimes(2);
      expect(persistence.clearBefore).toHaveBeenCalled();

      await bus.stop();
      persistence.clearBefore.mockClear();
      await vi.advanceTimersByTimeAsync(100);
      expect(persistence.clearBefore).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets dedup state across a full stop and restart lifecycle', async () => {
    const { bus, transport } = makeReplayBus(undefined, { maxEntries: 4 });
    bus.subscribe('t', () => {});
    await bus.ready();
    transport.emit('t', 1, 'session-id');
    expect(bus.getDedupStats()).toMatchObject({ tracked: 1, accepted: 1 });
    await bus.stop();
    expect(bus.getDedupStats()).toMatchObject({ tracked: 0, accepted: 0, suppressed: 0 });
    await bus.start({});
    bus.subscribe('t', () => {});
    transport.emit('t', 2, 'session-id');
    expect(bus.getDedupStats()).toMatchObject({ tracked: 1, accepted: 1, suppressed: 0 });
    await bus.stop();
  });

  it('reports persistence failures through reliability diagnostics and onError', async () => {
    const failure = new Error('persist-failed');
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => { throw failure; })
    };
    const errors: unknown[] = [];
    const events: unknown[] = [];
    const transport = new FakeTransport<unknown>();
    const traced = new CrossTabDataBus({
      autoStart: true,
      clusterKey: 'trace-persistence',
      environment: createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'trace' }).environment,
      initialConfig: {},
      transport,
      replay: { persistence },
      trace: { enabled: true, sink: event => events.push(event) }
    });
    traced.onError(error => errors.push(error));
    traced.subscribe('t', () => {});
    await traced.ready();
    transport.emit('t', 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(errors).toContain(failure);
    expect(events).toContainEqual(expect.objectContaining({ type: 'reliability', operation: 'persistence_cleanup' }));
    await traced.stop();
  });

  it('retries transient persistence append failures when configured', async () => {
    let attempts = 0;
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient append');
      })
    };
    const events: Array<{ type: string; operation?: string; persistenceOperation?: string; attempt?: number }> = [];
    const { bus, transport } = makeReplayBus({ persistence, persistenceRetry: { maxAttempts: 2, backoffMs: 0 } }, undefined, event => events.push(event));
    await bus.ready();
    bus.subscribe('t', () => {});
    transport.emit('t', 1);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(persistence.append).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'reliability', operation: 'persistence_retry', persistenceOperation: 'append', attempt: 1
    }));
    await bus.stop();
  });

  it('recovers across a persistence mutation sequence after a transient failure', async () => {
    let appendAttempts = 0;
    const calls: string[] = [];
    const persistence = {
      load: vi.fn(async () => { calls.push('load'); return []; }),
      append: vi.fn(async () => {
        calls.push('append');
        appendAttempts += 1;
        if (appendAttempts === 1) throw new Error('transient append');
      }),
      clearTopic: vi.fn(async () => { calls.push('clearTopic'); }),
      clear: vi.fn(async () => { calls.push('clear'); })
    };
    const { bus, transport } = makeReplayBus({
      persistence,
      persistenceRetry: { maxAttempts: 2, backoffMs: 0 }
    });
    bus.subscribe('t', () => {});
    await bus.ready();
    transport.emit('t', 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    await bus.clearReplayTopic('t');
    transport.emit('t', 2);
    await new Promise(resolve => setTimeout(resolve, 0));
    await bus.clearReplay();

    expect(calls).toEqual(['load', 'append', 'append', 'clearTopic', 'append', 'clear']);
    expect(persistence.append).toHaveBeenCalledTimes(3);
    await bus.stop();
  });

  it('cancels a pending persistence retry when the bus stops', async () => {
    const errors: unknown[] = [];
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => { throw new Error('temporary'); })
    };
    const { bus, transport } = makeReplayBus({ persistence, persistenceRetry: { maxAttempts: 3, backoffMs: 25 } });
    bus.onError(error => errors.push(error));
    await bus.ready();
    bus.subscribe('t', () => {});
    transport.emit('t', 1);
    await Promise.resolve();
    await bus.stop();
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(persistence.append).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it('rejects invalid persistence retry settings', () => {
    expect(() => makeReplayBus({ persistenceRetry: { maxAttempts: 0 } })).toThrow(TypeError);
    expect(() => makeReplayBus({ persistenceRetry: { maxAttempts: 1.5 } })).toThrow(TypeError);
    expect(() => makeReplayBus({ persistenceRetry: { backoffMs: -1 } })).toThrow(TypeError);
  });

  it('waits the default backoff when a persistenceRetry names only maxAttempts', async () => {
    // The omitted half of a partial policy is the half no test had ever read.
    // `assertPersistenceRetryOptions` checks each field only when present, and every
    // partial object in this file (`{ maxAttempts: 0 }`, `{ maxAttempts: 1.5 }`,
    // `{ backoffMs: -1 }`) throws at one field or the other, so the validator's
    // "backoff omitted" fall-through had never *completed*, and
    // `persistenceRetryBackoffMs: … ?? 50` had never been read for a config that did
    // name an attempt count. `backoffMs: 0` is what separates the two claims here:
    // the retry tests above observe both appends after a single `setTimeout(0)`, so a
    // default that had collapsed to zero would show the retry at the first assertion.
    let attempts = 0;
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient append');
      })
    };
    const events: Array<{ type: string; operation?: string; attempt?: number }> = [];
    const { bus, transport } = makeReplayBus(
      { persistence, persistenceRetry: { maxAttempts: 2 } },
      undefined,
      event => events.push(event)
    );
    await bus.ready();
    bus.subscribe('t', () => {});
    transport.emit('t', 1);
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(persistence.append, 'the default backoff is not zero').toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(persistence.append).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(expect.objectContaining({
      operation: 'persistence_retry', attempt: 1
    }));
    await bus.stop();
  });

  it('does not retry when a persistenceRetry names only backoffMs', async () => {
    // The mirror leg, and it needs its own config: the case above supplies
    // `maxAttempts` and so never reads `persistenceRetryMaxAttempts: … ?? 1`. Naming
    // only a backoff must retry zero times, which is observable without any timing
    // claim at all — the attempt ceiling is reached before the retry event is emitted,
    // so a default that had drifted to 2 would show up as a second `append` (five
    // milliseconds later, well inside the wait) plus a `persistence_retry` event.
    const persistence = {
      load: vi.fn(async () => []),
      append: vi.fn(async () => {
        throw new Error('persistent append failure');
      })
    };
    const events: Array<{ type: string; operation?: string }> = [];
    const { bus, transport } = makeReplayBus(
      { persistence, persistenceRetry: { backoffMs: 5 } },
      undefined,
      event => events.push(event)
    );
    await bus.ready();
    bus.subscribe('t', () => {});
    transport.emit('t', 1);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(persistence.append).toHaveBeenCalledTimes(1);
    expect(events.filter(event => event.operation === 'persistence_retry')).toEqual([]);
    await bus.stop();
  });

  it('routes a caller-supplied publish message ID to the transport', async () => {
    const { bus, transport } = makeReplayBus();
    await bus.ready();
    bus.subscribe('t', () => {});
    bus.publish('t', { value: 1 }, { messageId: 'out-1' });
    expect(transport.publishCalls).toEqual([{ topic: 't', data: { value: 1 }, options: { messageId: 'out-1' } }]);
    await bus.stop();
  });

  it('routes publication metadata through the cluster to the transport', async () => {
    const { bus, transport } = makeReplayBus();
    await bus.ready();
    bus.subscribe('t', () => {});
    bus.publish('t', { value: 1 }, { messageId: 'out-2', timestamp: 1_725_160_000_000 });
    expect(transport.publishCalls).toEqual([{
      topic: 't',
      data: { value: 1 },
      options: { messageId: 'out-2', timestamp: 1_725_160_000_000 }
    }]);
    await bus.stop();
  });
});

describe('CrossTabDataBus diagnostics', () => {
  it('combines lifecycle, dedup, replay, recovery, and cluster snapshots', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'diag' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'diag', environment: env.environment, tabId: 'tab-diag', workerId: 'worker-diag', transport, replay: { maxPerTopic: 4 }, dedup: { maxEntries: 8 } });
    await bus.start({});
    await bus.ready();
    bus.subscribe('topic', () => {});
    transport.emit('topic', 1);
    await Promise.resolve();
    const diagnostics = bus.getDiagnostics();
    expect(['connected', 'ready']).toContain(diagnostics.status);
    expect(diagnostics.started).toBe(true);
    expect(diagnostics.transportReady).toBe(true);
    expect(diagnostics.replay).toMatchObject({ enabled: true, topics: 1, messages: 1, bytes: 8 });
    expect(diagnostics.dedup.enabled).toBe(true);
    expect(diagnostics.cluster.currentWorker.workerId).toBe('worker-diag');
    expect(diagnostics.protocol).toMatchObject({ version: 1, peers: { 'worker-diag': 1 } });
    expect(diagnostics.sdkVersion).toBe(SDK_VERSION);
    expect(diagnostics.transport).toMatchObject({ name: 'FakeTransport' });
    expect(diagnostics.recovery.generation).toBeGreaterThanOrEqual(1);
    await bus.stop();
  });

  it('replay diagnostics expose the approximate buffer byte footprint', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'replay-bytes' });
    const transport = new FakeTransport<unknown>();
    const bus = new CrossTabDataBus({ clusterKey: 'replay-bytes', environment: env.environment, transport, replay: { maxPerTopic: 4 } });
    await bus.start({});
    await bus.ready();
    bus.subscribe('bytes.topic', () => {});
    transport.emit('bytes.topic', 'abcd');
    transport.emit('bytes.topic', 'xyz');
    await Promise.resolve();

    const replay = bus.getDiagnostics().replay;
    expect(replay.messages).toBe(2);
    // Strings size as their length: 'abcd' (4) + 'xyz' (3) = 7.
    expect(replay.bytes).toBe(7);
    await bus.stop();
  });

  it('exposes the current trace metrics window via getMetrics and getDiagnostics', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'metrics' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'metrics', environment: env.environment, tabId: 'tab-metrics', workerId: 'worker-metrics', transport, trace: { enabled: true, sink: () => {} } });
    await bus.start({});
    await bus.ready();
    bus.subscribe('metrics-topic', () => {});
    transport.emit('metrics-topic', 1);
    await Promise.resolve();

    const metrics = bus.getMetrics();
    expect(metrics).not.toBeNull();
    expect(metrics).toMatchObject({ received: 1, dispatched: 1, topics: 1 });
    // The same counters ride inside the unified diagnostics snapshot.
    expect(bus.getDiagnostics().metrics).toMatchObject({ received: 1, dispatched: 1 });
    expect(bus.getDiagnostics().trace).toEqual({ asyncSink: false, pendingEvents: 0 });
    await bus.stop();
  });

  it('restarts trace event delivery after an explicit stop', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'trace-restart' });
    const transport = new FakeTransport<number>();
    const events: DataBusTraceEvent[] = [];
    const bus = new CrossTabDataBus({
      clusterKey: 'trace-restart',
      environment: env.environment,
      transport,
      trace: {
        enabled: true,
        mode: 'events',
        asyncSink: true,
        sink: event => events.push(event)
      }
    });

    await bus.start({});
    await bus.ready();
    await Promise.resolve();
    events.length = 0;

    await bus.stop();
    await Promise.resolve();
    expect(events).toEqual([]);

    await bus.start({});
    await bus.ready();
    await Promise.resolve();
    expect(events[0]).toMatchObject({ type: 'lifecycle', action: 'start' });
    await bus.stop();
  });

  it('getMetrics returns null when trace metrics are disabled', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'metrics-off' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'metrics-off', environment: env.environment, transport, trace: { enabled: false, sink: () => {} } });
    await bus.start({});
    await bus.ready();
    expect(bus.getMetrics()).toBeNull();
    expect(bus.getDiagnostics().metrics).toBeNull();
    expect(bus.getHealthSummary().metrics).toBeNull();
    await bus.stop();
  });

  it('reports a healthy summary while started, visible, and connected', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'health-ok' });
    const transport = new FakeTransport<number>();
      const bus = new CrossTabDataBus({ clusterKey: 'health-ok', environment: env.environment, transport, trace: { enabled: true, sink: () => {} } });
    await bus.start({});
    await bus.ready();
    const health = bus.getHealthSummary();
    expect(health).toMatchObject({
      healthy: true,
      state: 'healthy',
      started: true,
      suspended: false,
      sdkVersion: SDK_VERSION
    });
    expect(health.transport).toMatchObject({ name: 'FakeTransport', backend: null, ready: true });
    expect(health.lastFailure).toBeNull();
    expect(health.metrics).toMatchObject({ received: 0, dispatched: 0 });
    expect(health.trace).toEqual({ asyncSink: false, pendingEvents: 0 });
    expect(health.persistence).toEqual({ failures: 0, lastFailureAt: null, lastErrorMessage: null });
    expect(health.recovery.generation).toBeGreaterThanOrEqual(1);
    await bus.stop();
  });

  it('degrades the summary once automatic recovery is exhausted', async () => {
    vi.useFakeTimers();
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'health-degraded' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'health-degraded',
      environment: env.environment,
      transport,
      recovery: { cooldownMs: 250, maxAttempts: 1 }
    });
    await bus.start({});
    await bus.ready();
    transport.startShouldFail = true;
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(250);
    const health = bus.getHealthSummary();
    expect(health.healthy).toBe(false);
    expect(health.state).toBe('degraded');
    expect(health.recovery.exhausted).toBe(true);
    expect(health.lastFailure).toMatchObject({ source: 'transport' });
    await bus.stop();
    vi.useRealTimers();
  });

  it('unifies persistence failures into the health ledger and diagnostics', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'health-persist' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'health-persist',
      environment: env.environment,
      transport,
      replay: { persistence: { load: async () => [], append: async () => { throw new Error('quota blown'); } } }
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    await bus.start({});
    await bus.ready();
    bus.subscribe('topic', () => {});
    transport.emit('topic', 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(errors.length).toBeGreaterThan(0);
    expect(bus.getPersistenceStats()).toMatchObject({ failures: 1, lastErrorMessage: 'quota blown' });
    expect(bus.getHealthSummary().lastFailure).toMatchObject({ source: 'persistence', message: 'quota blown' });
    expect(bus.getHealthSummary().healthy).toBe(true);
    expect(bus.getDiagnostics().persistence).toMatchObject({ failures: 1 });
    await bus.stop();
  });

  it('reports the suspended state while the tab is hidden', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'health-suspend' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'health-suspend', environment: env.environment, transport });
    await bus.start({});
    await bus.ready();
    env.pageHide();
    expect(bus.getHealthSummary()).toMatchObject({ healthy: false, state: 'suspended', suspended: true });
    expect(bus.getDiagnostics().transport).toMatchObject({ suspended: true, status: 'disconnected' });
    env.pageShow();
    await bus.ready();
    expect(bus.getHealthSummary()).toMatchObject({ healthy: true, state: 'healthy', suspended: false });
    await bus.stop();
  });

  it('resets the failure ledger on a fresh start', async () => {
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => 1_000, randomId: 'health-reset' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'health-reset',
      environment: env.environment,
      transport,
      replay: { persistence: { load: async () => [], append: async () => { throw new Error('boom'); } } }
    });
    await bus.start({});
    await bus.ready();
    bus.subscribe('topic', () => {});
    transport.emit('topic', 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(bus.getPersistenceStats().failures).toBe(1);
    await bus.stop();

    await bus.start({});
    expect(bus.getPersistenceStats()).toEqual({ failures: 0, lastFailureAt: null, lastErrorMessage: null });
    expect(bus.getHealthSummary().lastFailure).toBeNull();
    await bus.stop();
  });
});

describe('CrossTabDataBus cross-tab replay consistency contract', () => {
  async function makeEventBoundaryBus() {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const environment = createFakeEnvironment({
      storage,
      hub,
      now: () => 1_000,
      randomId: 'event-boundary'
    });
    let channelName: string | undefined;
    const createChannel = environment.environment.createChannel;
    environment.environment.createChannel = name => {
      channelName = name;
      return createChannel(name);
    };
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'event-boundary',
      environment: environment.environment,
      tabId: 'tab-boundary',
      workerId: 'worker-boundary',
      transport
    });
    await bus.start({});
    await bus.ready();
    expect(channelName).toBeDefined();
    return { bus, hub, channelName: channelName! };
  }

  function postRawEvent(
    hub: ChannelHub,
    channelName: string,
    eventType: string,
    payload: unknown,
    originTabId?: string
  ): void {
    hub.create(channelName).postMessage({
      type: CLUSTER_MESSAGE_TYPE.EVENT,
      sourceWorkerId: 'legacy-peer',
      eventType,
      payload,
      ...(originTabId === undefined ? {} : { originTabId })
    });
  }

  it('stamps originTabId on the producing tab and preserves it on the neighbor', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = () => 1_000;
    const envA = createFakeEnvironment({ storage, hub, now, randomId: 'cross-tab-replay-a' });
    const envB = createFakeEnvironment({ storage, hub, now, randomId: 'cross-tab-replay-b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'cross-tab-replay',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'cross-tab-replay',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB
    });
    await busA.start({});
    await busB.start({});
    const receivedA: Array<{ data: unknown; originTabId?: string }> = [];
    const receivedB: Array<{ data: unknown; originTabId?: string }> = [];
    busA.subscribe('topic', message => receivedA.push(message));
    busB.subscribe('topic', message => receivedB.push(message));
    await Promise.all([busA.ready(), busB.ready()]);
    transportA.emit('topic', 1);
    await Promise.resolve();
    expect(receivedA).toHaveLength(1);
    expect(receivedA[0]!.originTabId).toBe('tab-a');
    expect(receivedB).toHaveLength(1);
    expect(receivedB[0]!.originTabId).toBe('tab-a');
    await Promise.all([busA.stop(), busB.stop()]);
  });

  it('keeps a producer stamp that arrives on the transport rather than re-stamping it as this tab', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = () => 1_000;
    const envA = createFakeEnvironment({ storage, hub, now, randomId: 'stamped-frame-a' });
    const envB = createFakeEnvironment({ storage, hub, now, randomId: 'stamped-frame-b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'stamped-frame',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'stamped-frame',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB
    });
    await busA.start({});
    await busB.start({});
    const receivedA: Array<{ data: unknown; originTabId?: string }> = [];
    const receivedB: Array<{ data: unknown; originTabId?: string }> = [];
    busA.subscribe('topic', message => receivedA.push(message));
    busB.subscribe('topic', message => receivedB.push(message));
    await Promise.all([busA.ready(), busB.ready()]);

    // A transport is a public extension point, and a proxying or replaying one
    // hands back a frame that already names its producer. `handleTransportMessage`
    // stamps only when the field is absent: overwriting here attributes someone
    // else's publication to the receiving tab, and every consumer downstream —
    // the neighbor's EVENT fan-out and the replay history both — inherits the lie.
    transportA.emit('topic', 1, undefined, undefined, 'tab-remote');
    await Promise.resolve();
    expect(receivedA).toHaveLength(1);
    expect(receivedA[0]!.originTabId).toBe('tab-remote');
    expect(receivedB).toHaveLength(1);
    expect(receivedB[0]!.originTabId).toBe('tab-remote');
    await Promise.all([busA.stop(), busB.stop()]);
  });

  it('producing tab\'s local handler sees the same originTabId it broadcasts', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = () => 1_000;
    const envA = createFakeEnvironment({ storage, hub, now, randomId: 'cross-tab-replay-c-a' });
    const envB = createFakeEnvironment({ storage, hub, now, randomId: 'cross-tab-replay-c-b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'cross-tab-replay-c',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'cross-tab-replay-c',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB
    });
    await busA.start({});
    await busB.start({});
    const receivedA: Array<{ data: unknown; originTabId?: string }> = [];
    const receivedB: Array<{ data: unknown; originTabId?: string }> = [];
    busA.subscribe('topic', message => receivedA.push(message));
    busB.subscribe('topic', message => receivedB.push(message));
    await Promise.all([busA.ready(), busB.ready()]);
    transportA.emit('topic', 42);
    await Promise.resolve();
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    expect(receivedA[0]!.originTabId).toBe('tab-a');
    expect(receivedB[0]!.originTabId).toBe('tab-a');
    await Promise.all([busA.stop(), busB.stop()]);
  });

  it('replays history on a tab that joins after writes, with the producing tab\'s originTabId', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = () => 1_000;
    const envA = createFakeEnvironment({ storage, hub, now, randomId: 'cross-tab-replay-p-a' });
    const envB = createFakeEnvironment({ storage, hub, now, randomId: 'cross-tab-replay-p-b' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    // Persistence is a shared array. Bus A appends; bus B hydrates from it on
    // construction (i.e. when it joins after bus A has already written).
    const persistentBuffer: Array<{ topic: string; data: unknown; timestamp?: number; originTabId?: string }> = [];
    const persistence = {
      load: vi.fn(async () => persistentBuffer.slice()),
      append: vi.fn(async (message: { topic: string; data: unknown; timestamp?: number; originTabId?: string }) => {
        const entry: { topic: string; data: unknown; timestamp?: number; originTabId?: string } = { topic: message.topic, data: message.data };
        if (message.timestamp !== undefined) entry.timestamp = message.timestamp;
        if (message.originTabId !== undefined) entry.originTabId = message.originTabId;
        persistentBuffer.push(entry);
      }),
      clearTopic: vi.fn(async () => {}),
      clearBefore: vi.fn(async () => {}),
      clear: vi.fn(async () => {})
    };
    const busA = new CrossTabDataBus({
      clusterKey: 'cross-tab-replay-p',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA,
      replay: { maxPerTopic: 8, persistence }
    });
    await busA.start({});
    await busA.ready();
    busA.subscribe('topic', () => {});
    transportA.emit('topic', 1);
    transportA.emit('topic', 2);
    // Allow bus A's persistence appends to settle.
    await new Promise(resolve => setTimeout(resolve, 20));
    await busA.stop();
    // Bus B opens after A — its hydrateReplay reads the shared persistence.
    const busB = new CrossTabDataBus({
      clusterKey: 'cross-tab-replay-p',
      environment: envB.environment,
      tabId: 'tab-b',
      workerId: 'worker-b',
      transport: transportB,
      replay: { maxPerTopic: 8, persistence }
    });
    await busB.start({});
    await busB.ready();
    const lateReceived: Array<{ data: unknown; replayed?: boolean; originTabId?: string }> = [];
    busB.subscribe('topic', message => lateReceived.push(message), { replay: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lateReceived.map(message => message.data)).toEqual([1, 2]);
    expect(lateReceived.every(message => message.replayed === true && message.originTabId === 'tab-a')).toBe(true);
    await busB.stop();
  });

  it('replayed messages from local origin still carry the producing tab\'s originTabId', async () => {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const now = () => 1_000;
    const envA = createFakeEnvironment({ storage, hub, now, randomId: 'cross-tab-replay-local-a' });
    const transportA = new FakeTransport<number>();
    const busA = new CrossTabDataBus({
      clusterKey: 'cross-tab-replay-local',
      environment: envA.environment,
      tabId: 'tab-a',
      workerId: 'worker-a',
      transport: transportA,
      replay: { maxPerTopic: 8 }
    });
    await busA.start({});
    await busA.ready();
    busA.subscribe('topic', () => {});
    transportA.emit('topic', 1);
    transportA.emit('topic', 2);
    await Promise.resolve();
    const replayed: Array<{ data: unknown; replayed?: boolean; originTabId?: string }> = [];
    busA.subscribe('topic', message => replayed.push(message), { replay: true });
    await Promise.resolve();
    expect(replayed.map(message => message.data)).toEqual([1, 2]);
    expect(replayed.every(message => message.replayed === true && message.originTabId === 'tab-a')).toBe(true);
    await busA.stop();
  });

  it('falls back to the frame originTabId for legacy EVENT payloads and prefers payload attribution', async () => {
    const { bus, hub, channelName } = await makeEventBoundaryBus();
    const received: Array<{ data: unknown; originTabId?: string }> = [];
    bus.subscribe('topic', message => received.push(message));

    postRawEvent(hub, channelName, PUBLICATION_EVENT, { topic: 'topic', data: 'legacy' }, 'tab-frame');
    postRawEvent(
      hub,
      channelName,
      PUBLICATION_EVENT,
      { topic: 'topic', data: 'payload', originTabId: 'tab-payload' },
      'tab-frame'
    );
    postRawEvent(hub, channelName, PUBLICATION_EVENT, { topic: 'topic', data: 'unattributed' });

    expect(received).toEqual([
      expect.objectContaining({ data: 'legacy', originTabId: 'tab-frame' }),
      expect.objectContaining({ data: 'payload', originTabId: 'tab-payload' }),
      expect.objectContaining({ data: 'unattributed' })
    ]);
    expect(received[2]!.originTabId).toBeUndefined();
    await bus.stop();
  });

  it('ignores non-publication and malformed EVENT frames without breaking the listener', async () => {
    const { bus, hub, channelName } = await makeEventBoundaryBus();
    const handler = vi.fn();
    bus.subscribe('topic', handler);

    expect(() => {
      postRawEvent(hub, channelName, 'presence', { topic: 'topic', data: 'foreign' }, 'tab-frame');
      postRawEvent(hub, channelName, PUBLICATION_EVENT, null, 'tab-frame');
      postRawEvent(hub, channelName, PUBLICATION_EVENT, { data: 'missing-topic' }, 'tab-frame');
      postRawEvent(hub, channelName, PUBLICATION_EVENT, { topic: 42, data: 'invalid-topic' }, 'tab-frame');
      postRawEvent(hub, channelName, PUBLICATION_EVENT, { topic: 'topic', data: 'valid' }, 'tab-frame');
    }).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ data: 'valid', originTabId: 'tab-frame' }));
    await bus.stop();
  });
});

describe('adaptive dedup TTL', () => {
  it('reports bounded TTL and resets its sampling window', async () => {
    let now = 1_000;
    const env = createFakeEnvironment({ storage: new MemoryStorage(), now: () => now, randomId: 'adaptive' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({ clusterKey: 'adaptive', environment: env.environment, tabId: 'tab-adaptive', workerId: 'worker-adaptive', transport, dedup: { ttlMs: 1000, adaptiveTtl: { minMs: 100, maxMs: 2000 }, now: () => now } });
    await bus.start({}); await bus.ready(); bus.subscribe('topic', () => {});
    transport.emit('topic', 1, 'm1');
    expect(bus.getDedupStats().ttlMs).toBeGreaterThanOrEqual(100);
    now += 6000;
    expect(bus.getDedupStats().ttlMs).toBe(2000);
    await bus.stop();
  });
});

describe('CrossTabDataBus lifecycle contract edges', () => {
  afterEach(() => vi.useRealTimers());

  function makeBus(overrides: Record<string, unknown> = {}) {
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const environment = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'edge' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'lifecycle-edges',
      environment: environment.environment,
      initialConfig: {},
      transport,
      ...overrides
    });
    return { bus, transport, environment, storage, hub };
  }

  it('ready() rejects with the configuration error when no initialConfig exists', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'no-config' });
    const transport = new FakeTransport<number>();
    const bus = new CrossTabDataBus({
      clusterKey: 'no-config',
      environment: environment.environment,
      transport
    });
    // ready() converts the ensureStarted throw into a rejection so callers can
    // await it uniformly instead of needing a try/catch around the call.
    await expect(bus.ready()).rejects.toThrow('requires initialConfig');
    expect(transport.startCalls).toBe(0);
  });

  it('ready() surfaces the last transport failure once no start is in flight', async () => {
    const { bus, transport } = makeBus();
    transport.startShouldFail = true;
    await expect(bus.ready()).rejects.toBeTruthy();

    // With the opening settled and the transport still not ready, a second
    // ready() must resurface the recorded failure rather than resolving or
    // producing the generic "no start in flight" error.
    await expect(bus.ready()).rejects.toBeTruthy();
    await bus.stop();
  });

  it('isolates a transport that throws synchronously or rejects during an operation', async () => {
    // A misbehaving transport must not break the DataBus: a synchronous throw
    // from publish() and a rejected promise from subscribe() both have to be
    // funnelled into onError instead of escaping the caller or being lost.
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'throwing-transport' });
    const errors: unknown[] = [];
    const transport = {
      start: (_config: object, handlers: { onStatus: (status: string) => void }) => {
        handlers.onStatus('connected');
      },
      stop: () => {},
      subscribe: () => Promise.reject(new Error('async subscribe boom')),
      unsubscribe: () => {},
      publish: () => {
        throw new Error('sync transport boom');
      }
    } as unknown as FakeTransport<number>;
    const bus = new CrossTabDataBus({
      clusterKey: 'throwing-transport',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.onError(error => errors.push(error));
    await bus.ready();

    // The synchronous throw is caught inside runTransport, never propagated.
    expect(() => bus.publish('t', 1)).not.toThrow();
    // The rejected subscribe promise is reported asynchronously.
    bus.subscribe('t', () => {});
    await vi.waitFor(() => {
      expect(errors.map(String).some(message => message.includes('sync transport boom'))).toBe(true);
      expect(errors.map(String).some(message => message.includes('async subscribe boom'))).toBe(true);
    });

    await bus.stop();
  });

  it('reports a queued operation rejection once without an unhandled rejection', async () => {
    // A subscribe() issued while the initial open is still pending is parked
    // behind startPromise and released from the runTransport() continuation.
    // Its rejection must reach onError exactly once and must not escape as an
    // unhandled rejection after the start gate is released.
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'queued-op-rejection' });
    let releaseStart!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    const subscribe = vi.fn(() => Promise.reject(new Error('queued subscribe boom')));
    const transport: DataBusTransport<object, number> = {
      start: (_config, handlers) => startGate.then(() => {
        handlers.onStatus(WORKER_STATUS.CONNECTED);
      }),
      stop: () => undefined,
      subscribe,
      unsubscribe: () => undefined,
      publish: () => undefined
    };
    const errors: unknown[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const bus = new CrossTabDataBus({
        clusterKey: 'queued-op-rejection',
        environment: environment.environment,
        initialConfig: {},
        transport
      });
      bus.onError(error => errors.push(error));
      bus.subscribe('topic', vi.fn());

      // The operation is queued, not written to the still-opening transport.
      expect(subscribe).not.toHaveBeenCalled();
      releaseStart();
      await bus.ready();

      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(String(errors[0])).toContain('queued subscribe boom');
      // Let the rejection and reporter settle fully before asserting that no
      // second report or unhandled rejection was produced.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(errors).toHaveLength(1);
      expect(unhandled).toEqual([]);
      await bus.stop();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('the owning tab fans out to a peer subscriber and records the message discarded locally', async () => {
    // The realistic shape of the third dispatch gate: tab A wins ownership of
    // a topic only tab B subscribes to. A must broadcast the publication to B
    // and then record it as *discarded* locally — counting it as dispatched
    // would inflate A's throughput and skew its latency percentiles with a
    // message A never handed to a handler.
    const storage = new MemoryStorage();
    const hub = new ChannelHub();
    const envA = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'owner' });
    const envB = createFakeEnvironment({ storage, hub, now: () => 1_000, randomId: 'peer' });
    const transportA = new FakeTransport<number>();
    const transportB = new FakeTransport<number>();
    const trace = { enabled: true, sink: () => undefined };
    const busA = new CrossTabDataBus({
      clusterKey: 'fanout', environment: envA.environment, initialConfig: {}, transport: transportA, trace
    });
    const busB = new CrossTabDataBus({
      clusterKey: 'fanout', environment: envB.environment, initialConfig: {}, transport: transportB, trace
    });
    await busA.ready();
    await busB.ready();

    const peerHandler = vi.fn();
    busB.subscribe('shared', peerHandler);
    // Converge: A takes the transport subscription, B keeps only the handler.
    for (let round = 0; round < 10; round += 1) {
      await Promise.resolve();
      envA.runIntervals();
      envB.runIntervals();
    }
    expect(transportA.subscribeCalls).toContain('shared');
    expect(transportB.subscribeCalls).toEqual([]);

    transportA.emit('shared', 7);
    await Promise.resolve();

    // Delivered to the peer...
    expect(peerHandler).toHaveBeenCalledTimes(1);
    // ...and counted as received-but-not-dispatched on the owner.
    const ownerMetrics = busA.getMetrics()!;
    expect(ownerMetrics.received).toBe(1);
    expect(ownerMetrics.dispatched).toBe(0);
    expect(ownerMetrics.dispatchSamples).toBe(0);

    await busA.stop();
    await busB.stop();
  });

  it('unsubscribe is a no-op for an unknown topic and for an unregistered handler', async () => {
    const { bus, transport } = makeBus();
    await bus.ready();
    const handler = vi.fn();
    bus.subscribe('t', handler);
    expect(transport.subscribeCalls).toEqual(['t']);

    // Unknown topic: nothing to remove, and the live subscription is untouched.
    expect(() => bus.unsubscribe('ghost')).not.toThrow();
    // Known topic, foreign handler: the set is non-empty afterwards, so the
    // transport subscription must survive.
    bus.unsubscribe('t', vi.fn());
    expect(transport.unsubscribeCalls).toEqual([]);

    transport.emit('t', 5);
    await Promise.resolve();
    expect(handler).toHaveBeenCalled();

    // Removing the last handler does tear the transport subscription down.
    bus.unsubscribe('t', handler);
    await vi.waitFor(() => expect(transport.unsubscribeCalls).toEqual(['t']));
    await bus.stop();
  });

  it('unsubscribe(topic) without a handler tears down every handler, the subscription, and replay history once', async () => {
    // The no-handler form is the documented whole-topic teardown, but the
    // existing edge tests only ever pass a handler (or hit the unknown-topic
    // early return), so `handlers.clear()` and its n→0 teardown were never
    // exercised.
    const { bus, transport } = makeBus({ replay: { maxPerTopic: 4 } });
    await bus.ready();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = bus.subscribe('t', first);
    const offSecond = bus.subscribe('t', second);
    expect(transport.subscribeCalls).toEqual(['t']);

    // Buffer replay history for this topic so the teardown can be shown to
    // drop it as well.
    transport.emit('t', 1);
    transport.emit('t', 2);
    const firstLive = first.mock.calls.length;
    const secondLive = second.mock.calls.length;
    expect(firstLive).toBeGreaterThan(0);
    expect(secondLive).toBeGreaterThan(0);

    bus.unsubscribe('t');
    await vi.waitFor(() => expect(transport.unsubscribeCalls).toEqual(['t']));

    // Both handlers stop receiving live deliveries.
    transport.emit('t', 3);
    await Promise.resolve();
    expect(first.mock.calls.length).toBe(firstLive);
    expect(second.mock.calls.length).toBe(secondLive);

    // The per-handler closers returned by the original subscribes are now
    // no-ops: they must not trigger a second transport teardown.
    offFirst();
    offSecond();
    await Promise.resolve();
    expect(transport.unsubscribeCalls).toEqual(['t']);

    // Re-subscribing re-establishes the transport subscription, and the
    // prior history was dropped with the topic (no stale replay delivery).
    const rejoined = vi.fn();
    bus.subscribe('t', rejoined, { replay: true });
    expect(rejoined).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(transport.subscribeCalls).toEqual(['t', 't']));
    transport.emit('t', 4);
    await Promise.resolve();
    expect(rejoined).toHaveBeenCalledTimes(1);

    await bus.stop();
  });

  it('stop() is idempotent and stops the transport exactly once', async () => {
    const { bus, transport } = makeBus();
    await bus.ready();
    bus.subscribe('t', vi.fn());
    await bus.stop();
    const stopsAfterFirst = transport.stopCalls;
    await bus.stop();
    await bus.stop();
    expect(transport.stopCalls).toBe(stopsAfterFirst);
  });

  it('publish() during an in-flight stop reports an error instead of silently dropping the message', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-publish' });
    let releaseStop!: () => void;
    const transport = new FakeTransport<number>();
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-publish',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    await bus.ready();
    bus.subscribe('t', vi.fn());
    expect(transport.subscribeCalls).toEqual(['t']);

    const stopping = bus.stop();
    // performStop sets `stopping` before it awaits the gated transport.stop(),
    // so this publish lands squarely in the teardown window.
    bus.publish('t', 1);

    expect(transport.publishCalls).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toMatch(/stopping/i);

    releaseStop();
    await stopping;
  });

  it('publishBatch() during an in-flight stop reports an error and sends nothing', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-publish-batch' });
    let releaseStop!: () => void;
    const transport = new FakeTransport<number>(undefined, { supportsPublishBatch: true });
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-publish-batch',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    await bus.ready();
    bus.subscribe('t', vi.fn());

    const stopping = bus.stop();
    bus.publishBatch('t', [{ data: 1 }, { data: 2 }]);

    expect(transport.publishBatchCalls).toHaveLength(0);
    expect(transport.publishCalls).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toMatch(/batch/i);
    expect((errors[0] as Error).message).toMatch(/stopping/i);

    releaseStop();
    await stopping;
  });
  it('subscribe() during an in-flight stop reports an error and leaves no latent subscription', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-subscribe' });
    let releaseStop!: () => void;
    const transport = new FakeTransport<number>();
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-subscribe',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    const errors: unknown[] = [];
    bus.onError(error => errors.push(error));
    await bus.ready();
    bus.subscribe('before', vi.fn());
    expect(transport.subscribeCalls).toEqual(['before']);

    const stopping = bus.stop();
    const lateHandler = vi.fn();
    const offLate = bus.subscribe('late', lateHandler);

    expect(offLate).toBeTypeOf('function');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toMatch(/stopping/i);
    expect((errors[0] as Error).message).toMatch(/subscribe/i);
    expect(bus.getClusterSnapshot().subscribedTopics).not.toContain('late');
    expect(transport.subscribeCalls).toEqual(['before']);

    releaseStop();
    await stopping;
    offLate();
    expect(bus.getClusterSnapshot().subscribedTopics).toEqual([]);

    // A later restart must not resurrect the rejected registration.
    await bus.start({});
    await bus.ready();
    expect(bus.getClusterSnapshot().subscribedTopics).toEqual([]);
    expect(transport.subscribeCalls).toEqual(['before']);
    transport.emit('late', 1);
    await Promise.resolve();
    expect(lateHandler).not.toHaveBeenCalled();
    await bus.stop();
  });

  it('ready() during an in-flight stop rejects instead of reporting the stopping transport as ready', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'stop-ready' });
    let releaseStop!: () => void;
    const transport = new FakeTransport<number>();
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'stop-ready',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    await bus.ready();

    const stopping = bus.stop();
    await expect(bus.ready()).rejects.toThrow(/stopping/i);
    expect(transport.startCalls).toBe(1);

    releaseStop();
    await stopping;
  });
  it('surfaces a failed queued restart and allows a clean explicit retry', async () => {
    const storage = new MemoryStorage();
    const environment = createFakeEnvironment({ storage, now: () => 1_000, randomId: 'queued-restart-failure' });
    let releaseStop!: () => void;
    const transport = new FakeTransport<number>();
    transport.stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const bus = new CrossTabDataBus({
      clusterKey: 'queued-restart-failure',
      environment: environment.environment,
      transport
    });
    await bus.start({});
    expect(transport.startCalls).toBe(1);

    const stopping = bus.stop();
    await vi.waitFor(() => expect(transport.stopCalls).toBe(1));
    transport.startShouldFail = true;
    const restarting = bus.start({});
    releaseStop();
    await stopping;

    // The queued lifecycle reports its own transport failure...
    await expect(restarting).rejects.toThrow('Transport failed during startup.');
    // ...and a later ready() must surface that failure rather than masking it
    // with the "requires initialConfig" error for an explicit start(config).
    await expect(bus.ready()).rejects.toThrow('Transport failed during startup.');

    // The failed restart must not leave a stale lifecycle gate behind: an
    // explicit retry after the transport recovers starts cleanly.
    transport.startShouldFail = false;
    await bus.start({});
    await bus.ready();
    expect(transport.startCalls).toBe(3);
    expect(bus.getHealthSummary()).toMatchObject({ started: true, state: 'healthy' });
    await bus.stop();
  });

});
