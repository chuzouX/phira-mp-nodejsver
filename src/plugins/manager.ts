import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { Logger } from '../logging/logger';
import {
  PluginApi,
  PluginContext,
  PluginEventBus,
  PluginEventHandler,
  PluginEventName,
  PluginEventPayload,
  PluginModule,
  LoadedPlugin,
  PacketHandlerRegistration,
  PluginRouteMethod,
} from './types';
import { ClientCommand, ServerCommand } from '../domain/protocol/Commands';

interface RegisteredPluginEventHandler {
  handler: PluginEventHandler;
  once: boolean;
}

class SafePluginEventBus implements PluginEventBus {
  private readonly handlers = new Map<string, Set<RegisteredPluginEventHandler>>();

  constructor(private readonly logger: Logger) {}

  on<E extends PluginEventName>(
    event: E,
    handler: PluginEventHandler<PluginEventPayload<E>>,
  ): () => void {
    return this.add(event, handler, false);
  }

  once<E extends PluginEventName>(
    event: E,
    handler: PluginEventHandler<PluginEventPayload<E>>,
  ): () => void {
    return this.add(event, handler, true);
  }

  off<E extends PluginEventName>(
    event: E,
    handler: PluginEventHandler<PluginEventPayload<E>>,
  ): boolean {
    const key = String(event);
    const current = this.handlers.get(key);
    if (!current) return false;

    let removed = false;
    for (const registration of current) {
      if (registration.handler === handler) {
        current.delete(registration);
        removed = true;
      }
    }
    if (current.size === 0) this.handlers.delete(key);
    return removed;
  }

  listenerCount(event: PluginEventName): number {
    return this.handlers.get(String(event))?.size ?? 0;
  }

  emit<E extends PluginEventName>(event: E, payload: PluginEventPayload<E>): void {
    const registrations = this.getRegistrations(event);
    for (const { handler } of registrations) {
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

  async emitAsync<E extends PluginEventName>(
    event: E,
    payload: PluginEventPayload<E>,
  ): Promise<void> {
    const registrations = this.getRegistrations(event);
    for (const { handler } of registrations) {
      try {
        await handler(payload);
      } catch (error) {
        this.logger.error(`[插件事件] ${String(event)} 异步执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private add<E extends PluginEventName>(
    event: E,
    handler: PluginEventHandler<PluginEventPayload<E>>,
    once: boolean,
  ): () => void {
    const key = String(event);
    const current = this.handlers.get(key) ?? new Set<RegisteredPluginEventHandler>();
    const registration: RegisteredPluginEventHandler = {
      handler: handler as PluginEventHandler,
      once,
    };
    current.add(registration);
    this.handlers.set(key, current);

    return () => {
      current.delete(registration);
      if (current.size === 0) this.handlers.delete(key);
    };
  }

  private getRegistrations(event: PluginEventName): RegisteredPluginEventHandler[] {
    const key = String(event);
    const current = this.handlers.get(key);
    if (!current) return [];

    const registrations = Array.from(current);
    for (const registration of registrations) {
      if (registration.once) current.delete(registration);
    }
    if (current.size === 0) this.handlers.delete(key);
    return registrations;
  }
}

export class PluginManager {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly pluginsByUuid = new Map<string, LoadedPlugin>(); // UUID 索引
  private readonly packetHandlers = new Map<number, Array<PacketHandlerRegistration & { pluginName: string }>>();
  private readonly eventsBus: SafePluginEventBus;
  private readonly commandHandlers = new Map<string, (...args: string[]) => void | Promise<void>>();
  private readonly pluginRoutes = new Map<string, Set<string>>(); // 记录每个插件的路由
  private readonly cascadeUnloadHistory = new Map<string, Set<string>>(); // 记录级联卸载历史

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
      this.context.logger.plugin('提示: 将插件目录放入 plugins/ 后使用 /plugins install <name> 加载');
      return;
    }

    this.context.logger.plugin('开始加载插件...');

    const pluginNames = fs.readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('!')) // 跳过以 ! 开头的目录（禁用的插件）
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
        const missingDeps: Array<{ uuid: string; name?: string }> = [];

        for (const dep of metadata.dependencies) {
          // 支持两种格式：字符串 UUID 或对象 { uuid, name }
          const depUuid = typeof dep === 'string' ? dep : dep.uuid;
          const depName = typeof dep === 'object' && dep.name ? dep.name : undefined;

          // 查找依赖的插件
          const depPlugin = Array.from(pluginMetadata.values()).find(p => p.metadata.uuid === depUuid);

          if (!depPlugin) {
            missingDeps.push({ uuid: depUuid, name: depName });
          }
        }

        if (missingDeps.length > 0) {
          info.hasMissingDeps = true;
          info.missingDeps = missingDeps.map(d => d.uuid);

          // 输出缺失依赖信息
          this.context.logger.plugin(
            `${metadata.name} (${metadata.uuid}) 缺少依赖插件，跳过加载:`
          );

          missingDeps.forEach(dep => {
            if (dep.name) {
              this.context.logger.plugin(`  - ${dep.name} (${dep.uuid})`);
            } else {
              this.context.logger.plugin(`  - 未知插件 (${dep.uuid})`);
            }
          });
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

      // 检查并创建插件配置文件
      const pluginConfigDir = path.join(process.cwd(), 'config', pluginName);
      const pluginConfigPath = path.join(pluginConfigDir, 'config.yaml');

      if (!fs.existsSync(pluginConfigPath)) {
        // 检查插件目录中是否有默认配置模板
        const defaultConfigPath = path.join(pluginDir, 'config.default.yaml');
        const defaultConfigInResPath = path.join(resDir, 'config.default.yaml');

        let defaultConfig: string | null = null;

        if (fs.existsSync(defaultConfigPath)) {
          defaultConfig = fs.readFileSync(defaultConfigPath, 'utf8');
          this.context.logger.plugin(`从 plugins/${pluginName}/config.default.yaml 读取默认配置`);
        } else if (fs.existsSync(defaultConfigInResPath)) {
          defaultConfig = fs.readFileSync(defaultConfigInResPath, 'utf8');
          this.context.logger.plugin(`从 plugins/${pluginName}/res/config.default.yaml 读取默认配置`);
        }

        if (defaultConfig) {
          // 创建配置目录
          fs.mkdirSync(pluginConfigDir, { recursive: true });
          fs.writeFileSync(pluginConfigPath, defaultConfig, 'utf8');
          this.context.logger.plugin(`已为插件 ${pluginName} 创建默认配置: config/${pluginName}/config.yaml`);
        }
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
      // 1. 查找依赖此插件的其他插件
      const dependentPlugins = Array.from(this.plugins.values()).filter(p => {
        const deps = p.metadata.dependencies || [];
        return deps.some((dep: any) => {
          const depUuid = typeof dep === 'string' ? dep : dep.uuid;
          return depUuid === plugin.metadata.uuid;
        });
      });

      // 2. 先卸载依赖此插件的其他插件（级联卸载）
      if (dependentPlugins.length > 0) {
        this.context.logger.plugin(`检测到 ${dependentPlugins.length} 个插件依赖 ${plugin.metadata.name}，将一并卸载`);
        for (const depPlugin of dependentPlugins) {
          this.context.logger.plugin(`  - 级联卸载: ${depPlugin.metadata.name}`);
          await this.unloadPlugin(depPlugin.metadata.id);
        }
      }

      // 3. 调用插件的 destroy 方法
      await plugin.module.destroy?.();

      // 4. 从映射中移除
      this.plugins.delete(pluginName);
      this.pluginsByUuid.delete(plugin.metadata.uuid);

      // 5. 清除路由记录
      const routes = this.pluginRoutes.get(pluginName);
      if (routes && routes.size > 0) {
        this.context.logger.plugin(`插件 ${pluginName} 的 ${routes.size} 个路由已禁用`);
      }
      this.pluginRoutes.delete(pluginName);

      // 6. 清除 Node.js 模块缓存
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

    // 直接卸载插件（不触发级联卸载）
    try {
      await plugin.module.destroy?.();
      this.plugins.delete(pluginName);
      this.pluginsByUuid.delete(plugin.metadata.uuid);

      const routes = this.pluginRoutes.get(pluginName);
      if (routes && routes.size > 0) {
        this.context.logger.plugin(`插件 ${pluginName} 的 ${routes.size} 个路由已禁用`);
      }
      this.pluginRoutes.delete(pluginName);

      const modulePath = plugin.modulePath;
      delete require.cache[require.resolve(modulePath)];

      this.context.logger.plugin(`已卸载 ${plugin.metadata.name} v${plugin.metadata.version}`);
    } catch (error) {
      this.context.logger.plugin(`卸载 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
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

    // 获取所有插件名称
    const pluginNames = Array.from(this.plugins.keys());

    // 先卸载所有插件（不触发级联）
    for (const pluginName of pluginNames) {
      const plugin = this.plugins.get(pluginName);
      if (plugin) {
        try {
          await plugin.module.destroy?.();
          this.context.logger.plugin(`已卸载 ${plugin.metadata.name} v${plugin.metadata.version}`);
        } catch (error) {
          this.context.logger.plugin(`卸载 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // 清空所有映射
    this.plugins.clear();
    this.pluginsByUuid.clear();
    this.pluginRoutes.clear();

    // 等待资源释放
    await new Promise(resolve => setTimeout(resolve, 100));

    // 重新加载所有插件
    let successCount = 0;
    let failCount = 0;

    for (const pluginName of pluginNames) {
      try {
        await this.loadPlugin(pluginName);
        successCount++;
      } catch (error) {
        this.context.logger.plugin(`重载 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
        failCount++;
      }
    }

    this.context.logger.plugin(`插件重载完成：成功 ${successCount}，失败 ${failCount}`);
  }

  public async disablePlugin(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      this.context.logger.plugin(`插件 ${pluginName} 未加载或不存在`);
      return false;
    }

    try {
      // 临时卸载插件（不修改文件系统）
      await this.unloadPlugin(pluginName);
      this.context.logger.plugin(`已禁用插件: ${pluginName}（重启后会重新加载）`);
      return true;
    } catch (error) {
      this.context.logger.plugin(`禁用插件 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  public async enablePlugin(pluginName: string): Promise<boolean> {
    // 检查插件是否已加载
    if (this.plugins.has(pluginName)) {
      this.context.logger.plugin(`插件 ${pluginName} 已经在运行`);
      return false;
    }

    // 检查插件目录是否存在（优先检查正常目录，然后检查禁用目录）
    const pluginsDir = path.join(process.cwd(), 'plugins');
    const pluginPath = path.join(pluginsDir, pluginName);
    const disabledPath = path.join(pluginsDir, `!${pluginName}`);

    // 如果是禁用状态（!开头），需要先重命名
    if (fs.existsSync(disabledPath)) {
      try {
        // 等待确保目录没有被占用
        await new Promise(resolve => setTimeout(resolve, 500));

        // 重命名目录（移除 ! 前缀）
        fs.renameSync(disabledPath, pluginPath);
        this.context.logger.plugin(`已将 !${pluginName} 重命名为 ${pluginName}`);
      } catch (error) {
        this.context.logger.plugin(`重命名插件目录失败: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    } else if (!fs.existsSync(pluginPath)) {
      this.context.logger.plugin(`插件 ${pluginName} 不存在`);
      return false;
    }

    try {
      // 临时加载插件
      await this.loadPlugin(pluginName);
      this.context.logger.plugin(`已启用插件: ${pluginName}`);

      // 检查是否有级联卸载的历史记录
      const cascaded = this.cascadeUnloadHistory.get(pluginName);
      if (cascaded && cascaded.size > 0) {
        this.context.logger.plugin(`检测到 ${cascaded.size} 个插件曾被级联卸载，正在重新加载`);

        for (const cascadedPluginName of cascaded) {
          // 检查插件目录是否存在
          const cascadedPluginPath = path.join(pluginsDir, cascadedPluginName);
          if (fs.existsSync(cascadedPluginPath)) {
            this.context.logger.plugin(`  - 级联加载: ${cascadedPluginName}`);
            await this.loadPlugin(cascadedPluginName);
          }
        }

        // 清除历史记录
        this.cascadeUnloadHistory.delete(pluginName);
      }

      return true;
    } catch (error) {
      this.context.logger.plugin(`启用插件 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 安装并加载 plugins 目录下未加载的插件
   * @param pluginName 插件目录名
   * @returns 是否成功安装
   */
  public async installPlugin(pluginName: string): Promise<{ success: boolean; message: string }> {
    // 1. 检查插件是否已加载
    if (this.plugins.has(pluginName)) {
      return { success: false, message: `插件 ${pluginName} 已经在运行` };
    }

    const pluginsDir = path.join(process.cwd(), 'plugins');
    const pluginPath = path.join(pluginsDir, pluginName);
    const disabledPath = path.join(pluginsDir, `!${pluginName}`);

    // 2. 检查插件目录是否存在
    let actualPath = pluginPath;
    let isDisabled = false;

    if (fs.existsSync(pluginPath)) {
      actualPath = pluginPath;
      isDisabled = false;
    } else if (fs.existsSync(disabledPath)) {
      actualPath = disabledPath;
      isDisabled = true;
    } else {
      return { success: false, message: `插件目录不存在: plugins/${pluginName}/` };
    }

    // 3. 检查 plugin.yaml 是否存在
    const metadataPath = path.join(actualPath, 'plugin.yaml');
    if (!fs.existsSync(metadataPath)) {
      return { success: false, message: `插件 ${pluginName} 缺少 plugin.yaml 元数据文件` };
    }

    try {
      // 4. 读取并验证插件元数据
      const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
      const metadata = yaml.load(metadataRaw) as any;

      if (!metadata || typeof metadata !== 'object') {
        return { success: false, message: `插件 ${pluginName} 的 plugin.yaml 格式无效` };
      }

      if (!metadata.id || !metadata.name || !metadata.version) {
        return { success: false, message: `插件 ${pluginName} 缺少必需字段 (id, name, version)` };
      }

      if (!metadata.uuid) {
        return { success: false, message: `插件 ${pluginName} 缺少 uuid 字段` };
      }

      // 5. 检查 UUID 是否与其他已加载插件冲突
      if (this.pluginsByUuid.has(metadata.uuid)) {
        const existing = this.pluginsByUuid.get(metadata.uuid);
        return { success: false, message: `UUID 冲突: ${metadata.uuid} 已被插件 ${existing?.name} 使用` };
      }

      // 6. 检查依赖
      if (metadata.dependencies && Array.isArray(metadata.dependencies) && metadata.dependencies.length > 0) {
        const missingDeps: string[] = [];

        for (const dep of metadata.dependencies) {
          const depUuid = typeof dep === 'string' ? dep : dep.uuid;
          const depName = typeof dep === 'object' && dep.name ? dep.name : depUuid;

          // 检查依赖是否已加载
          if (!this.pluginsByUuid.has(depUuid)) {
            missingDeps.push(depName);
          }
        }

        if (missingDeps.length > 0) {
          return {
            success: false,
            message: `插件 ${pluginName} 缺少依赖: ${missingDeps.join(', ')}。请先安装依赖插件`
          };
        }
      }

      // 7. 如果是禁用状态，先启用
      if (isDisabled) {
        await new Promise(resolve => setTimeout(resolve, 200));
        fs.renameSync(disabledPath, pluginPath);
        this.context.logger.plugin(`已将 !${pluginName} 重命名为 ${pluginName}`);
      }

      // 8. 加载插件
      await this.loadPlugin(pluginName);

      // 9. 检查是否加载成功
      if (this.plugins.has(pluginName)) {
        const loadedPlugin = this.plugins.get(pluginName)!;
        return {
          success: true,
          message: `已安装并加载插件: ${loadedPlugin.metadata.name} v${loadedPlugin.metadata.version}`
        };
      } else {
        return { success: false, message: `插件 ${pluginName} 加载失败，请查看日志` };
      }
    } catch (error) {
      return {
        success: false,
        message: `安装插件 ${pluginName} 失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  public getAllPlugins(): { name: string; enabled: boolean }[] {
    const pluginsDir = path.join(process.cwd(), 'plugins');
    if (!fs.existsSync(pluginsDir)) {
      return [];
    }

    return fs.readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name.startsWith('!') ? entry.name.substring(1) : entry.name,
        enabled: !entry.name.startsWith('!')
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  public async emitAsync<E extends PluginEventName>(
    event: E,
    payload: PluginEventPayload<E>,
  ): Promise<void> {
    await this.eventsBus.emitAsync(event, payload);
  }

  public emit<E extends PluginEventName>(event: E, payload: PluginEventPayload<E>): void {
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

        // 记录路由
        if (!this.pluginRoutes.has(pluginName)) {
          this.pluginRoutes.set(pluginName, new Set());
        }
        this.pluginRoutes.get(pluginName)!.add(`${method.toUpperCase()} ${routePath}`);

        // 包装 handler，添加插件状态检查
        const wrappedHandler: express.RequestHandler = (req, res, next) => {
          // 检查插件是否仍然加载
          if (!this.plugins.has(pluginName)) {
            return res.status(503).json({
              error: 'Service Unavailable',
              message: `Plugin '${pluginName}' is not loaded`
            });
          }
          return handler(req, res, next);
        };

        const expressMethod = method.toLowerCase() as PluginRouteMethod;
        (app[expressMethod] as any).call(app, routePath, wrappedHandler);
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
      sendCommandToUser: (userId: number, command: ServerCommand) => this.context.protocolHandler.sendCommandToUser(userId, command),

      // ========== 服务器数据访问 API ==========

      getOnlinePlayers: () => {
        const sessions = this.context.protocolHandler.getAllSessions();
        return sessions.map(session => ({
          ...session,
          connectionId: '', // 无法直接获取 connectionId
          isAdmin: this.context.config.adminPhiraId.includes(session.id),
          isOwner: this.context.config.ownerPhiraId.includes(session.id),
        }));
      },

      getRooms: () => {
        return this.context.roomManager.listRooms().map(room => ({
          id: room.id,
          name: room.name,
          playerCount: room.players.size,
          maxPlayers: room.maxPlayers,
          state: room.state.type,
          locked: room.locked,
          cycle: room.cycle,
          ownerId: room.ownerId,
          players: Array.from(room.players.values()).map(p => ({
            id: p.user.id,
            name: p.user.name,
            isReady: p.isReady,
            isFinished: p.isFinished,
          })),
        }));
      },

      getRoom: (roomId: string) => {
        const room = this.context.roomManager.getRoom(roomId);
        if (!room) return undefined;

        return {
          id: room.id,
          name: room.name,
          playerCount: room.players.size,
          maxPlayers: room.maxPlayers,
          state: room.state.type,
          locked: room.locked,
          cycle: room.cycle,
          ownerId: room.ownerId,
          players: Array.from(room.players.values()).map(p => ({
            id: p.user.id,
            name: p.user.name,
            isReady: p.isReady,
            isFinished: p.isFinished,
          })),
        };
      },

      getServerStats: () => {
        const used = process.memoryUsage();
        return {
          serverName: this.context.config.serverName,
          onlinePlayers: this.context.protocolHandler.getSessionCount(),
          roomCount: this.context.roomManager.count(),
          uptime: process.uptime(),
          memoryUsage: {
            rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
            heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100,
            heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
          },
        };
      },

      getBanList: () => {
        const bans = this.context.banManager.getAllBans();
        return {
          idBans: bans.idBans.map(ban => ({
            ...ban,
            target: ban.target as number,
          })),
          ipBans: bans.ipBans.map(ban => ({
            ...ban,
            target: ban.target as string,
          })),
        };
      },

      isUserAdmin: (userId: number) => {
        return this.context.config.adminPhiraId.includes(userId);
      },

      isUserOwner: (userId: number) => {
        return this.context.config.ownerPhiraId.includes(userId);
      },

      getPlayer: (userId: number) => {
        const sessions = this.context.protocolHandler.getAllSessions();
        const session = sessions.find(s => s.id === userId);
        if (!session) return undefined;

        const room = this.context.roomManager.getRoomByUserId(userId);

        return {
          ...session,
          connectionId: '', // 无法直接获取 connectionId
          roomId: room?.id,
          roomName: room?.name,
          isAdmin: this.context.config.adminPhiraId.includes(userId),
          isOwner: this.context.config.ownerPhiraId.includes(userId),
        };
      },

      sendServerMessage: (roomId: string, content: string) => {
        this.context.protocolHandler.sendServerMessage(roomId, content);
      },

      kickPlayer: (userId: number) => {
        return this.context.protocolHandler.kickPlayer(userId);
      },

      banPlayer: (userId: number, duration: number | null, reason: string, adminName?: string) => {
        this.context.banManager.banId(userId, duration, reason, adminName);
        this.context.protocolHandler.kickPlayer(userId);
      },

      unbanPlayer: (userId: number, adminName?: string) => {
        return this.context.banManager.unbanId(userId, adminName);
      },

      banIp: (ip: string, duration: number | null, reason: string, adminName?: string) => {
        this.context.banManager.banIp(ip, duration, reason, adminName);
        this.context.protocolHandler.kickIp(ip);
      },

      unbanIp: (ip: string, adminName?: string) => {
        return this.context.banManager.unbanIp(ip, adminName);
      },

      forceStartGame: (roomId: string) => {
        return this.context.protocolHandler.forceStartGame(roomId);
      },

      toggleRoomLock: (roomId: string) => {
        return this.context.protocolHandler.toggleRoomLock(roomId);
      },

      setRoomMaxPlayers: (roomId: string, maxPlayers: number) => {
        return this.context.protocolHandler.setRoomMaxPlayers(roomId, maxPlayers);
      },

      closeRoom: (roomId: string) => {
        return this.context.protocolHandler.closeRoomByAdmin(roomId);
      },
    };
  }
}
