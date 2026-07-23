import { HandlerCtx } from './context';
import { ServerCommandType, ClientCommandType } from '../Commands';
import { Room } from '../../rooms/RoomManager';

export function handleSelectChart(
  ctx: HandlerCtx,
  connectionId: string,
  chartId: number,
  sendResponse: (response: any) => void,
): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.SelectChart,
      result: { ok: false, error: '未验证' },
    });
    return;
  }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.SelectChart,
      result: { ok: false, error: '房间不存在喵' },
    });
    return;
  }
  if (room.state.type !== 'SelectChart') {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.SelectChart,
      result: { ok: false, error: '非法的状态' },
    });
    return;
  }
  if (room.ownerId !== session.userId) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.SelectChart,
      result: { ok: false, error: 'baka!你不是房主喵' },
    });
    return;
  }
  ctx.logger.debug(
    `玩家 "${session.userInfo.name}" (ID: ${session.userId}) 正在房间 "${room.id}" 获取谱面信息: ${chartId}`,
    { userId: session.userId },
  );
  const fetchAndUpdate = async (): Promise<void> => {
    try {
      const chart = await ctx.fetchChartInfo(chartId);
      ctx.logger.mark(
        `"${session.userInfo.name}"（用户ID：${session.userId}）在房间 "${room.id}" 选择了 "${chart.name}"`,
        { userId: session.userId },
      );
      ctx.roomManager.setRoomChart(room.id, chart);
      ctx.roomManager.setRoomState(room.id, { type: 'SelectChart', chartId: chart.id });
      ctx.roomManager.setSoloConfirmPending(room.id, false);
      ctx.broadcastMessage(room, {
        type: 'SelectChart',
        user: session.userId,
        name: chart.name,
        id: chart.id,
      });
      ctx.broadcastToRoom(room, {
        type: ServerCommandType.ChangeState,
        state: { type: 'SelectChart', chartId: chart.id },
      });
      ctx.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        result: { ok: true, value: undefined },
      });
      if (ctx.federationManager?.getConfig?.()?.enabled) {
        ctx.federationManager
          .broadcastRoomEvent(
            'chart_selected',
            room.id,
            ctx.federationManager.buildLocalRoomInfo(room),
          )
          .catch(() => {});
      }
      ctx.pluginManager?.emit('protocol:afterHandle', {
        connectionId,
        command: { type: ClientCommandType.SelectChart, id: chartId },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'failed to fetch chart';
      ctx.logger.error(
        `获取谱面信息失败: ${connectionId} (谱面: ${chartId}, 错误: ${errorMessage})`,
        { userId: session.userId },
      );
      ctx.respond(connectionId, sendResponse, {
        type: ServerCommandType.SelectChart,
        result: { ok: false, error: errorMessage },
      });
    }
  };
  void fetchAndUpdate();
}

export function handleRequestStart(
  ctx: HandlerCtx,
  connectionId: string,
  sendResponse: (response: any) => void,
): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.RequestStart,
      result: { ok: false, error: '未验证' },
    });
    return;
  }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.RequestStart,
      result: { ok: false, error: '房间不存在喵' },
    });
    return;
  }
  if (room.state.type !== 'SelectChart') {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.RequestStart,
      result: { ok: false, error: '非法的状态' },
    });
    return;
  }
  if (room.ownerId !== session.userId) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.RequestStart,
      result: { ok: false, error: 'baka!你不是房主喵' },
    });
    return;
  }
  ctx.logger.mark(`"${session.userInfo.name}" 在房间 "${room.id}" 请求开始对局`, {
    userId: session.userId,
  });
  if (room.players.size > 1) {
    for (const playerInfo of room.players.values()) {
      playerInfo.isReady = playerInfo.user.id === room.ownerId;
      playerInfo.isFinished = false;
      playerInfo.score = null;
    }
    ctx.roomManager.setRoomState(room.id, { type: 'WaitingForReady' });
    ctx.pluginManager?.emit('room:requestStart', { room, triggeredBy: session.userId });
    ctx.broadcastMessage(room, { type: 'GameStart', user: session.userId });
    ctx.broadcastToRoom(room, {
      type: ServerCommandType.ChangeState,
      state: { type: 'WaitingForReady' },
    });
    ctx.broadcastMessage(room, {
      type: 'Chat',
      user: -1,
      content: '房主已选择开始游戏，请在60秒内准备，不准备视为放弃',
    });
    const timer = setTimeout(() => {
      ctx.roomTimers.delete(room.id);
      if (room.state.type !== 'WaitingForReady') return;
      for (const playerInfo of room.players.values()) {
        if (playerInfo.user.id === room.ownerId) {
          playerInfo.isReady = true;
        } else if (!playerInfo.isReady) {
          playerInfo.isReady = false;
          playerInfo.isFinished = true;
          playerInfo.score = null;
        } else {
          playerInfo.isFinished = false;
          playerInfo.score = null;
        }
      }
      ctx.roomManager.setRoomState(room.id, { type: 'Playing' });
      ctx.broadcastToActivePlayers(room, {
        type: ServerCommandType.ChangeState as any,
        state: { type: 'Playing' },
      } as any);
      for (const playerInfo of room.players.values()) {
        if (playerInfo.isFinished) {
          const cb = ctx.broadcastCallbacks.get(playerInfo.connectionId);
          if (cb) {
            cb({
              type: ServerCommandType.Message as any,
              message: {
                type: 'Chat',
                user: -1,
                content: '60秒计时结束，你未准备，已被视为放弃本局',
              },
            } as any);
          }
        }
      }
      ctx.pluginManager?.emit('room:gameStart', {
        room,
        triggeredBy: session.userId,
        mode: 'force',
      });
    }, 60000);
    ctx.roomTimers.set(room.id, timer);
  } else {
    if (!ctx.roomManager.isSoloConfirmPending(room.id)) {
      ctx.roomManager.setSoloConfirmPending(room.id, true);
      ctx.logger.info(`房间 "${room.id}" 等待单人房确认开始`, { userId: session.userId });
      ctx.broadcastMessage(room, {
        type: 'Chat',
        user: -1,
        content: '房间只有你一个人 如果确定开始游戏请再次点击开始游戏',
      });
    } else {
      ctx.roomManager.setSoloConfirmPending(room.id, false);
      ctx.logger.info(`房间 "${room.id}" 对局开始，玩家：${session.userId}`, {
        userId: session.userId,
      });
      for (const playerInfo of room.players.values()) {
        playerInfo.isReady = false;
        playerInfo.isFinished = false;
        playerInfo.score = null;
      }
      ctx.roomManager.setRoomState(room.id, { type: 'Playing' });
      ctx.broadcastMessage(room, { type: 'StartPlaying' });
      ctx.broadcastToRoom(room, {
        type: ServerCommandType.ChangeState,
        state: { type: 'Playing' },
      });
      ctx.pluginManager?.emit('room:gameStart', {
        room,
        triggeredBy: session.userId,
        mode: 'solo-confirm',
      });
    }
  }
  ctx.respond(connectionId, sendResponse, {
    type: ServerCommandType.RequestStart,
    result: { ok: true, value: undefined },
  });
  if (ctx.federationManager?.getConfig?.()?.enabled) {
    ctx.federationManager
      .broadcastRoomEvent('game_started', room.id, ctx.federationManager.buildLocalRoomInfo(room))
      .catch(() => {});
  }
}

export function handleReady(
  ctx: HandlerCtx,
  connectionId: string,
  sendResponse: (response: any) => void,
): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Ready,
      result: { ok: false, error: '未验证' },
    });
    return;
  }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Ready,
      result: { ok: false, error: '房间不存在喵' },
    });
    return;
  }
  if (room.state.type !== 'WaitingForReady') {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Ready,
      result: { ok: false, error: 'invalid state' },
    });
    return;
  }
  const player = room.players.get(session.userId);
  if (!player) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Ready,
      result: { ok: false, error: '杂鱼~你没在房间喵' },
    });
    return;
  }
  if (player.isReady) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Ready,
      result: { ok: false, error: '你已经准备了喵' },
    });
    return;
  }
  ctx.logger.info(
    `玩家 "${session.userInfo.name}" (ID: ${session.userId}) 在房间 "${room.id}" 已准备`,
    { userId: session.userId },
  );
  ctx.roomManager.setPlayerReady(room.id, session.userId, true);
  ctx.broadcastMessage(room, { type: 'Ready', user: session.userId });
  const allReady = Array.from(room.players.values())
    .filter((p) => p.user.id !== room.ownerId)
    .every((p) => p.isReady);
  if (allReady) {
    const timer = ctx.roomTimers.get(room.id);
    if (timer) {
      clearTimeout(timer);
      ctx.roomTimers.delete(room.id);
    }
    ctx.logger.info(
      `房间 "${room.id}" 对局开始，玩家：${Array.from(room.players.keys()).join(', ')}`,
      { userId: session.userId },
    );
    for (const playerInfo of room.players.values()) {
      playerInfo.isFinished = false;
      playerInfo.score = null;
    }
    ctx.roomManager.setRoomState(room.id, { type: 'Playing' });
    ctx.broadcastMessage(room, { type: 'StartPlaying' });
    ctx.broadcastToRoom(room, { type: ServerCommandType.ChangeState, state: { type: 'Playing' } });
    ctx.pluginManager?.emit('room:gameStart', { room, triggeredBy: session.userId, mode: 'ready' });
  }
  ctx.respond(connectionId, sendResponse, {
    type: ServerCommandType.Ready,
    result: { ok: true, value: undefined },
  });
}

export function handleCancelReady(
  ctx: HandlerCtx,
  connectionId: string,
  sendResponse: (response: any) => void,
): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.CancelReady,
      result: { ok: false, error: '未验证' },
    });
    return;
  }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.CancelReady,
      result: { ok: false, error: '房间不存在喵' },
    });
    return;
  }
  if (room.state.type !== 'WaitingForReady') {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.CancelReady,
      result: { ok: false, error: '非法的状态' },
    });
    return;
  }
  const player = room.players.get(session.userId);
  if (!player) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.CancelReady,
      result: { ok: false, error: '杂鱼~你没在房间喵' },
    });
    return;
  }
  if (room.ownerId !== session.userId && !player.isReady) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.CancelReady,
      result: { ok: false, error: '你还未准备哦喵' },
    });
    return;
  }
  ctx.logger.debug(
    `玩家 "${session.userInfo.name}" (ID: ${session.userId}) 在房间 "${room.id}" 取消了准备`,
    { userId: session.userId },
  );
  ctx.roomManager.setPlayerReady(room.id, session.userId, false);
  player.isFinished = false;
  player.score = null;
  if (room.ownerId === session.userId) {
    const timer = ctx.roomTimers.get(room.id);
    if (timer) {
      clearTimeout(timer);
      ctx.roomTimers.delete(room.id);
    }
    ctx.roomManager.setRoomState(room.id, {
      type: 'SelectChart',
      chartId: room.selectedChart?.id ?? null,
    });
    ctx.roomManager.setSoloConfirmPending(room.id, false);
    for (const playerId of room.players.keys()) {
      ctx.roomManager.setPlayerReady(room.id, playerId, false);
    }
    for (const playerInfo of room.players.values()) {
      playerInfo.isFinished = false;
      playerInfo.score = null;
    }
    ctx.broadcastMessage(room, { type: 'CancelGame', user: session.userId });
    ctx.broadcastToRoom(room, {
      type: ServerCommandType.ChangeState,
      state: { type: 'SelectChart', chartId: room.selectedChart?.id ?? null },
    });
  } else {
    ctx.broadcastMessage(room, { type: 'CancelReady', user: session.userId });
  }
  ctx.respond(connectionId, sendResponse, {
    type: ServerCommandType.CancelReady,
    result: { ok: true, value: undefined },
  });
}

export async function handlePlayed(
  ctx: HandlerCtx,
  connectionId: string,
  recordId: number,
  sendResponse: (response: any) => void,
): Promise<void> {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.logger.warn(
      `[游戏结果] 收到来自未验证连接 ${connectionId} 的 Played 消息 (记录ID: ${recordId})`,
      { userId: -1 },
    );
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: false, error: '未验证' },
    });
    return;
  }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    ctx.logger.error(
      `[游戏结果] 玩家 ${session.userId} 提交成绩时房间不存在 (记录ID: ${recordId})`,
      { userId: session.userId },
    );
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: false, error: '房间不存在喵' },
    });
    return;
  }
  if (room.state.type !== 'Playing') {
    ctx.logger.warn(
      `[游戏结果] 玩家 ${session.userId} 在房间 "${room.id}" 提交成绩，但游戏未在进行中 (当前状态: ${room.state.type})`,
      { userId: session.userId },
    );
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: false, error: '游戏未进行中' },
    });
    return;
  }
  const player = room.players.get(session.userId);
  if (!player) {
    ctx.logger.error(
      `[游戏结果] 房间 "${room.id}" 中找不到玩家 ${session.userId} (记录ID: ${recordId})`,
      { userId: session.userId },
    );
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: false, error: '房间中找不到玩家' },
    });
    return;
  }
  if (player.isFinished) {
    ctx.logger.warn(`[游戏结果] 玩家 ${session.userId} 在房间 "${room.id}" 重复提交成绩`, {
      userId: session.userId,
    });
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: true, value: undefined },
    });
    return;
  }
  let recordInfo;
  try {
    if (isNaN(Number(recordId))) throw new Error('Invalid record ID');
    const response = await fetch(`https://phira.5wyxi.com/record/${recordId}`, {
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`API返回了一个神秘的状态： ${response.status}`);
    }
    recordInfo = (await response.json()) as any;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch record';
    ctx.logger.error(
      `[游戏结果] 获取记录失败: ${connectionId} (用户: ${session.userId}, 房间: ${room.id}, 记录: ${recordId}, 错误: ${errorMessage})`,
      { userId: session.userId },
    );
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Played,
      result: { ok: false, error: '获取成绩记录失败' },
    });
    return;
  }
  player.isFinished = true;
  player.score = {
    score: recordInfo.score ?? 0,
    accuracy: recordInfo.accuracy ?? 0,
    perfect: recordInfo.perfect ?? 0,
    good: recordInfo.good ?? 0,
    bad: recordInfo.bad ?? 0,
    miss: recordInfo.miss ?? 0,
    maxCombo: recordInfo.maxCombo ?? 0,
    finishTime: Date.now(),
    std: recordInfo.std ?? 0,
    stdScore: recordInfo.stdScore ?? 0,
    isAp: recordInfo.isAp ?? recordInfo.is_ap ?? recordInfo.accuracy >= 1,
    fc: recordInfo.fc ?? recordInfo.is_fc ?? recordInfo.fullCombo ?? recordInfo.full_combo ?? false,
    mods: recordInfo.mods ?? null,
  };
  ctx.logger.mark(
    `"${session.userInfo.name}" 在房间 "${room.id}" 完成游玩并上传记录（分数：${recordInfo.score}，Acc：${recordInfo.accuracy}）`,
    { userId: session.userId },
  );
  ctx.respond(connectionId, sendResponse, {
    type: ServerCommandType.Played,
    result: { ok: true, value: undefined },
  });
  ctx.checkGameEnd(room);
}

export function handleAbort(
  ctx: HandlerCtx,
  connectionId: string,
  sendResponse: (response: any) => void,
): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Abort,
      result: { ok: false, error: '未验证' },
    });
    return;
  }
  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Abort,
      result: { ok: false, error: '房间不存在喵' },
    });
    return;
  }
  ctx.logger.info(
    `[游戏结果] 玩家 "${session.userInfo.name}" (ID: ${session.userId}) 在房间 "${room.id}" 主动放弃`,
    { userId: session.userId },
  );
  ctx.broadcastMessage(room, { type: 'Abort', user: session.userId });
  if (room.state.type === 'Playing') {
    const player = room.players.get(session.userId);
    if (player && !player.isFinished) {
      player.isFinished = true;
      player.score = {
        score: 0,
        accuracy: 0,
        perfect: 0,
        good: 0,
        bad: 0,
        miss: 0,
        maxCombo: 0,
        finishTime: Date.now(),
      };
      ctx.logger.info(
        `[游戏结果] 玩家 "${session.userInfo.name}" (ID: ${session.userId}) 在房间 "${room.id}" 已标记为放弃`,
        { userId: session.userId },
      );
      ctx.checkGameEnd(room);
    }
  }
  ctx.respond(connectionId, sendResponse, {
    type: ServerCommandType.Abort,
    result: { ok: true, value: undefined },
  });
}

export function checkGameEnd(ctx: HandlerCtx, room: Room): void {
  if (room.state.type !== 'Playing') {
    return;
  }
  const activePlayers = Array.from(room.players.values()).filter(
    (playerInfo) => !playerInfo.user.monitor,
  );
  const finishedPlayers = activePlayers.filter((playerInfo) => playerInfo.isFinished);
  const allFinished = finishedPlayers.length === activePlayers.length;
  ctx.logger.info(
    `[检查结束] 房间 "${room.id}" 评估中 (进度: ${finishedPlayers.length}/${activePlayers.length})`,
    { userId: -1 },
  );
  if (activePlayers.length === 0) {
    ctx.logger.info(`[检查结束] 房间 "${room.id}" 没有活跃玩家，结束游戏`, { userId: -1 });
    endGame(ctx, room);
    return;
  }
  if (!allFinished) {
    return;
  }
  ctx.logger.info(
    `[检查结束] 房间 "${room.id}" 所有玩家已完成 (${activePlayers.length} 人)，结束游戏`,
    { userId: -1 },
  );
  endGame(ctx, room);
}

export function endGame(ctx: HandlerCtx, room: Room): void {
  if (room.state.type !== 'Playing') {
    ctx.logger.debug(
      `[结束游戏] 被调用 but 房间 "${room.id}" 不在游戏中状态 (当前状态: ${room.state.type})`,
      { userId: -1 },
    );
    return;
  }
  const activePlayers = Array.from(room.players.values()).filter(
    (playerInfo) => !playerInfo.user.monitor,
  );
  const uploadedCount = activePlayers.filter((p) => p.isFinished).length;
  const abortedCount = activePlayers.length - uploadedCount;
  ctx.logger.info(`房间 "${room.id}" 对局结束（已上传：${uploadedCount}，中止：${abortedCount}）`, {
    userId: -1,
  });
  const rankings = activePlayers
    .map((playerInfo) => ({
      rank: 0,
      userId: playerInfo.user.id,
      userName: playerInfo.user.name,
      score: playerInfo.score ? { ...playerInfo.score } : null,
    }))
    .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  ctx.pluginManager?.emit('room:gameEnd', {
    room,
    rankings: rankings.map((entry) => ({
      rank: entry.rank,
      userId: entry.userId,
      userName: entry.userName,
      score: entry.score?.score ?? 0,
      accuracy: entry.score?.accuracy ?? 0,
    })),
  });
  const summary = rankings
    .map((r) => {
      const s = r.score;
      if (!s) return `${r.userName}[${r.userId}] 未上传成绩`;
      const acc = ((s.accuracy ?? 0) * 100).toFixed(2);
      let line = `${r.userName}[${r.userId}] 结算详情：\n`;
      line += `        分数：${(s.score ?? 0).toLocaleString()}，准度：${acc}%`;
      if ((s.std ?? 0) > 0) {
        line += `，误差：±${s.std}ms，无暇度分数：${s.stdScore ?? 0}`;
      }
      line += `\n        Perfect：${s.perfect ?? 0}，Good：${s.good ?? 0}，Bad：${s.bad ?? 0}，Miss：${s.miss ?? 0}`;
      if (s.isAp) {
        line += `，AP！！！`;
      } else if (s.fc) {
        line += `，全连`;
      }
      if (s.mods && (Array.isArray(s.mods) ? s.mods.length > 0 : true)) {
        const modList = Array.isArray(s.mods) ? s.mods.join(', ') : String(s.mods);
        line += `，使用的模组：${modList}`;
      }
      return line;
    })
    .join('\n\n');
  const content = `【游戏结算】\n${summary}`;
  ctx.roomManager.addMessageToRoom(room.id, { type: 'Chat', user: -1, content: content });
  ctx.broadcastMessage(room, { type: 'Chat', user: -1, content: content });
  ctx.broadcastMessage(room, { type: 'GameEnd' });
  const oldState = room.state.type;
  if (room.cycle) {
    ctx.logger.info(`[结束游戏] 房间 "${room.id}" 开启了循环模式，正在轮换房主`, { userId: -1 });
    const playerIds = Array.from(room.players.keys()).filter((id) => {
      const player = room.players.get(id);
      return player && !player.user.monitor;
    });
    if (playerIds.length > 1) {
      const currentOwnerIndex = playerIds.indexOf(room.ownerId);
      const nextOwnerIndex = (currentOwnerIndex + 1) % playerIds.length;
      const newOwnerId = playerIds[nextOwnerIndex];
      const oldOwnerId = room.ownerId;
      ctx.roomManager.changeRoomOwner(room.id, newOwnerId);
      ctx.logger.info(`[房主轮换] 房间 "${room.id}": ${oldOwnerId} -> ${newOwnerId}`, {
        userId: -1,
      });
      ctx.broadcastToRoom(room, { type: ServerCommandType.ChangeHost, isHost: false });
      const newOwnerCallback = ctx.broadcastCallbacks.get(
        room.players.get(newOwnerId)?.connectionId ?? '',
      );
      if (newOwnerCallback) {
        newOwnerCallback({ type: ServerCommandType.ChangeHost, isHost: true });
      }
      ctx.broadcastMessage(room, { type: 'NewHost', user: newOwnerId });
    }
    ctx.roomManager.setRoomState(room.id, { type: 'WaitingForReady' });
    ctx.logger.info(`[状态变更] 房间 "${room.id}": ${oldState} -> WaitingForReady`, { userId: -1 });
    for (const playerInfo of room.players.values()) {
      playerInfo.isReady = false;
      playerInfo.isFinished = false;
    }
  } else {
    ctx.logger.info(`[结束游戏] 房间 "${room.id}" (普通模式)，保留谱面选择`, { userId: -1 });
    room.lastGameChart = room.selectedChart;
    ctx.roomManager.setRoomState(room.id, {
      type: 'SelectChart',
      chartId: room.selectedChart?.id ?? null,
    });
    ctx.roomManager.setSoloConfirmPending(room.id, false);
    ctx.logger.info(`[状态变更] 房间 "${room.id}": ${oldState} -> SelectChart`, { userId: -1 });
    for (const playerInfo of room.players.values()) {
      playerInfo.isReady = false;
      playerInfo.isFinished = false;
    }
  }
  ctx.broadcastRoomUpdate(room);
  if (ctx.federationManager?.getConfig?.()?.enabled) {
    ctx.federationManager
      .broadcastRoomEvent('game_ended', room.id, ctx.federationManager.buildLocalRoomInfo(room))
      .catch(() => {});
  }
}
