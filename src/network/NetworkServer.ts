/*
 * MIT License
 * Copyright (c) 2024
 */

import { AddressInfo, Server as NetServer } from 'net';
import { Logger } from '../logging/logger';
import { ServerConfig } from '../config/config';
import { TcpServer } from './TcpServer';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';

export class NetworkServer {
  private readonly tcpServer: TcpServer;
  private runtimePort?: number;
  private runtimeHost?: string;

  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    protocolHandler: ProtocolHandler,
  ) {
    this.tcpServer = new TcpServer(logger, protocolHandler);
  }

  async start(): Promise<void> {
    if (!this.config.protocol.tcp) {
      this.logger.warn('TCP protocol disabled; network server will not start listening');
      return;
    }

    try {
      await this.tcpServer.start(this.config.port, this.config.host);

      const address = this.tcpServer.getServer()?.address() as AddressInfo | string | null;
      const host = typeof address === 'object' && address ? address.address : this.config.host;
      const port =
        typeof address === 'object' && address
          ? address.port
          : typeof address === 'number'
            ? address
            : this.config.port;

      this.runtimeHost = typeof host === 'string' ? host : undefined;
      this.runtimePort = typeof port === 'number' ? port : undefined;

      this.logger.info('Server started successfully', {
        host: this.runtimeHost ?? this.config.host,
        port: this.runtimePort ?? this.config.port,
        protocols: this.config.protocol,
      });
    } catch (error) {
      this.logger.error('Failed to start server', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.config.protocol.tcp) {
      this.logger.info('Server stopped successfully');
      return;
    }

    await this.tcpServer.stop();
    this.runtimePort = undefined;
    this.runtimeHost = undefined;
    this.logger.info('Server stopped successfully');
  }

  getTcpServer(): NetServer | undefined {
    return this.tcpServer.getServer();
  }

  getPort(): number | undefined {
    return this.runtimePort ?? this.config.port;
  }

  getHost(): string {
    return this.runtimeHost ?? this.config.host;
  }
}
