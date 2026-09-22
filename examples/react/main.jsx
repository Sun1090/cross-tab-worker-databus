/**
 * React usage example for cross-tab-worker-databus.
 *
 * Demonstrates the framework-agnostic core inside a React component tree:
 * - one bus instance per app, created in an effect and stopped on unmount;
 * - handlers attached with subscribe() and cleaned up via the returned
 *   unsubscribe function (no stale-closure leaks across renders);
 * - connection status via onStatus();
 * - safe under <StrictMode>: the double-invoked effect stops and recreates
 *   the bus, exercising the same suspend/resume path as BFCache.
 *
 * This page hand-wires the core API rather than importing
 * `cross-tab-worker-databus/hooks`; the shipped React adapter is covered by
 * tests/hooks.test.tsx. React itself comes from the local install through
 * examples/react/vendor/react.esm.js (`pnpm build:examples`), so the page needs
 * no network and is driven by e2e/adapters.spec.ts. No JSX syntax appears below
 * on purpose: the page is served as-is, and the dev server does not transform it.
 *
 * Requires `pnpm build` (imports from dist/) and serves the same local demo
 * Centrifugo endpoint as examples/demo (pnpm examples).
 */
import { StrictMode, createElement, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createCentrifugeDataBus } from '../../dist/centrifuge.js';

const localDemoUrl = `${location.protocol}//${location.host}/centrifuge/demo/connection/websocket`.replace('http:', 'ws:');
// Same convention as examples/vue: the demo server broadcasts per topic, so a
// browser test gives each page its own `?topic=` to keep its traffic separate.
const queryTopic = new URL(location.href).searchParams.get('topic');

function useCrossTabBus(topic) {
  const [status, setStatus] = useState('connecting');
  const [messages, setMessages] = useState([]);
  const [received, setReceived] = useState(0);
  const counterRef = useRef(0);
  const busRef = useRef(null);

  useEffect(() => {
    const bus = createCentrifugeDataBus({ connection: { url: localDemoUrl, options: {} } });
    busRef.current = bus;
    // Diagnostics hook, same convention as examples/demo and examples/vue: the
    // rendered DOM lags the cluster, so a browser test that needs to know whether
    // a (re)bind has reached this tab's cluster reads the live snapshot instead.
    window.__reactBus = () => busRef.current;
    const offStatus = bus.onStatus(setStatus);
    const offMessage = bus.subscribe(topic, ({ data }) => {
      counterRef.current += 1;
      setReceived(counterRef.current);
      setMessages(previous => [...previous.slice(-49), JSON.stringify(data)]);
    });
    void bus.ready().catch(() => {});
    return () => {
      offMessage();
      offStatus();
      busRef.current = null;
      void bus.stop();
    };
  }, [topic]);

  const publish = payload => {
    busRef.current?.publish(topic, payload);
  };

  return { status, messages, received, publish };
}

function App() {
  const [topicInput, setTopicInput] = useState(queryTopic || 'react.example');
  // The bus rejects an empty topic at its own boundary, so the page owns the
  // fallback: clearing the box rebinds to the default rather than throwing
  // inside the subscription effect.
  const topic = topicInput.trim() || 'react.example';
  const [draft, setDraft] = useState('{"hello":"from-react"}');
  const { status, messages, received, publish } = useCrossTabBus(topic);

  const publishDraft = () => {
    let payload;
    try {
      payload = JSON.parse(draft);
    } catch {
      payload = draft;
    }
    publish(payload);
  };

  return createElement(
    'div',
    null,
    createElement('h1', null, 'React × 跨 Tab 数据总线'),
    createElement('p', null, '打开多个本页面标签，消息会经 Worker 集群扇出到所有标签。'),
    createElement(
      'p',
      null,
      createElement('span', { id: 'statusBadge', className: `badge ${status}` }, `状态: ${status}`),
      createElement('span', { id: 'receivedCount' }, `  已接收 ${received} 条`),
      createElement('span', { id: 'topicBadge' }, `  Topic: ${topic}`)
    ),
    createElement('input', {
      id: 'topicInput',
      value: topicInput,
      onChange: event => setTopicInput(event.target.value),
      placeholder: 'topic'
    }),
    createElement('input', {
      id: 'draftInput',
      value: draft,
      onChange: event => setDraft(event.target.value),
      placeholder: 'JSON payload',
      style: { width: '320px' }
    }),
    createElement('button', { id: 'publishButton', onClick: publishDraft }, '发布'),
    createElement('h2', null, '最近消息'),
    createElement(
      'ul',
      { id: 'messageList' },
      messages.map((text, index) => createElement('li', { key: `${index}-${text}` }, text))
    )
  );
}

createRoot(document.querySelector('#root')).render(
  createElement(StrictMode, null, createElement(App))
);
