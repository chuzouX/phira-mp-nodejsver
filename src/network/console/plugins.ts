import { ConsoleCtx } from './context';
import * as fs from 'fs';
import * as path from 'path';

export function showPluginsHelp(ctx: ConsoleCtx, _args: string[]): void {
  const help = `
[插件管理帮助]
═════════════════════════════════════════════════════════
命令列表：

  /plugins [list]              列出所有插件（包括已禁用）
  /plugins info <name>         查看插件详细信息
  /plugins help                显示此帮助信息

插件控制：
  /plugins reload [name]       重载插件（不指定则重载全部）
  /plugins enable <name>       启用已禁用的插件
  /plugins disable <name>      禁用插件（添加前缀 !）

插件管理：
  /plugins install <name>      安装并加载 plugins 目录下的插件
  /plugins uninstall <name>    卸载并删除插件目录

说明：
  • install - 加载 plugins 目录下未加载的插件（支持已禁用的插件）
  • enable/disable - 启用/禁用，重启后保持
  • 禁用的插件目录名会添加 ! 前缀
  • 默认情况下，以 ! 开头的目录不会被加载

═════════════════════════════════════════════════════════
`;
  ctx.logger.command(help);
}

export function listPlugins(ctx: ConsoleCtx, _args: string[]): void {
  if (!ctx.pluginManager) {
    ctx.logger.warn('[控制台] 插件系统未启用');
    return;
  }
  const allPlugins = ctx.pluginManager.getAllPlugins();
  if (allPlugins.length === 0) {
    ctx.logger.command('[插件列表] 当前没有任何插件');
    return;
  }
  const enabledPlugins = allPlugins.filter((p) => p.enabled);
  const disabledPlugins = allPlugins.filter((p) => !p.enabled);
  ctx.logger.command(
    `[插件列表] 共 ${allPlugins.length} 个插件 (已启用: ${enabledPlugins.length}, 已禁用: ${disabledPlugins.length})`,
  );
  ctx.logger.command('═════════════════════════════════════════════════════════');
  if (enabledPlugins.length > 0) {
    ctx.logger.command('✓ 已启用的插件:');
    enabledPlugins.forEach((item, index) => {
      const plugin = ctx.pluginManager!.getPluginByName(item.name);
      if (plugin) {
        const { metadata } = plugin;
        const deps =
          metadata.dependencies && metadata.dependencies.length > 0
            ? ` (${metadata.dependencies.length} 个依赖)`
            : '';
        ctx.logger.command(`  ${index + 1}. ${metadata.name} v${metadata.version}${deps}`);
        ctx.logger.command(`     ID: ${metadata.id} | UUID: ${metadata.uuid}`);
        if (metadata.description) {
          ctx.logger.command(`     描述: ${metadata.description}`);
        }
      } else {
        ctx.logger.command(`  ${index + 1}. ${item.name} (未加载)`);
      }
      if (index < enabledPlugins.length - 1) {
        ctx.logger.command('     ─────────────────────────────────────────────────────');
      }
    });
  }
  if (disabledPlugins.length > 0) {
    ctx.logger.command('');
    ctx.logger.command('✗ 已禁用的插件:');
    disabledPlugins.forEach((item, index) => {
      ctx.logger.command(`  ${index + 1}. !${item.name} (已禁用)`);
    });
  }
  ctx.logger.command('═════════════════════════════════════════════════════════');
  ctx.logger.command(`提示: 使用 /plugins info <name> 查看插件详细信息`);
  ctx.logger.command(`      使用 /plugins help 查看所有命令`);
}

export async function reloadPlugin(ctx: ConsoleCtx, args: string[]): Promise<void> {
  if (!ctx.pluginManager) return;
  const pluginName = args[1];
  ctx.logger.command(`[插件重载] 正在重载插件: ${pluginName}`);
  const success = await ctx.pluginManager.reloadPlugin(pluginName);
  if (success) {
    ctx.logger.command(`[插件重载] ✓ ${pluginName} 重载成功`);
  } else {
    ctx.logger.warn(`[插件重载] ✗ ${pluginName} 重载失败`);
  }
}

export async function reloadAllPlugins(ctx: ConsoleCtx, _args: string[]): Promise<void> {
  if (!ctx.pluginManager) return;
  ctx.logger.command('[插件重载] 正在重载所有插件...');
  await ctx.pluginManager.reloadAllPlugins();
  ctx.logger.command('[插件重载] 重载完成');
}

export function showPluginInfo(ctx: ConsoleCtx, args: string[]): void {
  if (!ctx.pluginManager) return;
  const pluginName = args[2];
  const plugin = ctx.pluginManager.getPluginByName(pluginName);
  if (!plugin) {
    ctx.logger.warn(`[插件信息] 未找到插件: ${pluginName}`);
    ctx.logger.warn('提示: 使用 /plugins list 查看所有已加载的插件');
    return;
  }
  const { metadata } = plugin;
  ctx.logger.command(`[插件信息] ${metadata.name}`);
  ctx.logger.command('═════════════════════════════════════════════════════════');
  ctx.logger.command(`名称: ${metadata.name}`);
  ctx.logger.command(`版本: ${metadata.version}`);
  ctx.logger.command(`ID: ${metadata.id}`);
  ctx.logger.command(`UUID: ${metadata.uuid}`);
  if (metadata.description) {
    ctx.logger.command(`描述: ${metadata.description}`);
  }
  if (metadata.author) {
    ctx.logger.command(`作者: ${metadata.author}`);
  }
  if (metadata.license) {
    ctx.logger.command(`许可证: ${metadata.license}`);
  }
  if (metadata.homepage) {
    ctx.logger.command(`主页: ${metadata.homepage}`);
  }
  if (metadata.repository) {
    ctx.logger.command(`仓库: ${metadata.repository}`);
  }
  if (metadata.dependencies && metadata.dependencies.length > 0) {
    ctx.logger.command(`依赖 (${metadata.dependencies.length}):`);
    metadata.dependencies.forEach((dep) => {
      const depUuid = typeof dep === 'string' ? dep : (dep as any).uuid;
      const depPlugin = ctx.pluginManager!.getPluginByUuid(depUuid);
      if (depPlugin) {
        ctx.logger.command(`  - ${depPlugin.metadata.name} (${depUuid})`);
      } else {
        const depName = typeof dep === 'string' ? '' : (dep as any).name;
        ctx.logger.command(`  - ${depName || depUuid}${depName ? ' (' + depUuid + ')' : ''}`);
      }
    });
  } else {
    ctx.logger.command('依赖: 无');
  }
  if (metadata.tags && metadata.tags.length > 0) {
    ctx.logger.command(`标签: ${metadata.tags.join(', ')}`);
  }
  if (metadata.serverVersion) {
    ctx.logger.command(`要求服务器版本: ${metadata.serverVersion}`);
  }
  ctx.logger.command(`主文件: ${plugin.modulePath}`);
  ctx.logger.command('═════════════════════════════════════════════════════════');
}

export async function disablePlugin(ctx: ConsoleCtx, args: string[]): Promise<void> {
  if (!ctx.pluginManager) return;
  const pluginName = args[2];
  ctx.logger.command(`[插件管理] 正在禁用插件: ${pluginName}`);
  const success = await ctx.pluginManager.disablePlugin(pluginName);
  if (success) {
    ctx.logger.command(`[插件管理] ✓ ${pluginName} 已禁用（目录已重命名为 !${pluginName}）`);
  } else {
    ctx.logger.warn(`[插件管理] ✗ ${pluginName} 禁用失败`);
  }
}

export async function enablePlugin(ctx: ConsoleCtx, args: string[]): Promise<void> {
  if (!ctx.pluginManager) return;
  const pluginName = args[2];
  ctx.logger.command(`[插件管理] 正在启用插件: ${pluginName}`);
  const success = await ctx.pluginManager.enablePlugin(pluginName);
  if (success) {
    ctx.logger.command(`[插件管理] ✓ ${pluginName} 已启用并加载`);
  } else {
    ctx.logger.warn(`[插件管理] ✗ ${pluginName} 启用失败`);
  }
}

export async function installPlugin(ctx: ConsoleCtx, args: string[]): Promise<void> {
  if (!ctx.pluginManager) return;
  const pluginName = args[2];
  ctx.logger.command(`[插件安装] 正在安装插件: ${pluginName}`);
  const result = await ctx.pluginManager.installPlugin(pluginName);
  if (result.success) {
    ctx.logger.command(`[插件安装] ✓ ${result.message}`);
  } else {
    ctx.logger.warn(`[插件安装] ✗ ${result.message}`);
  }
}

export async function uninstallPlugin(ctx: ConsoleCtx, args: string[]): Promise<void> {
  if (!ctx.pluginManager) return;
  const pluginName = args[2];
  ctx.logger.command(`[插件管理] 正在卸载插件: ${pluginName}`);
  if (ctx.pluginManager.getPluginByName(pluginName)) {
    await ctx.pluginManager.unloadPlugin(pluginName);
  }
  const pluginsDir = path.join(process.cwd(), 'plugins');
  const pluginPath = path.join(pluginsDir, pluginName);
  const disabledPath = path.join(pluginsDir, `!${pluginName}`);
  try {
    const targetPath = fs.existsSync(pluginPath) ? pluginPath : disabledPath;
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      ctx.logger.command(`[插件管理] ✓ ${pluginName} 已卸载并删除`);
    } else {
      ctx.logger.warn(`[插件管理] ✗ 插件目录不存在: ${pluginName}`);
    }
  } catch (error: any) {
    ctx.logger.warn(`[插件管理] ✗ 删除失败: ${error.message}`);
  }
}
