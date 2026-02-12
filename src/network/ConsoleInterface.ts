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
import * as fs from 'fs';
import * as path from 'path';
import { version } from '../../package.json';
import { ConsoleLogger } from '../logging/logger';

export class ConsoleInterface {
  private rl: readline.Interface;
  private readonly adminName: string = 'ConsoleAdmin';

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
        '/reload', '/op', '/deop', '/info', '/set', '/log'
    ];

    const logLevels = ['debug', 'info', 'mark', 'warn', 'error'];

    const envKeys = [
        'PORT', 'HOST', 'TCP_ENABLED', 'USE_PROXY_PROTOCOL', 'TRUST_PROXY_HOPS',
        'ALLOWED_ORIGINS', 'LOG_LEVEL', 'PHIRA_API_URL', 'SERVER_NAME', 'ROOM_SIZE',
        'SERVER_ANNOUNCEMENT', 'WEB_PORT', 'ENABLE_WEB_SERVER', 'DISPLAY_IP',
        'DEFAULT_AVATAR', 'SESSION_SECRET', 'LOGIN_BLACKLIST_DURATION', 'ENABLE_UPDATE_CHECK',
        'ADMIN_NAME', 'ADMIN_PASSWORD', 'ADMIN_SECRET', 'ADMIN_PHIRA_ID', 'OWNER_PHIRA_ID',
        'BAN_ID_WHITELIST', 'BAN_IP_WHITELIST', 'SILENT_PHIRA_IDS', 'ENABLE_PUB_WEB',
        'PUB_PREFIX', 'ENABLE_PRI_WEB', 'PRI_PREFIX', 'CAPTCHA_PROVIDER', 'GEETEST_ID',
        'GEETEST_KEY', 'FEDERATION_ENABLED', 'FEDERATION_SEED_NODES', 'FEDERATION_SECRET',
        'FEDERATION_NODE_URL', 'FEDERATION_NODE_ID', 'FEDERATION_ALLOW_LOCAL',
        'FEDERATION_HEALTH_INTERVAL', 'FEDERATION_SYNC_INTERVAL'
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
        this.listRooms();
        break;
      case '/status':
        await this.checkStatus();
        break;
      case '/ping':
        this.logger.command(`[控制台] Pong! 服务器运行正常。`);
        break;
      case '/list':
        this.listPlayers();
        break;
      case '/broadcast':
        this.broadcast(args);
        break;
      case '/kick':
        this.kickPlayer(args);
        break;
      case '/fstart':
        this.forceStart(args);
        break;
      case '/lock':
        this.lockRoom(args);
        break;
      case '/maxp':
        this.setMaxPlayers(args);
        break;
      case '/close':
        this.closeRoom(args);
        break;
      case '/tmode':
        this.toggleMode(args);
        break;
      case '/smsg':
        this.sendSystemMessage(args);
        break;
      case '/bulk':
        this.bulkAction(args);
        break;
      case '/bans':
        this.listBans();
        break;
      case '/ban':
        this.ban(args);
        break;
      case '/unban':
        this.unban(args);
        break;
      case '/blist':
        this.listLoginBlacklist();
        break;
      case '/blip':
        this.blacklistIp(args);
        break;
      case '/ublip':
        this.unblacklistIp(args);
        break;
      case '/stop':
        this.stopServer();
        break;
      case '/restart':
        this.restartServer();
        break;
      case '/reload':
        this.reloadServerConfig();
        break;
      case '/op':
        await this.handleOp(args, true);
        break;
      case '/deop':
        await this.handleOp(args, false);
        break;
      case '/info':
        this.showInfo();
        break;
      case '/set':
        this.handleSet(args);
        break;
      case '/log':
        this.handleLog(args);
        break;
      default:
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
==============================
`;
    console.log(help);
  }

  private listRooms(): void {
    const rooms = this.roomManager.listRooms();
    if (rooms.length === 0) {
      this.logger.command('[控制台] 当前没有任何房间。');
      return;
    }

    let output = `[控制台] 当前共有 ${rooms.length} 个房间:
`;
    rooms.forEach((room) => {
      output += `- [${room.id}] ${room.name} | 房主: ${room.ownerId} | 人数: ${room.players.size}/${room.maxPlayers} | 状态: ${room.state.type}${room.locked ? ' (锁定)' : ''}
`;
    });
    this.logger.command(output.trim());
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

  private listPlayers(): void {
    const sessions = this.protocolHandler.getAllSessions();
    if (sessions.length === 0) {
      this.logger.command('[控制台] 当前没有在线玩家。');
      return;
    }

    let output = `[控制台] 当前共有 ${sessions.length} 名在线玩家:
`;
    sessions.forEach((p) => {
      output += `- ${p.name} (UID: ${p.id}) | IP: ${p.ip} | 房间: ${p.roomId || '大厅'}
`;
    });
    this.logger.command(output.trim());
  }

  private broadcast(args: string[]): void {
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /broadcast "内容" [#ID]');
      return;
    }

    const content = args[1];
    const target = args[2];
    const targetIds = (target && target.startsWith('#')) 
        ? target.substring(1).split(',').map(id => id.trim()) 
        : null;

    const rooms = this.roomManager.listRooms();
    let sentCount = 0;
    rooms.forEach(room => {
        if (!targetIds || targetIds.includes(room.id)) {
            this.protocolHandler.sendServerMessage(room.id, "【全服播报】" + content);
            sentCount++;
        }
    });

    this.logger.command(`[控制台] 播报已发送至 ${sentCount} 个房间。`);
  }

  private kickPlayer(args: string[]): void {
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /kick {UID}');
      return;
    }
    const uid = Number(args[1]);
    if (isNaN(uid)) {
      this.logger.warn('[控制台] 非法的用户 ID');
      return;
    }
    const success = this.protocolHandler.kickPlayer(uid);
    if (success) {
      this.logger.command(`[控制台] 已踢出用户 ${uid}`);
    } else {
      this.logger.warn(`[控制台] 无法踢出用户 ${uid}，用户可能不在线。`);
    }
  }

  private forceStart(args: string[]): void {
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /fstart {RID}');
      return;
    }
    const rid = args[1];
    const success = this.protocolHandler.forceStartGame(rid);
    if (success) {
      this.logger.command(`[控制台] 房间 ${rid} 已强制开始对局。`);
    } else {
      this.logger.warn(`[控制台] 无法开始房间 ${rid} 的对局，请检查房间是否存在或状态是否正确。`);
    }
  }

  private lockRoom(args: string[]): void {
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /lock {RID}');
      return;
    }
    const rid = args[1];
    const success = this.protocolHandler.toggleRoomLock(rid);
    if (success) {
      const room = this.roomManager.getRoom(rid);
      this.logger.command(`[控制台] 房间 ${rid} 现在已${room?.locked ? '锁定' : '解锁'}。`);
    } else {
      this.logger.warn(`[控制台] 找不到房间 ${rid}`);
    }
  }

  private setMaxPlayers(args: string[]): void {
    if (args.length < 3) {
      this.logger.warn('[控制台] 用法: /maxp {RID} {人数}');
      return;
    }
    const rid = args[1];
    const count = Number(args[2]);
    if (isNaN(count)) {
      this.logger.warn('[控制台] 非法的人数限制');
      return;
    }
    const success = this.protocolHandler.setRoomMaxPlayers(rid, count);
    if (success) {
      this.logger.command(`[控制台] 房间 ${rid} 最大人数已修改为 ${count}`);
    } else {
      this.logger.warn(`[控制台] 找不到房间 ${rid}`);
    }
  }

  private closeRoom(args: string[]): void {
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /close {RID}');
      return;
    }
    const rid = args[1];
    const success = this.protocolHandler.closeRoomByAdmin(rid);
    if (success) {
      this.logger.command(`[控制台] 房间 ${rid} 已关闭。`);
    } else {
      this.logger.warn(`[控制台] 找不到房间 ${rid}`);
    }
  }

  private toggleMode(args: string[]): void {
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /tmode {RID}');
      return;
    }
    const rid = args[1];
    const success = this.protocolHandler.toggleRoomMode(rid);
    if (success) {
      const room = this.roomManager.getRoom(rid);
      this.logger.command(`[控制台] 房间 ${rid} 模式已切换为 ${room?.cycle ? '循环' : '普通'}。`);
    } else {
      this.logger.warn(`[控制台] 找不到房间 ${rid}`);
    }
  }

  private sendSystemMessage(args: string[]): void {
    if (args.length < 3) {
      this.logger.warn('[控制台] 用法: /smsg {RID} {内容}');
      return;
    }
    const rid = args[1];
    const content = args[2];
    this.protocolHandler.sendServerMessage(rid, "【系统】" + content);
    this.logger.command(`[控制台] 消息已发送至房间 ${rid}`);
  }

  private bulkAction(args: string[]): void {
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /bulk {动作} {目标:all|#ID} [值]');
      return;
    }
    const action = args[1];
    const target = args[2] || 'all';
    const value = args[3];

    const targetIds = (target !== 'all' && target.startsWith('#')) 
        ? target.substring(1).split(',').map(id => id.trim()) 
        : null;

    const rooms = this.roomManager.listRooms();
    let count = 0;
    rooms.forEach(room => {
        if (targetIds && !targetIds.includes(room.id)) return;

        switch (action) {
            case 'close_all':
                this.protocolHandler.closeRoomByAdmin(room.id);
                count++;
                break;
            case 'lock_all':
                if (!room.locked) this.protocolHandler.toggleRoomLock(room.id);
                count++;
                break;
            case 'unlock_all':
                if (room.locked) this.protocolHandler.toggleRoomLock(room.id);
                count++;
                break;
            case 'set_max_players':
                if (value && !isNaN(Number(value))) {
                    this.protocolHandler.setRoomMaxPlayers(room.id, Number(value));
                    count++;
                }
                break;
        }
    });

    this.logger.command(`[控制台] 批量操作 "${action}" 已完成，影响了 ${count} 个房间。`);
  }

  private listBans(): void {
    const bans = this.banManager.getAllBans();
    let output = `[控制台] 封禁列表:
`;
    
    output += `--- 用户 ID 封禁 ---
`;
    if (bans.idBans.length === 0) output += `(空)
`;
    bans.idBans.forEach(b => {
      output += `- UID: ${b.target} | 原因: ${b.reason} | 剩余: ${this.banManager.getRemainingTimeStr(b.expiresAt)}
`;
    });

    output += `--- IP 封禁 ---
`;
    if (bans.ipBans.length === 0) output += `(空)
`;
    bans.ipBans.forEach(b => {
      output += `- IP: ${b.target} | 原因: ${b.reason} | 剩余: ${this.banManager.getRemainingTimeStr(b.expiresAt)}
`;
    });

    this.logger.command(output.trim());
  }

  private ban(args: string[]): void {
    if (args.length < 3) {
      this.logger.warn('[控制台] 用法: /ban {类型:id|ip} {目标} [时长:秒] [原因]');
      return;
    }
    const type = args[1].toLowerCase();
    const target = args[2];
    const duration = args[3] ? Number(args[3]) : null;
    const reason = args[4] || '无原因';

    if (type === 'id') {
      const uid = Number(target);
      this.banManager.banId(uid, duration, reason, this.adminName);
      this.protocolHandler.kickPlayer(uid);
      this.logger.command(`[控制台] 用户 ${uid} 已被封禁。`);
    } else if (type === 'ip') {
      this.banManager.banIp(target, duration, reason, this.adminName);
      this.protocolHandler.kickIp(target);
      this.logger.command(`[控制台] IP ${target} 已被封禁。`);
    } else {
      this.logger.warn('[控制台] 非法的封禁类型');
    }
  }

  private unban(args: string[]): void {
    if (args.length < 3) {
      this.logger.warn('[控制台] 用法: /unban {类型:id|ip} {目标}');
      return;
    }
    const type = args[1].toLowerCase();
    const target = args[2];

    let success = false;
    if (type === 'id') {
      success = this.banManager.unbanId(Number(target), this.adminName);
    } else if (type === 'ip') {
      success = this.banManager.unbanIp(target, this.adminName);
    }

    if (success) {
      this.logger.command(`[控制台] ${type.toUpperCase()} ${target} 已解封。`);
    } else {
      this.logger.warn(`[控制台] 找不到该封禁记录。`);
    }
  }

  private listLoginBlacklist(): void {
    if (!this.httpServer) {
        this.logger.warn('[控制台] Web 服务器未启用，无法管理登录黑名单。');
        return;
    }
    const list = this.httpServer.getBlacklistedIps();
    if (list.length === 0) {
        this.logger.command('[控制台] 登录黑名单为空。');
        return;
    }

    let output = '[控制台] 登录黑名单 (仅限 Web 面板登录尝试):\n';
    const now = Date.now();
    list.forEach(item => {
        const remaining = Math.max(0, Math.floor((item.expiresAt - now) / 1000));
        output += `- IP: ${item.ip} | 剩余时长: ${remaining}秒\n`;
    });
    this.logger.command(output.trim());
  }

  private blacklistIp(args: string[]): void {
    if (!this.httpServer) {
        this.logger.warn('[控制台] Web 服务器未启用，无法管理登录黑名单。');
        return;
    }
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /blip {IP} [时长:秒]');
      return;
    }
    const ip = args[1];
    const duration = args[2] ? Number(args[2]) : this.config.loginBlacklistDuration;
    if (isNaN(duration)) {
        this.logger.warn('[控制台] 非法的时长数值');
        return;
    }
    this.httpServer.blacklistIpManual(ip, duration, this.adminName);
    this.logger.command(`[控制台] 已将 IP ${ip} 加入登录黑名单，时长 ${duration}秒。`);
  }

  private unblacklistIp(args: string[]): void {
    if (!this.httpServer) {
        this.logger.warn('[控制台] Web 服务器未启用，无法管理登录黑名单。');
        return;
    }
    if (args.length < 2) {
      this.logger.warn('[控制台] 用法: /ublip {IP}');
      return;
    }
    const ip = args[1];
    const success = this.httpServer.unblacklistIpManual(ip, this.adminName);
    if (success) {
        this.logger.command(`[控制台] 已从登录黑名单中移除 IP ${ip}。`);
    } else {
        this.logger.warn(`[控制台] 在登录黑名单中找不到 IP ${ip}。`);
    }
  }

  private stopServer(): void {
    this.logger.command('[控制台] 正在关闭服务器...');
    setTimeout(() => {
        process.exit(0);
    }, 500);
  }

  private restartServer(): void {
    this.logger.command('[控制台] 正在请求重启服务器...');
    try {
        const indexPath = path.join(process.cwd(), 'src', 'index.ts');
        if (fs.existsSync(indexPath)) {
            const now = new Date();
            fs.utimesSync(indexPath, now, now);
            this.logger.command('[控制台] 已触发 nodemon 重启 (通过更新 src/index.ts 时间戳)');
        } else {
            this.logger.warn('[控制台] 找不到 src/index.ts，无法通过 nodemon 自动重启。如果是生产环境，请手动重启。');
        }
    } catch (err: any) {
        this.logger.error(`[控制台] 尝试重启失败: ${err.message}`);
    }
  }

  private reloadServerConfig(): void {
    if (this.onReload) {
        this.onReload();
    } else {
        this.logger.warn('[控制台] 此环境不支持动态重新加载配置。');
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

  private showInfo(): void {
    const uptimeMs = Date.now() - this.startTime;
    const days = Math.floor(uptimeMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((uptimeMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((uptimeMs % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((uptimeMs % (60 * 1000)) / 1000);

    const uptimeStr = `${days}天 ${hours}小时 ${minutes}分 ${seconds}秒`;

    const info = `
===== Phira 服务器信息 =====
版本: v${version}
服务器名称: ${this.config.serverName}
运行时间: ${uptimeStr}
TCP 端口: ${this.config.port}
Web 端口: ${this.config.webPort}
当前在线: ${this.protocolHandler.getSessionCount()} 人
房间数量: ${this.roomManager.count()} 个
节点 ID: ${this.config.federationNodeId || '未配置'}
联邦状态: ${this.config.federationEnabled ? '启用' : '禁用'}
API 地址: ${this.config.phiraApiUrl}
==========================
`;
    this.logger.command(info);
  }

  private handleSet(args: string[]): void {
    if (!this.onUpdateConfig) {
        this.logger.warn('[控制台] 此环境不支持动态设置配置。');
        return;
    }
    if (args.length < 3) {
        this.logger.warn('[控制台] 用法: /set "{env变量}" "{值}"');
        return;
    }
    const key = args[1];
    const value = args[2];
    
    this.onUpdateConfig(key, value);
    this.logger.command(`[控制台] 配置项 ${key} 已更新为: ${value}，并已重新加载生效。`);
  }

  private handleLog(args: string[]): void {
    if (!this.onSetLogLevels) {
        this.logger.warn('[控制台] 此环境不支持动态调整日志等级。');
        return;
    }
    if (args.length < 2) {
        this.logger.warn('[控制台] 用法: /log 参数1|参数2|... (例如: /log warn|error)');
        return;
    }
    
    // Split the first argument by | or , to support /log warn|error
    const input = args[1];
    const levels = input.split(/[|,]/);
    
    this.onSetLogLevels(levels);
  }
}
