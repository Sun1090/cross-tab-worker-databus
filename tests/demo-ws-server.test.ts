import { describe, expect, it } from 'vitest';
import { DemoWebSocketConnection } from '../scripts/demo-centrifuge-server.mjs';
import {
  DemoWsBusHub,
  matchesDemoTopic
} from '../scripts/demo-ws-server.mjs';

class FakeSocket {
  destroyed = false;
  written: Buffer[] = [];
  closed = false;

  setNoDelay() {}

  write(data: Buffer) {
    if (!this.destroyed) this.written.push(data);
    return true;
  }

  end() {
    this.closed = true;
    this.destroyed = true;
  }

  destroy() {
    this.destroyed = true;
  }

  on() {}
}

class FakeConnection extends DemoWebSocketConnection {
  constructor() {
    super(new FakeSocket(), Buffer.alloc(0));
  }

  get messages(): string[] {
    const socket = this.socket as unknown as FakeSocket;
    return socket.written.map(frame => decodeTextFrame(frame));
  }

  sendFrame(command: unknown) {
    this.handleData(encodeTextFrame(`${JSON.stringify(command)}\n`));
  }
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x81, 0x80 | length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = (masked[index] ?? 0) ^ (mask[index & 3] ?? 0);
  }
  return Buffer.concat([header, mask, masked]);
}

function decodeTextFrame(frame: Buffer): string {
  const first = frame[0]!;
  const opcode = first & 0x0f;
  if (opcode !== 0x1) throw new Error(`unexpected opcode ${opcode}`);
  const second = frame[1]!;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let cursor = 2;
  if (length === 126) {
    length = frame.readUInt16BE(cursor);
    cursor += 2;
  } else if (length === 127) {
    length = Number(frame.readBigUInt64BE(cursor));
    cursor += 8;
  }
  if (masked) cursor += 4;
  return frame.subarray(cursor, cursor + length).toString('utf8');
}

describe('DemoWsBusHub protocol', () => {
  it('fans publications out to exact and wildcard subscribers, including the sender', () => {
    const hub = new DemoWsBusHub({ now: () => 42 });
    const sender = new FakeConnection();
    const exact = new FakeConnection();
    const wildcard = new FakeConnection();
    hub.attach(sender);
    hub.attach(exact);
    hub.attach(wildcard);

    sender.sendFrame({ op: 'subscribe', topic: 'chat.*' });
    exact.sendFrame({ op: 'subscribe', topic: 'chat.room.1' });
    wildcard.sendFrame({ op: 'subscribe', topic: 'unrelated' });

    sender.sendFrame({ op: 'publish', topic: 'chat.room.1', data: { n: 1 } });

    // The sender echoes (like the Centrifuge demo) and the exact subscriber
    // receives; the unrelated subscriber gets nothing.
    const expected = JSON.stringify({
      op: 'publication',
      publication: { topic: 'chat.room.1', data: { n: 1 }, timestamp: 42 }
    });
    expect(sender.messages).toEqual([expected]);
    expect(exact.messages).toEqual([expected]);
    expect(wildcard.messages).toEqual([]);
  });

  it('unsubscribe stops delivery and the matcher respects segment boundaries', () => {
    const hub = new DemoWsBusHub({ now: () => 42 });
    const client = new FakeConnection();
    hub.attach(client);
    client.sendFrame({ op: 'subscribe', topic: 'chat.*' });
    client.sendFrame({ op: 'publish', topic: 'chat.room.1', data: 1 });
    client.sendFrame({ op: 'unsubscribe', topic: 'chat.*' });
    client.sendFrame({ op: 'publish', topic: 'chat.room.2', data: 2 });

    expect(client.messages).toEqual([JSON.stringify({
      op: 'publication',
      publication: { topic: 'chat.room.1', data: 1, timestamp: 42 }
    })]);
  });

  it('ignores malformed and unknown frames without disconnecting', () => {
    const hub = new DemoWsBusHub({ now: () => 42 });
    const client = new FakeConnection();
    hub.attach(client);

    expect(hub.handleFrame(client, '{broken')).toBe(false);
    expect(hub.handleFrame(client, JSON.stringify({ op: 'ping' }))).toBe(false);
    expect(hub.handleFrame(client, JSON.stringify({ op: 'publish', data: 1 }))).toBe(false);

    // The connection still works afterwards.
    client.sendFrame({ op: 'subscribe', topic: 't' });
    client.sendFrame({ op: 'publish', topic: 't', data: 'ok' });
    expect(client.messages).toEqual([JSON.stringify({
      op: 'publication',
      publication: { topic: 't', data: 'ok', timestamp: 42 }
    })]);
  });

  it('echoes caller metadata through the canonical publication envelope', () => {
    const hub = new DemoWsBusHub({ now: () => 99 });
    const client = new FakeConnection();
    hub.attach(client);
    client.sendFrame({ op: 'subscribe', topic: 't' });
    client.sendFrame({ op: 'publish', topic: 't', data: 1, messageId: 'm-1', timestamp: 42 });
    expect(client.messages).toEqual([JSON.stringify({
      op: 'publication',
      publication: { topic: 't', data: 1, messageId: 'm-1', timestamp: 42 }
    })]);
  });

  it('drops detached clients from the fan-out set', () => {
    const hub = new DemoWsBusHub();
    const client = new FakeConnection();
    hub.attach(client);
    hub.detach(client);
    client.sendFrame({ op: 'subscribe', topic: 't' });
    hub.publish('t', 1);
    expect(client.messages).toEqual([]);
  });
});

describe('matchesDemoTopic parity with topicMatchesPattern', () => {
  const cases: Array<[string, string, boolean]> = [
    ['chat.*', 'chat.room.1', true],
    ['chat.*', 'chatter.1', false],
    ['chat.room.*', 'chat.room.1', true],
    ['*', 'anything', true],
    ['chat.room.1', 'chat.room.1', true],
    ['chat.room.1', 'chat.room.2', false],
    ['', '', false],
    ['chat.*', '', false]
  ];
  for (const [pattern, topic, expected] of cases) {
    it(`${JSON.stringify(pattern)} vs ${JSON.stringify(topic)} -> ${expected}`, () => {
      expect(matchesDemoTopic(pattern, topic)).toBe(expected);
    });
  }
});
