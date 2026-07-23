import { ConsoleCtx } from './context';

export function listRooms(ctx: ConsoleCtx, _args: string[]): void {
  const rooms = ctx.roomManager.listRooms();
  if (rooms.length === 0) {
    ctx.logger.command('[控制台] 当前没有任何房间。');
    return;
  }
  let output = `[控制台] 当前共有 ${rooms.length} 个房间:\n`;
  rooms.forEach((room) => {
    output += `- [${room.id}] ${room.name} | 房主: ${room.ownerId} | 人数: ${room.players.size}/${room.maxPlayers} | 状态: ${room.state.type}${room.locked ? ' (锁定)' : ''}\n`;
  });
  ctx.logger.command(output.trim());
}

export function listPlayers(ctx: ConsoleCtx, _args: string[]): void {
  const sessions = ctx.protocolHandler.getAllSessions();
  if (sessions.length === 0) {
    ctx.logger.command('[控制台] 当前没有在线玩家。');
    return;
  }
  let output = `[控制台] 当前共有 ${sessions.length} 名在线玩家:\n`;
  sessions.forEach((p) => {
    output += `- ${p.name} (UID: ${p.id}) | IP: ${p.ip} | 房间: ${p.roomId || '大厅'}\n`;
  });
  ctx.logger.command(output.trim());
}

export function broadcast(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /broadcast "内容" [#ID]');
    return;
  }
  const content = args[1];
  const target = args[2];
  const targetIds =
    target && target.startsWith('#')
      ? target
          .substring(1)
          .split(',')
          .map((id) => id.trim())
      : null;
  const rooms = ctx.roomManager.listRooms();
  let sentCount = 0;
  rooms.forEach((room) => {
    if (!targetIds || targetIds.includes(room.id)) {
      ctx.protocolHandler.sendServerMessage(room.id, '【全服播报】' + content);
      sentCount++;
    }
  });
  ctx.logger.command(`[控制台] 播报已发送至 ${sentCount} 个房间。`);
}

export function kickPlayer(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /kick {UID}');
    return;
  }
  const uid = Number(args[1]);
  if (isNaN(uid)) {
    ctx.logger.warn('[控制台] 非法的用户 ID');
    return;
  }
  const success = ctx.protocolHandler.kickPlayer(uid);
  if (success) {
    ctx.logger.command(`[控制台] 已踢出用户 ${uid}`);
  } else {
    ctx.logger.warn(`[控制台] 无法踢出用户 ${uid}，用户可能不在线。`);
  }
}

export function forceStart(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /fstart {RID}');
    return;
  }
  const rid = args[1];
  const success = ctx.protocolHandler.forceStartGame(rid);
  if (success) {
    ctx.logger.command(`[控制台] 房间 ${rid} 已强制开始对局。`);
  } else {
    ctx.logger.warn(`[控制台] 无法开始房间 ${rid} 的对局，请检查房间是否存在或状态是否正确。`);
  }
}

export function lockRoom(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /lock {RID}');
    return;
  }
  const rid = args[1];
  const success = ctx.protocolHandler.toggleRoomLock(rid);
  if (success) {
    const room = ctx.roomManager.getRoom(rid);
    ctx.logger.command(`[控制台] 房间 ${rid} 现在已${room?.locked ? '锁定' : '解锁'}。`);
  } else {
    ctx.logger.warn(`[控制台] 找不到房间 ${rid}`);
  }
}

export function setMaxPlayers(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 3) {
    ctx.logger.warn('[控制台] 用法: /maxp {RID} {人数}');
    return;
  }
  const rid = args[1];
  const count = Number(args[2]);
  if (isNaN(count)) {
    ctx.logger.warn('[控制台] 非法的人数限制');
    return;
  }
  const success = ctx.protocolHandler.setRoomMaxPlayers(rid, count);
  if (success) {
    ctx.logger.command(`[控制台] 房间 ${rid} 最大人数已修改为 ${count}`);
  } else {
    ctx.logger.warn(`[控制台] 找不到房间 ${rid}`);
  }
}

export function closeRoom(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /close {RID}');
    return;
  }
  const rid = args[1];
  const success = ctx.protocolHandler.closeRoomByAdmin(rid);
  if (success) {
    ctx.logger.command(`[控制台] 房间 ${rid} 已关闭。`);
  } else {
    ctx.logger.warn(`[控制台] 找不到房间 ${rid}`);
  }
}

export function toggleMode(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /tmode {RID}');
    return;
  }
  const rid = args[1];
  const success = ctx.protocolHandler.toggleRoomMode(rid);
  if (success) {
    const room = ctx.roomManager.getRoom(rid);
    ctx.logger.command(`[控制台] 房间 ${rid} 模式已切换为 ${room?.cycle ? '循环' : '普通'}。`);
  } else {
    ctx.logger.warn(`[控制台] 找不到房间 ${rid}`);
  }
}

export function sendSystemMessage(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 3) {
    ctx.logger.warn('[控制台] 用法: /smsg {RID} {内容}');
    return;
  }
  const rid = args[1];
  const content = args[2];
  ctx.protocolHandler.sendServerMessage(rid, '【系统】' + content);
  ctx.logger.command(`[控制台] 消息已发送至房间 ${rid}`);
}

export function bulkAction(ctx: ConsoleCtx, args: string[]): void {
  if (args.length < 2) {
    ctx.logger.warn('[控制台] 用法: /bulk {动作} {目标:all|#ID} [值]');
    return;
  }
  const action = args[1];
  const target = args[2] || 'all';
  const value = args[3];
  const targetIds =
    target !== 'all' && target.startsWith('#')
      ? target
          .substring(1)
          .split(',')
          .map((id) => id.trim())
      : null;
  const rooms = ctx.roomManager.listRooms();
  let count = 0;
  rooms.forEach((room) => {
    if (targetIds && !targetIds.includes(room.id)) return;
    switch (action) {
      case 'close_all':
        ctx.protocolHandler.closeRoomByAdmin(room.id);
        count++;
        break;
      case 'lock_all':
        if (!room.locked) ctx.protocolHandler.toggleRoomLock(room.id);
        count++;
        break;
      case 'unlock_all':
        if (room.locked) ctx.protocolHandler.toggleRoomLock(room.id);
        count++;
        break;
      case 'set_max_players':
        if (value && !isNaN(Number(value))) {
          ctx.protocolHandler.setRoomMaxPlayers(room.id, Number(value));
          count++;
        }
        break;
    }
  });
  ctx.logger.command(`[控制台] 批量操作 "${action}" 已完成，影响了 ${count} 个房间。`);
}
