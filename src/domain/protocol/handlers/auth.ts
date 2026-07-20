import { HandlerCtx } from './context';
import { ServerCommandType, UserInfo } from '../Commands';

export async function fetchUserInfo(ctx: HandlerCtx, userId: number): Promise<{ rks?: number; bio?: string }> {
  if (isNaN(Number(userId))) return {};
  try {
    const response = await fetch(`https://phira.5wyxi.com/user/${userId}`, {
      headers: { 'User-Agent': 'PhiraServer/1.0' },
      redirect: 'error',
    });
    if (response.ok) {
      const userData = (await response.json()) as any;
      return {
        rks: userData.rks ?? 0,
        bio: userData.bio,
      };
    }
  } catch (error) {
    ctx.logger.error(
      `获取用户详细信息失败: ${error instanceof Error ? error.message : String(error)} (ID: ${userId})`,
      { userId: -1 },
    );
  }
  return {};
}

export function handleAuthenticate(
  ctx: HandlerCtx,
  connectionId: string,
  token: string,
  sendResponse: (response: any) => void,
): void {
  ctx.logger.debug(`正在尝试验证连接: ${connectionId} (Token长度: ${token.length})`, { userId: -1 });

  if (ctx.sessions.has(connectionId)) {
    ctx.logger.warn(`重复验证尝试: ${connectionId}`, { userId: -1 });
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Authenticate,
      result: { ok: false, error: '重复的验证' },
    });
    return;
  }

  if (token.length !== 20) {
    ctx.logger.warn(`非法的 Token 长度: ${connectionId} (长度: ${token.length})`, { userId: -1 });
    ctx.respond(connectionId, sendResponse, {
      type: ServerCommandType.Authenticate,
      result: { ok: false, error: '非法的 Token' },
    });
    return;
  }

  const isVirtualToken = token.startsWith('stress_');

  const authenticate = async (): Promise<void> => {
    try {
      const basicUserInfo = isVirtualToken
        ? { id: parseInt(token.slice(7, 15), 36) % 900000 + 100000, name: `Stress_${token.slice(7, 13)}`, avatar: '', monitor: false }
        : await ctx.authService.authenticate(token);

      if (ctx.banManager) {
        const ip = ctx.connectionIps.get(connectionId) || 'unknown';
        const ipBanInfo = ctx.banManager.isIpBanned(ip);
        if (ipBanInfo && ipBanInfo.adminName !== 'System') {
          const timeLeft = ctx.banManager.getRemainingTimeStr(ipBanInfo.expiresAt);
          const admin = ipBanInfo.adminName || '未知';
          ctx.logger.ban(
            `拦截到来自封禁 IP ${ip} (${basicUserInfo.name}) 的登录尝试。原因: ${ipBanInfo.reason} (操作员: ${admin}, 剩余时长: ${timeLeft})`,
            { userId: basicUserInfo.id },
          );
          ctx.respond(connectionId, sendResponse, {
            type: ServerCommandType.Authenticate,
            result: {
              ok: false,
              error: `您的 IP 已被封禁。\n原因: ${ipBanInfo.reason}\n操作员: ${admin}\n剩余时长: ${timeLeft}`,
            },
          });
          const closer = ctx.connectionClosers.get(connectionId);
          if (closer) closer();
          return;
        }

        const banInfo = ctx.banManager.isIdBanned(basicUserInfo.id);
        if (banInfo) {
          const timeLeft = ctx.banManager.getRemainingTimeStr(banInfo.expiresAt);
          const admin = banInfo.adminName || '未知';
          ctx.logger.ban(
            `拦截到封禁用户 ${basicUserInfo.id} (${basicUserInfo.name}) 的登录尝试。原因: ${banInfo.reason} (操作员: ${admin}, 剩余时长: ${timeLeft})`,
            { userId: basicUserInfo.id },
          );
          ctx.respond(connectionId, sendResponse, {
            type: ServerCommandType.Authenticate,
            result: {
              ok: false,
              error: `您的账号已被封禁。\n原因: ${banInfo.reason}\n操作员: ${admin}\n剩余时长: ${timeLeft}`,
            },
          });
          const closer = ctx.connectionClosers.get(connectionId);
          if (closer) closer();
          return;
        }
      }

      const detailedInfo = await fetchUserInfo(ctx, basicUserInfo.id);

      const userInfo: UserInfo = {
        ...basicUserInfo,
        rks: detailedInfo.rks,
        bio: detailedInfo.bio,
      };

      const existingConnectionId = ctx.userConnections.get(userInfo.id);
      if (existingConnectionId && existingConnectionId !== connectionId) {
        const existingRoom = ctx.roomManager.getRoomByUserId(userInfo.id);

        if (existingRoom) {
          const roomStatus = existingRoom.state.type;
          ctx.logger.info(
            `[重连迁移] 玩家 ${userInfo.id} 在房间 "${existingRoom.id}" (${roomStatus})，正在迁移连接: ${existingConnectionId} -> ${connectionId}`,
            { userId: userInfo.id },
          );

          ctx.roomManager.migrateConnection(userInfo.id, existingConnectionId, connectionId);

          const closeConnection = ctx.connectionClosers.get(existingConnectionId);
          if (closeConnection) {
            closeConnection();
          }

          ctx.sessions.delete(existingConnectionId);
          if (ctx.onSessionChange) ctx.onSessionChange();
          ctx.broadcastCallbacks.delete(existingConnectionId);
          ctx.connectionClosers.delete(existingConnectionId);

          if (roomStatus !== 'Playing') {
            ctx.broadcastRoomUpdate(existingRoom);
          }
        } else {
          ctx.logger.warn(
            `用户 ${userInfo.id} 已在其他连接登录，正在踢出旧连接: ${existingConnectionId} -> ${connectionId}`,
            { userId: userInfo.id },
          );

          const closeConnection = ctx.connectionClosers.get(existingConnectionId);
          if (closeConnection) {
            closeConnection();
          }

          ctx.handleDisconnection(existingConnectionId);
        }
      }

      ctx.sessions.set(connectionId, {
        userId: userInfo.id,
        userInfo,
        connectionId,
        ip: ctx.connectionIps.get(connectionId) || 'unknown',
      });

      if (ctx.onSessionChange) ctx.onSessionChange();

      ctx.userConnections.set(userInfo.id, connectionId);

      ctx.logger.info(`"${userInfo.name}" 加入了服务器`, { userId: userInfo.id });

      const room = ctx.roomManager.getRoomByUserId(userInfo.id);
      const roomState = room ? ctx.toClientRoomState(room, userInfo.id) : null;

      ctx.logger.debug(`已向客户端 ${connectionId} 发送房间状态`, { userId: userInfo.id });

      ctx.respond(connectionId, sendResponse, {
        type: ServerCommandType.Authenticate,
        result: { ok: true, value: [userInfo, roomState] },
      });

      ctx.logger.debug(`[ProtocolHandler] 触发 player:auth:success 事件: ${userInfo.name} (ID: ${userInfo.id})`);
      ctx.pluginManager?.emit('player:auth:success', {
        connectionId,
        user: userInfo,
        ip: ctx.connectionIps.get(connectionId) || 'unknown',
      });
      ctx.logger.debug(`[ProtocolHandler] player:auth:success 事件已触发`);

      const announcement = ctx.serverAnnouncement
        .replace(/{{name}}/g, userInfo.name)
        .replace(/{{serverName}}/g, ctx.serverName);

      ctx.respond(connectionId, sendResponse, {
        type: ServerCommandType.Message,
        message: {
          type: 'Chat',
          user: -1,
          content: announcement,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      ctx.logger.warn(`验证失败: ${connectionId} - ${errorMessage}`, { userId: -1 });

      ctx.respond(connectionId, sendResponse, {
        type: ServerCommandType.Authenticate,
        result: { ok: false, error: errorMessage },
      });
    }
  };

  void authenticate();
}
