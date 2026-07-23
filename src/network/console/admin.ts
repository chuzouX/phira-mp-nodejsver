import { ConsoleCtx } from './context';
import * as fs from 'fs';
import * as path from 'path';
import { version } from '../../../package.json';

export async function handleOp(ctx: ConsoleCtx, args: string[], isAdmin: boolean): Promise<void> {
  if (!ctx.setAdminStatus) {
    ctx.logger.warn('[控制台] 此环境不支持动态设置管理员。');
    return;
  }
  if (args.length < 2) {
    ctx.logger.warn(`[控制台] 用法: ${isAdmin ? '/op' : '/deop'} {phira_id}`);
    return;
  }
  const phiraId = Number(args[1]);
  if (isNaN(phiraId)) {
    ctx.logger.warn('[控制台] 非法的 Phira ID');
    return;
  }
  const userName = await ctx.setAdminStatus(phiraId, isAdmin);
  const actionStr = isAdmin ? '已设置为管理员' : '已移除管理员权限';
  ctx.logger.command(`[控制台] ${userName}[${phiraId}] ${actionStr}`);
}

export function showInfo(ctx: ConsoleCtx, _args: string[]): void {
  const uptimeMs = Date.now() - ctx.startTime;
  const days = Math.floor(uptimeMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((uptimeMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((uptimeMs % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((uptimeMs % (60 * 1000)) / 1000);
  const uptimeStr = `${days}天 ${hours}小时 ${minutes}分 ${seconds}秒`;
  const info = `
===== Phira 服务器信息 =====
版本: v${version}
服务器名称: ${ctx.config.serverName}
运行时间: ${uptimeStr}
TCP 端口: ${ctx.config.port}
Web 端口: ${ctx.config.webPort}
当前在线: ${ctx.protocolHandler.getSessionCount()} 人
房间数量: ${ctx.roomManager.count()} 个
API 地址: ${ctx.config.phiraApiUrl}
==========================
`;
  ctx.logger.command(info);
}

export function handleSet(ctx: ConsoleCtx, args: string[]): void {
  if (!ctx.onUpdateConfig) {
    ctx.logger.warn('[控制台] 此环境不支持动态设置配置。');
    return;
  }
  if (args.length < 3) {
    ctx.logger.warn('[控制台] 用法: /set "{env变量}" "{值}"');
    return;
  }
  const key = args[1];
  const value = args[2];
  if (ctx.onUpdateConfig) ctx.onUpdateConfig(key, value);
  ctx.logger.command(`[控制台] 配置项 ${key} 已更新为: ${value}，并已重新加载生效。`);
}

export function handleLog(ctx: ConsoleCtx, args: string[]): void {
  if (!ctx.onSetLogLevels) {
    ctx.logger.warn('[控制台] 此环境不支持动态调整日志等级。');
    return;
  }
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /log 参数1|参数2|... (例如: /log warn|error)');
    return;
  }
  const input = args[1];
  const levels = input.split(/[|,]/);
  if (ctx.onSetLogLevels) ctx.onSetLogLevels(levels);
}

export function stopServer(ctx: ConsoleCtx, _args: string[]): void {
  ctx.logger.command('[控制台] 正在关闭服务器...');
  setTimeout(() => {
    const isNodemon = process.env.NODEMON === 'true';
    if (isNodemon && process.ppid) {
      try {
        process.kill(process.ppid, 'SIGTERM');
      } catch (e: any) {
        ctx.logger.warn(`[控制台] 终止 nodemon 进程失败: ${e?.message || e}`);
      }
    }
    process.exit(0);
  }, 500);
}

export function restartServer(ctx: ConsoleCtx, _args: string[]): void {
  ctx.logger.command('[控制台] 正在请求重启服务器...');
  try {
    if ((process as any).pkg) {
      const exePath = process.execPath;
      const args = process.argv.slice(1);
      ctx.logger.command(`[控制台] 正在重启: ${exePath}`);
      ctx.logger.command('[控制台] 即将关闭当前进程并启动新实例...');
      const { spawn } = require('child_process');
      spawn(exePath, args, { stdio: 'inherit', detached: false });
      setTimeout(() => process.exit(0), 1000);
      return;
    }
    const indexPath = path.join(process.cwd(), 'src', 'index.ts');
    if (fs.existsSync(indexPath)) {
      const now = new Date();
      fs.utimesSync(indexPath, now, now);
      ctx.logger.command('[控制台] 已触发 nodemon 重启 (通过更新 src/index.ts 时间戳)');
    } else {
      ctx.logger.warn('[控制台] 无法自动重启，请手动重启服务。');
    }
  } catch (err: any) {
    ctx.logger.error(`[控制台] 尝试重启失败: ${err.message}`);
  }
}

export function reloadServerConfig(ctx: ConsoleCtx, _args: string[]): void {
  if (ctx.onReload) {
    ctx.onReload();
  } else {
    ctx.logger.warn('[控制台] 此环境不支持动态重新加载配置。');
  }
}
