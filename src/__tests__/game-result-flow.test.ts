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

    // 非循环模式：应该回到 SelectChart 状态并清除谱面
    expect(room.state.type).toBe('SelectChart');
    expect(room.selectedChart).toBeUndefined(); // 谱面应该被清除
    for (const playerInfo of room.players.values()) {
      expect(playerInfo.isFinished).toBe(false);
      expect(playerInfo.score).toBeNull();
      expect(playerInfo.isReady).toBe(false);
    }
  });

  it('should preserve chart and go to WaitingForReady when cycle mode is enabled', () => {
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

    // 设置循环模式和谱面
    roomManager.setRoomCycle(roomId, true); // 开启循环模式
    room.selectedChart = { id: 42, name: 'Test Chart' };
    roomManager.setRoomState(roomId, { type: 'Playing' });

    // Register broadcast callbacks
    (protocolHandler as any).broadcastCallbacks.set(ownerConnection, mockSendResponseOwner);
    (protocolHandler as any).broadcastCallbacks.set(guestConnection, mockSendResponseGuest);

    // Owner submits result
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

    // 循环模式：应该回到 WaitingForReady 状态并保留谱面
    expect(room.state.type).toBe('WaitingForReady');
    expect(room.selectedChart).toEqual({ id: 42, name: 'Test Chart' }); // 谱面应该保留
    expect(room.cycle).toBe(true); // 循环模式应该保持开启
    
    for (const playerInfo of room.players.values()) {
      expect(playerInfo.isFinished).toBe(false);
      expect(playerInfo.score).toBeNull();
      expect(playerInfo.isReady).toBe(false);
    }
  });

  it('should end game when a player disconnects during gameplay', () => {
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

    // Owner submits result
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

    // Verify owner finished but game has not ended yet
    const ownerPlayer = room.players.get(ownerId);
    expect(ownerPlayer?.isFinished).toBe(true);
    expect(room.state.type).toBe('Playing'); // Still playing

    mockSendResponseOwner.mockClear();
    mockSendResponseGuest.mockClear();

    // Guest disconnects (simulating a disconnect during game)
    protocolHandler.handleDisconnection(guestConnection);

    // After removing the guest, check if the room still exists
    // The room should not be deleted if there are still players
    const updatedRoom = roomManager.getRoom(roomId);
    expect(updatedRoom).not.toBeUndefined();

    // The room should have ended the game and reset state
    if (updatedRoom) {
      expect(updatedRoom.state.type).toBe('SelectChart');
      expect(updatedRoom.selectedChart).toBeUndefined();
      
      // Owner should be reset
      const updatedOwnerPlayer = updatedRoom.players.get(ownerId);
      expect(updatedOwnerPlayer?.isFinished).toBe(false);
      expect(updatedOwnerPlayer?.score).toBeNull();
      expect(updatedOwnerPlayer?.isReady).toBe(false);
    }

    // Verify GameEnded was broadcast
    const ownerCallTypes = mockSendResponseOwner.mock.calls.map((call) => call[0].type);
    expect(ownerCallTypes).toContain(ServerCommandType.GameEnded);
    expect(ownerCallTypes).toContain(ServerCommandType.ChangeState);
  });

  it('should rotate host in cycle mode after game ends', () => {
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

    // 开启循环模式
    roomManager.setRoomCycle(roomId, true);
    room.selectedChart = { id: 42, name: 'Test Chart' };
    roomManager.setRoomState(roomId, { type: 'Playing' });

    // Register broadcast callbacks
    (protocolHandler as any).broadcastCallbacks.set(ownerConnection, mockSendResponseOwner);
    (protocolHandler as any).broadcastCallbacks.set(guestConnection, mockSendResponseGuest);

    // 验证初始房主是 owner
    expect(room.ownerId).toBe(ownerId);

    // Owner submits result
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

    // 循环模式：房主应该轮换到 guest
    expect(room.ownerId).toBe(guestId);
    expect(room.state.type).toBe('WaitingForReady');
    expect(room.selectedChart).toEqual({ id: 42, name: 'Test Chart' }); // 谱面应该保留

    // 验证 ChangeHost 消息被发送
    const guestCallTypes = mockSendResponseGuest.mock.calls.map((call) => call[0].type);
    expect(guestCallTypes).toContain(ServerCommandType.ChangeHost);

    // 验证 NewHost 消息被广播
    const guestMessages = mockSendResponseGuest.mock.calls
      .filter((call) => call[0].type === ServerCommandType.Message)
      .map((call) => call[0].message);
    expect(guestMessages).toContainEqual(
      expect.objectContaining({
        type: 'NewHost',
        user: guestId,
      }),
    );
  });

  it('should end game when a player aborts and other players finish', () => {
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

    // Owner aborts
    protocolHandler.handleMessage(
      ownerConnection,
      {
        type: ClientCommandType.Abort,
      },
      mockSendResponseOwner,
    );

    // Verify owner is marked as finished
    const ownerPlayer = room.players.get(ownerId);
    expect(ownerPlayer?.isFinished).toBe(true);
    expect(ownerPlayer?.score?.score).toBe(0);

    // Clear mocks for next phase
    mockSendResponseOwner.mockClear();
    mockSendResponseGuest.mockClear();

    // Guest submits result, game should end
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

    // Verify game ended
    const guestCallTypes = mockSendResponseGuest.mock.calls.map((call) => call[0].type);
    expect(guestCallTypes).toContain(ServerCommandType.GameEnded);

    const ownerCallTypes = mockSendResponseOwner.mock.calls.map((call) => call[0].type);
    expect(ownerCallTypes).toContain(ServerCommandType.GameEnded);

    // Verify state changed to SelectChart
    expect(room.state.type).toBe('SelectChart');
  });
});
