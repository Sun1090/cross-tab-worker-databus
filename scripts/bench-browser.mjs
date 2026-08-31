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
    console.log(JSON.stringify({ benchmark: 'browser-publish', generatedAt: new Date().toISOString(), results }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  if (ownsServer) server.kill('SIGTERM');
}
