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
 * subset plus the two function-valued hooks that Centrifuge invokes for fresh
 * credentials. Used only inside the session, never across the Worker boundary. */
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
    this.transferable = transferable;
    this.tokenBridge = tokenBridge;
    const clientOptions: CentrifugeWorkerConfig | CentrifugeBridgedOptions = tokenBridge
      ? {
          ...config,
          // Route credential fetches back to the main thread, where the
          // application's credentialProvider lives (config must stay
          // structured-cloneable, so functions cannot cross the boundary).
          getToken: () => this.requestToken('token'),
          getChannelToken: (channel: string) => this.requestToken('channelToken', channel)
        }
      : config;
    const client = new Centrifuge(url, clientOptions);
    this.client = client;
    client.on('state', (context: StateContext) => {
      this.post({ type: CENTRIFUGE_OUTPUT_TYPE.STATUS, status: normalizeStatus(context.newState) });
    });
    client.on('connected', () => this.post({ type: CENTRIFUGE_OUTPUT_TYPE.STATUS, status: WORKER_STATUS.CONNECTED }));
    client.on('disconnected', () => this.post({ type: CENTRIFUGE_OUTPUT_TYPE.STATUS, status: WORKER_STATUS.DISCONNECTED }));
    client.on('error', context => this.postError(context));
    // Client-level publications are only for server-side subscriptions (where
    // no client Subscription object exists). For topics we have an active
    // subscription for, the subscription-level 'publication' listener handles
    // dispatch — skip here to avoid delivering the same message twice.
    client.on('publication', (context: PublicationContext) => {
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
    // Remove only our own listeners so that any Centrifuge internal listeners
    // on the subscription object are preserved. Each subscription event carries
    // a single listener so removeAllListeners(…) is safe here.
    subscription.removeAllListeners('publication');
    subscription.removeAllListeners('error');
    subscription.removeAllListeners('unsubscribed');
    this.subscriptions.set(topic, subscription);
    subscription.on('publication', context => {
      this.postPublication(topic, context.data);
    });
    subscription.on('error', (context: SubscriptionErrorContext) => this.postError(context));
    subscription.on('unsubscribed', () => this.subscriptions.delete(topic));
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
    void this.client.publish(topic, payload).catch(error => this.postError(error));
  }

  /** Forward a publication to the transport. Binary payloads take the
   * zero-copy `MESSAGE_BIN` path when `transferable` is enabled; everything
   * else is structured-cloned via `MESSAGE`. An empty topic means the
   * publication carried no channel info and is silently dropped. */
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
  private requestToken(kind: 'token' | 'channelToken', channel?: string): Promise<string> {
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

