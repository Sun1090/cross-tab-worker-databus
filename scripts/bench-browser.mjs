import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const port = Number(process.env.PORT || 4173);
const baseUrl = `http://localhost:${port}/examples/demo/`;
const wsUrl = `ws://localhost:${port}/centrifuge/demo/connection/websocket`;
const messages = Number(process.env.BENCH_MESSAGES || 100);
const modes = (process.env.BENCH_MODES || 'dedicated,shared').split(',').map(value => value.trim()).filter(Boolean);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function openTab(context, mode, topic) {
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.locator('#statusBadge').getByText('已连接').waitFor();
  await page.selectOption('#endpointPreset', 'local');
  await page.fill('#urlInput', wsUrl);
  await page.selectOption('#workerMode', mode);
  await page.fill('#topicInput', topic);
  await page.click('#applyConnection');
  await page.locator('#statusBadge').getByText('已连接').waitFor();
  return page;
}

async function runMode(browser, mode) {
  const context = await browser.newContext();
  const topic = `bench.publish.${mode}.${Date.now()}`;
  const publisher = await openTab(context, mode, topic);
  const receiver = await openTab(context, mode, topic);
  await receiver.waitForTimeout(250);

  const start = performance.now();
  for (let index = 0; index < messages; index += 1) {
    await publisher.locator('#publishJson').click();
  }
  await receiver.waitForFunction(expected => Number(document.querySelector('#metricReceived')?.textContent) >= expected, messages, {
    timeout: 30_000
  });
  const elapsedMs = performance.now() - start;

  const result = {
    mode,
    messages,
    totalMs: Number(elapsedMs.toFixed(2)),
    perMessageMs: Number((elapsedMs / messages).toFixed(4)),
    receiverCount: Number(await receiver.locator('#metricReceived').textContent())
  };
  await context.close();
  return result;
}

/** Run the data-bus hot-path matrix inside a real browser page using the
 * built ESM bundle. Mirrors tests/bench/data-bus.bench.ts so local (Node)
 * and browser numbers can be compared side by side. */
async function runDatabusMatrix(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl);
  const results = await page.evaluate(async () => {
    const { CrossTabDataBus } = await import('/dist/index.js');
    const { createBrowserEnvironment } = await import('/dist/index.js');

    function makeStubTransport() {
      let handlers = null;
      return {
        start: (_config, h) => {
          handlers = h;
          h.onStatus('connected');
        },
        subscribe() {},
        unsubscribe() {},
        publish() {},
        stop() {},
        emit(topic, data, messageId) {
          handlers?.onMessage({ topic, data, ...(messageId ? { messageId } : {}) });
        }
      };
    }

    const timings = {};

    {
      const transport = makeStubTransport();
      const bus = new CrossTabDataBus({
        clusterKey: 'bench-browser-wildcard',
        environment: createBrowserEnvironment(),
        initialConfig: {},
        transport
      });
      bus.subscribe('bench.rooms.*', () => {});
      const start = performance.now();
      for (let index = 0; index < 1000; index += 1) {
        transport.emit(`bench.rooms.room-${index % 100}`, { value: index });
      }
      timings.wildcardDispatch1000Ms = Number((performance.now() - start).toFixed(2));
      await bus.stop();
    }

    {
      const transport = makeStubTransport();
      const bus = new CrossTabDataBus({
        clusterKey: 'bench-browser-batch',
        environment: createBrowserEnvironment(),
        initialConfig: {},
        transport
      });
      bus.subscribe('bench.batch', () => {});
      const start = performance.now();
      for (let round = 0; round < 10; round += 1) {
        bus.publishBatch('bench.batch', Array.from({ length: 100 }, (_, index) => ({ data: { value: round * 100 + index } })));
      }
      timings.publishBatch1000Ms = Number((performance.now() - start).toFixed(2));
      await bus.stop();
    }

    {
      const transport = makeStubTransport();
      const bus = new CrossTabDataBus({
        clusterKey: 'bench-browser-dedup',
        environment: createBrowserEnvironment(),
        initialConfig: {},
        transport,
        dedup: { maxEntries: 2000, ttlMs: 60_000, now: () => 1000 }
      });
      bus.subscribe('bench.dedup', () => {});
      const start = performance.now();
      for (let index = 0; index < 1000; index += 1) {
        transport.emit('bench.dedup', { value: index }, `message-${index % 500}`);
      }
      timings.dedup1000Ms = Number((performance.now() - start).toFixed(2));
      await bus.stop();
    }

    {
      const events = [];
      const bus = new CrossTabDataBus({
        clusterKey: 'bench-browser-trace',
        environment: createBrowserEnvironment(),
        initialConfig: {},
        transport: makeStubTransport(),
        trace: { enabled: true, mode: 'events', asyncSink: true, sink: event => events.push(event) }
      });
      await bus.ready();
      const start = performance.now();
      for (let index = 0; index < 1000; index += 1) {
        bus.onStatus(() => {});
        bus.publish('bench.trace', { value: index });
      }
      timings.traceAndPublish1000Ms = Number((performance.now() - start).toFixed(2));
      await bus.stop();
    }

    const userAgent = navigator.userAgent;
    return { userAgent, timings };
  });
  await context.close();
  return results;
}

let server;
let ownsServer = false;

try {
  try {
    const response = await fetch(baseUrl);
    if (!response.ok) throw new Error('unhealthy');
  } catch {
    ownsServer = true;
    server = spawn(process.execPath, ['scripts/serve-examples.mjs'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) }
    });
    server.stdout.on('data', chunk => process.stdout.write(`[demo] ${chunk}`));
    server.stderr.on('data', chunk => process.stderr.write(`[demo] ${chunk}`));
    await waitForServer();
  }
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  try {
    const results = [];
    for (const mode of modes) results.push(await runMode(browser, mode));
    const databus = await runDatabusMatrix(browser);
    console.log(JSON.stringify({ benchmark: 'browser-publish', generatedAt: new Date().toISOString(), results, databus }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  if (ownsServer) server.kill('SIGTERM');
}
