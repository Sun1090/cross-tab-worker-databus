/**
 * Routing primitives for topic-owner selection and rebalancing.
 *
 * Pure functions that select candidate Workers, compute the least-loaded
 * owner, and decide when to migrate a topic. All side-effect-free, making
 * them straightforward to test and reason about.
 */
import type { WorkerRecord, WorkerRoute } from './types';

/** Default cap on the number of Workers that can own topics concurrently. */
export const DEFAULT_MAX_ACTIVE_WORKERS = 3;

/**
 * Pick the Worker with the fewest owned topics, optionally preferring a
 * specific sticky owner when it is still in the candidate set.
 * Uses a single reduce pass instead of a full sort — O(n) — and breaks
 * load ties by workerId for deterministic routing across tabs.
 */
export function selectLeastLoadedWorker(
  workers: readonly WorkerRecord[],
  preferredWorkerId?: string
): WorkerRecord | undefined {
  const preferred = workers.find(worker => worker.workerId === preferredWorkerId);
  if (preferred) return preferred;
  return workers.reduce<WorkerRecord | undefined>((least, worker) => {
    if (!least) return worker;
    const byLoad = worker.load - least.load;
    if (byLoad !== 0) return byLoad < 0 ? worker : least;
    return worker.workerId.localeCompare(least.workerId) < 0 ? worker : least;
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
  const healthyWorkers = workers.filter(worker => worker.status === 'connecting' || worker.status === 'connected');
  const availableWorkers = healthyWorkers.length > 0 ? healthyWorkers : [...workers];
  const visibleWorkers = availableWorkers.filter(worker => worker.visibilityState === 'visible');
  const candidates = visibleWorkers.length > 0 ? visibleWorkers : availableWorkers;
  return candidates
    .sort(
      (left, right) =>
        left.registeredAt - right.registeredAt || left.workerId.localeCompare(right.workerId)
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
