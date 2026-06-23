import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { Logger } from '../logging/logger';
import { PluginApi, PluginContext, PluginEventBus, PluginEventHandler, PluginEventName, PluginModule, LoadedPlugin, PacketHandlerRegistration, PluginRouteMethod } from './types';
import { ClientCommand, ServerCommand } from '../domain/protocol/Commands';

class SafePluginEventBus implements PluginEventBus {
  private readonly handlers = new Map<string, Set<PluginEventHandler>>();

  constructor(private readonly logger: Logger) {}

  on<T = any>(event: PluginEventName, handler: PluginEventHandler<T>): () => void {
    const key = String(event);
    const current = this.handlers.get(key) ?? new Set<PluginEventHandler>();
    current.add(handler as PluginEventHandler);
    this.handlers.set(key, current);
    return () => current.delete(handler as PluginEventHandler);
  }

  emit<T = any>(event: PluginEventName, payload: T): void {
    const handlers = Array.from(this.handlers.get(String(event)) ?? []);
    for (const handler of handlers) {
      try {
        const result = handler(payload);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch((error) => {
            this.logger.error(`[插件事件] ${String(event)} 执行失败: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      } catch (error) {
        this.logger.error(`[插件事件] ${String(event)} 执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async emitAsync<T = any>(event: PluginEventName, payload: T): Promise<void> {
    const handlers = Array.from(this.handlers.get(String(event)) ?? []);
    for (const handler of handlers) {
      try {
        await handler(payload);
      } catch (error) {
        this.logger.error(`[插件事件] ${String(event)} 异步执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export class PluginManager {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly packetHandlers = new Map<number, Array<PacketHandlerRegistration & { pluginName: string }>>();
  private readonly eventsBus: SafePluginEventBus;
  private readonly commandHandlers = new Map<string, (...args: string[]) => void | Promise<void>>();

  constructor(private readonly context: PluginContext) {
    this.eventsBus = new SafePluginEventBus(context.logger);
  }

  public get events(): PluginEventBus {
    return this.eventsBus;
  }

  public async loadAllFromDirectory(): Promise<void> {
    const pluginsDir = path.join(process.cwd(), 'plugins');
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      this.context.logger.info(`[插件] 已自动创建插件目录: ${pluginsDir}`);
      return;
    }

    const pluginNames = fs.readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const pluginName of pluginNames) {
      await this.loadPlugin(pluginName);
    }
  }

  public async loadPlugin(pluginName: string): Promise<void> {
    if (this.plugins.has(pluginName)) {
      return;
    }

    const pluginDir = path.join(process.cwd(), 'plugins', pluginName);
    const metadataPath = path.join(pluginDir, 'plugin.yaml');

    // 检查是否存在 plugin.yaml
    if (!fs.existsSync(metadataPath)) {
      this.context.logger.warn(`[插件] 插件 ${pluginName} 缺少 plugin.yaml 元数据文件`);
      return;
    }

    try {
      // 读取插件元数据
      const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
      const metadata = yaml.load(metadataRaw) as any;

      if (!metadata || typeof metadata !== 'object') {
        throw new Error('plugin.yaml 格式无效');
      }

      // 验证必需字段
      if (!metadata.id || !metadata.name || !metadata.version) {
        throw new Error('plugin.yaml 缺少必需字段 (id, name, version)');
      }

      // 确定主文件路径
      const mainFile = metadata.main || 'main.js';
      const resDir = path.join(pluginDir, 'res');
      const modulePath = path.join(resDir, mainFile);
      const sourcePath = path.join(resDir, mainFile.replace(/\.js$/, '.ts'));
      const resolvedPath = fs.existsSync(modulePath) ? modulePath : sourcePath;

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`找不到插件主文件: res/${mainFile}`);
      }

      // require() 走 ts-node 的 hook，能正确编译 .ts 文件；
      // await import() 不经过 CJS require hook，会导致 "Cannot use import statement" 错误
      const imported = require(resolvedPath);
      const pluginModule = (imported.default ?? imported) as PluginModule;
      if (!pluginModule || typeof pluginModule.init !== 'function') {
        throw new Error('插件未导出 init(api)');
      }

      const api = this.createApi(pluginName, resDir);
      await pluginModule.init(api);
      this.plugins.set(pluginName, {
        name: metadata.name,
        metadata: metadata as any,
        modulePath: resolvedPath,
        module: pluginModule,
      });
      this.context.logger.info(`[插件] 已加载 ${metadata.name} v${metadata.version}`);
    } catch (error) {
      this.context.logger.error(`[插件] 加载 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async destroyAll(): Promise<void> {
    for (const [pluginName, plugin] of this.plugins.entries()) {
      try {
        await plugin.module.destroy?.();
      } catch (error) {
        this.context.logger.error(`[插件] 销毁 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.plugins.clear();
  }

  public async emitAsync<T = any>(event: PluginEventName, payload: T): Promise<void> {
    await this.eventsBus.emitAsync(event, payload);
  }

  public emit<T = any>(event: PluginEventName, payload: T): void {
    this.eventsBus.emit(event, payload);
  }

  public async handlePacket(connectionId: string, command: ClientCommand): Promise<void> {
    const handlers = this.packetHandlers.get(command.type) ?? [];
    for (const registration of handlers) {
      try {
        await registration.handler({ connectionId, command });
      } catch (error) {
        this.context.logger.error(`[插件] 数据包处理失败 ${registration.pluginName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  public async executeCommand(name: string, args: string[]): Promise<boolean> {
    const handler = this.commandHandlers.get(name.toLowerCase());
    if (!handler) {
      return false;
    }

    try {
      await handler(...args);
    } catch (error) {
      this.context.logger.error(`[插件命令] ${name} 执行失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  }

  private createApi(pluginName: string, resDir: string): PluginApi {
    const pluginConfigDir = path.join(process.cwd(), 'config', pluginName);
    const pluginConfigPath = path.join(pluginConfigDir, 'config.yaml');

    return {
      ...this.context,
      pluginName,
      events: this.eventsBus,
      registerRoute: (method: PluginRouteMethod, routePath: string, handler: express.RequestHandler) => {
        const app = this.context.expressApp ?? this.context.httpServer?.getExpressApp();
        if (!app) {
          this.context.logger.warn(`[插件] ${pluginName} 注册路由失败，HTTP 服务未启用: ${method.toUpperCase()} ${routePath}`);
          return;
        }
        const expressMethod = method.toLowerCase() as PluginRouteMethod;
        (app[expressMethod] as any).call(app, routePath, handler);
        this.context.logger.info(`[插件] ${pluginName} 注册路由 ${method.toUpperCase()} ${routePath}`);
      },
      serveStatic: (mountPath: string, rootDir: string) => {
        const app = this.context.expressApp ?? this.context.httpServer?.getExpressApp();
        if (!app) {
          this.context.logger.warn(`[插件] ${pluginName} 挂载静态目录失败，HTTP 服务未启用: ${mountPath}`);
          return;
        }
        // 如果 rootDir 是相对路径，相对于插件的 res 目录解析
        const resolvedDir = path.isAbsolute(rootDir) ? rootDir : path.join(resDir, rootDir);
        app.use(mountPath, express.static(resolvedDir));
        this.context.logger.info(`[插件] ${pluginName} 挂载静态目录 ${mountPath} -> ${resolvedDir}`);
      },
      getExpressApp: () => this.context.expressApp ?? this.context.httpServer?.getExpressApp(),
      getPluginConfigDir: () => pluginConfigDir,
      readPluginConfig: <T = any>() => {
        if (!fs.existsSync(pluginConfigPath)) {
          return undefined;
        }
        const raw = fs.readFileSync(pluginConfigPath, 'utf8');
        return yaml.load(raw) as T | undefined;
      },
      writePluginConfig: (config: unknown) => {
        fs.mkdirSync(pluginConfigDir, { recursive: true });
        fs.writeFileSync(pluginConfigPath, yaml.dump(config), 'utf8');
      },
      broadcastWs: (event: string, data: any) => {
        this.context.webSocketServer?.broadcast(event, data);
      },
      registerCommand: (name: string, handler: (...args: string[]) => void | Promise<void>) => {
        this.commandHandlers.set(name.toLowerCase(), handler);
      },
      registerPacketHandler: (registration: PacketHandlerRegistration) => {
        const list = this.packetHandlers.get(registration.commandType) ?? [];
        list.push({ ...registration, pluginName });
        this.packetHandlers.set(registration.commandType, list);
      },
      broadcastToRoom: (roomId: string, command: ServerCommand) => this.context.protocolHandler.broadcastToRoomById(roomId, command),
    };
  }
}
