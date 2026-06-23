/*
 * MIT License
 * Copyright (c) 2024
 */

import { ConfigService, ServerConfig } from './config/config';
import { ConsoleLogger, Logger } from './logging/logger';
import { InMemoryRoomManager, RoomManager } from './domain/rooms/RoomManager';
import { PhiraAuthService } from './domain/auth/AuthService';
import { BanManager } from './domain/auth/BanManager';
import { ProtocolHandler } from './domain/protocol/ProtocolHandler';
import { NetworkServer } from './network/NetworkServer';
import { HttpServer } from './network/HttpServer';
import { version } from '../package.json';
import { FederationManager, FederationConfig } from './federation/FederationManager';
import { ConsoleInterface } from './network/ConsoleInterface';
import { PluginManager } from './plugins/manager';
import { PluginEventName } from './plugins/types';

export interface Application {
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly roomManager: RoomManager;
  readonly startTime: number;
  readonly pluginManager?: PluginManager;
  start(): Promise<void>;
  stop(): Promise<void>;
  reloadConfig(): void;
  updateConfig(key: string, value: string): void;
  setLogLevel(level: string): void;
  setLogLevels(levels: string[]): void;
  setAdminStatus(userId: number, isAdmin: boolean): Promise<string | null>;
  getTcpServer(): NetworkServer;
  getHttpServer(): HttpServer | undefined;
}

export const checkForUpdates = async (logger: Logger) => {
  try {
    const response = await fetch('https://api.github.com/repos/chuzouX/phira-mp-nodejsver/releases/latest', {
      headers: { 'User-Agent': 'PhiraServer-UpdateCheck' }
    });
    
    if (!response.ok) return;

    const data = await response.json() as any;
    const latestVersion = data.tag_name?.replace('v', '');

    if (latestVersion && latestVersion !== version) {
      logger.mark('='.repeat(50));
      logger.mark(`🔔 发现新版本: v${latestVersion} (当前版本: v${version})`);
      logger.mark(`🔗 下载地址: https://github.com/chuzouX/phira-mp-nodejsver/releases/latest`);
      logger.mark('='.repeat(50) + '\n');
    }
  } catch (error) {
    // Silently ignore update check errors
  }
};

export const createApplication = (overrides?: Partial<ServerConfig>): Application => {
  const startTime = Date.now();
  const configService = new ConfigService(overrides);
  const config = configService.getConfig();
  const logLevel = config.logging.level;

  const logger = new ConsoleLogger('程序', logLevel);
  const roomLogger = new ConsoleLogger('房间', logLevel);
  const authLogger = new ConsoleLogger('认证', logLevel);
  const protocolLogger = new ConsoleLogger('协议', logLevel);
  const webSocketLogger = new ConsoleLogger('WebSocket', logLevel);
  const federationLogger = new ConsoleLogger('联邦', logLevel);

  [logger, roomLogger, authLogger, protocolLogger, webSocketLogger, federationLogger].forEach(l => {
    l.setSilentIds(config.silentPhiraIds);
  });

  const webSocketServer = undefined;

  const broadcastRooms = () => {};

  const broadcastStats = () => {};

  const roomManager = new InMemoryRoomManager(roomLogger, config.roomSize, broadcastRooms);
  const authService = new PhiraAuthService(config.phiraApiUrl, authLogger, config.defaultAvatar);
  const banManager = new BanManager(authLogger);
  banManager.setWhitelists(config.banIdWhitelist, config.banIpWhitelist);
  const protocolHandler = new ProtocolHandler(
    roomManager, 
    authService, 
    protocolLogger, 
    config.serverName, 
    config.phiraApiUrl, 
    broadcastStats, 
    banManager,
    config.serverAnnouncement,
    config.defaultAvatar
  );
  
  // ========== 联邦节点管理 ==========
  let federationManager: FederationManager | undefined;
  
  if (config.federationEnabled) {
    const fedConfig: FederationConfig = {
      enabled: config.federationEnabled,
      seedNodes: config.federationSeedNodes,
      secret: config.federationSecret,
      nodeId: config.federationNodeId,
      nodeUrl: config.federationNodeUrl,
      healthInterval: config.federationHealthInterval,
      syncInterval: config.federationSyncInterval,
      serverName: config.serverName,
      allowLocal: config.federationAllowLocal,
    };

    federationManager = new FederationManager(fedConfig, federationLogger, roomManager);
    
    // 双向绑定：FederationManager <-> ProtocolHandler
    federationManager.setProtocolHandler(protocolHandler);
    protocolHandler.setFederationManager(federationManager);
    
    logger.info(`[联邦] 联邦节点已配置 (种子节点: ${config.federationSeedNodes.length} 个)`);
  }

  const networkServer = new NetworkServer(config, logger, protocolHandler);
  let httpServer: HttpServer | undefined;

  if (config.enableWebServer) {
    httpServer = new HttpServer(
      config,
      logger,
      roomManager,
      protocolHandler,
      banManager,
      federationManager,
    );
    logger.info('[程序] Web 功能将完全由插件系统承载。');
  } else {
    logger.info('Web server is disabled via configuration.');
  }

  const reloadConfig = (): void => {
    const newConfig = configService.reloadConfig();
    
    // Update BanManager
    banManager.setWhitelists(newConfig.banIdWhitelist, newConfig.banIpWhitelist);
    
    // Update ProtocolHandler
    protocolHandler.reloadConfig(
        newConfig.serverName,
        newConfig.phiraApiUrl,
        newConfig.serverAnnouncement,
        newConfig.defaultAvatar
    );

    // Update Logger silents
    [logger, roomLogger, authLogger, protocolLogger, webSocketLogger, federationLogger].forEach(l => {
        l.setSilentIds(newConfig.silentPhiraIds);
    });

    logger.mark('[程序] 配置已从 .env 重新加载');
  };

  const setAdminStatus = async (userId: number, isAdmin: boolean): Promise<string | null> => {
    const currentAdmins = [...config.adminPhiraId];
    if (isAdmin) {
        if (!currentAdmins.includes(userId)) {
            currentAdmins.push(userId);
        }
    } else {
        const index = currentAdmins.indexOf(userId);
        if (index > -1) {
            currentAdmins.splice(index, 1);
        }
    }

    // Persist to .env
    configService.updateAdminPhiraIds(currentAdmins);
    
    // Sync other components
    reloadConfig();

    // Fetch username for display
    try {
        const response = await fetch(`${config.phiraApiUrl}/user/${userId}`);
        if (response.ok) {
            const data = await response.json() as any;
            return data.name || '未知用户';
        }
    } catch (e) {
        // Silently ignore API errors
    }
    return '未知用户';
  };

  const updateConfig = (key: string, value: string): void => {
    configService.saveConfigToFile(key, value);
    reloadConfig();
  };

  const setLogLevel = (level: string): void => {
    const validLevels = ['debug', 'info', 'mark', 'warn', 'error'];
    const normalized = level.toLowerCase();
    if (validLevels.includes(normalized)) {
        [logger, roomLogger, authLogger, protocolLogger, webSocketLogger, federationLogger].forEach(l => {
            l.setLevel(normalized as any);
        });
        logger.mark(`[程序] 日志等级已设置为: ${normalized.toUpperCase()}`);
    }
  };

  const setLogLevels = (levels: string[]): void => {
    const validLevels = ['debug', 'info', 'mark', 'warn', 'error'];
    const filtered = levels.map(l => l.toLowerCase()).filter(l => validLevels.includes(l)) as any[];
    
    if (filtered.length === 0) return;

    if (filtered.length === 1) {
        setLogLevel(filtered[0]);
    } else {
        [logger, roomLogger, authLogger, protocolLogger, webSocketLogger, federationLogger].forEach(l => {
            l.setAllowedLevels(filtered);
        });
        logger.mark(`[程序] 日志等级已设置为显示: ${filtered.join(', ').toUpperCase()}`);
    }
  };

  const consoleInterface = new ConsoleInterface(
    config,
    logger,
    roomManager,
    protocolHandler,
    banManager,
    httpServer,
    reloadConfig,
    setAdminStatus,
    startTime,
    updateConfig,
    setLogLevels,
  );

  // ========== 插件系统初始化 ==========
  let pluginManager: PluginManager | undefined;

  if (config.pluginsEnabled) {
    pluginManager = new PluginManager({
      config,
      logger,
      roomManager,
      protocolHandler,
      networkServer,
      httpServer,
      webSocketServer,
      expressApp: httpServer?.getExpressApp(),
      banManager,
      federationManager,
    });
    protocolHandler.setPluginManager(pluginManager);
    logger.plugin('插件系统已启用，将自动加载 plugins 目录中的全部插件');
  }

  const start = async (): Promise<void> => {
    if (config.enableUpdateCheck) {
        void checkForUpdates(logger);
    }
    const promises: Promise<void>[] = [networkServer.start()];
    if (httpServer) {
        promises.push(httpServer.start());
    }
    await Promise.all(promises);

    // 启动联邦节点（在HTTP服务器启动后，因为需要接收联邦请求）
    if (federationManager) {
      await federationManager.start();
    }

    // 加载插件
    if (pluginManager) {
      await pluginManager.loadAllFromDirectory();
    }

    consoleInterface.start();
  };

  const stop = async (): Promise<void> => {
    consoleInterface.stop();

    // 销毁所有插件
    if (pluginManager) {
      await pluginManager.destroyAll();
    }

    // 先停止联邦（清理远程连接）
    if (federationManager) {
      await federationManager.stop();
    }

    const promises: Promise<void>[] = [networkServer.stop()];
    if (httpServer) {
        promises.push(httpServer.stop());
    }
    await Promise.all(promises);
  };

  return {
    config,
    logger,
    roomManager,
    startTime,
    pluginManager,
    start,
    stop,
    reloadConfig,
    setAdminStatus,
    updateConfig,
    setLogLevel,
    setLogLevels,
    getTcpServer: () => networkServer,
    getHttpServer: () => httpServer!,
  };
};
