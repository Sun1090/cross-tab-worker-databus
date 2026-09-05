/**
 * Worker-mode types and backend selection.
 *
 * Defines the WorkerMode preference flags and the selectWorkerBackend function
 * that resolves the preference against browser capability to pick the actual
 * backend (dedicated, shared, or local fallback).
 *
 * The literal values are derived from `utils/constants.ts` so the preference and
 * resolved-backend strings referenced across the transport stay in one place.
 */
import { WORKER_BACKEND, WORKER_MODE } from './utils/constants';

/** Preferred Worker mode.
 * - `dedicated` → try Dedicated Worker first (one WebSocket per tab).
 * - `shared` → try SharedWorker first (one process, per-port connections).
 * - `auto` → same as `shared` (alias for forward compatibility). */
export type WorkerMode = (typeof WORKER_MODE)[keyof typeof WORKER_MODE];

/** Resolved backend that was actually created. `local` means the session
 * runs on the main thread (fallback when no Worker API is available). */
export type WorkerBackend = (typeof WORKER_BACKEND)[keyof typeof WORKER_BACKEND];

/** Override Worker availability for testing or environments where feature
 * detection is unreliable (e.g. sandboxed iframes). When a field is omitted,
 * the global `typeof Worker` / `typeof SharedWorker` check is used. */
export interface WorkerAvailability {
  /** When provided, overrides `typeof Worker !== 'undefined'`. */
  worker?: boolean;
  /** When provided, overrides `typeof SharedWorker !== 'undefined'`. */
  sharedWorker?: boolean;
}

/**
 * Resolves the worker backend by feature detection, without touching globals
 * that may be missing in SSR or embedded environments.
 *
 * - `dedicated` prefers Dedicated Worker, then SharedWorker, then local mode.
 * - `shared` and `auto` prefer SharedWorker, then Dedicated Worker, then local.
 * Returns `'local'` when neither Worker API is available (main-thread fallback).
 */
export function selectWorkerBackend(
  mode: WorkerMode,
  availability: WorkerAvailability = {}
): WorkerBackend {
  const hasDedicated = availability.worker ?? typeof Worker !== 'undefined';
  const hasShared = availability.sharedWorker ?? typeof SharedWorker !== 'undefined';
  if (mode === WORKER_MODE.SHARED || mode === WORKER_MODE.AUTO) {
    return hasShared ? WORKER_BACKEND.SHARED : hasDedicated ? WORKER_BACKEND.DEDICATED : WORKER_BACKEND.LOCAL;
  }
  return hasDedicated ? WORKER_BACKEND.DEDICATED : hasShared ? WORKER_BACKEND.SHARED : WORKER_BACKEND.LOCAL;
}