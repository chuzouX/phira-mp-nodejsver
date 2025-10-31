/*
 * MIT License
 * Copyright (c) 2024
 */

import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Logger } from '../logging/logger';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';

export class WebSocketGateway {
  private wss?: WebSocketServer;

  constructor(
    private readonly logger: Logger,
    private readonly protocolHandler: ProtocolHandler,
  ) {}

  attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on('connection', (socket: WebSocket) => {
      const connectionId = this.generateConnectionId();
      this.protocolHandler.handleConnection(connectionId);

      socket.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.protocolHandler.handleMessage(connectionId, message);
        } catch (error) {
          this.logger.error('Invalid message received', {
            connectionId,
            error: (error as Error).message,
          });
        }
      });

      socket.on('close', () => {
        this.protocolHandler.handleDisconnection(connectionId);
      });

      socket.on('error', (error) => {
        this.logger.error('WebSocket error', {
          connectionId,
          error: error.message,
        });
      });
    });

    this.logger.info('WebSocket gateway attached to HTTP server');
  }

  close(): void {
    this.wss?.close();
  }

  private generateConnectionId(): string {
    return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
