import { CrossTabDataBus, selectWorkerBackend } from '../../dist/index.js';
import { createCentrifugeDataBus } from '../../dist/centrifuge.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const publicDemoUrl = 'wss://faye.centrifugal.dev/connection/websocket';
const localDemoUrl = `${location.protocol}//${location.host}/centrifuge/demo/connection/websocket`.replace(
  'http:',
  'ws:'
);

const elements = {
  tabBadge: document.querySelector('#tabBadge'),
  backendBadge: document.querySelector('#backendBadge'),
  statusBadge: document.querySelector('#statusBadge'),
  flowSvg: document.querySelector('#flowSvg'),
  nodeThisSub: document.querySelector('#nodeThisSub'),
  nodeWorkerSub: document.querySelector('#nodeWorkerSub'),
  nodeServerSub: document.querySelector('#nodeServerSub'),
  nodeOthersSub: document.querySelector('#nodeOthersSub'),
  eventBody: document.querySelector('#eventBody'),
  eventCounter: document.querySelector('#eventCounter'),
  clearLog: document.querySelector('#clearLog'),
  modeSwitch: document.querySelector('#modeSwitch'),
  modeButtons: [...document.querySelectorAll('#modeSwitch .seg')],
  urlInput: document.querySelector('#urlInput'),
  urlField: document.querySelector('#urlField'),
  endpointPreset: document.querySelector('#endpointPreset'),
  connectionHint: document.querySelector('#connectionHint'),
  workerMode: document.querySelector('#workerMode'),
  workerModeField: document.querySelector('#workerModeField'),
  transferable: document.querySelector('#transferable'),
  transferableField: document.querySelector('#transferableField'),
  topicInput: document.querySelector('#topicInput'),
  applyConnection: document.querySelector('#applyConnection'),
  openTab: document.querySelector('#openTab'),
  payloadInput: document.querySelector('#payloadInput'),
  publishJson: document.querySelector('#publishJson'),
  publishBinary: document.querySelector('#publishBinary'),
  autoPublish: document.querySelector('#autoPublish'),
  metricPublished: document.querySelector('#metricPublished'),
  metricReceived: document.querySelector('#metricReceived'),
  metricP50: document.querySelector('#metricP50'),
  metricP95: document.querySelector('#metricP95'),
  metricAvg: document.querySelector('#metricAvg'),
  metricRtt: document.querySelector('#metricRtt'),
  coordinationBadge: document.querySelector('#coordinationBadge'),
  subscribedCount: document.querySelector('#subscribedCount'),
  assignedCount: document.querySelector('#assignedCount'),
  workerCount: document.querySelector('#workerCount'),
  activeWorkerCount: document.querySelector('#activeWorkerCount'),
  standbyWorkerCount: document.querySelector('#standbyWorkerCount'),
  visibleTabCount: document.querySelector('#visibleTabCount'),
  hiddenTabCount: document.querySelector('#hiddenTabCount'),
  workersBody: document.querySelector('#workersBody'),
  routesBody: document.querySelector('#routesBody'),
  overviewCoordination: document.querySelector('#overviewCoordination'),
  overviewActiveWorkers: document.querySelector('#overviewActiveWorkers'),
  overviewStandbyWorkers: document.querySelector('#overviewStandbyWorkers'),
  overviewVisibleTabs: document.querySelector('#overviewVisibleTabs'),
  overviewHiddenTabs: document.querySelector('#overviewHiddenTabs'),
  overviewClusterInfo: document.querySelector('#overviewClusterInfo'),
  overviewRoutingInfo: document.querySelector('#overviewRoutingInfo'),
  configModeBadge: document.querySelector('#configModeBadge'),
  configTransport: document.querySelector('#configTransport'),
  configWorkerMode: document.querySelector('#configWorkerMode'),
  configBackend: document.querySelector('#configBackend'),
  configTransferable: document.querySelector('#configTransferable'),
  configClusterKey: document.querySelector('#configClusterKey'),
  configTabId: document.querySelector('#configTabId'),
  configTopic: document.querySelector('#configTopic'),
  configEndpoint: document.querySelector('#configEndpoint')
};

elements.urlInput.value = localDemoUrl;

const statusText = {
  connecting: '连接中',
  connected: '已连接',
  disconnected: '已断开',
  error: '错误'
};

const flowPaths = {
  publish: [
    'M160 70 C 210 70 230 70 260 70',
    'M440 70 C 460 70 480 70 500 70',
    'M670 70 C 700 70 730 70 760 70'
  ],
  receive: [
    'M760 70 C 730 70 700 70 670 70',
    'M500 70 C 480 70 460 70 440 70',
    'M260 70 C 230 70 210 70 160 70'
  ],
  other: ['M350 190 L 350 100', 'M260 70 C 230 70 210 70 160 70']
};

const flowColors = {
  publish: '#d9480f',
  receive: '#0f766e',
  other: '#4f46e5'
};

const state = {
  bus: null,
  topic: 'demo.flow',
  tabId: '',
  backend: 'local',
  clusterKey: '',
  activeTransport: 'centrifugo',
  seq: 0,
  published: 0,
  received: 0,
  lastMetrics: null,
  autoHandle: null
};

class LocalBroadcastTransport {
  constructor(channelName) {
    this.channelName = channelName;
    this.channel = null;
    this.handlers = null;
    this.topics = new Set();
  }

  start(_config, handlers) {
    this.handlers = handlers;
    try {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.addEventListener('message', event => this.handleMessage(event.data));
      this.channel.addEventListener('messageerror', () => handlers.onError(new Error('消息解码失败')));
    } catch {
      this.channel = null;
    }
    handlers.onStatus('connected');
  }

  subscribe(topic) {
    this.topics.add(topic);
  }

  unsubscribe(topic) {
    this.topics.delete(topic);
  }

  publish(topic, data) {
    queueMicrotask(() => this.deliver(topic, data));
    if (this.channel) {
      this.channel.postMessage({ type: 'DATABUS_DEMO_PUB', topic, data });
    }
  }

  stop() {
    this.channel?.close();
    this.channel = null;
    this.handlers = null;
    this.topics.clear();
  }

  handleMessage(message) {
    if (!message || message.type !== 'DATABUS_DEMO_PUB') return;
    this.deliver(message.topic, message.data);
  }

  deliver(topic, data) {
    if (!this.topics.has(topic)) return;
    this.handlers?.onMessage({ topic, data });
  }
}

function createBus(mode) {
  const trace = {
    enabled: true,
    mode: 'all',
    metricsIntervalMs: 1000,
    sink: handleTraceEvent
  };
  if (mode === 'centrifugo') {
    const url = elements.urlInput.value.trim();
    const workerMode = elements.workerMode.value;
    state.backend = selectWorkerBackend(workerMode);
    state.clusterKey = url;
    return createCentrifugeDataBus({
      connection: { url, options: {} },
      workerMode,
      transferable: elements.transferable.checked,
      trace
    });
  }
  state.backend = 'local';
  state.clusterKey = 'demo.local';
  return new CrossTabDataBus({
    transport: new LocalBroadcastTransport('cross-tab-worker-databus:demo:local'),
    initialConfig: { mode: 'local' },
    clusterKey: 'demo.local',
    trace
  });
}

function currentEndpointPreset() {
  const value = elements.urlInput.value.trim();
  if (value === localDemoUrl) return 'local';
  if (value === publicDemoUrl) return 'public';
  return 'custom';
}

// Serialise connection switches: the auto-connect on page load and a manual
// "应用连接" click may overlap (the button re-enables only after `ready()`).
// Without this guard the two `applyConnection` runs interleave — each reads and
// writes `state.bus` and `setStatus` — leaving the page stuck on a stale bus.
let applying = false;
async function applyConnection() {
  if (applying) return;
  applying = true;
  elements.applyConnection.disabled = true;
  try {
    if (state.bus) await state.bus.stop();
  } catch {
    // The old bus is discarded either way.
  }
  state.bus = null;
  state.topic = elements.topicInput.value.trim() || 'demo.flow';
  state.activeTransport = getMode();
  setStatus('connecting');
  elements.backendBadge.textContent = `后端 -`;
  addFeed({ direction: '系统', pill: 'system', type: '应用连接' });
  try {
    const bus = createBus(state.activeTransport);
    state.bus = bus;
    bus.onStatus(status => setStatus(status));
    bus.onError(error => addFeed({ direction: '错误', pill: 'error', type: errorMessage(error) }));
    bus.subscribe(state.topic, message => handleReceived(message));
    await bus.ready();
    renderCluster(bus.getClusterSnapshot());
    renderBackendBadge();
    renderConfig();
    window.__bus = bus;
  } catch (error) {
    setStatus('error');
    addFeed({ direction: '错误', pill: 'error', type: errorMessage(error) });
  } finally {
    applying = false;
    elements.applyConnection.disabled = false;
  }
}

function handleReceived(message) {
  const data = decodeBinary(message.data);
  const from = getFrom(data);
  const isEcho = from === state.tabId;
  state.received += 1;
  if (isNumeric(data?.sentAt)) {
    const rtt = Math.max(0, Date.now() - data.sentAt);
    elements.metricRtt.textContent = `${rtt} ms`;
  }
  addFeed({
    direction: isEcho ? '回显' : '接收',
    pill: isEcho ? 'echo' : 'receive',
    type: data instanceof ArrayBuffer ? 'binary' : 'json',
    topic: message.topic,
    payload: describePayload(data),
    source: from ? shortId(from) : '服务器'
  });
  animateFlow(isEcho ? 'receive' : 'other');
  renderMetrics();
}

function publishPayload(payload, description) {
  if (!state.bus) return;
  state.published += 1;
  state.bus.publish(state.topic, payload);
  addFeed({
    direction: '发布',
    pill: 'publish',
    type: description.type,
    topic: state.topic,
    payload: description.payload,
    source: shortId(state.tabId || '本页')
  });
  animateFlow('publish');
  renderMetrics();
}

function publishJson() {
  let parsed = {};
  const raw = elements.payloadInput.value.trim();
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { note: raw };
    }
  }
  const payload = {
    ...parsed,
    kind: 'flow',
    from: state.tabId,
    seq: ++state.seq,
    sentAt: Date.now()
  };
  publishPayload(payload, { type: 'json', payload: describePayload(payload) });
}

function publishBinary() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  const buffer = bytes.buffer;
  publishPayload(encodeBinary(buffer), { type: 'binary', payload: `ArrayBuffer(${buffer.byteLength})` });
}

function encodeBinary(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { __bin: btoa(binary) };
}

function decodeBinary(data) {
  if (!data || typeof data !== 'object' || typeof data.__bin !== 'string') return data;
  const binary = atob(data.__bin);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function setAutoPublish(enabled) {
  if (enabled && !state.autoHandle) {
    state.autoHandle = setInterval(() => publishJson(), 2000);
    return;
  }
  if (!enabled && state.autoHandle) {
    clearInterval(state.autoHandle);
    state.autoHandle = null;
  }
}

function handleTraceEvent(event) {
  if (event.type === 'lifecycle') {
    addFeed({ direction: '系统', pill: 'system', type: `lifecycle:${event.action}` });
  }
  if (event.type === 'status') {
    addFeed({
      direction: '状态',
      pill: event.status === 'error' ? 'error' : 'system',
      type: statusText[event.status] ?? event.status
    });
  }
  if (event.type === 'error') {
    addFeed({ direction: '错误', pill: 'error', type: event.source });
    showConnectionHint();
  }
  if (event.type === 'message_metrics') {
    state.lastMetrics = event;
    renderMetrics();
  }
}

function renderMetrics() {
  elements.metricPublished.textContent = String(state.published);
  elements.metricReceived.textContent = String(state.received);
  const metrics = state.lastMetrics;
  elements.metricP50.textContent = metrics ? `${metrics.dispatchP50Ms} ms` : '-';
  elements.metricP95.textContent = metrics ? `${metrics.dispatchP95Ms} ms` : '-';
  elements.metricAvg.textContent = metrics ? `${metrics.dispatchAvgMs} ms` : '-';
}

function addFeed(entry) {
  const row = document.createElement('tr');
  const cells = [
    timeText(),
    pill(entry.direction, entry.pill),
    entry.type ?? '',
    entry.topic ?? '',
    entry.payload ?? '',
    entry.source ?? ''
  ];
  for (const [index, value] of cells.entries()) {
    const cell = document.createElement('td');
    if (index === 1 && typeof value === 'object') {
      cell.append(value);
    } else {
      cell.textContent = String(value ?? '');
    }
    if (index === 4) cell.classList.add('payload');
    if (index === 5) cell.classList.add('source');
    row.append(cell);
  }
  elements.eventBody.prepend(row);
  while (elements.eventBody.children.length > 300) {
    elements.eventBody.lastElementChild?.remove();
  }
  elements.eventCounter.textContent = `${elements.eventBody.children.length} 条`;
}

function pill(label, kind) {
  const span = document.createElement('span');
  span.className = `pill ${kind}`;
  span.textContent = label;
  return span;
}

function timeText() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

function animateFlow(kind) {
  const paths = flowPaths[kind];
  const color = flowColors[kind];
  paths.forEach((path, index) => {
    const circle = document.createElementNS(svgNamespace, 'circle');
    circle.setAttribute('r', '5');
    circle.setAttribute('fill', color);
    circle.setAttribute('opacity', '0.95');
    const motion = document.createElementNS(svgNamespace, 'animateMotion');
    motion.setAttribute('dur', '0.45s');
    motion.setAttribute('begin', `${index * 0.28}s`);
    motion.setAttribute('path', path);
    circle.append(motion);
    elements.flowSvg.append(circle);
    setTimeout(() => circle.remove(), 1500 + index * 280);
  });
}

function renderBackendBadge() {
  const label = backendLabel(state.backend);
  elements.backendBadge.textContent = label;
  elements.nodeWorkerSub.textContent = label;
}

function renderCluster(snapshot) {
  if (!snapshot) return;
  state.tabId = snapshot.currentWorker.tabId;
  elements.tabBadge.textContent = `Tab ${shortId(snapshot.currentWorker.tabId)}`;
  elements.nodeThisSub.textContent = shortId(snapshot.currentWorker.tabId);
  elements.nodeOthersSub.textContent = snapshot.workers.length > 1 ? `${snapshot.workers.length - 1} 个在线` : '无';
  elements.nodeServerSub.textContent =
    state.activeTransport === 'centrifugo' ? hostOf(elements.urlInput.value) : '本地广播';
  elements.coordinationBadge.textContent = snapshot.coordinated ? '集群协同' : '本地模式';
  elements.coordinationBadge.className = `badge ${snapshot.coordinated ? 'connected' : 'disconnected'}`;
  elements.subscribedCount.textContent = String(snapshot.subscribedTopics.length);
  elements.assignedCount.textContent = String(snapshot.assignedTopics.length);
  elements.workerCount.textContent = String(snapshot.workers.length);

  // Role stats
  const activeWorkers = snapshot.workers.filter(w => w.role === 'active');
  const standbyWorkers = snapshot.workers.filter(w => w.role === 'standby');
  const visibleTabs = snapshot.workers.filter(w => w.visibilityState === 'visible');
  const hiddenTabs = snapshot.workers.filter(w => w.visibilityState === 'hidden');
  elements.activeWorkerCount.textContent = String(activeWorkers.length);
  elements.standbyWorkerCount.textContent = String(standbyWorkers.length);
  elements.visibleTabCount.textContent = String(visibleTabs.length);
  elements.hiddenTabCount.textContent = String(hiddenTabs.length);

  // SDK overview stats
  elements.overviewCoordination.textContent = snapshot.coordinated ? '集群协同' : '本地模式';
  elements.overviewCoordination.className = `badge ${snapshot.coordinated ? 'connected' : 'disconnected'}`;
  elements.overviewActiveWorkers.textContent = String(activeWorkers.length);
  elements.overviewStandbyWorkers.textContent = String(standbyWorkers.length);
  elements.overviewVisibleTabs.textContent = String(visibleTabs.length);
  elements.overviewHiddenTabs.textContent = String(hiddenTabs.length);
  elements.overviewClusterInfo.textContent = snapshot.coordinated
    ? `BroadcastChannel + localStorage 协调 ${snapshot.workers.length} 个 Worker 角色与心跳`
    : '降级为本 Tab 独立运行，跨 Tab 广播依赖 transport';
  elements.overviewRoutingInfo.textContent =
    snapshot.assignedTopics.length > 0
      ? `当前 Worker 持有 ${snapshot.assignedTopics.length} 个 Topic；已有 owner 保持稳定，新 Topic 按负载分配`
      : '复用已有 owner；仅新 Topic 或失效 route 选择低负载 Worker';

  renderWorkers(snapshot);
  renderRoutes(snapshot.routes);
}

function renderConfig() {
  const transport = state.activeTransport;
  const mode = transport === 'centrifugo' ? elements.workerMode.value : 'local';
  const backend = state.backend;
  const transferable = transport === 'centrifugo' ? elements.transferable.checked : false;
  elements.configModeBadge.textContent = transport === 'centrifugo' ? 'Centrifugo' : '本地广播';
  elements.configModeBadge.className = `badge ${transport === 'centrifugo' ? 'connected' : 'disconnected'}`;
  elements.configTransport.textContent = transport === 'centrifugo' ? 'Centrifugo WebSocket' : 'BroadcastChannel';
  elements.configWorkerMode.textContent = mode;
  elements.configBackend.textContent = backendLabel(backend);
  elements.configTransferable.textContent = transferable ? '启用' : '禁用';
  elements.configClusterKey.textContent = state.clusterKey || '-';
  elements.configTabId.textContent = state.tabId || '-';
  elements.configTopic.textContent = state.topic || '-';
  elements.configEndpoint.textContent = transport === 'centrifugo' ? hostOf(elements.urlInput.value) : '本地';
}

function renderWorkers(snapshot) {
  elements.workersBody.replaceChildren();
  for (const worker of snapshot.workers) {
    const row = document.createElement('tr');
    if (worker.workerId === snapshot.currentWorker.workerId) row.className = 'highlight';
    appendCells(row, [
      shortId(worker.tabId),
      worker.role === 'active' ? 'active' : 'standby',
      worker.visibilityState === 'visible' ? '可见' : '隐藏',
      String(worker.load)
    ]);
    elements.workersBody.append(row);
  }
}

function renderRoutes(routes) {
  elements.routesBody.replaceChildren();
  if (routes.length === 0) {
    const row = document.createElement('tr');
    appendCells(row, ['-', '-']);
    elements.routesBody.append(row);
    return;
  }
  for (const route of routes) {
    const row = document.createElement('tr');
    appendCells(row, [shortId(route.topicKey), shortId(route.workerId)]);
    elements.routesBody.append(row);
  }
}

function appendCells(row, values) {
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = String(value);
    row.append(cell);
  }
}

function setStatus(status) {
  const badge = elements.statusBadge;
  badge.className = `badge status ${status}`;
  badge.textContent = statusText[status] ?? status;
  if (status === 'connected' || status === 'disconnected') {
    elements.connectionHint.hidden = true;
  }
  if (status === 'error') showConnectionHint();
}

function showConnectionHint() {
  if (getMode() !== 'centrifugo') return;
  elements.connectionHint.hidden = false;
  elements.connectionHint.textContent =
    currentEndpointPreset() === 'local'
      ? '本地演示端点连接失败，请确认演示服务器正在运行，或切换到“本地广播”。'
      : '公共演示端点可能已下线或受网络限制，可切换到“本地演示”或“本地广播”。';
}

function getMode() {
  return elements.modeButtons.find(button => button.classList.contains('active'))?.dataset.mode ?? 'centrifugo';
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function describePayload(data) {
  if (data instanceof ArrayBuffer) return `ArrayBuffer(${data.byteLength})`;
  if (data instanceof Uint8Array) return `Uint8Array(${data.byteLength})`;
  try {
    const text = JSON.stringify(data);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch {
    return String(data);
  }
}

function getFrom(data) {
  if (data && typeof data === 'object' && typeof data.from === 'string') return data.from;
  return undefined;
}

function isNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function shortId(value) {
  const text = String(value ?? '');
  if (text.length <= 14) return text;
  return `${text.slice(0, 10)}...`;
}

function backendLabel(backend) {
  if (backend === 'shared') return 'SharedWorker';
  if (backend === 'dedicated') return 'Dedicated Worker';
  return '主线程会话';
}

function hostOf(url) {
  try {
    if (url.trim() === localDemoUrl) return '本地演示';
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

elements.modeButtons.forEach(button => {
  button.addEventListener('click', () => {
    elements.modeButtons.forEach(item => item.classList.toggle('active', item === button));
    const mode = button.dataset.mode;
    elements.urlField.hidden = mode !== 'centrifugo';
    elements.workerModeField.hidden = mode !== 'centrifugo';
    elements.transferableField.hidden = mode !== 'centrifugo';
  });
});

elements.endpointPreset.addEventListener('change', () => {
  const preset = elements.endpointPreset.value;
  if (preset === 'local') elements.urlInput.value = localDemoUrl;
  if (preset === 'public') elements.urlInput.value = publicDemoUrl;
  elements.connectionHint.hidden = true;
});

elements.urlInput.addEventListener('input', () => {
  elements.endpointPreset.value = currentEndpointPreset();
  elements.connectionHint.hidden = true;
});

elements.applyConnection.addEventListener('click', () => void applyConnection());
elements.publishJson.addEventListener('click', publishJson);
elements.publishBinary.addEventListener('click', publishBinary);
elements.clearLog.addEventListener('click', () => {
  elements.eventBody.replaceChildren();
  elements.eventCounter.textContent = '0 条';
});
elements.openTab.addEventListener('click', () => window.open(location.href, '_blank'));
elements.autoPublish.addEventListener('change', () => setAutoPublish(elements.autoPublish.checked));

setInterval(() => {
  renderCluster(state.bus?.getClusterSnapshot());
  renderConfig();
}, 1000);
void applyConnection();
