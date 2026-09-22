/**
 * Browser E2E for the two framework example pages.
 *
 * `tests/vue.test.ts` and `tests/hooks.test.tsx` run in jsdom with a fake bus,
 * so they can prove the adapters call the right methods but not that the real
 * thing works against a real framework runtime, real `localStorage`, a real
 * BroadcastChannel and a real Worker. These two pages are the only places where
 * the shipped `cross-tab-worker-databus/vue` entry and the hand-wired core API
 * run in a browser, so these tests drive them the way a user does — through the
 * DOM — including the reactive-topic rebind, the ownership handoff after a tab
 * closes, and what happens when the topic box is emptied.
 *
 * Both pages expose the surface the helpers below rely on (`#topicInput` and
 * friends, a `?topic=` override, and a `__vueBus` / `__reactBus` diagnostics
 * hook), which is what lets one set of cases run against either. The React page
 * hand-wires the core API rather than importing the React adapter, so a failure
 * that shows up for one page and not the other localizes to the adapter instead
 * of to the library.
 *
 * Prerequisite: `pnpm build` and `pnpm build:examples` (the pages import from
 * dist/, and the React page imports its locally bundled React). `pnpm test:e2e`
 * runs both.
 */
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

type ExamplePage = {
  /** Where the page is served. */
  url: string;
  /** Label used in test names and in the per-run topic prefix. */
  name: 'react' | 'vue';
  /** `window` property holding the live bus, read for cluster diagnostics. */
  hook: '__reactBus' | '__vueBus';
  /** Topic the page falls back to when its box is emptied. */
  fallbackTopic: string;
};

const VUE_PAGE: ExamplePage = {
  url: 'http://localhost:4173/examples/vue/',
  name: 'vue',
  hook: '__vueBus',
  fallbackTopic: 'vue.example'
};

const REACT_PAGE: ExamplePage = {
  url: 'http://localhost:4173/examples/react/',
  name: 'react',
  hook: '__reactBus',
  fallbackTopic: 'react.example'
};

// Graceful pagehide handoff is fast locally, but heartbeat-TTL fallback alone is
// heartbeatInterval + workerTtl (~13s), and shared runners can delay a survivor's
// reconcile far beyond that.
const HANDOFF_TIMEOUT_MS = 60_000;

/** Subscriber count the demo Centrifugo server currently reports for `channel`. */
async function serverSubscribers(channel: string): Promise<number> {
  const response = await fetch('http://localhost:4173/debug/channels');
  const body = (await response.json()) as { channels: Record<string, number> };
  return body.channels[channel] ?? 0;
}

/** Whether this tab's own cluster has attached `topic` yet. The server-side
 * count only says the *owner* is subscribed; a peer still has to register its
 * local subscriber before an EVENT fan-out reaches it. */
function tabSubscribed(page: Page, example: ExamplePage, topic: string): Promise<boolean> {
  return page.evaluate(
    ({ hook, name }) => {
      const read = (window as unknown as Record<
        string,
        (() => { getDiagnostics(): { cluster: { subscribedTopics: string[] } } }) | undefined
      >)[hook];
      return read ? (read()?.getDiagnostics().cluster.subscribedTopics ?? []).includes(name) : false;
    },
    { hook: example.hook, name: topic }
  );
}

/** Open an example tab on `topic` and wait for its bus to connect, for this tab's
 * cluster to hold the topic, and for exactly one server-side subscriber on the
 * channel. Delivery is at-most-once, so a publication sent before the owner's
 * subscribe command has landed is simply lost; and "exactly one" is the
 * assertion itself — two tabs on one topic must still mean one subscription. */
async function openTab(context: BrowserContext, example: ExamplePage, topic: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${example.url}?topic=${encodeURIComponent(topic)}`);
  await expect(page.locator('#statusBadge')).toHaveText('状态: connected', { timeout: 30_000 });
  await expect.poll(() => tabSubscribed(page, example, topic), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => serverSubscribers(topic), { timeout: 30_000 }).toBe(1);
  return page;
}

/** Move this tab's topic and wait until the server shows a subscriber on the new
 * channel. The old channel is checked separately, once every tab has left it —
 * while another tab still subscribes it, one subscriber is correct. */
async function moveTo(page: Page, example: ExamplePage, topic: string): Promise<void> {
  await page.fill('#topicInput', topic);
  await expect.poll(() => tabSubscribed(page, example, topic), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => serverSubscribers(topic), { timeout: 30_000 }).toBe(1);
}

/** Publish whatever is currently in this tab's draft box. */
async function publish(page: Page, payload: string): Promise<void> {
  await page.fill('#draftInput', payload);
  await page.click('#publishButton');
}

/** Every message text currently listed in this tab. */
async function messages(page: Page): Promise<string[]> {
  return page.$$eval('#messageList li', nodes => nodes.map(node => node.textContent ?? ''));
}

for (const example of [VUE_PAGE, REACT_PAGE]) {
  test.describe(`${example.name} example page`, () => {
    test('fans a publication out to the other open tabs', async ({ browser }) => {
      const topic = `${example.name}.fanout.${Date.now()}`;
      const context = await browser.newContext();
      const sender = await openTab(context, example, topic);
      const receiver = await openTab(context, example, topic);

      await publish(sender, '{"from":"sender","tag":"fanout"}');
      await expect(receiver.locator('#messageList')).toContainText('{"from":"sender","tag":"fanout"}');

      // Both directions: only one tab owns the topic, so the other publication
      // travels as a relayed CONTROL/PUBLISH rather than a local send.
      await publish(receiver, '{"from":"receiver","tag":"fanout"}');
      await expect(sender.locator('#messageList')).toContainText('{"from":"receiver","tag":"fanout"}');
      // The server echoes to the publishing connection too, so each tab ends with
      // both publications and neither sees a duplicate of either.
      await expect.poll(async () => (await messages(sender)).sort()).toEqual(
        ['{"from":"receiver","tag":"fanout"}', '{"from":"sender","tag":"fanout"}'].sort()
      );
      await expect.poll(async () => (await messages(receiver)).sort()).toEqual(
        ['{"from":"receiver","tag":"fanout"}', '{"from":"sender","tag":"fanout"}'].sort()
      );

      await context.close();
    });

    test('rebinds when the topic changes and leaves the old topic behind', async ({ browser }) => {
      const topic = `${example.name}.rebind.${Date.now()}`;
      const context = await browser.newContext();
      const mover = await openTab(context, example, topic);
      const follower = await openTab(context, example, topic);
      const moved = `${topic}.moved`;

      await moveTo(mover, example, moved);
      await moveTo(follower, example, moved);
      // With both tabs gone, the last-subscriber release must have dropped the
      // transport subscription: a channel nobody subscribes has no subscriber.
      await expect.poll(() => serverSubscribers(topic), { timeout: 30_000 }).toBe(0);
      await expect(mover.locator('#topicBadge')).toHaveText(`Topic: ${moved}`);
      await publish(mover, '{"what":"moved"}');
      await expect(follower.locator('#messageList')).toContainText('{"what":"moved"}');

      // A tab arriving on the topic both of them left must not reach them: that
      // would mean the rebind kept the previous subscription attached.
      const stranger = await openTab(context, example, topic);
      await publish(stranger, '{"what":"old"}');
      await expect.poll(async () => (await messages(stranger)).length).toBe(1);
      // The publication demonstrably flew, so give a stale subscription a beat to
      // be reached before asserting the two that left stayed clean.
      await stranger.waitForTimeout(1_000);
      await expect.poll(async () => (await messages(mover)).length).toBe(1);
      await expect.poll(async () => (await messages(follower)).length).toBe(1);

      await context.close();
    });

    test('keeps delivering after the tab that owned the topic closes', async ({ browser }) => {
      const topic = `${example.name}.handoff.${Date.now()}`;
      const context = await browser.newContext();
      const owner = await openTab(context, example, topic);
      const survivor = await openTab(context, example, topic);
      const latecomer = await openTab(context, example, topic);

      await publish(owner, '{"tag":"before-close"}');
      await expect(survivor.locator('#messageList')).toContainText('{"tag":"before-close"}');

      await owner.close();

      await publish(latecomer, '{"tag":"after-close"}');
      await expect
        .poll(() => messages(survivor), { timeout: HANDOFF_TIMEOUT_MS })
        .toContain('{"tag":"after-close"}');
      await expect(survivor.locator('#statusBadge')).toHaveText('状态: connected');

      await context.close();
    });

    test('rebinds to the default topic when the topic box is cleared', async ({ browser }) => {
      // The bus rejects `''` at its own boundary, so the page owns the fallback
      // (`topicInput.trim() || <default>`). This has to run in a browser because
      // the alternative is not a wrong rendering but a TypeError escaping into the
      // framework's error channel: measured with the Vue fallback removed, the tab
      // logged `pageerror: TypeError: CrossTabDataBus.subscribe("")` while still
      // rendering its previous topic — healthy-looking, and deaf. Both arms are
      // probed because they are different arms: whitespace-only falls back through
      // `trim()`, the raw empty string through `||`. The recovery is then shown to
      // be a live subscription, not just a badge that changed.
      const topic = `${example.name}.fallback.${Date.now()}`;
      const context = await browser.newContext();
      const page = await context.newPage();
      const thrown: string[] = [];
      page.on('pageerror', error => thrown.push(String(error)));
      await page.goto(`${example.url}?topic=${encodeURIComponent(topic)}`);
      await expect(page.locator('#statusBadge')).toHaveText('状态: connected', { timeout: 30_000 });
      await expect.poll(() => tabSubscribed(page, example, topic), { timeout: 30_000 }).toBe(true);

      await page.fill('#topicInput', '   ');
      await expect(page.locator('#topicBadge')).toHaveText(`Topic: ${example.fallbackTopic}`, { timeout: 30_000 });
      await expect.poll(() => tabSubscribed(page, example, example.fallbackTopic), { timeout: 30_000 }).toBe(true);
      await expect.poll(() => serverSubscribers(topic), { timeout: 30_000 }).toBe(0);

      // Back to a topic of its own, so the second arm cannot pass by doing nothing.
      await moveTo(page, example, topic);
      await page.fill('#topicInput', '');
      await expect(page.locator('#topicBadge')).toHaveText(`Topic: ${example.fallbackTopic}`, { timeout: 30_000 });
      await expect.poll(() => tabSubscribed(page, example, example.fallbackTopic), { timeout: 30_000 }).toBe(true);
      await expect.poll(() => serverSubscribers(topic), { timeout: 30_000 }).toBe(0);

      const peer = await openTab(context, example, example.fallbackTopic);
      await publish(page, '{"what":"after-fallback"}');
      await expect(peer.locator('#messageList')).toContainText('{"what":"after-fallback"}', { timeout: 30_000 });
      expect(thrown).toEqual([]);

      await context.close();
    });
  });
}
