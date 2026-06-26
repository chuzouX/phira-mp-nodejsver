"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WebSocketServer_1 = require("./lib/WebSocketServer");
let instance;
const pluginModule = {
    name: 'websocket',
    init(api) {
        const httpServer = api.httpServer;
        if (!httpServer) {
            api.logger.warn('[websocket] HTTP 服务未启用，跳过 WebSocket 插件加载');
            return;
        }
        const pluginConfig = api.readPluginConfig() ?? {};
        instance = new WebSocketServer_1.PluginWebSocketServer(httpServer.getInternalServer(), api.roomManager, api.protocolHandler, {
            ...api.config,
            allowedOrigins: pluginConfig.allowedOrigins ?? api.config.allowedOrigins,
        }, api.logger, httpServer.getSessionParser(), api.federationManager);
        api.logger.info('[websocket] WebSocket 前置插件已加载');
    },
    async destroy() {
        instance?.close();
        instance = undefined;
    }
};
exports.default = pluginModule;
