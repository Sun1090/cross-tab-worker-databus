import { createCentrifugeDataBus } from 'cross-tab-worker-databus/centrifuge';

interface ResourceEvent {
  id: string;
  version: number;
  content: unknown;
}

const bus = createCentrifugeDataBus<ResourceEvent>({
  connection: {
    url: 'wss://example.test/connection/websocket'
  }
});

const unsubscribe = bus.subscribe('resource.changed', ({ data }) => {
  applyResourceEvent(data);
});

void bus.ready();

export { bus, unsubscribe };

declare function applyResourceEvent(event: ResourceEvent): void;
