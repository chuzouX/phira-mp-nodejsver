import * as fs from 'fs';
import { BanManager } from '../src/domain/auth/BanManager';
import { Logger } from '../src/logging/logger';

jest.mock('fs');

describe('封禁管理器 (BanManager)', () => {
  let banManager: BanManager;
  let mockLogger: jest.Mocked<Logger>;

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

    (fs.existsSync as jest.Mock).mockReturnValue(false);
    banManager = new BanManager(mockLogger);
  });

  test('应当能封禁和解封用户 ID', () => {
    banManager.banId(123, 3600, '测试原因');
    expect(banManager.isIdBanned(123)).toBeTruthy();
    expect(banManager.isIdBanned(123)?.reason).toBe('测试原因');

    banManager.unbanId(123);
    expect(banManager.isIdBanned(123)).toBeNull();
  });

  test('应当能封禁和解封 IP', () => {
    banManager.banIp('1.2.3.4', null, '永久封禁');
    expect(banManager.isIpBanned('1.2.3.4')).toBeTruthy();
    expect(banManager.isIpBanned('1.2.3.4')?.expiresAt).toBeNull();

    banManager.unbanIp('1.2.3.4');
    expect(banManager.isIpBanned('1.2.3.4')).toBeNull();
  });

  test('IPv4-mapped IPv6 aliases share bans, whitelists and unban operations', () => {
    banManager.banIp('::ffff:192.0.2.1', null, 'mapped');
    expect(banManager.isIpBanned('192.0.2.1')).toBeTruthy();
    expect(banManager.isIpBanned('::FFFF:c000:0201')).toBeTruthy();
    banManager.unbanIp('192.0.2.1');
    expect(banManager.isIpBanned('::ffff:192.0.2.1')).toBeNull();
    banManager.setWhitelists([], ['::ffff:192.0.2.1']);
    banManager.banIp('192.0.2.1', null, 'must be blocked');
    expect(banManager.isIpBanned('192.0.2.1')).toBeNull();
  });

  test('legacy alias collisions preserve the strongest ban', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation((file: string) =>
      file.includes('banipList.json')
        ? JSON.stringify({
            '::ffff:192.0.2.1': {
              target: '::ffff:192.0.2.1',
              reason: 'permanent',
              createdAt: 1,
              expiresAt: null,
            },
            '192.0.2.1': { target: '192.0.2.1', reason: 'expired', createdAt: 1, expiresAt: 1 },
          })
        : '{}',
    );
    const loaded = new BanManager(mockLogger);
    expect(loaded.isIpBanned('192.0.2.1')?.reason).toBe('permanent');
  });

  test('封禁过期后应当自动失效', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    // 封禁 10 秒
    banManager.banId(456, 10, '短时封禁');
    expect(banManager.isIdBanned(456)).toBeTruthy();

    // 推进 11 秒
    jest.setSystemTime(now + 11000);
    expect(banManager.isIdBanned(456)).toBeNull();

    jest.useRealTimers();
  });

  test('应当能持久化保存封禁数据 (调用 writeFileSync)', () => {
    banManager.banId(789, null, '持久化测试');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
});
