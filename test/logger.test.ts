import * as fs from 'fs';
import { ConsoleLogger } from '../src/logging/logger';

jest.mock('fs');

describe('控制台日志 (ConsoleLogger)', () => {
  let logger: ConsoleLogger;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    
    // 模拟 fs.existsSync 返回 true，避免尝试创建日志目录
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    
    logger = new ConsoleLogger('test', 'debug');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
    // 清除全局定时器
    if ((global as any).logFloodInterval) {
      clearInterval((global as any).logFloodInterval);
      delete (global as any).logFloodInterval;
    }
  });

  test('应当能记录 info 级别消息', () => {
    logger.info('测试 Info 消息');
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[INFO] 测试 Info 消息'));
    expect(fs.appendFileSync).toHaveBeenCalledWith(expect.stringContaining('server-'), expect.stringContaining('[INFO] 测试 Info 消息\n'));
  });

  test('应当能根据日志级别过滤输出', () => {
    const infoLogger = new ConsoleLogger('test', 'info');
    infoLogger.debug('Debug 消息');
    expect(console.debug).not.toHaveBeenCalled();
    
    infoLogger.info('Info 消息');
    expect(console.info).toHaveBeenCalled();
  });

  test('应当能正确处理静默 ID (Silent IDs)', () => {
    logger.setSilentIds([123]);
    logger.info('来自静默用户的消息', { userId: 123 });
    expect(console.info).not.toHaveBeenCalled();

    logger.info('来自正常用户的消息', { userId: 456 });
    expect(console.info).toHaveBeenCalled();
  });

  test('应当在日志中包含元数据', () => {
    logger.info('带元数据的消息', { extra: 'data' });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('{"extra":"data"}'));
  });
});