/**
 * CentrifugeSession — a reusable wrapper around a single Centrifuge client.
 *
 * Provides a structured-clone-safe message protocol (INIT/SUBSCRIBE/UNSUBSCRIBE/
 * PUBLISH/STOP) so the same session class can run inside a Dedicated Worker,
 * a SharedWorker port, or directly on the main thread as a local fallback.
 */
import { Centrifuge } from 'centrifuge';
import { parseDataBusPublication } from './core/publication';
import type {
  PublicationContext,
  StateContext,
  Subscription,
  SubscriptionErrorContext
} from 'centrifuge';
import type {
  CentrifugeWorkerConfig,
  CentrifugeWorkerInput,
  CentrifugeWorkerOutput
} from './centrifuge-protocol';
import { CENTRIFUGE_INPUT_TYPE, CENTRIFUGE_OUTPUT_TYPE, WORKER_STATUS } from './utils/constants';
import { publicationMetadata } from './utils/metadata';
import { deserializeWorkerError, serializeError } from './utils/error-utils';

/** Callback interface for posting messages back to the transport layer. */
export interface CentrifugeSessionSink<TData = unknown> {
  post(message: CentrifugeWorkerOutput<TData>, transfer?: ArrayBuffer[]): void;
}

/** A pending getToken/getChannelToken request awaiting a main-thread response. */
interface PendingTokenRequest {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}

/** Centrifuge client options for token-bridge mode: the structured-clone-safe
 * subset plus the function-valued credential hooks this session installs.
 * Against the pinned SDK (5.7.4) `getToken` is the only one that is a real
 * client option (`types.d.ts:126`, and the same hook serves renewal);
 * `getChannelToken` appears nowhere in the package's types or build, and
 * subscriptions are created with `newSubscription(topic)` and no per-
 * subscription options — so that hook is never invoked, and the `'channelToken'`
 * request kind is produced only by the test fake. It stays because the Worker
 * protocol carries the kind: an SDK that later names it would need no change on
 * this side. Used only inside the session, never across the Worker boundary. */
type CentrifugeBridgedOptions = Omit<CentrifugeWorkerConfig, 'getToken' | 'getChannelToken'> & {
  getToken: () => Promise<string>;
  getChannelToken: (channel: string) => Promise<string>;
};

/**
 * Stateful Centrifuge client wrapper shared by Dedicated Worker, SharedWorker
 * ports and the main-thread local fallback. Each session owns one connection.
 */
export class CentrifugeSession<TData = unknown> {
  private client: Centrifuge | null = null;
  private readonly subscriptions = new Map<string, Subscription>();
  private transferable = false;
  private tokenBridge = false;
  private nextRequestId = 1;
  // Bumped on every initialize/stop. Async client callbacks capture the value
  // from the connection that created them so a stopped client cannot emit into
  // a later session instance (including the main-thread local fallback).
  private lifecycle = 0;
  private readonly pendingTokenRequests = new Map<number, PendingTokenRequest>();

  constructor(private readonly sink: CentrifugeSessionSink<TData>) {}

  /** Dispatch an incoming Worker message to the matching operation.
   * Unknown message types are ignored rather than thrown, so a future protocol
   * extension adding a new variant cannot crash an older session. */
  handle(message: CentrifugeWorkerInput): void {
    switch (message.type) {
      case CENTRIFUGE_INPUT_TYPE.INIT:
        this.initialize(message.url, message.config, message.transferable === true, message.tokenBridge === true);
        return;
      case CENTRIFUGE_INPUT_TYPE.SUBSCRIBE:
        this.subscribe(message.topic);
        return;
      case CENTRIFUGE_INPUT_TYPE.UNSUBSCRIBE:
        this.unsubscribe(message.topic);
        return;
      case CENTRIFUGE_INPUT_TYPE.PUBLISH:
      case CENTRIFUGE_INPUT_TYPE.PUBLISH_BIN:
        // Binary and JSON publish share the same Centrifuge client call; the
        // transport layer decides whether to transfer the ArrayBuffer.
        this.publish(message.topic, message.data, message.messageId, message.timestamp);
        return;
      case CENTRIFUGE_INPUT_TYPE.STOP:
        this.stop();
        return;
      case CENTRIFUGE_INPUT_TYPE.TOKEN_RESPONSE:
        this.resolveToken(message.requestId, message.token);
        return;
      case CENTRIFUGE_INPUT_TYPE.TOKEN_ERROR:
        this.rejectToken(message.requestId, deserializeWorkerError(message.error));
        return;
      default:
        return;
    }
  }

  /** Create the Centrifuge client, wire up lifecycle listeners, and connect. */
  private initialize(url: string, config: CentrifugeWorkerConfig, transferable: boolean, tokenBridge: boolean): void {
    if (this.client) return;
    const lifecycle = ++this.lifecycle;
    this.transferable = transferable;
    this.tokenBridge = tokenBridge;
    const clientOptions: CentrifugeWorkerConfig | CentrifugeBridgedOptions = tokenBridge
      ? {
          ...config,
          // Route credential fetches back to the main thread, where the
          // application's credentialProvider lives (config must stay
          // structured-cloneable, so functions cannot cross the boundary).
          getToken: () => this.requestToken('token', lifecycle),
          getChannelToken: (channel: string) => this.requestToken('channelToken', lifecycle, channel)
        }
      : config;
    const client = new Centrifuge(url, clientOptions);
    this.client = client;
    client.on('state', (context: StateContext) => {
      if (this.lifecycle !== lifecycle) return;
      this.post({ type: CENTRIFUGE_OUTPUT_TYPE.STATUS, status: normalizeStatus(context.newState) });
    });
    client.on('connected', () => {
      if (this.lifecycle !== lifecycle) return;
      this.post({ type: CENTRIFUGE_OUTPUT_TYPE.STATUS, status: WORKER_STATUS.CONNECTED });
    });
    client.on('disconnected', () => {
      if (this.lifecycle !== lifecycle) return;
      this.post({ type: CENTRIFUGE_OUTPUT_TYPE.STATUS, status: WORKER_STATUS.DISCONNECTED });
    });
    client.on('error', context => {
      if (this.lifecycle !== lifecycle) return;
      this.postError(context);
    });
    // Client-level publications are only for server-side subscriptions (where
    // no client Subscription object exists). For topics we have an active
    // subscription for, the subscription-level 'publication' listener handles
    // dispatch — skip here to avoid delivering the same message twice.
    client.on('publication', (context: PublicationContext) => {
      if (this.lifecycle !== lifecycle) return;
      const topic = context.channel || getPayloadTopic(context.data);
      if (!topic || this.subscriptions.has(topic)) return;
      this.postPublication(topic, context.data);
    });
    client.connect();
  }

  /** Subscribe to a Centrifuge channel. Reuses an existing subscription if one exists.
   * Listeners are only registered once per subscription object — a repeated
   * SUBSCRIBE for an already-tracked topic skips the listener wiring entirely,
   * avoiding the removeAllListeners + re-on churn on every duplicate message. */
  private subscribe(topic: string): void {
    if (!this.client) return this.postError(new Error('Centrifuge client is not initialized.'));
    const lifecycle = this.lifecycle;
    // If we already track this subscription, it already has our listeners —
    // a duplicate SUBSCRIBE is a no-op (idempotent), matching the transport
    // contract. Only a fresh subscription needs listener wiring.
    const existing = this.subscriptions.get(topic);
    if (existing) {
      existing.subscribe();
      return;
    }
    let subscription = this.client.getSubscription(topic);
    if (!subscription) subscription = this.client.newSubscription(topic);
    // Scoped to the three events this method wires, so the client's own `state`
    // wiring is untouched — but `error` is NOT internal-listener-free: the
    // Subscription constructor installs its own no-op `error` listener precisely
    // "to avoid unhandled exception in EventEmitter for non-set error handler"
    // (centrifuge 5.7.4, build/index.js:762), and the bundled emitter throws on
    // an `error` emit with no listener (`:162`). This call removes that guard,
    // and the `.on('error', …)` two statements below replaces it for as long as
    // this session holds the subscription. `unsubscribe()` removes both and adds
    // nothing back, which is the open question at this boundary: every
    // `emit('error')` site in `BaseSubscription` that was checked is behind a
    // `_isSubscribing()`/`_isSubscribed()` guard, so no post-unsubscribe throw
    // has been produced — see docs/progress.md, Phase 134.
    subscription.removeAllListeners('publication');
    subscription.removeAllListeners('error');
    subscription.removeAllListeners('unsubscribed');
    this.subscriptions.set(topic, subscription);
    subscription.on('publication', context => {
      if (this.lifecycle !== lifecycle) return;
      this.postPublication(topic, context.data);
    });
    subscription.on('error', (context: SubscriptionErrorContext) => {
      if (this.lifecycle !== lifecycle) return;
      this.postError(context);
    });
    subscription.on('unsubscribed', () => {
      if (this.lifecycle === lifecycle) this.subscriptions.delete(topic);
    });
    subscription.subscribe();
  }

  /** Unsubscribe from a Centrifuge channel and clean up the local reference.
   * Listeners are removed before unsubscribing so a late `unsubscribed` event
   * cannot delete a subscription that a subsequent `subscribe()` re-added. */
  private unsubscribe(topic: string): void {
    const subscription = this.subscriptions.get(topic) ?? this.client?.getSubscription(topic);
    if (!subscription) return;
    subscription.removeAllListeners('publication');
    subscription.removeAllListeners('error');
    subscription.removeAllListeners('unsubscribed');
    this.subscriptions.delete(topic);
    subscription.unsubscribe();
  }

  /** Publish a message to the Centrifuge channel. */
  private publish(topic: string, data: unknown, messageId?: string, timestamp?: number): void {
    if (!this.client) return this.postError(new Error('Centrifuge client is not initialized.'));
    const lifecycle = this.lifecycle;
    // Centrifuge's payload is application-defined. Preserve legacy payloads;
    // when an ID is requested, send a small metadata envelope that compatible
    // servers can echo back for end-to-end deduplication.
    const hasMetadata = messageId !== undefined || timestamp !== undefined;
    const payload = hasMetadata
      ? {
          data,
          ...(messageId === undefined ? {} : { messageId }),
          ...(timestamp === undefined ? {} : { timestamp })
        }
      : data;
    void this.client.publish(topic, payload).catch(error => {
      if (this.lifecycle === lifecycle) this.postError(error);
    });
  }

  /** Forward a publication to the transport. Binary payloads take the
   * zero-copy `MESSAGE_BIN` path when `transferable` is enabled; everything
   * else is structured-cloned via `MESSAGE`. An empty topic means the
   * publication carried no channel info and is silently dropped.
   *
   * That drop is uncovered and dominated: the connection-level caller tests the
   * same emptiness before calling, and the subscription-level caller reads the
   * topic out of a key this session only ever populates from a SUBSCRIBE frame.
   * Measured — deleting this line leaves all 37 test files green, and the frame
   * it withholds has nowhere to land anyway: the only handler registry is the
   * DataBus's `topicHandlers`, and every write to it sits behind
   * `assertPublicTopic` (`data-bus.ts:929`, `:1009`, `:1033`), so no `''` key can
   * exist — while `topicMatchesPattern` answers false for an empty topic against
   * both `*` and `prefix.*`, so a wildcard handler cannot see it either. Neither
   * of those is a reason to delete this guard: it is the only one *at this layer*,
   * because neither the session nor the transport calls `assertPublicTopic` — a
   * SUBSCRIBE frame naming `''` creates a real Centrifuge subscription
   * (`newSubscription` does not validate a channel), so the undeliverable
   * publication would otherwise be posted back to the main thread. Kept as the
   * boundary statement, not counted as a closed leg. */
  private postPublication(topic: string, data: unknown): void {
    if (!topic) return;
    if (this.transferable && data instanceof ArrayBuffer) {
      this.post({ type: CENTRIFUGE_OUTPUT_TYPE.MESSAGE_BIN, topic, data }, [data]);
      return;
    }
    const publication = parseDataBusPublication<TData>(data, topic);
    if (!publication) return;
    this.post({
      type: CENTRIFUGE_OUTPUT_TYPE.MESSAGE,
      topic: publication.topic,
      data: publication.data,
      ...publicationMetadata(publication.messageId, publication.timestamp)
    });
  }

  /** Disconnect the client and clear all subscriptions. */
  private stop(): void {
    // Invalidate callbacks from the connection being stopped before disconnect
    // so its synchronous or queued events cannot leak into a later session.
    this.lifecycle += 1;
    // Settle every in-flight credential request so a stop cannot leave the
    // Worker awaiting a main-thread response forever.
    for (const [, pending] of this.pendingTokenRequests) {
      pending.reject(new Error('Centrifuge session stopped before the credential was resolved.'));
    }
    this.pendingTokenRequests.clear();
    this.client?.disconnect();
    this.subscriptions.clear();
    this.client = null;
    this.post({ type: CENTRIFUGE_OUTPUT_TYPE.STATUS, status: WORKER_STATUS.DISCONNECTED });
  }

  /** Issue a credential request to the main thread and await the response.
   * Used as Centrifuge's `getToken` / `getChannelToken` when token bridging is
   * enabled; resolved or rejected by a matching TOKEN_RESPONSE / TOKEN_ERROR. */
  private requestToken(kind: 'token' | 'channelToken', lifecycle: number, channel?: string): Promise<string> {
    // The provider is installed on a specific Centrifuge client. An old client
    // must not be able to route a late credential request into a replacement
    // session merely because it retained the callback closure.
    if (this.lifecycle !== lifecycle) {
      return Promise.reject(new Error('Centrifuge client lifecycle has ended before the credential was requested.'));
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<string>((resolve, reject) => {
      this.pendingTokenRequests.set(requestId, { resolve, reject });
      this.post({
        type: CENTRIFUGE_OUTPUT_TYPE.TOKEN_REQUEST,
        requestId,
        kind,
        ...(channel === undefined ? {} : { channel })
      });
    });
  }

  private resolveToken(requestId: number, token: string): void {
    const pending = this.pendingTokenRequests.get(requestId);
    if (!pending) return;
    this.pendingTokenRequests.delete(requestId);
    pending.resolve(token);
  }

  private rejectToken(requestId: number, error: unknown): void {
    const pending = this.pendingTokenRequests.get(requestId);
    if (!pending) return;
    this.pendingTokenRequests.delete(requestId);
    pending.reject(error);
  }

  /** Forward a message to the sink (the transport layer). */
  private post(message: CentrifugeWorkerOutput<TData>, transfer?: ArrayBuffer[]): void {
    this.sink.post(message, transfer);
  }

  /** Serialise and report an error. The Centrifuge client handles reconnection
   * internally, so a transient error should not trigger a `STATUS: error` that
   * would cause `selectActiveWorkers()` to exclude this worker from routing.
   * Fatal errors are distinguished by the client eventually emitting
   * `disconnected` without a subsequent `connected`. */
  private postError(error: unknown): void {
    this.post({ type: CENTRIFUGE_OUTPUT_TYPE.ERROR, error: serializeError(error) });
  }
}

/** Extract a topic from a Centrifuge publication payload if one is present.
 * Handles both direct `channel` fields and the nested `push.channel` shape
 * that Centrifugo uses for some server-side push types. */
function getPayloadTopic(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const payload = data as Record<string, unknown>;
  // Prefer nested push.channel (server-side push) then fall back to top-level channel.
  const push = payload.push;
  const nested = typeof push === 'object' && push !== null ? (push as Record<string, unknown>).channel : undefined;
  const topic = nested ?? payload.channel;
  return typeof topic === 'string' ? topic : '';
}

/** Map a Centrifuge state string to the DataBus's status vocabulary.
 * 'connecting' and 'connected' pass through; anything else (e.g. 'reconnecting',
 * 'disconnected') maps to 'disconnected'. */
const LIVE_STATES = new Set<string>([WORKER_STATUS.CONNECTING, WORKER_STATUS.CONNECTED]);
function normalizeStatus(status: string): 'connecting' | 'connected' | 'disconnected' {
  return LIVE_STATES.has(status) ? (status as 'connecting' | 'connected') : 'disconnected';
}
