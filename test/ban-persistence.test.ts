
import * as fs from 'fs';
import { BanManager } from '../src/domain/auth/BanManager';
import { Logger } from '../src/logging/logger';
import path from 'path';

jest.mock('fs');

describe('封禁管理器持久化 (BanManager Persistence)', () => {
  let mockLogger: jest.Mocked<Logger>;
  const mockProcessCwd = jest.spyOn(process, 'cwd').mockReturnValue('/mock/cwd');

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      mark: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      ban: jest.fn(),
      setSilentIds: jest.fn(),
    } as any;
  });

  test('初始化时应当从文件加载现有的封禁数据', () => {
    const mockIdBans = {
      "100": { target: 100, reason: "Load Test", createdAt: 123, expiresAt: null }
    };
    const mockIpBans = {
      "127.0.0.1": { target: "127.0.0.1", reason: "IP Load Test", createdAt: 456, expiresAt: null }
    };

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('banidList.json')) return true;
      if (p.includes('banipList.json')) return true;
      return true; // data dir
    });

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('banidList.json')) return JSON.stringify(mockIdBans);
      if (p.includes('banipList.json')) return JSON.stringify(mockIpBans);
      return '';
    });

    const banManager = new BanManager(mockLogger);
    
    expect(banManager.isIdBanned(100)).toBeTruthy();
    expect(banManager.isIpBanned('127.0.0.1')).toBeTruthy();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('已加载 1 个用户封禁和 1 个 IP 封禁'));
  });

  test('封禁玩家时应当立即写入文件', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const banManager = new BanManager(mockLogger);
    
    banManager.banId(200, null, 'Save Test');
    
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('banidList.json'),
      expect.stringContaining('"target": 200')
    );
  });
});
