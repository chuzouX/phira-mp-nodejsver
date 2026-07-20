import { RoomManager, Room, ChartInfo } from '../../rooms/RoomManager';
import { Message, PlayerRanking } from '../Commands';
import { AuthService } from '../../auth/AuthService';
import { BanManager } from '../../auth/BanManager';
import { Logger } from '../../../logging/logger';
import { PluginManager } from '../../../plugins';
import {
  ServerCommand,
  ServerCommandType,
  ClientCommand,
  UserInfo,
  ClientRoomState,
} from '../Commands';

interface UserSession {
  userId: number;
  userInfo: UserInfo;
  connectionId: string;
  ip: string;
}

export interface HandlerCtx {
  sessions: Map<string, UserSession>;
  broadcastCallbacks: Map<string, (response: ServerCommand) => void>;
  userConnections: Map<number, string>;
  connectionClosers: Map<string, () => void>;
  connectionIps: Map<string, string>;
  federationManager: any;
  pluginManager?: PluginManager;
  roomTimers: Map<string, NodeJS.Timeout>;

  roomManager: RoomManager;
  authService: AuthService;
  logger: Logger;
  serverName: string;
  phiraApiUrl: string;
  banManager?: BanManager;
  serverAnnouncement: string;
  defaultAvatar: string;
  onSessionChange?: () => void;

  reloadConfig(serverName: string, phiraApiUrl: string, serverAnnouncement: string, defaultAvatar: string): void;
  sendCommandToUser(userId: number, command: ServerCommand): boolean;

  respond(connectionId: string, sendResponse: (response: ServerCommand) => void, response: ServerCommand): void;
  broadcastMessage(room: Room, message: Message): void;
  broadcastToRoom(room: Room, command: ServerCommand, excludeConnectionId?: string): void;
  broadcastToActivePlayers(room: Room, command: ServerCommand): void;
  fetchChartInfo(chartId: number): Promise<ChartInfo>;
  fetchUserInfo(userId: number): Promise<{ rks?: number; bio?: string }>;
  broadcastRoomUpdate(room: Room): void;
  checkGameEnd(room: Room): void;
  endGame(room: Room): void;
  toClientRoomState(room: Room, userId: number): ClientRoomState;
  handleDisconnection(connectionId: string): void;
  sendServerMessage(roomId: string, content: string): void;
}
