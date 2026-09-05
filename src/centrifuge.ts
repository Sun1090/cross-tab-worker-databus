/**
 * Centrifuge WebSocket transport that runs inside a Web Worker.
 *
 * Supports three backends, selected in order of preference:
 * 1. SharedWorker — one WebSocket per tab session, hosted in a shared process
 * 2. Dedicated Worker — one WebSocket per tab
 * 3. In-process (local) — Centrifuge runs on the main thread (fallback when
 *    neither Worker type is available, e.g. in non-browser environments)
 *
 * Binary data (ArrayBuffer) can be transferred via Transferable when the
 * `transferable` option is enabled, avoiding structured-clone overhead.
 */

import { CrossTabDataBus } from './core/data-bus';
import type { CrossTabDataBusOptions } from './core/data-bus';
import type { DataBusTransport, DataBusTransportHandlers } from './core/types';
import { CentrifugeSession } from './centrifuge-session';
import { selectWorkerBackend } from './worker-mode';
import type { WorkerBackend, WorkerMode } from './worker-mode';
import type {
  CentrifugeWorkerConfig,
  CentrifugeWorkerInput,
  CentrifugeWorkerOutput
} from './centrifuge-protocol';
import type { DataBusPublishOptions } from './core/types';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from './centrifuge-protocol';
import { CENTRIFUGE_INPUT_TYPE, CENTRIFUGE_OUTPUT_TYPE, DEFAULT_STORAGE_PREFIX, WORKER_BACKEND, WORKER_MODE, WORKER_STATUS } from './utils/constants';
import { deserializeWorkerError } from './utils/error-utils';
import { publicationMetadata } from './utils/metadata';
import { assertHeartbeatInterval, assertStructuredCloneable } from './utils/validation';

export type { CentrifugeWorkerConfig, SerializedWorkerError } from './centrifuge-protocol';
export type { WorkerBackend, WorkerMode } from './worker-mode';

/** WebSocket connection parameters passed to the Centrifuge Worker. */
export interface CentrifugeDataBusConfig {
  /** Centrifuge server WebSocket URL. */
  url: string;
  /** Centrifuge client options (token, channel params, etc.). */
  options?: CentrifugeWorkerConfig;
}

/** Options for configuring the Worker backend (dedicated, shared, or local). */
export interface CentrifugeWorkerTransportOptions {
  /** Custom dedicated Worker factory. Used for testing or bundler integration. */
  workerFactory?: () => Worker;
  /** Custom SharedWorker factory. */
  sharedWorkerFactory?: () => SharedWorker;
  /** Preferred Worker mode: 'dedicated', 'shared', or 'auto'. */
  workerMode?: WorkerMode;
  /** Enable transferable (ArrayBuffer) support for binary data. */
  transferable?: boolean;
  /** Interval (ms) between PING heartbeats sent to the SharedWorker. The
   * SharedWorker reaps a silent port after `DEFAULT_SESSION_TIMEOUT_MULTIPLIER`
   * × this interval. Pass `Infinity` to disable heartbeats entirely. Defaults
   * to `DEFAULT_HEARTBEAT_INTERVAL_MS`. */
  heartbeatIntervalMs?: number;
}

/** Options for creating a fully-configured CrossTabDataBus with a Centrifuge transport. */
export interface CreateCentrifugeDataBusOptions<TData = unknown>
  extends Omit<
      CrossTabDataBusOptions<CentrifugeDataBusConfig, TData>,
      'autoStart' | 'clusterKey' | 'initialConfig' | 'transport'
    >,
    CentrifugeWorkerTransportOptions {
  /** Centrifuge connection configuration. */
  connection: CentrifugeDataBusConfig;
  /** Cluster key for cross-tab coordination. Defaults to the connection URL. */
  clusterKey?: string;
}

/**
 * Transport layer that runs a Centrifuge WebSocket client inside a Web Worker.
 *
 * Delegates the actual WebSocket connection to a Worker (dedicated or shared)
 * or falls back to an in-process CentrifugeSession. The Worker is isolated from
 * the main thread so that WebSocket lifecycle, token refresh, and binary data
 * handling never block the UI.
 */
export class CentrifugeWorkerTransport<TData = unknown>
  implements DataBusTransport<CentrifugeDataBusConfig, TData>
{
  readonly diagnosticsName = 'centrifuge';
  private readonly workerMode: WorkerMode;
  private readonly transferable: boolean;
  private readonly heartbeatIntervalMs: number;
  private readonly workerFactory: (() => Worker) | undefined;
  private readonly sharedWorkerFactory: (() => SharedWorker) | undefined;
  private backend: WorkerBackend | null = null;
  private worker: Worker | null = null;
  private sharedWorker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private localSession: CentrifugeSession<TData> | null = null;
  private handlers: DataBusTransportHandlers<TData> | null = null;
  // Monotonically increasing counter, bumped each time a backend is created.
  // Used to ignore late error events from a superseded Worker.
  private generation = 0;
  // Generation captured when the current backend was created. Error handlers
  // only act when the backend that registered them is still current.
  private backendGeneration = 0;

  get diagnosticsBackend(): string {
    return this.backend ?? 'uninitialized';
  }

  constructor(options: CentrifugeWorkerTransportOptions = {}) {
    this.workerMode = options.workerMode ?? WORKER_MODE.DEDICATED;
    this.transferable = options.transferable ?? false;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    assertHeartbeatInterval(this.heartbeatIntervalMs);
    this.workerFactory = options.workerFactory;
    this.sharedWorkerFactory = options.sharedWorkerFactory;
  }

  /**
   * Start the transport: select a backend, initialise the Worker (or local
   * session), and send the INIT message with connection parameters.
   */
  start(config: CentrifugeDataBusConfig, handlers: DataBusTransportHandlers<TData>): void {
    if (this.backend) return;
    assertStructuredCloneable(config.options ?? {});
    this.handlers = handlers;
    // Runtime capability OR an injected factory counts as availability; a
    // factory-less browser must use the bundled default Workers instead of
    // silently degrading to the local session.
    const backend = selectWorkerBackend(this.workerMode, {
      worker: this.workerFactory !== undefined || typeof Worker !== 'undefined',
      sharedWorker: this.sharedWorkerFactory !== undefined || typeof SharedWorker !== 'undefined'
    });
    const input = this.buildInitInput(config);
    if (backend === WORKER_BACKEND.SHARED) {
      this.startSharedWorker(input);
      this.backend = WORKER_BACKEND.SHARED;
      return;
    }
    if (backend === WORKER_BACKEND.DEDICATED) {
      this.startDedicatedWorker(input);
      this.backend = WORKER_BACKEND.DEDICATED;
      return;
    }
    this.localSession = new CentrifugeSession<TData>({ post: this.handleSessionOutput });
    this.localSession.handle(input);
    this.backend = WORKER_BACKEND.LOCAL;
  }

  subscribe(topic: string): void {
    this.post({ type: CENTRIFUGE_INPUT_TYPE.SUBSCRIBE, topic });
  }

  unsubscribe(topic: string): void {
    this.post({ type: CENTRIFUGE_INPUT_TYPE.UNSUBSCRIBE, topic });
  }

  /**
   * Publish data to `topic`. Binary data (ArrayBuffer) is sent via Transferable
   * when `transferable` is enabled, avoiding a structured-clone cycle.
   */
  publish(topic: string, data: unknown, options?: DataBusPublishOptions): void {
    if (this.transferable && data instanceof ArrayBuffer) {
      this.post({ type: CENTRIFUGE_INPUT_TYPE.PUBLISH_BIN, topic, data, ...publicationMetadata(options?.messageId, options?.timestamp) }, [data]);
      return;
    }
    this.post({ type: CENTRIFUGE_INPUT_TYPE.PUBLISH, topic, data, ...publicationMetadata(options?.messageId, options?.timestamp) });
  }

  /**
   * Gracefully stop the transport: send STOP, clean up event listeners, and
   * terminate the Worker (or close the SharedWorker port).
   */
  stop(): void {
    if (!this.backend) return;
    this.generation++;
    this.post({ type: CENTRIFUGE_INPUT_TYPE.STOP });
    this.clearHeartbeat();
    if (this.worker) {
      this.worker.removeEventListener('message', this.handleMessage);
      this.worker.removeEventListener('error', this.handleWorkerError);
      this.worker.terminate();
    }
    if (this.sharedWorker) {
      this.detachSharedWorkerListeners();
      this.port?.close();
    }
    this.resetBackend();
    this.handlers = null;
  }

  /** Build the INIT payload sent to the Worker / local session. Optional fields
   * are only included when they deviate from the defaults, so the Worker's own
   * default-resolution logic kicks in for the common case. */
  private buildInitInput(config: CentrifugeDataBusConfig): CentrifugeWorkerInput {
    return {
      type: CENTRIFUGE_INPUT_TYPE.INIT,
      url: config.url,
      config: config.options ?? {},
      ...(this.transferable ? { transferable: true } : {}),
      ...(this.heartbeatIntervalMs !== DEFAULT_HEARTBEAT_INTERVAL_MS
        ? { heartbeatIntervalMs: this.heartbeatIntervalMs }
        : {})
    };
  }

  /** Create and initialise a dedicated Worker, then send the INIT message. */
  private startDedicatedWorker(input: CentrifugeWorkerInput): void {
    this.backendGeneration = ++this.generation;
    const worker = (this.workerFactory ?? createDefaultWorker)();
    this.worker = worker;
    worker.addEventListener('message', this.handleMessage);
    worker.addEventListener('error', this.handleWorkerError);
    worker.postMessage(input);
  }

  /** Create and initialise a SharedWorker, open the MessagePort, and send the INIT message. */
  private startSharedWorker(input: CentrifugeWorkerInput): void {
    this.backendGeneration = ++this.generation;
    const shared = (this.sharedWorkerFactory ?? createDefaultSharedWorker)();
    this.sharedWorker = shared;
    const port = shared.port;
    this.port = port;
    port.addEventListener('message', this.handleMessage);
    port.addEventListener('messageerror', this.handlePortError);
    shared.addEventListener('error', this.handleSharedWorkerError);
    port.start();
    port.postMessage(input);
    this.startHeartbeat();
  }

  /** Handle a message event from the Worker (dedicated or shared). */
  private readonly handleMessage = (event: MessageEvent<CentrifugeWorkerOutput<TData>>) => {
    this.handleOutput(event.data);
  };

  /** Handle a message from the in-process CentrifugeSession (local fallback). */
  private readonly handleSessionOutput = (message: CentrifugeWorkerOutput<TData>) => {
    this.handleOutput(message);
  };

  /** Route a Worker output message to the appropriate handler callback.
   * Shared by the Worker message listener, the SharedWorker port listener,
   * and the local-session sink — all three feed into this single dispatcher. */
  private handleOutput(message: CentrifugeWorkerOutput<TData>): void {
    if (message.type === CENTRIFUGE_OUTPUT_TYPE.STATUS) this.handlers?.onStatus(message.status);
    if (message.type === CENTRIFUGE_OUTPUT_TYPE.MESSAGE) this.handlers?.onMessage({ topic: message.topic, data: message.data, ...publicationMetadata(message.messageId, message.timestamp) });
    if (message.type === CENTRIFUGE_OUTPUT_TYPE.MESSAGE_BIN) this.handlers?.onMessage({ topic: message.topic, data: message.data as TData, ...publicationMetadata(message.messageId, message.timestamp) });
    if (message.type === CENTRIFUGE_OUTPUT_TYPE.ERROR) this.handlers?.onError(deserializeWorkerError(message.error));
  }

  /** Handle a Worker-level failure (crash, message decode error). Discards the
   * dead backend so a later start()/reopen can rebuild from scratch, and
   * signals an error status so the DataBus can trigger recovery.
   * Only invoked when the generation guard confirms the failing backend is
   * still current — late errors from a superseded Worker are silently dropped. */
  private onWorkerFailed(message: string): void {
    // Remove the message listener and release the old backend before recovery
    // reopens, so late messages from the failed Worker/port cannot be routed
    // into the freshly started session.
    this.worker?.removeEventListener('message', this.handleMessage);
    this.worker?.removeEventListener('error', this.handleWorkerError);
    this.worker?.terminate();
    this.detachSharedWorkerListeners();
    this.port?.close();
    this.clearHeartbeat();
    this.resetBackend();
    this.handlers?.onError(new Error(message));
    this.handlers?.onStatus(WORKER_STATUS.ERROR);
  }

  /** Remove every listener attached to the current SharedWorker and its port. */
  private detachSharedWorkerListeners(): void {
    this.port?.removeEventListener('message', this.handleMessage);
    this.port?.removeEventListener('messageerror', this.handlePortError);
    this.sharedWorker?.removeEventListener('error', this.handleSharedWorkerError);
  }

  /** Periodically ping the SharedWorker so its session reaper can detect a dead tab. */
  private startHeartbeat(): void {
    if (this.heartbeatHandle !== null) return;
    // Infinite disables the heartbeat (e.g. for environment where the
    // SharedWorker reaper is not needed).
    if (this.heartbeatIntervalMs === Infinity) return;
    this.heartbeatHandle = setInterval(() => {
      this.post({ type: CENTRIFUGE_INPUT_TYPE.PING });
    }, this.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatHandle !== null) clearInterval(this.heartbeatHandle);
    this.heartbeatHandle = null;
  }

  private readonly handleWorkerError = () => {
    if (this.generation !== this.backendGeneration) return;
    this.onWorkerFailed('Centrifuge worker failed.');
  };

  private readonly handlePortError = () => {
    if (this.generation !== this.backendGeneration) return;
    this.onWorkerFailed('Centrifuge shared worker message decoding failed.');
  };

  private readonly handleSharedWorkerError = () => {
    if (this.generation !== this.backendGeneration) return;
    this.onWorkerFailed('Centrifuge shared worker failed.');
  };

  /** Clear the Worker/port/backend references after a failure or stop. */
  private resetBackend(): void {
    this.worker = null;
    this.sharedWorker = null;
    this.port = null;
    this.backend = null;
    this.localSession = null;
  }

  /**
   * Post a message to the active backend. Accepts optional Transferable buffers
   * for zero-copy ArrayBuffer transfer.
   */
  private post(message: CentrifugeWorkerInput, transfer?: ArrayBuffer[]): void {
    if (this.worker) {
      postToPortLike(this.worker, message, transfer);
      return;
    }
    if (this.port) {
      postToPortLike(this.port, message, transfer);
      return;
    }
    if (this.localSession) {
      this.localSession.handle(message);
      return;
    }
    throw new Error('CentrifugeWorkerTransport.start() must be called first.');
  }
}

/**
 * Create a fully-configured CrossTabDataBus with a Centrifuge WebSocket transport.
 *
 * This is the primary entry point for consumers. It wires up the transport,
 * cluster coordination, and lifecycle management:
 *
 * ```ts
 * const bus = createCentrifugeDataBus({
 *   connection: { url: 'wss://example.com/connection/websocket', options: { token: '…' } },
 *   trace: { enabled: true, sink: event => console.log(event) },
 * });
 * ```
 */
export function createCentrifugeDataBus<TData = unknown>(
  options: CreateCentrifugeDataBusOptions<TData>
): CrossTabDataBus<CentrifugeDataBusConfig, TData> {
  const {
    clusterKey,
    connection,
    heartbeatIntervalMs,
    sharedWorkerFactory,
    transferable,
    workerFactory,
    workerMode,
    ...dataBusOptions
  } = options;
  return new CrossTabDataBus({
    ...dataBusOptions,
    autoStart: true,
    clusterKey: clusterKey ?? connection.url,
    initialConfig: connection,
    transport: new CentrifugeWorkerTransport<TData>({
      ...(workerFactory ? { workerFactory } : {}),
      ...(sharedWorkerFactory ? { sharedWorkerFactory } : {}),
      ...(transferable === undefined ? {} : { transferable }),
      ...(workerMode ? { workerMode } : {}),
      ...(heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs })
    })
  });
}


/** Create the default dedicated Worker hosting the Centrifuge client. */
function createDefaultWorker(): Worker {
  if (typeof Worker === 'undefined') {
    throw new Error('CentrifugeWorkerTransport requires a browser Worker implementation.');
  }
  let workerUrl: URL;
  try {
    workerUrl = new URL('./centrifuge.worker.js', import.meta.url);
  } catch {
    throw new Error(
      'The default Centrifuge Worker URL is unavailable in this module format; provide workerFactory explicitly.'
    );
  }
  return new Worker(workerUrl, {
    name: DEFAULT_STORAGE_PREFIX,
    type: 'module'
  });
}

/** Create the default SharedWorker. Each connecting port within the SharedWorker
 * creates its own CentrifugeSession with an independent WebSocket connection,
 * so refreshing or stopping one tab does not affect the others. */
function createDefaultSharedWorker(): SharedWorker {
  if (typeof SharedWorker === 'undefined') {
    throw new Error('CentrifugeWorkerTransport requires a browser SharedWorker implementation.');
  }
  let workerUrl: URL;
  try {
    workerUrl = new URL('./centrifuge.shared.worker.js', import.meta.url);
  } catch {
    throw new Error(
      'The default Centrifuge SharedWorker URL is unavailable in this module format; provide sharedWorkerFactory explicitly.'
    );
  }
  return new SharedWorker(workerUrl, {
    name: `${DEFAULT_STORAGE_PREFIX}-shared`,
    type: 'module'
  });
}

/** Post `message` to a Worker or MessagePort, forwarding `transfer` buffers
 * when present. Both targets share the `postMessage(message, transfer?)`
 * signature, so a single helper eliminates the duplicated if/else at each
 * call site. */
function postToPortLike(
  target: Pick<Worker, 'postMessage'>,
  message: CentrifugeWorkerInput,
  transfer?: ArrayBuffer[]
): void {
  if (transfer) target.postMessage(message, transfer as Transferable[]);
  else target.postMessage(message);
}
