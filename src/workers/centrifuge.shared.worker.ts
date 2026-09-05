/// <reference lib="webworker" />

/**
 * SharedWorker hosting one independent Centrifuge WebSocket client per tab.
 *
 * Each connecting tab receives its own MessagePort with an independent
 * CentrifugeSession and its own WebSocket connection. When a tab sends STOP,
 * its port is removed from the session map while the remaining tabs continue
 * to operate.
 *
 * A periodic reaper (PortReaper) closes sessions for ports that have stopped
 * sending messages (e.g. crashed tabs). The reaper cadence is adaptive: it runs
 * at the smallest configured heartbeat interval across active ports, derived
 * from the `heartbeatIntervalMs` the main thread sends in the INIT message.
 * The interval is cleared when the last port is disconnected.
 */

import type { CentrifugeWorkerInput } from '../centrifuge-protocol';
import { CentrifugeSession } from '../centrifuge-session';
import { PortReaper } from './port-reaper';
import { CENTRIFUGE_INPUT_TYPE } from '../utils/constants';

const sharedWorkerScope = self as unknown as SharedWorkerGlobalScope;
// One session per connecting port — each tab gets its own subscription scope.
const reaper = new PortReaper();

sharedWorkerScope.addEventListener('connect', event => {
  const port = event.ports[0];
  if (!port) return;
  const session = new CentrifugeSession({
    post: (message, transfer) => {
      // Transferable buffers are forwarded when present (zero-copy ArrayBuffer);
      // otherwise the message is structured-cloned normally.
      if (transfer) port.postMessage(message, transfer as Transferable[]);
      else port.postMessage(message);
    }
  });
  reaper.register(port, {
    close: () => port.close(),
    stop: () => session.handle({ type: CENTRIFUGE_INPUT_TYPE.STOP })
  });
  port.addEventListener('message', event => {
    const message = event.data as CentrifugeWorkerInput;
    reaper.touch(port);
    if (message.type === CENTRIFUGE_INPUT_TYPE.PING) return;
    if (message.type === CENTRIFUGE_INPUT_TYPE.STOP) {
      // Remove from reaper tracking first, then close the port so the
      // session's disconnected status post is discarded, then stop the
      // session to cleanly disconnect its WebSocket.
      reaper.remove(port);
      port.close();
      session.handle({ type: CENTRIFUGE_INPUT_TYPE.STOP });
      return;
    }
    // Capture the heartbeat config from the first (INIT) message so the
    // reaper uses the correct per-port timeout.
    if (message.type === CENTRIFUGE_INPUT_TYPE.INIT && typeof message.heartbeatIntervalMs === 'number') {
      reaper.setTimeout(port, message.heartbeatIntervalMs);
    }
    session.handle(message);
  });
  port.start();
});