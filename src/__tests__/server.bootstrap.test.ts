/*
 * MIT License
 * Copyright (c) 2024
 */

import { AddressInfo, createConnection } from 'net';
import { createApplication } from '../app';

describe('Server bootstrap', () => {
  const originalPort = process.env.PORT;
  const originalHost = process.env.HOST;

  afterEach(() => {
    process.env.PORT = originalPort;
    process.env.HOST = originalHost;
  });

  it('starts and accepts TCP connections', async () => {
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';

    const app = createApplication();

    await app.start();

    try {
      const serverInstance = app.getServer().getTcpServer();
      const address = serverInstance?.address() as AddressInfo | null;
      const port = address?.port ?? app.config.port;
      const host = address?.address ?? app.config.host;

      // Test TCP connection
      const client = createConnection({ port, host });

      const connectionEstablished = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          client.destroy();
          resolve(false);
        }, 1000);

        client.once('connect', () => {
          clearTimeout(timeout);
          client.end();
          resolve(true);
        });

        client.once('error', () => {
          clearTimeout(timeout);
          client.destroy();
          resolve(false);
        });
      });

      expect(connectionEstablished).toBe(true);

      if (client.destroyed) {
        // connection already closed
      } else {
        await new Promise<void>((resolve) => {
          client.once('close', resolve);
        });
      }
    } finally {
      await app.stop();
    }
  });
});
