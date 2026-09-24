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
  closeCalls = 0;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[]
  ) {}

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
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

/** Run one attempt through its connect timeout, with fake timers already
 * installed. This is the state where the transport has abandoned a socket while
 * `this.socket` still names it: the timer's own body lowers `socketActive` and
 * `abortSocket()` only closes, and nothing clears `this.socket` but `stop()`. So
 * for anything that socket delivers afterwards, the third term of each
 * listener's guard is the only operand that can decide — the first two compare a
 * pair that still matches. */
async function timedOutAttempt() {
  const sockets: FakeWebSocket[] = [];
  const onMessage = vi.fn();
  const transport = new WebSocketTransport({
    url: 'wss://example.test/ws',
    webSocketFactory: url => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    }
  });
  const onStatus = vi.fn();
  const onError = vi.fn();
  const opening = Promise.resolve(
    transport.start(
      { url: 'wss://example.test/ws', connectTimeoutMs: 25 },
      { onMessage, onStatus, onError }
    )
  ).then(() => null, error => error);
  await vi.advanceTimersByTimeAsync(25);
  return { sockets, transport, onMessage, onStatus, onError, error: await opening };
}

/** Let the DataBus lifecycle gate reach transport.start(), whose socket
 * factory runs after a couple of chained microtasks. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
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
    // A close often follows an error. It must not overwrite the error status
    // that scheduled DataBus automatic recovery.
    expect(onStatus).not.toHaveBeenCalledWith('disconnected');
  });

  it('maps a clean socket close to the disconnected status', () => {
    const { sockets, onStatus } = makeTransport();
    const socket = sockets[0]!;
    socket.open();
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

    // The delegation must keep the wire shape for the other two metadata
    // combinations too — an absent key must not be serialised as `undefined`.
    socket.sent.splice(0);
    transport.publishBatch!('market.tick', [{ data: { price: 2 }, timestamp: 7 }]);
    expect(socket.sent).toEqual([
      JSON.stringify({ op: 'publish', topic: 'market.tick', data: { price: 2 }, timestamp: 7 })
    ]);

    socket.sent.splice(0);
    transport.publishBatch!('market.tick', [{ data: { price: 3 } }]);
    expect(socket.sent).toEqual([
      JSON.stringify({ op: 'publish', topic: 'market.tick', data: { price: 3 } })
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

  it('opens a replacement socket after the current connection fails or closes', () => {
    const { sockets, transport, onMessage, onStatus, onError } = makeTransport();
    const handlers = { onMessage, onStatus, onError };
    const first = sockets[0]!;
    first.open();

    first.onerror?.();
    expect(onStatus).toHaveBeenLastCalledWith('error');
    transport.start({ url: 'wss://example.test/ws' }, handlers);
    expect(sockets).toHaveLength(2);

    const second = sockets[1]!;
    second.open();
    expect(onStatus).toHaveBeenLastCalledWith('connected');

    // A late error/close/message from the failed connection must not affect
    // the replacement socket or its handlers.
    first.onerror?.();
    first.onclose?.();
    first.serverFrame({ topic: 'stale', data: 1 });
    expect(onMessage).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('connected');

    second.onclose?.();
    expect(onStatus).toHaveBeenLastCalledWith('disconnected');
    transport.start({ url: 'wss://example.test/ws' }, handlers);
    expect(sockets).toHaveLength(3);
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

    // The dedup ID is the field a binary frame has the most reason to keep: the
    // compact wire form has no room for it, so it must ride in the JSON envelope
    // — with or without a timestamp alongside.
    transport.publish('market.bin', new Uint8Array([3, 4]).buffer, { messageId: 'm-2' });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({
      op: 'publish',
      topic: 'market.bin',
      data: [3, 4],
      messageId: 'm-2'
    }));
    transport.publish('market.bin', new Uint8Array([5]).buffer, { messageId: 'm-3', timestamp: 44 });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({
      op: 'publish',
      topic: 'market.bin',
      data: [5],
      messageId: 'm-3',
      timestamp: 44
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

  it('ignores a Blob frame that resolves after the socket is replaced', async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    transport.start(
      { url: 'wss://example.test/ws' },
      { onMessage: vi.fn(), onStatus: () => {}, onError: () => {} }
    );
    const first = sockets[0]!;
    first.open();

    let resolveFrame!: (buffer: ArrayBuffer) => void;
    const pending = new Blob([new Uint8Array([1])]);
    Object.defineProperty(pending, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>(resolve => { resolveFrame = resolve; })
    });
    first.onmessage?.({ data: pending });

    // Replace the connection while the Blob conversion is still pending.
    transport.stop();
    const onMessage = vi.fn();
    const onError = vi.fn();
    transport.start(
      { url: 'wss://example.test/ws' },
      { onMessage, onStatus: () => {}, onError }
    );
    sockets[1]!.open();

    const bytes = new Uint8Array([0xc7, 0, 9, ...new TextEncoder().encode('bin.topic'), 8, 9]);
    resolveFrame(bytes.buffer);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
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

  it('does not report a Blob conversion failure that belongs to a replaced connection', async () => {
    // The missing third of a pair. 'isolates a conversion failure …' above runs
    // this catch's guard **true** (a live connection reports), and 'ignores a Blob
    // frame that resolves after the socket is replaced' runs the sibling guard on
    // the success path — so the leg where a conversion fails *after* the connection
    // was replaced had never executed, and the swallow it performs was unasserted.
    // The reason it matters is one line down: the report goes to `this.handlers`,
    // whoever holds the connection at that moment, so deleting the guard delivers a
    // dead socket's conversion error to the replacement connection's `onError` —
    // which is also the shape a user would read as "the new connection is broken".
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    transport.start(
      { url: 'wss://example.test/ws' },
      { onMessage: () => {}, onStatus: () => {}, onError: () => {} }
    );
    const first = sockets[0]!;
    first.open();

    const doomed = new Blob([new Uint8Array([1])]);
    let rejectFrame!: (error: Error) => void;
    Object.defineProperty(doomed, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((_, reject) => {
          rejectFrame = reject;
        })
    });
    first.onmessage?.({ data: doomed });

    transport.stop();
    const onMessage = vi.fn();
    const onError = vi.fn();
    transport.start({ url: 'wss://example.test/ws' }, { onMessage, onStatus: () => {}, onError });
    sockets[1]!.open();

    rejectFrame(new Error('blob conversion failed after replacement'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onError).not.toHaveBeenCalled();
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

  it('resolves start() only after the socket handshake completes', async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    const onStatus = vi.fn();
    let settled = false;
    const startPromise = Promise.resolve(
      transport.start(
        { url: 'wss://example.test/ws' },
        { onMessage: () => {}, onStatus, onError: () => {} }
      )
    ).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(sockets).toHaveLength(1);
    expect(settled).toBe(false);
    expect(onStatus).not.toHaveBeenCalledWith('connected');

    sockets[0]!.open();
    await startPromise;
    expect(settled).toBe(true);
    expect(onStatus).toHaveBeenCalledWith('connected');
    transport.stop();
  });

  it('shares the handshake gate when start() is called again while connecting', async () => {
    // The transport owns the socket from the moment it is constructed, so a
    // duplicate start() during the handshake must reuse the in-flight gate:
    // opening a second socket would orphan the first (never closed) and let a
    // caller report readiness from a handshake it does not own.
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    const handlers = { onMessage: () => {}, onStatus: () => {}, onError: () => {} };
    const first = Promise.resolve(transport.start({ url: 'wss://example.test/ws' }, handlers));
    const second = Promise.resolve(transport.start({ url: 'wss://example.test/ws' }, handlers));

    expect(sockets).toHaveLength(1);
    expect(second).toBe(first);

    let settled = 0;
    void first.then(() => { settled += 1; });
    void second.then(() => { settled += 1; });
    await Promise.resolve();
    expect(settled).toBe(0);

    sockets[0]!.open();
    await Promise.all([first, second]);
    expect(settled).toBe(2);
    transport.stop();
  });

  it('waits indefinitely when the handshake budget is 0 or Infinity', async () => {
    // docs/api.md and docs/transports.md both promise "`0` or `Infinity` waits
    // indefinitely", and the armed-timeout branch is the only thing that can
    // fail an attempt on its own. Nothing pinned that the budget can be turned
    // off, so a change to the guard would silently start timing out consumers
    // that opt out.
    vi.useFakeTimers();
    try {
      for (const budget of [0, Number.POSITIVE_INFINITY]) {
        const sockets: FakeWebSocket[] = [];
        const transport = new WebSocketTransport({
          url: 'wss://example.test/ws',
          webSocketFactory: url => {
            const socket = new FakeWebSocket(url);
            sockets.push(socket);
            return socket;
          }
        });
        const onStatus = vi.fn();
        const opening = Promise.resolve(
          transport.start(
            { url: 'wss://example.test/ws', connectTimeoutMs: budget },
            { onMessage: () => {}, onStatus, onError: () => {} }
          )
        ).then(() => 'resolved', error => error as Error);

        await vi.advanceTimersByTimeAsync(3_600_000);
        expect(onStatus).not.toHaveBeenCalledWith('error');
        expect(sockets[0]!.readyState).not.toBe(3);

        sockets[0]!.open();
        expect(await opening).toBe('resolved');
        expect(onStatus).toHaveBeenCalledWith('connected');
        transport.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects start() and reports an error when the handshake times out', async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeWebSocket[] = [];
      const transport = new WebSocketTransport({
        url: 'wss://example.test/ws',
        webSocketFactory: url => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket;
        }
      });
      const onStatus = vi.fn();
      const onError = vi.fn();
      const rejection = Promise.resolve(
        transport.start(
          { url: 'wss://example.test/ws', connectTimeoutMs: 25 },
          { onMessage: () => {}, onStatus, onError }
        )
      ).then(() => null, error => error);

      await vi.advanceTimersByTimeAsync(25);
      const error = await rejection;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('25ms');
      expect(onStatus).toHaveBeenCalledWith('error');
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('25ms') })
      );

      // A late open from the timed-out socket must not resurrect readiness.
      sockets[0]!.open();
      expect(onStatus).not.toHaveBeenCalledWith('connected');
      transport.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a late error from the socket whose connect timeout already reported one', async () => {
    vi.useFakeTimers();
    try {
      const { sockets, transport, onStatus, onError, error } = await timedOutAttempt();
      expect(error).toBeInstanceOf(Error);
      // One failure has already been announced. Without the guard's third term a
      // `close`-triggered or server-driven `error` on the abandoned socket reports a
      // second one for a connection the application was already told had failed —
      // and this is the state the first two operands cannot see, because `stop()` is
      // what clears `this.socket`, not a timeout.
      const statusCalls = onStatus.mock.calls.length;
      const errorCalls = onError.mock.calls.length;
      sockets[0]!.onerror?.();
      expect(onStatus).toHaveBeenCalledTimes(statusCalls);
      expect(onError).toHaveBeenCalledTimes(errorCalls);
      transport.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a server frame that arrives after the connect attempt timed out', async () => {
    vi.useFakeTimers();
    try {
      const { sockets, transport, onMessage } = await timedOutAttempt();
      sockets[0]!.serverFrame({ topic: 'late', data: 1 });
      await flushMicrotasks();
      // Positive control for the frame itself: 'propagates optional publication
      // message IDs in JSON frames' shows the identical JSON shape reaching
      // `onMessage` while the attempt is live, so this assertion is about the dead
      // attempt rather than an unreadable frame.
      expect(onMessage).not.toHaveBeenCalled();
      transport.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a Blob frame whose conversion finishes after its connection closed', async () => {
    // The one way `handleMessage`'s own `!this.socketActive` operand can be reached:
    // the frame clears the listener's live check, the connection then dies while
    // `arrayBuffer()` is still pending, and `this.socket` still names the same
    // object — only `stop()` clears that field, which is why the replaced-socket case
    // elsewhere is decided by the first operand and never arrives here.
    const { sockets, transport, onMessage, onError } = makeTransport();
    const socket = sockets[0]!;
    socket.open();

    let resolveFrame!: (buffer: ArrayBuffer) => void;
    const pending = new Blob([new Uint8Array([1])]);
    Object.defineProperty(pending, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>(resolve => { resolveFrame = resolve; })
    });
    socket.onmessage?.({ data: pending });
    socket.onclose?.();

    const bytes = new Uint8Array([0xc7, 0, 9, ...new TextEncoder().encode('bin.topic'), 6, 7]);
    resolveFrame(bytes.buffer);
    await new Promise(resolve => setTimeout(resolve, 0));
    const closedCalls = onMessage.mock.calls.length;
    expect(closedCalls).toBe(0);

    // Control, in the same construction: the identical deferred resolution on a
    // connection that stayed open does deliver. Without it this test would also pass
    // with the guard deleted, because an undeliverable frame and a correctly dropped
    // one look the same from `not.toHaveBeenCalled()`. (That is how the first version
    // of this case survived the mutation it was written for: a timed-out attempt
    // cannot reach here at all, since `onmessage`'s own guard is what rejects it.)
    const live = makeTransport();
    live.sockets[0]!.open();
    let resolveLive!: (buffer: ArrayBuffer) => void;
    const liveBlob = new Blob([new Uint8Array([1])]);
    Object.defineProperty(liveBlob, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>(resolve => { resolveLive = resolve; })
    });
    live.sockets[0]!.onmessage?.({ data: liveBlob });
    resolveLive(bytes.buffer);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(live.onMessage).toHaveBeenCalledTimes(1);
    expect(Array.from(new Uint8Array(live.onMessage.mock.calls[0]![0].data))).toEqual([6, 7]);
    expect(onMessage).toHaveBeenCalledTimes(closedCalls);
    expect(onError).not.toHaveBeenCalled();
    transport.stop();
    live.transport.stop();
  });

  it('never lets the connect timer tear down a handshake that already completed', async () => {
    // Two protections keep a completed attempt from being timed out: `onopen`
    // cancels the pending timer, and the callback's own `handshakeCompleted`
    // term returns if it fires anyway. Either one alone is enough, so this
    // pins the pair — deleting just the cancel or just the term still passes,
    // deleting both makes a healthy socket die, which is the failure that
    // actually reaches a user: a 30-second default budget on a connection that
    // opened at 29s, reported as an error and aborted.
    vi.useFakeTimers();
    try {
      const sockets: FakeWebSocket[] = [];
      const transport = new WebSocketTransport({
        url: 'wss://example.test/ws',
        webSocketFactory: url => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket;
        }
      });
      const onStatus = vi.fn();
      const onError = vi.fn();
      const opening = Promise.resolve(
        transport.start(
          { url: 'wss://example.test/ws', connectTimeoutMs: 25 },
          { onMessage: () => {}, onStatus, onError }
        )
      ).then(() => null, error => error);

      sockets[0]!.open();
      expect(await opening).toBeNull();
      expect(onStatus).toHaveBeenCalledWith('connected');

      onStatus.mockClear();
      onError.mockClear();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onStatus).not.toHaveBeenCalledWith('error');
      expect(onError).not.toHaveBeenCalled();
      expect(sockets[0]!.closeCalls).toBe(0);
      expect(sockets[0]!.readyState).toBe(1);

      // The socket is still the live one, so frames still go out on it.
      transport.subscribe('room.a');
      expect(JSON.parse(String(sockets[0]!.sent.at(-1)))).toEqual({
        op: 'subscribe',
        topic: 'room.a'
      });
      transport.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no connect timer armed when the handshake fails on a close', async () => {
    // The other half of the pair above. `failConnect()` cancels the attempt's
    // connect timer *before* it rejects, so a handshake that died has no live
    // budget left to fire at all — which is also what makes the callback's
    // staleness terms unreachable, since no later attempt can be shadowed by a
    // timer this one abandoned. Measured: with this test taken out, deleting only
    // that cancel leaves the rest of the suite green, because nothing else in it
    // advances a clock past a failed handshake. What it costs is a second report
    // for a connection the application was already told had failed — the dead
    // attempt's own timeout reaching `onStatus('error')` and `onError` at
    // `connectTimeoutMs`.
    vi.useFakeTimers();
    try {
      const sockets: FakeWebSocket[] = [];
      const transport = new WebSocketTransport({
        url: 'wss://example.test/ws',
        webSocketFactory: url => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket;
        }
      });
      const onStatus = vi.fn();
      const onError = vi.fn();
      const opening = Promise.resolve(
        transport.start(
          { url: 'wss://example.test/ws', connectTimeoutMs: 25 },
          { onMessage: () => {}, onStatus, onError }
        )
      ).then(() => null, error => error);

      sockets[0]!.close();
      const failure = await opening;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain('closed before the handshake');
      expect(onStatus).toHaveBeenCalledTimes(1);
      expect(onStatus).toHaveBeenCalledWith('disconnected');
      expect(onError).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(onStatus).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a socket that errors before the handshake completes', async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    const onStatus = vi.fn();
    const rejection = Promise.resolve(
      transport.start(
        { url: 'wss://example.test/ws' },
        { onMessage: () => {}, onStatus, onError: () => {} }
      )
    ).then(() => null, error => error);

    const socket = sockets[0]!;
    socket.onerror?.();
    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('failed to open');
    expect(onStatus).toHaveBeenCalledWith('error');
    expect(socket.closeCalls).toBe(1);
    expect(socket.readyState).toBe(3);
  });

  it('rejects start() when the socket closes before the handshake completes', async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/ws',
      webSocketFactory: url => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    const onStatus = vi.fn();
    const rejection = Promise.resolve(
      transport.start(
        { url: 'wss://example.test/ws' },
        { onMessage: () => {}, onStatus, onError: () => {} }
      )
    ).then(() => null, error => error);

    sockets[0]!.close();
    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('closed before the handshake');
    expect(onStatus).toHaveBeenCalledWith('disconnected');
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

  it('resolves the platform WebSocket constructor when no factory is injected', () => {
    // Every other case injects a factory, so the default resolution — the path an
    // actual browser takes — never ran. Dropping the `protocols` argument there
    // would silently disable subprotocol negotiation.
    const constructed: Array<{
      socket: FakeWebSocket;
      args: [string, string | string[] | undefined];
    }> = [];
    class PlatformWebSocket extends FakeWebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        constructed.push({ socket: this, args: [url, protocols] });
      }
    }
    vi.stubGlobal('WebSocket', PlatformWebSocket);
    try {
      const transport = new WebSocketTransport({
        url: 'wss://example.test/ws',
        protocols: ['chat.v1']
      });
      void transport.start(
        { url: 'wss://example.test/ws' },
        { onMessage: () => {}, onStatus: () => {}, onError: () => {} }
      );
      expect(constructed.map(entry => entry.args)).toEqual([['wss://example.test/ws', ['chat.v1']]]);
      // Let the handshake settle so the pending connect budget is released.
      constructed[0]!.socket.open();
      void transport.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createWebSocketDataBus', () => {
  it('keeps ready() pending until the WebSocket handshake completes', async () => {
    const sockets: FakeWebSocket[] = [];
    const bus = createWebSocketDataBus<number>({
      connection: {
        url: 'wss://example.test/ws',
        webSocketFactory: url => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket;
        }
      }
    });
    await flushMicrotasks();
    const socket = sockets[0]!;
    let readyResolved = false;
    const ready = bus.ready().then(() => {
      readyResolved = true;
    });
    await flushMicrotasks();
    expect(readyResolved).toBe(false);

    socket.open();
    await ready;
    expect(readyResolved).toBe(true);

    bus.publish('demo.topic', 7);
    expect(socket.sent.at(-1)).toBe(
      JSON.stringify({ op: 'publish', topic: 'demo.topic', data: 7 })
    );
    await bus.stop();
  });

  it('automatically reopens and re-subscribes after a socket error', async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeWebSocket[] = [];
      const environment = createFakeEnvironment({
        storage: new MemoryStorage(),
        hub: new ChannelHub(),
        now: () => 1_000,
        randomId: 'ws-recovery'
      });
      const bus = createWebSocketDataBus<number>({
        connection: {
          url: 'wss://example.test/ws',
          webSocketFactory: url => {
            const socket = new FakeWebSocket(url);
            sockets.push(socket);
            return socket;
          }
        },
        environment: environment.environment,
        recovery: { cooldownMs: 100 }
      });
      const received: number[] = [];
      bus.subscribe('demo.topic', message => received.push(message.data));
      // createWebSocketDataBus() chains transport.start() behind its lifecycle
      // gate, so the socket factory runs a couple of microtasks later.
      await flushMicrotasks();
      const first = sockets[0]!;
      first.open();
      await bus.ready();
      first.onerror?.();
      expect(bus.getStatus()).toBe('error');
      // Recovery replaces the socket; failing to close it here would leave a
      // dead connection alive and make close-only resource checks unreliable.
      expect(first.closeCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(sockets).toHaveLength(2);
      const second = sockets[1]!;
      second.open();

      expect(bus.getStatus()).toBe('connected');
      expect(second.sent).toContain(JSON.stringify({ op: 'subscribe', topic: 'demo.topic' }));
      first.serverFrame({ topic: 'demo.topic', data: 1 });
      second.serverFrame({ topic: 'demo.topic', data: 2 });
      expect(received).toEqual([2]);

      await bus.stop();
    } finally {
      vi.useRealTimers();
    }
  });

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
    await flushMicrotasks();
    const socket = sockets[0]!;
    socket.open();
    await bus.ready();
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
    await flushMicrotasks();
    socket.open();
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
