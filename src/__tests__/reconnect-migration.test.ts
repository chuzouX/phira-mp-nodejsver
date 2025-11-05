/*
 * MIT License
 * Copyright (c) 2024
 * 测试Playing状态下的重连迁移功能
 */

import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { InMemoryRoomManager } from '../domain/rooms/RoomManager';
import { UserInfo, ServerCommandType, ClientCommandType } from '../domain/protocol/Commands';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockAuthService = {
  authenticate: jest.fn(),
};

describe('重连迁移功能测试', () => {
  let protocolHandler: ProtocolHandler;
  let roomManager: InMemoryRoomManager;
  let mockResponses: Map<string, ServerCommandType[]>;

  const mockUserInfo: UserInfo = {
    id: 12345,
    name: '测试用户',
    monitor: false,
  };

  const mockToken = 'a'.repeat(32); // 32字符的token

  beforeEach(() => {
    roomManager = new InMemoryRoomManager(mockLogger);
    protocolHandler = new ProtocolHandler(roomManager, mockAuthService, mockLogger);
    mockResponses = new Map();

    // Mock AuthService
    (mockAuthService.authenticate as jest.Mock).mockResolvedValue(mockUserInfo);
  });

  const createMockSendResponse = (connectionId: string) => {
    const mockFn = jest.fn((response: any) => {
      if (!mockResponses.has(connectionId)) {
        mockResponses.set(connectionId, []);
      }
      mockResponses.get(connectionId)!.push(response.type);
    });
    return mockFn;
  };

  describe('Playing状态下的重连迁移', () => {
  it('应该保留玩家的游戏状态并进行连接迁移', async () => {
    const firstConnectionId = 'conn-1';
    const secondConnectionId = 'conn-2';

    // 直接创建房间（避免复杂的认证流程）
    roomManager.createRoom({
      id: 'test-room',
      name: 'test-room',
      ownerId: mockUserInfo.id,
      ownerInfo: mockUserInfo,
      connectionId: firstConnectionId,
    });

    // 手动设置房间状态为Playing来模拟游戏进行中
    const room = roomManager.getRoomByUserId(mockUserInfo.id);
    if (room) {
      roomManager.setRoomState(room.id, { type: 'Playing' });
    }

    // 验证房间状态为Playing
    const updatedRoom = roomManager.getRoomByUserId(mockUserInfo.id);
    expect(updatedRoom?.state.type).toBe('Playing');

    // 获取玩家初始状态
    const player = updatedRoom?.players.get(mockUserInfo.id);
    expect(player?.connectionId).toBe(firstConnectionId);
    expect(player?.isFinished).toBe(false);
    expect(player?.score).toBeNull();

    // 模拟重连：第二个连接认证同一个用户
    // 手动设置userConnections来模拟已有连接
    (protocolHandler as any).userConnections.set(mockUserInfo.id, firstConnectionId);
    (protocolHandler as any).sessions.set(firstConnectionId, {
      userId: mockUserInfo.id,
      userInfo: mockUserInfo,
      connectionId: firstConnectionId,
    });

    protocolHandler.handleConnection(secondConnectionId);
    
    // 等待一下异步操作
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const mockResponse = createMockSendResponse(secondConnectionId);
    protocolHandler.handleMessage(secondConnectionId, {
      type: ClientCommandType.Authenticate,
      token: mockToken,
    }, mockResponse);
    
    // 等待异步认证完成
    await new Promise(resolve => setTimeout(resolve, 50));

    // 验证连接迁移成功
    const finalRoom = roomManager.getRoomByUserId(mockUserInfo.id);
    const finalPlayer = finalRoom?.players.get(mockUserInfo.id);

    expect(finalPlayer?.connectionId).toBe(secondConnectionId);
    expect(finalPlayer?.isFinished).toBe(false); // 游戏状态应该保留
    expect(finalPlayer?.score).toBeNull(); // 分数状态应该保留
    expect(finalRoom?.state.type).toBe('Playing'); // 房间状态应该保持Playing

    // 验证玩家仍然在房间中
    expect(finalRoom?.players.has(mockUserInfo.id)).toBe(true);
    expect(finalRoom?.players.size).toBe(1);
  });

  it('非Playing状态下应该迁移连接而不是踢出', async () => {
    const firstConnectionId = 'conn-1';
    const secondConnectionId = 'conn-2';

    // 直接创建房间（默认状态为SelectChart）
    roomManager.createRoom({
      id: 'test-room',
      name: 'test-room',
      ownerId: mockUserInfo.id,
      ownerInfo: mockUserInfo,
      connectionId: firstConnectionId,
    });

    // 验证房间状态不是Playing
    const room = roomManager.getRoomByUserId(mockUserInfo.id);
    expect(room?.state.type).toBe('SelectChart');

    // 模拟重连：第二个连接认证同一个用户
    // 手动设置userConnections来模拟已有连接
    (protocolHandler as any).userConnections.set(mockUserInfo.id, firstConnectionId);
    (protocolHandler as any).sessions.set(firstConnectionId, {
      userId: mockUserInfo.id,
      userInfo: mockUserInfo,
      connectionId: firstConnectionId,
    });

    protocolHandler.handleConnection(secondConnectionId);
    
    // 等待一下异步操作
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const mockResponse = createMockSendResponse(secondConnectionId);
    protocolHandler.handleMessage(secondConnectionId, {
      type: ClientCommandType.Authenticate,
      token: mockToken,
    }, mockResponse);
    
    // 等待异步认证完成
    await new Promise(resolve => setTimeout(resolve, 50));

    // 在非Playing状态下，应该迁移连接而不是踢出
    const updatedRoom = roomManager.getRoomByUserId(mockUserInfo.id);

    // 玩家应该仍然在房间中（连接已迁移）
    expect(updatedRoom).not.toBeUndefined();
    expect(updatedRoom?.id).toBe('test-room');
    
    // 验证连接已迁移
    const player = updatedRoom?.players.get(mockUserInfo.id);
    expect(player?.connectionId).toBe(secondConnectionId);
    expect(updatedRoom?.players.size).toBe(1);
  });

    it('应该正确处理migrateConnection方法的边界情况', () => {
      // 测试不存在的用户
      expect(() => {
        roomManager.migrateConnection(99999, 'old-conn', 'new-conn');
      }).not.toThrow();

      // 创建房间和玩家
      const roomId = 'test-room';
      roomManager.createRoom({
        id: roomId,
        name: roomId,
        ownerId: mockUserInfo.id,
        ownerInfo: mockUserInfo,
        connectionId: 'old-conn',
      });

      // 测试正常迁移
      expect(() => {
        roomManager.migrateConnection(mockUserInfo.id, 'old-conn', 'new-conn');
      }).not.toThrow();

      // 验证连接ID已更新
      const room = roomManager.getRoom(roomId);
      const player = room?.players.get(mockUserInfo.id);
      expect(player?.connectionId).toBe('new-conn');
      expect(player?.isConnected).toBe(true);
      expect(player?.disconnectTime).toBeUndefined();
    });

    it('getPlayerByConnectionId应该正确工作', () => {
      const roomId = 'test-room';
      const connectionId = 'test-conn';

      // 创建房间
      roomManager.createRoom({
        id: roomId,
        name: roomId,
        ownerId: mockUserInfo.id,
        ownerInfo: mockUserInfo,
        connectionId,
      });

      // 测试找到玩家
      const result = roomManager.getPlayerByConnectionId(connectionId);
      expect(result).not.toBeNull();
      expect(result?.player.user.id).toBe(mockUserInfo.id);
      expect(result?.room.id).toBe(roomId);

      // 测试找不到玩家
      const notFound = roomManager.getPlayerByConnectionId('nonexistent');
      expect(notFound).toBeNull();
    });
  });
});