/*
 * MIT License
 * Copyright (c) 2024
 */

import * as readline from 'readline';
import { Logger } from '../logging/logger';
import { RoomManager } from '../domain/rooms/RoomManager';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { BanManager } from '../domain/auth/BanManager';
import { ServerConfig } from '../config/config';
import * as net from 'net';
import { HttpServer } from './HttpServer';
import { ConsoleLogger } from '../logging/logger';
import { PluginManager } from '../plugins/manager';
import { listRooms as listRoomsFn, listPlayers as listPlayersFn, broadcast as broadcastFn, kickPlayer as kickPlayerFn, forceStart as forceStartFn, lockRoom as lockRoomFn, setMaxPlayers as setMaxPlayersFn, closeRoom as closeRoomFn, toggleMode as toggleModeFn, sendSystemMessage as sendSystemMessageFn, bulkAction as bulkActionFn } from './console/room';
import { listBans as listBansFn, addBan as addBanFn, unban as unbanFn, listLoginBlacklist as listLoginBlacklistFn, blacklistIp as blacklistIpFn, unblacklistIp as unblacklistIpFn } from './console/ban';
import { showInfo as showInfoFn, handleSet as handleSetFn, handleLog as handleLogFn, stopServer as stopServerFn, restartServer as restartServerFn, reloadServerConfig as reloadServerConfigFn } from './console/admin';
import { showPluginsHelp as showPluginsHelpFn, listPlugins as listPluginsFn, reloadPlugin as reloadPluginFn, reloadAllPlugins as reloadAllPluginsFn, showPluginInfo as showPluginInfoFn, disablePlugin as disablePluginFn, enablePlugin as enablePluginFn, installPlugin as installPluginFn, uninstallPlugin as uninstallPluginFn } from './console/plugins';

export class ConsoleInterface {
  private rl: readline.Interface;
  private readonly adminName: string = 'ConsoleAdmin';
  private pluginManager?: PluginManager;

  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    private readonly roomManager: RoomManager,
    private readonly protocolHandler: ProtocolHandler,
    private readonly banManager: BanManager,
    private readonly httpServer?: HttpServer,
    private readonly onReload?: () => void,
    private readonly setAdminStatus?: (userId: number, isAdmin: boolean) => Promise<string | null>,
    private readonly startTime: number = Date.now(),
    private readonly onUpdateConfig?: (key: string, value: string) => void,
    private readonly onSetLogLevels?: (levels: string[]) => void,
  ) {
    const commands = [
        '/help', '/room', '/status', '/ping', '/list', '/broadcast',
        '/kick', '/fstart', '/lock', '/maxp', '/close', '/tmode', '/smsg', '/bulk',
        '/bans', '/ban', '/unban', '/blist', '/blip', '/ublip', '/stop', '/restart',
        '/reload', '/op', '/deop', '/info', '/set', '/log', '/plugins'
    ];

    const logLevels = ['debug', 'info', 'mark', 'warn', 'error'];

    const envKeys = [
        'PORT', 'HOST', 'TCP_ENABLED', 'USE_PROXY_PROTOCOL', 'TRUST_PROXY_HOPS',
        'LOG_LEVEL', 'PHIRA_API_URL', 'SERVER_NAME', 'ROOM_SIZE',
        'SERVER_ANNOUNCEMENT', 'WEB_PORT', 'ENABLE_WEB_SERVER',
        'DEFAULT_AVATAR', 'ENABLE_UPDATE_CHECK',
        'ADMIN_PHIRA_ID', 'OWNER_PHIRA_ID',
        'BAN_ID_WHITELIST', 'BAN_IP_WHITELIST', 'SILENT_PHIRA_IDS',
        'ENABLE_PUB_WEB', 'PUB_PREFIX', 'ENABLE_PRI_WEB', 'PRI_PREFIX',
        'PLUGINS_ENABLED'
    ];

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      crlfDelay: Infinity,
      completer: (line: string) => {
        if (!line.startsWith('/')) {
            return [[], line];
        }

        const parts = line.split(' ');
        const currentCommand = parts[0].toLowerCase();
        const arg = parts[1] || '';

        // Complete Commands
        if (parts.length <= 1) {
            const hits = commands.filter((c) => c.startsWith(line.toLowerCase()));
            return [hits, line];
        }

        // Complete Arguments for specific commands
        let suggestions: string[] = [];
        
        // Room IDs
        const roomCmds = ['/lock', '/fstart', '/close', '/maxp', '/tmode', '/smsg'];
        if (roomCmds.includes(currentCommand)) {
            suggestions = this.roomManager.listRooms().map(r => r.id);
        }
        
        // User IDs (from sessions)
        const userCmds = ['/kick', '/op', '/deop'];
        if (userCmds.includes(currentCommand)) {
            suggestions = this.protocolHandler.getAllSessions().map(s => s.id.toString());
        }

        // Ban types
        if (currentCommand === '/ban' || currentCommand === '/unban') {
            if (parts.length === 2) {
                suggestions = ['id', 'ip'];
            }
        }

        // Env Keys
        if (currentCommand === '/set' && parts.length === 2) {
            suggestions = envKeys;
        }

        // Log Levels
        if (currentCommand === '/log' && parts.length === 2) {
            suggestions = logLevels;
        }

        const hits = suggestions.filter((s) => s.startsWith(arg));
        
        return [hits, arg];
      }
    });

    // Bind readline to ConsoleLogger to coordinate log output
    ConsoleLogger.setReadline(this.rl);
  }

  public setPluginManager(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager;
  }

  public start(): void {
    this.rl.setPrompt('> ');
    this.rl.on('line', (line) => {
      // 1. Clear only the current line (where the echo/duplicate command usually appears)
      // This keeps the original command line visible while removing the extra echo.
      process.stdout.write('\r\x1b[K');

      const input = line.trim();
      if (input === '') {
        this.rl.prompt();
        return;
      }
      
      if (!input.startsWith('/')) {
        this.logger.info(`[控制台] 未知输入: ${input}。输入 /help 查看命令列表。`);
        this.rl.prompt();
        return;
      }

      // 2. Suppress automatic logging prompts during command processing
      ConsoleLogger.isPromptSuppressed = true;

      this.handleCommand(input).finally(() => {
        // 3. Restore prompts and show one now
        ConsoleLogger.isPromptSuppressed = false;
        this.rl.prompt();
      });
    });

    this.logger.command('服务器启动成功！输入 /help 可以查看控制台命令。');
    this.rl.prompt();
  }

  public stop(): void {
    this.rl.close();
    ConsoleLogger.setReadline(null);
  }

  private async handleCommand(input: string): Promise<void> {
    const args = this.parseArgs(input);
    if (args.length === 0) return;
    
    const command = args[0].toLowerCase();
    this.logger.command(`执行指令: ${input}`);

    switch (command) {
      case '/help':
        this.showHelp();
        break;
      case '/room':
        listRoomsFn(this as any, args);
        break;
      case '/status':
        await this.checkStatus();
        break;
      case '/ping':
        this.logger.command(`[控制台] Pong! 服务器运行正常。`);
        break;
      case '/list':
        listPlayersFn(this as any, args);
        break;
      case '/broadcast':
        broadcastFn(this as any, args);
        break;
      case '/kick':
        kickPlayerFn(this as any, args);
        break;
      case '/fstart':
        forceStartFn(this as any, args);
        break;
      case '/lock':
        lockRoomFn(this as any, args);
        break;
      case '/maxp':
        setMaxPlayersFn(this as any, args);
        break;
      case '/close':
        closeRoomFn(this as any, args);
        break;
      case '/tmode':
        toggleModeFn(this as any, args);
        break;
      case '/smsg':
        sendSystemMessageFn(this as any, args);
        break;
      case '/bulk':
        bulkActionFn(this as any, args);
        break;
      case '/bans':
        listBansFn(this as any, args);
        break;
      case '/ban':
        addBanFn(this as any, args);
        break;
      case '/unban':
        unbanFn(this as any, args);
        break;
      case '/blist':
        listLoginBlacklistFn(this as any, args);
        break;
      case '/blip':
        blacklistIpFn(this as any, args);
        break;
      case '/ublip':
        unblacklistIpFn(this as any, args);
        break;
      case '/stop':
        stopServerFn(this as any, args);
        break;
      case '/restart':
        restartServerFn(this as any, args);
        break;
      case '/reload':
        reloadServerConfigFn(this as any, args);
        break;
      case '/op':
        await this.handleOp(args, true);
        break;
      case '/deop':
        await this.handleOp(args, false);
        break;
      case '/info':
        showInfoFn(this as any, args);
        break;
      case '/set':
        handleSetFn(this as any, args);
        break;
      case '/log':
        handleLogFn(this as any, args);
        break;
      case '/plugins':
        this.handlePlugins(args);
        break;
      default:
        // 尝试执行插件注册的命令
        if (this.pluginManager) {
          const pluginCommand = command.substring(1); // 移除开头的 /
          const handled = await this.pluginManager.executeCommand(pluginCommand, args.slice(1));
          if (handled) {
            break;
          }
        }
        this.logger.info(`[控制台] 未知命令: ${command}。输入 /help 查看命令列表。`);
    }
  }

  private parseArgs(input: string): string[] {
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const args: string[] = [];
    let match;
    while ((match = regex.exec(input)) !== null) {
      args.push(match[1] || match[2] || match[0]);
    }
    return args;
  }

  private showHelp(): void {
    const help = `
===== 服务器控制台帮助菜单 =====
/room - 获取服务器房间列表 (文本详情)
/status - Phira 服务器协议握手检测
/ping - 查看服务器响应
/help - 显示本帮助菜单
/list - 查看当前所有在线玩家列表
/broadcast "内容" [#ID] - 全服或指定房间广播
/kick {UID} - 强制移除指定用户
/fstart {RID} - 强制开始指定房间对局
/lock {RID} - 锁定/解锁房间
/maxp {RID} {人数} - 修改房间最大人数限制
/close {RID} - 强制关闭指定房间
/tmode {RID} - 切换房间模式 (循环/普通)
/smsg {RID} {内容} - 发送房间系统消息
/bulk {动作} {目标} [值] - 批量房间操作 (close_all, lock_all, unlock_all)
/bans - 查看封禁列表
/ban {类型: id|ip} {目标} [时长:秒] [原因] - 执行封禁
/unban {类型: id|ip} {目标} - 解除封禁
/blist - 查看登录黑名单
/blip {IP} [时长:秒] - 黑名单 IP
/ublip {IP} - 移除黑名单 IP
/stop - 关闭服务器
/restart - 重启服务器
/reload - 重新加载 env 配置
/op {phira_id} - 将此 ID 设置为管理员
/deop {phira_id} - 将此 ID 移除管理员
/info - 展示服务器状态以及各种信息
/set "{env变量}" "{值}" - 设置 env 变量的值
/log debug|info|mark|warn|error - 调整日志等级 (可多选，例如: /log warn|error)
/plugins [list|info <name>|reload [name]] - 插件管理 (查看、详情、重载)
==============================
`;
    console.log(help);
  }

  private async checkStatus(): Promise<void> {
    this.logger.info('[控制台] 正在检测 Phira 协议握手...');
    const startTime = Date.now();

    const client = new net.Socket();
    const timeout = 5000;

    return new Promise((resolve) => {
      client.setTimeout(timeout);

      client.connect(this.config.port, '127.0.0.1', () => {
        const latency = Date.now() - startTime;
        this.logger.command(`[握手成功] TCP 端口响应正常 (${latency}ms)`);
        client.destroy();
        resolve();
      });

      client.on('error', (err) => {
        this.logger.error(`[握手失败] 无法连接到 TCP 端口: ${err.message}`);
        client.destroy();
        resolve();
      });

      client.on('timeout', () => {
        this.logger.error(`[握手超时] TCP 连接在 ${timeout}ms 内未响应`);
        client.destroy();
        resolve();
      });
    });
  }

  private handlePlugins(args: string[]): void {
    if (!this.pluginManager) {
      this.logger.warn('[控制台] 插件系统未启用');
      return;
    }
    const subCommand = args[1]?.toLowerCase();
    switch (subCommand) {
      case 'help':
        showPluginsHelpFn(this as any, args);
        break;
      case 'list':
      case undefined:
        listPluginsFn(this as any, args);
        break;
      case 'info':
        if (!args[2]) { this.logger.warn('[控制台] 用法: /plugins info <plugin-name>'); return; }
        showPluginInfoFn(this as any, args);
        break;
      case 'reload':
        if (args[2]) { reloadPluginFn(this as any, args); }
        else { reloadAllPluginsFn(this as any, args); }
        break;
      case 'disable':
        if (!args[2]) { this.logger.warn('[控制台] 用法: /plugins disable <plugin-name>'); return; }
        disablePluginFn(this as any, args);
        break;
      case 'enable':
        if (!args[2]) { this.logger.warn('[控制台] 用法: /plugins enable <plugin-name>'); return; }
        enablePluginFn(this as any, args);
        break;
      case 'install':
        if (!args[2]) { this.logger.warn('[控制台] 用法: /plugins install <plugin-name>'); return; }
        installPluginFn(this as any, args);
        break;
      case 'uninstall':
        if (!args[2]) { this.logger.warn('[控制台] 用法: /plugins uninstall <plugin-name>'); return; }
        uninstallPluginFn(this as any, args);
        break;
      default:
        this.logger.warn('[控制台] 未知子命令。使用 /plugins help 查看帮助');
        break;
    }
  }

  private async handleOp(args: string[], isAdmin: boolean): Promise<void> {
    if (!this.setAdminStatus) {
      this.logger.warn('[控制台] 此环境不支持动态设置管理员。');
      return;
    }
    if (args.length < 2) {
      this.logger.warn(`[控制台] 用法: ${isAdmin ? '/op' : '/deop'} {phira_id}`);
      return;
    }
    const phiraId = Number(args[1]);
    if (isNaN(phiraId)) {
      this.logger.warn('[控制台] 非法的 Phira ID');
      return;
    }

    const userName = await this.setAdminStatus(phiraId, isAdmin);
    const actionStr = isAdmin ? '已设置为管理员' : '已移除管理员权限';
    this.logger.command(`[控制台] ${userName}[${phiraId}] ${actionStr}`);
  }
}
