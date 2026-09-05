/**
 * React hooks adapter for cross-tab-worker-databus.
 *
 * A thin, transport-agnostic bridge between the imperative CrossTabDataBus
 * API and React component lifecycles. React is an optional peer dependency —
 * this module is a separate entry point so consumers who don't use React
 * never load it.
 *
 * - `useCrossTabDataBus` owns the bus lifecycle: created on mount, stopped on
 *   unmount. It is StrictMode-safe: the double-invoked effect exercises the
 *   same stop/recreate path as BFCache suspend/resume.
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
  const lifecycleGeneration = useRef(0);
  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    const instance = create();
    if (generation !== lifecycleGeneration.current) return;
    setBus(instance);
    void instance.ready().catch(() => {});
    return () => {
      if (generation === lifecycleGeneration.current) setBus(null);
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
 * only. Returns `null` while the bus has not been created yet.
 */
export function useCrossTabHealth<TConfig, TData>(
  bus: CrossTabDataBus<TConfig, TData> | null,
  options?: { intervalMs?: number }
): DataBusHealthSummary | null {
  const [health, setHealth] = useState<DataBusHealthSummary | null>(null);
  useEffect(() => {
    if (!bus) {
      setHealth(null);
      return;
    }
    const refresh = () => setHealth(bus.getHealthSummary());
    refresh();
    const unsubscribeStatus = bus.onStatus(refresh);
    const unsubscribeError = bus.onError(refresh);
    const intervalMs = options?.intervalMs ?? 1_000;
    const timer = intervalMs > 0 ? setInterval(refresh, intervalMs) : null;
    return () => {
      unsubscribeStatus();
      unsubscribeError();
      if (timer) clearInterval(timer);
    };
    // The options object is intentionally not a dependency: callers pass an
    // inline literal and the interval only affects polling cadence.
  }, [bus]);
  return health;
}
