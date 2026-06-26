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

  const config = createServerConfig({ webPort: 0 });

  beforeEach(() => {
    mockRoomManager = {
      listRooms: jest.fn().mockReturnValue([]),
    } as any;

    mockProtocolHandler = {
      getSessionCount: jest.fn().mockReturnValue(0),
    } as any;

    mockBanManager = {} as any;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    httpServer = new HttpServer(config, mockLogger, mockRoomManager, mockProtocolHandler, mockBanManager);
  });

  afterEach(async () => {
    await httpServer.stop();
  });

  test('X-Forwarded-For 不应影响公开状态接口可访问性', async () => {
    const response = await request(httpServer.getInternalServer())
      .get('/api/status')
      .set('X-Forwarded-For', '1.2.3.4, 111.111.111.111');

    expect(response.status).toBe(200);
  });

  test('X-Real-IP 不应影响公开状态接口可访问性', async () => {
    const response = await request(httpServer.getInternalServer())
      .get('/api/status')
      .set('X-Real-IP', '9.9.9.9');

    expect(response.status).toBe(200);
  });

  test('未提供任何代理头时也应可访问公开状态接口', async () => {
    const response = await request(httpServer.getInternalServer())
      .get('/api/status');

    expect(response.status).toBe(200);
  });
});
