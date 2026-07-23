import express from 'express';
import { createServer, Server } from 'http';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { Logger } from '../logging/logger';
import { ServerConfig } from '../config/config';
import { RoomManager } from '../domain/rooms/RoomManager';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { BanManager } from '../domain/auth/BanManager';
import { version } from '../../package.json';

export class HttpServer {
  private readonly app: express.Application;
  private readonly server: Server;
  private readonly sessionParser: express.RequestHandler;
  private readonly blacklistedIps = new Map<string, number>();
  private readonly rateLimits = new Map<string, { count: number; lastReset: number }>();
  private cachedStatus: any = null;
  private statusCacheTime = 0;

  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    private readonly roomManager: RoomManager,
    private readonly protocolHandler: ProtocolHandler,
    private readonly banManager: BanManager,
    private readonly federationManager?: any,
  ) {
    this.app = express();
    this.server = createServer(this.app);

    this.app.set('trust proxy', this.config.trustProxyHops);

    this.sessionParser = session({
      secret: this.config.pluginsEnabled
        ? 'plugin-managed-session-secret'
        : process.env.SESSION_SECRET || 'a-very-insecure-secret-change-it',
      resave: false,
      saveUninitialized: true,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      },
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.urlencoded({ extended: true, limit: '2mb' }));
    this.app.use(express.json({ limit: '2mb' }));
    this.app.use(cookieParser());

    if (
      !this.config.pluginsEnabled &&
      (process.env.SESSION_SECRET || 'a-very-insecure-secret-change-it') ===
        'a-very-insecure-secret-change-it'
    ) {
      this.logger.warn(
        '安全警告：正在使用默认的 Session Secret。请在 .env 或插件配置中设置 Session Secret。',
      );
    }

    this.app.use(this.sessionParser);

    this.app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, X-Admin-Token, Authorization',
      );
      next();
    });
  }

  private rateLimitMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const limit = this.rateLimits.get(ip) || { count: 0, lastReset: now };

    if (now - limit.lastReset > 60000) {
      limit.count = 0;
      limit.lastReset = now;
    }

    limit.count++;
    this.rateLimits.set(ip, limit);

    if (limit.count > 60) {
      res.status(429).json({ error: 'Too many requests. Please slow down.' });
      return;
    }

    next();
  }

  private setupRoutes(): void {
    this.app.get('/api/version', (_req, res) => {
      return res.json({ version });
    });

    this.app.get('/api/status', this.rateLimitMiddleware.bind(this), (_req, res) => {
      if (Date.now() - this.statusCacheTime < 1000 && this.cachedStatus) {
        return res.json(this.cachedStatus);
      }

      const rooms = this.roomManager
        .listRooms()
        .filter((room) => {
          if (this.config.enablePubWeb) {
            return room.id.startsWith(this.config.pubPrefix);
          }
          if (this.config.enablePriWeb) {
            return !room.id.startsWith(this.config.priPrefix);
          }
          return true;
        })
        .map((room) => {
          const players = Array.from(room.players.values()).map((p) => ({
            id: p.user.id,
            name: p.user.name,
          }));

          return {
            id: room.id,
            name: room.name,
            playerCount: room.players.size,
            maxPlayers: room.maxPlayers,
            state: {
              ...room.state,
              chartId: (room.state as any).chartId ?? room.selectedChart?.id ?? null,
              chartName: room.selectedChart?.name ?? null,
            },
            locked: room.locked,
            cycle: room.cycle,
            players,
          };
        });

      const response = {
        serverName: this.config.serverName,
        onlinePlayers: this.protocolHandler.getSessionCount(),
        roomCount: rooms.length,
        rooms,
        federation: this.federationManager
          ? {
              enabled: true,
              nodeId: this.federationManager.getNodeId(),
              remoteRooms: this.federationManager.getRemoteRooms().map((r: any) => ({
                id: r.id,
                name: r.name,
                nodeId: r.nodeId,
                nodeName: r.nodeName,
                playerCount: r.playerCount,
                maxPlayers: r.maxPlayers,
                state: r.state,
                locked: r.locked,
                cycle: r.cycle,
                players: r.players,
              })),
              nodes: this.federationManager.getOnlineNodes().map((n: any) => ({
                id: n.id,
                serverName: n.serverName,
                status: n.status,
              })),
            }
          : { enabled: false },
      };

      this.cachedStatus = response;
      this.statusCacheTime = Date.now();
      return res.json(response);
    });

    this.logger.info('[HTTP] API 宿主已挂载原生 API');
  }

  public getBlacklistedIps(): { ip: string; expiresAt: number }[] {
    return Array.from(this.blacklistedIps.entries()).map(([ip, expiresAt]) => ({ ip, expiresAt }));
  }

  public blacklistIpManual(
    ip: string,
    durationSeconds: number,
    _adminName: string = 'Console',
  ): void {
    const expiresAt = Date.now() + durationSeconds * 1000;
    this.blacklistedIps.set(ip, expiresAt);
  }

  public unblacklistIpManual(ip: string, _adminName: string = 'Console'): boolean {
    return this.blacklistedIps.delete(ip);
  }

  public getExpressApp(): express.Application {
    return this.app;
  }

  public getInternalServer(): Server {
    return this.server;
  }

  public getSessionParser(): express.RequestHandler {
    return this.sessionParser;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.webPort, () => {
        this.logger.info(`HTTP API 宿主已启动，端口：${this.config.webPort}`);
        resolve();
      });

      this.server.on('error', (error) => {
        this.logger.error(`HTTP 服务器错误: ${error}`);
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('HTTP API 宿主已停止');
        resolve();
      });
    });
  }
}
