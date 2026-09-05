/** Vue 3 composables adapter for cross-tab-worker-databus.
 * Vue is an optional peer dependency; this module is a separate entry point.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import type { CrossTabDataBus, DataBusHealthSummary } from './core/data-bus';
import type { DataBusMessage, WorkerStatus } from './core/types';

export function useCrossTabDataBus<TConfig, TData>(
  create: () => CrossTabDataBus<TConfig, TData>,
  deps: ReadonlyArray<Ref<unknown> | (() => unknown)> = []
): Ref<CrossTabDataBus<TConfig, TData> | null> {
  const bus = shallowRef<CrossTabDataBus<TConfig, TData> | null>(null);
  let instance: CrossTabDataBus<TConfig, TData> | null = null;
  let lifecycleGeneration = 0;
  const stop = async () => { const current = instance; instance = null; bus.value = null; if (current) await current.stop(); };
  const start = () => {
    const generation = ++lifecycleGeneration;
    void stop().then(() => {
      if (generation !== lifecycleGeneration) return;
      const next = create();
      instance = next;
      bus.value = next;
      void next.ready().catch(() => {});
    });
  };
  onMounted(start);
  onBeforeUnmount(() => { void stop(); });
  if (deps.length > 0) watch(deps, start);
  return bus as Ref<CrossTabDataBus<TConfig, TData> | null>;
}

export function useCrossTabSubscription<TConfig, TData>(
  bus: Ref<CrossTabDataBus<TConfig, TData> | null>, topic: Ref<string> | string,
  handler: (message: DataBusMessage<TData>) => void
): void {
  let currentBus: CrossTabDataBus<TConfig, TData> | null = null;
  let currentTopic: string | null = null;
  let cleanup: (() => void) | undefined;
  let latestHandler = handler;
  const stop = () => { cleanup?.(); cleanup = undefined; currentBus = null; currentTopic = null; };
  const sync = () => {
    const nextBus = bus.value;
    const nextTopic = typeof topic === 'string' ? topic : topic.value;
    if (nextBus === currentBus && currentTopic === nextTopic && cleanup) return;
    stop();
    if (!nextBus) return;
    currentBus = nextBus;
    currentTopic = nextTopic;
    cleanup = nextBus.subscribe(nextTopic, message => latestHandler(message));
  };
  watch(bus, sync, { immediate: true });
  if (typeof topic !== 'string') watch(topic, sync);
  watch(() => handler, value => { latestHandler = value; });
  onBeforeUnmount(stop);
}

export function useCrossTabStatus<TConfig, TData>(
  bus: Ref<CrossTabDataBus<TConfig, TData> | null>
): Ref<WorkerStatus> {
  const status = ref<WorkerStatus>('connecting');
  let cleanup: (() => void) | undefined;
  watch(bus, next => {
    cleanup?.(); cleanup = undefined;
    status.value = next?.getStatus() ?? 'connecting';
    if (next) cleanup = next.onStatus(value => { status.value = value; });
  }, { immediate: true });
  onBeforeUnmount(() => cleanup?.());
  return status;
}

/** Options for {@link useCrossTabHealth}. */
export interface UseCrossTabHealthOptions {
  /** Polling cadence in ms for the health snapshot. Default 1000; `0` disables
   * polling and relies on status/error events only. */
  intervalMs?: number;
}

/**
 * Mirror the bus health summary into a Vue ref. `getHealthSummary()` is a
 * snapshot, so the composable polls it on an interval (default 1000 ms) and
 * refreshes on status changes and errors. Returns `null` until the bus exists.
 */
export function useCrossTabHealth<TConfig, TData>(
  bus: Ref<CrossTabDataBus<TConfig, TData> | null>,
  options?: UseCrossTabHealthOptions
): Ref<DataBusHealthSummary | null> {
  const health = ref<DataBusHealthSummary | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let cleanups: Array<() => void> = [];
  const teardown = () => {
    if (timer) clearInterval(timer);
    timer = null;
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
  };
  watch(bus, next => {
    teardown();
    if (!next) {
      health.value = null;
      return;
    }
    const refresh = () => { health.value = next.getHealthSummary(); };
    refresh();
    cleanups.push(next.onStatus(refresh));
    cleanups.push(next.onError(refresh));
    const intervalMs = options?.intervalMs ?? 1_000;
    if (intervalMs > 0) timer = setInterval(refresh, intervalMs);
  }, { immediate: true });
  onBeforeUnmount(teardown);
  return health as Ref<DataBusHealthSummary | null>;
}
