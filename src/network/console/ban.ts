import { ConsoleCtx } from './context';

export function listBans(ctx: ConsoleCtx, _args: string[]): void {
  const bans = ctx.banManager.getAllBans();
  let output = `[控制台] 封禁列表:\n`;
  output += `--- 用户 ID 封禁 ---\n`;
  if (bans.idBans.length === 0) output += `(空)\n`;
  bans.idBans.forEach((b) => {
    output += `- UID: ${b.target} | 原因: ${b.reason} | 剩余: ${ctx.banManager.getRemainingTimeStr(b.expiresAt)}\n`;
  });
  output += `--- IP 封禁 ---\n`;
  if (bans.ipBans.length === 0) output += `(空)\n`;
  bans.ipBans.forEach((b) => {
    output += `- IP: ${b.target} | 原因: ${b.reason} | 剩余: ${ctx.banManager.getRemainingTimeStr(b.expiresAt)}\n`;
  });
  ctx.logger.command(output.trim());
}

export function addBan(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 3) {
    ctx.logger.warn('[控制台] 用法: /ban {类型:id|ip} {目标} [时长:秒] [原因]');
    return;
  }
  const type = args[1].toLowerCase();
  const target = args[2];
  const duration = args[3] ? Number(args[3]) : null;
  const reason = args[4] || '无原因';
  if (type === 'id') {
    const uid = Number(target);
    ctx.banManager.banId(uid, duration, reason, ctx.adminName);
    ctx.protocolHandler.kickPlayer(uid);
    ctx.logger.command(`[控制台] 用户 ${uid} 已被封禁。`);
  } else if (type === 'ip') {
    ctx.banManager.banIp(target, duration, reason, ctx.adminName);
    ctx.protocolHandler.kickIp(target);
    ctx.logger.command(`[控制台] IP ${target} 已被封禁。`);
  } else {
    ctx.logger.warn('[控制台] 非法的封禁类型');
  }
}

export function unban(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 3) {
    ctx.logger.warn('[控制台] 用法: /unban {类型:id|ip} {目标}');
    return;
  }
  const type = args[1].toLowerCase();
  const target = args[2];
  let success = false;
  if (type === 'id') {
    success = ctx.banManager.unbanId(Number(target), ctx.adminName);
  } else if (type === 'ip') {
    success = ctx.banManager.unbanIp(target, ctx.adminName);
  }
  if (success) {
    ctx.logger.command(`[控制台] ${type.toUpperCase()} ${target} 已解封。`);
  } else {
    ctx.logger.warn(`[控制台] 找不到该封禁记录。`);
  }
}

export function listLoginBlacklist(ctx: ConsoleCtx, _args: string[]): void {
  if (!ctx.httpServer) {
    ctx.logger.warn('[控制台] Web 服务器未启用，无法管理登录黑名单。');
    return;
  }
  const list = ctx.httpServer.getBlacklistedIps();
  if (list.length === 0) {
    ctx.logger.command('[控制台] 登录黑名单为空。');
    return;
  }
  let output = '[控制台] 登录黑名单 (仅限 Web 面板登录尝试):\n';
  const now = Date.now();
  list.forEach((item) => {
    const remaining = Math.max(0, Math.floor((item.expiresAt - now) / 1000));
    output += `- IP: ${item.ip} | 剩余时长: ${remaining}秒\n`;
  });
  ctx.logger.command(output.trim());
}

export function blacklistIp(ctx: ConsoleCtx, args: string[]): void {
  if (!ctx.httpServer) {
    ctx.logger.warn('[控制台] Web 服务器未启用，无法管理登录黑名单。');
    return;
  }
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /blip {IP} [时长:秒]');
    return;
  }
  const ip = args[1];
  const duration = args[2] ? Number(args[2]) : (ctx.config.loginBlacklistDuration ?? 600);
  if (isNaN(duration)) {
    ctx.logger.warn('[控制台] 非法的时长数值');
    return;
  }
  ctx.httpServer.blacklistIpManual(ip, duration, ctx.adminName);
  ctx.logger.command(`[控制台] 已将 IP ${ip} 加入登录黑名单，时长 ${duration}秒。`);
}

export function unblacklistIp(ctx: ConsoleCtx, args: string[]): void {
  if (!ctx.httpServer) {
    ctx.logger.warn('[控制台] Web 服务器未启用，无法管理登录黑名单。');
    return;
  }
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /ublip {IP}');
    return;
  }
  const ip = args[1];
  const success = ctx.httpServer.unblacklistIpManual(ip, ctx.adminName);
  if (success) {
    ctx.logger.command(`[控制台] 已从登录黑名单中移除 IP ${ip}。`);
  } else {
    ctx.logger.warn(`[控制台] 在登录黑名单中找不到 IP ${ip}。`);
  }
}
