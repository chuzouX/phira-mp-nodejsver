
import { ProtocolHandler } from '../src/domain/protocol/ProtocolHandler';
import { InMemoryRoomManager } from '../src/domain/rooms/RoomManager';
import { PhiraAuthService } from '../src/domain/auth/AuthService';
import { Logger } from '../src/logging/logger';
import { ClientCommandType, ServerCommandType } from '../src/domain/protocol/Commands';

describe('核心流程集成测试 (Core Flow Integration)', () => {
  let handler: ProtocolHandler;
  let roomManager: InMemoryRoomManager;
  let authService: PhiraAuthService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      mark: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    roomManager = new InMemoryRoomManager(mockLogger, 8);
    authService = new PhiraAuthService('https://api.test', mockLogger);
    handler = new ProtocolHandler(
      roomManager,
      authService,
      mockLogger,
      'TestServer',
      'https://api.test'
    );

    // 模拟认证成功
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 100, name: 'Alice' })
    });
  });

  test('玩家认证 -> 创建房间 -> 发送聊天', async () => {
    const connId = 'alice-conn';
    const responses: any[] = [];
    const sendResponse = (cmd: any) => responses.push(cmd);

    handler.handleConnection(connId, jest.fn(), '127.0.0.1');

    // 1. 认证
    await new Promise<void>((resolve) => {
      handler.handleMessage(connId, { type: ClientCommandType.Authenticate, token: '12345678901234567890' }, (resp) => {
        sendResponse(resp);
        if (resp.type === ServerCommandType.Authenticate) resolve();
      });
    });

    expect(responses.some(r => r.type === ServerCommandType.Authenticate && r.result.ok)).toBe(true);

    // 2. 创建房间
    handler.handleMessage(connId, { type: ClientCommandType.CreateRoom, id: 'room-alice' }, sendResponse);
    expect(roomManager.getRoom('room-alice')).toBeDefined();

    // 3. 发送聊天
    handler.handleMessage(connId, { type: ClientCommandType.Chat, message: 'Hello!' }, sendResponse);
    
    const room = roomManager.getRoom('room-alice');
    expect(room?.messages.some(m => m.type === 'Chat' && m.content === 'Hello!')).toBe(true);
  });
});
