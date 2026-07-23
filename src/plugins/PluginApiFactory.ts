import path from 'path';
import fs from 'fs';
import express from 'express';
import yaml from 'js-yaml';
import { PluginApi, PluginRouteMethod, PacketHandlerRegistration, PluginContext } from './types';
import { ServerCommand } from '../domain/protocol/Commands';
import { PluginManager } from './manager';

export function createPluginApi(
  self: PluginManager,
  pluginName: string,
  resDir: string,
): PluginApi {
  const ctx = self as any;
  const context: PluginContext = ctx.context;
  const eventsBus = ctx.eventsBus;
  const pluginConfigDir = path.join(process.cwd(), 'config', pluginName);
  const pluginConfigPath = path.join(pluginConfigDir, 'config.yaml');
  const getFm = () => self.getFederationManager();
  const setFm = (fm: any) => self.setFederationManager(fm);

  return {
    ...context,
    pluginName,
    events: eventsBus,
    registerRoute: (
      method: PluginRouteMethod,
      routePath: string,
      handler: express.RequestHandler,
    ) => {
      const app = context.expressApp ?? context.httpServer?.getExpressApp();
      if (!app) {
        context.logger.plugin(
          `${pluginName} 注册路由失败，HTTP 服务未启用: ${method.toUpperCase()} ${routePath}`,
        );
        return;
      }
      const routeSnapshot = self.snapshotExpressLayers();
      const wrappedHandler: express.RequestHandler = (req, res, next) => {
        if (!ctx.plugins.has(pluginName)) {
          return res.status(503).json({
            error: 'Service Unavailable',
            message: `Plugin '${pluginName}' is not loaded`,
          });
        }
        return handler(req, res, next);
      };
      const expressMethod = method.toLowerCase() as PluginRouteMethod;
      (app[expressMethod] as any).call(app, routePath, wrappedHandler);
      self.trackExpressLayers(pluginName, routeSnapshot);
      context.logger.debug(`[PLUGIN] ${pluginName} 注册路由 ${method.toUpperCase()} ${routePath}`);
    },
    serveStatic: (mountPath: string, rootDir: string) => {
      const app = context.expressApp ?? context.httpServer?.getExpressApp();
      if (!app) {
        context.logger.plugin(`${pluginName} 挂载静态目录失败，HTTP 服务未启用: ${mountPath}`);
        return;
      }
      const resolvedDir = path.isAbsolute(rootDir) ? rootDir : path.join(resDir, rootDir);
      const routeSnapshot = self.snapshotExpressLayers();
      app.use(mountPath, express.static(resolvedDir));
      self.trackExpressLayers(pluginName, routeSnapshot);
      context.logger.plugin(`${pluginName} 挂载静态目录 ${mountPath} -> ${resolvedDir}`);
    },
    getExpressApp: () => context.expressApp ?? context.httpServer?.getExpressApp(),
    getPluginConfigDir: () => pluginConfigDir,
    readPluginConfig: <T = any>() => {
      if (!fs.existsSync(pluginConfigPath)) return undefined;
      const raw = fs.readFileSync(pluginConfigPath, 'utf8');
      return yaml.load(raw) as T | undefined;
    },
    writePluginConfig: (config: unknown) => {
      fs.mkdirSync(pluginConfigDir, { recursive: true });
      fs.writeFileSync(pluginConfigPath, yaml.dump(config), 'utf8');
    },
    listPlugins: () =>
      self.getAllPlugins().map((plugin) => {
        const loaded = self.getPluginByName(plugin.name);
        return {
          directory: plugin.name,
          enabled: plugin.enabled,
          loaded: Boolean(loaded),
          metadata: loaded?.metadata,
        };
      }),
    reloadPlugin: (name: string) => self.reloadPlugin(name),
    reloadServerConfig: () => {
      if (!context.reloadConfig) return false;
      context.reloadConfig();
      return true;
    },
    broadcastWs: (event: string, data: any) => {
      context.webSocketServer?.broadcast(event, data);
    },
    registerCommand: (
      name: string,
      handler: (...args: string[]) => void | Promise<void>,
      options = {},
    ) => self.registerCommand(name, handler, options),
    registerPacketHandler: (registration: PacketHandlerRegistration) => {
      const list = ctx.packetHandlers.get(registration.commandType) ?? [];
      list.push({ ...registration, pluginName });
      ctx.packetHandlers.set(registration.commandType, list);
    },
    broadcastToRoom: (roomId: string, command: ServerCommand) =>
      context.protocolHandler.broadcastToRoomById(roomId, command),
    sendCommandToUser: (userId: number, command: ServerCommand) =>
      context.protocolHandler.sendCommandToUser(userId, command),

    get federationManager() {
      return getFm();
    },
    registerFederationManager: (fm: any) => {
      setFm(fm);
    },

    getOnlinePlayers: () => {
      const sessions = context.protocolHandler.getAllSessions();
      return sessions.map((session: any) => ({
        ...session,
        connectionId: '',
        isAdmin: isAdminOrOwner(context, session.id),
        isOwner: context.config.ownerPhiraId.includes(session.id),
      }));
    },
    getRooms: () => {
      return context.roomManager.listRooms().map((room: any) => ({
        id: room.id,
        name: room.name,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        state: room.state.type,
        locked: room.locked,
        cycle: room.cycle,
        ownerId: room.ownerId,
        players: Array.from(room.players.values()).map((p: any) => ({
          id: p.user.id,
          name: p.user.name,
          isReady: p.isReady,
          isFinished: p.isFinished,
        })),
      }));
    },
    getRoom: (roomId: string) => {
      const room: any = context.roomManager.getRoom(roomId);
      if (!room) return undefined;
      return {
        id: room.id,
        name: room.name,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        state: room.state.type,
        locked: room.locked,
        cycle: room.cycle,
        ownerId: room.ownerId,
        players: Array.from(room.players.values()).map((p: any) => ({
          id: p.user.id,
          name: p.user.name,
          isReady: p.isReady,
          isFinished: p.isFinished,
        })),
      };
    },
    getServerStats: () => {
      const used = process.memoryUsage();
      return {
        serverName: context.config.serverName,
        onlinePlayers: context.protocolHandler.getSessionCount(),
        roomCount: context.roomManager.count(),
        uptime: process.uptime(),
        memoryUsage: {
          rss: Math.round((used.rss / 1024 / 1024) * 100) / 100,
          heapTotal: Math.round((used.heapTotal / 1024 / 1024) * 100) / 100,
          heapUsed: Math.round((used.heapUsed / 1024 / 1024) * 100) / 100,
        },
      };
    },
    getBanList: () => {
      const bans = context.banManager.getAllBans();
      return {
        idBans: bans.idBans.map((ban: any) => ({ ...ban, target: ban.target as number })),
        ipBans: bans.ipBans.map((ban: any) => ({ ...ban, target: ban.target as string })),
      };
    },
    isUserAdmin: (userId: number) => isAdminOrOwner(context, userId),
    isUserOwner: (userId: number) => context.config.ownerPhiraId.includes(userId),
    getPlayer: (userId: number) => {
      const sessions = context.protocolHandler.getAllSessions();
      const session: any = sessions.find((s: any) => s.id === userId);
      if (!session) return undefined;
      const room = context.roomManager.getRoomByUserId(userId);
      return {
        ...session,
        connectionId: '',
        roomId: room?.id,
        roomName: room?.name,
        isAdmin: isAdminOrOwner(context, userId),
        isOwner: context.config.ownerPhiraId.includes(userId),
      };
    },
    sendServerMessage: (roomId: string, content: string) => {
      context.protocolHandler.sendServerMessage(roomId, content);
    },
    kickPlayer: (userId: number) => context.protocolHandler.kickPlayer(userId),
    banPlayer: (userId: number, duration: number | null, reason: string, adminName?: string) => {
      context.banManager.banId(userId, duration, reason, adminName);
      context.protocolHandler.kickPlayer(userId);
    },
    unbanPlayer: (userId: number, adminName?: string) =>
      context.banManager.unbanId(userId, adminName),
    banIp: (ip: string, duration: number | null, reason: string, adminName?: string) => {
      context.banManager.banIp(ip, duration, reason, adminName);
      context.protocolHandler.kickIp(ip);
    },
    unbanIp: (ip: string, adminName?: string) => context.banManager.unbanIp(ip, adminName),
    forceStartGame: (roomId: string) => context.protocolHandler.forceStartGame(roomId),
    toggleRoomLock: (roomId: string) => context.protocolHandler.toggleRoomLock(roomId),
    setRoomMaxPlayers: (roomId: string, maxPlayers: number) =>
      context.protocolHandler.setRoomMaxPlayers(roomId, maxPlayers),
    closeRoom: (roomId: string) => context.protocolHandler.closeRoomByAdmin(roomId),
  };
}

function isAdminOrOwner(ctx: any, userId: number): boolean {
  return ctx.config.adminPhiraId.includes(userId) || ctx.config.ownerPhiraId.includes(userId);
}
