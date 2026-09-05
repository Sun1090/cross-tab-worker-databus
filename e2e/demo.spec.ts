/**
 * Browser E2E tests: real multi-tab cross-tab delivery over the bundled demo.
 *
 * Runs the demo page (examples/demo) in a local Chromium, connecting each tab
 * to the bundled local Centrifugo-compatible WebSocket server
 * (scripts/demo-centrifuge-server.mjs). Publications only reach non-owner tabs
 * through the cluster's EVENT fan-out, so these tests exercise the real
 * coordination stack: worker registration, sticky topic ownership, route
 * handoff on pagehide, heartbeat-TTL migration, and re-subscription after
 * reload — all in actual browser tabs.
 *
 * Prerequisite: `pnpm build` (the demo imports from dist/). `pnpm test:e2e`
 * handles this.
 */
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

declare global {
  interface Window {
    __replayBus?: { stop: () => Promise<void> };
    __replayEmit?: (data: unknown) => void;
    __replayAssigned?: () => boolean;
  }
}

const DEMO_URL = 'http://localhost:4173/examples/demo/';
const LOCAL_WS_URL = 'ws://localhost:4173/centrifuge/demo/connection/websocket';

/** Open a fresh demo tab and wait for its auto-connect to settle. */
async function openDemoTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(DEMO_URL);
  // The page auto-connects on load. Wait for both the connected badge and the
  // apply button to re-enable so a manual re-apply below never overlaps the
  // in-flight auto-connect (the demo serialises connection switches).
  await expect(page.locator('#statusBadge')).toHaveText('已连接');
  await expect(page.locator('#applyConnection')).toBeEnabled();
  return page;
}

/** Set up the demo page in Centrifugo mode against the local demo server. */
async function connectDemo(page: Page, workerMode: string, topic: string): Promise<void> {
  await page.selectOption('#endpointPreset', 'local');
  await page.fill('#urlInput', LOCAL_WS_URL);
  await page.selectOption('#workerMode', workerMode);
  await page.fill('#topicInput', topic);
  await page.click('#applyConnection');
  try {
    await expect(page.locator('#statusBadge')).toHaveText('已连接');
  } catch (error) {
    const feed = await page.locator('#eventBody').allInnerTexts();
    console.log('[FEED DUMP]\n' + (feed[0] ?? '').split('\n').slice(0, 25).join('\n'));
    console.log('[CONFIG]', await page.locator('#configModeBadge, #configBackend, #configTabId').allInnerTexts());
    throw error;
  }
}

/** Number of messages received by this tab (demo `#metricReceived`). */
async function receivedCount(page: Page): Promise<number> {
  return Number(await page.locator('#metricReceived').textContent());
}

/** Number of topics this tab's Worker is assigned as owner. */
async function assignedCount(page: Page): Promise<number> {
  return Number(await page.locator('#assignedCount').textContent());
}

/** Publish one JSON message from this tab (demo `#publishJson`). */
async function publishJson(page: Page): Promise<void> {
  await page.click('#publishJson');
}

test.describe('cross-tab databus demo', () => {
  test('single-owner routing: one tab owns the topic and all tabs receive', async ({ context }) => {
    const topic = `e2e.owner.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);

    // Exactly one tab owns the transport subscription; the other is a
    // standby that must still receive publications via the EVENT fan-out.
    await expect.poll(async () => (await assignedCount(tabA)) + (await assignedCount(tabB))).toBe(1);
    const ownerIsA = (await assignedCount(tabA)) === 1;

    await publishJson(tabA);
    // The publisher tab echoes; the other tab receives through the cluster.
    await expect.poll(() => receivedCount(ownerIsA ? tabB : tabA)).toBe(1);
  });

  test('owner migration: closing the owning tab hands the topic to a survivor', async ({ context }) => {
    const topic = `e2e.migrate.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabC = await openDemoTab(context);
    await connectDemo(tabC, 'dedicated', topic);

    // Wait until exactly one of the three tabs owns the topic.
    await expect
      .poll(async () =>
        Promise.all([tabA, tabB, tabC].map(assignedCount)).then(counts => counts.filter(count => count === 1).length)
      )
      .toBe(1);

    // Identify and close the owning tab (pagehide triggers a graceful handoff;
    // a missed pagehide falls back to heartbeat-TTL migration).
    const owners = [tabA, tabB, tabC];
    const ownerIndex = await Promise.all(owners.map(assignedCount)).then(counts => counts.indexOf(1));
    expect(ownerIndex).toBeGreaterThan(-1);
    await owners[ownerIndex]!.close();

    // One of the survivors takes ownership and continues receiving.
    const survivors = owners.filter((_, index) => index !== ownerIndex);
    const [survivorA, survivorB] = survivors as [Page, Page];
    await expect
      .poll(
        async () =>
          Promise.all(survivors.map(assignedCount)).then(counts => counts.filter(count => count === 1).length),
        { timeout: 30_000 }
      )
      .toBe(1);

    await publishJson(survivorA);
    await expect.poll(() => receivedCount(survivorB)).toBe(1);
  });

  test('concurrent multi-publisher burst stays duplicate-free across all tabs', async ({ context }) => {
    const topic = `e2e.burst.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabC = await openDemoTab(context);
    await connectDemo(tabC, 'dedicated', topic);
    const tabs = [tabA, tabB, tabC];

    await expect
      .poll(async () => (await Promise.all(tabs.map(assignedCount))).filter(count => count === 1).length)
      .toBe(1);

    // All three tabs publish three messages each in parallel — non-owner
    // publishers route through CONTROL, the owner fans out via EVENT. Every
    // tab must observe every message exactly once.
    const perTab = 3;
    const before = await Promise.all(tabs.map(receivedCount));
    await Promise.all(tabs.map(tab => Array.from({ length: perTab }, () => publishJson(tab))));

    const expected = before.map(count => count + perTab * tabs.length);
    for (let index = 0; index < tabs.length; index += 1) {
      await expect.poll(receivedCount.bind(null, tabs[index]!), { timeout: 30_000 }).toBe(expected[index]);
    }
  });

  test('re-applying the connection rebuilds the bus and rejoins the cluster', async ({ context }) => {
    const topic = `e2e.reapply.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);

    const tabs = [tabA, tabB];
    await expect
      .poll(async () => (await Promise.all(tabs.map(assignedCount))).filter(count => count === 1).length)
      .toBe(1);

    // Full stop/start of tabB's bus while tabA keeps running: the stopped tab
    // releases its records, then rejoins and keeps receiving. Ownership must
    // stay unique across the restart.
    await tabB.click('#applyConnection');
    await expect(tabB.locator('#statusBadge')).toHaveText('已连接');
    await expect
      .poll(async () => (await Promise.all(tabs.map(assignedCount))).filter(count => count === 1).length, {
        timeout: 30_000
      })
      .toBe(1);

    const beforeB = await receivedCount(tabB);
    await publishJson(tabA);
    await expect.poll(() => receivedCount(tabB)).toBe(beforeB + 1);
  });

  test('reload: a refreshed tab re-subscribes and keeps receiving', async ({ context }) => {
    const topic = `e2e.reload.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);

    // Publish before the reload so the receipt baseline is known.
    await publishJson(tabB);
    await expect.poll(() => receivedCount(tabA)).toBe(1);

    await tabA.reload();
    await connectDemo(tabA, 'dedicated', topic);

    // The refreshed tab keeps its tabId (sessionStorage) and the route
    // persists, so a fresh publication still reaches it. The page metric
    // resets on reload, so this "1" is the post-reload receipt.
    await publishJson(tabB);
    await expect.poll(() => receivedCount(tabA)).toBe(1);
  });

  test('SharedWorker mode: one shared process, independent sessions, cross-tab delivery', async ({ context }) => {
    const topic = `e2e.shared.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'shared', topic);
    await expect(tabA.locator('#backendBadge')).toHaveText('SharedWorker');

    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'shared', topic);

    await publishJson(tabA);
    await expect.poll(() => receivedCount(tabB)).toBe(1);
    await expect(tabB.locator('#backendBadge')).toHaveText('SharedWorker');
  });

  test('multi-tab soak: repeated publish, migration, BFCache, and reload stay duplicate-free', async ({ context }) => {
    const topic = `e2e.soak.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabC = await openDemoTab(context);
    await connectDemo(tabC, 'dedicated', topic);

    const tabs = [tabA, tabB, tabC];
    await expect.poll(async () => (await Promise.all(tabs.map(assignedCount))).filter(count => count === 1).length).toBe(1);

    // Exercise steady-state fan-out repeatedly before any lifecycle transition.
    for (let index = 0; index < 3; index += 1) {
      const sender = tabs[index % tabs.length]!;
      const receivers = tabs.filter(tab => tab !== sender);
      const before = await Promise.all(receivers.map(receivedCount));
      await publishJson(sender);
      await Promise.all(
        receivers.map((receiver, receiverIndex) =>
          expect.poll(() => receivedCount(receiver)).toBe(before[receiverIndex]! + 1)
        )
      );
    }

    // Put the current owner through a graceful page-cache transition, then
    // verify a survivor takes over without duplicate delivery.
    const ownerIndex = (await Promise.all(tabs.map(assignedCount))).indexOf(1);
    expect(ownerIndex).toBeGreaterThan(-1);
    const owner = tabs[ownerIndex]!;
    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    const survivors = tabs.filter(tab => tab !== owner);
    await expect
      .poll(async () => (await Promise.all(survivors.map(assignedCount))).filter(count => count === 1).length, {
        timeout: 30_000
      })
      .toBe(1);
    const survivor = survivors[(await Promise.all(survivors.map(assignedCount))).indexOf(1)]!;

    const receiver = survivors.find(tab => tab !== survivor)!;
    const beforeMigration = await receivedCount(receiver);
    await publishJson(survivor);
    await expect.poll(() => receivedCount(receiver)).toBe(beforeMigration + 1);

    // Restore the cached page, reload it, and ensure one final publication is
    // delivered exactly once after both lifecycle paths have completed.
    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(owner.locator('#statusBadge')).toHaveText('已连接', { timeout: 30_000 });
    await owner.reload();
    await connectDemo(owner, 'dedicated', topic);
    const beforeReload = await receivedCount(owner);
    await publishJson(survivor);
    await expect.poll(() => receivedCount(owner)).toBe(beforeReload + 1);
  });

  test('repeated BFCache round trips and reload keep delivery exactly-once', async ({ context }) => {
    const topic = `e2e.longsoak.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabs = [tabA, tabB];

    await expect.poll(async () => (await Promise.all(tabs.map(assignedCount))).filter(count => count === 1).length).toBe(1);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const ownerIndex = (await Promise.all(tabs.map(assignedCount))).indexOf(1);
      const owner = tabs[ownerIndex]!;
      const standby = tabs[ownerIndex === 0 ? 1 : 0]!;

      const before = await receivedCount(standby);
      await publishJson(owner);
      await expect.poll(() => receivedCount(standby)).toBe(before + 1);

      await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await expect.poll(() => assignedCount(standby), { timeout: 30_000 }).toBe(1);
      await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await expect(owner.locator('#statusBadge')).toHaveText('已连接', { timeout: 30_000 });

      await owner.reload();
      await connectDemo(owner, 'dedicated', topic);
      const afterReload = await receivedCount(owner);
      await publishJson(standby);
      await expect.poll(() => receivedCount(owner)).toBe(afterReload + 1);
    }
  });
});

test.describe('cross-tab databus demo — BFCache round trip', () => {
  test('pagehide hands ownership off and pageshow restores a standby receiver', async ({ context }) => {
    const topic = `e2e.bfcache.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);

    // Wait until exactly one tab owns the topic, and make sure it is tabA:
    // if B won the race, reload A's ownership picture by reassigning roles.
    await expect.poll(async () => (await assignedCount(tabA)) + (await assignedCount(tabB))).toBe(1);
    const ownerIsA = (await assignedCount(tabA)) === 1;
    const owner = ownerIsA ? tabA : tabB;
    const standby = ownerIsA ? tabB : tabA;

    // Simulate entering the page cache: pagehide fires the graceful handoff
    // while the page object stays alive (unlike tab.close()).
    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));

    // The survivor takes over ownership and keeps receiving.
    await expect.poll(() => assignedCount(standby), { timeout: 30_000 }).toBe(1);

    // Returning from the page cache: pageshow re-subscribes the returning tab.
    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    // Wait for the restored tab's transport to finish reopening before
    // publishing; pageshow dispatches lifecycle work synchronously but
    // transport recovery completes asynchronously. Ownership may remain with
    // the survivor, so status is the correct readiness signal here.
    await expect(owner.locator('#statusBadge')).toHaveText('已连接', { timeout: 30_000 });

    // Both tabs exchange publications again across the restored cluster.
    await publishJson(owner);
    await expect.poll(() => receivedCount(standby)).toBe(1);
    const ownerBeforeReturnPublish = await receivedCount(owner);
    await publishJson(standby);
    await expect.poll(() => receivedCount(owner)).toBe(ownerBeforeReturnPublish + 1);
  });
});

test.describe('cross-tab databus demo — WebSocket backend', () => {
  test('native WebSocket transport: cross-tab publish/receive through the cluster', async ({ context }) => {
    const topic = `e2e.wsbrowser.${Date.now()}`;

    const setupWsTab = async (): Promise<Page> => {
      const page = await openDemoTab(context);
      await page.click('#modeSwitch [data-mode="websocket"]');
      await page.fill('#topicInput', topic);
      await page.click('#applyConnection');
      await expect(page.locator('#statusBadge')).toHaveText('已连接');
      return page;
    };

    const tabA = await setupWsTab();
    // Let tabA take ownership before tabB joins — two simultaneous
    // first-subscribers can race and both create their own route.
    await expect.poll(() => assignedCount(tabA), { timeout: 30_000 }).toBe(1);
    const tabB = await setupWsTab();

    // Cluster coordination still applies: exactly one tab owns the topic.
    await expect.poll(async () => (await assignedCount(tabA)) + (await assignedCount(tabB))).toBe(1);

    // The demo WebSocket server echoes publications to the sender as well,
    // so each tab ends up with both messages after the two-way exchange.
    await publishJson(tabA);
    await expect.poll(() => receivedCount(tabB)).toBe(1);
    await publishJson(tabB);
    await expect.poll(() => receivedCount(tabA)).toBe(2);
    await expect.poll(() => receivedCount(tabB)).toBe(2);
  });

  test('publication metadata round-trips through the real demo WebSocket server', async ({ page }) => {
    await page.goto(DEMO_URL);
    const topic = `e2e.metadata.${Date.now()}`;
    const result = await page.evaluate(async replayTopic => {
      const moduleUrl = '/dist/index.js';
      const { WebSocketTransport } = await import(/* @vite-ignore */ moduleUrl);
      const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/demo`;
      const transport = new WebSocketTransport({ url });
      let resolveConnected!: () => void;
      const connected = new Promise<void>(resolve => { resolveConnected = resolve; });
      let resolveMessage!: (message: unknown) => void;
      const received = new Promise<unknown>(resolve => { resolveMessage = resolve; });
      transport.start({ url }, {
        onMessage: (message: unknown) => resolveMessage(message),
        onStatus: (status: string) => { if (status === 'connected') resolveConnected(); },
        onError: (error: unknown) => { throw error; }
      });
      await connected;
      transport.subscribe(replayTopic);
      transport.publish(replayTopic, { value: 1 }, { messageId: 'e2e-message', timestamp: 42 });
      const message = await received;
      transport.stop();
      return message;
    }, topic);
    expect(result).toEqual({
      topic,
      data: { value: 1 },
      messageId: 'e2e-message',
      timestamp: 42
    });
  });
});

test.describe('cross-tab databus demo — binary publish', () => {
  test('binary publish button round-trips across tabs over the WebSocket backend', async ({ context }) => {
    const topic = `e2e.bin.${Date.now()}`;
    const setupWsTab = async (): Promise<Page> => {
      const page = await openDemoTab(context);
      await page.click('#modeSwitch [data-mode="websocket"]');
      await page.fill('#topicInput', topic);
      await page.click('#applyConnection');
      await expect(page.locator('#statusBadge')).toHaveText('已连接');
      return page;
    };

    const tabA = await setupWsTab();
    await expect.poll(() => assignedCount(tabA), { timeout: 30_000 }).toBe(1);
    const tabB = await setupWsTab();
    await expect.poll(async () => (await assignedCount(tabA)) + (await assignedCount(tabB))).toBe(1);

    await tabA.click('#publishBinary');
    // The demo wraps binary payloads as base64 JSON ({__bin}) — the event
    // feed must show the ArrayBuffer sizing on the receiving tab.
    await expect
      .poll(() => tabB.locator('#eventBody').textContent())
      .toContain('ArrayBuffer(48)');
  });
});

test.describe('cross-tab databus replay persistence', () => {
  test('hydrates IndexedDB replay history after a reload', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(DEMO_URL);
    const dbName = `e2e.replay.${Date.now()}`;
    const topic = `e2e.replay.topic.${Date.now()}`;

    await page.evaluate(async ({ dbName: name, topic: replayTopic }) => {
      const moduleUrl = '/dist/index.js';
      const { CrossTabDataBus, createIndexedDbReplayPersistence } = await import(moduleUrl);
      class Transport {
        handlers!: { onStatus: (status: 'connected') => void; onMessage: (message: { topic: string; data: unknown }) => void };
        async start(_config: unknown, handlers: Transport['handlers']) {
          this.handlers = handlers;
          handlers.onStatus('connected');
        }
        subscribe() {}
        unsubscribe() {}
        publish() {}
        stop() {}
      }
      const transport = new Transport();
      const bus = new CrossTabDataBus({
        autoStart: true,
        clusterKey: `replay-${name}`,
        initialConfig: {},
        transport,
        replay: { maxPerTopic: 8, persistence: createIndexedDbReplayPersistence({ dbName: name, maxPerTopic: 8 }) }
      });
      await bus.ready();
      bus.subscribe(replayTopic, () => {});
      window.__replayBus = bus;
      window.__replayEmit = (data: unknown) => transport.handlers.onMessage({ topic: replayTopic, data });
      window.__replayAssigned = () => bus.getClusterSnapshot().assignedTopics.includes(replayTopic);
    }, { dbName, topic });

    await page.waitForFunction(() => window.__replayAssigned?.(), undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__replayEmit?.('persisted-value'));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.evaluate(() => window.__replayEmit?.('bfcache-value'));
    await page.waitForTimeout(500);
    const stored = await page.evaluate(async name => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction('replay', 'readonly').objectStore('replay').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }, dbName);
    expect(stored).toMatchObject([
      { topic, messages: [expect.objectContaining({ topic, data: 'persisted-value' }), expect.objectContaining({ topic, data: 'bfcache-value' })] }
    ]);
    await page.evaluate(async () => window.__replayBus?.stop());
    await page.reload();

    const replayed = await page.evaluate(async ({ dbName: name, topic: replayTopic }) => {
      const moduleUrl = '/dist/index.js';
      const { CrossTabDataBus, createIndexedDbReplayPersistence } = await import(moduleUrl);
      class Transport {
        async start(_config: unknown, handlers: { onStatus: (status: 'connected') => void }) { handlers.onStatus('connected'); }
        subscribe() {}
        unsubscribe() {}
        publish() {}
        stop() {}
      }
      const bus = new CrossTabDataBus({
        autoStart: true,
        clusterKey: `replay-${name}-restored`,
        initialConfig: {},
        transport: new Transport(),
        replay: { maxPerTopic: 8, persistence: createIndexedDbReplayPersistence({ dbName: name, maxPerTopic: 8 }) }
      });
      const errors: string[] = [];
      bus.onError((error: unknown) => errors.push(String(error)));
      await bus.ready();
      const seen: Array<{ data: unknown; replayed?: boolean | undefined }> = [];
      bus.subscribe(replayTopic, (message: { data: unknown; replayed?: boolean }) => seen.push({ data: message.data, replayed: message.replayed }), { replay: true });
      await new Promise(resolve => setTimeout(resolve, 100));
      await bus.stop();
      return { seen, errors };
    }, { dbName, topic });

    expect(replayed).toEqual({
      seen: [
        { data: 'persisted-value', replayed: true },
        { data: 'bfcache-value', replayed: true }
      ],
      errors: []
    });
  });
});
