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
    __bus?: {
      getHealthSummary: () => { healthy: boolean; state: string };
      getClusterSnapshot: () => { assignedTopics: string[] };
      publishBatch: (topic: string, items: ReadonlyArray<{ data: unknown; options?: { messageId?: string; timestamp?: number } }>) => void;
    };
    __replayBus?: { stop: () => Promise<void> };
    __replayEmit?: (data: unknown) => void;
    __replayAssigned?: () => boolean;
  }
}

const DEMO_URL = 'http://localhost:4173/examples/demo/';
const LOCAL_WS_URL = 'ws://localhost:4173/centrifuge/demo/connection/websocket';
// Graceful pagehide handoff is fast locally, but heartbeat-TTL fallback alone
// is heartbeatInterval + workerTtl (~13s), and shared CI runners can delay the
// standby's reconcile loop far beyond that. Give the takeover a generous
// ceiling so runner contention shows up as slowness, not as a spurious fail.
const HANDOFF_TIMEOUT_MS = 60_000;

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

/** Open a demo tab with BroadcastChannel removed and the storage-event
 * coordination fallback opted in, then connect it to the topic. The
 * auto-connect settles first so the fallback checkbox is read by the re-apply
 * that actually creates the coordinated bus. */
async function openStorageEventTab(context: BrowserContext, topic: string): Promise<Page> {
  const page = await context.newPage();
  // Remove BroadcastChannel before any page script runs so the demo's
  // cluster coordination degrades through the storage-event fallback
  // instead of staying on the in-memory channel.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true });
  });
  await page.goto(DEMO_URL);
  await expect(page.locator('#statusBadge')).toHaveText('已连接');
  await page.check('#channelFallback');
  await connectDemo(page, 'dedicated', topic);
  return page;
}

/** Number of topics this tab's Worker is assigned as owner, read from the live
 * cluster snapshot (the demo re-renders `#assignedCount` on a 1s interval, so
 * the DOM is a stale view; the snapshot is the authoritative state). */
async function ownerCount(page: Page): Promise<number> {
  const live = await page.evaluate(() => window.__bus?.getClusterSnapshot().assignedTopics.length ?? null);
  if (live !== null) return live;
  return Number(await page.locator('#assignedCount').textContent());
}

/** Wait until the provided tabs have converged to exactly one topic owner and
 * return that owner's index. The owner identity is captured from the same
 * observation that satisfies the exactly-one check, so a later one-shot re-read
 * (which can flip between per-tab snapshots during reconciliation) is not
 * needed. */
async function waitForSingleOwner(tabs: Page[], options: { timeout?: number } = {}): Promise<number> {
  const timeout = options.timeout ?? 30_000;
  let ownerIndex = -1;
  await expect
    .poll(
      async () => {
        const counts = await Promise.all(tabs.map(ownerCount));
        const holders = counts.filter(count => count === 1).length;
        if (holders === 1) ownerIndex = counts.findIndex(count => count === 1);
        return holders;
      },
      { timeout }
    )
    .toBe(1);
  expect(ownerIndex).toBeGreaterThan(-1);
  return ownerIndex;
}

/** Publish one JSON message from this tab (demo `#publishJson`). */
async function publishJson(page: Page): Promise<void> {
  await page.click('#publishJson');
}

/** The transport backend the bus actually landed on (dedicated/shared/local),
 * read from `getDiagnostics().transport.backend` via the config panel. */
async function transportBackend(page: Page): Promise<string> {
  return (await page.locator('#configTransportBackend').textContent()) ?? '';
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
    const ownerIndex = await waitForSingleOwner([tabA, tabB]);
    const ownerIsA = ownerIndex === 0;
    // The configured preference must be the REAL backend — a silent fallback
    // to the local session is exactly the regression this guards against.
    await expect.poll(() => transportBackend(ownerIsA ? tabA : tabB)).toBe('dedicated');

    // The health summary reads healthy once the transport is up, both through
    // the demo's health line and the direct API surface.
    const owner = ownerIsA ? tabA : tabB;
    await expect.poll(async () => (await owner.locator('#overviewHealthInfo').textContent()) ?? '').toContain('健康');
    const health = await owner.evaluate(() => window.__bus?.getHealthSummary());
    expect(health).toMatchObject({ healthy: true, state: 'healthy' });

    await publishJson(tabA);
    // The publisher tab echoes; the other tab receives through the cluster.
    await expect.poll(() => receivedCount(ownerIsA ? tabB : tabA)).toBe(1);
  });

  test('diagnostic trace events surface in the event feed', async ({ context }) => {
    const topic = `e2e.reliability.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);

    // Confirming the initial route emits a reliability trace event, which
    // the demo renders into the event feed with the operation label.
    const feedText = () => tabA.locator('#eventBody').textContent();
    await expect.poll(feedText, { timeout: 30_000 }).toContain('reliability:route_ack');
    await expect.poll(feedText, { timeout: 30_000 }).toContain('路由确认');
    // Subscribing and opening the transport emit subscription/coordination
    // events, rendered bounded (no worker/route arrays in the DOM).
    await expect.poll(feedText, { timeout: 30_000 }).toContain('subscription:subscribe');
    await expect.poll(feedText, { timeout: 30_000 }).toContain('coordination');
  });

  test('adaptive-weighting toggle samples throughput and keeps routing stable', async ({ context }) => {
    test.setTimeout(90_000);
    const topic = `e2e.weighting.${Date.now()}`;
    const openWeightedTab = async (): Promise<Page> => {
      const page = await openDemoTab(context);
      // Opt into adaptive weighting BEFORE the re-apply that creates the bus,
      // so the worker records start sampling traffic.
      await page.check('#loadWeighting');
      await connectDemo(page, 'dedicated', topic);
      return page;
    };

    const tabA = await openWeightedTab();
    const tabB = await openWeightedTab();
    await waitForSingleOwner([tabA, tabB], { timeout: 30_000 });

    // The toggle must not break exactly-one-owner routing or cross-tab delivery.
    await publishJson(tabA);
    await expect.poll(() => receivedCount(tabB)).toBe(1);
    await expect.poll(async () => (await ownerCount(tabA)) + (await ownerCount(tabB))).toBe(1);

    // With weighting enabled, the workers table's 吞吐 column renders each
    // worker's throughput sample once the first heartbeat windows land.
    await expect
      .poll(async () => ((await tabA.locator('#workersBody').textContent()) ?? '').includes('msg/s'), { timeout: 30_000 })
      .toBe(true);
  });

  test('owner migration: closing the owning tab hands the topic to a survivor', async ({ context }) => {
    test.setTimeout(90_000);
    const topic = `e2e.migrate.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabC = await openDemoTab(context);
    await connectDemo(tabC, 'dedicated', topic);

    // Identify and close the owning tab (pagehide triggers a graceful handoff;
    // a missed pagehide falls back to heartbeat-TTL migration). The converge
    // helper returns the owner from the same observation that satisfied the
    // exactly-one check, so no separate one-shot read can race it.
    const owners = [tabA, tabB, tabC];
    const ownerIndex = await waitForSingleOwner(owners, { timeout: 30_000 });
    await owners[ownerIndex]!.close();

    // One of the survivors takes ownership and continues receiving.
    const survivors = owners.filter((_, index) => index !== ownerIndex);
    const [survivorA, survivorB] = survivors as [Page, Page];
    await waitForSingleOwner(survivors, { timeout: HANDOFF_TIMEOUT_MS });

    await publishJson(survivorA);
    await expect.poll(() => receivedCount(survivorB)).toBe(1);
  });

  test('simulated crash without pagehide recovers through heartbeat-TTL expiry', async ({ context }) => {
    // Unlike closing (which runs pagehide and hands off gracefully), the
    // chaos crash toggle stops all outgoing coordination on the owner tab
    // with NO pagehide: no handoff write, no worker-record removal. The
    // route keeps pointing at the dead owner until survivors notice the
    // heartbeat TTL expiry and re-elect through the crash path. (A real
    // renderer crash via CDP cannot isolate one tab: same-origin tabs share
    // the renderer, so siblings die too.)
    test.setTimeout(180_000);
    const topic = `e2e.crash.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabC = await openDemoTab(context);
    await connectDemo(tabC, 'dedicated', topic);

    const tabs = [tabA, tabB, tabC];
    const ownerIndex = await waitForSingleOwner(tabs, { timeout: 30_000 });
    const owner = tabs[ownerIndex]!;

    // Arm crash simulation on the owner only, after convergence: from here
    // its heartbeats silently stop landing.
    await owner.check('#simulateCrash');

    // The dead owner's worker record expires after the worker TTL, then a
    // survivor re-elects — same timing class as stranded-handoff recovery.
    const survivors = tabs.filter(tab => tab !== owner);
    const [survivorA, survivorB] = survivors as [Page, Page];
    await waitForSingleOwner(survivors, { timeout: HANDOFF_TIMEOUT_MS });

    await publishJson(survivorA);
    await expect.poll(() => receivedCount(survivorB)).toBe(1);
  });

  test('concurrent multi-publisher burst stays duplicate-free across all tabs', async ({ context }) => {
    test.setTimeout(120_000);
    const topic = `e2e.burst.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabC = await openDemoTab(context);
    await connectDemo(tabC, 'dedicated', topic);
    const tabs = [tabA, tabB, tabC];

    await waitForSingleOwner(tabs);

    // All three tabs publish three messages each — non-owner publishers route
    // through CONTROL, the owner fans out via EVENT. Every tab must observe
    // every message exactly once. Publishes are concurrent ACROSS tabs but
    // staggered within a tab: hammering one transport with a same-tick burst
    // can push it into a disconnect window, where dropped publishes are
    // documented behaviour and would break the exactly-once assertion.
    const perTab = 3;
    const before = await Promise.all(tabs.map(receivedCount));
    for (let round = 0; round < perTab; round += 1) {
      await Promise.all(tabs.map(tab => publishJson(tab)));
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const expected = before.map(count => count + perTab * tabs.length);
    for (let index = 0; index < tabs.length; index += 1) {
      // Full-suite load on a shared runner delays fan-out; 45s keeps the
      // exactly-once assertion while tolerating that delay.
      await expect.poll(receivedCount.bind(null, tabs[index]!), { timeout: 45_000 }).toBe(expected[index]);
    }
  });

  test('re-applying the connection rebuilds the bus and rejoins the cluster', async ({ context }) => {
    test.setTimeout(90_000);
    const topic = `e2e.reapply.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);

    const tabs = [tabA, tabB];
    await waitForSingleOwner(tabs);

    // Full stop/start of tabB's bus while tabA keeps running: the stopped tab
    // releases its records, then rejoins and keeps receiving. Ownership must
    // stay unique across the restart.
    await tabB.click('#applyConnection');
    await expect(tabB.locator('#statusBadge')).toHaveText('已连接');
    await waitForSingleOwner(tabs, { timeout: 30_000 });

    const beforeB = await receivedCount(tabB);
    await publishJson(tabA);
    await expect.poll(() => receivedCount(tabB)).toBe(beforeB + 1);
  });

  test('reload: a refreshed tab re-subscribes and keeps receiving', async ({ context }) => {
    test.setTimeout(90_000);
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

    // Converge the cluster before publishing: the reloaded tab rejoins with
    // a fresh workerId, so wait until exactly one of the two tabs owns the
    // topic again. Publishing before convergence races the standby's
    // re-subscription — the flake this pattern removes.
    await waitForSingleOwner([tabA, tabB], { timeout: 30_000 });

    // The refreshed tab keeps its tabId (sessionStorage) and the route
    // persists, so a fresh publication still reaches it. The page metric
    // resets on reload, so this "1" is the post-reload receipt.
    await publishJson(tabB);
    await expect
      .poll(() => receivedCount(tabA), { timeout: 30_000 })
      .toBe(1);
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
    // Both tabs must actually be attached to the SharedWorker backend — a
    // per-tab local session would still deliver through the demo server.
    await expect.poll(() => transportBackend(tabA)).toBe('shared');
    await expect.poll(() => transportBackend(tabB)).toBe('shared');
  });

  test('shared-mode session closes server-side when a tab closes', async ({ context }) => {
    test.setTimeout(120_000);
    const topic = `e2e.reap.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'shared', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'shared', topic);

    // Each shared-worker port holds its own WebSocket, so two tabs mean two
    // server connections (see the SharedWorker session reaper docs).
    const connections = async () => {
      const response = await fetch('http://localhost:4173/debug/connections');
      return (await response.json()) as { centrifugo: number };
    };
    await expect.poll(async () => (await connections()).centrifugo, { timeout: 30_000 }).toBe(2);

    // Closing the tab stops its transport gracefully; the demo server must
    // drop the corresponding WebSocket. The silent-death variant of this
    // lifecycle is covered by the PortReaper unit tests.
    await tabB.close();
    await expect.poll(async () => (await connections()).centrifugo, { timeout: 45_000 }).toBe(1);
  });

  test('multi-tab soak: repeated publish, migration, BFCache, and reload stay duplicate-free', async ({ context }) => {
    test.setTimeout(120_000);
    const topic = `e2e.soak.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabC = await openDemoTab(context);
    await connectDemo(tabC, 'dedicated', topic);

    const tabs = [tabA, tabB, tabC];
    await waitForSingleOwner(tabs);

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
    const ownerIndex = await waitForSingleOwner(tabs);
    const owner = tabs[ownerIndex]!;
    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    const survivors = tabs.filter(tab => tab !== owner);
    // Heartbeat-TTL fallback is heartbeatInterval + workerTtl (~13s);
    // leave generous headroom for shared CI runners.
    const survivorIndex = await waitForSingleOwner(survivors, { timeout: HANDOFF_TIMEOUT_MS });
    const survivor = survivors[survivorIndex]!;

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
    // Converge before the final publication (same pattern as the reload test).
    await waitForSingleOwner(tabs, { timeout: 30_000 });
    const beforeReload = await receivedCount(owner);
    await publishJson(survivor);
    await expect.poll(() => receivedCount(owner), { timeout: 30_000 }).toBe(beforeReload + 1);
  });

  test('repeated BFCache round trips and reload keep delivery exactly-once', async ({ context }) => {
    test.setTimeout(120_000);
    const topic = `e2e.longsoak.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);
    const tabs = [tabA, tabB];

    await waitForSingleOwner(tabs, { timeout: 30_000 });

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const ownerIndex = await waitForSingleOwner(tabs);
      const owner = tabs[ownerIndex]!;
      const standby = tabs[ownerIndex === 0 ? 1 : 0]!;

      const before = await receivedCount(standby);
      await publishJson(owner);
      await expect.poll(() => receivedCount(standby)).toBe(before + 1);

      await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await expect.poll(() => ownerCount(standby), { timeout: HANDOFF_TIMEOUT_MS }).toBe(1);
      await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await expect(owner.locator('#statusBadge')).toHaveText('已连接', { timeout: 30_000 });

      await owner.reload();
      await connectDemo(owner, 'dedicated', topic);
      // Converge before publishing (same pattern as the reload test).
      await waitForSingleOwner(tabs, { timeout: 30_000 });
      const afterReload = await receivedCount(owner);
      await publishJson(standby);
      await expect.poll(() => receivedCount(owner), { timeout: 30_000 }).toBe(afterReload + 1);
    }
  });
});

test.describe('cross-tab databus demo — BFCache round trip', () => {
  test('pagehide hands ownership off and pageshow restores a standby receiver', async ({ context }) => {
    test.setTimeout(120_000);
    const topic = `e2e.bfcache.${Date.now()}`;
    const tabA = await openDemoTab(context);
    await connectDemo(tabA, 'dedicated', topic);
    const tabB = await openDemoTab(context);
    await connectDemo(tabB, 'dedicated', topic);

    // Wait until exactly one tab owns the topic, and make sure it is tabA:
    // if B won the race, reload A's ownership picture by reassigning roles.
    const ownerIndex = await waitForSingleOwner([tabA, tabB]);
    const ownerIsA = ownerIndex === 0;
    // The configured preference must be the REAL backend — a silent fallback
    // to the local session is exactly the regression this guards against.
    await expect.poll(() => transportBackend(ownerIsA ? tabA : tabB)).toBe('dedicated');

    // The health summary reads healthy once the transport is up, both through
    // the demo's health line and the direct API surface.
    const healthTab = ownerIsA ? tabA : tabB;
    await expect.poll(async () => (await healthTab.locator('#overviewHealthInfo').textContent()) ?? '').toContain('健康');
    const health = await healthTab.evaluate(() => window.__bus?.getHealthSummary());
    expect(health).toMatchObject({ healthy: true, state: 'healthy' });
    const owner = ownerIsA ? tabA : tabB;
    const standby = ownerIsA ? tabB : tabA;

    // Simulate entering the page cache: pagehide fires the graceful handoff
    // while the page object stays alive (unlike tab.close()).
    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));

    // The survivor takes over ownership and keeps receiving.
    await expect.poll(() => ownerCount(standby), { timeout: HANDOFF_TIMEOUT_MS }).toBe(1);

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

  test('dropped handoff ACK recovers through TTL-gated re-election in a real browser', async ({ context }) => {
    // Chaos path for the stranded-handoff recovery: both tabs drop outgoing
    // ROUTE_RELEASED, so the pagehide handoff route can only be taken over
    // through the TTL-gated re-election (no ACK will ever arrive). The
    // survivor converges and its event feed records the recovery operation.
    test.setTimeout(180_000);
    const topic = `e2e.chaos.${Date.now()}`;
    const openChaosTab = async (): Promise<Page> => {
      const page = await openDemoTab(context);
      await page.check('#dropHandoffAck');
      await connectDemo(page, 'dedicated', topic);
      return page;
    };
    const tabA = await openChaosTab();
    const tabB = await openChaosTab();

    const ownerIndex = await waitForSingleOwner([tabA, tabB]);
    const owner = ownerIndex === 0 ? tabA : tabB;
    const standby = ownerIndex === 0 ? tabB : tabA;

    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));

    // Takeover rides the worker-TTL deadline plus heartbeat granularity, so
    // it lands an order of magnitude later than a graceful handoff — well
    // within the handoff ceiling, far beyond any graceful-handoff timing.
    await expect.poll(() => ownerCount(standby), { timeout: HANDOFF_TIMEOUT_MS }).toBe(1);

    // The survivor took over through recovery, not the ACK path.
    const feedText = () => standby.locator('#eventBody').textContent();
    await expect.poll(feedText, { timeout: 30_000 }).toContain('reliability:route_migration_recovery');
    await expect.poll(feedText, { timeout: 30_000 }).toContain('路由恢复');

    // Delivery resumes through the recovered owner exactly once.
    const before = await receivedCount(standby);
    await publishJson(standby);
    await expect.poll(() => receivedCount(standby)).toBe(before + 1);
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
    await expect.poll(() => ownerCount(tabA), { timeout: 30_000 }).toBe(1);
    const tabB = await setupWsTab();

    // Cluster coordination still applies: exactly one tab owns the topic.
    await waitForSingleOwner([tabA, tabB]);

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

  test('publishBatch button sends ten items in a single wire frame', async ({ context, request }) => {
    const topic = `e2e.batch.${Date.now()}`;

    const page = await openDemoTab(context);
    await page.click('#modeSwitch [data-mode="websocket"]');
    await page.fill('#topicInput', topic);
    await page.click('#applyConnection');
    await expect(page.locator('#statusBadge')).toHaveText('已连接');
    // This tab owns the topic, so its publishBatch reaches the server directly.
    await expect.poll(() => ownerCount(page), { timeout: 30_000 }).toBe(1);

    const statsUrl = 'http://localhost:4173/debug/wsstats';
    const topicStats = async () => {
      const stats = (await (await request.get(statsUrl)).json()) as {
        publish: number;
        publishBatch: number;
        topics: Record<string, { publish: number; publishBatch: number }>;
      };
      // Per-topic counters isolate this test's session from concurrent tests
      // sharing the demo server on a parallel run.
      return stats.topics[topic] ?? { publish: 0, publishBatch: 0 };
    };
    const baseline = await topicStats();

    await page.click('#publishBatch');
    // All ten items arrive in this tab (echoed back through the batch).
    await expect.poll(() => receivedCount(page)).toBe(10);
    const after = await topicStats();
    // Exactly one publishBatch wire frame on this topic — and no extra
    // individual publishes, proving the burst was not decomposed into
    // per-item frames.
    expect(after.publishBatch).toBe(baseline.publishBatch + 1);
    expect(after.publish).toBe(baseline.publish);
  });

  test('batch burst fanned out across tabs stays exactly-once per tab', async ({ context }) => {
    const topic = `e2e.batch2tab.${Date.now()}`;
    const setupWsTab = async (): Promise<Page> => {
      const page = await openDemoTab(context);
      await page.click('#modeSwitch [data-mode="websocket"]');
      await page.fill('#topicInput', topic);
      await page.click('#applyConnection');
      await expect(page.locator('#statusBadge')).toHaveText('已连接');
      return page;
    };

    const tabA = await setupWsTab();
    await expect.poll(() => ownerCount(tabA), { timeout: 30_000 }).toBe(1);
    const tabB = await setupWsTab();
    await waitForSingleOwner([tabA, tabB]);

    // The batch travels as one wire frame and fans out through the cluster:
    // the non-owner tab receives all ten via the EVENT broadcast, both tabs
    // end on exactly ten (no duplicates from double-delivery / echo races).
    await tabA.click('#publishBatch');
    await expect.poll(() => receivedCount(tabB)).toBe(10);
    await expect.poll(() => receivedCount(tabA)).toBe(10);
  });

  test('large publishBatch (100 items × 3 tabs) fans out exactly-once per tab', async ({ context }) => {
    test.setTimeout(150_000);
    const topic = `e2e.batch3tab.${Date.now()}`;
    const setupWsTab = async (): Promise<Page> => {
      const page = await openDemoTab(context);
      await page.click('#modeSwitch [data-mode="websocket"]');
      await page.fill('#topicInput', topic);
      await page.click('#applyConnection');
      await expect(page.locator('#statusBadge')).toHaveText('已连接');
      return page;
    };

    const tabs = [await setupWsTab(), await setupWsTab(), await setupWsTab()];
    // Converge before publishing: exactly one tab owns the transport
    // subscription and the other two receive only through the EVENT fan-out.
    await waitForSingleOwner(tabs, { timeout: 30_000 });

    // 100 items from one tab; each carries a messageId so the batch metadata
    // rides the CONTROL → transport → server echo → EVENT fan-out path end to
    // end. Every tab must land on exactly 100 — no double-delivery from the
    // owner's echo racing the EVENT broadcast, no per-item frame decomposition.
    await tabs[0]!.evaluate((replayTopic) => {
      const items = Array.from({ length: 100 }, (_, index) => ({
        data: { value: index },
        options: { messageId: `large-batch-${index}` }
      }));
      window.__bus?.publishBatch(replayTopic, items);
    }, topic);

    await expect.poll(() => receivedCount(tabs[0]!), { timeout: 30_000 }).toBe(100);
    await expect.poll(() => receivedCount(tabs[1]!), { timeout: 30_000 }).toBe(100);
    await expect.poll(() => receivedCount(tabs[2]!), { timeout: 30_000 }).toBe(100);
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
    await expect.poll(() => ownerCount(tabA), { timeout: 30_000 }).toBe(1);
    const tabB = await setupWsTab();
    await waitForSingleOwner([tabA, tabB]);

    await tabA.click('#publishBinary');
    // The demo wraps binary payloads as base64 JSON ({__bin}) — the event
    // feed must show the ArrayBuffer sizing on the receiving tab.
    await expect
      .poll(() => tabB.locator('#eventBody').textContent())
      .toContain('ArrayBuffer(48)');
  });
});

test.describe('cross-tab databus demo — storage-event coordination fallback', () => {
  test('two BroadcastChannel-less tabs coordinate over localStorage storage events', async ({ context }) => {
    test.setTimeout(120_000);
    const topic = `e2e.storage.${Date.now()}`;
    const tabA = await openStorageEventTab(context, topic);
    const tabB = await openStorageEventTab(context, topic);

    // Both tabs must report the storage-event coordination channel — a silent
    // return to BroadcastChannel (or a drop to local mode) is the regression
    // this scenario guards against.
    await expect.poll(() => tabA.locator('#configChannelInfo').textContent()).toContain('storage-event 降级');
    await expect.poll(() => tabB.locator('#configChannelInfo').textContent()).toContain('storage-event 降级');

    // Exactly one tab owns the transport subscription over the fallback.
    await waitForSingleOwner([tabA, tabB], { timeout: 45_000 });

    // Cross-tab delivery rides the storage-event coordination plane. Each tab
    // echoes its own publish, so both end up with both messages.
    await publishJson(tabA);
    await expect.poll(() => receivedCount(tabB)).toBe(1);
    await publishJson(tabB);
    await expect.poll(() => receivedCount(tabA)).toBe(2);
    await expect.poll(() => receivedCount(tabB)).toBe(2);
  });

  test('pagehide handoff migrates the owner over the storage-event channel', async ({ context }) => {
    // Storage-event coordination is slower than BroadcastChannel (poll-based
    // reads + storage-event latency), and the 45s convergence wait before the
    // handoff shares this test's budget: without the raised ceiling, a healthy
    // but slow HANDOFF_TIMEOUT_MS poll dies on the default 60s test timeout.
    test.setTimeout(120_000);
    const topic = `e2e.storage.migrate.${Date.now()}`;
    const tabA = await openStorageEventTab(context, topic);
    const tabB = await openStorageEventTab(context, topic);

    const ownerIndex = await waitForSingleOwner([tabA, tabB], { timeout: 45_000 });
    const owner = ownerIndex === 0 ? tabA : tabB;
    const standby = ownerIndex === 0 ? tabB : tabA;

    // A graceful pagehide hands ownership off. Over the storage-event channel
    // the handoff writes the replacement route and the REGISTRY nudge to
    // localStorage; the standby must observe it via a storage event.
    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await expect.poll(() => ownerCount(standby), { timeout: HANDOFF_TIMEOUT_MS }).toBe(1);

    // Restore the cached owner: the standby keeps the sticky route, and
    // cross-tab delivery resumes through the migrated owner (the standby's
    // transport) over the storage-event plane.
    await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(owner.locator('#statusBadge')).toHaveText('已连接', { timeout: 30_000 });
    await publishJson(owner);
    await expect.poll(() => receivedCount(standby)).toBe(1);

    // Ownership stays unique (routes are sticky) and both tabs keep the
    // storage-event channel — no drift back to local mode or BroadcastChannel.
    await expect.poll(async () => (await ownerCount(owner)) + (await ownerCount(standby))).toBe(1);
    await expect.poll(() => owner.locator('#configChannelInfo').textContent()).toContain('storage-event 降级');
    await expect.poll(() => standby.locator('#configChannelInfo').textContent()).toContain('storage-event 降级');
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
