/*
 * MIT License
 * Copyright (c) 2024
 */

// Suppress experimental fetch warning
const originalEmit = process.emit;
// @ts-ignore
process.emit = function (name, data) {
  if (
    name === 'warning' &&
    data &&
    typeof data === 'object' &&
    (data as any).name === 'ExperimentalWarning' &&
    (data as any).message?.includes('Fetch API')
  ) {
    return false;
  }
  // @ts-ignore
  return originalEmit.apply(process, arguments);
};

import { createApplication } from './app';

const main = async () => {
  try {
    const app = createApplication();

    await app.start();

    const shutdown = async (signal: string) => {
      app.logger.info(`收到 ${signal} 信号, 正在关闭服务器...`);
      await app.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Global Error Handling to prevent process crash
    process.on('uncaughtException', (error) => {
      console.error('致命错误: 未捕获的异常:', error);
      // In a real production app, you might want to shutdown gracefully here
    });

    process.on('unhandledRejection', (reason, _promise) => {
      console.error('异步错误: 未处理的 Promise 拒绝:', reason);
    });
  } catch (error) {
    console.error('启动程序失败:', error);
    process.exit(1);
  }
};

main();
