import { HandlerCtx } from './context';
import { ServerCommandType } from '../Commands';
import { isValidChatContent } from '../ChatValidation';

export function handleChat(
  ctx: HandlerCtx,
  connectionId: string,
  message: string,
  sendResponse: (response: any) => void,
): void {
  if (!isValidChatContent(message)) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Chat,
      result: { ok: false, error: '消息必须为 1–2048 长度的单行纯文本，不允许标记或控制字符' },
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

  if (room.chatEnabled === false) {
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Chat,
      result: { ok: false, error: '房间聊天已关闭' },
    });
    return;
  }

  ctx.broadcastMessage(room, {
    type: 'Chat',
    user: session.userId,
    content: message,
    senderName: session.userInfo.name,
    isHost: room.ownerId === session.userId,
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
