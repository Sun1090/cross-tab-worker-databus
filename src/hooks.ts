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
 */
import { useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import type { CrossTabDataBus } from './core/data-bus';
import type { DataBusMessage, WorkerStatus } from './core/types';

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
  const [status, setStatus] = useState<WorkerStatus>('connecting');
  useEffect(() => {
    if (!bus) {
      setStatus('connecting');
      return;
    }
    setStatus(bus.getStatus());
    return bus.onStatus(setStatus);
  }, [bus]);
  return status;
}
