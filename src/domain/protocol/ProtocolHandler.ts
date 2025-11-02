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

  // Helper to broadcast Message to all room members
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

  // Helper to broadcast ServerCommand to all room members
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

  // Source: phira-mp-server/src/session.rs:559-592
  private async fetchChartInfo(chartId: number): Promise<ChartInfo> {
    // Using the same API endpoint as the Rust implementation
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

  handleConnection(connectionId: string): void {
    this.logger.debug('建立协议连接：', {
      connectionId,
      totalRooms: this.roomManager.count(),
    });
  }

  handleDisconnection(connectionId: string): void {
    const session = this.sessions.get(connectionId);
    if (session) {
      const room = this.roomManager.getRoomByUserId(session.userId);
      if (room) {
        const roomId = room.id;
        const wasPlaying = room.state.type === 'Playing';
        this.roomManager.removePlayerFromRoom(roomId, session.userId);
        if (wasPlaying) {
          const updatedRoom = this.roomManager.getRoom(roomId);
          if (updatedRoom) {
            this.checkGameEnd(updatedRoom);
          }
        }
      }
      this.sessions.delete(connectionId);
    }
    this.broadcastCallbacks.delete(connectionId);
    this.logger.info('协议连接断开：', { connectionId });
  }

  handleMessage(
    connectionId: string,
    message: ClientCommand,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    this.logger.debug('收到协议信息：', {
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
        this.handlePlayed(connectionId, message.id, sendResponse);
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

  // Source: phira-mp-server/src/session.rs:168-257
  private handleAuthenticate(
    connectionId: string,
    token: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    this.logger.debug('重复验证尝试：', { connectionId, tokenLength: token.length });

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

        this.sessions.set(connectionId, {
          userId: userInfo.id,
          userInfo,
          connectionId,
        });

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

  // Source: phira-mp-server/src/session.rs:381-388
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

  // Source: phira-mp-server/src/session.rs:425-450
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

  // Source: phira-mp-server/src/session.rs:452-503
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
      this.logger.info('玩家加入房间：', {
        connectionId,
        userId: session.userId,
        roomId,
        monitor,
      });

      // Broadcast to all members that user joined
      this.broadcastToRoom(room, {
        type: ServerCommandType.OnJoinRoom,
        user: userInfo,
      });

      this.broadcastMessage(room, {
        type: 'JoinRoom',
        user: session.userId,
        name: session.userInfo.name,
      });

      // Send join response
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
        result: { ok: false, error: 'room full' },
      });
    }
  }

  // Source: phira-mp-server/src/session.rs:505-523
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

    // Check if room still exists and handle host transfer
    const updatedRoom = this.roomManager.getRoom(room.id);
    if (updatedRoom && wasHost && updatedRoom.ownerId !== session.userId) {
      this.broadcastMessage(updatedRoom, {
        type: 'NewHost',
        user: updatedRoom.ownerId,
      });

      // Notify new host
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

  // Source: phira-mp-server/src/session.rs:525-540
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

  // Source: phira-mp-server/src/session.rs:542-557
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

    this.logger.info(`${session.userId} 将房间 ${room.id} 循环状态切换为 ${true}`);

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

  // Source: phira-mp-server/src/session.rs:559-592
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

    // Fetch chart async
    const fetchAndUpdate = async (): Promise<void> => {
      try {
        const chart = await this.fetchChartInfo(chartId);

        this.logger.debug('谱面选择成功', {
          connectionId,
          chartId,
          chartName: chart.name,
        });

        // Update room chart
        this.roomManager.setRoomChart(room.id, chart);
        this.roomManager.setRoomState(room.id, { type: 'SelectChart', chartId: chart.id });

        // Broadcast to all room members
        this.broadcastMessage(room, {
          type: 'SelectChart',
          user: session.userId,
          name: chart.name,
          id: chart.id,
        });

        // Broadcast state change
        this.broadcastToRoom(room, {
          type: ServerCommandType.ChangeState,
          state: { type: 'SelectChart', chartId: chart.id },
        });

        // Send success response
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

  // Source: phira-mp-server/src/session.rs:594-612
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

    // Change to WaitingForReady state
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

  // Source: phira-mp-server/src/session.rs:614-629
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

    // Check if all non-host players are ready
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

  // Source: phira-mp-server/src/session.rs:631-651
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

    // Room owners can cancel regardless of their ready state
    // This allows them to cancel the game even when not ready
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

    // If host cancels, cancel entire game
    if (room.ownerId === session.userId) {
      this.roomManager.setRoomState(room.id, { type: 'SelectChart', chartId: room.selectedChart?.id ?? null });

      // Reset all ready states
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

  // Source: phira-mp-server/src/session.rs:653-690
  private handlePlayed(
    connectionId: string,
    recordId: number,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '未验证' },
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Played,
        result: { ok: false, error: '房间不存在喵' },
      });
      return;
    }

    this.logger.info('玩家游玩结束：', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
      recordId,
    });

    // For now, just broadcast the played message
    // In full implementation, would fetch record from API
    this.broadcastMessage(room, {
      type: 'Played',
      user: session.userId,
      score: 0,
      accuracy: 0,
      fullCombo: false,
    });

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: true, value: undefined },
    });
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
        result: { ok: false, error: 'Game not in progress' },
      });
      return;
    }

    const player = room.players.get(session.userId);
    if (!player) {
      this.logger.warn('Game result received but player not found in room', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.GameResultReceived,
        result: { ok: false, error: 'Player not found in room' },
      });
      return;
    }

    if (player.isFinished) {
      this.logger.debug('Duplicate game result submission ignored', {
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

    this.logger.info('Player finished game', {
      connectionId,
      roomId: room.id,
      userId: session.userId,
      score: playerScore.score,
      accuracy: playerScore.accuracy,
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

  // Source: phira-mp-server/src/session.rs:692-710
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

    this.logger.info('玩家流产？（我也看不懂什么意思', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
    });

    this.broadcastMessage(room, {
      type: 'Abort',
      user: session.userId,
    });

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
    if (activePlayers.length === 0) {
      this.logger.info('No active players remaining, ending game', {
        roomId: room.id,
      });
      this.endGame(room);
      return;
    }

    const finishedPlayers = activePlayers.filter((playerInfo) => playerInfo.isFinished);
    if (finishedPlayers.length !== activePlayers.length) {
      this.logger.debug('Waiting for more players to finish', {
        roomId: room.id,
        finished: finishedPlayers.length,
        total: activePlayers.length,
      });
      return;
    }

    this.logger.info('All players finished, ending game', {
      roomId: room.id,
      playerCount: activePlayers.length,
    });

    this.endGame(room);
  }

  private endGame(room: Room): void {
    if (room.state.type !== 'Playing') {
      this.logger.debug('endGame invoked but room not in playing state', {
        roomId: room.id,
        state: room.state.type,
      });
      return;
    }

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

    this.roomManager.setRoomState(room.id, {
      type: 'SelectChart',
      chartId: room.selectedChart?.id ?? null,
    });

    for (const playerInfo of room.players.values()) {
      playerInfo.isReady = false;
      playerInfo.isFinished = false;
      playerInfo.score = null;
    }

    this.logger.info('Game ended, room reset to waiting', {
      roomId: room.id,
      rankings: rankings.map((entry) => ({
        rank: entry.rank,
        userId: entry.userId,
        score: entry.score?.score ?? null,
      })),
    });

    this.broadcastRoomUpdate(room);
  }

  private broadcastRoomUpdate(room: Room): void {
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
