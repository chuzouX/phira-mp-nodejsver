/*
 * MIT License
 * Copyright (c) 2024
 */

import { ConfigService, ServerConfig } from './config/config';
import { ConsoleLogger, Logger } from './logging/logger';
import { InMemoryRoomManager } from './domain/rooms/RoomManager';
import { ProtocolHandler } from './domain/protocol/ProtocolHandler';
import { NetworkServer } from './network/NetworkServer';

export interface Application {
  readonly config: ServerConfig;
  readonly logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
  getServer(): NetworkServer;
}

export const createApplication = (overrides?: Partial<ServerConfig>): Application => {
  const configService = new ConfigService(overrides);
  const config = configService.getConfig();
  const logLevel = config.logging.level;

  const logger = new ConsoleLogger('application', logLevel);
  const roomLogger = new ConsoleLogger('rooms', logLevel);
  const protocolLogger = new ConsoleLogger('protocol', logLevel);

  const roomManager = new InMemoryRoomManager(roomLogger);
  const protocolHandler = new ProtocolHandler(roomManager, protocolLogger);
  const networkServer = new NetworkServer(config, logger, protocolHandler);

  return {
    config,
    logger,
    start: () => networkServer.start(),
    stop: () => networkServer.stop(),
    getServer: () => networkServer,
  };
};
