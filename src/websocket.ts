/**
 * WebSocketTransport — a dependency-free transport over a plain WebSocket.
 *
 * Validates the `DataBusTransport` abstraction with a second, minimal backend:
 * any WebSocket server that speaks the tiny JSON protocol below can back the
 * same cross-tab clustering stack (owner dedup, sticky routes, EVENT fan-out)
 * that the Centrifuge backend uses.
 *
 * Wire protocol (JSON text frames):
 * - client → server: `{"op":"subscribe"|"unsubscribe"|"publish","topic":...,"data":...}`
 * - server → client: `{"topic":...,"data":...}` for publications; anything
 *   without a string `topic` field is ignored (forward-compatible).
 */
import { CrossTabDataBus } from './core/data-bus';
import type { CrossTabDataBusOptions } from './core/data-bus';
import type {
  DataBusTransport,
  DataBusTransportHandlers,
  MaybePromise,
  WorkerStatus
} from './core/types';

/** Minimal WebSocket surface used by the transport. Matches the browser
 * `WebSocket` subset the transport touches; injectable for tests and runtimes. */
export interface WebSocketLike {
  /** Current connection state; 1 (OPEN) means frames may be sent. */
  readonly readyState?: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** Connection configuration for {@link WebSocketTransport}. */
export interface WebSocketDataBusConfig {
  /** WebSocket endpoint, e.g. `wss://example.test/ws`. */
  url: string;
  /** Subprotocol(s) passed to the WebSocket handshake. */
  protocols?: string | string[];
  /** Custom socket factory. Defaults to the global `WebSocket`; injectable
   * for tests and non-browser runtimes. */
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocketLike;
}

/** Options for creating a fully-configured CrossTabDataBus with a WebSocket transport. */
export interface CreateWebSocketDataBusOptions<TData = unknown>
  extends Omit<
    CrossTabDataBusOptions<WebSocketDataBusConfig, TData>,
    'autoStart' | 'clusterKey' | 'initialConfig' | 'transport'
  > {
  /** WebSocket connection configuration. */
  connection: WebSocketDataBusConfig;
  /** Cluster key for cross-tab coordination. Defaults to the connection URL. */
  clusterKey?: string;
}

const WS_OPEN = 1;

/** Transport that talks a minimal JSON protocol over a plain WebSocket.
 * Connection lifecycle maps directly to the DataBus status vocabulary:
 * open → `connected`, close → `disconnected`, error → `error` (which the
 * DataBus treats as its auto-recovery trigger). The transport holds no
 * reconnection logic of its own — reopening is the DataBus's job. */
export class WebSocketTransport<TData = unknown>
  implements DataBusTransport<WebSocketDataBusConfig, TData>
{
  private socket: WebSocketLike | null = null;
  private handlers: DataBusTransportHandlers<TData> | null = null;
  private readonly subscribedTopics = new Set<string>();

  constructor(private readonly connection: WebSocketDataBusConfig) {}

  /** Open the WebSocket and wire lifecycle listeners. A factory failure is
   * reported through `onStatus('error')` so the DataBus can recover. */
  start(config: WebSocketDataBusConfig, handlers: DataBusTransportHandlers<TData>): MaybePromise<void> {
    if (this.socket) return;
    this.handlers = handlers;
    // The factory may live on the constructor connection (createWebSocketDataBus
    // path) or on the runtime config (direct transport use) — accept both.
    const factory = config.webSocketFactory ?? this.connection.webSocketFactory ?? defaultWebSocketFactory;
    const protocols = config.protocols ?? this.connection.protocols;
    let socket: WebSocketLike;
    try {
      socket = factory(config.url, protocols);
    } catch (error) {
      handlers.onStatus('error');
      handlers.onError(error);
      return;
    }
    socket.onopen = () => {
      // Re-assert every topic so a reopened socket (recovery path) restores
      // the server-side subscriptions without DataBus involvement.
      for (const topic of this.subscribedTopics) {
        this.sendFrame({ op: 'subscribe', topic });
      }
      handlers.onStatus('connected');
    };
    socket.onclose = () => handlers.onStatus('disconnected');
    socket.onerror = () => handlers.onStatus('error');
    socket.onmessage = event => this.handleMessage(event.data);
    this.socket = socket;
  }

  /** Idempotent: re-subscribing an active topic re-sends the frame but does
   * not duplicate the local tracking entry. */
  subscribe(topic: string): MaybePromise<void> {
    this.subscribedTopics.add(topic);
    this.sendFrame({ op: 'subscribe', topic });
  }

  /** Idempotent: unsubscribing an unknown topic is a no-op. */
  unsubscribe(topic: string): MaybePromise<void> {
    this.subscribedTopics.delete(topic);
    this.sendFrame({ op: 'unsubscribe', topic });
  }

  /** Publish `data` to `topic` as a JSON frame. Requires an open socket. */
  publish(topic: string, data: unknown): MaybePromise<void> {
    if (data instanceof ArrayBuffer) {
      this.sendBinaryFrame(topic, data);
      return;
    }
    this.sendFrame({ op: 'publish', topic, data });
  }

  /** Close the socket and drop all state. Safe to call multiple times. */
  stop(): MaybePromise<void> {
    const socket = this.socket;
    this.socket = null;
    this.handlers = null;
    this.subscribedTopics.clear();
    socket?.close();
  }

  /** Send one JSON frame. Frames are dropped with an `onError` report when
   * the socket is not open — subscribe frames are re-sent on open, so the
   * only real loss is a publish during a disconnect window. */
  private sendFrame(payload: { op: string; topic: string; data?: unknown }): void {
    if (this.socket?.readyState !== WS_OPEN) {
      this.handlers?.onError(new Error(`WebSocket is not open; dropped "${payload.op}" frame.`));
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private sendBinaryFrame(topic: string, data: ArrayBuffer): void {
    if (this.socket?.readyState !== WS_OPEN) {
      this.handlers?.onError(new Error('WebSocket is not open; dropped "publish" frame.'));
      return;
    }
    const topicBytes = new TextEncoder().encode(topic);
    if (topicBytes.length > 0xffff) {
      this.handlers?.onError(new Error('WebSocket topic is too long for a binary frame.'));
      return;
    }
    const frame = new Uint8Array(3 + topicBytes.length + data.byteLength);
    frame[0] = 0xc7;
    new DataView(frame.buffer).setUint16(1, topicBytes.length);
    frame.set(topicBytes, 3);
    frame.set(new Uint8Array(data), 3 + topicBytes.length);
    this.socket.send(frame.buffer);
  }

  /** Parse a server frame. Only objects carrying a string `topic` are
   * publications; malformed JSON and unknown shapes are ignored so a chatty
   * server cannot crash the message path. */
  private handleMessage(raw: unknown): void {
    let parsed: unknown;
    if (raw instanceof ArrayBuffer) {
      const bytes = new Uint8Array(raw);
      if (bytes[0] !== 0xc7 || bytes.length < 3) return;
      const topicLength = new DataView(raw).getUint16(1);
      if (bytes.length < 3 + topicLength) return;
      const topic = new TextDecoder().decode(bytes.subarray(3, 3 + topicLength));
      const data = bytes.slice(3 + topicLength).buffer;
      this.handlers?.onMessage({ topic, data: data as TData });
      return;
    }
    if (typeof raw !== 'string') return;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.handlers?.onError(new Error('WebSocket server sent a non-JSON frame.'));
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const frame = parsed as Record<string, unknown>;
    if (typeof frame.topic !== 'string') return;
    this.handlers?.onMessage({ topic: frame.topic, data: frame.data as TData });
  }
}

/** Resolve the platform WebSocket, or null in runtimes without one (SSR/Node). */
function defaultWebSocketFactory(url: string, protocols?: string | string[]): WebSocketLike {
  if (typeof WebSocket === 'undefined') {
    throw new Error('WebSocketTransport requires a WebSocket implementation.');
  }
  return new WebSocket(url, protocols) as unknown as WebSocketLike;
}

/** Create a CrossTabDataBus backed by a plain WebSocket transport.
 * Cross-tab clustering (owner dedup, sticky routes, failover) works identically
 * to the Centrifuge backend — only the transport I/O differs. */
export function createWebSocketDataBus<TData = unknown>(
  options: CreateWebSocketDataBusOptions<TData>
): CrossTabDataBus<WebSocketDataBusConfig, TData> {
  const { clusterKey, connection, ...dataBusOptions } = options;
  return new CrossTabDataBus({
    ...dataBusOptions,
    autoStart: true,
    clusterKey: clusterKey ?? connection.url,
    initialConfig: connection,
    transport: new WebSocketTransport<TData>(connection)
  });
}

/** Re-export for convenience: the status type used by the transport. */
export type { WorkerStatus };
