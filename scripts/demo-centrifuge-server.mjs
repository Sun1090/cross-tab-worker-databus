import { createHash, randomUUID } from 'node:crypto';

export const demoWebSocketPath = '/centrifuge/demo/connection/websocket';

/**
 * Minimal Centrifugo-compatible WebSocket server for the bundled demo.
 *
 * The bundled demo page connects its real `centrifuge` client here when the
 * user picks the "本地演示" preset. Only the JSON protocol subset used by the
 * demo is implemented: connect, subscribe, unsubscribe, publish, ping and
 * disconnect commands, plus publication pushes and periodic server pings.
 */
export function installDemoWebSocketServer(httpServer, pathname = demoWebSocketPath) {
  const hub = new DemoCentrifugeHub();
  httpServer.on('upgrade', (request, socket, head) => {
    // Another upgrade listener (e.g. the WebSocket-bus demo server) may own
    // this path — stay silent so it can claim the socket.
    if (request.url !== pathname) return;
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const ws = new DemoWebSocketConnection(socket, head);
    hub.attach(ws);
    ws.onMessage(text => hub.handleCommands(ws, text));
    ws.onClose(() => hub.detach(ws));
  });
  return hub;
}

export class DemoCentrifugeHub {
  constructor() {
    /** @type {Set<DemoWebSocketConnection>} */
    this.clients = new Set();
    /** @type {Map<string, { epoch: string; offset: number; subscriptions: Set<string> }>} */
    this.channels = new Map();
    this.pingTimer = null;
  }

  attach(connection) {
    this.clients.add(connection);
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => this.pingClients(), 25000);
      this.pingTimer.unref?.();
    }
  }

  detach(connection) {
    this.clients.delete(connection);
    for (const [channel, state] of this.channels) {
      state.subscriptions.delete(connection.id);
      if (state.subscriptions.size === 0) this.channels.delete(channel);
    }
    if (this.clients.size === 0 && this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  handleCommands(connection, text) {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let command;
      try {
        command = JSON.parse(trimmed);
      } catch {
        continue;
      }
      this.handleCommand(connection, command);
    }
  }

  handleCommand(connection, command) {
    const id = command.id;
    if (command.connect) {
      connection.client = randomUUID();
      connection.session = randomUUID();
      connection.node = 'demo-centrifugo';
      connection.sendReply(id, {
        connect: {
          client: connection.client,
          session: connection.session,
          node: connection.node,
          ping: 25,
          pong: true,
          expires: false
        }
      });
      return;
    }
    if (command.ping) {
      connection.sendReply(id, {});
      return;
    }
    if (command.subscribe) {
      const channel = String(command.subscribe.channel ?? '');
      const state = this.ensureChannel(channel);
      connection.subscribe(channel);
      state.subscriptions.add(connection.id);
      connection.sendReply(id, {
        subscribe: { epoch: state.epoch, offset: state.offset }
      });
      return;
    }
    if (command.unsubscribe) {
      const channel = String(command.unsubscribe.channel ?? '');
      connection.unsubscribe(channel);
      this.channels.get(channel)?.subscriptions.delete(connection.id);
      connection.sendReply(id, {});
      return;
    }
    if (command.publish) {
      const channel = String(command.publish.channel ?? '');
      const data = command.publish.data;
      const state = this.ensureChannel(channel);
      state.offset += 1;
      this.broadcast(channel, { channel, pub: { data, offset: state.offset, tags: { demo: '1' } } });
      connection.sendReply(id, {});
      return;
    }
    if (command.disconnect) {
      connection.close(1000, 'disconnect requested');
    }
  }

  ensureChannel(channel) {
    let state = this.channels.get(channel);
    if (!state) {
      state = { epoch: randomUUID(), offset: 0, subscriptions: new Set() };
      this.channels.set(channel, state);
    }
    return state;
  }

  broadcast(channel, push) {
    const state = this.channels.get(channel);
    if (!state) return;
    for (const connection of this.clients) {
      if (state.subscriptions.has(connection.id)) {
        connection.sendPush(push);
      }
    }
  }

  pingClients() {
    for (const connection of this.clients) {
      connection.sendPush({});
    }
  }
}

export class DemoWebSocketConnection {
  constructor(socket, bufferedHead) {
    this.id = randomUUID();
    this.socket = socket;
    this.buffer = bufferedHead ?? Buffer.alloc(0);
    this.client = '';
    this.session = '';
    this.node = '';
    this.channels = new Set();
    this.textBuffer = '';
    this.messageHandlers = [];
    this.closeHandlers = [];
    socket.setNoDelay(true);
    socket.on('data', chunk => this.handleData(chunk));
    socket.on('close', () => this.notifyClose());
    socket.on('error', () => this.notifyClose());
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  onClose(handler) {
    this.closeHandlers.push(handler);
  }

  subscribe(channel) {
    this.channels.add(channel);
  }

  unsubscribe(channel) {
    this.channels.delete(channel);
  }

  sendReply(id, result) {
    this.sendText(JSON.stringify(id ? { id, ...result } : { ...result }));
  }

  sendPush(push) {
    this.sendText(JSON.stringify({ push }));
  }

  sendText(text) {
    this.writeFrame(0x1, Buffer.from(text, 'utf8'));
  }

  close(code, reason) {
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason ?? '', 'utf8'));
    payload.writeUInt16BE(code ?? 1000, 0);
    payload.write(reason ?? '', 2, 'utf8');
    this.writeFrame(0x8, payload);
    this.socket.end();
  }

  writeFrame(opcode, payload) {
    if (this.socket.destroyed) return;
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let offset = 0;
    while (offset < this.buffer.length) {
      const first = this.buffer[offset];
      const second = this.buffer[offset + 1];
      if (second === undefined) return;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let cursor = offset + 2;
      if (length === 126) {
        if (cursor + 2 > this.buffer.length) return;
        length = this.buffer.readUInt16BE(cursor);
        cursor += 2;
      } else if (length === 127) {
        if (cursor + 8 > this.buffer.length) return;
        length = Number(this.buffer.readBigUInt64BE(cursor));
        cursor += 8;
      }
      let mask;
      if (masked) {
        if (cursor + 4 > this.buffer.length) return;
        mask = this.buffer.subarray(cursor, cursor + 4);
        cursor += 4;
      }
      if (cursor + length > this.buffer.length) return;
      const payload = Buffer.from(this.buffer.subarray(cursor, cursor + length));
      if (masked) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index & 3];
        }
      }
      offset = cursor + length;
      this.handleFrame(opcode, payload);
    }
    this.buffer = offset === 0 ? this.buffer : this.buffer.subarray(offset);
  }

  handleFrame(opcode, payload) {
    if (opcode === 0x1) {
      this.textBuffer += payload.toString('utf8');
      // Commands are newline-delimited JSON, but a batch may arrive without a
      // trailing newline (a single command is exactly one line). handleData
      // already buffers partial frames, so this payload is a complete frame:
      // process every newline-delimited line, then release the remaining line
      // so a single command without a trailing newline is not stuck forever.
      let newlineIndex;
      while ((newlineIndex = this.textBuffer.indexOf('\n')) !== -1) {
        const line = this.textBuffer.slice(0, newlineIndex);
        this.textBuffer = this.textBuffer.slice(newlineIndex + 1);
        if (line.trim()) {
          for (const handler of this.messageHandlers) handler(line);
        }
      }
      if (this.textBuffer.trim()) {
        const line = this.textBuffer;
        this.textBuffer = '';
        for (const handler of this.messageHandlers) handler(line);
      }
      return;
    }
    if (opcode === 0x8) {
      this.socket.end();
      return;
    }
    if (opcode === 0x9) {
      this.writeFrame(0xa, payload);
    }
  }

  notifyClose() {
    for (const handler of this.closeHandlers) handler();
    this.messageHandlers = [];
    this.closeHandlers = [];
  }
}
