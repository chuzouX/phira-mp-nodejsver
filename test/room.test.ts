import { InMemoryRoomManager } from '../src/domain/rooms/RoomManager';
import { Logger } from '../src/logging/logger';

describe('内存房间管理器 (InMemoryRoomManager)', () => {
  let roomManager: InMemoryRoomManager;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      mark: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      setSilentIds: jest.fn(),
    } as any;

    roomManager = new InMemoryRoomManager(mockLogger, 8);
  });

  test('应当能创建房间', () => {
    const options = {
      id: 'test-room',
      name: '测试房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    };

    const room = roomManager.createRoom(options);
    expect(room.id).toBe('test-room');
    expect(room.ownerId).toBe(1);
    expect(room.players.size).toBe(1);
    expect(roomManager.count()).toBe(1);
  });

  test('应当能添加和移除玩家', () => {
    roomManager.createRoom({
      id: 'test-room',
      name: '测试房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    });

    const success = roomManager.addPlayerToRoom(
      'test-room',
      2,
      { id: 2, name: '玩家 2', monitor: false },
      'conn-2'
    );

    expect(success).toBe(true);
    const room = roomManager.getRoom('test-room');
    expect(room?.players.size).toBe(2);

    roomManager.removePlayerFromRoom('test-room', 2);
    expect(room?.players.size).toBe(1);
  });

  test('当最后一名玩家离开时应当删除房间', () => {
    roomManager.createRoom({
      id: 'test-room',
      name: '测试房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    });

    roomManager.removePlayerFromRoom('test-room', 1);
    expect(roomManager.count()).toBe(0);
    expect(roomManager.getRoom('test-room')).toBeUndefined();
  });

  test('当房主离开时应当自动移交房主', () => {
    roomManager.createRoom({
      id: 'test-room',
      name: '测试房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    });

    roomManager.addPlayerToRoom(
      'test-room',
      2,
      { id: 2, name: '玩家 2', monitor: false },
      'conn-2'
    );

    roomManager.removePlayerFromRoom('test-room', 1);
    const room = roomManager.getRoom('test-room');
    expect(room?.ownerId).toBe(2);
  });

  test('应当尊重最大人数限制', () => {
    roomManager = new InMemoryRoomManager(mockLogger, 1);
    roomManager.createRoom({
      id: 'full-room',
      name: '满人房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    });

    const success = roomManager.addPlayerToRoom(
      'full-room',
      2,
      { id: 2, name: '玩家 2', monitor: false },
      'conn-2'
    );

    expect(success).toBe(false);
  });

  test('应当能正确处理黑名单', () => {
    roomManager.createRoom({
      id: 'room',
      name: '房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    });

    roomManager.setRoomBlacklist('room', [2]);
    const success = roomManager.addPlayerToRoom(
      'room',
      2,
      { id: 2, name: '被封禁用户', monitor: false },
      'conn-2'
    );

    expect(success).toBe(false);
  });

  test('应当能正确处理白名单 (只有名单内用户可进)', () => {
    roomManager.createRoom({
      id: 'whitelist-room',
      name: '白名单房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    });

    roomManager.setRoomWhitelist('whitelist-room', [1, 3]);

    // 不在白名单的玩家
    const fail = roomManager.addPlayerToRoom(
      'whitelist-room',
      2,
      { id: 2, name: '不在名单', monitor: false },
      'conn-2'
    );
    expect(fail).toBe(false);

    // 在白名单的玩家
    const success = roomManager.addPlayerToRoom(
      'whitelist-room',
      3,
      { id: 3, name: '在名单内', monitor: false },
      'conn-3'
    );
    expect(success).toBe(true);
  });

  test('黑名单优先级测试 (黑白名单冲突时以黑名单为准)', () => {
    roomManager.createRoom({
      id: 'conflict-room',
      name: '冲突房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    });

    // 用户 2 既在白名单也在黑名单
    roomManager.setRoomWhitelist('conflict-room', [1, 2]);
    roomManager.setRoomBlacklist('conflict-room', [2]);

    const success = roomManager.addPlayerToRoom(
      'conflict-room',
      2,
      { id: 2, name: '双重身份', monitor: false },
      'conn-2'
    );

    // 应当因为黑名单被拒绝
    expect(success).toBe(false);
  });

  test('应当能正确切换房间锁定状态', () => {
    roomManager.createRoom({
      id: 'lock-room',
      name: '锁定房间',
      ownerId: 1,
      ownerInfo: { id: 1, name: '房主', monitor: false },
      connectionId: 'conn-1',
    });

    roomManager.setRoomLocked('lock-room', true);
    const success = roomManager.addPlayerToRoom(
      'lock-room',
      2,
      { id: 2, name: '试图进入', monitor: false },
      'conn-2'
    );
    expect(success).toBe(false);

    roomManager.setRoomLocked('lock-room', false);
    const success2 = roomManager.addPlayerToRoom(
      'lock-room',
      2,
      { id: 2, name: '再次进入', monitor: false },
      'conn-2'
    );
    expect(success2).toBe(true);
  });
});