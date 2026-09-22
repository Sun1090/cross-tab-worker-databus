/**
 * Vue usage example for cross-tab-worker-databus.
 *
 * Unlike examples/react (which hand-rolls the effect/subscribe/status wiring to
 * show the framework-agnostic core), this page runs entirely on the shipped
 * adapter entry `cross-tab-worker-databus/vue`:
 * - `useCrossTabDataBus` creates the bus on mount and stops it on unmount;
 * - `useCrossTabStatus` mirrors `onStatus()` into a ref;
 * - `useCrossTabSubscription` attaches the handler and rebinds when the bus or
 *   the (reactive) topic changes.
 *
 * Both it and examples/react hit the same local demo Centrifugo endpoint, so
 * a publication from this page is received by a demo or React tab on the same
 * topic and vice versa. A JSON body whose top level carries a string `topic`
 * is re-addressed to that topic instead of the one it was published on — see
 * docs/transports.md — so the default draft below deliberately has no such key.
 *
 * Requires `pnpm build` (imports from dist/) and `pnpm examples` to serve it.
 */
import { computed, createApp, defineComponent, h, ref } from 'vue';
import { createCentrifugeDataBus } from '../../dist/centrifuge.js';
import {
  useCrossTabDataBus,
  useCrossTabStatus,
  useCrossTabSubscription
} from '../../dist/vue.js';

const localDemoUrl = `${location.protocol}//${location.host}/centrifuge/demo/connection/websocket`.replace('http:', 'ws:');

// The demo server broadcasts per topic, so every page that defaults to
// `vue.example` also receives each other's publications. The browser tests load
// this page with `?topic=…` to keep their traffic separate.
const queryTopic = new URL(location.href).searchParams.get('topic');

const App = defineComponent({
  setup() {
    const topicInput = ref(queryTopic || 'vue.example');
    // The bus rejects an empty topic at its own boundary, so the page owns the
    // fallback: clearing the box rebinds to the default rather than throwing
    // inside the composable's reactive re-subscribe.
    const topic = computed(() => topicInput.value.trim() || 'vue.example');
    const draft = ref('{"hello":"from-vue"}');
    const messages = ref([]);
    // The factory runs once per mounted instance; the composable stops the
    // instance it created when this component unmounts.
    const bus = useCrossTabDataBus(() =>
      createCentrifugeDataBus({ connection: { url: localDemoUrl, options: {} } })
    );
    const status = useCrossTabStatus(bus);
    useCrossTabSubscription(bus, topic, message => {
      messages.value = [...messages.value.slice(-49), JSON.stringify(message.data)];
    });
    // Diagnostics hook, same convention as examples/demo: the rendered DOM is a
    // render behind the cluster, so a browser test that needs to know whether a
    // (re)bind has reached this tab's cluster reads the live snapshot instead.
    window.__vueBus = () => bus.value;

    const publishDraft = () => {
      let payload;
      try {
        payload = JSON.parse(draft.value);
      } catch {
        payload = draft.value;
      }
      bus.value?.publish(topic.value, payload);
    };

    return () =>
      h('div', null, [
        h('h1', null, 'Vue × 跨 Tab 数据总线'),
        h('p', null, '本页完全使用 cross-tab-worker-databus/vue 的组合式 API。打开多个标签，消息会经 Worker 集群扇出到所有标签。'),
        h('p', null, [
          h('span', { id: 'statusBadge', class: `badge ${status.value}` }, `状态: ${status.value}`),
          h('span', { id: 'receivedCount' }, `  已接收 ${messages.value.length} 条`),
          h('span', { id: 'topicBadge' }, `  Topic: ${topic.value}`)
        ]),
        h('input', { id: 'topicInput', value: topicInput.value, placeholder: 'topic', onInput: event => { topicInput.value = event.target.value; } }),
        h('input', {
          id: 'draftInput',
          value: draft.value,
          placeholder: 'JSON payload',
          style: { width: '320px' },
          onInput: event => { draft.value = event.target.value; }
        }),
        h('button', { id: 'publishButton', onClick: publishDraft }, '发布'),
        h('h2', null, '最近消息'),
        h('ul', { id: 'messageList' }, messages.value.map((text, index) => h('li', { key: `${index}-${text}` }, text)))
      ]);
  }
});

createApp(App).mount('#app');
