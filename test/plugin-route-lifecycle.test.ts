import express from 'express';
import request from 'supertest';
import { PluginManager } from '../src/plugins/manager';

describe('plugin Express route lifecycle', () => {
  it('stores command redaction metadata for sensitive plugin commands', () => {
    const manager = new PluginManager({ logger: {} } as any);
    manager.registerCommand('login-token', jest.fn(), { redactInput: true });
    manager.registerCommand('greet', jest.fn());

    expect(manager.shouldRedactCommandInput('login-token')).toBe(true);
    expect(manager.shouldRedactCommandInput('LOGIN-TOKEN')).toBe(true);
    expect(manager.shouldRedactCommandInput('greet')).toBe(false);
  });

  it('removes layers owned by a plugin', async () => {
    const app = express();
    const context: any = {
      expressApp: app,
      logger: { plugin: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    };
    const manager = new PluginManager(context);
    const before = manager.snapshotExpressLayers();
    app.get('/owned-by-test', (_req, res) => res.send('owned'));

    expect(manager.trackExpressLayers('test-plugin', before)).toBe(1);
    await request(app).get('/owned-by-test').expect(200, 'owned');
    expect(manager.removePluginRoutes('test-plugin')).toBe(1);
    await request(app).get('/owned-by-test').expect(404);
  });
});
