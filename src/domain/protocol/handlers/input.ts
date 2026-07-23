import { HandlerCtx } from './context';
import { ServerCommandType, TouchFrame, JudgeEvent } from '../Commands';

export function handleTouches(ctx: HandlerCtx, connectionId: string, frames: TouchFrame[]): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    return;
  }

  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    return;
  }

  if (!room.live) {
    ctx.logger.debug(`在非 live 模式下收到触摸事件: ${session.userId}`, { userId: session.userId });
    return;
  }

  const player = room.players.get(session.userId);
  if (!player) {
    return;
  }

  const lastFrame = frames[frames.length - 1];
  if (lastFrame) {
    // Keep parity with Rust side effect semantics as closely as current TS model allows.
  }

  for (const playerInfo of room.players.values()) {
    if (!playerInfo.user.monitor || playerInfo.connectionId === connectionId) {
      continue;
    }
    const callback = ctx.broadcastCallbacks.get(playerInfo.connectionId);
    if (callback) {
      callback({
        type: ServerCommandType.Touches,
        player: session.userId,
        frames,
      });
    }
  }
}

export function handleJudges(ctx: HandlerCtx, connectionId: string, judges: JudgeEvent[]): void {
  const session = ctx.sessions.get(connectionId);
  if (!session) {
    return;
  }

  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    return;
  }

  if (!room.live) {
    ctx.logger.debug(`在非 live 模式下收到判定事件: ${session.userId}`, { userId: session.userId });
    return;
  }

  const player = room.players.get(session.userId);
  if (!player) {
    return;
  }

  for (const playerInfo of room.players.values()) {
    if (!playerInfo.user.monitor || playerInfo.connectionId === connectionId) {
      continue;
    }
    const callback = ctx.broadcastCallbacks.get(playerInfo.connectionId);
    if (callback) {
      callback({
        type: ServerCommandType.Judges,
        player: session.userId,
        judges,
      });
    }
  }
}
