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
  PlayerScore,
} from './Commands';

interface UserSession {
  userId: number;
  userInfo: UserInfo;
  connectionId: string;
}

export class ProtocolHandler {
  private readonly sessions = new Map<string, UserSession>();
  private readonly broadcastCallbacks = new Map<string, (response: ServerCommand) => void>();
  private readonly userConnections = new Map<number, string>();
  private readonly connectionClosers = new Map<string, () => void>();

  constructor(
    private readonly roomManager: RoomManager,
    private readonly authService: AuthService,
    private readonly logger: Logger,
  ) {}

  private respond(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
    response: ServerCommand,
  ): void {
    sendResponse(response);

    const logPayload = {
      connectionId,
      responseType: ServerCommandType[response.type],
      timestamp: Date.now(),
    };

    if (response.type === ServerCommandType.Pong) {
      this.logger.debug('已将请求发送给客户端：', logPayload);
    } else {
      this.logger.debug('已将请求发送给客户端：', logPayload);
    }
  }

  private broadcastMessage(room: Room, message: Message): void {
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
      }
    }
  }

  private broadcastToRoomExcept(room: Room, excludeUserId: number, command: ServerCommand): void {
    for (const [userId, playerInfo] of room.players.entries()) {
      if (userId === excludeUserId) {
        continue;
      }
      const callback = this.broadcastCallbacks.get(playerInfo.connectionId);
      if (callback) {
        callback(command);
      }
    }
  }

  private async fetchChartInfo(chartId: number): Promise<ChartInfo> {
    const response = await fetch(`https://phira.5wyxi.com/chart/${chartId}`);
    
    if (!response.ok) {
      throw new Error(`API返回了一个神秘的状态： ${response.status}`);
    }
    
    const chartData = await response.json();
    
    return {
      id: chartData.id,
      name: chartData.name,
      charter: chartData.charter,
      level: chartData.level,
    };
  }

  handleConnection(connectionId: string, closeConnection?: () => void): void {
    this.logger.debug('建立连接：', {
      connectionId,
      totalRooms: this.roomManager.count(),
    });
    
    if (closeConnection) {
      this.connectionClosers.set(connectionId, closeConnection);
    }
  }

  handleDisconnection(connectionId: string): void {
    this.connectionClosers.delete(connectionId);

    const session = this.sessions.get(connectionId);
    if (session) {
      const room = this.roomManager.getRoomByUserId(session.userId);
      if (room) {
        const roomId = room.id;
        const wasPlaying = room.state.type === 'Playing';
        
        if (wasPlaying) {
          const player = room.players.get(session.userId);
          if (player && !player.isFinished) {
            this.logger.info('[断线] 玩家游戏中断线并标记为放弃', {
              connectionId,
              userId: session.userId,
              roomId: room.id,
            });

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
            
            this.broadcastToRoomExcept(room, session.userId, {
              type: ServerCommandType.PlayerFinished,
              player: {
                userId: session.userId,
                userName: player.user.name,
                score: null,
              },
            });
            
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
    }
    this.broadcastCallbacks.delete(connectionId);
    this.logger.info('[断线] 连接断开', { 
      connectionId,
      userId: session?.userId,
    });
  }

  handleMessage(
    connectionId: string,
    message: ClientCommand,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    this.logger.debug('收到信息：', {
      connectionId,
      messageType: ClientCommandType[message.type],
    });

    this.broadcastCallbacks.set(connectionId, sendResponse);

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
        // handlePlayed is async but we don't await it (fire-and-forget)
        // Errors are handled internally
        void this.handlePlayed(connectionId, message.id, sendResponse);
        break;

      case ClientCommandType.GameResult:
        this.handleGameResult(connectionId, message, sendResponse);
        break;

      case ClientCommandType.Abort:
        this.handleAbort(connectionId, sendResponse);
        break;

      default:
        this.logger.warn('未知的指令类型：', {
          connectionId,
          messageType: ClientCommandType[message.type],
        });
        break;
    }
  }

  private handleAuthenticate(
    connectionId: string,
    token: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    this.logger.debug('验证尝试：', { connectionId, tokenLength: token.length });

    if (this.sessions.has(connectionId)) {
      this.logger.warn('重复验证尝试：', { connectionId });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Authenticate,
        result: { ok: false, error: '重复的验证' },
      });
      return;
    }

    if (token.length !== 32) {
      this.logger.warn('非法的 Token 长度', { connectionId, tokenLength: token.length });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Authenticate,
        result: { ok: false, error: '非法的 Token' },
      });
      return;
    }

    const authenticate = async (): Promise<void> => {
      try {
        const userInfo = await this.authService.authenticate(token);

        const existingConnectionId = this.userConnections.get(userInfo.id);
        if (existingConnectionId && existingConnectionId !== connectionId) {
          // 检查玩家是否在房间中
          const existingRoom = this.roomManager.getRoomByUserId(userInfo.id);
          
          if (existingRoom) {
            // 玩家在任何房间中，都应该迁移连接而不是移除
            const roomStatus = existingRoom.state.type;
            this.logger.info('[重连迁移] 保留房间成员', {
              userId: userInfo.id,
              roomId: existingRoom.id,
              roomStatus,
              oldConnectionId: existingConnectionId,
              newConnectionId: connectionId,
            });
            
            // 执行连接迁移，保留游戏状态
            this.roomManager.migrateConnection(userInfo.id, existingConnectionId, connectionId);
            
            // 关闭旧连接但不触发断线逻辑
            const closeConnection = this.connectionClosers.get(existingConnectionId);
            if (closeConnection) {
              closeConnection();
            }
            
            // 清理旧连接的会话信息，但不执行房间逻辑
            this.sessions.delete(existingConnectionId);
            this.broadcastCallbacks.delete(existingConnectionId);
            this.connectionClosers.delete(existingConnectionId);
            
            // 如果不是Playing状态，广播房间更新
            if (roomStatus !== 'Playing') {
              this.broadcastRoomUpdate(existingRoom);
            }
          } else {
            // 玩家不在房间中，正常踢出
            this.logger.warn('用户已在其他连接登录，踢出旧连接', {
              userId: userInfo.id,
              oldConnectionId: existingConnectionId,
              newConnectionId: connectionId,
            });
            
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
        });

        this.userConnections.set(userInfo.id, connectionId);

        this.logger.debug('验证成功：', {
          connectionId,
          userId: userInfo.id,
          userName: userInfo.name,
        });

        const room = this.roomManager.getRoomByUserId(userInfo.id);
        const roomState = room ? this.toClientRoomState(room, userInfo.id) : null;

        this.respond(connectionId, sendResponse, {
          type: ServerCommandType.Authenticate,
          result: { ok: true, value: [userInfo, roomState] },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
        this.logger.warn('验证失败：', {
          connectionId,
          error: errorMessage,
        });

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

    this.logger.debug('聊天消息已广播', {
      connectionId,
      userId: session.userId,
      message,
    });

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

      this.broadcastMessage(room, {
        type: 'CreateRoom',
        user: session.userId,
      });

      this.logger.debug(`${session.userId} 创建房间 ${room.id} 成功`);

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CreateRoom,
        result: { ok: true, value: undefined },
      });
    } catch (error) {
      const errorMessage = (error as Error).message;

      this.logger.error('创建房间失败：', {
        connectionId,
        userId: session.userId,
        roomId,
        error: errorMessage,
      });

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
      this.logger.info(`玩家 ${session.userId} 加入房间 ${roomId}`);

      this.broadcastToRoom(room, {
        type: ServerCommandType.OnJoinRoom,
        user: userInfo,
      });

      this.broadcastMessage(room, {
        type: 'JoinRoom',
        user: session.userId,
        name: session.userInfo.name,
      });

      const joinResponse: JoinRoomResponse = {
        state: room.state,
        users: Array.from(room.players.values()).map((p) => p.user),
        live: room.live,
      };

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: true, value: joinResponse },
      });
    } else {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        result: { ok: false, error: '杂鱼~你要加入的房间满了哦' },
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

    this.logger.info('玩家离开房间：', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
    });

    const wasHost = room.ownerId === session.userId;
    const wasPlaying = room.state.type === 'Playing';
    
    this.broadcastMessage(room, {
      type: 'LeaveRoom',
      user: session.userId,
      name: session.userInfo.name,
    });

    this.roomManager.removePlayerFromRoom(room.id, session.userId);

    const updatedRoom = this.roomManager.getRoom(room.id);
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

    this.logger.info(`${session.userId} 将房间 ${room.id} 锁定模式修改为 ${lock}`, {
      connectionId,
      userId: session.userId,
      roomId: room.id,
      lock,
    });

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

    this.logger.info(`${session.userId} 将房间 ${room.id} 循环状态切换为 ${cycle}`, {
      connectionId,
      userId: session.userId,
      roomId: room.id,
      cycle,
    });

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

    this.logger.debug('获取谱面信息：', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
      chartId,
    });

    const fetchAndUpdate = async (): Promise<void> => {
      try {
        const chart = await this.fetchChartInfo(chartId);

        this.logger.debug('谱面选择成功', {
          connectionId,
          chartId,
          chartName: chart.name,
        });

        this.roomManager.setRoomChart(room.id, chart);
        this.roomManager.setRoomState(room.id, { type: 'SelectChart', chartId: chart.id });

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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'failed to fetch chart';
        this.logger.error('获取谱面信息失败：', {
          connectionId,
          chartId,
          error: errorMessage,
        });

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

    if (!room.selectedChart) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        result: { ok: false, error: '杂鱼~你还没选谱面呢' },
      });
      return;
    }

    this.logger.debug('游戏开始请求：', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
    });

    for (const playerInfo of room.players.values()) {
      playerInfo.isReady = false;
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

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.RequestStart,
      result: { ok: true, value: undefined },
    });
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

    this.logger.info('玩家已准备：', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
    });

    this.roomManager.setPlayerReady(room.id, session.userId, true);

    this.broadcastMessage(room, {
      type: 'Ready',
      user: session.userId,
    });

    const allReady = Array.from(room.players.values())
      .filter((p) => p.user.id !== room.ownerId)
      .every((p) => p.isReady);
    if (allReady) {
      this.logger.debug('所有玩家已准备，开始游戏：', { roomId: room.id });

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

    this.logger.debug('玩家取消了准备', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
    });

    this.roomManager.setPlayerReady(room.id, session.userId, false);
    player.isFinished = false;
    player.score = null;

    if (room.ownerId === session.userId) {
      this.roomManager.setRoomState(room.id, { type: 'SelectChart', chartId: room.selectedChart?.id ?? null });

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
      this.logger.warn('[游戏结果] 未验证的Played消息', {
        connectionId,
        recordId,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.logger.error('[游戏结果] 房间不存在', {
        connectionId,
        userId: session.userId,
        recordId,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.state.type !== 'Playing') {
      this.logger.warn('[游戏结果] 游戏未进行中', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
        recordId,
        currentState: room.state.type,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '游戏未进行中' },
      });
      return;
    }

    const player = room.players.get(session.userId);
    if (!player) {
      this.logger.error('[游戏结果] 房间中找不到玩家', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '房间中找不到玩家' },
      });
      return;
    }

    if (player.isFinished) {
      this.logger.warn('[游戏结果] 玩家已经提交过成绩', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: true, value: undefined },
      });
      return;
    }

    let recordInfo;
    try {
      const response = await fetch(`https://phira.5wyxi.com/record/${recordId}`)

      if (!response.ok) {
        throw new Error(`API返回了一个神秘的状态： ${response.status}`);
      }

      recordInfo = await response.json();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch record';
      
      this.logger.error('[游戏结果] 获取记录失败', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
        recordId,
        error: errorMessage,
      });
      
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
    const finishedPlayers = activePlayers.filter((p) => p.isFinished);

    this.logger.info('[游戏结果] 已收到', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
      recordId,
      score: player.score.score,
      accuracy: player.score.accuracy,
      finishedCount: finishedPlayers.length,
      totalPlayers: activePlayers.length,
    });

    // 广播 Played 消息给其他玩家
    this.broadcastMessage(room, {
      type: 'Played',
      user: session.userId,
      score: recordInfo.score,
      accuracy: recordInfo.accuracy,
      fullCombo: recordInfo.fullCombo,
    });

    // 广播 PlayerFinished 给其他玩家
    this.broadcastToRoomExcept(room, session.userId, {
      type: ServerCommandType.PlayerFinished,
      player: {
        userId: session.userId,
        userName: player.user.name,
        score: { ...player.score },
      },
    });

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: true, value: undefined },
    });

    // 检查游戏是否结束
    this.checkGameEnd(room);
  }

  private handleGameResult(
    connectionId: string,
    message: Extract<ClientCommand, { type: ClientCommandType.GameResult }>,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.GameResultReceived,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.GameResultReceived,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    if (room.state.type !== 'Playing') {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.GameResultReceived,
        result: { ok: false, error: '游戏未进行中' },
      });
      return;
    }

    const player = room.players.get(session.userId);
    if (!player) {
      this.logger.warn('收到游戏结果，但在房间里找不到玩家：', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.GameResultReceived,
        result: { ok: false, error: '房间里找不到玩家' },
      });
      return;
    }

    if (player.isFinished) {
      this.logger.debug('重复的游戏结果提交被忽略：', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.GameResultReceived,
        result: { ok: true, value: undefined },
      });
      return;
    }

    const playerScore: PlayerScore = {
      score: message.score,
      accuracy: message.accuracy,
      perfect: message.perfect,
      good: message.good,
      bad: message.bad,
      miss: message.miss,
      maxCombo: message.maxCombo,
      finishTime: Date.now(),
    };

    player.score = playerScore;
    player.isFinished = true;

    const finishedPlayers = Array.from(room.players.values()).filter(
      (p) => !p.user.monitor && p.isFinished
    );
    const activePlayers = Array.from(room.players.values()).filter((p) => !p.user.monitor);

    this.logger.info('[游戏结果] 已收到', {
      connectionId,
      roomId: room.id,
      userId: session.userId,
      score: playerScore.score,
      accuracy: playerScore.accuracy,
      finishedCount: finishedPlayers.length,
      totalPlayers: activePlayers.length,
    });

    const fullCombo = message.miss === 0 && message.bad === 0;

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.GameResultReceived,
      result: { ok: true, value: undefined },
    });

    this.broadcastToRoomExcept(room, session.userId, {
      type: ServerCommandType.PlayerFinished,
      player: {
        userId: session.userId,
        userName: player.user.name,
        score: { ...playerScore },
      },
    });

    this.broadcastMessage(room, {
      type: 'Played',
      user: session.userId,
      score: message.score,
      accuracy: message.accuracy,
      fullCombo,
    });

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

    this.logger.info('[游戏结果] 玩家主动放弃', {
      userId: session.userId,
      roomId: room.id,
      roomStatus: room.state.type,
    });

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

        this.logger.info('[游戏结果] 已标记为放弃', {
          userId: session.userId,
          roomId: room.id,
        });

        // 广播玩家完成消息
        this.broadcastToRoomExcept(room, session.userId, {
          type: ServerCommandType.PlayerFinished,
          player: {
            userId: session.userId,
            userName: player.user.name,
            score: null,
          },
        });

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

    this.logger.info('[检查结束] 正在评估', {
      roomId: room.id,
      onlinePlayers: activePlayers.length,
      finishedPlayers: finishedPlayers.length,
      allFinished,
    });

    if (activePlayers.length === 0) {
      this.logger.info('[检查结束] 没有活跃玩家，结束游戏', {
        roomId: room.id,
      });
      this.endGame(room);
      return;
    }

    if (!allFinished) {
      this.logger.debug('[检查结束] 等待更多玩家完成', {
        roomId: room.id,
        finished: finishedPlayers.length,
        total: activePlayers.length,
      });
      return;
    }

    this.logger.info('[检查结束] 所有玩家已完成', {
      roomId: room.id,
      playerCount: activePlayers.length,
    });

    this.endGame(room);
  }

  private endGame(room: Room): void {
    if (room.state.type !== 'Playing') {
      this.logger.debug('[结束游戏] 调用但房间不在游戏中状态', {
        roomId: room.id,
        currentState: room.state.type,
      });
      return;
    }

    this.logger.info('[结束游戏] 开始', {
      roomId: room.id,
      currentStatus: room.state.type,
      playerCount: room.players.size,
      cycle: room.cycle,
    });

    const endedAt = Date.now();
    const activePlayers = Array.from(room.players.values()).filter((playerInfo) => !playerInfo.user.monitor);

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

    this.broadcastToRoom(room, {
      type: ServerCommandType.GameEnded,
      rankings,
      chartId: room.selectedChart?.id ?? null,
      endedAt,
    });

    this.broadcastMessage(room, { type: 'GameEnd' });

    const oldState = room.state.type;

    if (room.cycle) {
      this.logger.info('[结束游戏] 循环模式已开启，轮换房主并保留谱面', {
        roomId: room.id,
        chartId: room.selectedChart?.id ?? null,
        currentOwnerId: room.ownerId,
      });
      
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
        
        this.logger.info('[房主轮换]', {
          roomId: room.id,
          oldOwnerId,
          newOwnerId,
        });
        
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
      
      this.logger.info('[状态变更]', {
        roomId: room.id,
        from: oldState,
        to: 'WaitingForReady',
      });
      
      for (const playerInfo of room.players.values()) {
        playerInfo.isReady = false;
        playerInfo.isFinished = false;
        playerInfo.score = null;
      }
      
    } else {
      this.logger.info('[结束游戏] 普通模式，清除谱面', {
        roomId: room.id,
      });
      
      this.roomManager.setRoomState(room.id, {
        type: 'SelectChart',
        chartId: null,
      });
      
      this.logger.info('[状态变更]', {
        roomId: room.id,
        from: oldState,
        to: 'SelectChart',
      });
      
      this.roomManager.setRoomChart(room.id, undefined);
      
      for (const playerInfo of room.players.values()) {
        playerInfo.isReady = false;
        playerInfo.isFinished = false;
        playerInfo.score = null;
      }
    }

    this.logger.info('[结束游戏] 完成', {
      roomId: room.id,
      newStatus: room.state.type,
      hasChart: room.selectedChart !== undefined,
      cycle: room.cycle,
      rankings: rankings.map((entry) => ({
        rank: entry.rank,
        userId: entry.userId,
        score: entry.score?.score ?? null,
      })),
    });

    this.broadcastRoomUpdate(room);
  }

  private broadcastRoomUpdate(room: Room): void {
    this.logger.info('[广播] 房间更新', {
      roomId: room.id,
      status: room.state.type,
      recipientCount: room.players.size,
    });

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
