/*
 * MIT License
 * Copyright (c) 2024
 */

import { Server as NetServer, Socket, createServer } from 'net';
import { Logger } from '../logging/logger';
import { ProtocolHandler, ProtocolMessage } from '../domain/protocol/ProtocolHandler';

export class TcpServer {
  private server?: NetServer;
  private readonly connections = new Map<string, Socket>();

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
      // Close all active connections
      this.connections.forEach((socket, connectionId) => {
        socket.destroy();
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
    this.connections.set(connectionId, socket);

    this.logger.info('TCP connection established', {
      connectionId,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
    });

    this.protocolHandler.handleConnection(connectionId);

    socket.on('data', (data: Buffer) => {
      try {
        // Try to parse as JSON message
        const message = JSON.parse(data.toString()) as ProtocolMessage;
        this.protocolHandler.handleMessage(connectionId, message);
      } catch (error) {
        this.logger.error('Invalid message received', {
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

  private generateConnectionId(): string {
    return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  getServer(): NetServer | undefined {
    return this.server;
  }
}
