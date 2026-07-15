import * as fs from 'fs';
import { ConsoleLogger } from '../src/logging/logger';

jest.mock('fs');

describe('日志洪泛保护 (Logger Flood Protection)', () => {
  let logger: ConsoleLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    
    // 模拟 fs.existsSync 返回 true
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    
    // 由于 THRESHOLD 是静态的，我们需要确保它在测试间重置
    logger = new ConsoleLogger('test', 'info');
    ConsoleLogger.setReadline(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if ((global as any).logFloodInterval) {
      clearInterval((global as any).logFloodInterval);
      delete (global as any).logFloodInterval;
    }
  });

  test('当日志速率超过阈值时应当触发抑制', () => {
    const floodThreshold = 50;
    for (let i = 0; i < floodThreshold + 5; i++) {
      logger.info(`Message ${i}`);
    }

    // 阈值内的消息正常输出，首条超限消息替换为抑制警告。
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[WARNING] 遭受到大量的连接/错误'));

    const logCalls = (console.log as jest.Mock).mock.calls.length;
    expect(logCalls).toBe(floodThreshold + 1);
  });
});
