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
    // Connection-count observability: lets the e2e suite verify that the
    // SharedWorker session reaper actually closes a dead tab's WebSocket.
    if (pathname === '/debug/connections') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ centrifugo: centrifugoHub?.clients.size ?? 0 }));
      return;
    }
    // Frame-count observability for the WebSocket-bus hub: lets the e2e suite
    // assert that `publishBatch` travelled as one wire frame and did not
    // decompose into per-item `publish` frames.
    if (pathname === '/debug/wsstats') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({
        publish: wsHub?.publishFrames ?? 0,
        publishBatch: wsHub?.publishBatchFrames ?? 0
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
