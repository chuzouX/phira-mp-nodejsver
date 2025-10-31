/*
 * MIT License
 * Copyright (c) 2024
 */

import { Server as NetServer, Socket, createServer } from 'net';
import { Logger } from '../logging/logger';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { BinaryReader, BinaryWriter } from '../domain/protocol/BinaryProtocol';
import { CommandParser, ServerCommand } from '../domain/protocol/Commands';

const PROTOCOL_VERSION = 1;

interface ConnectionState {
  socket: Socket;
  versionReceived: boolean;
  buffer: Buffer;
  version?: number;
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

          this.logger.info('TCP server started', { host: runtimeHost, port: runtimePort });
          resolve();
        });

        this.server.on('error', (error) => {
          this.logger.error('TCP server error', { error: error.message });
          reject(error);
        });
      } catch (error) {
        this.logger.error('Failed to start TCP server', {
          error: (error as Error).message,
        });
        reject(error);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.connections.forEach((state, connectionId) => {
        state.socket.destroy();
        this.logger.debug('Connection closed during shutdown', { connectionId });
      });
      this.connections.clear();

      if (!this.server) {
        this.logger.info('TCP server stopped');
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = undefined;
        this.logger.info('TCP server stopped');
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
    };

    this.connections.set(connectionId, state);

    this.logger.info('TCP connection established', {
      connectionId,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
    });

    this.protocolHandler.handleConnection(connectionId);

    socket.on('data', (data: Buffer) => {
      try {
        state.buffer = Buffer.concat([state.buffer, data]);

        if (!state.versionReceived) {
          if (state.buffer.length >= 1) {
            const version = state.buffer[0];
            state.buffer = state.buffer.subarray(1);
            state.versionReceived = true;
            state.version = version;

            this.logger.debug('Protocol version received', { connectionId, version });

            if (version !== PROTOCOL_VERSION) {
              this.logger.warn('Client protocol version mismatch', {
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
        this.logger.error('Error processing data', {
          connectionId,
          error: (error as Error).message,
        });
      }
    });

    socket.on('close', () => {
      this.connections.delete(connectionId);
      this.protocolHandler.handleDisconnection(connectionId);
      this.logger.info('TCP connection closed', { connectionId });
    });

    socket.on('error', (error) => {
      this.logger.error('TCP socket error', {
        connectionId,
        error: error.message,
      });
    });
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
          this.protocolHandler.handleMessage(
            connectionId,
            parsed.command,
            (response: ServerCommand) => {
              this.sendCommand(state.socket, response);
            },
          );
        } else {
          this.logger.debug('Unhandled command type', {
            connectionId,
            rawType: parsed.rawType,
          });
        }
      } catch (error) {
        this.logger.error('Invalid packet received', {
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
        throw new Error('Invalid ULEB encoding');
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
      this.logger.error('Failed to send command', {
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
