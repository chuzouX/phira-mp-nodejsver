
import { ProtocolHandler } from '../src/domain/protocol/ProtocolHandler';
import { RoomManager, Room } from '../src/domain/rooms/RoomManager';
import { AuthService } from '../src/domain/auth/AuthService';
import { BanManager } from '../src/domain/auth/BanManager';
import { Logger } from '../src/logging/logger';
import { ServerCommandType } from '../src/domain/protocol/Commands';

describe('协议处理器 (ProtocolHandler)', () => {
  let handler: ProtocolHandler;
  let mockRoomManager: jest.Mocked<RoomManager>;
  let mockAuthService: jest.Mocked<AuthService>;
  let mockBanManager: jest.Mocked<BanManager>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockRoomManager = {
      getRoom: jest.fn(),
      getRoomByUserId: jest.fn(),
      removePlayerFromRoom: jest.fn(),
      setRoomState: jest.fn(),
      deleteRoom: jest.fn(),
      count: jest.fn(),
      addMessageToRoom: jest.fn(),
    } as any;

    mockAuthService = {} as any;
    
    mockBanManager = {
      isIdBanned: jest.fn().mockReturnValue(null),
      isIpBanned: jest.fn().mockReturnValue(null),
      getRemainingTimeStr: jest.fn().mockReturnValue('1h'),
    } as any;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      mark: jest.fn(),
      ban: jest.fn(),
    } as any;

    handler = new ProtocolHandler(
      mockRoomManager,
      mockAuthService,
      mockLogger,
      'TestServer',
      'https://api.test',
      undefined,
      mockBanManager,
      'Welcome',
      'https://avatar.test'
    );
  });

  test('应当能强制踢出玩家', async () => {
    const mockRoom: Partial<Room> = {
      id: 'room1',
      players: new Map([[123, { user: { id: 123, name: 'Target', monitor: false }, connectionId: 'conn1' } as any]]),
      ownerId: 456
    };
    mockRoomManager.getRoomByUserId.mockReturnValue(mockRoom as Room);
    mockRoomManager.getRoom.mockReturnValue(mockRoom as Room);
    
    // 模拟认证成功，以便建立连接绑定
    mockAuthService.authenticate = jest.fn().mockResolvedValue({ id: 123, name: 'Target', monitor: false });

    const sendResponse = jest.fn();
    handler.handleConnection('conn1', jest.fn(), '1.2.3.4');
    
    // 触发认证消息
    await new Promise<void>(resolve => {
      handler.handleMessage('conn1', { type: 1, token: '12345678901234567890' } as any, (resp) => {
        sendResponse(resp);
        if (resp.type === ServerCommandType.Authenticate) resolve();
      });
    });

    const result = handler.kickPlayer(123);
    
    expect(result).toBe(true);
    expect(mockRoomManager.removePlayerFromRoom).toHaveBeenCalledWith('room1', 123);
    
    // 验证是否发送了 LeaveRoom 命令 (ServerCommandType.LeaveRoom = 11)
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      type: ServerCommandType.LeaveRoom
    }));
  });

  test('应当能强制开始游戏', () => {
    const mockRoom: Partial<Room> = {
      id: 'room1',
      state: { type: 'WaitingForReady' },
      players: new Map([[123, { user: { id: 123, name: 'Host', monitor: false }, isReady: false, connectionId: 'conn1' } as any]]),
      ownerId: 123,
      selectedChart: { id: 1, name: 'Chart' } as any
    };
    mockRoomManager.getRoom.mockReturnValue(mockRoom as Room);

    const result = handler.forceStartGame('room1');
    
    expect(result).toBe(true);
    expect(mockRoomManager.setRoomState).toHaveBeenCalledWith('room1', { type: 'Playing' });
  });

  test('非房主尝试非法操作应当被记录警告 (模拟)', () => {
    // 这里我们可以测试 handleMessage 中的权限检查逻辑
    // 假设我们模拟一个 SelectChart 消息但发送者不是房主
  });
});
