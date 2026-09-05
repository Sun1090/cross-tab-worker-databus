// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSocketDataBus } from '../src/websocket';
import type { WebSocketLike } from '../src/websocket';
import {
  useCrossTabDataBus,
  useCrossTabHealth,
  useCrossTabStatus,
  useCrossTabSubscription
} from '../src/hooks';

class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  serverFrame(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }
}

afterEach(() => cleanup());

interface Harness {
  sockets: FakeWebSocket[];
  received: Array<{ topic: string; data: unknown }>;
  statusText: () => string;
  unmount: () => void;
  rerender: () => void;
}

/** Render a demo component wiring the three hooks to a fake socket. */
function setupHarness(strict = false): Harness {
  const sockets: FakeWebSocket[] = [];
  const received: Array<{ topic: string; data: unknown }> = [];

  function Demo() {
    const bus = useCrossTabDataBus(() =>
      createWebSocketDataBus({
        connection: {
          url: 'wss://example.test/ws',
          webSocketFactory: () => {
            const socket = new FakeWebSocket();
            sockets.push(socket);
            return socket;
          }
        }
      })
    );
    const status = useCrossTabStatus(bus);
    useCrossTabSubscription(bus, 'demo.topic', message => received.push(message));
    return <span data-testid="status">{status}</span>;
  }

  const tree = strict ? <StrictMode><Demo /></StrictMode> : <Demo />;
  const view = render(tree);
  return {
    sockets,
    received,
    statusText: () => view.getByTestId('status').textContent ?? '',
    unmount: () => view.unmount(),
    rerender: () => view.rerender(tree)
  };
}

describe('React hooks adapter', () => {
  it('creates the bus, delivers messages, mirrors status, and stops on unmount', async () => {
    const harness = setupHarness();
    // The bus starts asynchronously — wait for the transport to be created.
    await waitFor(() => expect(harness.sockets.length).toBe(1));
    const socket = harness.sockets[0]!;

    socket.open();
    await waitFor(() => expect(harness.statusText()).toBe('connected'));
    await waitFor(() =>
      expect(socket.sent).toContain(JSON.stringify({ op: 'subscribe', topic: 'demo.topic' }))
    );

    socket.serverFrame({ topic: 'demo.topic', data: { n: 1 } });
    await waitFor(() => expect(harness.received[0]).toMatchObject({ topic: 'demo.topic', data: { n: 1 } }));

    harness.unmount();
    // stop() is async: it serialises behind the in-flight start.
    await waitFor(() => expect(socket.readyState).toBe(3));
  });

  it('survives StrictMode double-mounting (stop/recreate cycle)', async () => {
    const harness = setupHarness(true);
    // StrictMode: mount → cleanup → mount again. The first bus is stopped
    // before its async start lands, so it never opens a socket; exactly one
    // socket exists and it belongs to the surviving bus.
    await waitFor(() => expect(harness.sockets.length).toBe(1));
    harness.sockets[0]!.open();
    await waitFor(() => expect(harness.statusText()).toBe('connected'));

    // The surviving bus still works end to end.
    harness.sockets[0]!.serverFrame({ topic: 'demo.topic', data: { strict: true } });
    await waitFor(() => expect(harness.received[0]).toMatchObject({ topic: 'demo.topic', data: { strict: true } }));

    harness.unmount();
    await waitFor(() => expect(harness.sockets[0]!.readyState).toBe(3));
  });

  it('keeps the latest handler via ref so inline closures do not resubscribe', async () => {
    const sockets: FakeWebSocket[] = [];
    const received: string[] = [];
    let outer = 'v1';

    function Demo() {
      const bus = useCrossTabDataBus(() =>
        createWebSocketDataBus({
          connection: {
            url: 'wss://example.test/ws',
            webSocketFactory: () => {
              const socket = new FakeWebSocket();
              sockets.push(socket);
              return socket;
            }
          }
        })
      );
      useCrossTabSubscription(bus, 't', () => received.push(outer));
      return null;
    }

    const view = render(<Demo />);
    await waitFor(() => expect(sockets.length).toBe(1));
    const socket = sockets[0]!;
    socket.open();
    await waitFor(() =>
      expect(socket.sent).toContain(JSON.stringify({ op: 'subscribe', topic: 't' }))
    );

    // Rerender with a new inline closure — no additional subscribe frame.
    outer = 'v2';
    act(() => view.rerender(<Demo />));
    const subscribeFrames = socket.sent.filter(frame => frame.includes('"subscribe"'));
    socket.serverFrame({ topic: 't', data: 1 });
    await waitFor(() => expect(received).toEqual(['v2']));
    expect(socket.sent.filter(frame => frame.includes('"subscribe"'))).toEqual(subscribeFrames);
  });

  it('does not let a superseded effect clear the newest bus during rapid dependency changes', async () => {
    const buses = [
      { ready: vi.fn(async () => {}), stop: vi.fn(async () => {}), getStatus: () => 'connecting', onStatus: () => () => {} },
      { ready: vi.fn(async () => {}), stop: vi.fn(async () => {}), getStatus: () => 'connecting', onStatus: () => () => {} }
    ] as unknown as Array<ReturnType<typeof createWebSocketDataBus>>;
    let index = 0;
    let tick = 0;
    function Demo() {
      useCrossTabDataBus(() => buses[index++]!, [tick]);
      return null;
    }
    const view = render(<Demo />);
    await waitFor(() => expect(index).toBe(1));
    tick = 1;
    act(() => view.rerender(<Demo />));
    await waitFor(() => expect(index).toBe(2));
    expect(buses[0]!.stop).toHaveBeenCalled();
    view.unmount();
  });

  it('rebinds the subscription when the React topic changes', async () => {
    const sockets: FakeWebSocket[] = [];
    const received: unknown[] = [];
    function Demo({ topic }: { topic: string }) {
      const bus = useCrossTabDataBus(() => createWebSocketDataBus({
        connection: { url: 'wss://example.test/ws', webSocketFactory: () => { const socket = new FakeWebSocket(); sockets.push(socket); return socket; } }
      }));
      useCrossTabSubscription(bus, topic, message => received.push(message.data));
      return null;
    }
    const view = render(<Demo topic="first" />);
    await waitFor(() => expect(sockets.length).toBe(1));
    const socket = sockets[0]!;
    socket.open();
    await waitFor(() => expect(socket.sent).toContain(JSON.stringify({ op: 'subscribe', topic: 'first' })));
    view.rerender(<Demo topic="second" />);
    await waitFor(() => expect(socket.sent).toContain(JSON.stringify({ op: 'unsubscribe', topic: 'first' })));
    await waitFor(() => expect(socket.sent).toContain(JSON.stringify({ op: 'subscribe', topic: 'second' })));
    socket.serverFrame({ topic: 'first', data: 'old' });
    socket.serverFrame({ topic: 'second', data: 'new' });
    await waitFor(() => expect(received).toEqual(['new']));
    view.unmount();
  });

  it('mirrors the health summary and refreshes on status changes', async () => {
    const sockets: FakeWebSocket[] = [];
    const states: Array<string | null> = [];
    function Demo() {
      const bus = useCrossTabDataBus(() => createWebSocketDataBus({
        connection: { url: 'wss://example.test/ws', webSocketFactory: () => { const socket = new FakeWebSocket(); sockets.push(socket); return socket; } }
      }));
      // Event-driven only: no polling, refreshes ride onStatus.
      const health = useCrossTabHealth(bus, { intervalMs: 0 });
      states.push(health?.state ?? null);
      return null;
    }
    const view = render(<Demo />);
    await waitFor(() => expect(sockets.length).toBe(1));
    sockets[0]!.open();
    await waitFor(() => expect(states.at(-1)).toBe('healthy'));

    // A transport error flips the verdict via the status event.
    sockets[0]!.onerror?.();
    await waitFor(() => expect(states.at(-1)).toBe('recovering'));
    view.unmount();
  });

describe('useCrossTabHealth edge cases', () => {
  interface FakeHealthBus {
    getHealthSummary: () => { healthy: boolean; state: string; seq: number };
    onStatus: (handler: (value: string) => void) => () => void;
    onError: (handler: (error: unknown) => void) => () => void;
    calls: () => number;
    emitStatus: (value: string) => void;
  }

  function makeFakeHealthBus(): FakeHealthBus {
    let seq = 0;
    let calls = 0;
    const statusHandlers = new Set<(value: string) => void>();
    return {
      getHealthSummary: () => {
        calls += 1;
        seq += 1;
        return { healthy: true, state: 'healthy', seq };
      },
      onStatus: handler => {
        statusHandlers.add(handler);
        return () => statusHandlers.delete(handler);
      },
      onError: () => () => {},
      calls: () => calls,
      emitStatus: value => {
        for (const handler of [...statusHandlers]) handler(value);
      }
    };
  }

  function HealthDemo({ bus }: { bus: FakeHealthBus | null }) {
    const health = useCrossTabHealth(bus as never, { intervalMs: 1_000 });
    const seq = health ? (health as unknown as { seq: number }).seq : 0;
    return <span data-testid="health">{health ? `healthy:${seq}` : 'none'}</span>;
  }

  it('polls on the interval, resets to null on detach, and stops polling on unmount', async () => {
    vi.useFakeTimers();
    const bus = makeFakeHealthBus();
    const view = render(<HealthDemo bus={bus} />);
    expect(view.getByTestId('health').textContent).toBe('healthy:1');

    // The interval refreshes the snapshot.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(bus.calls()).toBeGreaterThanOrEqual(2);

    // Detaching the bus resets to null and unsubscribes event listeners.
    await act(async () => {
      view.rerender(<HealthDemo bus={null} />);
    });
    expect(view.getByTestId('health').textContent).toBe('none');
    const callsAtDetach = bus.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(bus.calls()).toBe(callsAtDetach);

    // Unmounting stops the polling timer for good.
    bus.emitStatus('connected');
    view.unmount();
    const callsAtUnmount = bus.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(bus.calls()).toBe(callsAtUnmount);
    vi.useRealTimers();
  });
});
});
