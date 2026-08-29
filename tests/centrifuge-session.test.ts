import { describe, expect, it, vi } from 'vitest';
import type { Centrifuge } from 'centrifuge';
import { CentrifugeSession } from '../src/centrifuge-session';
import type { CentrifugeWorkerOutput } from '../src/centrifuge-protocol';

type AnyListener = (context: unknown) => void;

class FakeSubscription {
  readonly listeners = new Map<string, Set<AnyListener>>();

  removeAllListeners(event: string): this {
    this.listeners.delete(event);
    return this;
  }

  on(event: string, listener: AnyListener): this {
    const set = this.listeners.get(event) ?? new Set<AnyListener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  subscribe(): void {}
  unsubscribe(): void {}
}

const { FakeCentrifuge } = vi.hoisted(() => {
  const instances: FakeCentrifuge[] = [];

  class FakeCentrifuge {
    static readonly instances: FakeCentrifuge[] = instances;

    readonly listeners = new Map<string, Set<AnyListener>>();
    readonly subscriptions = new Map<string, FakeSubscription>();
    publish: (topic: string, data: unknown) => Promise<unknown> = vi.fn();

    constructor(_endpoint: string, _options?: unknown) {
      instances.push(this);
    }

    on(event: string, listener: AnyListener): this {
      const set = this.listeners.get(event) ?? new Set<AnyListener>();
      set.add(listener);
      this.listeners.set(event, set);
      return this;
    }

    connect(): void {}
    disconnect(): void {}

    getSubscription(topic: string): FakeSubscription | null {
      return this.subscriptions.get(topic) ?? null;
    }

    newSubscription(topic: string): FakeSubscription {
      const subscription = new FakeSubscription();
      this.subscriptions.set(topic, subscription);
      return subscription;
    }

    emit(event: string, context: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(context);
    }
  }
  return { FakeCentrifuge };
});

vi.mock('centrifuge', () => ({
  Centrifuge: FakeCentrifuge as unknown as typeof Centrifuge
}));

describe('CentrifugeSession', () => {
  it('reports a publish rejection through the sink', async () => {
    FakeCentrifuge.instances.length = 0;
    const sink = vi.fn();
    const session = new CentrifugeSession({
      post: (message: CentrifugeWorkerOutput) => sink(message)
    });
    session.handle({
      type: 'INIT',
      url: 'wss://example.test/connection/websocket',
      config: {}
    });

    const client = FakeCentrifuge.instances[0]!;
    client.publish = vi.fn().mockRejectedValue(new Error('publish rejected'));
    session.handle({ type: 'PUBLISH', topic: 'market.tick', data: { price: 1 } });
    await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(1));

    expect(sink.mock.calls[0]![0]).toMatchObject({
      type: 'ERROR',
      error: { name: 'Error', message: 'publish rejected' }
    });
  });

  it('does not report errors when publish resolves', async () => {
    FakeCentrifuge.instances.length = 0;
    const sink = vi.fn();
    const session = new CentrifugeSession({
      post: (message: CentrifugeWorkerOutput) => sink(message)
    });
    session.handle({
      type: 'INIT',
      url: 'wss://example.test/connection/websocket',
      config: {}
    });

    FakeCentrifuge.instances[0]!.publish = vi.fn().mockResolvedValue({});
    session.handle({ type: 'PUBLISH', topic: 'market.tick', data: { price: 1 } });
    await vi.waitFor(() => expect(FakeCentrifuge.instances[0]!.publish).toHaveBeenCalled());
    await Promise.resolve();
    expect(sink).not.toHaveBeenCalled();
  });
});

describe('CentrifugeSession additional coverage', () => {
  it('transfers an ArrayBuffer via MESSAGE_BIN when transferable is enabled', async () => {
    FakeCentrifuge.instances.length = 0;
    const sink = vi.fn();
    const session = new CentrifugeSession<unknown>({
      post: (message: CentrifugeWorkerOutput, transfer?: ArrayBuffer[]) => sink(message, transfer)
    });
    session.handle({
      type: 'INIT',
      url: 'wss://example.test/connection/websocket',
      config: {},
      transferable: true
    });

    const client = FakeCentrifuge.instances[0]!;
    // Subscribe so a subscription-level publication listener exists.
    session.handle({ type: 'SUBSCRIBE', topic: 'market.tick' });
    const subscription = client.getSubscription('market.tick')!;

    // PUBLISH_BIN with an ArrayBuffer — accepted by the publish path without error.
    client.publish = vi.fn().mockResolvedValue({});
    const pubBuffer = new ArrayBuffer(4);
    session.handle({ type: 'PUBLISH_BIN', topic: 'market.tick', data: pubBuffer });
    await vi.waitFor(() => expect(client.publish).toHaveBeenCalled());
    expect(client.publish).toHaveBeenCalledWith('market.tick', pubBuffer);

    // Simulate a server-side publication delivering an ArrayBuffer back on the
    // subscription's 'publication' listener — this exercises the zero-copy
    // MESSAGE_BIN sink path with the ArrayBuffer in the transfer list.
    const payload = new ArrayBuffer(8);
    new Uint8Array(payload).set([10, 20, 30, 40]);
    const publicationListeners = subscription.listeners.get('publication');
    expect(publicationListeners?.size).toBeGreaterThan(0);
    for (const listener of publicationListeners ?? []) {
      (listener as (context: unknown) => void)({ data: payload });
    }

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MESSAGE_BIN', topic: 'market.tick', data: payload }),
      [payload]
    );
  });

  it('reuses an existing subscription when subscribing to the same topic twice', () => {
    FakeCentrifuge.instances.length = 0;
    const sink = vi.fn();
    const session = new CentrifugeSession({
      post: (message: CentrifugeWorkerOutput) => sink(message)
    });
    session.handle({
      type: 'INIT',
      url: 'wss://example.test/connection/websocket',
      config: {}
    });

    const client = FakeCentrifuge.instances[0]!;
    const newSubscriptionSpy = vi.spyOn(client, 'newSubscription');

    // First SUBSCRIBE creates a new subscription.
    session.handle({ type: 'SUBSCRIBE', topic: 'market.tick' });
    expect(newSubscriptionSpy).toHaveBeenCalledTimes(1);

    // Second SUBSCRIBE on the same topic — should reuse the existing subscription
    // via getSubscription, so newSubscription is not called again.
    session.handle({ type: 'SUBSCRIBE', topic: 'market.tick' });
    expect(newSubscriptionSpy).toHaveBeenCalledTimes(1);

    // The same subscription object is reused.
    expect(client.getSubscription('market.tick')).toBe(client.getSubscription('market.tick'));
  });

  it('posts a disconnected STATUS on STOP and leaves the session usable', () => {
    FakeCentrifuge.instances.length = 0;
    const sink = vi.fn();
    const session = new CentrifugeSession({
      post: (message: CentrifugeWorkerOutput) => sink(message)
    });
    session.handle({
      type: 'INIT',
      url: 'wss://example.test/connection/websocket',
      config: {}
    });

    session.handle({ type: 'STOP' });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ type: 'STATUS', status: 'disconnected' }));

    // After STOP, client is null. A subsequent SUBSCRIBE should not throw.
    expect(() => session.handle({ type: 'SUBSCRIBE', topic: 'market.tick' })).not.toThrow();
  });

  it('ignores unknown message types without throwing', () => {
    FakeCentrifuge.instances.length = 0;
    const sink = vi.fn();
    const session = new CentrifugeSession({
      post: (message: CentrifugeWorkerOutput) => sink(message)
    });
    session.handle({
      type: 'INIT',
      url: 'wss://example.test/connection/websocket',
      config: {}
    });

    expect(() => session.handle({ type: 'UNKNOWN' as never })).not.toThrow();
    // No additional sink calls beyond the normal INIT flow.
    expect(sink).not.toHaveBeenCalled();
  });
});

describe('CentrifugeSession protocol coverage', () => {
  function makeSession() {
    FakeCentrifuge.instances.length = 0;
    const sink = vi.fn();
    const session = new CentrifugeSession({
      post: (message: CentrifugeWorkerOutput) => sink(message)
    });
    return { sink, session };
  }

  function init() {
    return {
      type: 'INIT' as const,
      url: 'wss://example.test/connection/websocket',
      config: {}
    };
  }

  it('unsubscribes and removes listeners before detaching', () => {
    const { sink, session } = makeSession();
    session.handle(init());
    const client = FakeCentrifuge.instances[0]!;
    session.handle({ type: 'SUBSCRIBE', topic: 'market.tick' });
    const subscription = client.getSubscription('market.tick')!;
    expect(subscription.listeners.has('publication')).toBe(true);

    session.handle({ type: 'UNSUBSCRIBE', topic: 'market.tick' });
    expect(subscription.listeners.size).toBe(0);
    expect(sink).not.toHaveBeenCalled();

    // Unsubscribing an unknown topic is a no-op.
    expect(() => session.handle({ type: 'UNSUBSCRIBE', topic: 'ghost' })).not.toThrow();
  });

  it('posts an ERROR for SUBSCRIBE/PUBLISH before INIT', () => {
    const { sink, session } = makeSession();
    session.handle({ type: 'SUBSCRIBE', topic: 't' });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ERROR',
        error: expect.objectContaining({ name: 'Error', message: 'Centrifuge client is not initialized.' })
      })
    );
    session.handle({ type: 'PUBLISH', topic: 't', data: 1 });
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('ignores a duplicate INIT', () => {
    const { sink, session } = makeSession();
    session.handle(init());
    session.handle(init());
    expect(FakeCentrifuge.instances).toHaveLength(1);
    expect(sink).not.toHaveBeenCalled();
  });

  it('maps Centrifuge state changes through normalizeStatus', () => {
    const { sink, session } = makeSession();
    session.handle(init());
    const client = FakeCentrifuge.instances[0]!;
    client.emit('state', { newState: 'connecting' });
    client.emit('state', { newState: 'connected' });
    client.emit('state', { newState: 'disconnected' });
    expect(sink).toHaveBeenNthCalledWith(1, { type: 'STATUS', status: 'connecting' });
    expect(sink).toHaveBeenNthCalledWith(2, { type: 'STATUS', status: 'connected' });
    expect(sink).toHaveBeenNthCalledWith(3, { type: 'STATUS', status: 'disconnected' });
  });

  it('delivers server-side client publications not backed by a local subscription', () => {
    const { sink, session } = makeSession();
    session.handle(init());
    const client = FakeCentrifuge.instances[0]!;

    // Explicit channel on the context.
    client.emit('publication', { channel: 'server.push', data: { n: 1 } });
    expect(sink).toHaveBeenCalledWith({ type: 'MESSAGE', topic: 'server.push', data: { n: 1 } });

    // Topic nested inside push.channel (server-side push shape).
    client.emit('publication', { data: { push: { channel: 'nested.topic' }, n: 2 } });
    expect(sink).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'MESSAGE', topic: 'nested.topic' })
    );

    // No topic derivable — silently dropped.
    client.emit('publication', { data: { n: 3 } });
    expect(sink).toHaveBeenCalledTimes(2);

    // Local subscription exists for the topic — skipped to avoid double delivery.
    session.handle({ type: 'SUBSCRIBE', topic: 'local.topic' });
    client.emit('publication', { channel: 'local.topic', data: { n: 4 } });
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('serialises non-Error failures with the right shape', () => {
    const { sink, session } = makeSession();
    session.handle(init());
    const client = FakeCentrifuge.instances[0]!;
    client.publish = vi.fn().mockRejectedValue('boom-string');
    session.handle({ type: 'PUBLISH', topic: 't', data: 1 });
    return vi.waitFor(() => {
      expect(sink).toHaveBeenCalledWith({
        type: 'ERROR',
        error: { name: 'CentrifugeError', message: 'boom-string', context: 'boom-string' }
      });
    });
  });

  it('serialises object failures with a context field', async () => {
    const { sink, session } = makeSession();
    session.handle(init());
    const client = FakeCentrifuge.instances[0]!;
    client.publish = vi.fn().mockRejectedValue({ code: 42 });
    session.handle({ type: 'PUBLISH', topic: 't', data: 1 });
    await vi.waitFor(() => expect(sink).toHaveBeenCalled());
    expect(sink).toHaveBeenCalledWith({
      type: 'ERROR',
      error: { name: 'CentrifugeError', message: 'Centrifuge worker operation failed.', context: { code: 42 } }
    });
  });

  it('reports subscription errors through the sink', async () => {
    const { sink, session } = makeSession();
    session.handle(init());
    const client = FakeCentrifuge.instances[0]!;
    session.handle({ type: 'SUBSCRIBE', topic: 'market.tick' });
    const subscription = client.getSubscription('market.tick')!;
    for (const listener of subscription.listeners.get('error') ?? []) {
      (listener as (context: unknown) => void)({ type: 'subscribe:error', error: new Error('sub failed') });
    }
    await vi.waitFor(() => expect(sink).toHaveBeenCalled());
    // The session serialises the SubscriptionErrorContext itself, wrapping it
    // as a non-Error failure with the original context attached.
    expect(sink).toHaveBeenCalledWith({
      type: 'ERROR',
      error: expect.objectContaining({
        name: 'CentrifugeError',
        message: 'Centrifuge worker operation failed.',
        context: expect.objectContaining({ type: 'subscribe:error' })
      })
    });
  });
});
