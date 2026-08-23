/**
 * Worker-thread protocol for Centrifuge WebSocket transport.
 *
 * Defines the message types exchanged between the main thread and a Web Worker
 * (dedicated or shared) that runs a centrifuge client. The worker is isolated
 * from the main thread so that WebSocket lifecycle, token refresh, and binary
 * data handling never block the UI.
 */
import type { Options } from 'centrifuge';
import type { WorkerStatus } from './core/types';

/**
 * Default interval between main-thread PING heartbeats to a SharedWorker. The
 * SharedWorker reaps a silent port after `SESSION_TIMEOUT_MULTIPLIER` intervals.
 * Shared here so the main thread (heartbeat sender) and the SharedWorker (reaper)
 * always agree on the cadence.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
/** SharedWorker per-port session timeout, expressed as a multiple of that port's
 * heartbeat interval. A live port PINGs every heartbeat interval, so a timeout of
 * several intervals tolerates throttled tabs without reaping healthy sessions. */
export const DEFAULT_SESSION_TIMEOUT_MULTIPLIER = 3;

// Centrifuge Options that reference browser APIs (WebSocket, EventSource, etc.)
// are unavailable inside a Worker — the worker uses its own WebSocket import.
type WorkerUnsafeOption =
  | 'eventsource'
  | 'fetch'
  | 'getData'
  | 'getToken'
  | 'networkEventTarget'
  | 'readableStream'
  | 'sockjs'
  | 'websocket';

/** Centrifuge options safe to pass into a Worker; unsafe options are explicitly excluded. */
export type CentrifugeWorkerConfig = Omit<Partial<Options>, WorkerUnsafeOption> & {
  [Key in WorkerUnsafeOption]?: never;
};

/** Messages sent from the main thread to the Worker. */
export type CentrifugeWorkerInput =
  | { type: 'INIT'; url: string; config: CentrifugeWorkerConfig; transferable?: boolean; heartbeatIntervalMs?: number }
  | { type: 'SUBSCRIBE'; topic: string }
  | { type: 'UNSUBSCRIBE'; topic: string }
  | { type: 'PUBLISH'; topic: string; data: unknown }
  | { type: 'PUBLISH_BIN'; topic: string; data: ArrayBuffer }
  | { type: 'PING' }
  | { type: 'STOP' };

/** Messages sent from the Worker back to the main thread. */
export type CentrifugeWorkerOutput<TData = unknown> =
  | { type: 'STATUS'; status: WorkerStatus }
  | { type: 'MESSAGE'; topic: string; data: TData }
  | { type: 'MESSAGE_BIN'; topic: string; data: ArrayBuffer }
  | { type: 'ERROR'; error: SerializedWorkerError };

/** Error object serialized for cross-thread transfer (Error instances cannot be cloned via postMessage). */
export interface SerializedWorkerError {
  name: string;
  message: string;
  stack?: string;
  context?: unknown;
}
