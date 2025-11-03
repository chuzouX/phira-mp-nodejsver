/*
 * MIT License
 * Copyright (c) 2024
 * 
 * Test for Played command handling (recordId-based game result submission)
 */

import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { InMemoryRoomManager } from '../domain/rooms/RoomManager';
import { AuthService } from '../domain/auth/AuthService';
import { Logger } from '../logging/logger';
import { ClientCommandType, ServerCommandType } from '../domain/protocol/Commands';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockAuthService: AuthService = {
  authenticate: jest.fn(),
};

// Mock fetch API
global.fetch = jest.fn();

describe('Played command flow (record-based result submission)', () => {
  let protocolHandler: ProtocolHandler;
  let roomManager: InMemoryRoomManager;
  let mockSendResponseOwner: jest.Mock;
  let mockSendResponseGuest: jest.Mock;

  beforeEach(() => {
    roomManager = new InMemoryRoomManager(mockLogger);
    protocolHandler = new ProtocolHandler(roomManager, mockAuthService, mockLogger);
    mockSendResponseOwner = jest.fn();
    mockSendResponseGuest = jest.fn();
    
    // Reset fetch mock
    (global.fetch as jest.Mock).mockClear();
  });

  it('should mark player as finished and trigger game end when using Played command', async () => {
    const ownerConnection = 'conn-owner';
    const guestConnection = 'conn-guest';
    const ownerId = 1;
    const guestId = 2;
    const roomId = 'room-1';

    // Seed sessions
    (protocolHandler as any).sessions.set(ownerConnection, {
      userId: ownerId,
      userInfo: { id: ownerId, name: 'Owner', monitor: false },
      connectionId: ownerConnection,
    });

    (protocolHandler as any).sessions.set(guestConnection, {
      userId: guestId,
      userInfo: { id: guestId, name: 'Guest', monitor: false },
      connectionId: guestConnection,
    });

    // Create room and populate players
    roomManager.createRoom({
      id: roomId,
      name: roomId,
      ownerId,
      ownerInfo: { id: ownerId, name: 'Owner', monitor: false },
      connectionId: ownerConnection,
    });

    roomManager.addPlayerToRoom(roomId, guestId, { id: guestId, name: 'Guest', monitor: false }, guestConnection);

    const room = roomManager.getRoom(roomId);
    expect(room).not.toBeUndefined();
    if (!room) {
      throw new Error('Room not created');
    }

    room.selectedChart = { id: 42, name: 'Test Chart' };
    roomManager.setRoomState(roomId, { type: 'Playing' });

    // Register broadcast callbacks
    (protocolHandler as any).broadcastCallbacks.set(ownerConnection, mockSendResponseOwner);
    (protocolHandler as any).broadcastCallbacks.set(guestConnection, mockSendResponseGuest);

    // Mock fetch response for owner's record
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 1_000_000,
        accuracy: 99.5,
        perfect: 500,
        good: 20,
        bad: 0,
        miss: 0,
        maxCombo: 600,
        fullCombo: true,
      }),
    });

    // Owner submits result using Played command
    // Note: handleMessage doesn't return a promise, but handlePlayed is async internally
    protocolHandler.handleMessage(
      ownerConnection,
      {
        type: ClientCommandType.Played,
        id: 121745634, // recordId
      },
      mockSendResponseOwner,
    );

    // Wait for async operation to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify owner is marked as finished
    const ownerPlayer = room.players.get(ownerId);
    expect(ownerPlayer?.isFinished).toBe(true);
    expect(ownerPlayer?.score?.score).toBe(1_000_000);
    expect(ownerPlayer?.score?.accuracy).toBe(99.5);

    // Verify Played response
    const ownerAck = mockSendResponseOwner.mock.calls.find(
      (call) => call[0].type === ServerCommandType.Played,
    );
    expect(ownerAck).toBeDefined();
    expect(ownerAck?.[0]).toEqual(
      expect.objectContaining({
        type: ServerCommandType.Played,
        result: { ok: true, value: undefined },
      }),
    );

    // Verify PlayerFinished was broadcast to guest
    const guestPlayerFinished = mockSendResponseGuest.mock.calls.find(
      (call) => call[0].type === ServerCommandType.PlayerFinished,
    );
    expect(guestPlayerFinished).toBeDefined();
    expect(guestPlayerFinished?.[0]).toEqual(
      expect.objectContaining({
        type: ServerCommandType.PlayerFinished,
        player: expect.objectContaining({ 
          userId: ownerId,
          userName: 'Owner',
        }),
      }),
    );

    // Game should still be playing (waiting for guest)
    expect(room.state.type).toBe('Playing');

    mockSendResponseOwner.mockClear();
    mockSendResponseGuest.mockClear();

    // Mock fetch response for guest's record
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 750_000,
        accuracy: 95.2,
        perfect: 420,
        good: 60,
        bad: 10,
        miss: 8,
        maxCombo: 450,
        fullCombo: false,
      }),
    });

    // Guest submits result using Played command, triggering game end
    protocolHandler.handleMessage(
      guestConnection,
      {
        type: ClientCommandType.Played,
        id: 121745646, // recordId
      },
      mockSendResponseGuest,
    );

    // Wait for async operation to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify GameEnded was broadcast to both players
    const guestCallTypes = mockSendResponseGuest.mock.calls.map((call) => call[0].type);
    expect(guestCallTypes).toContain(ServerCommandType.Played);
    expect(guestCallTypes).toContain(ServerCommandType.GameEnded);
    expect(guestCallTypes).toContain(ServerCommandType.ChangeState);

    const ownerCallTypes = mockSendResponseOwner.mock.calls.map((call) => call[0].type);
    expect(ownerCallTypes).toContain(ServerCommandType.PlayerFinished);
    expect(ownerCallTypes).toContain(ServerCommandType.GameEnded);
    expect(ownerCallTypes).toContain(ServerCommandType.ChangeState);

    // Verify game ended and room state reset (non-cycle mode)
    const updatedRoom = roomManager.getRoom(roomId);
    expect(updatedRoom).not.toBeUndefined();
    expect(updatedRoom?.state.type).toBe('SelectChart');
    expect(updatedRoom?.selectedChart).toBeUndefined();
    
    // After endGame, all players should be reset
    for (const playerInfo of updatedRoom!.players.values()) {
      expect(playerInfo.isFinished).toBe(false);
      expect(playerInfo.score).toBeNull();
      expect(playerInfo.isReady).toBe(false);
    }
  });

  it('should reject duplicate Played submissions', async () => {
    const ownerConnection = 'conn-owner';
    const guestConnection = 'conn-guest';
    const ownerId = 1;
    const guestId = 2;
    const roomId = 'room-1';

    // Seed sessions
    (protocolHandler as any).sessions.set(ownerConnection, {
      userId: ownerId,
      userInfo: { id: ownerId, name: 'Owner', monitor: false },
      connectionId: ownerConnection,
    });

    (protocolHandler as any).sessions.set(guestConnection, {
      userId: guestId,
      userInfo: { id: guestId, name: 'Guest', monitor: false },
      connectionId: guestConnection,
    });

    // Create room
    roomManager.createRoom({
      id: roomId,
      name: roomId,
      ownerId,
      ownerInfo: { id: ownerId, name: 'Owner', monitor: false },
      connectionId: ownerConnection,
    });

    // Add guest to room
    roomManager.addPlayerToRoom(roomId, guestId, { id: guestId, name: 'Guest', monitor: false }, guestConnection);

    const room = roomManager.getRoom(roomId);
    expect(room).not.toBeUndefined();
    if (!room) {
      throw new Error('Room not created');
    }

    room.selectedChart = { id: 42, name: 'Test Chart' };
    roomManager.setRoomState(roomId, { type: 'Playing' });

    // Mock fetch response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        score: 1_000_000,
        accuracy: 99.5,
        perfect: 500,
        good: 20,
        bad: 0,
        miss: 0,
        maxCombo: 600,
        fullCombo: true,
      }),
    });

    // First submission
    protocolHandler.handleMessage(
      ownerConnection,
      {
        type: ClientCommandType.Played,
        id: 121745634,
      },
      mockSendResponseOwner,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify first submission succeeded
    const ownerPlayer = room.players.get(ownerId);
    expect(ownerPlayer?.isFinished).toBe(true);

    mockSendResponseOwner.mockClear();

    // Second submission (duplicate)
    protocolHandler.handleMessage(
      ownerConnection,
      {
        type: ClientCommandType.Played,
        id: 121745635,
      },
      mockSendResponseOwner,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify duplicate was acknowledged but fetch was not called again
    const duplicateAck = mockSendResponseOwner.mock.calls.find(
      (call) => call[0].type === ServerCommandType.Played,
    );
    expect(duplicateAck).toBeDefined();
    expect(duplicateAck?.[0]).toEqual(
      expect.objectContaining({
        type: ServerCommandType.Played,
        result: { ok: true, value: undefined },
      }),
    );

    // Fetch should only have been called once (for the first submission)
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should reject Played command when not in Playing state', async () => {
    const ownerConnection = 'conn-owner';
    const ownerId = 1;
    const roomId = 'room-1';

    // Seed session
    (protocolHandler as any).sessions.set(ownerConnection, {
      userId: ownerId,
      userInfo: { id: ownerId, name: 'Owner', monitor: false },
      connectionId: ownerConnection,
    });

    // Create room
    roomManager.createRoom({
      id: roomId,
      name: roomId,
      ownerId,
      ownerInfo: { id: ownerId, name: 'Owner', monitor: false },
      connectionId: ownerConnection,
    });

    const room = roomManager.getRoom(roomId);
    expect(room).not.toBeUndefined();
    if (!room) {
      throw new Error('Room not created');
    }

    // Room is in SelectChart state (not Playing)
    expect(room.state.type).toBe('SelectChart');

    // Try to submit result
    protocolHandler.handleMessage(
      ownerConnection,
      {
        type: ClientCommandType.Played,
        id: 121745634,
      },
      mockSendResponseOwner,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should be rejected
    const response = mockSendResponseOwner.mock.calls.find(
      (call) => call[0].type === ServerCommandType.Played,
    );
    expect(response).toBeDefined();
    expect(response?.[0]).toEqual(
      expect.objectContaining({
        type: ServerCommandType.Played,
        result: { ok: false, error: '游戏未进行中' },
      }),
    );

    // Fetch should not have been called
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
