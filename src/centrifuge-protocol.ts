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
/** Default per-port session timeout in ms, derived from the heartbeat interval
 * and the multiplier. Used as the fallback when a port sends no INIT config. */
export const DEFAULT_SESSION_TIMEOUT_MS =
  DEFAULT_HEARTBEAT_INTERVAL_MS * DEFAULT_SESSION_TIMEOUT_MULTIPLIER;

// Centrifuge Options that reference browser APIs (WebSocket, EventSource, etc.)
// are unavailable inside a Worker — the worker uses its own WebSocket import.
// These are stripped from the config sent to the worker so the type system
// prevents accidentally passing a main-thread-only function (which would fail
// structured cloning and throw a DataCloneError).
type WorkerUnsafeOption =
  | 'eventsource'
  | 'fetch'
  | 'getData'
  | 'getToken'
  | 'networkEventTarget'
  | 'readableStream'
  | 'sockjs'
  | 'websocket';

/** Centrifuge options safe to pass into a Worker; unsafe options are explicitly
 * excluded and set to `never` so the compiler rejects them at the call site. */
export type CentrifugeWorkerConfig = Omit<Partial<Options>, WorkerUnsafeOption> & {
  [Key in WorkerUnsafeOption]?: never;
};

/** Messages sent from the main thread to the Worker. All variants are
 * structured-cloneable; `PUBLISH_BIN` carries an ArrayBuffer (transferable). */
export type CentrifugeWorkerInput =
  /** Initial connection: URL + config. Sent once per backend creation.
   * `transferable` enables ArrayBuffer zero-copy for subsequent PUBLISH_BIN.
   * `heartbeatIntervalMs` overrides the SharedWorker PING cadence. */
  | { type: 'INIT'; url: string; config: CentrifugeWorkerConfig; transferable?: boolean; heartbeatIntervalMs?: number }
  /** Subscribe to a channel. Idempotent — re-subscribing is a no-op. */
  | { type: 'SUBSCRIBE'; topic: string }
  /** Unsubscribe from a channel. Idempotent. */
  | { type: 'UNSUBSCRIBE'; topic: string }
  /** Publish a structured-cloneable payload to a channel. */
  | { type: 'PUBLISH'; topic: string; data: unknown }
  /** Publish an ArrayBuffer via Transferable (zero-copy when `transferable` is on). */
  | { type: 'PUBLISH_BIN'; topic: string; data: ArrayBuffer }
  /** Heartbeat from the main thread; the SharedWorker reaps silent ports. */
  | { type: 'PING' }
  /** Disconnect the client and clear all subscriptions. */
  | { type: 'STOP' };

/** Messages sent from the Worker back to the main thread. The main thread
 * routes these to the DataBusTransportHandlers via handleOutput(). */
export type CentrifugeWorkerOutput<TData = unknown> =
  /** Connection status changed. Maps Centrifuge states to the DataBus vocabulary. */
  | { type: 'STATUS'; status: WorkerStatus }
  /** A JSON publication arrived. Routed to onMessage via handleOutput. */
  | { type: 'MESSAGE'; topic: string; data: TData }
  /** A binary publication arrived (Transferable). Routed to onMessage with the ArrayBuffer. */
  | { type: 'MESSAGE_BIN'; topic: string; data: ArrayBuffer }
  /** A non-fatal error occurred. Does not imply disconnection (the client retries internally). */
  | { type: 'ERROR'; error: SerializedWorkerError };

/** Error object serialized for cross-thread transfer. Error instances cannot
 * be structured-cloned via postMessage, so the Worker converts them to this
 * shape and the main thread rebuilds an Error via deserializeWorkerError(). */
export interface SerializedWorkerError {
  /** The Error's `name` (e.g. 'TypeError', 'CentrifugeError'). */
  name: string;
  /** The Error's `message`. */
  message: string;
  /** The Error's `stack` if available (for debugging). */
  stack?: string;
  /** Arbitrary context attached by the Worker (e.g. the failing operation). */
  context?: unknown;
}
