/*
 * MIT License
 * Copyright (c) 2024
 */

import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { InMemoryRoomManager } from '../domain/rooms/RoomManager';
import { AuthService } from '../domain/auth/AuthService';
import { Logger } from '../logging/logger';
import { ClientCommandType, ServerCommandType } from '../domain/protocol/Commands';

// Mock implementations
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockAuthService: AuthService = {
  authenticate: jest.fn().mockResolvedValue({
    id: 1,
    name: 'TestUser',
    monitor: false,
  }),
};

describe('Room Owner Ready Logic', () => {
  let protocolHandler: ProtocolHandler;
  let roomManager: InMemoryRoomManager;
  let mockSendResponse: jest.Mock;

  beforeEach(() => {
    roomManager = new InMemoryRoomManager(mockLogger);
    protocolHandler = new ProtocolHandler(roomManager, mockAuthService, mockLogger);
    mockSendResponse = jest.fn();
  });

  describe('CancelReady behavior', () => {
    it('should allow room owner to cancel game even when not ready', () => {
      // Create a room and set up owner
      const connectionId = 'conn1';
      const ownerId = 1;
      const roomId = 'test-room';

      // Simulate authenticated session
      (protocolHandler as any).sessions.set(connectionId, {
        userId: ownerId,
        userInfo: { id: ownerId, name: 'Owner', monitor: false },
        connectionId,
      });

      // Create room with owner
      roomManager.createRoom({
        id: roomId,
        name: 'Test Room',
        ownerId,
        ownerInfo: { id: ownerId, name: 'Owner', monitor: false },
        connectionId,
      });

      // Set room to WaitingForReady state (simulating game start request)
      roomManager.setRoomState(roomId, { type: 'WaitingForReady' });

      // Owner is NOT ready (isReady: false by default)
      const room = roomManager.getRoom(roomId);
      const owner = room?.players.get(ownerId);
      expect(owner?.isReady).toBe(false);

      // Owner tries to cancel ready via public interface
      protocolHandler.handleMessage(
        connectionId,
        { type: ClientCommandType.CancelReady },
        mockSendResponse
      );

      // Should succeed and not return "not ready" error
      expect(mockSendResponse).toHaveBeenCalledWith({
        type: ServerCommandType.CancelReady,
        result: { ok: true, value: undefined },
      });

      // Room state should be reset to SelectChart
      const updatedRoom = roomManager.getRoom(roomId);
      expect(updatedRoom?.state.type).toBe('SelectChart');
    });

    it('should still require non-owners to be ready to cancel', () => {
      // Create a room with owner and another player
      const ownerConnectionId = 'conn1';
      const ownerId = 1;
      const playerConnectionId = 'conn2';
      const playerId = 2;
      const roomId = 'test-room';

      // Set up sessions
      (protocolHandler as any).sessions.set(ownerConnectionId, {
        userId: ownerId,
        userInfo: { id: ownerId, name: 'Owner', monitor: false },
        connectionId: ownerConnectionId,
      });

      (protocolHandler as any).sessions.set(playerConnectionId, {
        userId: playerId,
        userInfo: { id: playerId, name: 'Player', monitor: false },
        connectionId: playerConnectionId,
      });

      // Create room
      roomManager.createRoom({
        id: roomId,
        name: 'Test Room',
        ownerId,
        ownerInfo: { id: ownerId, name: 'Owner', monitor: false },
        connectionId: ownerConnectionId,
      });

      // Add player
      roomManager.addPlayerToRoom(roomId, playerId, { id: playerId, name: 'Player', monitor: false }, playerConnectionId);

      // Set room to WaitingForReady state
      roomManager.setRoomState(roomId, { type: 'WaitingForReady' });

      // Player is NOT ready
      const room = roomManager.getRoom(roomId);
      const player = room?.players.get(playerId);
      expect(player?.isReady).toBe(false);

      // Player tries to cancel ready via public interface - should fail with "not ready" error
      protocolHandler.handleMessage(
        playerConnectionId,
        { type: ClientCommandType.CancelReady },
        mockSendResponse
      );

      expect(mockSendResponse).toHaveBeenCalledWith({
        type: ServerCommandType.CancelReady,
        result: { ok: false, error: 'not ready' },
      });
    });

    it('should allow ready non-owners to cancel', () => {
      // Create a room with owner and another player
      const ownerConnectionId = 'conn1';
      const ownerId = 1;
      const playerConnectionId = 'conn2';
      const playerId = 2;
      const roomId = 'test-room';

      // Set up sessions
      (protocolHandler as any).sessions.set(ownerConnectionId, {
        userId: ownerId,
        userInfo: { id: ownerId, name: 'Owner', monitor: false },
        connectionId: ownerConnectionId,
      });

      (protocolHandler as any).sessions.set(playerConnectionId, {
        userId: playerId,
        userInfo: { id: playerId, name: 'Player', monitor: false },
        connectionId: playerConnectionId,
      });

      // Create room
      roomManager.createRoom({
        id: roomId,
        name: 'Test Room',
        ownerId,
        ownerInfo: { id: ownerId, name: 'Owner', monitor: false },
        connectionId: ownerConnectionId,
      });

      // Add player
      roomManager.addPlayerToRoom(roomId, playerId, { id: playerId, name: 'Player', monitor: false }, playerConnectionId);

      // Set room to WaitingForReady state
      roomManager.setRoomState(roomId, { type: 'WaitingForReady' });

      // Set player as ready
      roomManager.setPlayerReady(roomId, playerId, true);

      // Player tries to cancel ready via public interface - should succeed
      protocolHandler.handleMessage(
        playerConnectionId,
        { type: ClientCommandType.CancelReady },
        mockSendResponse
      );

      expect(mockSendResponse).toHaveBeenCalledWith({
        type: ServerCommandType.CancelReady,
        result: { ok: true, value: undefined },
      });
    });
  });
});