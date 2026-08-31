// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useCrossTabDataBus, useCrossTabStatus, useCrossTabSubscription } from '../src/vue';
import type { CrossTabDataBus } from '../src/core/data-bus';

function fakeBus() {
  let status: 'connecting' | 'connected' | 'disconnected' | 'error' = 'connecting';
  const statusHandlers = new Set<(value: typeof status) => void>();
  const handlers = new Map<string, (message: { topic: string; data: unknown }) => void>();
  return {
    ready: vi.fn(async () => {}), stop: vi.fn(async () => {}), getStatus: () => status,
    onStatus: (handler: (value: typeof status) => void) => { statusHandlers.add(handler); handler(status); return () => statusHandlers.delete(handler); },
    subscribe: vi.fn((topic: string, handler: (message: { topic: string; data: unknown }) => void) => { handlers.set(topic, handler); return () => handlers.delete(topic); }),
    emit(topic: string, data: unknown) { handlers.get(topic)?.({ topic, data }); },
    setStatus(value: typeof status) { status = value; for (const handler of statusHandlers) handler(value); }
  } as unknown as CrossTabDataBus<unknown, unknown> & { emit: (topic: string, data: unknown) => void; setStatus: (value: typeof status) => void };
}

describe('Vue composables adapter', () => {
  it('creates and stops the bus around component lifecycle, mirrors status, and subscribes', async () => {
    const bus = fakeBus();
    const received: unknown[] = [];
    const host = document.createElement('div');
    const app = createApp(defineComponent({ setup() {
      const active = useCrossTabDataBus(() => bus);
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
    const active = ref<CrossTabDataBus<unknown, unknown> | null>(first);
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
});

