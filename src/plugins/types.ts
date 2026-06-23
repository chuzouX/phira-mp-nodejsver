import express from 'express';
import { Room } from '../domain/rooms/RoomManager';
import { ClientCommand, ServerCommand, UserInfo } from '../domain/protocol/Commands';
import { Logger } from '../logging/logger';
import { ServerConfig } from '../config/config';
import { RoomManager } from '../domain/rooms/RoomManager';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { NetworkServer } from '../network/NetworkServer';
import { HttpServer } from '../network/HttpServer';
import { BanManager } from '../domain/auth/BanManager';
import { FederationManager } from '../federation/FederationManager';

export type PluginRouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head' | 'use';

export type PluginEventMap = {
  'player:connect': { connectionId: string; ip: string };
  'player:auth:success': { connectionId: string; user: UserInfo; ip: string };
  'player:disconnect': { connectionId: string; userId?: number; user?: UserInfo; ip?: string };
  'room:beforeCreate': { connectionId: string; userId: number; roomId: string };
  'room:create': { room: Room; user: UserInfo; connectionId: string };
  'room:join': { room: Room; user: UserInfo; connectionId: string };
  'room:leave': { roomId: string; userId: number; userName: string; connectionId: string };
  'room:gameStart': { room: Room; triggeredBy: number; mode: 'ready' | 'solo-confirm' | 'force' };
  'room:gameEnd': { room: Room; rankings: Array<{ rank: number; userId: number; userName: string; score: number; accuracy: number }> };
  'protocol:beforeHandle': { connectionId: string; command: ClientCommand };
  'protocol:afterHandle': { connectionId: string; command: ClientCommand };
  'chat:message': { room: Room; userId: number; content: string; connectionId: string };
  [key: `custom:${string}`]: any;
};

export type PluginEventName = keyof PluginEventMap | `custom:${string}`;
export type PluginEventHandler<T = any> = (payload: T) => void | Promise<void>;

export interface PluginEventBus {
  on<T = any>(event: PluginEventName, handler: PluginEventHandler<T>): () => void;
  emit<T = any>(event: PluginEventName, payload: T): void;
  emitAsync<T = any>(event: PluginEventName, payload: T): Promise<void>;
}

export interface PacketHandlerRegistration {
  commandType: number;
  handler: (context: { connectionId: string; command: ClientCommand }) => void | Promise<void>;
}

export interface PluginContext {
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly roomManager: RoomManager;
  readonly protocolHandler: ProtocolHandler;
  readonly networkServer: NetworkServer;
  readonly httpServer?: HttpServer;
  readonly webSocketServer?: { broadcast(type: string, payload: any): void };
  readonly expressApp?: express.Application;
  readonly banManager: BanManager;
  readonly federationManager?: FederationManager;
}

export interface PluginApi extends PluginContext {
  readonly events: PluginEventBus;
  readonly pluginName: string;
  registerRoute(method: PluginRouteMethod, routePath: string, handler: express.RequestHandler): void;
  serveStatic(mountPath: string, rootDir: string): void;
  getExpressApp(): express.Application | undefined;
  getPluginConfigDir(): string;
  readPluginConfig<T = any>(): T | undefined;
  writePluginConfig(config: unknown): void;
  broadcastWs(event: string, data: any): void;
  registerCommand(name: string, handler: (...args: string[]) => void | Promise<void>): void;
  registerPacketHandler(registration: PacketHandlerRegistration): void;
  broadcastToRoom(roomId: string, command: ServerCommand): boolean;
}

export interface PluginMetadata {
  id: string;
  uuid: string;            // 插件唯一标识符（UUID）
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  main?: string;
  dependencies?: string[]; // 依赖的插件 UUID 列表
  serverVersion?: string;
  tags?: string[];
}

export interface PluginModule {
  name?: string;
  init(api: PluginApi): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export interface LoadedPlugin {
  name: string;
  metadata: PluginMetadata;
  modulePath: string;
  module: PluginModule;
}
