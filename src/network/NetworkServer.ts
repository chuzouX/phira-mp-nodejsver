/*
 * MIT License
 * Copyright (c) 2024
 */

import { createServer, Server as HttpServerType } from 'http';
import { Logger } from '../logging/logger';
import { ServerConfig } from '../config/config';
import { HttpServer } from './HttpServer';
import { WebSocketGateway } from './WebSocketServer';
import { RoomManager } from '../domain/rooms/RoomManager';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';

export class NetworkServer {
  private httpServer?: HttpServerType;
  private readonly httpApp: HttpServer;
  private wsGateway?: WebSocketGateway;
  private runtimePort?: number;

  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    roomManager: RoomManager,
    private readonly protocolHandler: ProtocolHandler,
  ) {
    this.httpApp = new HttpServer(config, logger, roomManager);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.config.protocol.http) {
          this.logger.warn('HTTP protocol disabled; network server will not start listening');

          if (this.config.protocol.websocket) {
            this.logger.warn('WebSocket protocol requires HTTP server attachment; skipping setup');
          }

          resolve();
          return;
        }

        this.httpServer = createServer(this.httpApp.getApp());

        if (this.config.protocol.websocket) {
          this.wsGateway = new WebSocketGateway(this.logger, this.protocolHandler);
          this.wsGateway.attach(this.httpServer);
        }

        this.httpServer.listen(this.config.port, this.config.host, () => {
          const address = this.httpServer?.address();
          const port = typeof address === 'object' && address ? address.port : this.config.port;
          this.runtimePort = typeof port === 'number' ? port : undefined;

          this.logger.info('Server started successfully', {
            host: this.config.host,
            port,
            protocols: this.config.protocol,
          });

          resolve();
        });

        this.httpServer.on('error', (error) => {
          this.logger.error('Server error occurred', { error: error.message });
          reject(error);
        });
      } catch (error) {
        this.logger.error('Failed to start server', {
          error: (error as Error).message,
        });
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wsGateway?.close();

      if (!this.httpServer) {
        this.logger.info('Server stopped successfully');
        resolve();
        return;
      }

      this.httpServer.close(() => {
        this.runtimePort = undefined;
        this.httpServer = undefined;
        this.logger.info('Server stopped successfully');
        resolve();
      });
    });
  }

  getHttpServer(): HttpServerType | undefined {
    return this.httpServer;
  }

  getPort(): number | undefined {
    return this.runtimePort ?? this.config.port;
  }
}
