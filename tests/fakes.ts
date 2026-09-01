import type {
  ClusterChannel,
  ClusterEnvironment,
  StorageLike
} from '../src/core/environment';
import type {
  DataBusTransport,
  DataBusTransportHandlers,
  WorkerClusterMessage
} from '../src/core/types';

export class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  entries(): Array<[string, string]> {
    return [...this.values.entries()];
  }
}

export class ChannelHub {
  private readonly channels = new Map<string, Set<FakeChannel>>();
  private shouldDropNextControl = false;
  private shouldFailNextPost = false;

  dropNextControl(): void {
    this.shouldDropNextControl = true;
  }

  failNextPost(): void {
    this.shouldFailNextPost = true;
  }

  create(name: string): ClusterChannel {
    const channel = new FakeChannel(name, this);
    const members = this.channels.get(name) ?? new Set<FakeChannel>();
    members.add(channel);
    this.channels.set(name, members);
    return channel;
  }

  send(source: FakeChannel, message: WorkerClusterMessage): void {
    if (this.shouldFailNextPost) {
      this.shouldFailNextPost = false;
      throw new Error('DataCloneError: value could not be cloned.');
    }
    if (this.shouldDropNextControl && message.type === 'CONTROL') {
      this.shouldDropNextControl = false;
      return;
    }
    for (const target of this.channels.get(source.name) ?? []) {
      if (target !== source) target.deliver(message);
    }
  }

  close(channel: FakeChannel): void {
    this.channels.get(channel.name)?.delete(channel);
  }
}

class FakeChannel implements ClusterChannel {
  readonly name: string;
  private readonly hub: ChannelHub;
  private readonly listeners = new Set<(event: MessageEvent<WorkerClusterMessage>) => void>();

  constructor(name: string, hub: ChannelHub) {
    this.name = name;
    this.hub = hub;
  }

  addEventListener(
    _type: 'message',
    listener: (event: MessageEvent<WorkerClusterMessage>) => void
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: 'message',
    listener: (event: MessageEvent<WorkerClusterMessage>) => void
  ): void {
    this.listeners.delete(listener);
  }

  postMessage(message: WorkerClusterMessage): void {
    this.hub.send(this, message);
  }

  close(): void {
    this.hub.close(this);
    this.listeners.clear();
  }

  deliver(message: WorkerClusterMessage): void {
    const event = { data: message } as MessageEvent<WorkerClusterMessage>;
    for (const listener of this.listeners) listener(event);
  }
}

export interface FakeEnvironmentControl {
  environment: ClusterEnvironment;
  runIntervals: () => void;
  pageHide: () => void;
  pageShow: () => void;
  setVisibility: (state: 'visible' | 'hidden') => void;
}

export function createFakeEnvironment(options: {
  storage: MemoryStorage;
  hub?: ChannelHub;
  now: () => number;
  randomId: string;
  visibilityState?: 'visible' | 'hidden';
}): FakeEnvironmentControl {
  const intervals = new Set<() => void>();
  const pageHideListeners = new Set<() => void>();
  const pageShowListeners = new Set<() => void>();
  const visibilityListeners = new Set<() => void>();
  let visibilityState = options.visibilityState ?? 'visible';
  return {
    environment: {
      storage: options.storage,
      sessionStorage: new MemoryStorage(),
      now: options.now,
      randomId: () => options.randomId,
      createChannel: name => options.hub?.create(name) ?? null,
      setInterval: callback => {
        intervals.add(callback);
        return callback;
      },
      clearInterval: handle => intervals.delete(handle as () => void),
      getVisibilityState: () => visibilityState,
      addVisibilityChangeListener: listener => visibilityListeners.add(listener),
      removeVisibilityChangeListener: listener => visibilityListeners.delete(listener),
      addPageHideListener: listener => pageHideListeners.add(listener),
      removePageHideListener: listener => pageHideListeners.delete(listener),
      addPageShowListener: listener => pageShowListeners.add(listener),
      removePageShowListener: listener => pageShowListeners.delete(listener)
    },
    runIntervals: () => {
      for (const callback of [...intervals]) callback();
    },
    pageHide: () => {
      for (const listener of [...pageHideListeners]) listener();
    },
    pageShow: () => {
      for (const listener of [...pageShowListeners]) listener();
    },
    setVisibility: state => {
      visibilityState = state;
      for (const listener of [...visibilityListeners]) listener();
    }
  };
}

export class FakeTransport<TData = unknown> implements DataBusTransport<object, TData> {
  readonly subscribed = new Set<string>();
  readonly subscribeCalls: string[] = [];
  readonly unsubscribeCalls: string[] = [];
  readonly publishCalls: Array<{ topic: string; data: unknown; options?: { messageId?: string; timestamp?: number } }> = [];
  startCalls = 0;
  stopCalls = 0;
  /** When true, start() calls onStatus('error') instead of 'connected'. */
  startShouldFail = false;
  /** When set, stop() waits for this promise before completing. */
  stopGate?: Promise<void>;
  private handlers: DataBusTransportHandlers<TData> | null = null;

  constructor(private readonly startGate?: Promise<void>) {}

  start(_config: object, handlers: DataBusTransportHandlers<TData>): void | Promise<void> {
    this.startCalls += 1;
    this.handlers = handlers;
    if (this.startShouldFail) {
      handlers.onStatus('error');
      return;
    }
    if (!this.startGate) {
      handlers.onStatus('connected');
      return;
    }
    return this.startGate.then(() => {
      if (this.startShouldFail) {
        handlers.onStatus('error');
        return;
      }
      handlers.onStatus('connected');
    });
  }

  subscribe(topic: string): void {
    this.subscribeCalls.push(topic);
    this.subscribed.add(topic);
  }

  unsubscribe(topic: string): void {
    this.unsubscribeCalls.push(topic);
    this.subscribed.delete(topic);
  }

  publish(topic: string, data: unknown, options?: { messageId?: string; timestamp?: number }): void {
    this.publishCalls.push({ topic, data, ...(options ? { options } : {}) });
  }

  stop(): void | Promise<void> {
    this.stopCalls += 1;
    this.handlers = null;
    this.subscribed.clear();
    if (this.stopGate) return this.stopGate;
  }

  emit(topic: string, data: TData, messageId?: string, timestamp?: number): void {
    this.handlers?.onMessage({
      topic,
      data,
      ...(messageId ? { messageId } : {}),
      ...(timestamp === undefined ? {} : { timestamp })
    });
  }

  setStatus(status: 'connecting' | 'connected' | 'disconnected' | 'error'): void {
    this.handlers?.onStatus(status);
  }
}
