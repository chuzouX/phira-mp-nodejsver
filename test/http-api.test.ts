import request from 'supertest';
import { HttpServer } from '../src/network/HttpServer';
import { createServerConfig } from '../src/config/config';
import { RoomManager } from '../src/domain/rooms/RoomManager';
import { ProtocolHandler } from '../src/domain/protocol/ProtocolHandler';
import { BanManager } from '../src/domain/auth/BanManager';
import { Logger } from '../src/logging/logger';

describe('HTTP API 测试 (HttpServer)', () => {
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

  test('GET /api/version 应当公开访问', async () => {
    const response = await request(httpServer.getInternalServer()).get('/api/version');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('version');
  });

  test('GET /check-auth 未加载仪表盘插件时应当不可用', async () => {
    const response = await request(httpServer.getInternalServer()).get('/check-auth');
    expect(response.status).toBe(404);
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
    mockProtocolHandler.getSessionCount.mockReturnValue(1);

    const response = await request(httpServer.getInternalServer()).get('/api/status');
    expect(response.status).toBe(200);
    expect(response.body.serverName).toBeDefined();
    expect(response.body.onlinePlayers).toBe(1);
    expect(response.body.roomCount).toBe(1);
    expect(response.body.rooms).toHaveLength(1);
    expect(response.body.rooms[0].name).toBe('Room 1');
    expect(response.body.rooms[0].state.chartName).toBe('Test Chart');
    expect(response.body.federation).toBeDefined();
  });

  test('/api/status 应当缓存结果', async () => {
    mockRoomManager.listRooms.mockReturnValue([]);
    mockProtocolHandler.getSessionCount.mockReturnValue(0);

    const response1 = await request(httpServer.getInternalServer()).get('/api/status');
    const response2 = await request(httpServer.getInternalServer()).get('/api/status');

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response1.body).toEqual(response2.body);
  });
});
