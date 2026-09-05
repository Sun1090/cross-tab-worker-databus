/**
 * Worker-thread protocol for Centrifuge WebSocket transport.
 *
 * Defines the message types exchanged between the main thread and a Web Worker
 * (dedicated or shared) that runs a centrifuge client. The worker is isolated
 * from the main thread so that WebSocket lifecycle, token refresh, and binary
 * data handling never block the UI.
 *
 * The message `type` discriminant values are derived from the constants in
 * `utils/constants.ts` so main-thread and Worker sides reference the same
 * values and can never drift apart.
 */
import type { Options } from 'centrifuge';
import type { CENTRIFUGE_INPUT_TYPE, CENTRIFUGE_OUTPUT_TYPE } from './utils/constants';
import type { WorkerStatus } from './core/types';
import type { SerializedWorkerError } from './utils/error-utils';

export type { SerializedWorkerError } from './utils/error-utils';

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
  | { type: typeof CENTRIFUGE_INPUT_TYPE.INIT; url: string; config: CentrifugeWorkerConfig; transferable?: boolean; heartbeatIntervalMs?: number }
  /** Subscribe to a channel. Idempotent — re-subscribing is a no-op. */
  | { type: typeof CENTRIFUGE_INPUT_TYPE.SUBSCRIBE; topic: string }
  /** Unsubscribe from a channel. Idempotent. */
  | { type: typeof CENTRIFUGE_INPUT_TYPE.UNSUBSCRIBE; topic: string }
  /** Publish a structured-cloneable payload to a channel. */
  | { type: typeof CENTRIFUGE_INPUT_TYPE.PUBLISH; topic: string; data: unknown; messageId?: string; timestamp?: number }
  /** Publish an ArrayBuffer via Transferable (zero-copy when `transferable` is on). */
  | { type: typeof CENTRIFUGE_INPUT_TYPE.PUBLISH_BIN; topic: string; data: ArrayBuffer; messageId?: string; timestamp?: number }
  /** Heartbeat from the main thread; the SharedWorker reaps silent ports. */
  | { type: typeof CENTRIFUGE_INPUT_TYPE.PING }
  /** Disconnect the client and clear all subscriptions. */
  | { type: typeof CENTRIFUGE_INPUT_TYPE.STOP };

/** Messages sent from the Worker back to the main thread. The main thread
 * routes these to the DataBusTransportHandlers via handleOutput(). */
export type CentrifugeWorkerOutput<TData = unknown> =
  /** Connection status changed. Maps Centrifuge states to the DataBus vocabulary. */
  | { type: typeof CENTRIFUGE_OUTPUT_TYPE.STATUS; status: WorkerStatus }
  /** A JSON publication arrived. Routed to onMessage via handleOutput. */
  | { type: typeof CENTRIFUGE_OUTPUT_TYPE.MESSAGE; topic: string; data: TData; messageId?: string; timestamp?: number }
  /** A binary publication arrived (Transferable). Routed to onMessage with the ArrayBuffer. */
  | { type: typeof CENTRIFUGE_OUTPUT_TYPE.MESSAGE_BIN; topic: string; data: ArrayBuffer; messageId?: string; timestamp?: number }
  /** A non-fatal error occurred. Does not imply disconnection (the client retries internally). */
  | { type: typeof CENTRIFUGE_OUTPUT_TYPE.ERROR; error: SerializedWorkerError };
