import * as net from 'net';
import { BinaryWriter, buildPacket, parseHeader } from './protocol';
import { ClientCommand, ServerCommand } from './commands';
import { Metrics } from './metrics';

export interface PhiraClient {
  id: number;
  connect(): Promise<void>;
  authenticate(token: string): Promise<boolean>;
  createRoom(roomId: string): Promise<boolean>;
  joinRoom(roomId: string): Promise<boolean>;
  leaveRoom(): Promise<boolean>;
  sendChat(content: string): Promise<void>;
  close(): void;
}

export function createClient(
  host: string,
  port: number,
  id: number,
  metrics: Metrics,
): PhiraClient {
  let socket: net.Socket | null = null;
  let buffer = Buffer.alloc(0);
  let msgResolvers = new Map<number, (cmdType: number) => void>();

  function connectSocket(): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      socket = new net.Socket();
      socket.setNoDelay(true);
      socket.connect(port, host, () => {
        metrics.record('connect', Date.now() - start);
        resolve();
      });
      socket.on('error', (err) => {
        metrics.record('connect', Date.now() - start, true);
        reject(err);
      });
      socket.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        while (true) {
          const header = parseHeader(buffer);
          if (!header) break;
          buffer = buffer.subarray(header.consumed);
          const resolvers = Array.from(msgResolvers.values());
          msgResolvers.clear();
          for (const fn of resolvers) fn(header.commandType);
        }
      });
      socket.on('close', () => {});
    });
  }

  function sendCmd(type: number, writeBody: (w: BinaryWriter) => void): Buffer {
    const w = new BinaryWriter();
    writeBody(w);
    const body = w.toBuffer();
    const packet = buildPacket(type, body);
    socket!.write(packet);
    return body;
  }

  function waitResponse(timeoutMs = 5000): Promise<number> {
    return new Promise((resolve) => {
      const key = Math.random();
      msgResolvers.set(key, resolve);
      setTimeout(() => {
        if (msgResolvers.has(key)) { msgResolvers.delete(key); resolve(-1); }
      }, timeoutMs);
    });
  }

  async function runCmd(name: string, type: number, fn: (w: BinaryWriter) => void): Promise<boolean> {
    const start = Date.now();
    try {
      sendCmd(type, fn);
      const resp = await waitResponse();
      const ok = resp !== -1 && resp !== ServerCommand.Authenticate;
      metrics.record(name, Date.now() - start, !ok);
      return ok;
    } catch {
      metrics.record(name, Date.now() - start, true);
      return false;
    }
  }

  return {
    id,
    async connect() { return connectSocket(); },
    async authenticate(token: string) {
      return runCmd('auth', ClientCommand.Authenticate, (w) => { w.string(token); });
    },
    async createRoom(roomId: string) {
      return runCmd('create_room', ClientCommand.CreateRoom, (w) => { w.string(roomId); });
    },
    async joinRoom(roomId: string) {
      return runCmd('join_room', ClientCommand.JoinRoom, (w) => { w.string(roomId); w.bool(false); });
    },
    async leaveRoom() {
      return runCmd('leave_room', ClientCommand.LeaveRoom, () => {});
    },
    async sendChat(content: string) {
      const start = Date.now();
      try {
        sendCmd(ClientCommand.Chat, (w) => { w.string(content); });
        metrics.record('chat', Date.now() - start);
      } catch {
        metrics.record('chat', Date.now() - start, true);
      }
    },
    close() { socket?.destroy(); },
  };
}
