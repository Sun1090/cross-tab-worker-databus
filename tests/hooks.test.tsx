// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSocketDataBus } from '../src/websocket';
import type { WebSocketLike } from '../src/websocket';
import {
  useCrossTabDataBus,
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
    await waitFor(() => expect(harness.received).toEqual([{ topic: 'demo.topic', data: { n: 1 } }]));

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
    await waitFor(() => expect(harness.received).toEqual([{ topic: 'demo.topic', data: { strict: true } }]));

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
});
