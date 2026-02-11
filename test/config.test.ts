
import { createServerConfig } from '../src/config/config';

describe('配置服务 (Config)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('应当能加载默认配置', () => {
    // 清除可能影响测试的环境变量
    delete process.env.PORT;
    delete process.env.SERVER_NAME;
    
    const config = createServerConfig();
    expect(config.port).toBe(12346);
    expect(config.serverName).toBe('Server');
  });

  test('应当能通过环境变量覆盖配置', () => {
    process.env.PORT = '9999';
    process.env.SERVER_NAME = 'MyCustomServer';
    process.env.ENABLE_WEB_SERVER = 'false';
    
    const config = createServerConfig();
    expect(config.port).toBe(9999);
    expect(config.serverName).toBe('MyCustomServer');
    expect(config.enableWebServer).toBe(false);
  });

  test('应当能正确解析数字列表 (SILENT_PHIRA_IDS)', () => {
    process.env.SILENT_PHIRA_IDS = '100, 200, 300';
    
    const config = createServerConfig();
    expect(config.silentPhiraIds).toEqual([100, 200, 300]);
  });

  test('应当能处理 Partial 覆盖', () => {
    const config = createServerConfig({ port: 1234 });
    expect(config.port).toBe(1234);
    // 其他值应保持默认或环境值
    expect(config.serverName).toBe(process.env.SERVER_NAME || 'Server');
  });
});
