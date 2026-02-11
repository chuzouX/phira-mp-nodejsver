/*
 * MIT License
 * Copyright (c) 2024
 * 
 * IMPORTANT: This file must match phira-mp-server/src/session.rs logic exactly
 * Source: https://github.com/TeamFlos/phira-mp/blob/main/phira-mp-server/src/session.rs:376-712
 */

import { Logger } from '../../logging/logger';
import { RoomManager, Room, ChartInfo } from '../rooms/RoomManager';
import { AuthService } from '../auth/AuthService';
import { BanManager } from '../auth/BanManager';
import {
  ClientCommand,
  ClientCommandType,
  ServerCommand,
  ServerCommandType,
  UserInfo,
  ClientRoomState,
  JoinRoomResponse,
  Message,
  PlayerRanking,
} from './Commands';

interface UserSession {
  userId: number;
  userInfo: UserInfo;
  connectionId: string;
  ip: string;
}

export class ProtocolHandler {
  private readonly sessions = new Map<string, UserSession>();
  private readonly broadcastCallbacks = new Map<string, (response: ServerCommand) => void>();
  private readonly userConnections = new Map<number, string>();
  private readonly connectionClosers = new Map<string, () => void>();
  private readonly connectionIps = new Map<string, string>();
  private federationManager: any = null;  // 联邦管理器（避免循环依赖用 any）

  constructor(
    private readonly roomManager: RoomManager,
    private readonly authService: AuthService,
    private readonly logger: Logger,
    private readonly serverName: string,
    private readonly phiraApiUrl: string,
    private readonly onSessionChange?: () => void,
    private readonly banManager?: BanManager,
    private readonly serverAnnouncement: string = '你好{{name}}，欢迎来到 {{serverName}} 服务器',
    private readonly defaultAvatar: string = 'https://phira.5wyxi.com/files/6ad662de-b505-4725-a7ef-72d65f32b404',
  ) {}

  public getSessionCount(): number {
    return this.sessions.size;
  }

  // ========== 联邦功能方法 ==========

  public setFederationManager(fm: any): void {
    this.federationManager = fm;
  }

  /** 为联邦远程玩家创建虚拟会话（权威服务器侧） */
  public createFederatedSession(
    connectionId: string,
    userId: number,
    userInfo: UserInfo,
    broadcastCallback: (cmd: ServerCommand) => void,
  ): void {
    this.sessions.set(connectionId, {
      userId,
      userInfo,
      connectionId,
      ip: 'federation',
    });
    this.broadcastCallbacks.set(connectionId, broadcastCallback);
    this.userConnections.set(userId, connectionId);
    this.onSessionChange?.();
    this.logger.debug(`[联邦] 已创建联邦会话: ${connectionId} (用户: ${userInfo.name}, ID: ${userId})`, { userId });
  }

  /** 移除联邦虚拟会话 */
  public removeFederatedSession(connectionId: string): void {
    const session = this.sessions.get(connectionId);
    if (session) {
      if (this.userConnections.get(session.userId) === connectionId) {
        this.userConnections.delete(session.userId);
      }
      this.sessions.delete(connectionId);
      this.broadcastCallbacks.delete(connectionId);
      this.onSessionChange?.();
      this.logger.debug(`[联邦] 已移除联邦会话: ${connectionId}`, { userId: session.userId });
    }
  }

  /** 向指定用户发送命令（用于联邦事件回调） */
  public sendCommandToUser(userId: number, command: ServerCommand): boolean {
    const connectionId = this.userConnections.get(userId);
    if (!connectionId) return false;

    const callback = this.broadcastCallbacks.get(connectionId);
    if (!callback) return false;

    callback(command);
    return true;
  }

  /** 广播联邦玩家加入房间事件 */
  public broadcastFederatedJoin(room: Room, userInfo: UserInfo, userId: number): void {
    this.broadcastToRoom(room, {
      type: ServerCommandType.OnJoinRoom,
      user: userInfo,
    });

    this.broadcastMessage(room, {
      type: 'JoinRoom',
      user: userId,
      name: userInfo.name,
    });
  }

  public getBanManager(): BanManager | undefined {
    return this.banManager;
  }

  public updateConnectionIp(connectionId: string, ip: string): void {
    this.connectionIps.set(connectionId, ip);
    const session = this.sessions.get(connectionId);
    if (session) {
      session.ip = ip;
    }
  }

  public kickIp(ip: string): void {
    const connectionsToKick = Array.from(this.connectionIps.entries())
      .filter(([_, connIp]) => connIp === ip);
    
    for (const [connectionId, _] of connectionsToKick) {
      const session = this.sessions.get(connectionId);
      if (session) {
        this.logger.info(`IP ${ip} 已被封禁，正在踢出玩家 ${session.userId} (${session.userInfo.name})`, { userId: -1 });
        this.kickPlayer(session.userId);
      } else {
        const closer = this.connectionClosers.get(connectionId);
        if (closer) {
          this.logger.info(`IP ${ip} 已被封禁，正在强制断开未验证连接 ${connectionId}`, { userId: -1 });
          closer();
        }
      }
    }
  }

  public sendServerMessage(roomId: string, content: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (room) {
      this.broadcastMessage(room, {
        type: 'Chat',
        user: -1,
        content: content,
      });
      this.logger.info(`管理员向房间 “${roomId}” 发送了消息: ${content}`, { userId: -1 });
    }
  }

  public kickPlayer(userId: number): boolean {
    const connectionId = this.userConnections.get(userId);
    const room = this.roomManager.getRoomByUserId(userId);
    
    if (room) {
        const userInfo = room.players.get(userId)?.user;
        const userName = userInfo?.name || `ID: ${userId}`;
        const wasHost = room.ownerId === userId;

        // 1. Notify the room with standard LeaveRoom message
        this.broadcastMessage(room, {
          type: 'LeaveRoom',
          user: userId,
          name: userName,
        });

        // 2. Also send a system chat for clarity
        this.broadcastMessage(room, {
          type: 'Chat',
          user: -1,
          content: `【系统】管理员已将玩家 ${userName} 移出房间`,
        });

        // 3. Force the player's client to leave by sending the LeaveRoom response
        if (connectionId) {
          const callback = this.broadcastCallbacks.get(connectionId);
          if (callback) {
            callback({
              type: ServerCommandType.LeaveRoom,
              result: { ok: true, value: undefined },
            });
          }
        }

        // 4. Remove from room
        this.roomManager.removePlayerFromRoom(room.id, userId);

        // 5. Handle Host Migration if necessary
        const updatedRoom = this.roomManager.getRoom(room.id);
        if (updatedRoom && wasHost && updatedRoom.ownerId !== userId) {
          this.broadcastMessage(updatedRoom, {
            type: 'NewHost',
            user: updatedRoom.ownerId,
          });

          for (const playerInfo of updatedRoom.players.values()) {
            const isHost = playerInfo.user.id === updatedRoom.ownerId;
            const callback = this.broadcastCallbacks.get(playerInfo.connectionId);
            if (callback) {
              callback({
                type: ServerCommandType.ChangeHost,
                isHost,
              });
            }
          }
        }
    }

    // Force Disconnect from Server (whether in room or not)
    if (connectionId) {
        const closer = this.connectionClosers.get(connectionId);
        if (closer) {
            this.logger.info(`管理员已强制断开玩家 ${userId} 的连接`, { userId: -1 });
            closer();
        }
        return true;
    }

    return room !== undefined;
  }

  public forceStartGame(roomId: string): boolean {
    const room = this.roomManager.getRoom(roomId);
    if (!room || (room.state.type !== 'WaitingForReady' && room.state.type !== 'SelectChart')) {
      return false;
    }

    if (!room.selectedChart) return false;

    this.logger.info(`管理员强制开始房间 “${roomId}” 的对局`, { userId: -1 });

    // Process players
    for (const playerInfo of room.players.values()) {
      if (playerInfo.isReady || playerInfo.user.id === room.ownerId) {
        // Ready or Host: reset for normal play
        playerInfo.isReady = false;
        playerInfo.isFinished = false;
        playerInfo.score = null;
      } else {
        // Not ready: treat as aborted/given up
        playerInfo.isReady = false;
        playerInfo.isFinished = true;
        playerInfo.score = {
          score: 0,
          accuracy: 0,
          perfect: 0,
          good: 0,
          bad: 0,
          miss: 0,
          maxCombo: 0,
          finishTime: Date.now(),
        };
        
        this.broadcastMessage(room, {
          type: 'Abort',
          user: playerInfo.user.id,
        });
      }
    }

    this.roomManager.setRoomState(room.id, { type: 'Playing' });
    
    // Broadcast messages to the room
    this.broadcastMessage(room, {
      type: 'Chat',
      user: -1,
      content: '【系统】管理员已强制开始游戏',
    });
    
    this.broadcastMessage(room, { type: 'StartPlaying' });
    
    this.broadcastToRoom(room, {
      type: ServerCommandType.ChangeState,
      state: { type: 'Playing' },
    });

    return true;
  }

  public toggleRoomLock(roomId: string): boolean {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return false;

    const newLockState = !room.locked;
    this.roomManager.setRoomLocked(roomId, newLockState);

    // 1. Notify the room with standard LockRoom message (if applicable)
    this.broadcastMessage(room, {
      type: 'LockRoom',
      lock: newLockState,
    });

    // 2. Also send a system chat for clarity
    this.broadcastMessage(room, {
      type: 'Chat',
      user: -1,
      content: `【系统】管理员已${newLockState ? '锁定' : '解锁'}了房间`,
    });

    this.logger.info(`管理员已将房间 “${roomId}” 的锁定状态修改为: ${newLockState}`, { userId: -1 });
    return true;
  }

  public setRoomMaxPlayers(roomId: string, maxPlayers: number): boolean {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return false;

    this.roomManager.setRoomMaxPlayers(roomId, maxPlayers);

    // Notify the room
    this.broadcastMessage(room, {
      type: 'Chat',
      user: -1,
      content: `【系统】管理员已将房间最大人数修改为 ${maxPlayers}`,
    });

    this.logger.info(`管理员已将房间 “${roomId}” 的最大人数修改为: ${maxPlayers}`, { userId: -1 });
    return true;
  }

  public closeRoomByAdmin(roomId: string): boolean {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return false;

    // 1. Notify and kick everyone
    const players = Array.from(room.players.values());
    for (const playerInfo of players) {
      const callback = this.broadcastCallbacks.get(playerInfo.connectionId);
      if (callback) {
        callback({
          type: ServerCommandType.LeaveRoom,
          result: { ok: true, value: undefined },
        });
      }
    }

    // 2. Actually delete the room
    this.roomManager.deleteRoom(roomId);
    this.logger.info(`管理员强制关闭了房间 “${roomId}”`, { userId: -1 });
    return true;
  }

  public toggleRoomMode(roomId: string): boolean {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return false;

    const newCycleState = !room.cycle;
    this.roomManager.setRoomCycle(roomId, newCycleState);

    // 1. Notify the room via standard Message (if applicable)
    this.broadcastMessage(room, {
      type: 'CycleRoom',
      cycle: newCycleState,
    });

    // 2. Send a system chat message
    const modeName = newCycleState ? '循环模式' : '普通模式';
    this.broadcastMessage(room, {
      type: 'Chat',
      user: -1,
      content: `【系统】管理员已将房间模式更改为 ${modeName}`,
    });

    this.logger.info(`管理员已将房间 “${roomId}” 的循环状态切换为: ${newCycleState}`, { userId: -1 });
    return true;
  }

  public async setRoomBlacklistByAdmin(roomId: string, userIds: number[]): Promise<boolean> {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return false;

    // Update the blacklist
    this.roomManager.setRoomBlacklist(roomId, userIds);

    // Fetch names for the blacklist report
    const blacklistDetails: string[] = [];
    for (const id of userIds) {
        if (isNaN(Number(id))) continue; // SSRF 防护：严格数字校验
        try {
            const response = await fetch(`https://phira.5wyxi.com/user/${id}`, {
                headers: { 'User-Agent': 'PhiraServer/1.0' },
                redirect: 'error'
            });
            if (response.ok) {
                const data = await response.json() as any;
                blacklistDetails.push(`${data.name} (${id})`);
            } else {
                blacklistDetails.push(`未知用户 (${id})`);
            }
        } catch (error) {
            blacklistDetails.push(`获取失败 (${id})`);
        }
    }

    // Broadcast update message
    let content = `【系统】黑名单已被更新，目前有 ${userIds.length} 人，分别是：`;
    if (blacklistDetails.length > 0) {
        content += `\n=========BlackList==========\n${blacklistDetails.join('\n')}\n=========BlackList==========`;
    } else {
        content += ' (空)';
    }

    this.broadcastMessage(room, {
        type: 'Chat',
        user: -1,
        content: content
    });

    // Check currently in-room players and kick if blacklisted
    const currentPlayers = Array.from(room.players.values());
    for (const player of currentPlayers) {
      if (userIds.includes(player.user.id)) {
        this.logger.info(`管理员在房间 “${roomId}” 强制踢出黑名单玩家: ${player.user.id}`, { userId: -1 });
        this.kickPlayer(player.user.id);
      }
    }

    this.logger.info(`管理员更新了房间 “${roomId}” 的黑名单，当前人数: ${userIds.length}`, { userId: -1 });
    return true;
  }

  public async setRoomWhitelistByAdmin(roomId: string, userIds: number[]): Promise<boolean> {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return false;

    // Update the whitelist
    this.roomManager.setRoomWhitelist(roomId, userIds);

    // Fetch names for the whitelist report
    const whitelistDetails: string[] = [];
    for (const id of userIds) {
        if (isNaN(Number(id))) continue; // SSRF 防护：严格数字校验
        try {
            const response = await fetch(`https://phira.5wyxi.com/user/${id}`, {
                headers: { 'User-Agent': 'PhiraServer/1.0' },
                redirect: 'error'
            });
            if (response.ok) {
                const data = await response.json() as any;
                whitelistDetails.push(`${data.name} (${id})`);
            } else {
                whitelistDetails.push(`未知用户 (${id})`);
            }
        } catch (error) {
            whitelistDetails.push(`获取失败 (${id})`);
        }
    }

    // Broadcast update message
    let content = `【系统】白名单已被更新，目前有 ${userIds.length} 人，分别是：`;
    if (whitelistDetails.length > 0) {
        content += `\n=========WhiteList==========\n${whitelistDetails.join('\n')}\n=========WhiteList==========`;
    } else {
        content += ' (空，全员可进)';
    }

    this.broadcastMessage(room, {
        type: 'Chat',
        user: -1,
        content: content
    });

    // Enforcement: Kick anyone NOT in the whitelist (if whitelist is active)
    if (userIds.length > 0) {
        const currentPlayers = Array.from(room.players.values());
        for (const player of currentPlayers) {
            const userId = player.user.id;
            // Don't kick the room owner or the server user (-1) or those in whitelist
            if (userId !== room.ownerId && userId !== -1 && !userIds.includes(userId)) {
                this.logger.info(`管理员在房间 “${roomId}” 强制踢出非白名单玩家: ${userId}`, { userId: -1 });
                this.kickPlayer(userId);
            }
        }
    }

    this.logger.info(`管理员更新了房间 “${roomId}” 的白名单，当前人数: ${userIds.length}`, { userId: -1 });
    return true;
  }

  public getAllSessions(): { id: number; name: string; roomId?: string; roomName?: string; ip: string }[] {
    const sessions: { id: number; name: string; roomId?: string; roomName?: string; ip: string }[] = [];
    for (const session of this.sessions.values()) {
      const room = this.roomManager.getRoomByUserId(session.userId);
      sessions.push({
        id: session.userId,
        name: session.userInfo.name,
        roomId: room?.id,
        roomName: room?.name,
        ip: session.ip,
      });
    }
    return sessions;
  }

  private respond(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
    response: ServerCommand,
  ): void {
    sendResponse(response);

    if (response.type !== ServerCommandType.Pong) {
        this.logger.debug(`向客户端发送响应: ${connectionId} (${ServerCommandType[response.type]})`, { userId: this.sessions.get(connectionId)?.userId });
    }
  }

  private broadcastMessage(room: Room, message: Message): void {
    // Save message to room history
    this.roomManager.addMessageToRoom(room.id, message);

    const serverCmd: ServerCommand = {
      type: ServerCommandType.Message,
      message,
    };

    for (const playerInfo of room.players.values()) {
      const callback = this.broadcastCallbacks.get(playerInfo.connectionId);
      if (callback) {
        callback(serverCmd);
      }
    }
  }

  private broadcastToRoom(room: Room, command: ServerCommand, excludeConnectionId?: string): void {
    for (const playerInfo of room.players.values()) {
      if (excludeConnectionId && playerInfo.connectionId === excludeConnectionId) {
        continue;
      }
      const callback = this.broadcastCallbacks.get(playerInfo.connectionId);
      if (callback) {
        callback(command);
        this.logger.debug(`广播命令给客户端: ${playerInfo.connectionId} (${ServerCommandType[command.type]})`, { userId: playerInfo.user.id });
      }
    }
  }

  private async fetchChartInfo(chartId: number): Promise<ChartInfo> {
    if (isNaN(Number(chartId))) throw new Error('Invalid chart ID');
    this.logger.debug(`正在获取谱面信息: ${chartId}`, { userId: -1 });
    
    const response = await fetch(`https://phira.5wyxi.com/chart/${chartId}`, {
        headers: { 'User-Agent': 'PhiraServer/1.0' },
        redirect: 'error'
    });
    
    if (!response.ok) {
      throw new Error(`API返回了一个神秘的状态： ${response.status}`);
    }
    
    const chartData = await response.json() as any;
    
    // Explicitly extract uploader ID as a number
    const rawUploader = chartData.uploader ?? chartData.uploaderId;
    const uploaderId = rawUploader !== undefined && rawUploader !== null ? Number(rawUploader) : undefined;
    
    this.logger.debug(`谱面 API 响应: ${chartData.name} (ID: ${chartId}, 上传者: ${uploaderId})`, { userId: -1 });
    
    let uploaderInfo;
    if (uploaderId && !isNaN(Number(uploaderId))) {
        try {
            const userResponse = await fetch(`https://phira.5wyxi.com/user/${uploaderId}`, {
                headers: { 'User-Agent': 'PhiraServer/1.0' },
                redirect: 'error'
            });
            if (userResponse.ok) {
                const userData = await userResponse.json() as any;
                uploaderInfo = {
                    id: userData.id,
                    name: userData.name,
                    avatar: userData.avatar ?? this.defaultAvatar,
                    rks: userData.rks ?? 0,
                    bio: userData.bio,
                };
                this.logger.debug(`成功获取上传者信息: ${userData.name} (ID: ${uploaderId})`, { userId: -1 });
            } else {
                this.logger.warn(`获取上传者信息失败: API 返回 ${userResponse.status} (ID: ${uploaderId})`, { userId: -1 });
            }
        } catch (error) {
            this.logger.error(`获取上传者信息出错: ${error instanceof Error ? error.message : String(error)} (ID: ${uploaderId})`, { userId: -1 });
        }
    }

    return {
      id: chartData.id,
      name: chartData.name,
      charter: chartData.charter,
      level: chartData.level,
      difficulty: chartData.difficulty,
      composer: chartData.composer,
      illustration: chartData.illustration,
      rating: chartData.rating,
      ratingCount: chartData.ratingCount,
      uploader: uploaderId,
      uploaderInfo,
    };
  }

  handleConnection(connectionId: string, closeConnection?: () => void, ip: string = 'unknown'): void {
    this.logger.debug(`建立新连接: ${connectionId} (${ip}) (当前房间总数: ${this.roomManager.count()})`, { userId: -1 });
    
    if (closeConnection) {
      this.connectionClosers.set(connectionId, closeConnection);
    }
    this.connectionIps.set(connectionId, ip);
  }

  handleDisconnection(connectionId: string): void {
    this.connectionClosers.delete(connectionId);
    this.connectionIps.delete(connectionId);

    const session = this.sessions.get(connectionId);
    if (session) {
      // 联邦代理玩家断线：通知远程服务器
      if (this.federationManager?.isPlayerProxied(session.userId)) {
        this.federationManager.proxyLeaveRoom(session.userId);
        this.sessions.delete(connectionId);
        if (this.userConnections.get(session.userId) === connectionId) {
          this.userConnections.delete(session.userId);
        }
        this.broadcastCallbacks.delete(connectionId);
        this.onSessionChange?.();
        this.logger.info(`[联邦断线] 代理玩家 ${session.userInfo.name} (${session.userId}) 已断开`, { userId: session.userId });
        return;
      }

      const room = this.roomManager.getRoomByUserId(session.userId);
      if (room) {
        const roomId = room.id;
        const wasPlaying = room.state.type === 'Playing';
        
        if (wasPlaying) {
          const player = room.players.get(session.userId);
          if (player && !player.isFinished) {
            this.logger.info(`[断线] 玩家 “${session.userInfo.name}” (ID: ${session.userId}) 在房间 “${room.id}” 游戏中途断线，已标记为放弃`, { userId: session.userId });

            player.isFinished = true;
            player.score = {
              score: 0,
              accuracy: 0,
              perfect: 0,
              good: 0,
              bad: 0,
              miss: 0,
              maxCombo: 0,
              finishTime: Date.now(),
            };
            
            this.broadcastMessage(room, {
              type: 'Abort',
              user: session.userId,
            });
          }
        }
        
        this.roomManager.removePlayerFromRoom(roomId, session.userId);
        
        if (wasPlaying) {
          const updatedRoom = this.roomManager.getRoom(roomId);
          if (updatedRoom) {
            this.checkGameEnd(updatedRoom);
          }
        }
      }
      
      if (this.userConnections.get(session.userId) === connectionId) {
        this.userConnections.delete(session.userId);
      }
      this.sessions.delete(connectionId);
      this.onSessionChange?.();
    }
    this.broadcastCallbacks.delete(connectionId);
    this.logger.info(`[断线] 连接已断开: ${connectionId}${session ? ` (用户: ${session.userInfo.name} ID: ${session.userId})` : ''}`, { userId: session?.userId });
  }

  handleMessage(
    connectionId: string,
    message: ClientCommand,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    this.logger.debug(`收到消息: ${connectionId} (类型: ${ClientCommandType[message.type]})`, { userId: session?.userId });

    // 联邦连接不覆盖广播回调（保持联邦HTTP回调）
    if (!connectionId.startsWith('federation:')) {
      this.broadcastCallbacks.set(connectionId, sendResponse);
    }

    // 联邦代理：如果玩家在远程房间中，转发命令到权威服务器
    if (session && this.federationManager?.isPlayerProxied(session.userId)) {
      if (message.type !== ClientCommandType.Authenticate) {
        this.federationManager.proxyCommand(session.userId, message, sendResponse);
        return;
      }
    }

    switch (message.type) {
      case ClientCommandType.Authenticate:
        this.handleAuthenticate(connectionId, message.token, sendResponse);
        break;

      case ClientCommandType.Chat:
        this.handleChat(connectionId, message.message, sendResponse);
        break;

      case ClientCommandType.CreateRoom:
        this.handleCreateRoom(connectionId, message.id, sendResponse);
        break;

      case ClientCommandType.JoinRoom:
        this.handleJoinRoom(connectionId, message.id, message.monitor, sendResponse);
        break;

      case ClientCommandType.LeaveRoom:
        this.handleLeaveRoom(connectionId, sendResponse);
        break;

      case ClientCommandType.LockRoom:
        this.handleLockRoom(connectionId, message.lock, sendResponse);
        break;

      case ClientCommandType.CycleRoom:
        this.handleCycleRoom(connectionId, message.cycle, sendResponse);
        break;

      case ClientCommandType.SelectChart:
        this.handleSelectChart(connectionId, message.id, sendResponse);
        break;

      case ClientCommandType.RequestStart:
        this.handleRequestStart(connectionId, sendResponse);
        break;

      case ClientCommandType.Ready:
        this.handleReady(connectionId, sendResponse);
        break;

      case ClientCommandType.CancelReady:
        this.handleCancelReady(connectionId, sendResponse);
        break;

      case ClientCommandType.Played:
        void this.handlePlayed(connectionId, message.id, sendResponse);
        break;

      case ClientCommandType.Abort:
        this.handleAbort(connectionId, sendResponse);
        break;

      default:
        this.logger.warn(`收到未知的指令类型: ${connectionId} (类型: ${ClientCommandType[message.type]})`, { userId: session?.userId });
        break;
    }
  }

  private async fetchUserInfo(userId: number): Promise<{ rks?: number; bio?: string }> {
    if (isNaN(Number(userId))) return {};
    try {
        const response = await fetch(`https://phira.5wyxi.com/user/${userId}`, {
            headers: { 'User-Agent': 'PhiraServer/1.0' },
            redirect: 'error'
        });
        if (response.ok) {
            const userData = await response.json() as any;
            return {
                rks: userData.rks ?? 0,
                bio: userData.bio,
            };
        }
    } catch (error) {
        this.logger.error(`获取用户详细信息失败: ${error instanceof Error ? error.message : String(error)} (ID: ${userId})`, { userId: -1 });
    }
    return {};
  }

  private handleAuthenticate(
    connectionId: string,
    token: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    this.logger.debug(`正在尝试验证连接: ${connectionId} (Token长度: ${token.length})`, { userId: -1 });

    if (this.sessions.has(connectionId)) {
      this.logger.warn(`重复验证尝试: ${connectionId}`, { userId: -1 });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Authenticate,
        result: { ok: false, error: '重复的验证' },
      });
      return;
    }

    if (token.length !== 20) {
      this.logger.warn(`非法的 Token 长度: ${connectionId} (长度: ${token.length})`, { userId: -1 });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Authenticate,
        result: { ok: false, error: '非法的 Token' },
      });
      return;
    }

    const authenticate = async (): Promise<void> => {
      try {
        const basicUserInfo = await this.authService.authenticate(token);

        if (this.banManager) {
          // 1. Check IP Ban (Admin bans only, System bans are dropped at socket level)
          const ip = this.connectionIps.get(connectionId) || 'unknown';
          const ipBanInfo = this.banManager.isIpBanned(ip);
          if (ipBanInfo && ipBanInfo.adminName !== 'System') {
            const timeLeft = this.banManager.getRemainingTimeStr(ipBanInfo.expiresAt);
            const admin = ipBanInfo.adminName || '未知';
            this.logger.ban(`拦截到来自封禁 IP ${ip} (${basicUserInfo.name}) 的登录尝试。原因: ${ipBanInfo.reason} (操作员: ${admin}, 剩余时长: ${timeLeft})`, { userId: basicUserInfo.id });
            this.respond(connectionId, sendResponse, {
              type: ServerCommandType.Authenticate,
              result: { ok: false, error: `您的 IP 已被封禁。\n原因: ${ipBanInfo.reason}\n操作员: ${admin}\n剩余时长: ${timeLeft}` },
            });
            const closer = this.connectionClosers.get(connectionId);
            if (closer) closer();
            return;
          }

          // 2. Check User ID Ban
          const banInfo = this.banManager.isIdBanned(basicUserInfo.id);
          if (banInfo) {
            const timeLeft = this.banManager.getRemainingTimeStr(banInfo.expiresAt);
            const admin = banInfo.adminName || '未知';
            this.logger.ban(`拦截到封禁用户 ${basicUserInfo.id} (${basicUserInfo.name}) 的登录尝试。原因: ${banInfo.reason} (操作员: ${admin}, 剩余时长: ${timeLeft})`, { userId: basicUserInfo.id });
            this.respond(connectionId, sendResponse, {
              type: ServerCommandType.Authenticate,
              result: { ok: false, error: `您的账号已被封禁。\n原因: ${banInfo.reason}\n操作员: ${admin}\n剩余时长: ${timeLeft}` },
            });
            const closer = this.connectionClosers.get(connectionId);
            if (closer) closer();
            return;
          }
        }

        const detailedInfo = await this.fetchUserInfo(basicUserInfo.id);
        
        const userInfo: UserInfo = {
            ...basicUserInfo,
            rks: detailedInfo.rks,
            bio: detailedInfo.bio
        };

        const existingConnectionId = this.userConnections.get(userInfo.id);
        if (existingConnectionId && existingConnectionId !== connectionId) {
          // 检查玩家是否在房间中
          const existingRoom = this.roomManager.getRoomByUserId(userInfo.id);
          
          if (existingRoom) {
            // 玩家在任何房间中，都应该迁移连接而不是移除
            const roomStatus = existingRoom.state.type;
            this.logger.info(`[重连迁移] 玩家 ${userInfo.id} 在房间 “${existingRoom.id}” (${roomStatus})，正在迁移连接: ${existingConnectionId} -> ${connectionId}`, { userId: userInfo.id });
            
            // 执行连接迁移，保留游戏状态
            this.roomManager.migrateConnection(userInfo.id, existingConnectionId, connectionId);
            
            // 关闭旧连接但不触发断线逻辑
            const closeConnection = this.connectionClosers.get(existingConnectionId);
            if (closeConnection) {
              closeConnection();
            }
            
            // 清理旧连接的会话信息，但不执行房间逻辑
            this.sessions.delete(existingConnectionId);
            this.onSessionChange?.();
            this.broadcastCallbacks.delete(existingConnectionId);
            this.connectionClosers.delete(existingConnectionId);
            
            // 如果不是Playing状态，广播房间更新
            if (roomStatus !== 'Playing') {
              this.broadcastRoomUpdate(existingRoom);
            }
          } else {
            // 玩家不在房间中，正常踢出
            this.logger.warn(`用户 ${userInfo.id} 已在其他连接登录，正在踢出旧连接: ${existingConnectionId} -> ${connectionId}`, { userId: userInfo.id });
            
            const closeConnection = this.connectionClosers.get(existingConnectionId);
            if (closeConnection) {
              closeConnection();
            }
            
            this.handleDisconnection(existingConnectionId);
          }
        }

        this.sessions.set(connectionId, {
          userId: userInfo.id,
          userInfo,
          connectionId,
          ip: this.connectionIps.get(connectionId) || 'unknown',
        });

        this.onSessionChange?.();

        this.userConnections.set(userInfo.id, connectionId);

        this.logger.info(`“${userInfo.name}” 加入了服务器`, { userId: userInfo.id });

        const room = this.roomManager.getRoomByUserId(userInfo.id);
        const roomState = room ? this.toClientRoomState(room, userInfo.id) : null;

        this.logger.debug(`已向客户端 ${connectionId} 发送房间状态`, { userId: userInfo.id });

        this.respond(connectionId, sendResponse, {
          type: ServerCommandType.Authenticate,
          result: { ok: true, value: [userInfo, roomState] },
        });


        const announcement = this.serverAnnouncement
          .replace(/{{name}}/g, userInfo.name)
          .replace(/{{serverName}}/g, this.serverName);

        this.respond(connectionId, sendResponse, {
          type: ServerCommandType.Message,
          message: {
            type: 'Chat',
            user: -1,
            content: announcement,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
        this.logger.warn(`验证失败: ${connectionId} - ${errorMessage}`, { userId: -1 });

        this.respond(connectionId, sendResponse, {
          type: ServerCommandType.Authenticate,
          result: { ok: false, error: errorMessage },
        });
      }
    };

    void authenticate();
  }

  private handleChat(
    connectionId: string,
    message: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Chat,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Chat,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    this.broadcastMessage(room, {
      type: 'Chat',
      user: session.userId,
      content: message,
    });

    this.logger.debug(`已在房间 “${room.id}” 广播来自玩家 “${session.userInfo.name}” 的聊天消息`, { userId: session.userId });

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.Chat,
      result: { ok: true, value: undefined },
    });
  }

  private handleCreateRoom(
    connectionId: string,
    roomId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CreateRoom,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const existingRoom = this.roomManager.getRoomByUserId(session.userId);
    if (existingRoom) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CreateRoom,
        result: { ok: false, error: '你已经在房间了哦喵' },
      });
      return;
    }

    try {
      const room = this.roomManager.createRoom({
        id: roomId,
        name: roomId,
        ownerId: session.userId,
        ownerInfo: session.userInfo,
        connectionId,
      });

      this.logger.mark(`“${session.userInfo.name}” 创建房间 “${room.id}”`, { userId: session.userId });

      // 1. Broadcast joins first so client has user info before transitioning
      this.broadcastToRoom(room, {
        type: ServerCommandType.OnJoinRoom,
        user: session.userInfo,
      });

      // 2. Respond with success so the client can transition to the room screen.
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CreateRoom,
        result: { ok: true, value: undefined },
      });
      
      // 3. Now, broadcast that the room was created. 
      // Delay to ensure client processed OnJoinRoom/Scene Transition and knows the user name.
      setTimeout(() => {
          // Send server user join AFTER client has transitioned
                this.broadcastToRoom(room, {
                  type: ServerCommandType.OnJoinRoom,
                  user: { id: -1, name: this.serverName, avatar: this.defaultAvatar, monitor: true },
                });
          this.broadcastMessage(room, {
            type: 'CreateRoom',
            user: session.userId,
          });

          // 4. Send Room Welcome and announcement
          const isPrivate = roomId.startsWith('sm');
          const roomTypeText = isPrivate ? '私密' : '公开';
          this.broadcastMessage(room, {
            type: 'Chat',
            user: -1,
            content: `Hi,${session.userInfo.name}！此房间为${roomTypeText}房间，房间号为${roomId}，祝您玩的开心！`,
          });

          // 5. 广播房间创建事件给联邦节点
          if (this.federationManager?.getConfig?.()?.enabled) {
            this.federationManager.broadcastRoomEvent('room_created', room.id, 
              this.federationManager.buildLocalRoomInfo(room)
            ).catch(() => {});
          }
      }, 250);
    } catch (error) {
      const errorMessage = (error as Error).message;

      this.logger.error(`创建房间失败: ${connectionId} (用户: ${session.userId}, 房间: ${roomId}, 错误: ${errorMessage})`, { userId: session.userId });

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CreateRoom,
        result: { ok: false, error: errorMessage },
      });
    }
  }

  private handleJoinRoom(
    connectionId: string,
    roomId: string,
    monitor: boolean,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const existingRoom = this.roomManager.getRoomByUserId(session.userId);
    if (existingRoom) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: false, error: '已经在房间里哦喵' },
      });
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      // 检查联邦远程房间
      if (this.federationManager?.isRemoteRoom(roomId)) {
        this.logger.info(`[联邦] 玩家 ${session.userId} 尝试加入远程房间 ${roomId}`, { userId: session.userId });
        this.federationManager.proxyJoinRoom(
          session.userId,
          { ...session.userInfo, monitor },
          roomId,
          monitor,
          sendResponse,
        );
        return;
      }

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: false, error: '找不到你想要的房间辣' },
      });
      return;
    }

    if (room.locked) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: false, error: '呜哇！房间锁住了哦，进不去' },
      });
      return;
    }

    if (room.state.type !== 'SelectChart') {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: false, error: '他们正在游戏中哦' },
      });
      return;
    }

    const userInfo = { ...session.userInfo, monitor };
    const success = this.roomManager.addPlayerToRoom(roomId, session.userId, userInfo, connectionId);

    if (success) {
      this.logger.info(`玩家 “${session.userInfo.name}” (ID: ${session.userId}) 加入了房间 “${roomId}”`, { userId: session.userId });

      this.broadcastToRoom(room, {
        type: ServerCommandType.OnJoinRoom,
        user: userInfo,
      });

      this.broadcastMessage(room, {
        type: 'JoinRoom',
        user: session.userId,
        name: session.userInfo.name,
      });

      // Delay announcement slightly

      const usersInRoom = Array.from(room.players.values()).map((p) => p.user);
      const serverUser: UserInfo = { id: -1, name: this.serverName, avatar: this.defaultAvatar, monitor: true };
      
      const joinResponse: JoinRoomResponse = {
        state: room.state,
        users: [...usersInRoom, serverUser],
        live: room.live,
      };

      this.logger.debug(`已向客户端 ${connectionId} 发送加入房间响应`, { userId: session.userId });

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: true, value: joinResponse },
      });
    } else {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: false, error: '杂鱼~你要加入的房间满了或杂鱼无权进入' },
      });
    }
  }

  private handleLeaveRoom(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.LeaveRoom,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.LeaveRoom,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    this.logger.info(`玩家 “${session.userInfo.name}” (ID: ${session.userId}) 离开了房间 “${room.id}”`, { userId: session.userId });

    const wasHost = room.ownerId === session.userId;
    const wasPlaying = room.state.type === 'Playing';
    
    this.broadcastMessage(room, {
      type: 'LeaveRoom',
      user: session.userId,
      name: session.userInfo.name,
    });

    this.roomManager.removePlayerFromRoom(room.id, session.userId);

    const updatedRoom = this.roomManager.getRoom(room.id);

    // 联邦：广播房间变更
    if (this.federationManager?.getConfig?.()?.enabled) {
      if (!updatedRoom) {
        // 房间已被删除
        this.federationManager.broadcastRoomEvent('room_deleted', room.id, null).catch(() => {});
      } else {
        this.federationManager.broadcastRoomEvent('room_updated', room.id,
          this.federationManager.buildLocalRoomInfo(updatedRoom)
        ).catch(() => {});
      }
    }

    if (updatedRoom && wasHost && updatedRoom.ownerId !== session.userId) {
      this.broadcastMessage(updatedRoom, {
        type: 'NewHost',
        user: updatedRoom.ownerId,
      });

      for (const playerInfo of updatedRoom.players.values()) {
        const isHost = playerInfo.user.id === updatedRoom.ownerId;
        const callback = this.broadcastCallbacks.get(playerInfo.connectionId);
        if (callback) {
          callback({
            type: ServerCommandType.ChangeHost,
            isHost,
          });
        }
      }
    }

    if (updatedRoom && wasPlaying) {
      this.checkGameEnd(updatedRoom);
    }

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.LeaveRoom,
      result: { ok: true, value: undefined },
    });
  }

  private handleLockRoom(
    connectionId: string,
    lock: boolean,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.LockRoom,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.LockRoom,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.ownerId !== session.userId) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.LockRoom,
        result: { ok: false, error: 'baka!你不是房主喵' },
      });
      return;
    }

    this.logger.info(`玩家 “${session.userInfo.name}” (ID: ${session.userId}) 将房间 “${room.id}” 锁定模式修改为: ${lock}`, { userId: session.userId });

    this.roomManager.setRoomLocked(room.id, lock);

    this.broadcastMessage(room, {
      type: 'LockRoom',
      lock,
    });

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.LockRoom,
      result: { ok: true, value: undefined },
    });
  }

  private handleCycleRoom(
    connectionId: string,
    cycle: boolean,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CycleRoom,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CycleRoom,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.ownerId !== session.userId) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CycleRoom,
        result: { ok: false, error: 'baka!你不是房主喵' },
      });
      return;
    }

    this.logger.info(`玩家 “${session.userInfo.name}” (ID: ${session.userId}) 将房间 “${room.id}” 循环状态切换为: ${cycle}`, { userId: session.userId });

    this.roomManager.setRoomCycle(room.id, cycle);

    this.broadcastMessage(room, {
      type: 'CycleRoom',
      cycle,
    });

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.CycleRoom,
      result: { ok: true, value: undefined },
    });
  }

  private handleSelectChart(
    connectionId: string,
    chartId: number,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.state.type !== 'SelectChart') {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        result: { ok: false, error: '非法的状态' },
      });
      return;
    }

    if (room.ownerId !== session.userId) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        result: { ok: false, error: 'baka!你不是房主喵' },
      });
      return;
    }

    this.logger.debug(`玩家 “${session.userInfo.name}” (ID: ${session.userId}) 正在房间 “${room.id}” 获取谱面信息: ${chartId}`, { userId: session.userId });

    const fetchAndUpdate = async (): Promise<void> => {
      try {
        const chart = await this.fetchChartInfo(chartId);

        this.logger.mark(`“${session.userInfo.name}”（用户ID：${session.userId}）在房间 “${room.id}” 选择了 “${chart.name}”`, { userId: session.userId });

        this.roomManager.setRoomChart(room.id, chart);
        this.roomManager.setRoomState(room.id, { type: 'SelectChart', chartId: chart.id });

        // Reset solo confirm pending state when chart changes
        this.roomManager.setSoloConfirmPending(room.id, false);

        this.broadcastMessage(room, {
          type: 'SelectChart',
          user: session.userId,
          name: chart.name,
          id: chart.id,
        });

        this.broadcastToRoom(room, {
          type: ServerCommandType.ChangeState,
          state: { type: 'SelectChart', chartId: chart.id },
        });

        this.respond(connectionId, sendResponse, {
          type: ServerCommandType.SelectChart,
          result: { ok: true, value: undefined },
        });

        // 联邦：广播谱面选择事件
        if (this.federationManager?.getConfig?.()?.enabled) {
          this.federationManager.broadcastRoomEvent('chart_selected', room.id,
            this.federationManager.buildLocalRoomInfo(room)
          ).catch(() => {});
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'failed to fetch chart';
        this.logger.error(`获取谱面信息失败: ${connectionId} (谱面: ${chartId}, 错误: ${errorMessage})`, { userId: session.userId });

        this.respond(connectionId, sendResponse, {
          type: ServerCommandType.SelectChart,
          result: { ok: false, error: errorMessage },
        });
      }
    };

    void fetchAndUpdate();
  }

  private handleRequestStart(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.state.type !== 'SelectChart') {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        result: { ok: false, error: '非法的状态' },
      });
      return;
    }

    if (room.ownerId !== session.userId) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        result: { ok: false, error: 'baka!你不是房主喵' },
      });
      return;
    }


    this.logger.mark(`“${session.userInfo.name}” 在房间 “${room.id}” 请求开始对局`, { userId: session.userId });

    if (room.players.size > 1) {
      for (const playerInfo of room.players.values()) {
        playerInfo.isReady = playerInfo.user.id === room.ownerId; // Host is ready by default
        playerInfo.isFinished = false;
        playerInfo.score = null;
      }
      this.roomManager.setRoomState(room.id, { type: 'WaitingForReady' });

      this.broadcastMessage(room, {
        type: 'GameStart',
        user: session.userId,
      });

      this.broadcastToRoom(room, {
        type: ServerCommandType.ChangeState,
        state: { type: 'WaitingForReady' },
      });
    } else {
      if (!this.roomManager.isSoloConfirmPending(room.id)) {
        this.roomManager.setSoloConfirmPending(room.id, true);
        this.logger.info(`房间 “${room.id}” 等待单人房确认开始`, { userId: session.userId });
        this.broadcastMessage(room, {
          type: 'Chat',
          user: -1, // System User
          content: '房间只有你一个人 如果确定开始游戏请再次点击开始游戏',
        });
      } else {
        this.roomManager.setSoloConfirmPending(room.id, false); // Reset flag
        this.logger.info(`房间 “${room.id}” 对局开始，玩家：${session.userId}`, { userId: session.userId });

        for (const playerInfo of room.players.values()) {
          playerInfo.isReady = false;
          playerInfo.isFinished = false;
          playerInfo.score = null;
        }

        this.roomManager.setRoomState(room.id, { type: 'Playing' });
        this.broadcastMessage(room, { type: 'StartPlaying' });
        this.broadcastToRoom(room, {
          type: ServerCommandType.ChangeState,
          state: { type: 'Playing' },
        });
      }
    }

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.RequestStart,
      result: { ok: true, value: undefined },
    });

    // 联邦：广播游戏开始事件
    if (this.federationManager?.getConfig?.()?.enabled) {
      this.federationManager.broadcastRoomEvent('game_started', room.id,
        this.federationManager.buildLocalRoomInfo(room)
      ).catch(() => {});
    }
  }

  private handleReady(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Ready,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Ready,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.state.type !== 'WaitingForReady') {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Ready,
        result: { ok: false, error: 'invalid state' },
      });
      return;
    }

    const player = room.players.get(session.userId);
    if (!player) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Ready,
        result: { ok: false, error: '杂鱼~你没在房间喵' },
      });
      return;
    }

    if (player.isReady) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Ready,
        result: { ok: false, error: '你已经准备了喵' },
      });
      return;
    }

    this.logger.info(`玩家 “${session.userInfo.name}” (ID: ${session.userId}) 在房间 “${room.id}” 已准备`, { userId: session.userId });

    this.roomManager.setPlayerReady(room.id, session.userId, true);

    this.broadcastMessage(room, {
      type: 'Ready',
      user: session.userId,
    });

    const allReady = Array.from(room.players.values())
      .filter((p) => p.user.id !== room.ownerId)
      .every((p) => p.isReady);
    if (allReady) {
      this.logger.info(`房间 “${room.id}” 对局开始，玩家：${Array.from(room.players.keys()).join(', ')}`, { userId: session.userId });

      for (const playerInfo of room.players.values()) {
        playerInfo.isFinished = false;
        playerInfo.score = null;
      }

      this.roomManager.setRoomState(room.id, { type: 'Playing' });

      this.broadcastMessage(room, { type: 'StartPlaying' });

      this.broadcastToRoom(room, {
        type: ServerCommandType.ChangeState,
        state: { type: 'Playing' },
      });
    }

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.Ready,
      result: { ok: true, value: undefined },
    });
  }

  private handleCancelReady(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CancelReady,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CancelReady,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.state.type !== 'WaitingForReady') {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CancelReady,
        result: { ok: false, error: '非法的状态' },
      });
      return;
    }

    const player = room.players.get(session.userId);
    if (!player) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CancelReady,
        result: { ok: false, error: '杂鱼~你没在房间喵' },
      });
      return;
    }

    if (room.ownerId !== session.userId && !player.isReady) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CancelReady,
        result: { ok: false, error: '你还未准备哦喵' },
      });
      return;
    }

    this.logger.debug(`玩家 “${session.userInfo.name}” (ID: ${session.userId}) 在房间 “${room.id}” 取消了准备`, { userId: session.userId });

    this.roomManager.setPlayerReady(room.id, session.userId, false);
    player.isFinished = false;
    player.score = null;

    if (room.ownerId === session.userId) {
      this.roomManager.setRoomState(room.id, { type: 'SelectChart', chartId: room.selectedChart?.id ?? null });
      this.roomManager.setSoloConfirmPending(room.id, false);

      for (const playerId of room.players.keys()) {
        this.roomManager.setPlayerReady(room.id, playerId, false);
      }

      for (const playerInfo of room.players.values()) {
        playerInfo.isFinished = false;
        playerInfo.score = null;
      }

      this.broadcastMessage(room, {
        type: 'CancelGame',
        user: session.userId,
      });

      this.broadcastToRoom(room, {
        type: ServerCommandType.ChangeState,
        state: { type: 'SelectChart', chartId: room.selectedChart?.id ?? null },
      });
    } else {
      this.broadcastMessage(room, {
        type: 'CancelReady',
        user: session.userId,
      });
    }

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.CancelReady,
      result: { ok: true, value: undefined },
    });
  }

  private async handlePlayed(
    connectionId: string,
    recordId: number,
    sendResponse: (response: ServerCommand) => void,
  ): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.logger.warn(`[游戏结果] 收到来自未验证连接 ${connectionId} 的 Played 消息 (记录ID: ${recordId})`, { userId: -1 });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.logger.error(`[游戏结果] 玩家 ${session.userId} 提交成绩时房间不存在 (记录ID: ${recordId})`, { userId: session.userId });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.state.type !== 'Playing') {
      this.logger.warn(`[游戏结果] 玩家 ${session.userId} 在房间 “${room.id}” 提交成绩，但游戏未在进行中 (当前状态: ${room.state.type})`, { userId: session.userId });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '游戏未进行中' },
      });
      return;
    }

    const player = room.players.get(session.userId);
    if (!player) {
      this.logger.error(`[游戏结果] 房间 “${room.id}” 中找不到玩家 ${session.userId} (记录ID: ${recordId})`, { userId: session.userId });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '房间中找不到玩家' },
      });
      return;
    }

    if (player.isFinished) {
      this.logger.warn(`[游戏结果] 玩家 ${session.userId} 在房间 “${room.id}” 重复提交成绩`, { userId: session.userId });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: true, value: undefined },
      });
      return;
    }

    let recordInfo;
    try {
      if (isNaN(Number(recordId))) throw new Error('Invalid record ID');
      const response = await fetch(`https://phira.5wyxi.com/record/${recordId}`, {
          redirect: 'error'
      });

      if (!response.ok) {
        throw new Error(`API返回了一个神秘的状态： ${response.status}`);
      }

      recordInfo = await response.json() as any;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch record';
      
      this.logger.error(`[游戏结果] 获取记录失败: ${connectionId} (用户: ${session.userId}, 房间: ${room.id}, 记录: ${recordId}, 错误: ${errorMessage})`, { userId: session.userId });
      
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '获取成绩记录失败' },
      });
      return;
    }

    // 标记玩家完成并保存成绩
    player.isFinished = true;
    player.score = {
      score: recordInfo.score ?? 0,
      accuracy: recordInfo.accuracy ?? 0,
      perfect: recordInfo.perfect ?? 0,
      good: recordInfo.good ?? 0,
      bad: recordInfo.bad ?? 0,
      miss: recordInfo.miss ?? 0,
      maxCombo: recordInfo.maxCombo ?? 0,
      finishTime: Date.now(),
    };

    const activePlayers = Array.from(room.players.values()).filter((p) => !p.user.monitor);

    this.logger.mark(`“${session.userInfo.name}” 在房间 “${room.id}” 完成游玩并上传记录（分数：${recordInfo.score}，Acc：${recordInfo.accuracy}）`, { userId: session.userId });

    // 广播 Played 消息给其他玩家
    this.broadcastMessage(room, {
      type: 'Played',
      user: session.userId,
      score: recordInfo.score,
      accuracy: recordInfo.accuracy,
      fullCombo: recordInfo.fullCombo,
    });

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: true, value: undefined },
    });

    // 检查游戏是否结束
    this.checkGameEnd(room);
  }

  private handleAbort(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Abort,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Abort,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    this.logger.info(`[游戏结果] 玩家 “${session.userInfo.name}” (ID: ${session.userId}) 在房间 “${room.id}” 主动放弃`, { userId: session.userId });

    this.broadcastMessage(room, {
      type: 'Abort',
      user: session.userId,
    });

    // 标记玩家为已完成，分数为0
    if (room.state.type === 'Playing') {
      const player = room.players.get(session.userId);
      if (player && !player.isFinished) {
        player.isFinished = true;
        player.score = {
          score: 0,
          accuracy: 0,
          perfect: 0,
          good: 0,
          bad: 0,
          miss: 0,
          maxCombo: 0,
          finishTime: Date.now(),
        };

        this.logger.info(`[游戏结果] 玩家 “${session.userInfo.name}” (ID: ${session.userId}) 在房间 “${room.id}” 已标记为放弃`, { userId: session.userId });

        // 检查游戏是否结束
        this.checkGameEnd(room);
      }
    }

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.Abort,
      result: { ok: true, value: undefined },
    });
  }

  private checkGameEnd(room: Room): void {
    if (room.state.type !== 'Playing') {
      return;
    }

    const activePlayers = Array.from(room.players.values()).filter((playerInfo) => !playerInfo.user.monitor);
    const finishedPlayers = activePlayers.filter((playerInfo) => playerInfo.isFinished);
    const allFinished = finishedPlayers.length === activePlayers.length;

    this.logger.info(`[检查结束] 房间 “${room.id}” 评估中 (进度: ${finishedPlayers.length}/${activePlayers.length})`, { userId: -1 });

    if (activePlayers.length === 0) {
      this.logger.info(`[检查结束] 房间 “${room.id}” 没有活跃玩家，结束游戏`, { userId: -1 });
      this.endGame(room);
      return;
    }

    if (!allFinished) {
      return;
    }

    this.logger.info(`[检查结束] 房间 “${room.id}” 所有玩家已完成 (${activePlayers.length} 人)，结束游戏`, { userId: -1 });

    this.endGame(room);
  }

  private endGame(room: Room): void {
    if (room.state.type !== 'Playing') {
      this.logger.debug(`[结束游戏] 被调用 but 房间 “${room.id}” 不在游戏中状态 (当前状态: ${room.state.type})`, { userId: -1 });
      return;
    }

    const activePlayers = Array.from(room.players.values()).filter((playerInfo) => !playerInfo.user.monitor);
    const uploadedCount = activePlayers.filter(p => p.isFinished).length;
    const abortedCount = activePlayers.length - uploadedCount;

    this.logger.info(`房间 “${room.id}” 对局结束（已上传：${uploadedCount}，中止：${abortedCount}）`, { userId: -1 });

    const rankings: PlayerRanking[] = activePlayers
      .map((playerInfo) => ({
        rank: 0,
        userId: playerInfo.user.id,
        userName: playerInfo.user.name,
        score: playerInfo.score ? { ...playerInfo.score } : null,
      }))
      .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0))
      .map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }));

    this.broadcastMessage(room, { type: 'GameEnd' });

    // Push a summary message to the public screen history
    const summary = rankings.map(r => `${r.rank}. ${r.userName}: ${r.score?.score.toLocaleString() ?? '0'} (${((r.score?.accuracy ?? 0) * 100).toFixed(2)}%)`).join('\n');
    this.roomManager.addMessageToRoom(room.id, {
        type: 'Chat',
        user: -1,
        content: `【游戏结算】\n${summary}`
    });

    const oldState = room.state.type;

    if (room.cycle) {
      this.logger.info(`[结束游戏] 房间 “${room.id}” 开启了循环模式，正在轮换房主`, { userId: -1 });
      
      // 轮换房主到下一个玩家
      const playerIds = Array.from(room.players.keys()).filter((id) => {
        const player = room.players.get(id);
        return player && !player.user.monitor;
      });
      
      if (playerIds.length > 1) {
        const currentOwnerIndex = playerIds.indexOf(room.ownerId);
        const nextOwnerIndex = (currentOwnerIndex + 1) % playerIds.length;
        const newOwnerId = playerIds[nextOwnerIndex];
        
        const oldOwnerId = room.ownerId;
        this.roomManager.changeRoomOwner(room.id, newOwnerId);
        
        this.logger.info(`[房主轮换] 房间 “${room.id}”: ${oldOwnerId} -> ${newOwnerId}`, { userId: -1 });
        
        // 广播房主变更消息
        this.broadcastToRoom(room, {
          type: ServerCommandType.ChangeHost,
          isHost: false,
        });
        
        const newOwnerCallback = this.broadcastCallbacks.get(room.players.get(newOwnerId)?.connectionId ?? '');
        if (newOwnerCallback) {
          newOwnerCallback({
            type: ServerCommandType.ChangeHost,
            isHost: true,
          });
        }
        
        this.broadcastMessage(room, {
          type: 'NewHost',
          user: newOwnerId,
        });
      }
      
      this.roomManager.setRoomState(room.id, {
        type: 'WaitingForReady',
      });
      
      this.logger.info(`[状态变更] 房间 “${room.id}”: ${oldState} -> WaitingForReady`, { userId: -1 });
      
      for (const playerInfo of room.players.values()) {
        playerInfo.isReady = false;
        playerInfo.isFinished = false;
        // playerInfo.score = null; // Keep score for display
      }
      
    } else {
      this.logger.info(`[结束游戏] 房间 “${room.id}” (普通模式)，保留谱面选择`, { userId: -1 });
      
      // Save current chart as last game chart before clearing
      room.lastGameChart = room.selectedChart;

      this.roomManager.setRoomState(room.id, {
        type: 'SelectChart',
        chartId: room.selectedChart?.id ?? null, // Preserve chart ID
      });
      this.roomManager.setSoloConfirmPending(room.id, false);
      
      this.logger.info(`[状态变更] 房间 “${room.id}”: ${oldState} -> SelectChart`, { userId: -1 });
      
      // this.roomManager.setRoomChart(room.id, undefined); // Preserve chart info
      
      for (const playerInfo of room.players.values()) {
        playerInfo.isReady = false;
        playerInfo.isFinished = false;
        // playerInfo.score = null; // Keep score for display
      }
    }

    this.broadcastRoomUpdate(room);

    // 联邦：广播游戏结束事件
    if (this.federationManager?.getConfig?.()?.enabled) {
      this.federationManager.broadcastRoomEvent('game_ended', room.id,
        this.federationManager.buildLocalRoomInfo(room)
      ).catch(() => {});
    }
  }

  public broadcastRoomUpdate(room: Room): void {
    this.logger.info(`[广播] 房间 “${room.id}” 状态更新 (${room.state.type})，广播人数：${room.players.size}`, { userId: -1 });

    this.broadcastToRoom(room, {
      type: ServerCommandType.ChangeState,
      state: room.state,
    });
  }

  private toClientRoomState(room: Room, userId: number): ClientRoomState {
    const users = new Map<number, UserInfo>();
    for (const [id, playerInfo] of room.players.entries()) {
      users.set(id, playerInfo.user);
    }
    // Add special server user info (ID -1, name from config)
    users.set(-1, { id: -1, name: this.serverName, avatar: this.defaultAvatar, monitor: true });

    const player = room.players.get(userId);

    return {
      id: room.id,
      state: room.state,
      live: room.live,
      locked: room.locked,
      cycle: room.cycle,
      isHost: room.ownerId === userId,
      isReady: player?.isReady ?? false,
      users,
    };
  }
}