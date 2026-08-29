/**
 * React usage example for cross-tab-worker-databus.
 *
 * Demonstrates the framework-agnostic core inside a React (18, ESM via
 * esm.sh) component tree:
 * - one bus instance per app, created in an effect and stopped on unmount;
 * - handlers attached with subscribe() and cleaned up via the returned
 *   unsubscribe function (no stale-closure leaks across renders);
 * - connection status via onStatus();
 * - safe under <StrictMode>: the double-invoked effect stops and recreates
 *   the bus, exercising the same suspend/resume path as BFCache.
 *
 * Requires `pnpm build` (imports from dist/) and serves the same local demo
 * Centrifugo endpoint as examples/demo (pnpm examples).
 */
import { StrictMode, createElement, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createCentrifugeDataBus } from '../../dist/centrifuge.js';

const localDemoUrl = `${location.protocol}//${location.host}/centrifuge/demo/connection/websocket`.replace('http:', 'ws:');

function useCrossTabBus(topic) {
  const [status, setStatus] = useState('connecting');
  const [messages, setMessages] = useState([]);
  const [received, setReceived] = useState(0);
  const counterRef = useRef(0);
  const busRef = useRef(null);

  useEffect(() => {
    const bus = createCentrifugeDataBus({ connection: { url: localDemoUrl, options: {} } });
    busRef.current = bus;
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
  const [topic, setTopic] = useState('react.example');
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
      createElement('span', { className: `badge ${status}` }, `状态: ${status}`),
      `  已接收 ${received} 条`
    ),
    createElement('input', {
      value: topic,
      onChange: event => setTopic(event.target.value),
      placeholder: 'topic'
    }),
    createElement('input', {
      value: draft,
      onChange: event => setDraft(event.target.value),
      placeholder: 'JSON payload',
      style: { width: '320px' }
    }),
    createElement('button', { onClick: publishDraft }, '发布'),
    createElement('h2', null, '最近消息'),
    createElement(
      'ul',
      null,
      messages.map((text, index) => createElement('li', { key: `${index}-${text}` }, text))
    )
  );
}

createRoot(document.querySelector('#root')).render(
  createElement(StrictMode, null, createElement(App))
);
