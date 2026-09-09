/**
 * Coordination benchmarks — WorkerClusterRuntime on a fake environment.
 *
 * Covers the two paths every message and every heartbeat touches:
 * cluster.subscribe/publish bookkeeping and the reconcile cycle.
 */
import { describe, test } from 'vitest';
import { WorkerClusterRuntime } from '../../src/core/cluster';
import { createFakeEnvironment, MemoryStorage } from '../fakes';

function makeRuntime(workerId: string, storage: MemoryStorage, now: () => number) {
  const env = createFakeEnvironment({ storage, now, randomId: workerId });
  return new WorkerClusterRuntime({
    clusterKey: 'bench',
    environment: env.environment,
    tabId: `tab-${workerId}`,
    workerId,
    handlers: { onControl: () => {}, onEvent: () => {} }
  });
}

describe('cluster coordination', () => {
  const storage = new MemoryStorage();
  let now = 1_000;
  const runtime = makeRuntime('bench-worker', storage, () => now);
  runtime.start();

  test('subscribe / 100 new topics', async ({ bench }) => {
    await bench('subscribe / 100 new topics', () => {
      for (let index = 0; index < 100; index += 1) {
        runtime.subscribe(`bench.subscribe.${index}`);
      }
    }).run();
  });

  test('publish / 1000 messages', async ({ bench }) => {
    await bench('publish / 1000 messages', () => {
      for (let index = 0; index < 1000; index += 1) {
        runtime.publish(`bench.subscribe.${index % 100}`, { value: index });
      }
    }).run();
  });

  test('publish / 1000 messages / cold route cache', async ({ bench }) => {
    await bench('publish / 1000 messages / cold route cache', () => {
      for (let index = 0; index < 1000; index += 1) {
        runtime.publish(`bench.cold.${index}`, { value: index });
      }
    }).run();
  });

  test('reconcile / 100 topics + 1 worker', async ({ bench }) => {
    await bench('reconcile / 100 topics + 1 worker', () => {
      now += 3_000;
      runtime.getSnapshot();
    }).run();
  });

  test('isAssigned / wildcard pattern / 1000 lookups', async ({ bench }) => {
    await bench('isAssigned / wildcard pattern / 1000 lookups', () => {
      for (let index = 0; index < 1000; index += 1) {
        runtime.isAssigned(`bench.subscribe.${index % 100}`);
      }
    }).run();
  });
});
