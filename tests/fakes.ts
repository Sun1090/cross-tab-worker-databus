import { performance as nodePerformance } from 'node:perf_hooks';
import { expect } from 'vitest';
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
import { CLUSTER_MESSAGE_TYPE, TAB_VISIBILITY, WORKER_STATUS } from '../src/utils/constants';
import type { EVENT_TYPE } from '../src/utils/constants';

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
  private budget: number | null = null;
  private posted = 0;
  private budgetExceeded = false;
  private asyncDelivery = false;

  /** A real `BroadcastChannel` delivers in a *later task*, so a runtime that posts
   * a frame and then reads coordination state in the same stack never sees the
   * effect of its own post. The hub's default is synchronous because a large number
   * of tests post a frame and assert without awaiting; this opts one hub into the
   * browser's ordering. */
  setAsyncDelivery(enabled: boolean): void {
    this.asyncDelivery = enabled;
  }

  /** Cap how many messages the hub will deliver, dropping the rest. A
   * coordination loop that never converges otherwise costs unbounded CPU in the
   * test that hosts it — the hub is the only place both sides of the loop are
   * visible, so it is the only place the loop can be broken. */
  setDeliveryBudget(limit: number): void {
    this.budget = limit;
    this.posted = 0;
    this.budgetExceeded = false;
  }

  deliveriesOverBudget(): boolean {
    return this.budgetExceeded;
  }

  deliveryCount(): number {
    return this.posted;
  }

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
    this.posted += 1;
    if (this.budget !== null && this.posted > this.budget) {
      this.budgetExceeded = true;
      return;
    }
    if (this.shouldFailNextPost) {
      this.shouldFailNextPost = false;
      throw new Error('DataCloneError: value could not be cloned.');
    }
    if (this.shouldDropNextControl && message.type === CLUSTER_MESSAGE_TYPE.CONTROL) {
      this.shouldDropNextControl = false;
      return;
    }
    if (!this.asyncDelivery) {
      for (const target of this.channels.get(source.name) ?? []) {
        if (target !== source) target.deliver(message);
      }
      return;
    }
    // The member set is read inside the microtask, not when the frame was posted, so
    // a peer that closed in between receives nothing — which is also the browser's
    // rule, and what lets `forgeSubscribe()` in the coordination sweep close its
    // channel immediately without cancelling the frame it just sent.
    queueMicrotask(() => {
      for (const target of this.channels.get(source.name) ?? []) {
        if (target !== source) target.deliver(message);
      }
    });
  }

  close(channel: FakeChannel): void {
    this.channels.get(channel.name)?.delete(channel);
  }

  /** How many channels are still open under `name`. A closed channel leaves the
   * hub, so this is how a test tells a deferred close from a skipped one. */
  liveChannelCount(name: string): number {
    return this.channels.get(name)?.size ?? 0;
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
    _type: typeof EVENT_TYPE.MESSAGE,
    listener: (event: MessageEvent<WorkerClusterMessage>) => void
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: typeof EVENT_TYPE.MESSAGE,
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
  setVisibility: (state: (typeof TAB_VISIBILITY)[keyof typeof TAB_VISIBILITY]) => void;
}

export function createFakeEnvironment(options: {
  storage: MemoryStorage;
  hub?: ChannelHub;
  now: () => number;
  randomId: string;
  visibilityState?: (typeof TAB_VISIBILITY)[keyof typeof TAB_VISIBILITY];
}): FakeEnvironmentControl {
  const intervals = new Set<() => void>();
  const pageHideListeners = new Set<() => void>();
  const pageShowListeners = new Set<() => void>();
  const visibilityListeners = new Set<() => void>();
  let visibilityState = options.visibilityState ?? TAB_VISIBILITY.VISIBLE;
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
  /** `subscribeCalls` and `unsubscribeCalls` cannot express ordering, and the
   * deferred-flush contracts are about ordering: one entry per channel call, in
   * the sequence the transport received them. */
  readonly channelCalls: string[] = [];
  readonly publishCalls: Array<{ topic: string; data: unknown; options?: { messageId?: string; timestamp?: number } }> = [];
  readonly publishBatchCalls: Array<{
    topic: string;
    items: ReadonlyArray<{ data: unknown; messageId?: string; timestamp?: number }>;
  }> = [];
  startCalls = 0;
  stopCalls = 0;
  /** When true, start() calls onStatus('error') instead of 'connected'. */
  startShouldFail = false;
  /** When set, stop() waits for this promise before completing. */
  stopGate?: Promise<void>;
  /** When true, stop() returns a rejected promise instead of completing. */
  stopShouldFail = false;
  /** Rejection reason used by `stopShouldFail`, defaulting to a real Error.
   * A transport is free to reject with any value, and the ones that matter here
   * have no primitive conversion at all (`Object.create(null)`), so a test that
   * wants to pin how the bus *records* such a failure needs to set the reason,
   * not just the fact of failure. */
  stopRejection: unknown = new Error('transport stop failed');
  /** Only assigned when the transport is constructed with batch support, so
   * consumers see the same `typeof transport.publishBatch === 'function'`
   * distinction real batch-capable transports present. */
  publishBatch?: (topic: string, items: ReadonlyArray<{ data: unknown; messageId?: string; timestamp?: number }>) => void;
  private handlers: DataBusTransportHandlers<TData> | null = null;

  constructor(private readonly startGate?: Promise<void>, options?: { supportsPublishBatch?: boolean }) {
    if (options?.supportsPublishBatch) {
      this.publishBatch = (topic, items) => {
        this.publishBatchCalls.push({ topic, items });
      };
    }
  }

  start(_config: object, handlers: DataBusTransportHandlers<TData>): void | Promise<void> {
    this.startCalls += 1;
    this.handlers = handlers;
    if (this.startShouldFail) {
      handlers.onStatus(WORKER_STATUS.ERROR);
      return;
    }
    if (!this.startGate) {
      handlers.onStatus(WORKER_STATUS.CONNECTED);
      return;
    }
    return this.startGate.then(() => {
      if (this.startShouldFail) {
        handlers.onStatus(WORKER_STATUS.ERROR);
        return;
      }
      handlers.onStatus(WORKER_STATUS.CONNECTED);
    });
  }

  subscribe(topic: string): void {
    this.subscribeCalls.push(topic);
    this.channelCalls.push(`sub:${topic}`);
    this.subscribed.add(topic);
  }

  unsubscribe(topic: string): void {
    this.unsubscribeCalls.push(topic);
    this.channelCalls.push(`uns:${topic}`);
    this.subscribed.delete(topic);
  }

  publish(topic: string, data: unknown, options?: { messageId?: string; timestamp?: number }): void {
    this.publishCalls.push({ topic, data, ...(options ? { options } : {}) });
  }

  stop(): void | Promise<void> {
    this.stopCalls += 1;
    this.handlers = null;
    this.subscribed.clear();
    if (this.stopShouldFail) return Promise.reject(this.stopRejection);
    if (this.stopGate) return this.stopGate;
  }

  /** Deliver an incoming frame. `originTabId` is passed only when the test wants
   * a transport that reports a producer, which is what a proxying or replaying
   * custom transport does — the core must keep that stamp instead of overwriting
   * it with the receiving tab's own id. */
  emit(topic: string, data: TData, messageId?: string, timestamp?: number, originTabId?: string): void {
    this.handlers?.onMessage({
      topic,
      data,
      ...(messageId ? { messageId } : {}),
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(originTabId === undefined ? {} : { originTabId })
    });
  }

  setStatus(status: (typeof WORKER_STATUS)[keyof typeof WORKER_STATUS]): void {
    this.handlers?.onStatus(status);
  }

  /** Report an asynchronous runtime failure (as opposed to start() failing). */
  emitError(error: unknown): void {
    this.handlers?.onError(error);
  }
}

/** Real elapsed milliseconds, immune to `vi.useFakeTimers()`.
 *
 * Two sources, taking the larger, because neither is immune everywhere and the
 * failure mode that matters is a clock that *stops*:
 *
 * - `node:perf_hooks`' `performance`. Measured on the pinned Vitest 5 inside a
 *   window advanced 60 simulated seconds it returned real time (216) while the
 *   global `performance.now()` returned 60000 and `process.hrtime.bigint()` moved
 *   by 60000. But that immunity is an artifact of the global and the `perf_hooks`
 *   export being *different objects* in this context — in a worker thread Node
 *   makes them the same one, so a `toFake` list that includes `performance`
 *   patches both, and a budget clock that then freezes reads 0 elapsed however
 *   slow the host is. Observed in that shape: a sweep ran 485s against its own 60s
 *   fuse, twice on CI, while every local run finished in ~9s.
 * - `process.uptime()`, which is in no fake-timer toolbox's list of things to
 *   replace — it measured a real 260ms across a 250ms `Atomics.wait` inside a
 *   fake window where `Date`, global `performance` and `hrtime` all read 0.
 *
 * Max means neither source being frozen, advanced or stubbed can stall a budget;
 * both track real time otherwise, so ordinary differences are unaffected. Do not
 * "simplify" this to one source — whichever single source is picked is the one
 * some runner configuration will freeze, and a fuse that cannot fire is worse than
 * no fuse, because the sweep then reads as a hang instead of as bounded depth. */
export function realNowMs(): number {
  return Math.max(nodePerformance.now(), process.uptime() * 1000);
}

/** Block the thread for `ms` of genuinely real time, to prove a budget clock is
 * counting while fake timers are installed.
 *
 * Do not write this as a `while (Date.now() < stop)` busy loop: `Date` is itself
 * frozen inside a fake window, so the loop never terminates — an early version of
 * the clock pin did exactly that and hung the run. `Atomics.wait` is not a timer,
 * so nothing in `vi.useFakeTimers()`' reach can make it return early. */
export function blockRealTimeMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Deterministic PRNG (mulberry32). Seeded fuzzers here must stay
 * reproducible, so a failure is always replayable from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Let every already-scheduled microtask continuation run. */
export async function flushMicrotasks(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/** Assert a promise rejects with an `Error` whose message contains `message`.
 *
 * `await expect(promise).rejects.toThrow('text')` is not enough on its own: it
 * also passes when the rejection reason is `null` or `undefined`, which is
 * exactly the failure the `reason ?? new Error(...)` fallbacks in this codebase
 * exist to prevent. Use this where the *message* is the behaviour under test. */
export async function expectRejectionMessage(promise: Promise<unknown>, message: string): Promise<void> {
  const reason = await promise.then(
    value => {
      throw new Error(`expected a rejection, but it resolved with ${String(value)}`);
    },
    error => error as unknown
  );
  expect(reason, `rejection reason must be an Error, got ${String(reason)}`).toBeInstanceOf(Error);
  expect((reason as Error).message).toContain(message);
}
