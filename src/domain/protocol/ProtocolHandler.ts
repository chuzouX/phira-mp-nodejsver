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
  Message,
} from './Commands';
import { PluginManager } from '../../plugins';
import { handleAuthenticate } from './handlers/auth';
import { handleChat } from './handlers/chat';
import { handleTouches, handleJudges } from './handlers/input';
import {
  handleCreateRoom,
  handleJoinRoom,
  handleLeaveRoom,
  handleLockRoom,
  handleCycleRoom,
} from './handlers/room';
import {
  handleSelectChart,
  handleRequestStart,
  handleReady,
  handleCancelReady,
  handlePlayed,
  handleAbort,
  checkGameEnd,
  endGame,
} from './handlers/game';

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
  private federationManager: any = null;
  private federationEnabled = false;
  private pluginManager?: PluginManager;
  private readonly roomTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly roomManager: RoomManager,
    private readonly authService: AuthService,
    private readonly logger: Logger,
    private serverName: string,
    private phiraApiUrl: string,
    private readonly onSessionChange?: () => void,
    private readonly banManager?: BanManager,
    private serverAnnouncement: string = '你好{{name}}，欢迎来到 {{serverName}} 服务器',
    private defaultAvatar: string = 'https://phira.5wyxi.com/files/6ad662de-b505-4725-a7ef-72d65f32b404',
  ) {}

  public reloadConfig(
    serverName: string,
    phiraApiUrl: string,
    serverAnnouncement: string,
    defaultAvatar: string,
  ): void {
    this.serverName = serverName;
    this.phiraApiUrl = phiraApiUrl;
    this.serverAnnouncement = serverAnnouncement;
    this.defaultAvatar = defaultAvatar;
    this.logger.info('[协议] 已重新加载配置');
  }

  public getSessionCount(): number {
    return this.sessions.size;
  }

  // ========== 联邦功能方法 ==========

  public setFederationManager(fm: any): void {
    this.federationManager = fm;
    this.federationEnabled = !!fm?.getConfig?.()?.enabled;
  }

  public setPluginManager(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager;
  }

  /** 为外部系统（如联邦插件）创建虚拟会话，无真实TCP连接 */
  public addVirtualSession(
    connectionId: string,
    userId: number,
    userInfo: UserInfo,
    broadcastCallback: (cmd: ServerCommand) => void,
  ): void {
    this.sessions.set(connectionId, {
      userId,
      userInfo,
      connectionId,
      ip: 'virtual',
    });
    this.broadcastCallbacks.set(connectionId, broadcastCallback);
    this.userConnections.set(userId, connectionId);
    this.onSessionChange?.();
    this.logger.debug(
      `[虚拟] 已创建虚拟会话: ${connectionId} (用户: ${userInfo.name}, ID: ${userId})`,
      { userId },
    );
  }

  /** 移除虚拟会话 */
  public removeVirtualSession(connectionId: string): void {
    const session = this.sessions.get(connectionId);
    if (session) {
      if (this.userConnections.get(session.userId) === connectionId) {
        this.userConnections.delete(session.userId);
      }
      this.sessions.delete(connectionId);
      this.broadcastCallbacks.delete(connectionId);
      this.onSessionChange?.();
      this.logger.debug(`[虚拟] 已移除虚拟会话: ${connectionId}`, { userId: session.userId });
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

  public getConnectionIdByUserId(userId: number): string | undefined {
    return this.userConnections.get(userId);
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

  public broadcastToRoomById(roomId: string, command: ServerCommand): boolean {
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      return false;
    }

    this.broadcastToRoom(room, command);
    return true;
  }

  public kickIp(ip: string): void {
    const connectionsToKick = Array.from(this.connectionIps.entries()).filter(
      ([_, connIp]) => connIp === ip,
    );

    for (const [connectionId, _] of connectionsToKick) {
      const session = this.sessions.get(connectionId);
      if (session) {
        this.logger.info(
          `IP ${ip} 已被封禁，正在踢出玩家 ${session.userId} (${session.userInfo.name})`,
          { userId: -1 },
        );
        this.kickPlayer(session.userId);
      } else {
        const closer = this.connectionClosers.get(connectionId);
        if (closer) {
          this.logger.info(`IP ${ip} 已被封禁，正在强制断开未验证连接 ${connectionId}`, {
            userId: -1,
          });
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

    this.pluginManager?.emit('room:gameStart', {
      room,
      triggeredBy: -1,
      mode: 'force',
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

    this.logger.info(`管理员已将房间 “${roomId}” 的锁定状态修改为: ${newLockState}`, {
      userId: -1,
    });
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

    this.logger.info(`管理员已将房间 “${roomId}” 的循环状态切换为: ${newCycleState}`, {
      userId: -1,
    });
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
          redirect: 'error',
        });
        if (response.ok) {
          const data = (await response.json()) as any;
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
      content: content,
    });

    // Check currently in-room players and kick if blacklisted
    const currentPlayers = Array.from(room.players.values());
    for (const player of currentPlayers) {
      if (userIds.includes(player.user.id)) {
        this.logger.info(`管理员在房间 “${roomId}” 强制踢出黑名单玩家: ${player.user.id}`, {
          userId: -1,
        });
        this.kickPlayer(player.user.id);
      }
    }

    this.logger.info(`管理员更新了房间 “${roomId}” 的黑名单，当前人数: ${userIds.length}`, {
      userId: -1,
    });
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
          redirect: 'error',
        });
        if (response.ok) {
          const data = (await response.json()) as any;
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
      content: content,
    });

    // Enforcement: Kick anyone NOT in the whitelist (if whitelist is active)
    if (userIds.length > 0) {
      const currentPlayers = Array.from(room.players.values());
      for (const player of currentPlayers) {
        const userId = player.user.id;
        // Don't kick the room owner or the server user (-1) or those in whitelist
        if (userId !== room.ownerId && userId !== -1 && !userIds.includes(userId)) {
          this.logger.info(`管理员在房间 “${roomId}” 强制踢出非白名单玩家: ${userId}`, {
            userId: -1,
          });
          this.kickPlayer(userId);
        }
      }
    }

    this.logger.info(`管理员更新了房间 “${roomId}” 的白名单，当前人数: ${userIds.length}`, {
      userId: -1,
    });
    return true;
  }

  public getAllSessions(): {
    id: number;
    name: string;
    roomId?: string;
    roomName?: string;
    ip: string;
  }[] {
    const sessions: { id: number; name: string; roomId?: string; roomName?: string; ip: string }[] =
      [];
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
    _connectionId: string,
    sendResponse: (response: ServerCommand) => void,
    response: ServerCommand,
  ): void {
    sendResponse(response);
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

    // 联邦：广播房间事件消息
    if (this.federationEnabled) {
      this.federationManager
        .broadcastRoomEvent(
          'room_updated',
          room.id,
          this.federationManager.buildLocalRoomInfo(room),
        )
        .catch(() => {});
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
        this.logger.debug(
          `广播命令给客户端: ${playerInfo.connectionId} (${ServerCommandType[command.type]})`,
          { userId: playerInfo.user.id },
        );
      }
    }
  }

  private broadcastToActivePlayers(room: Room, command: ServerCommand): void {
    for (const playerInfo of room.players.values()) {
      if (playerInfo.isFinished) continue;
      const callback = this.broadcastCallbacks.get(playerInfo.connectionId);
      if (callback) {
        callback(command);
      }
    }
  }

  private async fetchChartInfo(chartId: number): Promise<ChartInfo> {
    if (isNaN(Number(chartId))) throw new Error('Invalid chart ID');
    this.logger.debug(`正在获取谱面信息: ${chartId}`, { userId: -1 });

    const response = await fetch(`https://phira.5wyxi.com/chart/${chartId}`, {
      headers: { 'User-Agent': 'PhiraServer/1.0' },
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(`API返回了一个神秘的状态： ${response.status}`);
    }

    const chartData = (await response.json()) as any;

    // Explicitly extract uploader ID as a number
    const rawUploader = chartData.uploader ?? chartData.uploaderId;
    const uploaderId =
      rawUploader !== undefined && rawUploader !== null ? Number(rawUploader) : undefined;

    this.logger.debug(`谱面 API 响应: ${chartData.name} (ID: ${chartId}, 上传者: ${uploaderId})`, {
      userId: -1,
    });

    let uploaderInfo;
    if (uploaderId && !isNaN(Number(uploaderId))) {
      try {
        const userResponse = await fetch(`https://phira.5wyxi.com/user/${uploaderId}`, {
          headers: { 'User-Agent': 'PhiraServer/1.0' },
          redirect: 'error',
        });
        if (userResponse.ok) {
          const userData = (await userResponse.json()) as any;
          uploaderInfo = {
            id: userData.id,
            name: userData.name,
            avatar: userData.avatar ?? this.defaultAvatar,
            rks: userData.rks ?? 0,
            bio: userData.bio,
          };
          this.logger.debug(`成功获取上传者信息: ${userData.name} (ID: ${uploaderId})`, {
            userId: -1,
          });
        } else {
          this.logger.warn(
            `获取上传者信息失败: API 返回 ${userResponse.status} (ID: ${uploaderId})`,
            { userId: -1 },
          );
        }
      } catch (error) {
        this.logger.error(
          `获取上传者信息出错: ${error instanceof Error ? error.message : String(error)} (ID: ${uploaderId})`,
          { userId: -1 },
        );
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

  handleConnection(
    connectionId: string,
    closeConnection?: () => void,
    ip: string = 'unknown',
  ): void {
    this.logger.debug(
      `建立新连接: ${connectionId} (${ip}) (当前房间总数: ${this.roomManager.count()})`,
      { userId: -1 },
    );

    if (closeConnection) {
      this.connectionClosers.set(connectionId, closeConnection);
    }
    this.connectionIps.set(connectionId, ip);
    this.pluginManager?.emit('player:connect', { connectionId, ip });
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
        this.logger.info(
          `[联邦断线] 代理玩家 ${session.userInfo.name} (${session.userId}) 已断开`,
          { userId: session.userId },
        );
        return;
      }

      const room = this.roomManager.getRoomByUserId(session.userId);
      if (room) {
        const roomId = room.id;
        const wasPlaying = room.state.type === 'Playing';
        const wasHost = room.ownerId === session.userId;

        if (wasPlaying) {
          const player = room.players.get(session.userId);
          if (player && !player.isFinished) {
            this.logger.info(
              `[断线] 玩家 “${session.userInfo.name}” (ID: ${session.userId}) 在房间 “${room.id}” 游戏中途断线，已标记为放弃`,
              { userId: session.userId },
            );

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

        const updatedRoom = this.roomManager.getRoom(roomId);

        if (updatedRoom) {
          updatedRoom.live = Array.from(updatedRoom.players.values()).some(
            (playerInfo) => playerInfo.user.monitor,
          );
        }

        // 处理房主转移广播
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

        // 广播离开事件给房间内其他人
        this.broadcastToRoom(room, {
          type: ServerCommandType.Message,
          message: {
            type: 'LeaveRoom',
            user: session.userId,
            name: session.userInfo.name,
          },
        });

        // 广播给联邦节点
        if (this.federationEnabled) {
          if (updatedRoom) {
            this.federationManager
              .broadcastRoomEvent(
                'room_updated',
                roomId,
                this.federationManager.buildLocalRoomInfo(updatedRoom),
              )
              .catch(() => {});
          } else {
            this.federationManager
              .broadcastRoomEvent('room_deleted', roomId, { id: roomId })
              .catch(() => {});
          }
        }

        if (wasPlaying) {
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
    this.pluginManager?.emit('player:disconnect', {
      connectionId,
      userId: session?.userId,
      user: session?.userInfo,
      ip: session?.ip ?? this.connectionIps.get(connectionId),
    });
    this.logger.debug(
      `[断线] 连接已断开: ${connectionId}${session ? ` (用户: ${session.userInfo.name} ID: ${session.userId})` : ''}`,
      { userId: session?.userId },
    );
  }

  handleMessage(
    connectionId: string,
    message: ClientCommand,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    this.logger.debug(`收到消息: ${connectionId} (类型: ${ClientCommandType[message.type]})`, {
      userId: session?.userId,
    });

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

    this.pluginManager?.emit('protocol:beforeHandle', { connectionId, command: message });
    void this.pluginManager?.handlePacket(connectionId, message);

    switch (message.type) {
      case ClientCommandType.Authenticate:
        this.handleAuthenticate(connectionId, message.token, sendResponse);
        break;

      case ClientCommandType.Chat:
        this.handleChat(connectionId, message.message, sendResponse);
        break;

      case ClientCommandType.Touches:
        this.handleTouches(connectionId, message.frames);
        break;

      case ClientCommandType.Judges:
        this.handleJudges(connectionId, message.judges);
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
        this.logger.warn(
          `收到未知的指令类型: ${connectionId} (类型: ${ClientCommandType[message.type]})`,
          { userId: session?.userId },
        );
        break;
    }

    this.pluginManager?.emit('protocol:afterHandle', { connectionId, command: message });
  }

  private async fetchUserInfo(userId: number): Promise<{ rks?: number; bio?: string }> {
    if (isNaN(Number(userId))) return {};
    try {
      const response = await fetch(`https://phira.5wyxi.com/user/${userId}`, {
        headers: { 'User-Agent': 'PhiraServer/1.0' },
        redirect: 'error',
      });
      if (response.ok) {
        const userData = (await response.json()) as any;
        return { rks: userData.rks ?? 0, bio: userData.bio };
      }
    } catch (error) {
      this.logger.error(
        `获取用户详细信息失败: ${error instanceof Error ? error.message : String(error)} (ID: ${userId})`,
        { userId: -1 },
      );
    }
    return {};
  }

  private handleAuthenticate(
    connectionId: string,
    token: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleAuthenticate(this as any, connectionId, token, sendResponse);
  }

  private handleTouches(connectionId: string, frames: import('./Commands').TouchFrame[]): void {
    handleTouches(this as any, connectionId, frames);
  }

  private handleJudges(connectionId: string, judges: import('./Commands').JudgeEvent[]): void {
    handleJudges(this as any, connectionId, judges);
  }

  private handleChat(
    connectionId: string,
    message: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleChat(this as any, connectionId, message, sendResponse);
  }

  private handleCreateRoom(
    connectionId: string,
    roomId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleCreateRoom(this as any, connectionId, roomId, sendResponse);
  }

  private handleJoinRoom(
    connectionId: string,
    roomId: string,
    monitor: boolean,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleJoinRoom(this as any, connectionId, roomId, monitor, sendResponse);
  }

  private handleLeaveRoom(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleLeaveRoom(this as any, connectionId, sendResponse);
  }

  private handleLockRoom(
    connectionId: string,
    lock: boolean,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleLockRoom(this as any, connectionId, lock, sendResponse);
  }

  private handleCycleRoom(
    connectionId: string,
    cycle: boolean,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleCycleRoom(this as any, connectionId, cycle, sendResponse);
  }

  private handleSelectChart(
    connectionId: string,
    chartId: number,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleSelectChart(this as any, connectionId, chartId, sendResponse);
  }

  private handleRequestStart(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleRequestStart(this as any, connectionId, sendResponse);
  }

  private handleReady(connectionId: string, sendResponse: (response: ServerCommand) => void): void {
    handleReady(this as any, connectionId, sendResponse);
  }

  private handleCancelReady(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    handleCancelReady(this as any, connectionId, sendResponse);
  }

  private async handlePlayed(
    connectionId: string,
    recordId: number,
    sendResponse: (response: ServerCommand) => void,
  ): Promise<void> {
    await handlePlayed(this as any, connectionId, recordId, sendResponse);
  }

  private handleAbort(connectionId: string, sendResponse: (response: ServerCommand) => void): void {
    handleAbort(this as any, connectionId, sendResponse);
  }

  private checkGameEnd(room: Room): void {
    checkGameEnd(this as any, room);
  }

  private endGame(room: Room): void {
    endGame(this as any, room);
  }

  public broadcastRoomUpdate(room: Room): void {
    this.logger.info(
      `[广播] 房间 “${room.id}” 状态更新 (${room.state.type})，广播人数：${room.players.size}`,
      { userId: -1 },
    );

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
