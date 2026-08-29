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
});
