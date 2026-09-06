/**
 * Routing benchmarks — pure functions on the hot coordination path.
 *
 * Owner selection runs on every subscribe; active-worker filtering runs on
 * every reconcile tick (3s default). Regressions here multiply across tabs.
 */
import { bench, describe } from 'vitest';
import {
  approximatePayloadBytes,
  effectiveWorkerLoad,
  selectActiveWorkers,
  selectLeastLoadedWorker,
  selectRebalanceTarget,
  topicMatchesPattern
} from '../../src/core/routing';
import type { WorkerRecord } from '../../src/core/types';
import { TAB_VISIBILITY, WORKER_ROLE, WORKER_STATUS } from '../../src/utils/constants';

function makeWorkers(count: number): WorkerRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    workerId: `worker-${index.toString().padStart(3, '0')}`,
    tabId: `tab-${index}`,
    load: index % 7,
    role: WORKER_ROLE.ACTIVE,
    status: WORKER_STATUS.CONNECTED,
    visibilityState: index % 3 === 0 ? TAB_VISIBILITY.HIDDEN : TAB_VISIBILITY.VISIBLE,
    heartbeatAt: 1_000,
    registeredAt: index,
    ...(index % 2 === 0
      ? { throughput: { windowMs: 3_000, messageCount: (index * 13) % 500, byteCount: (index * 7) % 20_000, overrunMs: (index * 3) % 900, sampledAt: 1_000 } }
      : {})
  }));
}

describe('routing', () => {
  const workers = makeWorkers(50);
  const weightedWorkers = makeWorkers(50).filter(worker => worker.throughput);
  const weightingOptions = { messageRateWeight: 1, byteRateWeight: 0.001 };
  const weightingPlusLagOptions = { messageRateWeight: 1, byteRateWeight: 0.001, scheduleLagWeight: 1 };
  const structuredPayload = {
    kind: 'flow',
    seq: 42,
    tags: ['a', 'b', 'c'],
    nested: { value: 1, items: [1, 2, 3] }
  };

  bench('selectLeastLoadedWorker / 50 workers', () => {
    selectLeastLoadedWorker(workers);
  });

  bench('selectLeastLoadedWorker / 50 workers / weighted', () => {
    selectLeastLoadedWorker(workers, undefined, weightingOptions);
  });

  bench('selectLeastLoadedWorker / 50 workers / weighted + lag', () => {
    selectLeastLoadedWorker(workers, undefined, weightingPlusLagOptions);
  });

  bench('effectiveWorkerLoad / 50 weighted workers', () => {
    for (const worker of weightedWorkers) effectiveWorkerLoad(worker, weightingOptions);
  });

  bench('approximatePayloadBytes / structured payload', () => {
    approximatePayloadBytes(structuredPayload);
  });

  bench('selectActiveWorkers / 50 workers', () => {
    selectActiveWorkers(workers, 3);
  });

  bench('selectRebalanceTarget / 50 workers', () => {
    selectRebalanceTarget(workers, 'worker-000');
  });

  bench('topicMatchesPattern / wildcard / 1000 topics', () => {
    for (let index = 0; index < 1000; index += 1) {
      topicMatchesPattern('chat.*', `chat.room.${index}`);
    }
  });

  bench('topicMatchesPattern / exact / 1000 topics', () => {
    for (let index = 0; index < 1000; index += 1) {
      topicMatchesPattern(`topic.${index}`, `topic.${index}`);
    }
  });
});
