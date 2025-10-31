/*
 * MIT License
 * Copyright (c) 2024
 */

import { AddressInfo } from 'net';
import { createApplication } from '../app';

describe('Server bootstrap', () => {
  const originalPort = process.env.PORT;
  const originalHost = process.env.HOST;

  afterEach(() => {
    process.env.PORT = originalPort;
    process.env.HOST = originalHost;
  });

  it('starts and responds to health check', async () => {
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';

    const app = createApplication();

    await app.start();

    try {
      const serverInstance = app.getServer().getHttpServer();
      const address = serverInstance?.address() as AddressInfo | null;
      const port = address?.port ?? app.config.port;
      const host = address?.address ?? app.config.host;

      const response = await fetch(`http://${host}:${port}/health`);
      const data = (await response.json()) as { status: string };

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
    } finally {
      await app.stop();
    }
  });
});
