import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataBusTraceReporter } from '../src/core/trace';
import type { DataBusTraceEvent } from '../src/core/trace';
import { CrossTabDataBus } from '../src/core/data-bus';
import { ChannelHub, createFakeEnvironment, FakeTransport, MemoryStorage } from './fakes';

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
    expect(first).toHaveBeenCalledWith({ topic: 'topic', data: 42 });
    expect(second).toHaveBeenCalledWith({ topic: 'topic', data: 42 });

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
    expect(handler2).toHaveBeenCalledWith({ topic: 'topic', data: 42 });
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
    transport.setStatus('error');
    await vi.advanceTimersByTimeAsync(250);
    expect(events.filter(event => typeof event === 'object' && event !== null && 'outcome' in event && (event as { outcome?: string }).outcome === 'exhausted')).toHaveLength(1);
    transport.startShouldFail = false;
    bus.subscribe('topic-2', vi.fn());
    await bus.ready();
    expect(transport.startCalls).toBe(4);
    await bus.stop();
  });

  it('rejects invalid recovery attempt limits', () => {
    expect(() => new CrossTabDataBus({ clusterKey: 'bad-max', transport: new FakeTransport(), recovery: { maxAttempts: 0 } })).toThrow('recovery.maxAttempts');
    expect(() => new CrossTabDataBus({ clusterKey: 'bad-max-float', transport: new FakeTransport(), recovery: { maxAttempts: 1.5 } })).toThrow('recovery.maxAttempts');
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
    expect(bus.getRecoveryStats()).toEqual({ attempt: 0, exhausted: false, maxAttempts: 2, hasError: false, errorMessage: null, errorAt: null });
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
    expect(bus.getRecoveryStats()).toMatchObject({ attempt: 0, exhausted: false, maxAttempts: 2, hasError: true, errorMessage: 'Transport failed during startup.', errorAt: expect.any(Number) });
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
    await bus.ready();
    expect(transport.publishCalls).toEqual([]);
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
});

describe('CrossTabDataBus replay (bounded local history)', () => {
  function makeReplayBus(replay?: { maxPerTopic?: number; retentionMs?: number; retentionSweepMs?: number; persistenceRetry?: { maxAttempts?: number; backoffMs?: number }; persistence?: { load: () => Promise<ReadonlyArray<{ topic: string; data: unknown; timestamp?: number }>>; append: (message: { topic: string; data: unknown; timestamp?: number }) => Promise<void>; clearTopic?: () => Promise<void>; clearBefore?: (timestamp: number) => Promise<void>; clear?: () => Promise<void> } }, dedup?: { maxEntries?: number; ttlMs?: number; sweepMs?: number; now?: () => number }, trace?: (event: Parameters<NonNullable<ConstructorParameters<typeof CrossTabDataBus>[0]['trace']>['sink']>[0]) => void) {
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
    expect(appended).toEqual([{ topic: 't', data: 'new' }]);
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
