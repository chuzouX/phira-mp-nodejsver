
import { PhiraAuthService } from '../src/domain/auth/AuthService';
import { Logger } from '../src/logging/logger';

describe('认证服务 (PhiraAuthService)', () => {
  let authService: PhiraAuthService;
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

    authService = new PhiraAuthService('https://api.test', mockLogger);
    
    // 模拟全局 fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('认证成功时应当返回用户信息', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 100,
        name: '测试用户',
        avatar: 'avatar_url'
      }),
    });

    const user = await authService.authenticate('valid_token');
    
    expect(user.id).toBe(100);
    expect(user.name).toBe('测试用户');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer valid_token'
        })
      })
    );
  });

  test('当用户无头像时应当使用默认头像', async () => {
    const customDefault = 'https://custom.default/avatar.png';
    const serviceWithDefault = new PhiraAuthService('https://api.test', mockLogger, customDefault);

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 200,
        name: '无头像用户'
        // 没有 avatar 字段
      }),
    });

    const user = await serviceWithDefault.authenticate('token');
    expect(user.avatar).toBe(customDefault);
  });

  test('认证失败时应当抛出错误 (401)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid token'
    });

    await expect(authService.authenticate('invalid_token')).rejects.toThrow('验证失败: 401 Unauthorized');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  test('网络请求异常时应当抛出错误', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));

    await expect(authService.authenticate('token')).rejects.toThrow('Network Error');
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
