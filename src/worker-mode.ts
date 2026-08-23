/**
 * Worker-mode types and backend selection.
 *
 * Defines the WorkerMode preference flags and the selectWorkerBackend function
 * that resolves the preference against browser capability to pick the actual
 * backend (dedicated, shared, or local fallback).
 */

/** Preferred Worker mode: 'dedicated' → try Dedicated Worker first, 'shared'/'auto' → try SharedWorker first. */
export type WorkerMode = 'dedicated' | 'shared' | 'auto';

/** Resolved backend that was actually created. */
export type WorkerBackend = 'dedicated' | 'shared' | 'local';

/** Override Worker availability for testing or environments where feature detection is unreliable. */
export interface WorkerAvailability {
  worker?: boolean;
  sharedWorker?: boolean;
}

/**
 * Resolves the worker backend by feature detection, without touching globals
 * that may be missing in SSR or embedded environments.
 *
 * - `dedicated` prefers Dedicated Worker, then SharedWorker, then local mode.
 * - `shared` and `auto` prefer SharedWorker, then Dedicated Worker, then local.
 */
export function selectWorkerBackend(
  mode: WorkerMode,
  availability: WorkerAvailability = {}
): WorkerBackend {
  const hasDedicated = availability.worker ?? typeof Worker !== 'undefined';
  const hasShared = availability.sharedWorker ?? typeof SharedWorker !== 'undefined';
  if (mode === 'shared' || mode === 'auto') {
    return hasShared ? 'shared' : hasDedicated ? 'dedicated' : 'local';
  }
  return hasDedicated ? 'dedicated' : hasShared ? 'shared' : 'local';
}
