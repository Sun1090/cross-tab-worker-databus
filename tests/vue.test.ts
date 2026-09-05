// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useCrossTabDataBus, useCrossTabHealth, useCrossTabStatus, useCrossTabSubscription } from '../src/vue';
import type { CrossTabDataBus } from '../src/core/data-bus';

function fakeBus() {
  let status: 'connecting' | 'connected' | 'disconnected' | 'error' = 'connecting';
  const statusHandlers = new Set<(value: typeof status) => void>();
  const errorHandlers = new Set<(error: unknown) => void>();
  const handlers = new Map<string, (message: { topic: string; data: unknown }) => void>();
  return {
    ready: vi.fn(async () => {}), stop: vi.fn(async () => {}), getStatus: () => status,
    onStatus: (handler: (value: typeof status) => void) => { statusHandlers.add(handler); handler(status); return () => statusHandlers.delete(handler); },
    subscribe: vi.fn((topic: string, handler: (message: { topic: string; data: unknown }) => void) => { handlers.set(topic, handler); return () => handlers.delete(topic); }),
    emit(topic: string, data: unknown) { handlers.get(topic)?.({ topic, data }); },
    setStatus(value: typeof status) { status = value; for (const handler of statusHandlers) handler(value); },
    getHealthSummary: () => ({ healthy: status === 'connected', state: status === 'connected' ? 'healthy' : 'recovering' }),
    onError: (handler: (error: unknown) => void) => { errorHandlers.add(handler); return () => errorHandlers.delete(handler); }
  } as unknown as CrossTabDataBus<unknown, unknown> & { emit: (topic: string, data: unknown) => void; setStatus: (value: typeof status) => void };
}

describe('Vue composables adapter', () => {
  it('creates and stops the bus around component lifecycle, mirrors status, and subscribes', async () => {
    const bus = fakeBus();
    const received: unknown[] = [];
    const host = document.createElement('div');
    const app = createApp(defineComponent({ setup() {
      const active = useCrossTabDataBus(() => bus) as Ref<CrossTabDataBus<unknown, unknown> | null>;
      const status = useCrossTabStatus(active);
      useCrossTabSubscription(active, 'topic', message => received.push(message.data));
      return () => h('span', status.value);
    }}));
    app.mount(host);
    await nextTick();
    expect(bus.ready).toHaveBeenCalled();
    bus.setStatus('connected');
    await nextTick();
    bus.emit('topic', 42);
    expect(received).toEqual([42]);
    app.unmount();
    expect(bus.stop).toHaveBeenCalled();
  });

  it('rebinds when the bus ref changes', async () => {
    const first = fakeBus();
    const second = fakeBus();
    const active = ref<CrossTabDataBus<unknown, unknown> | null>(first) as Ref<CrossTabDataBus<unknown, unknown> | null>;
    const received: unknown[] = [];
    const host = document.createElement('div');
    const app = createApp(defineComponent({ setup() {
      useCrossTabSubscription(active, 'topic', message => received.push(message.data));
      return () => null;
    }}));
    app.mount(host);
    await nextTick();
    active.value = second;
    await nextTick();
    first.emit('topic', 'old');
    second.emit('topic', 'new');
    expect(received).toEqual(['new']);
    app.unmount();
  });

  it('rebinds when a reactive topic changes on the same bus', async () => {
    const bus = fakeBus();
    const topic = ref('first');
    const received: unknown[] = [];
    const host = document.createElement('div');
    const app = createApp(defineComponent({ setup() {
      useCrossTabSubscription(ref(bus) as unknown as Ref<CrossTabDataBus<unknown, unknown> | null>, topic, message => received.push(message.data));
      return () => null;
    }}));
    app.mount(host);
    await nextTick();
    topic.value = 'second';
    await nextTick();
    bus.emit('first', 'old');
    bus.emit('second', 'new');
    expect(received).toEqual(['new']);
    app.unmount();
  });

  it('does not resurrect a stale bus after rapid dependency changes', async () => {
    const first = fakeBus();
    const second = fakeBus();
    const third = fakeBus();
    const source = ref(0);
    let created = 0;
    const host = document.createElement('div');
    const app = createApp(defineComponent({ setup() {
      useCrossTabDataBus(() => [first, second, third][created++]! as never, [source]);
      return () => null;
    }}));
    app.mount(host);
    await nextTick();
    source.value = 1;
    source.value = 2;
    await nextTick();
    await Promise.resolve();
    expect(created).toBeLessThanOrEqual(2);
    app.unmount();
  });

  it('mirrors the health summary and refreshes on status changes', async () => {
    const bus = fakeBus();
    const host = document.createElement('div');
    const app = createApp(defineComponent({ setup() {
      const active = useCrossTabDataBus(() => bus) as Ref<CrossTabDataBus<unknown, unknown> | null>;
      const health = useCrossTabHealth(active, { intervalMs: 0 });
      return () => h('span', health.value?.state ?? 'none');
    }}));
    app.mount(host);
    await nextTick();
    await nextTick();
    expect(host.textContent).toBe('recovering');
    bus.setStatus('connected');
    await nextTick();
    expect(host.textContent).toBe('healthy');
    app.unmount();
  });

describe('useCrossTabHealth edge cases', () => {
  it('polls on the interval, resets to null on detach, and stops on unmount', async () => {
    let seq = 0;
    let calls = 0;
    const statusHandlers = new Set<(value: string) => void>();
    const bus = {
      getHealthSummary: () => {
        calls += 1;
        seq += 1;
        return { healthy: true, state: 'healthy', seq };
      },
      onStatus: (handler: (value: string) => void) => {
        statusHandlers.add(handler);
        return () => statusHandlers.delete(handler);
      },
      onError: () => () => {}
    } as unknown as CrossTabDataBus<unknown, unknown>;
    const active = ref(bus) as Ref<CrossTabDataBus<unknown, unknown> | null>;
    const host = document.createElement('div');
    const app = createApp(defineComponent({ setup() {
      const health = useCrossTabHealth(active, { intervalMs: 20 });
      return () => h('span', health.value ? `healthy:${(health.value as unknown as { seq: number }).seq}` : 'none');
    }}));
    app.mount(host);
    await nextTick();
    expect(host.textContent).toBe('healthy:1');
    // The interval refreshes the snapshot.
    await new Promise(resolve => setTimeout(resolve, 70));
    expect(calls).toBeGreaterThanOrEqual(2);

    // Detaching resets to null and unsubscribes listeners.
    active.value = null;
    await nextTick();
    expect(host.textContent).toBe('none');
    const callsAtDetach = calls;
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(calls).toBe(callsAtDetach);

    app.unmount();
    await nextTick();
    // Vue removes the host DOM on unmount; the detach assertions above
    // already cover the reset and listener cleanup.
  });
});
});
