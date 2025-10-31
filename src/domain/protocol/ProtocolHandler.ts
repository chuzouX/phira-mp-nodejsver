/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';
import { RoomManager } from '../rooms/RoomManager';

export interface ProtocolMessage {
  type: string;
  payload: unknown;
}

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

  handleMessage(connectionId: string, message: ProtocolMessage): void {
    this.logger.debug('Protocol message received', {
      connectionId,
      messageType: message.type,
    });
  }

  handleDisconnection(connectionId: string): void {
    this.logger.info('Protocol connection closed', { connectionId });
  }
}
