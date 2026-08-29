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
      transport
    });
    await bus.start({});
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
    await Promise.resolve();

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
