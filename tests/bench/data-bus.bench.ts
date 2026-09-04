/**
 * Public data-bus benchmarks for the message hot paths.
 *
 * These are intentionally small synchronous loops so local runs can compare
 * publish/receive cost without involving a real browser or network server.
 */
import { bench, describe } from 'vitest';
import { CrossTabDataBus } from '../../src/core/data-bus';
import { createFakeEnvironment, FakeTransport, MemoryStorage } from '../fakes';

describe('data bus hot paths', () => {
  const environment = createFakeEnvironment({
    storage: new MemoryStorage(),
    now: () => 1_000,
    randomId: 'bench-data-bus'
  });
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
