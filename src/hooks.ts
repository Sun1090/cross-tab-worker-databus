/**
 * React hooks adapter for cross-tab-worker-databus.
 *
 * A thin, transport-agnostic bridge between the imperative CrossTabDataBus
 * API and React component lifecycles. React is an optional peer dependency —
 * this module is a separate entry point so consumers who don't use React
 * never load it.
 *
 * - `useCrossTabDataBus` owns the bus lifecycle: created on mount, stopped on
 *   unmount. It is StrictMode-safe: the cleanup calls `instance.stop()`, so the
 *   double-invoked effect runs a full create → stop → create across *separate*
 *   instances. That is not the BFCache path and does not stand in for it —
 *   page-hide takes `onSuspend`, which keeps this same bus, its `topicHandlers`
 *   and its replay buffers, and is reversed by resume. So suspend/resume
 *   coverage has to come from a real hide/show, not from this hook.
 * - `useCrossTabSubscription` attaches a message handler with automatic
 *   cleanup; the handler is read through a ref, so you can pass inline
 *   closures without resubscribing on every render.
 * - `useCrossTabStatus` mirrors `bus.onStatus()` into React state.
 * - `useCrossTabHealth` polls `bus.getHealthSummary()` into React state,
 *   with event-driven refreshes on status changes and errors.
 */
import { useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import type { CrossTabDataBus, DataBusHealthSummary } from './core/data-bus';
import type { DataBusMessage, WorkerStatus } from './core/types';
import { WORKER_STATUS } from './utils/constants';

/**
 * Create a CrossTabDataBus for the component's lifetime.
 *
 * @param create Factory invoked once per effect run. Return a fresh bus —
 *   do not share a bus instance between effects, or StrictMode's
 *   mount → stop → mount cycle will stop the shared instance out from
 *   under the second mount.
 * @param deps Re-create the bus when these change (default: create once).
 * @returns The active bus, or `null` before the first effect has run (SSR
 *   and the initial render).
 */
export function useCrossTabDataBus<TConfig, TData>(
  create: () => CrossTabDataBus<TConfig, TData>,
  deps: DependencyList = []
): CrossTabDataBus<TConfig, TData> | null {
  const [bus, setBus] = useState<CrossTabDataBus<TConfig, TData> | null>(null);
  useEffect(() => {
    // No "is this effect still current?" check is needed: React runs an
    // effect's cleanup before its next invocation, and nothing between the
    // lines below yields, so `create()` cannot be interleaved with a newer
    // mount and this cleanup always stops the instance its own run created.
    const instance = create();
    setBus(instance);
    void instance.ready().catch(() => {});
    return () => {
      setBus(null);
      void instance.stop();
    };
    // The factory is intentionally not a dependency: callers pass an inline
    // closure and key recreation through `deps` instead.
  }, deps);
  return bus;
}

/**
 * Subscribe to `topic` for the component's lifetime. The handler is read
 * through a ref on each delivery, so inline closures are safe without
 * unsubscribing/resubscribing on re-renders.
 *
 * When `bus` is null (not yet created) the subscription is queued until the
 * bus appears — the bus itself queues it until the transport is ready.
 */
export function useCrossTabSubscription<TConfig, TData>(
  bus: CrossTabDataBus<TConfig, TData> | null,
  topic: string,
  handler: (message: DataBusMessage<TData>) => void
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!bus) return;
    return bus.subscribe(topic, message => handlerRef.current(message));
  }, [bus, topic]);
}

/**
 * Mirror the bus connection status into React state. Reports the live value
 * via `onStatus` and reads the current value synchronously whenever `bus`
 * changes identity.
 */
export function useCrossTabStatus<TConfig, TData>(
  bus: CrossTabDataBus<TConfig, TData> | null
): WorkerStatus {
  const [status, setStatus] = useState<WorkerStatus>(WORKER_STATUS.CONNECTING);
  useEffect(() => {
    if (!bus) {
      setStatus(WORKER_STATUS.CONNECTING);
      return;
    }
    setStatus(bus.getStatus());
    return bus.onStatus(setStatus);
  }, [bus]);
  return status;
}

/**
 * Mirror the bus health summary into React state.
 *
 * `getHealthSummary()` is a snapshot, not an event stream, so the hook polls
 * it on an interval (default 1000 ms) and refreshes immediately on status
 * changes and errors. Pass `intervalMs: 0` to rely on event-driven refreshes
 * only; changing the interval replaces the timer without recreating the bus.
 * Returns `null` while the bus has not been created yet.
 */
export function useCrossTabHealth<TConfig, TData>(
  bus: CrossTabDataBus<TConfig, TData> | null,
  options?: { intervalMs?: number }
): DataBusHealthSummary | null {
  const [health, setHealth] = useState<DataBusHealthSummary | null>(null);
  const intervalMs = options?.intervalMs ?? 1_000;
  useEffect(() => {
    if (!bus) {
      setHealth(null);
      return;
    }
    const refresh = () => setHealth(bus.getHealthSummary());
    refresh();
    const unsubscribeStatus = bus.onStatus(refresh);
    const unsubscribeError = bus.onError(refresh);
    const timer = intervalMs > 0 ? setInterval(refresh, intervalMs) : null;
    return () => {
      unsubscribeStatus();
      unsubscribeError();
      if (timer) clearInterval(timer);
    };
    // Depend on the normalized cadence rather than the options object so inline
    // option literals do not restart the effect on every render, while a real
    // intervalMs change still replaces the polling timer.
  }, [bus, intervalMs]);
  return health;
}
