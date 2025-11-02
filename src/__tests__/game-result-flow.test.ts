/*
 * MIT License
 * Copyright (c) 2024
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

describe('Game result flow', () => {
  let protocolHandler: ProtocolHandler;
  let roomManager: InMemoryRoomManager;
  let mockSendResponseOwner: jest.Mock;
  let mockSendResponseGuest: jest.Mock;

  beforeEach(() => {
    roomManager = new InMemoryRoomManager(mockLogger);
    protocolHandler = new ProtocolHandler(roomManager, mockAuthService, mockLogger);
    mockSendResponseOwner = jest.fn();
    mockSendResponseGuest = jest.fn();
  });

  it('should acknowledge player results and broadcast rankings when game ends', () => {
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

    // Owner submits result first
    protocolHandler.handleMessage(
      ownerConnection,
      {
        type: ClientCommandType.GameResult,
        score: 1_000_000,
        accuracy: 99.5,
        perfect: 500,
        good: 20,
        bad: 0,
        miss: 0,
        maxCombo: 600,
      },
      mockSendResponseOwner,
    );

    const ownerAck = mockSendResponseOwner.mock.calls.find(
      (call) => call[0].type === ServerCommandType.GameResultReceived,
    );
    expect(ownerAck).toBeDefined();
    expect(ownerAck?.[0]).toEqual(
      expect.objectContaining({
        type: ServerCommandType.GameResultReceived,
        result: { ok: true, value: undefined },
      }),
    );

    const ownerPlayer = room.players.get(ownerId);
    expect(ownerPlayer?.isFinished).toBe(true);
    expect(ownerPlayer?.score?.score).toBe(1_000_000);

    const guestPlayerFinished = mockSendResponseGuest.mock.calls.find(
      (call) => call[0].type === ServerCommandType.PlayerFinished,
    );
    expect(guestPlayerFinished).toBeDefined();
    expect(guestPlayerFinished?.[0]).toEqual(
      expect.objectContaining({
        type: ServerCommandType.PlayerFinished,
        player: expect.objectContaining({ userId: ownerId }),
      }),
    );

    // Clear mocks for next phase
    mockSendResponseOwner.mockClear();
    mockSendResponseGuest.mockClear();

    // Guest submits result, triggering game end
    protocolHandler.handleMessage(
      guestConnection,
      {
        type: ClientCommandType.GameResult,
        score: 750_000,
        accuracy: 95.2,
        perfect: 420,
        good: 60,
        bad: 10,
        miss: 8,
        maxCombo: 450,
      },
      mockSendResponseGuest,
    );

    const guestCallTypes = mockSendResponseGuest.mock.calls.map((call) => call[0].type);
    expect(guestCallTypes[0]).toBe(ServerCommandType.GameResultReceived);
    expect(guestCallTypes).toContain(ServerCommandType.GameEnded);
    expect(guestCallTypes).toContain(ServerCommandType.ChangeState);

    const ownerCallTypes = mockSendResponseOwner.mock.calls.map((call) => call[0].type);
    expect(ownerCallTypes).toContain(ServerCommandType.PlayerFinished);
    expect(ownerCallTypes).toContain(ServerCommandType.GameEnded);
    expect(ownerCallTypes).toContain(ServerCommandType.ChangeState);

    const gameEndedCall = mockSendResponseOwner.mock.calls.find((call) => call[0].type === ServerCommandType.GameEnded);
    expect(gameEndedCall).toBeDefined();
    const gameEndedPayload = gameEndedCall![0];
    expect(gameEndedPayload.rankings).toHaveLength(2);
    expect(gameEndedPayload.rankings[0]).toEqual(
      expect.objectContaining({ userId: ownerId, rank: 1 }),
    );
    expect(gameEndedPayload.chartId).toBe(42);
    expect(typeof gameEndedPayload.endedAt).toBe('number');

    expect(room.state.type).toBe('SelectChart');
    for (const playerInfo of room.players.values()) {
      expect(playerInfo.isFinished).toBe(false);
      expect(playerInfo.score).toBeNull();
      expect(playerInfo.isReady).toBe(false);
    }
  });
});
