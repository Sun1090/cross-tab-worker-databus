import type { Server } from 'node:http';

export declare const demoWebSocketPath: string;

export interface DemoWebSocketSocket {
  destroyed: boolean;
  setNoDelay(noDelay?: boolean): void;
  write(data: Buffer): boolean;
  end(): void;
  destroy(): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

export declare class DemoCentrifugeHub {
  clients: Set<DemoWebSocketConnection>;
  channels: Map<string, { epoch: string; offset: number; subscriptions: Set<string> }>;
  pingTimer: ReturnType<typeof setInterval> | null;

  attach(connection: DemoWebSocketConnection): void;
  detach(connection: DemoWebSocketConnection): void;
  handleCommands(connection: DemoWebSocketConnection, text: string): void;
  handleCommand(connection: DemoWebSocketConnection, command: Record<string, unknown>): void;
  ensureChannel(channel: string): { epoch: string; offset: number; subscriptions: Set<string> };
  broadcast(channel: string, push: unknown): void;
  pingClients(): void;
}

export declare class DemoWebSocketConnection {
  constructor(socket: DemoWebSocketSocket, bufferedHead?: Buffer);

  readonly id: string;
  socket: DemoWebSocketSocket;
  buffer: Buffer;
  client: string;
  session: string;
  node: string;
  channels: Set<string>;
  textBuffer: string;
  messageHandlers: Array<(text: string) => void>;
  closeHandlers: Array<() => void>;

  onMessage(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
  subscribe(channel: string): void;
  unsubscribe(channel: string): void;
  sendReply(id: unknown, result: Record<string, unknown>): void;
  sendPush(push: unknown): void;
  sendText(text: string): void;
  close(code?: number, reason?: string): void;
  writeFrame(opcode: number, payload: Buffer): void;
  handleData(chunk: Buffer): void;
  handleFrame(opcode: number, payload: Buffer): void;
  notifyClose(): void;
}

export declare function installDemoWebSocketServer(
  httpServer: Server,
  pathname?: string
): DemoCentrifugeHub;
