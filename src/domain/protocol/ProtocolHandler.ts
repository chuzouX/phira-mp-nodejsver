/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';
import { RoomManager } from '../rooms/RoomManager';
import {
  ClientCommand,
  ClientCommandType,
  ServerCommand,
  ServerCommandType,
} from './Commands';

export class ProtocolHandler {
  constructor(
    private readonly roomManager: RoomManager,
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

    switch (message.type) {
      case ClientCommandType.Ping:
        sendResponse({ type: ServerCommandType.Pong });
        break;

      case ClientCommandType.Authenticate:
        this.handleAuthenticate(connectionId, message.token, sendResponse);
        break;

      case ClientCommandType.Chat:
        this.logger.debug('Chat message received', {
          connectionId,
          message: message.message,
        });
        sendResponse({ type: ServerCommandType.Chat, success: true });
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

    if (token.length !== 32) {
      this.logger.warn('Invalid token length', { connectionId, tokenLength: token.length });
      sendResponse({
        type: ServerCommandType.Authenticate,
        success: false,
        error: 'Invalid token length',
      });
      return;
    }

    const mockUserId = Math.floor(Math.random() * 1000000);
    const mockUserName = `User_${mockUserId}`;

    this.logger.info('Authentication successful', {
      connectionId,
      userId: mockUserId,
      userName: mockUserName,
    });

    sendResponse({
      type: ServerCommandType.Authenticate,
      success: true,
      user: {
        id: mockUserId,
        name: mockUserName,
        monitor: false,
      },
      room: undefined,
    });
  }

  handleDisconnection(connectionId: string): void {
    this.logger.info('Protocol connection closed', { connectionId });
  }
}
