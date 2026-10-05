import { HandlerCtx } from './context';
import { ServerCommandType } from '../Commands';

const MAX_CHAT_LENGTH = 2048;

export function handleChat(
  ctx: HandlerCtx,
  connectionId: string,
  message: string,
  sendResponse: (response: any) => void,
): void {
  if (typeof message !== 'string' || message.length === 0 || message.length > MAX_CHAT_LENGTH) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Chat,
      result: { ok: false, error: '消息长度超出限制喵' },
    });
    return;
  }

  const session = ctx.sessions.get(connectionId);
  if (!session) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Chat,
      result: { ok: false, error: '未验证' },
    });
    return;
  }

  const room = ctx.roomManager.getRoomByUserId(session.userId);
  if (!room) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Chat,
      result: { ok: false, error: '房间不存在喵' },
    });
    return;
  }

  ctx.broadcastMessage(room, {
    type: 'Chat',
    user: session.userId,
    content: message,
  });

  ctx.pluginManager?.emit('chat:message', {
    room,
    userId: session.userId,
    content: message,
    connectionId,
  });

  ctx.logger.debug(`已在房间 "${room.id}" 广播来自玩家 "${session.userInfo.name}" 的聊天消息`, {
    userId: session.userId,
  });

  ctx.respond(connectionId, sendResponse, {
    type: ServerCommandType.Chat,
    result: { ok: true, value: undefined },
  });
}
