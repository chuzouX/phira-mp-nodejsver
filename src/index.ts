/*
 * MIT License
 * Copyright (c) 2024
 */

import { createApplication } from './app';

const main = async () => {
  try {
    const app = createApplication();

    await app.start();

    const shutdown = async (signal: string) => {
      app.logger.info(`Received ${signal} signal, shutting down...`);
      await app.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
};

main();
