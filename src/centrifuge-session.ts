/**
 * CentrifugeSession — a reusable wrapper around a single Centrifuge client.
 *
 * Provides a structured-clone-safe message protocol (INIT/SUBSCRIBE/UNSUBSCRIBE/
 * PUBLISH/STOP) so the same session class can run inside a Dedicated Worker,
 * a SharedWorker port, or directly on the main thread as a local fallback.
 */
import { Centrifuge } from 'centrifuge';
import type {
  PublicationContext,
  StateContext,
  Subscription,
  SubscriptionErrorContext
} from 'centrifuge';
import type {
  CentrifugeWorkerConfig,
  CentrifugeWorkerInput,
  CentrifugeWorkerOutput,
  SerializedWorkerError
} from './centrifuge-protocol';

/** Callback interface for posting messages back to the transport layer. */
export interface CentrifugeSessionSink<TData = unknown> {
  post(message: CentrifugeWorkerOutput<TData>, transfer?: ArrayBuffer[]): void;
}

/**
 * Stateful Centrifuge client wrapper shared by Dedicated Worker, SharedWorker
 * ports and the main-thread local fallback. Each session owns one connection.
 */
export class CentrifugeSession<TData = unknown> {
  private client: Centrifuge | null = null;
  private readonly subscriptions = new Map<string, Subscription>();
  private transferable = false;

  constructor(private readonly sink: CentrifugeSessionSink<TData>) {}

  /** Dispatch an incoming Worker message to the matching operation. */
  handle(message: CentrifugeWorkerInput): void {
    if (message.type === 'INIT') this.initialize(message.url, message.config, message.transferable === true);
    if (message.type === 'SUBSCRIBE') this.subscribe(message.topic);
    if (message.type === 'UNSUBSCRIBE') this.unsubscribe(message.topic);
    if (message.type === 'PUBLISH') this.publish(message.topic, message.data);
    if (message.type === 'PUBLISH_BIN') this.publish(message.topic, message.data);
    if (message.type === 'STOP') this.stop();
  }

  /** Create the Centrifuge client, wire up lifecycle listeners, and connect. */
  private initialize(url: string, config: CentrifugeWorkerConfig, transferable: boolean): void {
    if (this.client) return;
    this.transferable = transferable;
    const client = new Centrifuge(url, config);
    this.client = client;
    client.on('state', (context: StateContext) => {
      this.post({ type: 'STATUS', status: normalizeStatus(context.newState) });
    });
    client.on('connected', () => this.post({ type: 'STATUS', status: 'connected' }));
    client.on('disconnected', () => this.post({ type: 'STATUS', status: 'disconnected' }));
    client.on('error', context => this.postError(context));
    client.on('publication', (context: PublicationContext) => this.postPublication(context.channel || getPayloadTopic(context.data), context.data));
    client.connect();
  }

  /** Subscribe to a Centrifuge channel. Reuses an existing subscription if one exists. */
  private subscribe(topic: string): void {
    if (!this.client) return this.postError(new Error('Centrifuge client is not initialized.'));
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

  /** Unsubscribe from a Centrifuge channel and clean up the local reference. */
  private unsubscribe(topic: string): void {
    const subscription = this.subscriptions.get(topic) ?? this.client?.getSubscription(topic);
    if (!subscription) return;
    subscription.unsubscribe();
    this.subscriptions.delete(topic);
  }

  /** Publish a message to the Centrifuge channel. */
  private publish(topic: string, data: unknown): void {
    if (!this.client) return this.postError(new Error('Centrifuge client is not initialized.'));
    void this.client.publish(topic, data).catch(error => this.postError(error));
  }

  /** Forward a publication to the transport, using Transferable for binary data when enabled. */
  private postPublication(topic: string, data: unknown): void {
    if (!topic) return;
    if (this.transferable && data instanceof ArrayBuffer) {
      this.post({ type: 'MESSAGE_BIN', topic, data }, [data]);
      return;
    }
    this.post({ type: 'MESSAGE', topic, data: data as TData });
  }

  /** Disconnect the client and clear all subscriptions. */
  private stop(): void {
    this.client?.disconnect();
    this.subscriptions.clear();
    this.client = null;
    this.post({ type: 'STATUS', status: 'disconnected' });
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
    this.post({ type: 'ERROR', error: serializeError(error) });
  }
}

/** Extract a topic from a Centrifuge publication payload if one is present. */
function getPayloadTopic(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const payload = data as { channel?: unknown; push?: { channel?: unknown } };
  const topic = payload.push?.channel ?? payload.channel;
  return typeof topic === 'string' ? topic : '';
}

/** Map a Centrifuge state string to the DataBus's status vocabulary. */
function normalizeStatus(status: string): 'connecting' | 'connected' | 'disconnected' {
  if (status === 'connecting' || status === 'connected') return status;
  return 'disconnected';
}

/** Convert an arbitrary error into a structured-cloneable form for postMessage. */
function serializeError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    };
  }
  return {
    name: 'CentrifugeError',
    message: typeof error === 'string' ? error : 'Centrifuge worker operation failed.',
    ...(error === undefined ? {} : { context: error })
  };
}
