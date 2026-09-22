import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDemoWebSocketServer } from './demo-centrifuge-server.mjs';
import { installDemoWsBusServer } from './demo-ws-server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const demoWebSocketPath = '/centrifuge/demo/connection/websocket';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ts': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    let filePath = normalize(join(root, pathname === '/' ? '/examples/demo/' : pathname));
    // `startsWith(root)` is bypassed by normalized traversal (e.g. `/../src/`),
    // so compare the resolved path relative to root instead.
    if (relative(root, filePath).startsWith('..')) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }
    // Socket observability for the e2e suite: which WebSocket connections the
    // demo server holds, each with its id and the channels it subscribes.
    // `centrifugo` is the *global* total and is not a per-test observable — the
    // suite runs specs in parallel, so every other live tab is inside that number,
    // and a shared cluster only subscribes the channel on its owner's transport, so
    // a pair of tabs can show one channel-carrying socket and one with none. Address
    // a test's own connections through `details[].channels`, whose names come from
    // `uniqueTopic()`.
    if (pathname === '/debug/connections') {
      const clients = centrifugoHub ? [...centrifugoHub.clients] : [];
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({
        centrifugo: clients.length,
        details: clients.map(connection => ({
          id: connection.id,
          ageMs: Math.max(0, Date.now() - connection.openedAtMs),
          channels: [...connection.channels].sort()
        }))
      }));
      return;
    }
    // Channel subscription counts on the Centrifugo hub: lets the e2e suite gate
    // on the transport's server-side state. A cluster snapshot reports the
    // client's intent, which updates before the subscribe frame has landed, so a
    // test that publishes on that promise races the publication past a channel
    // with no subscriber yet and loses it (at-most-once, as documented).
    if (pathname === '/debug/channels') {
      const channels = centrifugoHub
        ? Object.fromEntries(
            [...centrifugoHub.channels].map(([channel, state]) => [channel, state.subscriptions.size])
          )
        : {};
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ channels }));
      return;
    }
    // Frame-count observability for the WebSocket-bus hub: lets the e2e suite
    // assert that `publishBatch` travelled as one wire frame and did not
    // decompose into per-item `publish` frames. The per-topic breakdown lets a
    // test assert its own session's frames without racing concurrent tests
    // that share this hub on a parallel local run.
    if (pathname === '/debug/wsstats') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({
        publish: wsHub?.publishFrames ?? 0,
        publishBatch: wsHub?.publishBatchFrames ?? 0,
        topics: Object.fromEntries(wsHub?.topicFrames ?? new Map())
      }));
      return;
    }
    const stats = await stat(filePath);
    if (stats.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream'
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  }
});

let centrifugoHub;
let wsHub;
wsHub = installDemoWsBusServer(server, '/ws/demo');
centrifugoHub = installDemoWebSocketServer(server, demoWebSocketPath);

server.listen(port, () => {
  console.log(`Examples server: http://localhost:${port}/examples/demo/`);
  console.log(`Demo Centrifugo endpoint: ws://localhost:${port}${demoWebSocketPath}`);
  console.log(`Demo WebSocket-bus endpoint: ws://localhost:${port}/ws/demo`);
  console.log(`Open the URL in multiple browser tabs to observe cross-tab data flow.`);
});
