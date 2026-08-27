/// <reference lib="webworker" />

/**
 * Dedicated Worker hosting a single Centrifuge WebSocket client.
 *
 * Receives INIT/SUBSCRIBE/UNSUBSCRIBE/PUBLISH/STOP messages from the main thread
 * and delegates them to a shared CentrifugeSession. This worker is created once
 * per tab, keeping the WebSocket lifecycle off the UI thread.
 */

import type { CentrifugeWorkerInput } from '../centrifuge-protocol';
import { CentrifugeSession } from '../centrifuge-session';

const workerScope = self as DedicatedWorkerGlobalScope;
// One session per dedicated Worker — this process owns exactly one connection.
const session = new CentrifugeSession({
  post: (message, transfer) => {
    // Transferable buffers are forwarded when present (zero-copy ArrayBuffer);
    // otherwise the message is structured-cloned normally.
    if (transfer) workerScope.postMessage(message, transfer as Transferable[]);
    else workerScope.postMessage(message);
  }
});

workerScope.addEventListener('message', event => {
  session.handle(event.data as CentrifugeWorkerInput);
});
