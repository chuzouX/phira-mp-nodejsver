/*
 * MIT License
 * Copyright (c) 2024
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
      this.logger.debug('Response sent to client', logPayload);
    } else {
      this.logger.info('Response sent to client', logPayload);
    }
  }

  private async fetchChartInfo(chartId: number): Promise<ChartInfo> {
    // Using the same API endpoint as the Rust implementation
    const response = await fetch(`https://phira.5wyxi.com/chart/${chartId}`);
    
    if (!response.ok) {
      throw new Error(`Chart API returned status ${response.status}: ${response.statusText}`);
    }
    
    const chartData = await response.json();
    
    return {
      id: chartData.id,
      name: chartData.name,
      charter: chartData.charter,
      level: chartData.level,
      // Add other fields as needed from the API response
    };
  }

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
        this.respond(connectionId, sendResponse, { type: ServerCommandType.Pong });
        break;

      case ClientCommandType.Pong:
        this.logger.debug('Heartbeat pong received', { connectionId });
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
        this.handleSelectChart(connectionId, message.id, sendResponse).catch((error) => {
          this.logger.error('Error in handleSelectChart', {
            connectionId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
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
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Authenticate,
        success: false,
        error: 'Already authenticated',
      });
      return;
    }

    if (token.length !== 32) {
      this.logger.warn('Invalid token length', { connectionId, tokenLength: token.length });
      this.respond(connectionId, sendResponse, {
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

        this.respond(connectionId, sendResponse, {
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

        this.respond(connectionId, sendResponse, {
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
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Chat,
        success: false,
        error: 'Not authenticated',
      });
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

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.Chat,
      success: true,
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
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    const existingRoom = this.roomManager.getRoomByUserId(session.userId);
    if (existingRoom) {
      this.respond(connectionId, sendResponse, {
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

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CreateRoom,
        success: true,
        room: this.toClientRoomState(room, session.userId),
      });
    } catch (error) {
      const errorMessage = (error as Error).message;

      this.logger.error('Failed to create room', {
        connectionId,
        userId: session.userId,
        roomId,
        error: errorMessage,
      });

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.CreateRoom,
        success: false,
        error: errorMessage,
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
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    const existingRoom = this.roomManager.getRoomByUserId(session.userId);
    if (existingRoom) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        success: false,
        error: 'Already in a room',
      });
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
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

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        success: true,
        room: this.toClientRoomState(room, session.userId),
      });

      this.broadcastToRoom(
        room,
        {
          type: ServerCommandType.OnJoinRoom,
          user: userInfo,
        },
        connectionId,
      );
    } else {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.JoinRoom,
        success: false,
        error: 'Failed to join room',
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
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.LeaveRoom,
        success: false,
        error: 'Not in a room',
      });
      return;
    }

    this.logger.info('Player leaving room', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
    });

    const wasHost = this.roomManager.isRoomOwner(room.id, session.userId);
    const playerRemoved = this.roomManager.removePlayerFromRoom(room.id, session.userId);

    if (playerRemoved) {
      const updatedRoom = this.roomManager.getRoom(room.id);

      if (updatedRoom) {
        this.broadcastToRoom(
          updatedRoom,
          {
            type: ServerCommandType.OnLeaveRoom,
            userId: session.userId,
          },
          connectionId,
        );

        if (wasHost && updatedRoom.players.size > 0 && updatedRoom.ownerId !== session.userId) {
          const newHostId = updatedRoom.ownerId;

          this.broadcastToRoom(updatedRoom, {
            type: ServerCommandType.ChangeHost,
            newHostId,
          });

          this.logger.info('Room host transferred', {
            roomId: updatedRoom.id,
            oldHostId: session.userId,
            newHostId,
          });
        }
      }

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.LeaveRoom,
        success: true,
      });
    } else {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.LeaveRoom,
        success: false,
        error: 'Failed to leave room',
      });
    }
  }

  private handleLockRoom(
    connectionId: string,
    lock: boolean,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not in a room',
      });
      return;
    }

    if (!this.roomManager.isRoomOwner(room.id, session.userId)) {
      this.logger.warn('Non-owner attempted to lock room', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Only room owner can lock or unlock the room',
      });
      return;
    }

    this.roomManager.setRoomLocked(room.id, lock);

    this.logger.info('Room lock state updated', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
      locked: lock,
    });

    const response: ServerCommand = {
      type: ServerCommandType.LockRoom,
      locked: lock,
    };

    this.respond(connectionId, sendResponse, response);
    this.broadcastToRoom(room, response, connectionId);
  }

  private handleCycleRoom(
    connectionId: string,
    cycle: boolean,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not in a room',
      });
      return;
    }

    if (!this.roomManager.isRoomOwner(room.id, session.userId)) {
      this.logger.warn('Non-owner attempted to set cycle mode', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Only room owner can toggle cycle mode',
      });
      return;
    }

    this.roomManager.setRoomCycle(room.id, cycle);

    this.logger.info('Room cycle mode updated', {
      connectionId,
      userId: session.userId,
      roomId: room.id,
      cycle,
    });

    const response: ServerCommand = {
      type: ServerCommandType.CycleRoom,
      cycle,
    };

    this.respond(connectionId, sendResponse, response);
    this.broadcastToRoom(room, response, connectionId);
  }

  private async handleSelectChart(
    connectionId: string,
    chartId: number,
    sendResponse: (response: ServerCommand) => void,
  ): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        success: false,
        error: 'Not in a room',
      });
      return;
    }

    if (!this.roomManager.isRoomOwner(room.id, session.userId)) {
      this.logger.warn('Non-owner attempted to select chart', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        success: false,
        error: 'Only room owner can select chart',
      });
      return;
    }

    try {
      // Fetch chart information from API (similar to Rust implementation)
      const chartInfo = await this.fetchChartInfo(chartId);
      
      // Update room with selected chart
      this.roomManager.setRoomChart(room.id, chartInfo);
      this.roomManager.setRoomState(room.id, { state: 'SelectChart', chartId });

      this.logger.info('Chart selected successfully', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
        chartId,
        chartName: chartInfo.name,
      });

      // Broadcast to all players in the room
      this.broadcastToRoom(room, {
        type: ServerCommandType.OnSelectChart,
        chartId,
      });

      // Send success response to the requester
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to select chart';
      this.logger.error('Failed to select chart', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
        chartId,
        error: errorMessage,
      });

      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        success: false,
        error: errorMessage,
      });
    }
  }

  private handleRequestStart(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        success: false,
        error: 'Not in a room',
      });
      return;
    }

    if (!this.roomManager.isRoomOwner(room.id, session.userId)) {
      this.logger.warn('Non-owner attempted to start game', {
        connectionId,
        userId: session.userId,
        roomId: room.id,
      });
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        success: false,
        error: 'Only room owner can start game',
      });
      return;
    }

    const selectedChart = this.roomManager.getRoomChart(room.id);
    if (!selectedChart) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.RequestStart,
        success: false,
        error: 'No chart selected',
      });
      return;
    }

    this.roomManager.setRoomState(room.id, { state: 'WaitingForReady' });
    this.broadcastToRoom(room, {
      type: ServerCommandType.OnRequestStart,
    });

    this.respond(connectionId, sendResponse, {
      type: ServerCommandType.RequestStart,
      success: true,
    });
  }

  private handleReady(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not in a room',
      });
      return;
    }

    this.roomManager.setPlayerReady(room.id, session.userId, true);

    const readyCommand: ServerCommand = {
      type: ServerCommandType.Ready,
      userId: session.userId,
    };

    this.respond(connectionId, sendResponse, readyCommand);
    this.broadcastToRoom(room, readyCommand, connectionId);

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
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not in a room',
      });
      return;
    }

    this.roomManager.setPlayerReady(room.id, session.userId, false);

    const cancelCommand: ServerCommand = {
      type: ServerCommandType.CancelReady,
      userId: session.userId,
    };

    this.respond(connectionId, sendResponse, cancelCommand);
    this.broadcastToRoom(room, cancelCommand, connectionId);
  }

  private handlePlayed(
    connectionId: string,
    chartId: number,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not in a room',
      });
      return;
    }

    const playedCommand: ServerCommand = {
      type: ServerCommandType.Played,
      userId: session.userId,
      chartId,
    };

    this.respond(connectionId, sendResponse, playedCommand);
    this.broadcastToRoom(room, playedCommand, connectionId);
  }

  private handleAbort(
    connectionId: string,
    sendResponse: (response: ServerCommand) => void,
  ): void {
    const session = this.sessions.get(connectionId);
    if (!session) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not authenticated',
      });
      return;
    }

    const room = this.roomManager.getRoomByUserId(session.userId);
    if (!room) {
      this.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: 'Not in a room',
      });
      return;
    }

    this.roomManager.setRoomState(room.id, { state: 'SelectChart' });

    for (const player of room.players.values()) {
      this.roomManager.setPlayerReady(room.id, player.user.id, false);
    }

    const abortCommand: ServerCommand = {
      type: ServerCommandType.Abort,
    };

    this.respond(connectionId, sendResponse, abortCommand);
    this.broadcastToRoom(room, abortCommand, connectionId);
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
          type: ServerCommandType.OnLeaveRoom,
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
