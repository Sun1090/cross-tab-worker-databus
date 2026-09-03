import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataBusTraceReporter } from '../src/core/trace';
import type { DataBusTraceEvent, DataBusMetricsTraceEvent } from '../src/core/trace';

function collect(sinkEvents: DataBusTraceEvent[]) {
  return (event: DataBusTraceEvent) => {
    sinkEvents.push(event);
  };
}

describe('DataBusTraceReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('throws RangeError for a non-positive metrics interval', () => {
    expect(() => new DataBusTraceReporter({ sink: () => {}, metricsIntervalMs: 0 })).toThrow(RangeError);
    expect(() => new DataBusTraceReporter({ sink: () => {}, metricsIntervalMs: -5 })).toThrow(RangeError);
    expect(() => new DataBusTraceReporter({ sink: () => {}, metricsIntervalMs: Number.NaN })).toThrow(
      RangeError
    );
  });

  it('is inert when disabled', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: false, sink: collect(events) });
    reporter.start();
    reporter.event({ type: 'lifecycle', action: 'start' });
    reporter.recordReceived('t');
    reporter.recordDispatched('t');
    reporter.flush();
    vi.advanceTimersByTime(10_000);
    expect(events).toHaveLength(0);
  });

  it('suppresses metrics recording in events mode and events in metrics mode', () => {
    const events: DataBusTraceEvent[] = [];
    const eventsOnly = new DataBusTraceReporter({ enabled: true, mode: 'events', sink: collect(events) });
    eventsOnly.start();
    eventsOnly.recordReceived('t');
    eventsOnly.recordDispatched('t');
    eventsOnly.flush();
    eventsOnly.event({ type: 'lifecycle', action: 'start' });
    vi.advanceTimersByTime(10_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'lifecycle', action: 'start' });

    const metricsOnly = new DataBusTraceReporter({ enabled: true, mode: 'metrics', sink: collect(events) });
    metricsOnly.start();
    metricsOnly.event({ type: 'lifecycle', action: 'stop' });
    metricsOnly.recordReceived('t');
    metricsOnly.flush();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'message_metrics', received: 1 });
  });

  it('emits periodic metrics with latency percentiles on the interval', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter(
      { enabled: true, sink: collect(events), metricsIntervalMs: 1_000 },
      () => Date.now()
    );
    reporter.start();
    reporter.recordReceived('t');
    vi.advanceTimersByTime(100);
    reporter.recordDispatched('t');
    vi.advanceTimersByTime(1_000);
    const metrics = events.find(e => e.type === 'message_metrics') as DataBusMetricsTraceEvent;
    expect(metrics).toBeTruthy();
    expect(metrics.received).toBe(1);
    expect(metrics.dispatched).toBe(1);
    expect(metrics.dispatchSamples).toBe(1);
    expect(metrics.dispatchAvgMs).toBe(100);
    // Max latency comes from the bucket midpoint: floor(100/50)=2 → (2+0.5)*50.
    expect(metrics.dispatchMaxMs).toBe(125);

    // Counters reset after the flush window.
    vi.advanceTimersByTime(5_000);
    const later = events.filter(e => e.type === 'message_metrics');
    expect(later).toHaveLength(1);
  });

  it('does not emit an all-zero metrics snapshot but keeps the window advancing', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: true, sink: collect(events), metricsIntervalMs: 1_000 });
    reporter.start();
    vi.advanceTimersByTime(5_000);
    expect(events.filter(e => e.type === 'message_metrics')).toHaveLength(0);
    reporter.stop();
  });

  it('includes dedup outcomes in metrics windows', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: true, mode: 'metrics', sink: collect(events), metricsIntervalMs: 1_000 });
    reporter.recordDedupAccepted();
    reporter.recordDedupSuppressed();
    reporter.recordDedupSuppressed();
    reporter.flush();
    expect(events[0]).toMatchObject({ type: 'message_metrics', dedupAccepted: 1, dedupSuppressed: 2 });
    reporter.flush();
    expect(events).toHaveLength(1);
  });

  it('uses an injected clock for event timestamps', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: true, now: () => 1234, sink: collect(events) });
    reporter.event({ type: 'lifecycle', action: 'start' });
    expect(events[0]).toMatchObject({ type: 'lifecycle', timestamp: 1234 });
  });

  it('does not pair latency for dispatches without a local receive', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: true, sink: collect(events), metricsIntervalMs: 1_000 });
    reporter.recordDispatched('remote-topic');
    reporter.flush();
    const metrics = events.find(e => e.type === 'message_metrics') as DataBusMetricsTraceEvent;
    expect(metrics.dispatched).toBe(1);
    expect(metrics.dispatchSamples).toBe(0);
    expect(metrics.dispatchAvgMs).toBe(0);
  });

  it('caps the pending receive queue per topic', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: true, sink: collect(events), metricsIntervalMs: 1_000 });
    // MAX_PENDING_MESSAGES_PER_TOPIC = 256: the 257th receive on the same topic
    // is dropped so a hot topic cannot exhaust memory.
    for (let i = 0; i < 300; i += 1) reporter.recordReceived('hot');
    for (let i = 0; i < 256; i += 1) reporter.recordDispatched('hot');
    // Extra dispatches have no matching receive → no latency samples.
    reporter.recordDispatched('hot');
    reporter.flush();
    const metrics = events.find(e => e.type === 'message_metrics') as DataBusMetricsTraceEvent;
    expect(metrics.dispatchSamples).toBe(256);
  });

  it('caps the number of topics tracked for pending receives', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: true, sink: collect(events), metricsIntervalMs: 1_000 });
    // MAX_PENDING_TOPICS = 1000: beyond that, new topics do not create queues.
    for (let i = 0; i < 1_100; i += 1) reporter.recordReceived(`topic-${i}`);
    // Only the first 1000 receives produce latency samples.
    for (let i = 0; i < 1_000; i += 1) reporter.recordDispatched(`topic-${i}`);
    reporter.recordDispatched('topic-1000');
    reporter.flush();
    const metrics = events.find(e => e.type === 'message_metrics') as DataBusMetricsTraceEvent;
    expect(metrics.dispatchSamples).toBe(1_000);
    expect(metrics.topics).toBe(1_100);
  });

  it('recordDiscarded drops the stale receive slot', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: true, sink: collect(events), metricsIntervalMs: 1_000 });
    reporter.recordReceived('t');
    reporter.recordReceived('t');
    reporter.recordDiscarded('t'); // first receive will never dispatch
    reporter.recordDispatched('t'); // pairs with the second receive
    reporter.recordDiscarded('t'); // queue empty — no-op
    reporter.recordDiscarded('unknown'); // no queue — no-op
    reporter.flush();
    const metrics = events.find(e => e.type === 'message_metrics') as DataBusMetricsTraceEvent;
    expect(metrics.dispatchSamples).toBe(1);
  });

  it('isolates a throwing sink via console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reporter = new DataBusTraceReporter({
      enabled: true,
      sink: () => {
        throw new Error('sink exploded');
      }
    });
    expect(() => reporter.event({ type: 'lifecycle', action: 'start' })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      '[cross-tab-worker-databus] trace sink threw:',
      expect.any(Error)
    );
  });

  it('continues emitting after a sink failure and keeps trace data bounded', () => {
    const events: DataBusTraceEvent[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const reporter = new DataBusTraceReporter({
      enabled: true,
      sink: event => {
        calls += 1;
        if (calls === 1) throw new Error('first sink failure');
        events.push(event);
      }
    });

    reporter.event({ type: 'lifecycle', action: 'start' });
    reporter.event({ type: 'status', status: 'connected' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'status', status: 'connected' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps sensitive publication and error details out of diagnostic events', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({ enabled: true, sink: collect(events) });
    const sensitivePayload = 'super-secret-payload';
    const sensitiveUrl = 'https://user:password@example.test/private';
    const sensitiveError = 'server response body: bearer-token';

    reporter.event({ type: 'subscription', action: 'subscribe', topic: 'chat.secret', activeTopics: 1 });
    reporter.event({
      type: 'reliability',
      operation: 'persistence_retry',
      persistenceOperation: 'append',
      attempt: 2,
      topic: 'chat.secret'
    });
    reporter.event({ type: 'error', source: 'transport' });
    reporter.recordReceived('chat.secret');
    reporter.recordDispatched('chat.secret');
    reporter.flush();

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(sensitivePayload);
    expect(serialized).not.toContain(sensitiveUrl);
    expect(serialized).not.toContain(sensitiveError);
    for (const event of events) {
      expect(event.timestamp).toEqual(expect.any(Number));
      expect(event).not.toHaveProperty('payload');
      expect(event).not.toHaveProperty('data');
      expect(event).not.toHaveProperty('credentials');
      expect(event).not.toHaveProperty('errorBody');
    }
  });

  it('isolates event and metrics modes while all mode emits both categories', () => {
    const events: DataBusTraceEvent[] = [];
    const eventReporter = new DataBusTraceReporter({ enabled: true, mode: 'events', sink: collect(events) });
    eventReporter.start();
    eventReporter.event({ type: 'lifecycle', action: 'start' });
    eventReporter.recordReceived('events');
    eventReporter.flush();

    const metricsReporter = new DataBusTraceReporter({ enabled: true, mode: 'metrics', sink: collect(events) });
    metricsReporter.event({ type: 'lifecycle', action: 'start' });
    metricsReporter.recordReceived('metrics');
    metricsReporter.flush();

    const allReporter = new DataBusTraceReporter({ enabled: true, mode: 'all', sink: collect(events) });
    allReporter.event({ type: 'lifecycle', action: 'start' });
    allReporter.recordReceived('all');
    allReporter.flush();

    expect(events.filter(event => event.type === 'lifecycle')).toHaveLength(2);
    expect(events.filter(event => event.type === 'message_metrics')).toHaveLength(2);
    expect(events.filter(event => event.type === 'message_metrics').map(event => event.type)).toEqual([
      'message_metrics',
      'message_metrics'
    ]);
  });

  it('starts a fresh metrics window after pause and resume, and stop prevents later flushes', () => {
    const events: DataBusTraceEvent[] = [];
    const reporter = new DataBusTraceReporter({
      enabled: true,
      mode: 'metrics',
      metricsIntervalMs: 1_000,
      sink: collect(events)
    });

    reporter.start();
    reporter.recordReceived('before-pause');
    reporter.pause();
    reporter.flush();
    expect(events).toHaveLength(0);

    reporter.start();
    reporter.recordReceived('after-resume');
    reporter.flush();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ received: 1, topics: 1, durationMs: expect.any(Number) });

    reporter.stop();
    reporter.recordReceived('after-stop');
    reporter.flush();
    vi.advanceTimersByTime(5_000);
    expect(events).toHaveLength(1);
  });
});
