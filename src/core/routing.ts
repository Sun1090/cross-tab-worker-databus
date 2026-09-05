/**
 * Routing primitives for topic-owner selection and rebalancing.
 *
 * Pure functions that select candidate Workers, compute the least-loaded
 * owner, and decide when to migrate a topic. All side-effect-free, making
 * them straightforward to test and reason about.
 */
import type { LoadWeightingOptions, WorkerRecord, WorkerRoute } from './types';
import { TAB_VISIBILITY, WORKER_STATUS } from '../utils/constants';

/** Default cap on the number of Workers that can own topics concurrently.
 * Limits fan-out breadth: only N workers are eligible to be new-route
 * owners, so a cluster of 20 tabs still concentrates ownership on a few. */
export const DEFAULT_MAX_ACTIVE_WORKERS = 3;

/**
 * Compute the effective load score used for owner selection.
 *
 * Legacy behavior: `worker.load` (owned-topic count) with no throughput
 * contribution. When a Worker publishes a traffic sample AND weights are set,
 * the normalized per-second rates are added on top, so a busy owner becomes
 * less attractive for NEW routes without ever migrating an existing one.
 * Returns the raw topic count when no sample or no weight is present.
 */
export function effectiveWorkerLoad(
  worker: WorkerRecord,
  options?: LoadWeightingOptions
): number {
  const sample = worker.throughput;
  const messageRateWeight = options?.messageRateWeight ?? 0;
  const byteRateWeight = options?.byteRateWeight ?? 0;
  // A missing sample, unset weights, or a non-positive window (no elapsed
  // time to derive a rate from) all fall back to the raw topic count.
  if (!sample || sample.windowMs <= 0 || (messageRateWeight === 0 && byteRateWeight === 0)) return worker.load;
  const windowSeconds = sample.windowMs / 1000;
  const messageRate = sample.messageCount / windowSeconds;
  const byteRate = sample.byteCount / windowSeconds;
  return worker.load + messageRateWeight * messageRate + byteRateWeight * byteRate;
}

/**
 * Cheap, allocation-free estimate of a payload's wire size, used to populate
 * the byte side of an adaptive load sample. Only runs when adaptive routing is
 * enabled, so approximate sizes are fine — the goal is a stable cross-worker
 * comparison, not an exact byte count. Sizes: null/undefined 0, booleans 4,
 * numbers 8, strings their length, binary views their byteLength, arrays an
 * 8-byte header plus elements, plain objects the sum of their values.
 */
export function approximatePayloadBytes(payload: unknown): number {
  if (payload === null || payload === undefined) return 0;
  switch (typeof payload) {
    case 'boolean':
      return 4;
    case 'number':
    case 'bigint':
      return 8;
    case 'string':
      return payload.length;
    case 'symbol':
    case 'function':
      return 0;
    case 'object':
      break;
  }
  if (payload instanceof ArrayBuffer) return payload.byteLength;
  if (ArrayBuffer.isView(payload)) return payload.byteLength;
  if (Array.isArray(payload)) {
    let sum = 8;
    for (const item of payload) sum += approximatePayloadBytes(item);
    return sum;
  }
  let sum = 0;
  for (const value of Object.values(payload as Record<string, unknown>)) {
    sum += approximatePayloadBytes(value);
  }
  return sum;
}

/**
 * Pick the Worker with the fewest effective load, optionally preferring a
 * specific sticky owner when it is still in the candidate set.
 * Uses a single reduce pass instead of a full sort — O(n) — and breaks
 * load ties by workerId for deterministic routing across tabs (the
 * comparison is code-unit based, not locale-based, for cross-host stability).
 */
export function selectLeastLoadedWorker(
  workers: readonly WorkerRecord[],
  preferredWorkerId?: string,
  options?: LoadWeightingOptions
): WorkerRecord | undefined {
  const preferred = workers.find(worker => worker.workerId === preferredWorkerId);
  if (preferred) return preferred;
  return workers.reduce<WorkerRecord | undefined>((least, worker) => {
    if (!least) return worker;
    const byLoad = effectiveWorkerLoad(worker, options) - effectiveWorkerLoad(least, options);
    if (byLoad !== 0) return byLoad < 0 ? worker : least;
    // Tie-break by workerId with a locale-independent comparison so routing
    // is deterministic regardless of the host's collation order.
    if (worker.workerId < least.workerId) return worker;
    return least;
  }, undefined);
}

/**
 * Select the (up to `maxActiveWorkers`) Workers eligible to own topics.
 *
 * Eligibility cascade:
 * 1. Only `connecting` / `connected` workers are candidates.
 * 2. If any candidate is visible, prefer visible tabs (hidden tabs yield as owner).
 * 3. Fall back to all available workers when none is visible, so the cluster
 *    does not stall when every tab is in the background.
 * 4. Tie-break by registration time, then workerId, for determinism.
 */
export function selectActiveWorkers(
  workers: readonly WorkerRecord[],
  maxActiveWorkers = DEFAULT_MAX_ACTIVE_WORKERS
): WorkerRecord[] {
  const healthyWorkers = workers.filter(
    worker => worker.status === WORKER_STATUS.CONNECTING || worker.status === WORKER_STATUS.CONNECTED
  );
  const availableWorkers = healthyWorkers.length > 0 ? healthyWorkers : [...workers];
  const visibleWorkers = availableWorkers.filter(worker => worker.visibilityState === TAB_VISIBILITY.VISIBLE);
  const candidates = visibleWorkers.length > 0 ? visibleWorkers : availableWorkers;
  return candidates
    .sort(
      (left, right) =>
        left.registeredAt - right.registeredAt ||
        (left.workerId < right.workerId ? -1 : left.workerId > right.workerId ? 1 : 0)
    )
    .slice(0, maxActiveWorkers);
}

/**
 * Decide whether `currentWorkerId` should hand one topic to a less-loaded peer.
 * Returns the target Worker only when its load gap is significant (more than
 * one topic lighter), so the cluster does not churn over a single-topic
 * imbalance. One topic is migrated per reconciliation round to avoid thrashing.
 *
 * This remains exported as a standalone routing utility for API compatibility.
 * WorkerClusterRuntime intentionally does not use it: established routes are
 * sticky and load balancing applies only when selecting a new owner.
 */
export function selectRebalanceTarget(
  workers: readonly WorkerRecord[],
  currentWorkerId: string
): WorkerRecord | null {
  const currentWorker = workers.find(worker => worker.workerId === currentWorkerId);
  const leastLoadedWorker = selectLeastLoadedWorker(workers);
  if (
    !currentWorker ||
    !leastLoadedWorker ||
    currentWorker.workerId === leastLoadedWorker.workerId ||
    currentWorker.load <= leastLoadedWorker.load + 1
  ) {
    return null;
  }
  return leastLoadedWorker;
}

/** True when a route's owner is still a live, active Worker in the given set. */
export function hasActiveOwner(route: WorkerRoute | null, workers: readonly WorkerRecord[]): boolean {
  return Boolean(route && workers.some(worker => worker.workerId === route.workerId));
}

/** True when `pattern` is a wildcard topic: `*` (match everything) or a
 * `prefix.*` suffix wildcard (match any remainder, including multiple
 * segments). Any other string is an exact topic. */
export function isWildcardTopic(pattern: string): boolean {
  return pattern === '*' || pattern.endsWith('.*');
}

/** True when a publication on `topic` must be delivered to a subscription
 * made with `pattern`. Exact patterns match only themselves; wildcards use
 * prefix matching so `chat.*` matches `chat.room.1` and `*` matches anything.
 * The empty pattern never matches. */
export function topicMatchesPattern(pattern: string, topic: string): boolean {
  if (!pattern || !topic) return false;
  if (pattern === topic) return true;
  if (pattern === '*') return true;
  if (!pattern.endsWith('.*')) return false;
  return topic.startsWith(pattern.slice(0, -1));
}
