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

installDemoWebSocketServer(server, demoWebSocketPath);
installDemoWsBusServer(server, '/ws/demo');

server.listen(port, () => {
  console.log(`Examples server: http://localhost:${port}/examples/demo/`);
  console.log(`Demo Centrifugo endpoint: ws://localhost:${port}${demoWebSocketPath}`);
console.log(`Demo WebSocket-bus endpoint: ws://localhost:${port}/ws/demo`);
  console.log(`Open the URL in multiple browser tabs to observe cross-tab data flow.`);
});
