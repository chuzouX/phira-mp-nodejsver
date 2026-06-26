import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import express from 'express';
import type { Logger, RoomManager, Room, ProtocolHandler, ServerConfig, FederationManager } from 'phira-plugin-api';

interface WebSocketMessage {
  type: string;
  payload?: any;
}

interface ExtWebSocket extends WebSocket {
  isAdmin?: boolean;
}

export class PluginWebSocketServer {
  private readonly wss: WsServer;
  private lastBroadcastTime = 0;
  private broadcastTimer: NodeJS.Timeout | null = null;

  constructor(
    server: HttpServer,
    private readonly roomManager: RoomManager,
    private readonly protocolHandler: ProtocolHandler,
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    private readonly sessionParser: express.RequestHandler,
    private readonly federationManager?: FederationManager,
  ) {
    this.wss = new WsServer({ server });
    this.setupConnectionHandler();
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: ExtWebSocket, req: IncomingMessage) => {
      const origin = req.headers['origin'];
      const forwardedHost = req.headers['x-forwarded-host'];
      const host = (typeof forwardedHost === 'string' ? forwardedHost : forwardedHost?.[0]) || req.headers['host'];

      if (origin && host) {
        try {
          const originUrl = new URL(origin);
          const isAllowed = (this.config.allowedOrigins ?? []).some((ao: string) => {
            try { return new URL(ao).host === originUrl.host; } catch { return false; }
          });

          if (!isAllowed && originUrl.host !== host) {
            this.logger.warn(`WebSocket 握手拒绝: Origin 不匹配 [${origin}] vs Host [${host}]`);
            ws.close(1008, 'Policy Violation: Origin mismatch');
            return;
          }
        } catch {
          ws.close(1008, 'Invalid Origin');
          return;
        }
      }

      let ip = req.socket.remoteAddress || 'unknown';
      const xForwardedFor = req.headers['x-forwarded-for'];
      const trustHops = this.config.trustProxyHops;

      if (xForwardedFor && trustHops > 0) {
        const ips = typeof xForwardedFor === 'string' ? xForwardedFor.split(',') : (Array.isArray(xForwardedFor) ? xForwardedFor : []);
        if (ips.length >= trustHops) {
          ip = ips[ips.length - trustHops].trim();
        } else if (ips.length > 0) {
          ip = ips[0].trim();
        }
      } else {
        const xRealIp = req.headers['x-real-ip'];
        if (xRealIp && typeof xRealIp === 'string') {
          ip = xRealIp.trim();
        }
      }

      const connectionId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      this.logger.debug(`WebSocket 客户端已连接: ${ip}`);
      this.protocolHandler.handleConnection(connectionId, () => ws.close(), ip);

      ws.on('close', () => {
        this.protocolHandler.handleDisconnection(connectionId);
        this.logger.debug('WebSocket 客户端已断开');
      });

      try {
        const res = {
          getHeader: () => undefined,
          setHeader: () => {},
          writeHead: () => {},
          end: () => {}
        } as any;

        (this.sessionParser as any)(req, res, (err?: any) => {
          if (err) {
            this.logger.error(`Session 解析中间件错误: ${err}`);
          }

          const session = (req as any).session;
          const isAdmin = session?.isAdmin ?? false;
          ws.isAdmin = isAdmin;

          try {
            ws.send(JSON.stringify({ type: 'roomList', payload: this.getSanitizedRoomList(isAdmin) }));
            this.sendStats(ws);
          } catch (error) {
            this.logger.error(`向 WebSocket 客户端发送初始数据失败: ${error}`);
          }

          ws.on('message', (message: string) => {
            try {
              const parsedMessage: WebSocketMessage = JSON.parse(message);
              this.handleClientMessage(ws, parsedMessage, isAdmin);
            } catch (error) {
              this.logger.error(`解析来自客户端的 WebSocket 消息失败: ${error}`);
            }
          });
        });
      } catch (sessionError) {
        this.logger.error(`WebSocket 连接中的 Session 解析失败: ${sessionError}`);
        ws.isAdmin = false;
        try {
          ws.send(JSON.stringify({ type: 'roomList', payload: this.getSanitizedRoomList(false) }));
        } catch {}
      }

      ws.on('error', (error) => {
        this.logger.error(`WebSocket 错误: ${error}`);
      });
    });
  }

  private handleClientMessage(ws: ExtWebSocket, message: WebSocketMessage, isAdmin: boolean): void {
    switch (message.type) {
      case 'getRoomDetails':
        this.sendRoomDetails(ws, message.payload.roomId, isAdmin);
        break;
      default:
        this.logger.warn(`收到未知的 WebSocket 消息类型: ${message.type}`);
    }
  }

  private sendRoomDetails(ws: ExtWebSocket, roomId: string, isAdmin: boolean): void {
    let room = this.roomManager.getRoom(roomId) as any;
    let isRemote = false;

    if (!room && this.federationManager) {
      room = this.federationManager.getRemoteRoomInfo(roomId);
      if (room) isRemote = true;
    }

    if (room) {
      let isVisible = true;
      if (!isAdmin && !isRemote) {
        if (this.config.enablePubWeb) {
          if (!room.id.startsWith(this.config.pubPrefix)) isVisible = false;
        } else if (this.config.enablePriWeb) {
          if (room.id.startsWith(this.config.priPrefix)) isVisible = false;
        }
      }

      if (!isVisible) {
        ws.send(JSON.stringify({ type: 'roomDetails', payload: null }));
        return;
      }

      const details = isRemote ? this.getSanitizedRemoteRoomDetails(room) : this.getSanitizedRoomDetails(room, isAdmin);
      ws.send(JSON.stringify({ type: 'roomDetails', payload: details }));
    } else {
      ws.send(JSON.stringify({ type: 'roomDetails', payload: null }));
      this.logger.debug(`客户端请求不存在的房间详情: ${roomId}`);
    }
  }

  private getSanitizedRoomList(isAdmin: boolean = false): any[] {
    const localRooms = this.roomManager.listRooms()
      .filter(room => {
        if (isAdmin) return true;
        if (this.config.enablePubWeb) return room.id.startsWith(this.config.pubPrefix);
        if (this.config.enablePriWeb) return !room.id.startsWith(this.config.priPrefix);
        return true;
      })
      .map(room => {
        const owner = room.players.get(room.ownerId);
        return {
          id: room.id,
          name: room.name,
          ownerId: room.ownerId,
          ownerName: owner ? owner.user.name : 'Unknown',
          playerCount: room.players.size,
          maxPlayers: room.maxPlayers,
          state: {
            ...room.state,
            chartId: (room.state as any).chartId ?? room.selectedChart?.id ?? null,
            chartName: room.selectedChart?.name ?? null,
          } as any,
          locked: room.locked,
          cycle: room.cycle,
          isRemote: false,
          serverName: this.config.serverName,
        };
      });

    let remoteRooms: any[] = [];
    if (this.federationManager) {
      try {
        remoteRooms = this.federationManager.getRemoteRooms().map(room => ({
          id: room.id,
          name: room.name,
          ownerId: room.ownerId,
          ownerName: room.players.find(p => p.id === room.ownerId)?.name || 'Unknown',
          playerCount: room.playerCount,
          maxPlayers: room.maxPlayers,
          state: room.state,
          locked: room.locked,
          cycle: room.cycle,
          isRemote: true,
          serverName: room.nodeName,
          nodeId: room.nodeId,
        }));
      } catch (e) {
        this.logger.error(`获取联邦远程房间失败: ${e}`);
      }
    }

    return [...localRooms, ...remoteRooms];
  }

  private getSanitizedRemoteRoomDetails(room: any) {
    const players = room.players.map((p: any) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || this.config.defaultAvatar,
      isReady: false,
      isFinished: false,
      score: null,
      isAdmin: this.config.adminPhiraId.includes(p.id),
      isOwner: this.config.ownerPhiraId.includes(p.id),
      rks: 0,
      bio: '',
    }));

    players.unshift({
      id: -1,
      name: room.nodeName || 'Remote Server',
      avatar: this.config.defaultAvatar,
      isReady: false,
      isFinished: false,
      score: null,
      isAdmin: false,
      isOwner: false,
      rks: 0,
      bio: 'Federated Node',
    });

    return {
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      maxPlayers: room.maxPlayers,
      state: room.state,
      locked: room.locked,
      cycle: room.cycle,
      live: room.live || false,
      selectedChart: room.selectedChart,
      messages: room.messages || [],
      isRemote: true,
      serverName: room.nodeName,
      players,
    };
  }

  private getSanitizedRoomDetails(room: Room, isAdmin: boolean = false) {
    const players = Array.from(room.players.values()).map(p => ({
      id: p.user.id,
      name: p.user.name,
      avatar: p.avatar,
      isReady: p.isReady,
      isFinished: p.isFinished,
      score: p.score,
      isAdmin: this.config.adminPhiraId.includes(p.user.id),
      isOwner: this.config.ownerPhiraId.includes(p.user.id),
      rks: p.rks,
      bio: p.bio,
    }));

    players.unshift({
      id: -1,
      name: this.config.serverName,
      avatar: this.config.defaultAvatar,
      isReady: false,
      isFinished: false,
      score: null,
      isAdmin: false,
      isOwner: false,
      rks: 0,
      bio: 'Phira Multiplayer Server Bot',
    });

    return {
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      state: {
        ...room.state,
        chartId: (room.state as any).chartId ?? room.selectedChart?.id ?? null,
        chartName: room.selectedChart?.name ?? null,
      },
      locked: room.locked,
      selectedChart: room.selectedChart,
      lastGameChart: room.lastGameChart,
      messages: room.messages.map(m => {
        const userId = (m as any).user;
        let userName = '';
        if (userId !== undefined) {
          const user = room.players.get(userId);
          userName = userId === -1 ? this.config.serverName : (user ? user.user.name : `ID: ${userId}`);
        }
        return { ...m, userName };
      }),
      players,
      otherRooms: [
        ...this.roomManager.listRooms()
          .filter(r => {
            if (r.id === room.id) return false;
            if (isAdmin) return true;
            if (this.config.enablePubWeb) return r.id.startsWith(this.config.pubPrefix);
            if (this.config.enablePriWeb) return !r.id.startsWith(this.config.priPrefix);
            return true;
          })
          .map(r => ({
            id: r.id,
            name: r.name,
            playerCount: r.players.size,
            maxPlayers: r.maxPlayers,
            state: {
              ...r.state,
              chartId: (r.state as any).chartId ?? r.selectedChart?.id ?? null,
              chartName: r.selectedChart?.name ?? null,
            },
            isRemote: false,
            serverName: this.config.serverName,
          })),
        ...(this.federationManager ? this.federationManager.getRemoteRooms()
          .filter(r => r.id !== room.id)
          .map(r => ({
            id: r.id,
            name: r.name,
            playerCount: r.playerCount,
            maxPlayers: r.maxPlayers,
            state: r.state,
            isRemote: true,
            serverName: r.nodeName,
          })) : []),
      ],
    };
  }

  public broadcastRooms(): void {
    if (this.broadcastTimer) return;
    const now = Date.now();
    const delay = Math.max(0, 100 - (now - this.lastBroadcastTime));

    this.broadcastTimer = setTimeout(() => {
      this.executeBroadcast();
      this.broadcastTimer = null;
      this.lastBroadcastTime = Date.now();
    }, delay);
  }

  private executeBroadcast(): void {
    const adminList = JSON.stringify({ type: 'roomList', payload: this.getSanitizedRoomList(true) });
    const publicList = JSON.stringify({ type: 'roomList', payload: this.getSanitizedRoomList(false) });

    this.wss.clients.forEach((client: ExtWebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(client.isAdmin ? adminList : publicList, (error) => {
          if (error) this.logger.error(`向客户端广播房间列表失败: ${error}`);
        });
      }
    });
  }

  public broadcastStats(): void {
    const serializedMessage = JSON.stringify({
      type: 'serverStats',
      payload: { totalPlayers: this.protocolHandler.getSessionCount() },
    });

    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serializedMessage, (error) => {
          if (error) this.logger.error(`向客户端广播服务器统计信息失败: ${error}`);
        });
      }
    });
  }

  public broadcast(type: string, payload: any): void {
    const serializedMessage = JSON.stringify({ type, payload });
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serializedMessage, (error) => {
          if (error) this.logger.error(`向客户端广播插件消息失败: ${error}`);
        });
      }
    });
  }

  private sendStats(ws: WebSocket): void {
    ws.send(JSON.stringify({
      type: 'serverStats',
      payload: { totalPlayers: this.protocolHandler.getSessionCount() },
    }));
  }

  public close(): void {
    this.wss.close();
  }
}
