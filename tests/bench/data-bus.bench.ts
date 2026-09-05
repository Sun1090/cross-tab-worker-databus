/**
 * Public data-bus benchmarks for the message hot paths.
 *
 * These are intentionally small loops so local runs can compare publish,
 * receive, routing, deduplication, replay, persistence, and trace costs
 * without involving a real browser or network server.
 */
import { bench, describe } from 'vitest';
import { CrossTabDataBus } from '../../src/core/data-bus';
import { DataBusTraceReporter } from '../../src/core/trace';
import type { DataBusMessage } from '../../src/core/types';
import { createFakeEnvironment, FakeTransport, MemoryStorage } from '../fakes';
import { PRUNE_STRATEGY, TRACE_EVENT_TYPE, TRACE_MODE, WORKER_STATUS } from '../../src/utils/constants';

function makeEnvironment(randomId: string) {
  return createFakeEnvironment({
    storage: new MemoryStorage(),
    now: () => 1_000,
    randomId
  });
}

function makePersistence() {
  const messages: DataBusMessage<{ value: number }>[] = [];
  return {
    messages,
    load: async () => messages,
    append: async (message: DataBusMessage<{ value: number }>) => {
      messages.push(message);
    },
    appendBatch: async (batch: ReadonlyArray<DataBusMessage<{ value: number }>>) => {
      messages.push(...batch);
    },
    clearBefore: async (timestamp: number) => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]!;
        if (message.timestamp !== undefined && message.timestamp < timestamp) messages.splice(index, 1);
      }
    }
  };
}

describe('data bus hot paths', () => {
  const environment = makeEnvironment('bench-data-bus');
  const transport = new FakeTransport<{ value: number }>();
  const bus = new CrossTabDataBus({
    clusterKey: 'bench-data-bus',
    environment: environment.environment,
    initialConfig: {},
    transport
  });
  bus.subscribe('bench.topic', () => {});

  bench('publish / 1000 messages', () => {
    for (let index = 0; index < 1_000; index += 1) {
      bus.publish('bench.topic', { value: index });
    }
  });

  bench('receive and dispatch / 1000 messages', () => {
    for (let index = 0; index < 1_000; index += 1) {
      transport.emit('bench.topic', { value: index });
    }
  });

  bench('publishBatch / 1000 messages / 10 per call', () => {
    for (let batch = 0; batch < 100; batch += 1) {
      const items = Array.from({ length: 10 }, (_, index) => ({
        data: { value: batch * 10 + index }
      }));
      bus.publishBatch('bench.topic', items);
    }
  });
});

describe('data bus advanced hot paths', () => {
  bench('wildcard routing / 1000 concrete publications', () => {
    const environment = makeEnvironment('bench-wildcard');
    const transport = new FakeTransport<{ value: number }>();
    const bus = new CrossTabDataBus({
      clusterKey: 'bench-wildcard',
      environment: environment.environment,
      initialConfig: {},
      transport
    });
    bus.subscribe('bench.rooms.*', () => {});
    for (let index = 0; index < 1_000; index += 1) {
      transport.emit(`bench.rooms.room-${index % 100}`, { value: index });
    }
    bus.stop();
  });

  bench('dedup / 1000 publications with 50% duplicates', () => {
    const environment = makeEnvironment('bench-dedup');
    const transport = new FakeTransport<{ value: number }>();
    const bus = new CrossTabDataBus({
      clusterKey: 'bench-dedup',
      environment: environment.environment,
      initialConfig: {},
      transport,
      dedup: { maxEntries: 2_000, ttlMs: 60_000, now: () => 1_000 }
    });
    bus.subscribe('bench.dedup', () => {});
    for (let index = 0; index < 1_000; index += 1) {
      const messageId = `message-${index % 500}`;
      transport.emit('bench.dedup', { value: index }, messageId);
    }
    bus.stop();
  });

  bench('replay prune / 1000 retained publications', () => {
    const environment = makeEnvironment('bench-replay-prune');
    const transport = new FakeTransport<{ value: number }>();
    const bus = new CrossTabDataBus({
      clusterKey: 'bench-replay-prune',
      environment: environment.environment,
      initialConfig: {},
      transport,
      replay: { maxPerTopic: 100, pruneStrategy: PRUNE_STRATEGY.COUNT }
    });
    bus.subscribe('bench.replay', () => {});
    for (let index = 0; index < 1_000; index += 1) {
      transport.emit('bench.replay', { value: index });
    }
    bus.stop();
  });

  bench('persistence appendBatch / 1000 publications', async () => {
    const environment = makeEnvironment('bench-persistence');
    const transport = new FakeTransport<{ value: number }>();
    const persistence = makePersistence();
    const bus = new CrossTabDataBus({
      clusterKey: 'bench-persistence',
      environment: environment.environment,
      initialConfig: {},
      transport,
      replay: { maxPerTopic: 1_000, persistence }
    });
    bus.subscribe('bench.persist', () => {});
    for (let index = 0; index < 1_000; index += 1) {
      transport.emit('bench.persist', { value: index }, undefined, index);
    }
    await Promise.resolve();
    bus.stop();
  });

  bench('trace async sink / 1000 events', async () => {
    const events: unknown[] = [];
    const trace = new DataBusTraceReporter({
      enabled: true,
      mode: TRACE_MODE.EVENTS,
      asyncSink: true,
      sink: event => events.push(event),
      now: () => 1_000
    });
    for (let index = 0; index < 1_000; index += 1) {
      trace.event({ type: TRACE_EVENT_TYPE.STATUS, status: index % 2 === 0 ? WORKER_STATUS.CONNECTED : WORKER_STATUS.DISCONNECTED });
    }
    await Promise.resolve();
    trace.stop();
  });
});
