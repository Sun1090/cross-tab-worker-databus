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
