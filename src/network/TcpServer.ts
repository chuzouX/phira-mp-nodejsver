/*
 * MIT License
 * Copyright (c) 2024
 */

import { Server as NetServer, Socket, createServer } from 'net';
import { Logger } from '../logging/logger';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { BinaryReader, BinaryWriter } from '../domain/protocol/BinaryProtocol';
import { ClientCommandType, CommandParser, ServerCommand, ServerCommandType } from '../domain/protocol/Commands';

const PROTOCOL_VERSION = 1;

// Source: phira-mp-common/src/lib.rs:17-19
const HEARTBEAT_DISCONNECT_TIMEOUT_MS = 10_000; // 10 seconds

interface ConnectionState {
  socket: Socket;
  versionReceived: boolean;
  buffer: Buffer;
  version?: number;
  lastReceivedTime: number;
  timeoutCheckInterval?: NodeJS.Timeout;
}

export class TcpServer {
  private server?: NetServer;
  private readonly connections = new Map<string, ConnectionState>();

  constructor(
    private readonly logger: Logger,
    private readonly protocolHandler: ProtocolHandler,
  ) {}

  start(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer((socket: Socket) => {
          this.handleConnection(socket);
        });

        this.server.listen(port, host, () => {
          const address = this.server?.address();
          const runtimeHost = typeof address === 'object' && address ? address.address : host;
          const runtimePort = typeof address === 'object' && address ? address.port : port;

          this.logger.info('TCP 服务器已启动：', { host: runtimeHost, port: runtimePort });
          resolve();
        });

        this.server.on('error', (error) => {
          this.logger.error('TCP 服务器错误：', { error: error.message });
          reject(error);
        });
      } catch (error) {
        this.logger.error('启动 TCP 服务器失败：', {
          error: (error as Error).message,
        });
        reject(error);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.connections.forEach((state, connectionId) => {
        this.clearTimeoutMonitor(state);
        state.socket.destroy();
        this.logger.debug('关机时关闭连接：', { connectionId });
      });
      this.connections.clear();

      if (!this.server) {
        this.logger.info('已关闭 TCP 服务器');
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = undefined;
        this.logger.info('已关闭 TCP 服务器');
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    const connectionId = this.generateConnectionId();

    const state: ConnectionState = {
      socket,
      versionReceived: false,
      buffer: Buffer.alloc(0),
      lastReceivedTime: Date.now(),
    };

    this.connections.set(connectionId, state);

    this.logger.debug('建立TCP连接：', {
      connectionId,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
    });

    this.protocolHandler.handleConnection(connectionId);
    this.startTimeoutMonitor(connectionId, state);

    socket.on('data', (data: Buffer) => {
      try {
        state.lastReceivedTime = Date.now();
        state.buffer = Buffer.concat([state.buffer, data]);

        if (!state.versionReceived) {
          if (state.buffer.length >= 1) {
            const version = state.buffer[0];
            state.buffer = state.buffer.subarray(1);
            state.versionReceived = true;
            state.version = version;

            this.logger.debug('收到协议版本信息：', { connectionId, version });

            if (version !== PROTOCOL_VERSION) {
              this.logger.warn('客户端协议版本不匹配：', {
                connectionId,
                expected: PROTOCOL_VERSION,
                received: version,
              });
            }
          } else {
            return;
          }
        }

        this.processPackets(connectionId, state);
      } catch (error) {
        this.logger.error('处理数据失败：', {
          connectionId,
          error: (error as Error).message,
        });
      }
    });

    socket.on('close', () => {
      this.clearTimeoutMonitor(state);
      this.connections.delete(connectionId);
      this.protocolHandler.handleDisconnection(connectionId);
      this.logger.debug('TCP 连接被关闭：', { connectionId });
    });

    socket.on('error', (error) => {
      this.logger.error('TCP 通信错误：', {
        connectionId,
        error: error.message,
      });
    });
  }

  // Source: phira-mp-server/src/session.rs:284-300
  // Monitor last received time and disconnect after HEARTBEAT_DISCONNECT_TIMEOUT
  private startTimeoutMonitor(connectionId: string, state: ConnectionState): void {
    this.clearTimeoutMonitor(state);

    // Check every second if we should disconnect
    state.timeoutCheckInterval = setInterval(() => {
      const timeSinceLastReceived = Date.now() - state.lastReceivedTime;
      
      if (timeSinceLastReceived > HEARTBEAT_DISCONNECT_TIMEOUT_MS) {
        this.logger.warn('Connection timeout - no messages received', {
          connectionId,
          timeSinceLastReceived,
          timeoutMs: HEARTBEAT_DISCONNECT_TIMEOUT_MS,
        });
        state.socket.destroy(new Error('Connection timeout'));
      }
    }, 1000);
  }

  private clearTimeoutMonitor(state: ConnectionState): void {
    if (state.timeoutCheckInterval) {
      clearInterval(state.timeoutCheckInterval);
      state.timeoutCheckInterval = undefined;
    }
  }

  private processPackets(connectionId: string, state: ConnectionState): void {
    while (true) {
      if (state.buffer.length === 0) {
        break;
      }

      const lengthResult = this.readULEB(state.buffer);
      if (lengthResult === null) {
        break;
      }

      const { value: packetLength, bytesRead: lengthBytes } = lengthResult;

      if (state.buffer.length < lengthBytes + packetLength) {
        break;
      }

      const packetData = state.buffer.subarray(lengthBytes, lengthBytes + packetLength);
      state.buffer = state.buffer.subarray(lengthBytes + packetLength);

      try {
        const reader = new BinaryReader(packetData);
        const parsed = CommandParser.parseClientCommand(reader);

        if (parsed.command) {
          // Source: phira-mp-server/src/session.rs:164-166
          // Client sends Ping, server responds with Pong immediately
          if (parsed.command.type === ClientCommandType.Ping) {
            this.logger.debug('Ping received, sending Pong', { connectionId });
            this.sendCommand(state.socket, { type: ServerCommandType.Pong });
            continue;
          }

          this.protocolHandler.handleMessage(
            connectionId,
            parsed.command,
            (response: ServerCommand) => {
              this.sendCommand(state.socket, response);
            },
          );
        } else {
          this.logger.debug('未处理的命令类型：', {
            connectionId,
            rawType: parsed.rawType,
          });
        }
      } catch (error) {
        this.logger.error('收到非法的包：', {
          connectionId,
          error: (error as Error).message,
        });
      }
    }
  }

  private readULEB(buffer: Buffer): { value: number; bytesRead: number } | null {
    let result = 0;
    let shift = 0;
    let bytesRead = 0;

    while (bytesRead < buffer.length) {
      const byte = buffer[bytesRead];
      bytesRead++;

      result |= (byte & 0x7f) << shift;
      shift += 7;

      if ((byte & 0x80) === 0) {
        return { value: result, bytesRead };
      }

      if (shift > 32) {
        throw new Error('无效的ULEB编码');
      }
    }

    return null;
  }

  private sendCommand(socket: Socket, command: ServerCommand): void {
    try {
      const writer = new BinaryWriter();
      CommandParser.writeServerCommand(writer, command);
      const payload = writer.toBuffer();

      const lengthBuffer = this.writeULEB(payload.length);

      socket.write(lengthBuffer);
      socket.write(payload);
    } catch (error) {
      this.logger.error('发送命令失败：', {
        error: (error as Error).message,
      });
    }
  }

  private writeULEB(value: number): Buffer {
    const bytes: number[] = [];
    let v = value;

    while (true) {
      let byte = v & 0x7f;
      v >>= 7;

      if (v !== 0) {
        byte |= 0x80;
      }

      bytes.push(byte);

      if (v === 0) {
        break;
      }
    }

    return Buffer.from(bytes);
  }

  private generateConnectionId(): string {
    return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  getServer(): NetServer | undefined {
    return this.server;
  }
}
