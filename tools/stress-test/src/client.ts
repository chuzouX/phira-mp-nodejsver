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
  useProxy: boolean = false,
): PhiraClient {
  let socket: net.Socket | null = null;
  let buffer = Buffer.alloc(0);
  let msgResolvers = new Map<number, { resolve: (cmdType: number) => void; expectedTypes: number[] }>();

  const PROXY_V2_LOCAL = Buffer.from([
    0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A,
    0x20, 0x00, 0x00, 0x00,
  ]);

  function connectSocket(): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      socket = new net.Socket();
      socket.setNoDelay(true);
      socket.connect(port, host, () => {
        if (useProxy) {
          socket!.write(PROXY_V2_LOCAL);
        }
        socket!.write(Buffer.from([0x01])); // protocol version = 1
        metrics.record('connect', Date.now() - start);
        resolve();
      });
      socket.on('error', (err) => {
        metrics.record('connect', Date.now() - start, true);
        reject(err);
      });
      socket.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        if (process.env.DEBUG) console.log('[tcp] recv ' + data.length + ' bytes, buf now ' + buffer.length);
        while (true) {
          const header = parseHeader(buffer);
          if (!header) break;
          buffer = buffer.subarray(header.consumed);
          if (process.env.DEBUG) console.log('[tcp] parsed cmd=' + header.commandType + ' bodyLen=' + header.body.length + ' resolvers=' + msgResolvers.size);

          for (const [key, entry] of msgResolvers) {
            if (entry.expectedTypes.includes(header.commandType)) {
              if (process.env.DEBUG) console.log('[tcp] MATCH cmd=' + header.commandType + ' resolver=' + entry.expectedTypes);
              msgResolvers.delete(key);
              entry.resolve(header.commandType);
              break;
            }
            if (process.env.DEBUG) console.log('[tcp] SKIP cmd=' + header.commandType + ' vs expected=' + entry.expectedTypes);
          }
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

  function waitResponse(expectedTypes: number[], timeoutMs = 5000): Promise<number> {
    return new Promise((resolve) => {
      const key = Math.random();
      msgResolvers.set(key, { resolve, expectedTypes });
      setTimeout(() => {
        if (msgResolvers.has(key)) { msgResolvers.delete(key); resolve(-1); }
      }, timeoutMs);
    });
  }

  async function runCmd(name: string, type: number, fn: (w: BinaryWriter) => void, expectedRespTypes: number[] = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]): Promise<boolean> {
    const start = Date.now();
    try {
      sendCmd(type, fn);
      const resp = await waitResponse(expectedRespTypes);
      const ok = resp >= 0;
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
      return runCmd('auth', ClientCommand.Authenticate, (w) => { w.string(token); }, [ServerCommand.Authenticate]);
    },
    async createRoom(roomId: string) {
      return runCmd('create_room', ClientCommand.CreateRoom, (w) => { w.string(roomId); }, [ServerCommand.CreateRoom]);
    },
    async joinRoom(roomId: string) {
      return runCmd('join_room', ClientCommand.JoinRoom, (w) => { w.string(roomId); w.bool(false); }, [ServerCommand.JoinRoom]);
    },
    async leaveRoom() {
      return runCmd('leave_room', ClientCommand.LeaveRoom, () => {}, [ServerCommand.LeaveRoom]);
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
