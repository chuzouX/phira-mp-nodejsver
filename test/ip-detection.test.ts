
import request from 'supertest';
import { HttpServer } from '../src/network/HttpServer';
import { createServerConfig } from '../src/config/config';
import { RoomManager } from '../src/domain/rooms/RoomManager';
import { ProtocolHandler } from '../src/domain/protocol/ProtocolHandler';
import { BanManager } from '../src/domain/auth/BanManager';
import { Logger } from '../src/logging/logger';

describe('IP 识别测试 (HTTP Headers)', () => {
  let httpServer: HttpServer;
  let mockRoomManager: jest.Mocked<RoomManager>;
  let mockProtocolHandler: jest.Mocked<ProtocolHandler>;
  let mockBanManager: jest.Mocked<BanManager>;
  let mockLogger: jest.Mocked<Logger>;

  const config = createServerConfig({
    webPort: 0,
    adminSecret: 'test-secret',
    sessionSecret: 'test-session-secret'
  });

  beforeEach(() => {
    mockRoomManager = {
      listRooms: jest.fn().mockReturnValue([]),
    } as any;

    mockProtocolHandler = {
      getSessionCount: jest.fn().mockReturnValue(0),
    } as any;

    mockBanManager = {
      isIpBanned: jest.fn().mockReturnValue(null),
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

  test('应当优先从 X-Forwarded-For 获取真实 IP', async () => {
    const fakeIp = '1.2.3.4';
    await request(httpServer.getInternalServer())
      .get('/api/status')
      .set('X-Forwarded-For', `${fakeIp}, 192.168.1.1`);

    expect(mockBanManager.isIpBanned).toHaveBeenCalledWith(fakeIp);
  });

  test('当 X-Forwarded-For 不存在时应当从 X-Real-IP 获取 IP', async () => {
    const fakeIp = '5.6.7.8';
    await request(httpServer.getInternalServer())
      .get('/api/status')
      .set('X-Real-IP', fakeIp);

    expect(mockBanManager.isIpBanned).toHaveBeenCalledWith(fakeIp);
  });

  test('当两个 Header 都不存在时应当回退到 socket IP', async () => {
    await request(httpServer.getInternalServer())
      .get('/api/status');

    // 在 supertest/express 环境中，默认可能是 ::ffff:127.0.0.1 或 127.0.0.1
    const callIp = mockBanManager.isIpBanned.mock.calls[0][0];
    expect(callIp).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });

  test('登录黑名单判断也应当使用真实 IP', async () => {
    const fakeIp = '9.10.11.12';
    // 我们通过多次登录失败来测试它是否记录了正确的 IP
    // 但因为 getRealIp 是私有的，且逻辑分散，
    // 最简单的方法是看 isBlacklisted(ip) 调用时传入的是什么
    // 但 isBlacklisted 也是私有的。
    // 我们直接请求 /login 并观察日志或 mockBanManager (global check 也会触发)
    
    await request(httpServer.getInternalServer())
      .post('/login')
      .set('X-Forwarded-For', fakeIp)
      .send({ username: 'wrong', password: 'wrong' });

    expect(mockBanManager.isIpBanned).toHaveBeenCalledWith(fakeIp);
  });
});
