
import { checkForUpdates } from '../src/app';
import { Logger } from '../src/logging/logger';
import { version } from '../package.json';

describe('更新检查器 (UpdateChecker)', () => {
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      mark: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('当有新版本时应当在控制台显示提示', async () => {
    const latestVersion = '9.9.9'; // 远大于当前版本
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tag_name: `v${latestVersion}`
      }),
    });

    await checkForUpdates(mockLogger);

    expect(mockLogger.mark).toHaveBeenCalledWith(expect.stringContaining(`发现新版本: v${latestVersion}`));
    expect(mockLogger.mark).toHaveBeenCalledWith(expect.stringContaining(`当前版本: v${version}`));
  });

  test('当版本一致时不应当显示提示', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tag_name: `v${version}`
      }),
    });

    await checkForUpdates(mockLogger);

    expect(mockLogger.mark).not.toHaveBeenCalled();
  });

  test('网络请求失败时应当静默忽略', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500
    });

    await checkForUpdates(mockLogger);

    expect(mockLogger.mark).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
