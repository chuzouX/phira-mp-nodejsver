/*
 * MIT License
 * Copyright (c) 2024
 */

import { ConfigService, ServerConfig } from './config/config';
import { ConsoleLogger, Logger } from './logging/logger';
import { InMemoryRoomManager, RoomManager } from './domain/rooms/RoomManager';
import { PhiraAuthService } from './domain/auth/AuthService';
import { BanManager } from './domain/auth/BanManager';
import { ProtocolHandler } from './domain/protocol/ProtocolHandler';
import { NetworkServer } from './network/NetworkServer';
import { HttpServer } from './network/HttpServer';
import { WebSocketServer } from './network/WebSocketServer';

export interface Application {
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly roomManager: RoomManager;
  start(): Promise<void>;
  stop(): Promise<void>;
  getTcpServer(): NetworkServer;
  getHttpServer(): HttpServer | undefined;
}

export const createApplication = (overrides?: Partial<ServerConfig>): Application => {
  const configService = new ConfigService(overrides);
  const config = configService.getConfig();
  const logLevel = config.logging.level;

  const logger = new ConsoleLogger('程序', logLevel);
  const roomLogger = new ConsoleLogger('房间', logLevel);
  const authLogger = new ConsoleLogger('认证', logLevel);
  const protocolLogger = new ConsoleLogger('协议', logLevel);
  const webSocketLogger = new ConsoleLogger('WebSocket', logLevel);

  [logger, roomLogger, authLogger, protocolLogger, webSocketLogger].forEach(l => {
    l.setSilentIds(config.silentPhiraIds);
  });

  let webSocketServer: WebSocketServer;

  const broadcastRooms = () => {
    if (webSocketServer) {
      webSocketServer.broadcastRooms();
    }
  };

  const broadcastStats = () => {
    if (webSocketServer) {
      webSocketServer.broadcastStats();
    }
  };

  const roomManager = new InMemoryRoomManager(roomLogger, config.roomSize, broadcastRooms);
  const authService = new PhiraAuthService(config.phiraApiUrl, authLogger);
  const banManager = new BanManager(authLogger);
  const protocolHandler = new ProtocolHandler(roomManager, authService, protocolLogger, config.serverName, config.phiraApiUrl, broadcastStats, banManager);
  
  const networkServer = new NetworkServer(config, logger, protocolHandler);
  let httpServer: HttpServer | undefined;
  
  if (config.enableWebServer) {
      httpServer = new HttpServer(
        config,
        logger,
        roomManager,
        protocolHandler,
        banManager,
      );
      webSocketServer = new WebSocketServer(
        httpServer.getInternalServer(),
        roomManager,
        protocolHandler,
        config,
        webSocketLogger,
        httpServer.getSessionParser()
      );
  } else {
      logger.info('Web server is disabled via configuration.');
  }

  const start = async (): Promise<void> => {
    const promises: Promise<void>[] = [networkServer.start()];
    if (httpServer) {
        promises.push(httpServer.start());
    }
    await Promise.all(promises);
  };

  const stop = async (): Promise<void> => {
    const promises: Promise<void>[] = [networkServer.stop()];
    if (httpServer) {
        promises.push(httpServer.stop());
    }
    await Promise.all(promises);
  };

  return {
    config,
    logger,
    roomManager,
    start,
    stop,
    getTcpServer: () => networkServer,
    getHttpServer: () => httpServer!, // Note: this might be undefined now, but interface requires it. 
    // Ideally interface should be updated, but for minimal changes we can cast or update interface. 
    // Let's check the interface definition.
  };
};
