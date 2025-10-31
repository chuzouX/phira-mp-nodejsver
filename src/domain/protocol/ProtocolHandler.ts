/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';
import { RoomManager, Room } from '../rooms/RoomManager';
import { AuthService } from '../auth/AuthService';
import {
  ClientCommand,
  ClientCommandType,
  ServerCommand,
  ServerCommandType,
  UserInfo,
  ClientRoomState,
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

  handleConnection(connectionId: string): void {
    this.logger.info('Protocol connection established', {
      connectionId,
      totalRooms: this.roomManager.count(),
    });
  }

  handleMessage(
    connectionId: string,
    message: ClientCommand,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    this.logger.debug('Protocol message received', {
      connectionId,
      messageType: ClientCommandType[message.type],
    });

    this.broadcastCallbacks.set(connectionId, sendResponse);

    switch (message.type) {
      case ClientCommandType.Ping:
        sendResponse({ type: ServerCommandType.Pong });
        break;

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

      case ClientCommandType.Abort:
        this.handleAbort(connectionId, sendResponse);
        break;

      default:
        this.logger.warn('Unhandled command type', {
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
    this.logger.info('Authentication attempt', { connectionId, tokenLength: token.length });

    if (this.sessions.has(connectionId)) {
      this.logger.warn('Repeated authentication attempt', { connectionId });
      sendResponse({
        type: ServerCommandType.Authenticate,
        success: false,
        error: 'Already authenticated',
      });
      return;
    }

    if (token.length !== 32) {
      this.logger.warn('Invalid token length', { connectionId, tokenLength: token.length });
      sendResponse({
        type: ServerCommandType.Authenticate,
        success: false,
        error: 'Invalid token length',
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

        this.logger.info('Authentication successful', {
          connectionId,
          userId: userInfo.id,
          userName: userInfo.name,
        });

        sendResponse({
          type: ServerCommandType.Authenticate,
          success: true,
          user: userInfo,
          room: undefined,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
        this.logger.warn('Authentication failed', {
          connectionId,
          error: errorMessage,
        });

        sendResponse({
          type: ServerCommandType.Authenticate,
          success: false,
          error: errorMessage,
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
      sendResponse({ type: ServerCommandType.Chat, success: false, error: 'Not authenticated' });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (room) {
      this.broadcastToRoom(room, { type: ServerCommandType.Message, message });
    }

    this.logger.debug('Chat message received', {
      connectionId,
      userId: session.userId,
      message,
    });
    sendResponse({ type: ServerCommandType.Chat, success: true });
  }

  private handleCreateRoom(
    connectionId: string,
    roomId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      sendResponse({
        type: ServerCommandType.CreateRoom,
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    const existingRoom = this.roomManager.getRoomByUserId(session.userId);
    if (existingRoom) {
      sendResponse({
        type: ServerCommandType.CreateRoom,
        success: false,
        error: 'Already in a room',
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

      this.logger.info('Room created successfully', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });

      sendResponse({
        type: ServerCommandType.CreateRoom,
        success: true,
        room: this.toClientRoomState(room, session.userId),
      });
    } catch (error) {
      this.logger.error('Failed to create room', {
        connectionId,
        userId: session.userId,
        roomId,
        error: (error as Error).message,
      });

      sendResponse({
        type: ServerCommandType.CreateRoom,
        success: false,
        error: (error as Error).message,
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
      sendResponse({
        type: ServerCommandType.JoinRoom,
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    const existingRoom = this.roomManager.getRoomByUserId(session.userId);
    if (existingRoom) {
      sendResponse({
        type: ServerCommandType.JoinRoom,
        success: false,
        error: 'Already in a room',
      });
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      sendResponse({
        type: ServerCommandType.JoinRoom,
        success: false,
        error: 'Room not found',
      });
      return;
    }

    const userInfo = { ...session.userInfo, monitor };
    const success = this.roomManager.addPlayerToRoom(roomId, session.userId, userInfo, connectionId);

    if (success) {
      this.logger.info('Player joined room', {
        connectionId,
        userId: session.userId,
        roomId,
      });

      sendResponse({
        type: ServerCommandType.JoinRoom,
        success: true,
        room: this.toClientRoomState(room, session.userId),
      });

      this.broadcastToRoom(room, {
        type: ServerCommandType.OnJoinRoom,
        user: userInfo,
      }, connectionId);
    } else {
      sendResponse({
        type: ServerCommandType.JoinRoom,
        success: false,
        error: 'Failed to join room',
      });
    }
  }

  private handleLeaveRoom(
    connectionId: string,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    this.logger.info('Player leaving room', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
    });

    this.broadcastToRoom(room, {
      type: ServerCommandType.LeaveRoom,
      userId: session.userId,
    }, connectionId);

    this.roomManager.removePlayerFromRoom(room.id, session.userId);
  }

  private handleLockRoom(
    connectionId: string,
    lock: boolean,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    if (!this.roomManager.isRoomOwner(room.id, session.userId)) {
      this.logger.warn('Non-owner attempted to lock room', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      return;
    }

    this.roomManager.setRoomLocked(room.id, lock);
    this.broadcastToRoom(room, {
      type: ServerCommandType.LockRoom,
      locked: lock,
    });
  }

  private handleCycleRoom(
    connectionId: string,
    cycle: boolean,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    if (!this.roomManager.isRoomOwner(room.id, session.userId)) {
      this.logger.warn('Non-owner attempted to set cycle mode', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      return;
    }

    this.roomManager.setRoomCycle(room.id, cycle);
    this.broadcastToRoom(room, {
      type: ServerCommandType.CycleRoom,
      cycle,
    });
  }

  private handleSelectChart(
    connectionId: string,
    chartId: number,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    if (!this.roomManager.isRoomOwner(room.id, session.userId)) {
      this.logger.warn('Non-owner attempted to select chart', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      return;
    }

    this.roomManager.setRoomState(room.id, { state: 'SelectChart', chartId });
    this.broadcastToRoom(room, {
      type: ServerCommandType.SelectChart,
      chartId,
    });
  }

  private handleRequestStart(
    connectionId: string,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    if (!this.roomManager.isRoomOwner(room.id, session.userId)) {
      this.logger.warn('Non-owner attempted to start game', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      return;
    }

    this.roomManager.setRoomState(room.id, { state: 'WaitingForReady' });
    this.broadcastToRoom(room, {
      type: ServerCommandType.RequestStart,
    });
  }

  private handleReady(
    connectionId: string,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    this.roomManager.setPlayerReady(room.id, session.userId, true);
    this.broadcastToRoom(room, {
      type: ServerCommandType.Ready,
      userId: session.userId,
    });

    const allReady = Array.from(room.players.values()).every((p) => p.isReady || p.user.monitor);
    if (allReady && room.players.size > 0) {
      this.roomManager.setRoomState(room.id, { state: 'Playing' });
      this.broadcastToRoom(room, {
        type: ServerCommandType.ChangeState,
        state: { state: 'Playing' },
      });
    }
  }

  private handleCancelReady(
    connectionId: string,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    this.roomManager.setPlayerReady(room.id, session.userId, false);
    this.broadcastToRoom(room, {
      type: ServerCommandType.CancelReady,
      userId: session.userId,
    });
  }

  private handlePlayed(
    connectionId: string,
    chartId: number,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    this.broadcastToRoom(room, {
      type: ServerCommandType.Played,
      userId: session.userId,
      chartId,
    });
  }

  private handleAbort(
    connectionId: string,
    _sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      return;
    }

    this.roomManager.setRoomState(room.id, { state: 'SelectChart' });

    for (const player of room.players.values()) {
      this.roomManager.setPlayerReady(room.id, player.user.id, false);
    }

    this.broadcastToRoom(room, {
      type: ServerCommandType.Abort,
    });
  }

  private toClientRoomState(room: Room, userId: number): ClientRoomState {
    const users = new Map(
      Array.from(room.players.entries()).map(([id, player]) => [id, player.user]),
    );

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

  private broadcastToRoom(room: Room, command: ServerCommand, excludeConnectionId?: string): void {
    for (const player of room.players.values()) {
      if (player.connectionId !== excludeConnectionId) {
        const callback = this.broadcastCallbacks.get(player.connectionId);
        if (callback) {
          callback(command);
        }
      }
    }
  }

  handleDisconnection(connectionId: string): void {
    const session = this.sessions.get(connectionId);
    if (session) {
      const room = this.roomManager.getRoomByUserId(session.userId);
      if (room) {
        this.broadcastToRoom(room, {
          type: ServerCommandType.LeaveRoom,
          userId: session.userId,
        }, connectionId);

        this.roomManager.removePlayerFromRoom(room.id, session.userId);
      }

      this.sessions.delete(connectionId);
    }

    this.broadcastCallbacks.delete(connectionId);
    this.roomManager.cleanupEmptyRooms();

    this.logger.info('Protocol connection closed', { connectionId });
  }
}
