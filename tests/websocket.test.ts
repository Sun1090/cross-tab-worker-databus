import { describe, expect, it, vi } from 'vitest';
import {
  WebSocketTransport,
  createWebSocketDataBus
} from '../src/websocket';
import type { WebSocketLike } from '../src/websocket';
import { ChannelHub, createFakeEnvironment, MemoryStorage } from './fakes';

/** Controllable WebSocket double: records sent frames, lets tests fire
 * lifecycle events and inject server frames. */
class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[]
  ) {}

  send(data: string | ArrayBuffer): void {
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

function makeTransport(factory?: (url: string) => FakeWebSocket) {
  const sockets: FakeWebSocket[] = [];
  const transport = new WebSocketTransport({
    url: 'wss://example.test/ws',
    ...(factory
      ? { webSocketFactory: (url: string) => {
          const socket = factory(url);
          sockets.push(socket);
          return socket;
        } }
      : { webSocketFactory: (url: string) => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket;
        } })
  });
  const onMessage = vi.fn();
  const onStatus = vi.fn();
  const onError = vi.fn();
  transport.start(
    { url: 'wss://example.test/ws' },
    { onMessage, onStatus, onError }
  );
  return { sockets, transport, onMessage, onStatus, onError };
}

describe('WebSocketTransport', () => {
  it('maps socket lifecycle to the DataBus status vocabulary', () => {
    const { sockets, onStatus } = makeTransport();
    const socket = sockets[0]!;
    expect(onStatus).not.toHaveBeenCalledWith('connected');
    socket.open();
    expect(onStatus).toHaveBeenCalledWith('connected');
    socket.onerror?.();
    expect(onStatus).toHaveBeenCalledWith('error');
    socket.close();
    expect(onStatus).toHaveBeenCalledWith('disconnected');
  });

  it('reports the SSR guard through onStatus(error) when no WebSocket implementation exists', () => {
    vi.stubGlobal('WebSocket', undefined);
    try {
      const transport = new WebSocketTransport({ url: 'wss://example.test/ws' });
      const onStatus = vi.fn();
      const onError = vi.fn();
      expect(() =>
        transport.start(
          { url: 'wss://example.test/ws' },
          { onMessage: () => {}, onStatus, onError }
        )
      ).not.toThrow();
      expect(onStatus).toHaveBeenCalledWith('error');
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'WebSocketTransport requires a WebSocket implementation.' })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('publishes a multi-item batch as one publishBatch frame', () => {
    const { sockets, transport } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.publishBatch!('market.tick', [
      { data: { price: 1 }, messageId: 'b-0' },
      { data: { price: 2 } },
      { data: { price: 3 }, messageId: 'b-2', timestamp: 42 }
    ]);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      op: 'publishBatch',
      topic: 'market.tick',
      items: [
        { data: { price: 1 }, messageId: 'b-0' },
        { data: { price: 2 } },
        { data: { price: 3 }, messageId: 'b-2', timestamp: 42 }
      ]
    });
  });

  it('delegates a single-item batch to the legacy publish frame', () => {
    const { sockets, transport } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.publishBatch!('market.tick', [{ data: { price: 1 }, messageId: 'only' }]);
    expect(socket.sent).toEqual([
      JSON.stringify({ op: 'publish', topic: 'market.tick', data: { price: 1 }, messageId: 'only' })
    ]);
  });

  it('drops a batch frame with onError when the socket is not open', () => {
    const { transport, onError } = makeTransport();
    transport.publishBatch!('market.tick', [{ data: 1 }, { data: 2 }]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('publishBatch') }));
  });

  it('treats an empty batch as a no-op and never touches the socket', () => {
    const { sockets, transport, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.publishBatch!('market.tick', []);
    expect(socket.sent).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('embeds ArrayBuffer items as byte arrays so a mixed batch stays one frame', () => {
    const { sockets, transport } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    const binary = new Uint8Array([1, 2, 3]).buffer;
    transport.publishBatch!('market.tick', [
      { data: binary, messageId: 'bin' },
      { data: { price: 9 } }
    ]);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      op: 'publishBatch',
      topic: 'market.tick',
      items: [
        { data: [1, 2, 3], messageId: 'bin' },
        { data: { price: 9 } }
      ]
    });
  });

  it('a second start() while a socket is live does not open a replacement', () => {
    const { sockets, transport, onMessage, onStatus, onError } = makeTransport();
    expect(sockets).toHaveLength(1);
    // A duplicate start (e.g. a resume racing an in-flight open) must reuse
    // the existing socket rather than orphaning it.
    transport.start({ url: 'wss://example.test/other' }, { onMessage, onStatus, onError });
    expect(sockets).toHaveLength(1);
  });

  it('ignores a non-string, non-binary server frame', () => {
    const { sockets, onMessage, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    socket.onmessage?.({ data: 12345 as unknown as string });
    socket.onmessage?.({ data: null as unknown as string });
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores a JSON frame that parses to a non-object', () => {
    const { sockets, onMessage, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    socket.onmessage?.({ data: 'null' });
    socket.onmessage?.({ data: '42' });
    socket.onmessage?.({ data: '"a string"' });
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('sends JSON subscribe/unsubscribe/publish frames and tracks topics', () => {
    const { sockets, transport } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.subscribe('market.tick');
    transport.unsubscribe('market.tick');
    transport.subscribe('market.tick');
    transport.publish('market.tick', { price: 1 });
    expect(socket.sent).toEqual([
      JSON.stringify({ op: 'subscribe', topic: 'market.tick' }),
      JSON.stringify({ op: 'unsubscribe', topic: 'market.tick' }),
      JSON.stringify({ op: 'subscribe', topic: 'market.tick' }),
      JSON.stringify({ op: 'publish', topic: 'market.tick', data: { price: 1 } })
    ]);
  });

  it('propagates optional publication message IDs in JSON frames', () => {
    const { sockets, transport, onMessage } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.publish('market.tick', { price: 1 }, { messageId: 'm-1' });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ op: 'publish', topic: 'market.tick', data: { price: 1 }, messageId: 'm-1' }));
    socket.onmessage?.({ data: JSON.stringify({ topic: 'market.tick', data: { price: 2 }, messageId: 'm-2' }) });
    expect(onMessage).toHaveBeenCalledWith({ topic: 'market.tick', data: { price: 2 }, messageId: 'm-2' });
  });

  it('propagates complete publication metadata in JSON and metadata-bearing binary frames', () => {
    const { sockets, transport } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.publish('market.tick', { price: 1 }, { messageId: 'm-1', timestamp: 42 });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({
      op: 'publish',
      topic: 'market.tick',
      data: { price: 1 },
      messageId: 'm-1',
      timestamp: 42
    }));

    transport.publish('market.bin', new Uint8Array([1, 2]).buffer, { timestamp: 43 });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({
      op: 'publish',
      topic: 'market.bin',
      data: [1, 2],
      timestamp: 43
    }));
  });

  it('accepts nested publication envelopes for forward-compatible servers', () => {
    const { sockets, onMessage } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ op: 'publication', publication: { topic: 't', data: 1, messageId: 'm', timestamp: 42 } }) });
    expect(onMessage).toHaveBeenCalledWith({ topic: 't', data: 1, messageId: 'm', timestamp: 42 });
  });

  it('sends and receives ArrayBuffer publications as binary frames', () => {
    const { sockets, transport, onMessage } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.publish('bin.topic', new Uint8Array([1, 2, 3]).buffer);
    const frame = socket.sent.at(-1);
    expect(frame).toBeInstanceOf(ArrayBuffer);

    const bytes = new Uint8Array([0xc7, 0, 9, ...new TextEncoder().encode('bin.topic'), 4, 5]);
    socket.onmessage?.({ data: bytes.buffer });
    expect(onMessage).toHaveBeenCalledWith({ topic: 'bin.topic', data: expect.any(ArrayBuffer) });
    expect(Array.from(new Uint8Array(onMessage.mock.calls.at(-1)![0].data))).toEqual([4, 5]);
  });

  it('accepts Blob binary publications when the browser uses Blob binaryType', async () => {
    const { sockets, onMessage } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    const bytes = new Uint8Array([0xc7, 0, 9, ...new TextEncoder().encode('bin.topic'), 6, 7]);
    socket.onmessage?.({ data: new Blob([bytes]) });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onMessage).toHaveBeenCalledWith({ topic: 'bin.topic', data: expect.any(ArrayBuffer) });
    expect(Array.from(new Uint8Array(onMessage.mock.calls.at(-1)![0].data))).toEqual([6, 7]);
  });

  it('isolates a conversion failure inside a Blob binary frame through onError', async () => {
    const { sockets, onMessage, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    // A malformed Blob still resolves arrayBuffer() in practice; force the
    // conversion path to throw by making arrayBuffer() itself reject, then
    // verify the transport reports the error instead of crashing.
    const poisoned = new Blob([new Uint8Array([1])]);
    Object.defineProperty(poisoned, 'arrayBuffer', {
      value: () => Promise.reject(new Error('blob conversion failed'))
    });
    socket.onmessage?.({ data: poisoned });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'blob conversion failed' }));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('rejects a binary publish whose topic exceeds the 16-bit frame prefix', () => {
    const { sockets, transport, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    // 0xffff = 65535 bytes is the frame's topic-length ceiling; one more byte
    // cannot be encoded, so publish must report the error and send nothing.
    transport.publish('x'.repeat(0x1_0000), new Uint8Array([1]).buffer);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'WebSocket topic is too long for a binary frame.' }));
    expect(socket.sent).toHaveLength(0);

    // Boundary: exactly 65535 bytes still fits and produces one frame.
    transport.publish('x'.repeat(0xffff), new Uint8Array([1]).buffer);
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent.at(-1)).toBeInstanceOf(ArrayBuffer);
  });

  it('ignores truncated or invalid binary frames without crashing the transport', () => {
    const { sockets, onMessage, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    socket.onmessage?.({ data: new Uint8Array([0xc7]).buffer });
    socket.onmessage?.({ data: new Uint8Array([0xc7, 0, 8, 1, 2]).buffer });
    socket.onmessage?.({ data: new Uint8Array([0x00, 0, 0]).buffer });
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('continues delivering valid publications after malformed binary frames', () => {
    const { sockets, onMessage, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    socket.onmessage?.({ data: new Uint8Array([0xc7, 0, 20, 1]).buffer });
    socket.onmessage?.({ data: '{broken' });
    socket.onmessage?.({ data: JSON.stringify({ op: 'publication', publication: { topic: 'ok', data: 9 } }) });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ topic: 'ok', data: 9 });
  });

  it('re-asserts subscriptions when the socket (re)opens', () => {
    const { sockets, transport } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.subscribe('a');
    transport.subscribe('b');
    const afterFirstOpen = socket.sent.length;

    // Simulate an in-place socket recovery: the same socket object drops and
    // reconnects (e.g. transparent reconnect by the underlying runtime). The
    // onopen handler must re-assert every tracked subscription.
    socket.close();
    socket.open();
    expect(socket.sent.slice(afterFirstOpen)).toEqual([
      JSON.stringify({ op: 'subscribe', topic: 'a' }),
      JSON.stringify({ op: 'subscribe', topic: 'b' })
    ]);
  });

  it('ignores late events from a socket replaced after stop/start', () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    const firstMessage = vi.fn();
    transport.start({ url: 'wss://example.test/ws' }, { onMessage: firstMessage, onStatus: () => {}, onError: () => {} });
    const first = sockets[0]!;
    first.open();
    transport.stop();

    const secondMessage = vi.fn();
    transport.start({ url: 'wss://example.test/ws' }, { onMessage: secondMessage, onStatus: () => {}, onError: () => {} });
    const second = sockets[1]!;
    second.open();
    first.serverFrame({ topic: 'stale', data: 1 });
    second.serverFrame({ topic: 'fresh', data: 2 });

    expect(firstMessage).not.toHaveBeenCalled();
    expect(secondMessage).toHaveBeenCalledWith({ topic: 'fresh', data: 2 });
  });

  it('keeps only the newest socket active across repeated replacement cycles', () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    const onMessage = vi.fn();
    transport.start({ url: 'wss://example.test/ws' }, { onMessage, onStatus: () => {}, onError: () => {} });

    const first = sockets[0]!;
    first.open();
    transport.stop();
    transport.start({ url: 'wss://example.test/ws' }, { onMessage, onStatus: () => {}, onError: () => {} });
    const second = sockets[1]!;
    second.open();
    transport.stop();
    transport.start({ url: 'wss://example.test/ws' }, { onMessage, onStatus: () => {}, onError: () => {} });
    const third = sockets[2]!;
    third.open();

    first.serverFrame({ topic: 'stale.1', data: 1 });
    second.serverFrame({ topic: 'stale.2', data: 2 });
    third.serverFrame({ topic: 'fresh', data: 3 });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ topic: 'fresh', data: 3 });
  });

  it('clears subscriptions and stale callbacks across repeated stop/start cycles', () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => { const socket = new FakeWebSocket(url); sockets.push(socket); return socket; }
    });
    const onMessage = vi.fn();
    const handlers = { onMessage, onStatus: vi.fn(), onError: vi.fn() };
    for (let cycle = 0; cycle < 5; cycle += 1) {
      transport.start({ url: 'wss://example.test/ws' }, handlers);
      const socket = sockets.at(-1)!;
      socket.open();
      transport.subscribe(`topic.${cycle}`);
      transport.stop();
      socket.serverFrame({ topic: 'stale', data: cycle });
      expect(onMessage).not.toHaveBeenCalled();
      transport.start({ url: 'wss://example.test/ws' }, handlers);
      const reopened = sockets.at(-1)!;
      reopened.open();
      expect(reopened.sent.filter(frame => typeof frame === 'string' && frame.includes('"op":"subscribe"'))).toEqual([]);
      transport.stop();
    }
  });

  it('ignores stale close and error callbacks after a restart', () => {
    const sockets: FakeWebSocket[] = [];
    const onStatus = vi.fn();
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => { const socket = new FakeWebSocket(url); sockets.push(socket); return socket; }
    });
    const handlers = { onMessage: vi.fn(), onStatus, onError: vi.fn() };
    transport.start({ url: 'wss://example.test/ws' }, handlers);
    const first = sockets[0]!;
    first.open();
    transport.stop();
    transport.start({ url: 'wss://example.test/ws' }, handlers);
    const second = sockets[1]!;
    second.open();
    onStatus.mockClear();
    first.onerror?.();
    first.onclose?.();
    expect(onStatus).not.toHaveBeenCalled();
    second.onerror?.();
    expect(onStatus).toHaveBeenCalledWith('error');
  });

  it('survives repeated socket errors with only the newest connection active', () => {
    const sockets: FakeWebSocket[] = [];
    const onStatus = vi.fn();
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => { const socket = new FakeWebSocket(url); sockets.push(socket); return socket; }
    });
    const handlers = { onMessage: vi.fn(), onStatus, onError: vi.fn() };
    for (let cycle = 0; cycle < 4; cycle += 1) {
      transport.start({ url: 'wss://example.test/ws' }, handlers);
      const socket = sockets.at(-1)!;
      socket.open();
      socket.onerror?.();
      transport.stop();
      socket.serverFrame({ topic: 'stale', data: cycle });
    }
    expect(sockets).toHaveLength(4);
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });

  it('delivers server publications with a string topic and ignores other frames', () => {
    const { sockets, onMessage, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    socket.serverFrame({ topic: 'market.tick', data: { price: 7 } });
    expect(onMessage).toHaveBeenCalledWith({ topic: 'market.tick', data: { price: 7 } });

    // Non-publication object shapes are ignored without touching onError.
    socket.serverFrame({ op: 'ping' });
    socket.serverFrame({ topic: 42 });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    // Unparseable text frames surface through onError but never throw.
    socket.serverFrame('not json');
    socket.serverFrame('{broken');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('accepts legacy and nested publication frames with unknown fields', () => {
    const { sockets, onMessage } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    socket.serverFrame({ version: 1, topic: 'legacy', data: 1, requestId: 'ignored' });
    socket.serverFrame({
      op: 'publication.v2',
      publication: { topic: 'nested', data: 2, messageId: 'm-2', futureField: true },
      traceId: 'ignored'
    });
    expect(onMessage).toHaveBeenNthCalledWith(1, { topic: 'legacy', data: 1 });
    expect(onMessage).toHaveBeenNthCalledWith(2, { topic: 'nested', data: 2, messageId: 'm-2' });
  });

  it('drops frames with an onError report while the socket is not open', () => {
    const { transport, onError } = makeTransport();
    // Socket created but never opened (readyState 0).
    transport.publish('t', 1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('not open') }));
  });

  it('reports a dropped binary publish while the socket is not open', () => {
    // Binary publishes take a separate framing path; a closed socket must be
    // surfaced there too instead of silently discarding the ArrayBuffer.
    const { transport, onError } = makeTransport();
    transport.publish('bin.topic', new Uint8Array([1, 2, 3]).buffer);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('not open') })
    );
  });

  it('reports a throwing factory through onStatus(error) instead of throwing', () => {
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: () => {
        throw new Error('no websocket here');
      }
    });
    const onStatus = vi.fn();
    const onError = vi.fn();
    expect(() =>
      transport.start(
        { url: 'wss://example.test/ws' },
        { onMessage: () => {}, onStatus, onError }
      )
    ).not.toThrow();
    expect(onStatus).toHaveBeenCalledWith('error');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'no websocket here' }));
  });

  it('is safe to stop twice and clears subscription tracking', () => {
    const { sockets, transport } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
    transport.subscribe('a');
    transport.stop();
    expect(socket.readyState).toBe(3);
    expect(() => transport.stop()).not.toThrow();
    // After stop the transport is inert; start() may be called again.
    expect(() =>
      transport.start(
        { url: 'wss://example.test/ws' },
        { onMessage: () => {}, onStatus: () => {}, onError: () => {} }
      )
    ).not.toThrow();
  });

  it('passes protocols through to the socket factory', () => {
    const seen: Array<string | string[] | undefined> = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      protocols: ['chat.v1'],
      webSocketFactory: (url, protocols) => {
        seen.push(protocols);
        return new FakeWebSocket(url, protocols);
      }
    });
    transport.start(
      { url: 'wss://example.test/ws', protocols: ['chat.v1'] },
      { onMessage: () => {}, onStatus: () => {}, onError: () => {} }
    );
    expect(seen).toEqual([['chat.v1']]);
  });
});

describe('createWebSocketDataBus', () => {
  it('wires a WebSocket transport into an auto-starting CrossTabDataBus', async () => {
    const sockets: FakeWebSocket[] = [];
    const bus = createWebSocketDataBus<{ hello: string }>({
      connection: {
        url: 'wss://example.test/ws',
        webSocketFactory: url => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket;
        }
      }
    });
    const received: Array<{ topic: string; data: { hello: string } }> = [];
    bus.subscribe('demo.topic', message => received.push(message));
    await bus.ready();

    const socket = sockets[0]!;
    socket.open();
    socket.serverFrame({ topic: 'demo.topic', data: { hello: 'world' } });
    expect(received[0]).toMatchObject({ topic: 'demo.topic', data: { hello: 'world' } });

    // Publish goes out over the socket as a JSON frame.
    bus.publish('demo.topic', { hello: 'from-tab' });
    expect(socket.sent.at(-1)).toBe(
      JSON.stringify({ op: 'publish', topic: 'demo.topic', data: { hello: 'from-tab' } })
    );

    await bus.stop();
    expect(socket.readyState).toBe(3);
  });
});

describe('createWebSocketDataBus factory', () => {
  it('forwards loadWeighting so the worker record starts sampling throughput', async () => {
    const storage = new MemoryStorage();
    let now = 1_000;
    const environment = createFakeEnvironment({ storage, hub: new ChannelHub(), now: () => now, randomId: 'ws-weighting' });
    const socket = new FakeWebSocket('wss://example.test/ws');
    const bus = createWebSocketDataBus({
      connection: {
        url: 'wss://example.test/ws',
        webSocketFactory: () => socket as unknown as WebSocketLike
      },
      environment: environment.environment,
      loadWeighting: { messageRateWeight: 1 }
    });
    bus.subscribe('demo.topic', () => undefined);
    await bus.ready();
    now += 3_000;
    environment.runIntervals();
    await Promise.resolve();
    await Promise.resolve();

    const workerRecord = storage.entries().find(([key]) => key.includes(':worker:'));
    expect(workerRecord).toBeDefined();
    expect(JSON.parse(workerRecord![1]).throughput).toMatchObject({ windowMs: 3_000, overrunMs: 0 });
    await bus.stop();
  });
});
