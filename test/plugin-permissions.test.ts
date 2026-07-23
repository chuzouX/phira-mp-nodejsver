import { createServerConfig } from '../src/config/config';
import { PluginManager } from '../src/plugins/manager';
import type { PluginApi, PluginContext } from '../src/plugins/types';

describe('plugin role permissions', () => {
  test('treats Owner as Admin throughout the plugin API', () => {
    const config = createServerConfig({
      adminPhiraId: [100],
      ownerPhiraId: [200],
    });
    const context = {
      config,
      logger: { error: jest.fn() },
      protocolHandler: {
        getAllSessions: jest.fn().mockReturnValue([
          { id: 100, name: 'Admin', ip: '127.0.0.1' },
          { id: 200, name: 'Owner', ip: '127.0.0.2' },
        ]),
      },
      roomManager: {
        getRoomByUserId: jest.fn(),
      },
    } as unknown as PluginContext;
    const manager = new PluginManager(context);
    const api = (manager as any).createApi('permissions-test', process.cwd()) as PluginApi;

    expect(api.isUserAdmin(100)).toBe(true);
    expect(api.isUserOwner(100)).toBe(false);
    expect(api.isUserAdmin(200)).toBe(true);
    expect(api.isUserOwner(200)).toBe(true);
    expect(api.getOnlinePlayers()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 200, isAdmin: true, isOwner: true })]),
    );
    expect(api.getPlayer(200)).toEqual(
      expect.objectContaining({ id: 200, isAdmin: true, isOwner: true }),
    );
  });
});
