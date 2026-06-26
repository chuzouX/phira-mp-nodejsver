import type { PluginApi, PluginModule } from 'phira-plugin-api';
import { PluginWebSocketServer } from './lib/WebSocketServer';

let instance: PluginWebSocketServer | undefined;

const pluginModule: PluginModule = {
  name: 'websocket',

  init(api: PluginApi) {
    const httpServer = api.httpServer;
    if (!httpServer) {
      api.logger.warn('[websocket] HTTP 服务未启用，跳过 WebSocket 插件加载');
      return;
    }

    const pluginConfig = api.readPluginConfig<{ allowedOrigins?: string[] }>() ?? {};

    instance = new PluginWebSocketServer(
      httpServer.getInternalServer(),
      api.roomManager,
      api.protocolHandler,
      {
        ...api.config,
        allowedOrigins: pluginConfig.allowedOrigins ?? api.config.allowedOrigins,
      },
      api.logger,
      httpServer.getSessionParser(),
      api.federationManager,
    );

    api.logger.info('[websocket] WebSocket 前置插件已加载');
  },

  async destroy() {
    instance?.close();
    instance = undefined;
  }
};

export default pluginModule;
