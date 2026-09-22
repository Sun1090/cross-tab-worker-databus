/**
 * Browser E2E for the shipped framework adapter entry points.
 *
 * `tests/vue.test.ts` runs in jsdom with a fake bus, so it can prove the
 * composables call the right methods but not that the real adapter works against
 * a real Vue runtime, real `localStorage`, a real BroadcastChannel and a real
 * Worker. examples/vue is the only page that mounts the actual
 * `cross-tab-worker-databus/vue` entry, so these tests drive it the way a user
 * does — through the DOM — including the reactive-topic rebind and the
 * ownership handoff after the owning tab closes.
 *
 * Prerequisite: `pnpm build` (the example imports from dist/). `pnpm test:e2e`
 * handles this.
 */
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const VUE_URL = 'http://localhost:4173/examples/vue/';
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
function tabSubscribed(page: Page, topic: string): Promise<boolean> {
  return page.evaluate(name => {
    const read = (window as unknown as {
      __vueBus?: () => { getDiagnostics(): { cluster: { subscribedTopics: string[] } } } | null;
    }).__vueBus;
    return read ? (read()?.getDiagnostics().cluster.subscribedTopics ?? []).includes(name) : false;
  }, topic);
}

/** Open a Vue example tab on `topic` and wait for its bus to connect, for this
 * tab's cluster to hold the topic, and for exactly one server-side subscriber
 * on the channel. Delivery is at-most-once, so a publication sent before the
 * owner's subscribe command has landed is simply lost; and "exactly one" is the
 * assertion itself — two tabs on one topic must still mean one subscription. */
async function openVueTab(context: BrowserContext, topic: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${VUE_URL}?topic=${encodeURIComponent(topic)}`);
  await expect(page.locator('#statusBadge')).toHaveText('状态: connected', { timeout: 30_000 });
  await expect.poll(() => tabSubscribed(page, topic), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => serverSubscribers(topic), { timeout: 30_000 }).toBe(1);
  return page;
}

/** Move this tab's reactive topic and wait until the server shows a subscriber
 * on the new channel. The old channel is checked separately, once every tab has
 * left it — while another tab still subscribes it, one subscriber is correct. */
async function moveTo(page: Page, topic: string): Promise<void> {
  await page.fill('#topicInput', topic);
  await expect.poll(() => tabSubscribed(page, topic), { timeout: 30_000 }).toBe(true);
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

test.describe('vue adapter', () => {
  test('fans a publication out to the other open tabs through the composables', async ({ browser }) => {
    const topic = `vue.fanout.${Date.now()}`;
    const context = await browser.newContext();
    const sender = await openVueTab(context, topic);
    const receiver = await openVueTab(context, topic);

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

  test('rebinds when the topic ref changes and leaves the old topic behind', async ({ browser }) => {
    const topic = `vue.rebind.${Date.now()}`;
    const context = await browser.newContext();
    const mover = await openVueTab(context, topic);
    const follower = await openVueTab(context, topic);
    const moved = `${topic}.moved`;

    await moveTo(mover, moved);
    await moveTo(follower, moved);
    // With both tabs gone, the last-subscriber release must have dropped the
    // transport subscription: a channel nobody subscribes has no subscriber.
    await expect.poll(() => serverSubscribers(topic), { timeout: 30_000 }).toBe(0);
    await expect(mover.locator('#topicBadge')).toHaveText(`Topic: ${moved}`);
    await publish(mover, '{"what":"moved"}');
    await expect(follower.locator('#messageList')).toContainText('{"what":"moved"}');

    // A tab arriving on the topic both of them left must not reach them: that
    // would mean the rebind kept the previous subscription attached.
    const stranger = await openVueTab(context, topic);
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
    const topic = `vue.handoff.${Date.now()}`;
    const context = await browser.newContext();
    const owner = await openVueTab(context, topic);
    const survivor = await openVueTab(context, topic);
    const latecomer = await openVueTab(context, topic);

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
});
