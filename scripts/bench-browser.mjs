/**
 * Browser benchmark: measures the publish hot path and the data-bus matrix in a
 * real Chromium page against the built ESM bundle.
 *
 * The runtime body lives in `main()`, guarded by an `invokedDirectly` check, so
 * the pure `parseBenchEnv` can be imported and tested without spawning a server
 * or launching a browser. (The module previously ran everything at import time.)
 *
 * Usage: node scripts/bench-browser.mjs
 *   PORT=4173 BENCH_MESSAGES=100 BENCH_MODES=dedicated,shared
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const DEFAULT_PORT = 4173;
const DEFAULT_MESSAGES = 100;
const WORKER_MODES = ['dedicated', 'shared'];

function parseInteger(raw, fallback, name, min, max) {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  const bounds = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
    throw new TypeError(`${name} must be an integer ${bounds}, got "${raw}"`);
  }
  return value;
}

/**
 * Parse and validate the benchmark's environment inputs.
 *
 * Pure and exported so it can be tested without launching a browser. These were
 * previously `Number(...)`-coerced with no validation, so a typo produced a
 * meaningless run instead of an error:
 *  - `BENCH_MESSAGES=abc` became `NaN`, the publish loop never executed, and the
 *    run died on a 30s `waitForFunction` timeout with no hint of the cause.
 *  - `BENCH_MESSAGES=0` made `perMessageMs` `0/0` — a `NaN` that
 *    `JSON.stringify` archives as `null`, poisoning the trend comparison.
 *  - `BENCH_MODES=,` (only separators) silently ran *zero* modes and archived an
 *    empty `results` array, so `bench:compare` had nothing to compare while
 *    still reporting OK. A genuinely empty value still means "use the default".
 *  - `PORT=abc` produced `http://localhost:NaN/...` and a server that failed to
 *    listen, far from the actual mistake.
 */
export function parseBenchEnv(env = process.env) {
  const port = parseInteger(env.PORT, DEFAULT_PORT, 'PORT', 1, 65_535);
  const messages = parseInteger(env.BENCH_MESSAGES, DEFAULT_MESSAGES, 'BENCH_MESSAGES', 1);
  // An empty/whitespace value means "unset" and falls back to the defaults, the
  // same way the old `process.env.BENCH_MODES || 'dedicated,shared'` behaved.
  // A value that is only separators (e.g. ",") is *not* empty and is rejected
  // below, so a mis-typed list never silently runs zero modes.
  const rawModes = env.BENCH_MODES?.trim() ? env.BENCH_MODES : WORKER_MODES.join(',');
  const modes = rawModes
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (modes.length === 0) {
    throw new TypeError(`BENCH_MODES must list at least one worker mode (${WORKER_MODES.join(', ')}), got "${rawModes}"`);
  }
  for (const mode of modes) {
    if (!WORKER_MODES.includes(mode)) {
      throw new TypeError(`BENCH_MODES contains an unknown worker mode "${mode}"; expected ${WORKER_MODES.join(' or ')}`);
    }
  }
  return {
    port,
    messages,
    modes,
    baseUrl: `http://localhost:${port}/examples/demo/`,
    wsUrl: `ws://localhost:${port}/centrifuge/demo/connection/websocket`
  };
}

async function waitForServer(baseUrl) {
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

async function openTab({ baseUrl, wsUrl }, context, mode, topic) {
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

async function runMode(env, browser, mode) {
  const { messages } = env;
  const context = await browser.newContext();
  const topic = `bench.publish.${mode}.${Date.now()}`;
  const publisher = await openTab(env, context, mode, topic);
  const receiver = await openTab(env, context, mode, topic);
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
async function runDatabusMatrix(baseUrl, browser) {
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

    // A stub whose publish() echoes the message back as if the server
    // delivered it — mirrors the demo server's echo, so the publishBatch case
    // measures the full round-trip (route → publish → dispatch) rather than
    // the publish call being a no-op.
    function makeEchoTransport() {
      const transport = makeStubTransport();
      const originalStart = transport.start;
      let busStarted = false;
      transport.start = (_config, h) => {
        originalStart(_config, h);
        busStarted = true;
      };
      transport.publish = (topic, data) => {
        if (busStarted) transport.emit(topic, data);
      };
      return transport;
    }

    const timings = {};

    // Auto-start defers transport.start to a microtask and the cluster assigns
    // the route over a BroadcastChannel round-trip. ready() covers the first;
    // this bounded poll covers the second so the emit-based cases measure real
    // dispatch instead of the not-assigned discard path (or hanging forever).
    async function ensureAssigned(bus, topicOrPattern) {
      for (let attempt = 0; attempt < 200 && !bus.getClusterSnapshot().assignedTopics.includes(topicOrPattern); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }

    {
      const transport = makeStubTransport();
      const bus = new CrossTabDataBus({
        clusterKey: 'bench-browser-wildcard',
        environment: createBrowserEnvironment(),
        initialConfig: {},
        transport
      });
      let dispatched = 0;
      bus.subscribe('bench.rooms.*', () => {
        dispatched += 1;
      });
      await bus.ready();
      await ensureAssigned(bus, 'bench.rooms.*');
      const start = performance.now();
      for (let index = 0; index < 1000; index += 1) {
        transport.emit(`bench.rooms.room-${index % 100}`, { value: index });
      }
      timings.wildcardDispatch1000Ms = Number((performance.now() - start).toFixed(2));
      // Guard: the measurement is only meaningful if every emission actually
      // reached the handler (otherwise the bus was measuring a no-op path).
      if (dispatched !== 1000) throw new Error(`wildcard dispatch mis-measured: ${dispatched}/1000`);
      await bus.stop();
    }

    {
      const transport = makeEchoTransport();
      const bus = new CrossTabDataBus({
        clusterKey: 'bench-browser-batch',
        environment: createBrowserEnvironment(),
        initialConfig: {},
        transport
      });
      let dispatched = 0;
      bus.subscribe('bench.batch', () => {
        dispatched += 1;
      });
      await bus.ready();
      await ensureAssigned(bus, 'bench.batch');
      const start = performance.now();
      for (let round = 0; round < 10; round += 1) {
        bus.publishBatch('bench.batch', Array.from({ length: 100 }, (_, index) => ({ data: { value: round * 100 + index } })));
      }
      timings.publishBatch1000Ms = Number((performance.now() - start).toFixed(2));
      // The echo stub round-trips each item back into the bus, so exactly 1000
      // items must reach the handler for the measurement to be meaningful.
      if (dispatched !== 1000) throw new Error(`publishBatch mis-measured: ${dispatched}/1000 dispatched`);
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
      await bus.ready();
      await ensureAssigned(bus, 'bench.dedup');
      let dispatched = 0;
      bus.subscribe('bench.dedup', () => {
        dispatched += 1;
      });
      const start = performance.now();
      for (let index = 0; index < 1000; index += 1) {
        transport.emit('bench.dedup', { value: index }, `message-${index % 500}`);
      }
      timings.dedup1000Ms = Number((performance.now() - start).toFixed(2));
      // 500 unique IDs each emitted twice: dedup must deliver exactly 500.
      if (dispatched !== 500) throw new Error(`dedup mis-measured: ${dispatched}/500 delivered`);
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

    {
      // First-packet latency floor: subscribe → first transport emission →
      // handler invocation, including any lazy dispatch setup on the cold path.
      // The cluster assigns the route asynchronously (localStorage + channel
      // round-trip), so wait for the local assignment before emitting — the
      // emission itself is the measured cold dispatch.
      const transport = makeStubTransport();
      let markFirst = null;
      const first = new Promise(resolve => {
        markFirst = resolve;
      });
      const bus = new CrossTabDataBus({
        clusterKey: 'bench-browser-firstpacket',
        environment: createBrowserEnvironment(),
        initialConfig: {},
        transport
      });
      bus.subscribe('bench.first', () => markFirst(performance.now()));
      // ready() ensures the transport is live; ensureAssigned covers the
      // async cluster route before the cold dispatch is measured.
      await bus.ready();
      await ensureAssigned(bus, 'bench.first');
      const start = performance.now();
      transport.emit('bench.first', { value: 1 });
      await first;
      timings.firstPacketMs = Number((performance.now() - start).toFixed(2));
      await bus.stop();
    }

    const userAgent = navigator.userAgent;
    return { userAgent, timings };
  });
  await context.close();
  return results;
}

async function main() {
  const env = parseBenchEnv();
  const { baseUrl, modes, port } = env;

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
      await waitForServer(baseUrl);
    }
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
    try {
      const results = [];
      for (const mode of modes) results.push(await runMode(env, browser, mode));
      const databus = await runDatabusMatrix(baseUrl, browser);
      const report = { benchmark: 'browser-publish', generatedAt: new Date().toISOString(), results, databus };
      console.log(JSON.stringify(report, null, 2));
      // Archive for trend comparison via scripts/bench-compare.mjs. Failures
      // here must never break the benchmark run itself.
      try {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(new URL('../bench-results/', import.meta.url), { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        writeFileSync(new URL(`../bench-results/browser-${stamp}.json`, import.meta.url), JSON.stringify(report, null, 2));
      } catch (error) {
        console.warn('[bench] failed to archive results:', error instanceof Error ? error.message : error);
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (ownsServer) server.kill('SIGTERM');
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
