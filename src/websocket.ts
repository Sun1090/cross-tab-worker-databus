/**
 * WebSocketTransport — a dependency-free transport over a plain WebSocket.
 *
 * Validates the `DataBusTransport` abstraction with a second, minimal backend:
 * any WebSocket server that speaks the tiny JSON protocol below can back the
 * same cross-tab clustering stack (owner dedup, sticky routes, EVENT fan-out)
 * that the Centrifuge backend uses.
 *
 * Wire protocol — two frame formats, both over text/binary WebSocket messages:
 * - client → server: `{"op":"subscribe"|"unsubscribe"|"publish","topic":...,"data":...}`
 * - client → server (batched): `{"op":"publishBatch","topic":...,"items":[{data,...}]}`
 * - server → client: `{"topic":...,"data":...}` for publications; anything
 *   without a string `topic` field is ignored (forward-compatible).
 * - binary publications use a *separate* tagged frame, not JSON:
 *   `0xc7 | uint16 topicLength | topic UTF-8 | raw payload`, written by
 *   `sendBinaryFrame` when `publish()` receives an `ArrayBuffer` with no
 *   `messageId`/`timestamp` (with metadata it degrades to a JSON PUBLISH whose
 *   `data` is a number array, so an id is never lost to the compact shape), and
 *   parsed by the matching reader. A server that implements only the JSON arm
 *   above silently drops those — see `scripts/demo-ws-server.mjs`, which
 *   implements both directions.
 */
import { CrossTabDataBus } from './core/data-bus';
import { parseDataBusPublication } from './core/publication';
import type { CrossTabDataBusOptions } from './core/data-bus';
import { WS_OP, WORKER_STATUS } from './utils/constants';
import type {
  DataBusTransport,
  DataBusTransportHandlers,
  DataBusPublishOptions,
  DataBusPublicationItem,
  DataBusMessage,
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
  /** Milliseconds to wait for the handshake before reporting `error` and
   * failing the start. Defaults to 30000 ms; pass
   * `0` or `Infinity` to wait indefinitely. The timeout exists because
   * `start()` resolves on connect, so a socket that never opens and never
   * errors would otherwise leave the DataBus start gate (and every operation
   * queued behind it) pending forever. */
  connectTimeoutMs?: number;
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

/** Default handshake budget. A socket that never opens and never fires
 * error/close would otherwise keep a started transport stuck in `connecting`
 * forever, with every queued operation parked behind an unsettled `start()`. */
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

const WS_OPEN = 1;

/** Transport that talks a minimal JSON protocol over a plain WebSocket.
 * Connection lifecycle maps directly to the DataBus status vocabulary:
 * open → `connected`, close → `disconnected`, error → `error` (which the
 * DataBus treats as its auto-recovery trigger). The transport holds no
 * reconnection logic of its own — reopening is the DataBus's job. */
export class WebSocketTransport<TData = unknown>
  implements DataBusTransport<WebSocketDataBusConfig, TData>
{
  readonly diagnosticsName = 'websocket';
  readonly diagnosticsBackend = 'native-websocket';
  private socket: WebSocketLike | null = null;
  private socketActive = false;
  private handlers: DataBusTransportHandlers<TData> | null = null;
  private readonly subscribedTopics = new Set<string>();
  // Handshake gate for the current start(). Resolves once the socket opens,
  // rejects when the attempt fails, so the DataBus start Promise — and every
  // operation parked behind it — settles at the real connection boundary.
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: unknown) => void) | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly connection: WebSocketDataBusConfig) {}

  /** Open the WebSocket and wire lifecycle listeners. Resolves once the
   * handshake completes and rejects when the attempt fails, matching the
   * `DataBusTransport.start` contract ("resolves on connect or rejects on
   * failure"). A factory failure is reported through `onStatus('error')` so
   * the DataBus can recover. */
  start(config: WebSocketDataBusConfig, handlers: DataBusTransportHandlers<TData>): MaybePromise<void> {
    if (this.socket && this.socketActive) {
      // Reuse the live socket instead of orphaning it. While the first
      // attempt is still connecting, share its handshake gate so a duplicate
      // start() cannot report readiness before the socket is usable.
      // The `?? undefined` side of this has zero counts, and it is a type
      // conversion rather than a behavior branch: `MaybePromise<void>` admits
      // `void | Promise<void>` and not `null`, so writing `return this.connectPromise`
      // is TS2322, not a passing edit (measured). The state it would have to report
      // — a live socket with no gate — is excluded by the field's whole write set:
      // `connectPromise` is assigned in exactly two statements, `start()`'s
      // `= opening` immediately after the promise executor that sets `socket` and
      // `socketActive`, and `stop()`'s `= null` in the same frame as the two clears
      // that un-satisfy the test above. Neither pair yields to anything between its
      // members, so no observer — including a re-entrant `start()` — can see the
      // premise standing while the gate is gone. The statement order inside each
      // frame is not what carries this; any reorder within a frame is equally
      // unobservable, and the `settleConnect()`/`failConnect()` pair that does reach
      // across frames never touches the field.
      return this.connectPromise ?? undefined;
    }
    // A failed or closed socket is one-shot; retain its object only long
    // enough for a transparent same-object reopen to fire, but replace it
    // whenever start() is called again. Clearing the reference here also
    // makes every late callback from the old socket a no-op.
    this.socket = null;
    this.socketActive = false;
    this.handlers = handlers;
    // The factory may live on the constructor connection (createWebSocketDataBus
    // path) or on the runtime config (direct transport use) — accept both.
    const factory = config.webSocketFactory ?? this.connection.webSocketFactory ?? defaultWebSocketFactory;
    const protocols = config.protocols ?? this.connection.protocols;
    let socket: WebSocketLike;
    try {
      socket = factory(config.url, protocols);
    } catch (error) {
      handlers.onStatus(WORKER_STATUS.ERROR);
      handlers.onError(error);
      return;
    }
    const opening = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      // Per-attempt handshake state. A socket that opens, then closes and
      // re-opens in place (a protocol-level recovery) may reuse the same
      // attempt; a timeout or a close/error before the first open permanently
      // invalidates it so a late onopen cannot report readiness.
      let handshakeCompleted = false;
      let handshakeFailed = false;
      const timeoutMs =
        config.connectTimeoutMs ?? this.connection.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        this.connectTimer = setTimeout(() => {
          // This early return has never executed in any run of the suite, and the
          // reason is the same for all three terms: no attempt can leave a timer
          // armed behind it. Term 3 (`handshakeCompleted`) because `onopen` cancels
          // here directly and again through `settleConnect()`; terms 1 and 2 because
          // `this.socket` and `this.handlers` are reassigned only in `start()` and
          // `stop()`, reaching either assignment in `start()` needs `socketActive`
          // already false, and every path that lowers `socketActive` clears the
          // armed timer first — `onclose` and `onerror` through `failConnect()`,
          // `stop()` through `settleConnect()`, and this callback by nulling the
          // handle as it fires. So the guard cannot distinguish anything, which is
          // what its coverage arm records.
          //
          // It stays as the transport's statement that a superseded attempt must
          // never act, because the domination is a property of those cancels rather
          // than of this condition, and the asymmetry is measured: deleting only the
          // `handshakeCompleted` term leaves the suite green, deleting only `failConnect()`'s cancel lets a dead attempt's
          // timeout report a second failure for a connection the application was
          // already told had failed, and the first pin's own comment records the
          // third case — deleting the term *and* both cancels makes a healthy socket
          // report a phantom `onStatus('error')` and get aborted. The two pins name
          // the legs they hold: tests/websocket.test.ts's 'never lets the connect
          // timer tear down a handshake that already completed', and 'leaves no
          // connect timer armed when the handshake fails on a close'.
          if (this.socket !== socket || this.handlers !== handlers || handshakeCompleted) return;
          handshakeFailed = true;
          this.connectTimer = null;
          this.socketActive = false;
          const error = new Error(`WebSocket did not open within ${timeoutMs}ms.`);
          handlers.onStatus(WORKER_STATUS.ERROR);
          handlers.onError(error);
          this.failConnect(error);
          // Abort the half-open handshake so the timed-out attempt cannot
          // linger in CONNECTING or deliver a late onopen.
          this.abortSocket(socket);
        }, timeoutMs);
      }
      socket.onopen = () => {
        if (this.socket !== socket || this.handlers !== handlers || handshakeFailed) return;
        this.socketActive = true;
        this.clearConnectTimer();
        // Re-assert every topic so a reopened socket (recovery path) restores
        // the server-side subscriptions without DataBus involvement.
        for (const topic of this.subscribedTopics) {
          this.sendFrame({ op: WS_OP.SUBSCRIBE, topic });
        }
        handlers.onStatus(WORKER_STATUS.CONNECTED);
        if (!handshakeCompleted) {
          handshakeCompleted = true;
          this.settleConnect();
        }
      };
      socket.onclose = () => {
        if (this.socket !== socket || this.handlers !== handlers || !this.socketActive) return;
        this.socketActive = false;
        handlers.onStatus(WORKER_STATUS.DISCONNECTED);
        if (!handshakeCompleted) {
          handshakeFailed = true;
          this.failConnect(new Error('WebSocket closed before the handshake completed.'));
        }
      };
      socket.onerror = () => {
        if (this.socket !== socket || this.handlers !== handlers || !this.socketActive) return;
        this.socketActive = false;
        handlers.onStatus(WORKER_STATUS.ERROR);
        if (!handshakeCompleted) {
          handshakeFailed = true;
          this.failConnect(new Error('WebSocket failed to open.'));
        }
        // `error` is not guaranteed to be followed by `close` (especially for
        // injected WebSocket implementations). Abort here so DataBus recovery
        // cannot orphan a socket that this transport has already marked dead.
        this.abortSocket(socket);
      };
      socket.onmessage = event => {
        if (this.socket === socket && this.handlers === handlers && this.socketActive) {
          void this.handleMessage(event.data);
        }
      };
      this.socket = socket;
      this.socketActive = true;
    });
    this.connectPromise = opening;
    return opening;
  }

  /** Idempotent: re-subscribing an active topic re-sends the frame but does
   * not duplicate the local tracking entry. */
  subscribe(topic: string): MaybePromise<void> {
    this.subscribedTopics.add(topic);
    this.sendFrame({ op: WS_OP.SUBSCRIBE, topic });
  }

  /** Idempotent for local tracking: an unknown topic has nothing to delete, but
   * the UNSUBSCRIBE frame is still sent, exactly as SUBSCRIBE is re-sent above. */
  unsubscribe(topic: string): MaybePromise<void> {
    this.subscribedTopics.delete(topic);
    this.sendFrame({ op: WS_OP.UNSUBSCRIBE, topic });
  }

  /** Publish `data` to `topic` as a JSON frame. Requires an open socket. */
  publish(topic: string, data: unknown, options?: DataBusPublishOptions): MaybePromise<void> {
    if (data instanceof ArrayBuffer) {
      this.sendBinaryFrame(topic, data, options?.messageId, options?.timestamp);
      return;
    }
    this.sendFrame({
      op: WS_OP.PUBLISH,
      topic,
      data,
      ...(options?.messageId === undefined ? {} : { messageId: options.messageId }),
      ...(options?.timestamp === undefined ? {} : { timestamp: options.timestamp })
    });
  }

  /** Publish many items for one topic as a single wire frame. One-item
   * batches delegate to `publish` so the legacy single-publication frame
   * shape (including binary framing) is preserved. */
  publishBatch(topic: string, items: ReadonlyArray<DataBusPublicationItem>): MaybePromise<void> {
    if (items.length === 0) return;
    if (items.length === 1) {
      const single = items[0]!;
      return this.publish(topic, single.data, {
        ...(single.messageId === undefined ? {} : { messageId: single.messageId }),
        ...(single.timestamp === undefined ? {} : { timestamp: single.timestamp })
      });
    }
    if (this.socket?.readyState !== WS_OPEN) {
      this.handlers?.onError(new Error('WebSocket is not open; dropped "publishBatch" frame.'));
      return;
    }
    // Binary payloads are embedded as byte arrays so the whole batch stays in
    // one JSON frame; the server re-fans them out as individual publications.
    this.socket.send(JSON.stringify({
      op: WS_OP.PUBLISH_BATCH,
      topic,
      items: items.map(item => ({
        data: item.data instanceof ArrayBuffer ? Array.from(new Uint8Array(item.data)) : item.data,
        ...(item.messageId === undefined ? {} : { messageId: item.messageId }),
        ...(item.timestamp === undefined ? {} : { timestamp: item.timestamp })
      }))
    }));
  }

  /** Close the socket and drop all state. Safe to call multiple times. */
  stop(): MaybePromise<void> {
    const socket = this.socket;
    const shouldClose = this.socketActive;
    this.socket = null;
    this.socketActive = false;
    this.handlers = null;
    this.subscribedTopics.clear();
    // Settle an in-flight handshake gate: a DataBus stop() awaits the start
    // Promise, so leaving it pending would hang teardown. Resolving (rather
    // than rejecting) keeps an intentional stop from surfacing as an error.
    this.settleConnect();
    this.connectPromise = null;
    if (shouldClose) socket?.close();
  }

  /** Resolve the in-flight handshake gate. Idempotent: once the socket has
   * opened (or a newer attempt replaced it) later calls are no-ops. */
  private settleConnect(): void {
    this.clearConnectTimer();
    const resolve = this.connectResolve;
    this.connectResolve = null;
    this.connectReject = null;
    resolve?.();
  }

  /** Reject the in-flight handshake gate. Idempotent on the same terms as
   * {@link settleConnect}. */
  private failConnect(error: unknown): void {
    this.clearConnectTimer();
    const reject = this.connectReject;
    this.connectResolve = null;
    this.connectReject = null;
    reject?.(error);
  }

  /** Best-effort close for a socket that can no longer carry transport data.
   * The error that invalidated it has already been reported by the caller. */
  private abortSocket(socket: WebSocketLike): void {
    try {
      socket.close();
    } catch {
      // Some injected implementations throw when close races a failed
      // handshake. The original failure remains the actionable error.
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  /** Send one JSON frame. Frames are dropped with an `onError` report when
   * the socket is not open. A dropped SUBSCRIBE is recovered — `onopen`
   * re-asserts every topic in `subscribedTopics` — but the other two are not:
   * a dropped PUBLISH is the documented at-most-once loss, and a dropped
   * UNSUBSCRIBE is the quieter one, because `unsubscribe()` has already deleted
   * the topic from that set, so no later re-assert resends it and the server
   * keeps streaming a channel the app left. Through the DataBus neither of the
   * two is reachable while closed — `runTransport()` queues both operations
   * behind recovery — so this reads as a direct-transport-contract note. */
  private sendFrame(payload: { op: string; topic: string; data?: unknown; messageId?: string; timestamp?: number }): void {
    if (this.socket?.readyState !== WS_OPEN) {
      this.handlers?.onError(new Error(`WebSocket is not open; dropped "${payload.op}" frame.`));
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private sendBinaryFrame(topic: string, data: ArrayBuffer, messageId?: string, timestamp?: number): void {
    if (messageId !== undefined || timestamp !== undefined) {
      // Binary frames retain their compact legacy shape; metadata is sent as a
      // JSON envelope so IDs are never silently lost.
      this.sendFrame({
        op: WS_OP.PUBLISH,
        topic,
        data: Array.from(new Uint8Array(data)),
        ...(messageId === undefined ? {} : { messageId }),
        ...(timestamp === undefined ? {} : { timestamp })
      });
      return;
    }
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
   * publications, and unknown shapes are dropped silently so a chatty server
   * cannot crash the message path. Malformed JSON is *not* dropped silently: it
   * goes to `handlers.onError` as "WebSocket server sent a non-JSON frame.",
   * which also records it in the bus's last-failure diagnostics. Neither case
   * throws out of the socket listener. */
  private async handleMessage(raw: unknown): Promise<void> {
    // Browser WebSockets may deliver binary frames as Blob unless
    // `binaryType = 'arraybuffer'` is explicitly configured by the host.
    // Normalize Blob asynchronously and reuse the exact ArrayBuffer parser.
    if (typeof Blob !== 'undefined' && raw instanceof Blob) {
      // Blob conversion is asynchronous. Capture the socket/handler pair so a
      // stop/start that replaces the connection while arrayBuffer() is pending
      // cannot let the stale frame leak into the new connection's handlers.
      const socket = this.socket;
      const handlers = this.handlers;
      try {
        const buffer = await raw.arrayBuffer();
        if (this.socket !== socket || this.handlers !== handlers || !this.socketActive) return;
        await this.handleMessage(buffer);
      } catch (error) {
        if (this.socket === socket && this.handlers === handlers && this.socketActive) {
          this.handlers?.onError(error);
        }
      }
      return;
    }
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
    const publication = parseDataBusPublication<TData>(parsed);
    if (publication) this.handlers?.onMessage(publication as DataBusMessage<TData>);
  }
}

/** Resolve the platform WebSocket. Throws in a runtime without one (SSR/Node);
 * it has no null arm, and `start()`'s catch is what turns that throw into an
 * `onStatus('error')` + `onError` report. */
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
