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
  private readonly pluginsByUuid = new Map<string, LoadedPlugin>(); // UUID 索引
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
      this.context.logger.plugin(`已自动创建插件目录: ${pluginsDir}`);
      return;
    }

    this.context.logger.plugin('开始加载插件...');

    const pluginNames = fs.readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    if (pluginNames.length === 0) {
      this.context.logger.plugin('未发现任何插件');
      return;
    }

    this.context.logger.plugin(`发现 ${pluginNames.length} 个插件: ${pluginNames.join(', ')}`);

    // 第一遍：读取所有插件元数据，检查依赖
    const pluginMetadata = new Map<string, { name: string; metadata: any; hasMissingDeps: boolean; missingDeps: string[] }>();

    for (const pluginName of pluginNames) {
      const pluginDir = path.join(process.cwd(), 'plugins', pluginName);
      const metadataPath = path.join(pluginDir, 'plugin.yaml');

      if (!fs.existsSync(metadataPath)) {
        this.context.logger.plugin(`${pluginName} 缺少 plugin.yaml 元数据文件，跳过加载`);
        continue;
      }

      try {
        const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
        const metadata = yaml.load(metadataRaw) as any;

        if (!metadata || typeof metadata !== 'object') {
          this.context.logger.plugin(`${pluginName} 的 plugin.yaml 格式无效，跳过加载`);
          continue;
        }

        // 验证必需字段
        if (!metadata.id || !metadata.name || !metadata.version) {
          this.context.logger.plugin(`${pluginName} 缺少必需字段 (id, name, version)，跳过加载`);
          continue;
        }

        // 验证 UUID
        if (!metadata.uuid) {
          this.context.logger.plugin(`${pluginName} 缺少 uuid 字段，跳过加载`);
          continue;
        }

        pluginMetadata.set(pluginName, { name: pluginName, metadata, hasMissingDeps: false, missingDeps: [] });
      } catch (error) {
        this.context.logger.plugin(`读取 ${pluginName} 元数据失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 第二遍：检查依赖关系
    for (const [pluginName, info] of pluginMetadata.entries()) {
      const { metadata } = info;

      if (metadata.dependencies && Array.isArray(metadata.dependencies) && metadata.dependencies.length > 0) {
        const missingDeps: string[] = [];

        for (const depUuid of metadata.dependencies) {
          // 查找依赖的插件
          const depPlugin = Array.from(pluginMetadata.values()).find(p => p.metadata.uuid === depUuid);

          if (!depPlugin) {
            missingDeps.push(depUuid);
          }
        }

        if (missingDeps.length > 0) {
          info.hasMissingDeps = true;
          info.missingDeps = missingDeps;

          this.context.logger.plugin(
            `${metadata.name} (${metadata.uuid}) 缺少依赖插件，跳过加载:\n` +
            missingDeps.map(uuid => `  - UUID: ${uuid}`).join('\n')
          );
        }
      }
    }

    // 第三遍：加载没有依赖问题的插件
    const loadedCount = Array.from(pluginMetadata.values()).filter(info => !info.hasMissingDeps).length;
    const skippedCount = Array.from(pluginMetadata.values()).filter(info => info.hasMissingDeps).length;

    for (const [pluginName, info] of pluginMetadata.entries()) {
      if (!info.hasMissingDeps) {
        await this.loadPlugin(pluginName);
      }
    }

    this.context.logger.plugin(
      `插件加载完成：成功 ${this.plugins.size}/${loadedCount}，跳过 ${skippedCount}`
    );
  }

  public async loadPlugin(pluginName: string): Promise<void> {
    if (this.plugins.has(pluginName)) {
      return;
    }

    this.context.logger.plugin(`正在加载 ${pluginName}...`);

    const pluginDir = path.join(process.cwd(), 'plugins', pluginName);
    const metadataPath = path.join(pluginDir, 'plugin.yaml');

    // 检查是否存在 plugin.yaml
    if (!fs.existsSync(metadataPath)) {
      this.context.logger.plugin(`插件 ${pluginName} 缺少 plugin.yaml 元数据文件`);
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

      // 验证 UUID
      if (!metadata.uuid) {
        throw new Error('plugin.yaml 缺少 uuid 字段');
      }

      // 检查 UUID 是否重复
      if (this.pluginsByUuid.has(metadata.uuid)) {
        const existing = this.pluginsByUuid.get(metadata.uuid);
        throw new Error(`UUID 冲突: ${metadata.uuid} 已被插件 ${existing?.name} 使用`);
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

      const loadedPlugin: LoadedPlugin = {
        name: metadata.name,
        metadata: metadata as any,
        modulePath: resolvedPath,
        module: pluginModule,
      };

      this.plugins.set(pluginName, loadedPlugin);
      this.pluginsByUuid.set(metadata.uuid, loadedPlugin); // 添加 UUID 索引

      this.context.logger.plugin(`已加载 ${metadata.name} v${metadata.version} (${metadata.uuid})`);
    } catch (error) {
      this.context.logger.plugin(`加载 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async destroyAll(): Promise<void> {
    for (const [pluginName, plugin] of this.plugins.entries()) {
      try {
        await plugin.module.destroy?.();
      } catch (error) {
        this.context.logger.plugin(`销毁 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.plugins.clear();
    this.pluginsByUuid.clear();
  }

  public async unloadPlugin(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return false;
    }

    try {
      // 调用插件的 destroy 方法
      await plugin.module.destroy?.();

      // 从映射中移除
      this.plugins.delete(pluginName);
      this.pluginsByUuid.delete(plugin.metadata.uuid);

      // 清除 Node.js 模块缓存
      const modulePath = plugin.modulePath;
      delete require.cache[require.resolve(modulePath)];

      this.context.logger.plugin(`已卸载 ${plugin.metadata.name} v${plugin.metadata.version}`);
      return true;
    } catch (error) {
      this.context.logger.plugin(`卸载 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  public async reloadPlugin(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      this.context.logger.plugin(`插件 ${pluginName} 不存在`);
      return false;
    }

    this.context.logger.plugin(`正在重载 ${plugin.metadata.name}...`);

    // 卸载插件
    const unloaded = await this.unloadPlugin(pluginName);
    if (!unloaded) {
      return false;
    }

    // 等待一小段时间，确保资源释放
    await new Promise(resolve => setTimeout(resolve, 100));

    // 重新加载插件
    try {
      await this.loadPlugin(pluginName);
      this.context.logger.plugin(`${pluginName} 重载成功`);
      return true;
    } catch (error) {
      this.context.logger.plugin(`${pluginName} 重载失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  public async reloadAllPlugins(): Promise<void> {
    this.context.logger.plugin('开始重载所有插件...');

    const pluginNames = Array.from(this.plugins.keys());
    let successCount = 0;
    let failCount = 0;

    for (const pluginName of pluginNames) {
      const success = await this.reloadPlugin(pluginName);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    this.context.logger.plugin(`插件重载完成：成功 ${successCount}，失败 ${failCount}`);
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
        this.context.logger.plugin(`数据包处理失败 ${registration.pluginName}: ${error instanceof Error ? error.message : String(error)}`);
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

  public getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  public getPluginByName(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  public getPluginByUuid(uuid: string): LoadedPlugin | undefined {
    return this.pluginsByUuid.get(uuid);
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
          this.context.logger.plugin(`${pluginName} 注册路由失败，HTTP 服务未启用: ${method.toUpperCase()} ${routePath}`);
          return;
        }
        const expressMethod = method.toLowerCase() as PluginRouteMethod;
        (app[expressMethod] as any).call(app, routePath, handler);
        this.context.logger.plugin(`${pluginName} 注册路由 ${method.toUpperCase()} ${routePath}`);
      },
      serveStatic: (mountPath: string, rootDir: string) => {
        const app = this.context.expressApp ?? this.context.httpServer?.getExpressApp();
        if (!app) {
          this.context.logger.plugin(`${pluginName} 挂载静态目录失败，HTTP 服务未启用: ${mountPath}`);
          return;
        }
        // 如果 rootDir 是相对路径，相对于插件的 res 目录解析
        const resolvedDir = path.isAbsolute(rootDir) ? rootDir : path.join(resDir, rootDir);
        app.use(mountPath, express.static(resolvedDir));
        this.context.logger.plugin(`${pluginName} 挂载静态目录 ${mountPath} -> ${resolvedDir}`);
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
