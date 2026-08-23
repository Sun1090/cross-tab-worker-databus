import { describe, expect, it } from 'vitest';
import { DemoCentrifugeHub, DemoWebSocketConnection } from '../scripts/demo-centrifuge-server.mjs';

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
  constructor(hub: DemoCentrifugeHub) {
    super(new FakeSocket(), Buffer.alloc(0));
    this.onMessage(text => hub.handleCommands(this, text));
  }

  get messages(): string[] {
    const socket = this.socket as unknown as FakeSocket;
    return socket.written.map(frame => decodeTextFrame(frame));
  }

  sendCommand(command: unknown) {
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

describe('DemoCentrifugeHub protocol', () => {
  it('answers connect, subscribe, publish and pings with Centrifuge JSON replies', () => {
    const hub = new DemoCentrifugeHub();
    const connection = new FakeConnection(hub);
    hub.attach(connection);

    connection.sendCommand({ id: 1, connect: {} });
    const connect = JSON.parse(connection.messages.at(-1)!);
    expect(connect.id).toBe(1);
    expect(connect.connect.client).toMatch(/^[0-9a-f-]{36}$/);
    expect(connect.connect.ping).toBe(25);
    expect(connect.connect.pong).toBe(true);

    connection.sendCommand({ id: 2, subscribe: { channel: 'demo.flow' } });
    const subscribe = JSON.parse(connection.messages.at(-1)!);
    expect(subscribe.id).toBe(2);
    expect(subscribe.subscribe.epoch).toMatch(/^[0-9a-f-]{36}$/);
    expect(subscribe.subscribe.offset).toBe(0);

    connection.sendCommand({ id: 3, publish: { channel: 'demo.flow', data: { hello: 1 } } });
    const publish = JSON.parse(connection.messages.at(-1)!);
    expect(publish.id).toBe(3);

    connection.sendCommand({ id: 4, ping: {} });
    const ping = JSON.parse(connection.messages.at(-1)!);
    expect(ping.id).toBe(4);
  });

  it('delivers publications to every subscribed client including the publisher', () => {
    const hub = new DemoCentrifugeHub();
    const first = new FakeConnection(hub);
    const second = new FakeConnection(hub);
    hub.attach(first);
    hub.attach(second);
    const connections: [FakeConnection, FakeConnection] = [first, second];
    for (const connection of connections) {
      connection.sendCommand({ id: 1, connect: {} });
      connection.sendCommand({ id: 2, subscribe: { channel: 'demo.flow' } });
    }

    first.sendCommand({ id: 3, publish: { channel: 'demo.flow', data: { from: 'tab-a' } } });

    const firstPushes = first.messages
      .map(text => JSON.parse(text))
      .filter(message => message.push?.pub?.data?.from === 'tab-a');
    const secondPushes = second.messages
      .map(text => JSON.parse(text))
      .filter(message => message.push?.pub?.data?.from === 'tab-a');
    expect(firstPushes).toHaveLength(1);
    expect(secondPushes).toHaveLength(1);
    expect(secondPushes[0].push.pub.offset).toBe(1);
  });

  it('keeps publications scoped to the subscribed channel', () => {
    const hub = new DemoCentrifugeHub();
    const connection = new FakeConnection(hub);
    hub.attach(connection);
    connection.sendCommand({ id: 1, connect: {} });
    connection.sendCommand({ id: 2, subscribe: { channel: 'other.topic' } });
    connection.sendCommand({ id: 3, publish: { channel: 'demo.flow', data: 1 } });

    const pushes = connection.messages
      .map(text => JSON.parse(text))
      .filter(message => message.push?.pub);
    expect(pushes).toHaveLength(0);
  });

  it('parses multiple newline-delimited commands from one text frame', () => {
    const hub = new DemoCentrifugeHub();
    const connection = new FakeConnection(hub);
    hub.attach(connection);

    hub.handleCommands(
      connection,
      `${JSON.stringify({ id: 1, connect: {} })}\n${JSON.stringify({ id: 2, ping: {} })}\n`
    );

    const replies = connection.messages.map(text => JSON.parse(text));
    expect(replies.map(reply => reply.id)).toEqual([1, 2]);
  });

  it('processes a single command frame without a trailing newline', () => {
    // The real centrifuge client sends one command per batch, joined by '\n'
    // without a trailing newline. The previous "wait for a newline" buffering
    // never released such a frame, so the client timed out waiting for the
    // connect reply (observed as a multi-tab E2E failure for non-owner tabs).
    const hub = new DemoCentrifugeHub();
    const connection = new FakeConnection(hub);
    hub.attach(connection);

    connection.handleData(encodeTextFrame(JSON.stringify({ id: 1, connect: {} })));

    const replies = connection.messages.map(text => JSON.parse(text));
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe(1);
    expect(replies[0].connect.client).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('buffers a command split across multiple frames', () => {
    const hub = new DemoCentrifugeHub();
    const connection = new FakeConnection(hub);
    hub.attach(connection);

    // A frame split across TCP chunks: handleData must hold the partial frame
    // until the rest arrives, then release it as one newline-delimited batch.
    const frame = encodeTextFrame(`${JSON.stringify({ id: 7, connect: {} })}\n`);
    connection.handleData(frame.subarray(0, 10));
    expect(connection.messages).toHaveLength(0);
    connection.handleData(frame.subarray(10));
    const replies = connection.messages.map(text => JSON.parse(text));
    expect(replies.map(reply => reply.id)).toEqual([7]);
  });
});
