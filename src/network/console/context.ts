import { Logger } from '../../logging/logger';
import { ServerConfig } from '../../config/config';
import { RoomManager } from '../../domain/rooms/RoomManager';
import { ProtocolHandler } from '../../domain/protocol/ProtocolHandler';
import { BanManager } from '../../domain/auth/BanManager';
import { HttpServer } from '../HttpServer';
import { PluginManager } from '../../plugins';

export interface ConsoleCtx {
  config: ServerConfig;
  logger: Logger;
  roomManager: RoomManager;
  protocolHandler: ProtocolHandler;
  banManager: BanManager;
  httpServer?: HttpServer;
  pluginManager?: PluginManager;
  adminName: string;
  startTime: number;
  onReload?: () => void;
  setAdminStatus?: (userId: number, isAdmin: boolean) => Promise<string | null>;
  onUpdateConfig?: (key: string, value: string) => void;
  onSetLogLevels?: (levels: string[]) => void;
}
