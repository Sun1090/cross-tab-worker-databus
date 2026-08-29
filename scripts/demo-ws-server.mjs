import { createHash } from 'node:crypto';
import { DemoWebSocketConnection } from './demo-centrifuge-server.mjs';

export const demoWsBusPath = '/ws/demo';

/**
 * Minimal WebSocket-bus demo server speaking the frame protocol implemented
 * by `src/websocket.ts` (WebSocketTransport):
 *
 * - client → server: {"op":"subscribe"|"unsubscribe"|"publish","topic":...,"data":...}
 * - server → client: {"topic":...,"data":...} for publications
 *
 * Publications fan out to every connection whose subscriptions (exact topics
 * or wildcards) match the published topic, including the sender, mirroring
 * the Centrifuge demo's echo behaviour.
 */
export function installDemoWsBusServer(httpServer, pathname = demoWsBusPath) {
  const hub = new DemoWsBusHub();
  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== pathname) return;
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    // DemoWebSocketConnection speaks WebSocket frames only — the HTTP
    // upgrade handshake happens here before handing the raw socket over.
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    hub.attach(new DemoWebSocketConnection(socket, head));
  });
  return hub;
}

/** Same matching rules as `topicMatchesPattern` in src/core/routing.ts:
 * `*` matches everything; `prefix.*` matches by segment-boundary prefix.
 * Duplicated here (plain .mjs cannot import the TS module) — the contract
 * test asserts parity for the cases the demo relies on. */
export function matchesDemoTopic(pattern, topic) {
  if (!pattern || !topic) return false;
  if (pattern === topic) return true;
  if (pattern === '*') return true;
  if (!pattern.endsWith('.*')) return false;
  return topic.startsWith(pattern.slice(0, -1));
}

export class DemoWsBusHub {
  constructor() {
    /** @type {Set<DemoWebSocketConnection>} */
    this.clients = new Set();
    /** @type {Map<DemoWebSocketConnection, Set<string>>} subscription patterns per client */
    this.subscriptions = new Map();
  }

  attach(connection) {
    this.clients.add(connection);
    this.subscriptions.set(connection, new Set());
    connection.onMessage(text => this.handleFrame(connection, text));
    connection.onClose(() => this.detach(connection));
  }

  detach(connection) {
    this.clients.delete(connection);
    this.subscriptions.delete(connection);
  }

  /** @returns {boolean} true when the frame was understood. */
  handleFrame(connection, text) {
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return false;
    }
    if (!frame || typeof frame !== 'object' || typeof frame.topic !== 'string') return false;
    const topics = this.subscriptions.get(connection);
    if (!topics) return false;
    switch (frame.op) {
      case 'subscribe':
        topics.add(frame.topic);
        return true;
      case 'unsubscribe':
        topics.delete(frame.topic);
        return true;
      case 'publish':
        this.publish(frame.topic, frame.data);
        return true;
      default:
        return false;
    }
  }

  /** Fan a publication out to every subscriber whose subscriptions match. */
  publish(topic, data) {
    const frame = JSON.stringify({ topic, data });
    for (const client of [...this.clients]) {
      const topics = this.subscriptions.get(client);
      if (!topics) continue;
      for (const pattern of topics) {
        if (matchesDemoTopic(pattern, topic)) {
          client.sendText(frame);
          break;
        }
      }
    }
  }
}
