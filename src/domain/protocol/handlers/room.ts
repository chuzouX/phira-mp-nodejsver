import { HandlerCtx } from './context';
import { ServerCommandType, UserInfo, JoinRoomResponse } from '../Commands';

export function handleCreateRoom(ctx: HandlerCtx, connectionId: string, roomId: string, sendResponse: (response: any) => void): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CreateRoom, result: { ok: false, error: '未验证' } });
    return;
  }
  const existingRoom = ctx.roomManager.getRoomByUserId(session.userId);
  if (existingRoom) {
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CreateRoom, result: { ok: false, error: '你已经在房间了哦喵' } });
    return;
  }
  if (ctx.federationManager && ctx.federationManager.isRemoteRoom(roomId)) {
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CreateRoom, result: { ok: false, error: '房间号已被联邦服务器占用' } });
    return;
  }
  ctx.pluginManager?.emit('room:beforeCreate', { connectionId, userId: session.userId, roomId });
  try {
    const room = ctx.roomManager.createRoom({ id: roomId, name: roomId, ownerId: session.userId, ownerInfo: session.userInfo, connectionId });
    ctx.logger.mark(`"${session.userInfo.name}" 创建房间 "${room.id}"`, { userId: session.userId });
    ctx.pluginManager?.emit('room:create', { room, user: session.userInfo, connectionId });
    ctx.broadcastToRoom(room, { type: ServerCommandType.OnJoinRoom, user: session.userInfo });
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CreateRoom, result: { ok: true, value: undefined } });
    setTimeout(() => {
      ctx.broadcastToRoom(room, { type: ServerCommandType.OnJoinRoom, user: { id: -1, name: ctx.serverName, avatar: ctx.defaultAvatar, monitor: true } });
      ctx.broadcastMessage(room, { type: 'CreateRoom', user: session.userId });
      const isPrivate = roomId.startsWith('sm');
      const roomTypeText = isPrivate ? '私密' : '公开';
      ctx.broadcastMessage(room, { type: 'Chat', user: -1, content: `Hi,${session.userInfo.name}！此房间为${roomTypeText}房间，房间号为${roomId}，祝您玩的开心！` });
      if (ctx.federationManager?.getConfig?.()?.enabled) {
        ctx.federationManager.broadcastRoomEvent('room_created', room.id, ctx.federationManager.buildLocalRoomInfo(room)).catch(() => {});
      }
    }, 250);
  } catch (error) {
    const errorMessage = (error as Error).message;
    ctx.logger.error(`创建房间失败: ${connectionId} (用户: ${session.userId}, 房间: ${roomId}, 错误: ${errorMessage})`, { userId: session.userId });
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CreateRoom, result: { ok: false, error: errorMessage } });
  }
}

export function handleJoinRoom(ctx: HandlerCtx, connectionId: string, roomId: string, monitor: boolean, sendResponse: (response: any) => void): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.JoinRoom, result: { ok: false, error: '未验证' } });
    return;
  }
  const existingRoom = ctx.roomManager.getRoomByUserId(session.userId);
  if (existingRoom) {
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.JoinRoom, result: { ok: false, error: '已经在房间里哦喵' } });
    return;
  }
  const room = ctx.roomManager.getRoom(roomId);
  if (!room) {
    if (ctx.federationManager?.isRemoteRoom(roomId)) {
      ctx.logger.info(`[联邦] 玩家 ${session.userId} 尝试加入远程房间 ${roomId}`, { userId: session.userId });
      ctx.federationManager.proxyJoinRoom(session.userId, { ...session.userInfo, monitor }, roomId, monitor, sendResponse);
      return;
    }
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.JoinRoom, result: { ok: false, error: '找不到你想要的房间辣' } });
    return;
  }
  if (room.locked) {
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.JoinRoom, result: { ok: false, error: '呜哇！房间锁住了哦，进不去' } });
    return;
  }
  if (room.state.type !== 'SelectChart' && room.state.type !== 'Playing') {
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.JoinRoom, result: { ok: false, error: '他们正在游戏中哦' } });
    return;
  }
  const userInfo = { ...session.userInfo, monitor };
  const success = ctx.roomManager.addPlayerToRoom(roomId, session.userId, userInfo, connectionId);
  if (success) {
    ctx.logger.info(`玩家 "${session.userInfo.name}" (ID: ${session.userId}) 加入了房间 "${roomId}"`, { userId: session.userId });
    if (monitor && !room.live) { room.live = true; ctx.logger.info(`房间 "${roomId}" 已进入 live 模式`, { userId: session.userId }); }
    let joinAborted = false;
    if (room.state.type === 'Playing') {
      const joinedPlayer = room.players.get(session.userId);
      if (joinedPlayer) { joinedPlayer.isReady = false; joinedPlayer.isFinished = true; joinedPlayer.score = null; joinAborted = true;
        const userId = session.userId;
        setTimeout(() => { ctx.sendCommandToUser(userId, { type: ServerCommandType.Message as any, message: { type: 'Chat', user: -1, content: '此房间正在游戏中，请等待游戏结束' } }); }, 2000);
      }
    }
    ctx.broadcastToRoom(room, { type: ServerCommandType.OnJoinRoom, user: userInfo });
    ctx.broadcastMessage(room, { type: 'JoinRoom', user: session.userId, name: session.userInfo.name });
    ctx.pluginManager?.emit('room:join', { room, user: userInfo, connectionId });
    const usersInRoom = Array.from(room.players.values()).map((p) => p.user);
    const serverUser: UserInfo = { id: -1, name: ctx.serverName, avatar: ctx.defaultAvatar, monitor: true };
    const isSpectator = room.state.type === 'Playing' && joinAborted;
    const joinResponse: JoinRoomResponse = { state: isSpectator ? { type: 'SelectChart' as const, chartId: room.selectedChart?.id ?? null } : room.state, users: [...usersInRoom, serverUser], live: room.live };
    ctx.logger.debug(`已向客户端 ${connectionId} 发送加入房间响应`, { userId: session.userId });
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.JoinRoom, result: { ok: true, value: joinResponse } });
  } else {
    ctx.respond(connectionId, sendResponse, { type: ServerCommandType.JoinRoom, result: { ok: false, error: '杂鱼~你要加入的房间满了或杂鱼无权进入' } });
  }
}

export function handleLeaveRoom(ctx: HandlerCtx, connectionId: string, sendResponse: (response: any) => void): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) { ctx.respond(connectionId, sendResponse, { type: ServerCommandType.LeaveRoom, result: { ok: false, error: '未验证' } }); return; }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) { ctx.respond(connectionId, sendResponse, { type: ServerCommandType.LeaveRoom, result: { ok: false, error: '房间不存在喵' } }); return; }
  ctx.logger.info(`玩家 "${session.userInfo.name}" (ID: ${session.userId}) 离开了房间 "${room.id}"`, { userId: session.userId });
  const wasHost = room.ownerId === session.userId;
  const wasPlaying = room.state.type === 'Playing';
  ctx.broadcastMessage(room, { type: 'LeaveRoom', user: session.userId, name: session.userInfo.name });
  ctx.roomManager.removePlayerFromRoom(room.id, session.userId);
  ctx.pluginManager?.emit('room:leave', { roomId: room.id, userId: session.userId, userName: session.userInfo.name, connectionId });
  const updatedRoom = ctx.roomManager.getRoom(room.id);
  if (updatedRoom) { updatedRoom.live = Array.from(updatedRoom.players.values()).some((playerInfo) => playerInfo.user.monitor); }
  if (ctx.federationManager?.getConfig?.()?.enabled) {
    if (!updatedRoom) { ctx.federationManager.broadcastRoomEvent('room_deleted', room.id, null).catch(() => {}); }
    else { ctx.federationManager.broadcastRoomEvent('room_updated', room.id, ctx.federationManager.buildLocalRoomInfo(updatedRoom)).catch(() => {}); }
  }
  if (updatedRoom && wasHost && updatedRoom.ownerId !== session.userId) {
    ctx.broadcastMessage(updatedRoom, { type: 'NewHost', user: updatedRoom.ownerId });
    for (const playerInfo of updatedRoom.players.values()) {
      const isHost = playerInfo.user.id === updatedRoom.ownerId;
      const callback = ctx.broadcastCallbacks.get(playerInfo.connectionId);
      if (callback) { callback({ type: ServerCommandType.ChangeHost, isHost }); }
    }
  }
  if (updatedRoom && wasPlaying) { ctx.checkGameEnd(updatedRoom); }
  ctx.respond(connectionId, sendResponse, { type: ServerCommandType.LeaveRoom, result: { ok: true, value: undefined } });
}

export function handleLockRoom(ctx: HandlerCtx, connectionId: string, lock: boolean, sendResponse: (response: any) => void): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) { ctx.respond(connectionId, sendResponse, { type: ServerCommandType.LockRoom, result: { ok: false, error: '未验证' } }); return; }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) { ctx.respond(connectionId, sendResponse, { type: ServerCommandType.LockRoom, result: { ok: false, error: '房间不存在喵' } }); return; }
  if (room.ownerId !== session.userId) { ctx.respond(connectionId, sendResponse, { type: ServerCommandType.LockRoom, result: { ok: false, error: 'baka!你不是房主喵' } }); return; }
  ctx.logger.info(`玩家 "${session.userInfo.name}" (ID: ${session.userId}) 将房间 "${room.id}" 锁定模式修改为: ${lock}`, { userId: session.userId });
  ctx.roomManager.setRoomLocked(room.id, lock);
  ctx.broadcastMessage(room, { type: 'LockRoom', lock });
  ctx.respond(connectionId, sendResponse, { type: ServerCommandType.LockRoom, result: { ok: true, value: undefined } });
}

export function handleCycleRoom(ctx: HandlerCtx, connectionId: string, cycle: boolean, sendResponse: (response: any) => void): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) { ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CycleRoom, result: { ok: false, error: '未验证' } }); return; }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) { ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CycleRoom, result: { ok: false, error: '房间不存在喵' } }); return; }
  if (room.ownerId !== session.userId) { ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CycleRoom, result: { ok: false, error: 'baka!你不是房主喵' } }); return; }
  ctx.logger.info(`玩家 "${session.userInfo.name}" (ID: ${session.userId}) 将房间 "${room.id}" 循环状态切换为: ${cycle}`, { userId: session.userId });
  ctx.roomManager.setRoomCycle(room.id, cycle);
  ctx.broadcastMessage(room, { type: 'CycleRoom', cycle });
  ctx.respond(connectionId, sendResponse, { type: ServerCommandType.CycleRoom, result: { ok: true, value: undefined } });
}
