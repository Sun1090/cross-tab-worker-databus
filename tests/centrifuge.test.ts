import { afterEach, describe, expect, it, vi } from 'vitest';
import { CentrifugeWorkerTransport, createCentrifugeDataBus } from '../src/centrifuge';
import type {
  CentrifugeWorkerInput,
  CentrifugeWorkerOutput
} from '../src/centrifuge-protocol';
import { createFakeEnvironment, MemoryStorage } from './fakes';

class WorkerDouble {
  readonly messages: CentrifugeWorkerInput[] = [];
  readonly transfers: Array<ArrayBuffer[]> = [];

  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}

  postMessage(message: CentrifugeWorkerInput, transfer?: ArrayBuffer[]): void {
    this.messages.push(message);
    if (transfer) this.transfers.push(transfer);
  }
}

class PortDouble {
  readonly messages: CentrifugeWorkerInput[] = [];
  readonly transfers: Array<ArrayBuffer[]> = [];
  readonly activeListeners = new Set<string>();
  private readonly messageListeners = new Set<
    (event: MessageEvent<CentrifugeWorkerOutput>) => void
  >();

  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<CentrifugeWorkerOutput>) => void
  ): void {
    this.activeListeners.add(type);
    if (type === 'message') this.messageListeners.add(listener);
  }

  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<CentrifugeWorkerOutput>) => void
  ): void {
    this.activeListeners.delete(type);
    if (type === 'message') this.messageListeners.delete(listener);
  }

  start(): void {}
  close(): void {}

  postMessage(message: CentrifugeWorkerInput, transfer?: ArrayBuffer[]): void {
    this.messages.push(message);
    if (transfer) this.transfers.push(transfer);
  }

  emit(message: CentrifugeWorkerOutput): void {
    const event = { data: message } as MessageEvent<CentrifugeWorkerOutput>;
    for (const listener of [...this.messageListeners]) listener(event);
  }
}

class SharedWorkerDouble {
  readonly port = new PortDouble();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();
  errorListenerCount = 0;

  addEventListener(_type: 'error', listener: (event: ErrorEvent) => void): void {
    this.errorListeners.add(listener);
    this.errorListenerCount = this.errorListeners.size;
  }

  removeEventListener(_type: 'error', listener: (event: ErrorEvent) => void): void {
    this.errorListeners.delete(listener);
    this.errorListenerCount = this.errorListeners.size;
  }

  fail(): void {
    for (const listener of [...this.errorListeners]) listener({} as ErrorEvent);
  }
}

describe('createCentrifugeDataBus', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('derives the cluster, starts automatically and queues an immediate subscription', async () => {
    const worker = new WorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'adapter'
    });
    const bus = createCentrifugeDataBus({
      connection: {
        url: 'wss://example.test/connection/websocket',
        options: { token: 'runtime-credential' }
      },
      environment: environment.environment,
      workerFactory: () => worker as unknown as Worker
    });

    bus.subscribe('market.tick', () => undefined);
    await bus.ready();

    expect(worker.messages).toEqual([
      {
        type: 'INIT',
        url: 'wss://example.test/connection/websocket',
        config: { token: 'runtime-credential' }
      },
      { type: 'SUBSCRIBE', topic: 'market.tick' }
    ]);
  });

  it('transfers ArrayBuffer payloads when transferable is enabled', async () => {
    const worker = new WorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'binary'
    });
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      transferable: true,
      workerFactory: () => worker as unknown as Worker
    });

    bus.subscribe('market.tick', () => undefined);
    await bus.ready();
    const payload = new ArrayBuffer(8);
    new Uint8Array(payload).set([1, 2, 3, 4]);
    bus.publish('market.tick', payload);

    expect(worker.messages.find(message => message.type === 'PUBLISH_BIN')).toEqual({
      type: 'PUBLISH_BIN',
      topic: 'market.tick',
      data: payload
    });
    expect(worker.transfers[0]).toEqual([payload]);
  });

  it('keeps object payloads on the object API when transferable is enabled', async () => {
    const worker = new WorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'object-payload'
    });
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      transferable: true,
      workerFactory: () => worker as unknown as Worker
    });

    bus.subscribe('market.tick', () => undefined);
    await bus.ready();
    bus.publish('market.tick', { price: 100 });

    expect(worker.messages.find(message => message.type === 'PUBLISH')).toEqual({
      type: 'PUBLISH',
      topic: 'market.tick',
      data: { price: 100 }
    });
    expect(worker.transfers).toEqual([]);
  });

  it('delivers MESSAGE_BIN publications through the object message API', async () => {
    const shared = new SharedWorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'binary-receive'
    });
    const received: ArrayBuffer[] = [];
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => shared as unknown as SharedWorker,
      transferable: true,
      workerMode: 'shared'
    });

    bus.subscribe('market.tick', message => received.push(message.data as ArrayBuffer));
    await bus.ready();
    const payload = new ArrayBuffer(4);
    new Uint8Array(payload).set([9, 8, 7, 6]);
    shared.port.emit({ type: 'MESSAGE_BIN', topic: 'market.tick', data: payload });

    expect(received).toEqual([payload]);
  });

  it('uses SharedWorker mode and forwards port publications to handlers', async () => {
    const shared = new SharedWorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'shared'
    });
    const received: number[] = [];
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => shared as unknown as SharedWorker,
      workerMode: 'shared'
    });

    bus.subscribe('market.tick', message => received.push(message.data as number));
    await bus.ready();

    expect(shared.port.messages).toEqual([
      {
        type: 'INIT',
        url: 'wss://example.test/connection/websocket',
        config: {}
      },
      { type: 'SUBSCRIBE', topic: 'market.tick' }
    ]);

    shared.port.emit({ type: 'STATUS', status: 'connected' });
    shared.port.emit({ type: 'MESSAGE', topic: 'market.tick', data: 7 });
    expect(received).toEqual([7]);
  });

  it('sends periodic PING heartbeats to the SharedWorker and clears them on stop', async () => {
    vi.useFakeTimers();
    const shared = new SharedWorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'ping'
    });
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => shared as unknown as SharedWorker,
      workerMode: 'shared'
    });

    bus.subscribe('market.tick', vi.fn());
    await bus.ready();
    expect(shared.port.messages.some(message => message.type === 'PING')).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(shared.port.messages.some(message => message.type === 'PING')).toBe(true);

    const pingCount = shared.port.messages.filter(message => message.type === 'PING').length;
    await bus.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(shared.port.messages.filter(message => message.type === 'PING')).toHaveLength(pingCount);
  });

  it('forwards a custom heartbeatIntervalMs in the INIT message', async () => {
    const shared = new SharedWorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'custom-hb'
    });
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => shared as unknown as SharedWorker,
      workerMode: 'shared',
      heartbeatIntervalMs: 5000
    });

    bus.subscribe('market.tick', vi.fn());
    await bus.ready();

    const init = shared.port.messages.find(m => m.type === 'INIT') as
      | (CentrifugeWorkerInput & { type: 'INIT' })
      | undefined;
    expect(init?.heartbeatIntervalMs).toBe(5000);
    await bus.stop();
  });

  it('omits heartbeatIntervalMs from INIT when using the default', async () => {
    const shared = new SharedWorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'default-hb'
    });
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => shared as unknown as SharedWorker,
      workerMode: 'shared'
    });

    bus.subscribe('market.tick', vi.fn());
    await bus.ready();

    const init = shared.port.messages.find(m => m.type === 'INIT') as
      | (CentrifugeWorkerInput & { type: 'INIT' })
      | undefined;
    expect(init?.heartbeatIntervalMs).toBeUndefined();
    await bus.stop();
  });

  it('disables PING entirely when heartbeatIntervalMs is Infinity', async () => {
    vi.useFakeTimers();
    const shared = new SharedWorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'inf-hb'
    });
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => shared as unknown as SharedWorker,
      workerMode: 'shared',
      heartbeatIntervalMs: Infinity
    });

    bus.subscribe('market.tick', vi.fn());
    await bus.ready();

    // No PINGs should ever be sent, even after advancing time.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(shared.port.messages.filter(m => m.type === 'PING')).toEqual([]);
    await bus.stop();
  });

  it('detaches all SharedWorker listeners on stop', async () => {
    const shared = new SharedWorkerDouble();
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'detach'
    });
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => shared as unknown as SharedWorker,
      workerMode: 'shared'
    });

    bus.subscribe('market.tick', vi.fn());
    await bus.ready();
    expect(shared.port.activeListeners).toEqual(new Set(['message', 'messageerror']));
    expect(shared.errorListenerCount).toBe(1);

    await bus.stop();
    expect(shared.port.activeListeners.size).toBe(0);
    expect(shared.errorListenerCount).toBe(0);
  });

  it('prefers SharedWorker in auto mode when the environment supports it', async () => {
    const shared = new SharedWorkerDouble();
    vi.stubGlobal('SharedWorker', SharedWorkerDouble);
    vi.stubGlobal('Worker', undefined);
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'auto-shared'
    });
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => shared as unknown as SharedWorker,
      workerMode: 'auto'
    });

    bus.subscribe('market.tick', vi.fn());
    await bus.ready();

    expect(shared.port.messages.map(message => message.type)).toEqual([
      'INIT',
      'SUBSCRIBE'
    ]);
  });

  it('discards the failed shared worker so late messages do not reach the reopened session', async () => {
    vi.useFakeTimers();
    const sharedWorkers: SharedWorkerDouble[] = [];
    const environment = createFakeEnvironment({
      storage: new MemoryStorage(),
      now: () => 1_000,
      randomId: 'failed-shared'
    });
    const received: number[] = [];
    const bus = createCentrifugeDataBus({
      connection: { url: 'wss://example.test/connection/websocket' },
      environment: environment.environment,
      sharedWorkerFactory: () => {
        const shared = new SharedWorkerDouble();
        sharedWorkers.push(shared);
        return shared as unknown as SharedWorker;
      },
      workerMode: 'shared'
    });

    bus.subscribe('market.tick', message => received.push(message.data as number));
    await bus.ready();
    expect(sharedWorkers).toHaveLength(1);

    sharedWorkers[0]!.fail();
    sharedWorkers[0]!.port.emit({ type: 'MESSAGE', topic: 'market.tick', data: 7 });
    expect(received).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(sharedWorkers).toHaveLength(2);

    // The failed port stays silent after recovery; only the new port delivers.
    sharedWorkers[0]!.port.emit({ type: 'MESSAGE', topic: 'market.tick', data: 8 });
    expect(received).toEqual([]);
    sharedWorkers[1]!.port.emit({ type: 'MESSAGE', topic: 'market.tick', data: 9 });
    expect(received).toEqual([9]);
    await bus.stop();
  });
});

describe('CentrifugeWorkerTransport heartbeatIntervalMs validation', () => {
  it.each([0, -1, NaN, Number.NaN])(
    'throws a TypeError for an invalid heartbeatIntervalMs of %p',
    invalidValue => {
      expect(() => new CentrifugeWorkerTransport({ heartbeatIntervalMs: invalidValue })).toThrow(
        TypeError
      );
    }
  );

  it('throws a TypeError for a non-number heartbeatIntervalMs', () => {
    expect(
      () => new CentrifugeWorkerTransport({ heartbeatIntervalMs: '10000' as unknown as number })
    ).toThrow(TypeError);
  });

  it('accepts a positive heartbeatIntervalMs', () => {
    expect(() => new CentrifugeWorkerTransport({ heartbeatIntervalMs: 5_000 })).not.toThrow();
  });

  it('accepts Infinity to disable heartbeats', () => {
    expect(() => new CentrifugeWorkerTransport({ heartbeatIntervalMs: Infinity })).not.toThrow();
  });

  it('falls back to the default when heartbeatIntervalMs is omitted', () => {
    expect(() => new CentrifugeWorkerTransport()).not.toThrow();
  });
});
