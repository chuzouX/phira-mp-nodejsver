
import request from 'supertest';
import { HttpServer } from '../src/network/HttpServer';
import { createServerConfig } from '../src/config/config';
import { RoomManager } from '../src/domain/rooms/RoomManager';
import { ProtocolHandler } from '../src/domain/protocol/ProtocolHandler';
import { BanManager } from '../src/domain/auth/BanManager';
import { Logger } from '../src/logging/logger';
import crypto from 'crypto';

describe('HTTP API 测试 (HttpServer)', () => {
  let httpServer: HttpServer;
  let mockRoomManager: jest.Mocked<RoomManager>;
  let mockProtocolHandler: jest.Mocked<ProtocolHandler>;
  let mockBanManager: jest.Mocked<BanManager>;
  let mockLogger: jest.Mocked<Logger>;

  const config = createServerConfig({
    webPort: 0, // 自动端口
    adminSecret: 'test-secret',
    sessionSecret: 'test-session-secret'
  });

  beforeEach(() => {
    mockRoomManager = {
      listRooms: jest.fn().mockReturnValue([]),
      getRoom: jest.fn(),
      setGlobalLocked: jest.fn(),
    } as any;

    mockProtocolHandler = {
      getSessionCount: jest.fn().mockReturnValue(0),
      getAllSessions: jest.fn().mockReturnValue([]),
      sendServerMessage: jest.fn(),
    } as any;

    mockBanManager = {
      isIpBanned: jest.fn().mockReturnValue(null),
      getAllBans: jest.fn().mockReturnValue({ idBans: [], ipBans: [] }),
    } as any;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    httpServer = new HttpServer(
      config,
      mockLogger,
      mockRoomManager,
      mockProtocolHandler,
      mockBanManager
    );
  });

  afterEach(async () => {
    await httpServer.stop();
  });

  test('GET /api/status 应当公开访问', async () => {
    mockRoomManager.listRooms.mockReturnValue([
      {
        id: 'room1',
        name: 'Room 1',
        players: new Map(),
        maxPlayers: 8,
        state: { type: 'SelectChart', chartId: 1 },
        selectedChart: { name: 'Test Chart' },
        locked: false,
        cycle: false
      } as any
    ]);

    const response = await request(httpServer.getInternalServer()).get('/api/status');
    expect(response.status).toBe(200);
    expect(response.body.serverName).toBeDefined(); // 不再硬编码，因为可能受环境影响
    expect(response.body.rooms).toHaveLength(1);
    expect(response.body.rooms[0].name).toBe('Room 1');
    expect(response.body.rooms[0].state.chartName).toBe('Test Chart');
  });

  test('HTML 页面应当注入正确的配置变量', async () => {
    // 覆盖默认配置以进行测试
    const customConfig = createServerConfig({
        displayIp: 'custom.ip:12345',
        defaultAvatar: 'https://custom.avatar/url.png'
    });
    
    const testServer = new HttpServer(
        customConfig,
        mockLogger,
        mockRoomManager,
        mockProtocolHandler,
        mockBanManager
    );

    const pages = ['/', '/room', '/players', '/admin'];
    
    for (const page of pages) {
        const response = await request(testServer.getInternalServer()).get(page);
        expect(response.status).toBe(200);
        expect(response.text).toContain('window.SERVER_CONFIG = {');
        // 使用正则忽略空格，并处理属性名可能有也可能没有引号的情况
        expect(response.text).toMatch(/"?displayIp"?:\s*"custom\.ip:12345"/);
        expect(response.text).toMatch(/"?defaultAvatar"?:\s*"https:\/\/custom\.avatar\/url\.png"/);
    }

    await testServer.stop();
  });

  test('管理接口在未授权时应当返回 403', async () => {
    const response = await request(httpServer.getInternalServer()).get('/api/all-players');
    expect(response.status).toBe(403);
  });

  test('应当能通过 Admin Secret 访问管理接口', async () => {
    // 生成合法的 Admin Secret Token
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const plainText = `${dateStr}_test-secret_xy521`;
    
    const key = crypto.createHash('sha256').update('test-secret').digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const token = iv.toString('hex') + encrypted;

    const response = await request(httpServer.getInternalServer())
      .get('/api/all-players')
      .set('X-Admin-Secret', token);

    expect(response.status).toBe(200);
    expect(mockProtocolHandler.getAllSessions).toHaveBeenCalled();
  });
});
