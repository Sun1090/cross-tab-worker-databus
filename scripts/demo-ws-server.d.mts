import type { Server } from 'node:http';
import type { DemoWebSocketConnection } from './demo-centrifuge-server.mjs';

export declare const demoWsBusPath: string;

export declare function matchesDemoTopic(pattern: string, topic: string): boolean;

export declare function installDemoWsBusServer(
  httpServer: Server,
  pathname?: string
): DemoWsBusHub;

export declare class DemoWsBusHub {
  constructor(options?: { now?: () => number });
  now: () => number;
  clients: Set<DemoWebSocketConnection>;
  subscriptions: Map<DemoWebSocketConnection, Set<string>>;

  attach(connection: DemoWebSocketConnection): void;
  detach(connection: DemoWebSocketConnection): void;
  handleFrame(connection: DemoWebSocketConnection, text: string): boolean;
  publish(
    topic: string,
    data: unknown,
    binary?: boolean,
    metadata?: { messageId?: string; timestamp?: number }
  ): void;
}
