
import * as fs from 'fs';
import { ConsoleLogger } from '../src/logging/logger';

jest.mock('fs');

describe('日志洪泛保护 (Logger Flood Protection)', () => {
  let logger: ConsoleLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    // 模拟 fs.existsSync 返回 true
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    
    // 由于 THRESHOLD 是静态的，我们需要确保它在测试间重置
    // 但因为它是私有的，我们通过快速发送消息来测试
    logger = new ConsoleLogger('test', 'info');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if ((global as any).logFloodInterval) {
      clearInterval((global as any).logFloodInterval);
      delete (global as any).logFloodInterval;
    }
  });

  test('当日志速率超过阈值时应当触发抑制', () => {
    // 阈值是 30
    for (let i = 0; i < 35; i++) {
      logger.info(`Message ${i}`);
    }

    // 前 30 条消息应当正常输出 (或直到抑制触发)
    // 超过 30 条后应当输出警告
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[WARNING] 遭受到大量的连接/错误'));
    
    // 第 31 条之后的普通日志不应再输出
    const infoCalls = (console.info as jest.Mock).mock.calls.length;
    expect(infoCalls).toBeLessThanOrEqual(30);
  });
});
