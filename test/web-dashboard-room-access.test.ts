import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import WebSocket from 'ws';
import { InMemoryRoomManager } from '../src/domain/rooms/RoomManager';
import { HttpServer } from '../src/network/HttpServer';
import { isValidChatContent } from '../src/domain/protocol/ChatValidation';
import { handleChat } from '../src/domain/protocol/handlers/chat';
import { ProtocolHandler } from '../src/domain/protocol/ProtocolHandler';

const plugin = require('../plugins/web-dashboard/res/main.js').default;
const { PluginWebSocketServer } = require('../plugins/websocket/res/lib/WebSocketServer.js');
const routes: Array<[string, string, Record<string, unknown>]> = [
  ['post', 'kick-player', { userId: 30 }],
  ['post', 'force-start', {}],
  ['post', 'toggle-lock', {}],
  ['post', 'set-max-players', { maxPlayers: 4 }],
  ['post', 'close-room', {}],
  ['post', 'toggle-mode', {}],
  ['get', 'room-blacklist', {}],
  ['post', 'set-room-blacklist', { userIds: [40] }],
  ['get', 'room-whitelist', {}],
  ['post', 'set-room-whitelist', { userIds: [40] }],
];

describe('dashboard room creator authorization', () => {
  let app: express.Application;
  let rooms: InMemoryRoomManager;
  let protocol: any;
  const logger: any = Object.fromEntries(
    ['info', 'debug', 'warn', 'error', 'mark', 'ban'].map((k) => [k, jest.fn()]),
  );
  const config: any = {
    trustProxyHops: 0,
    sessionSecret: 'test-creator-session-secret',
    serverName: 'Test',
    adminPhiraId: [1],
    ownerPhiraId: [2],
    captchaProvider: 'none',
    allowedOrigins: [],
    enablePriWeb: true,
    priPrefix: 'private-',
    enablePubWeb: false,
    defaultAvatar: '',
  };
  let originalFetch: typeof fetch;
  let host: HttpServer;
  let cleanup: () => void;

  const tokens = new Map<number, string>();
  async function login(id: number) {
    const response = await request(app)
      .post('/api/user-login')
      .send({ email: String(id), password: 'test' })
      .expect(200);
    tokens.set(
      id,
      (response.headers['set-cookie'] as unknown as string[])
        .find((cookie: string) => cookie.startsWith('access_token='))!
        .split(';')[0]
        .substring('access_token='.length),
    );
  }
  function call(method: string, route: string, data: any, id?: number) {
    const req = (request(app) as any)[method]('/api/admin/' + route);
    if (id !== undefined) req.set('Authorization', 'Bearer ' + tokens.get(id));
    return method === 'get' ? req.query(data) : req.send(data);
  }
  beforeEach(async () => {
    tokens.clear();
    rooms = new InMemoryRoomManager(logger);
    rooms.createRoom({
      id: 'private-own',
      name: 'own',
      ownerId: 10,
      ownerInfo: { id: 10, name: 'Creator', monitor: false },
      connectionId: 'a',
    });
    rooms.addPlayerToRoom('private-own', 30, { id: 30, name: 'Player', monitor: false }, 'b');
    rooms.createRoom({
      id: 'private-other',
      name: 'other',
      ownerId: 20,
      ownerInfo: { id: 20, name: 'Other', monitor: false },
      connectionId: 'c',
    });
    protocol = {
      getSessionCount: () => 3,
      getAllSessions: () => [],
      sendServerMessage: jest.fn(),
      sendRoomMessage: jest.fn(),
      isValidChatContent,
      kickPlayer: jest.fn(() => true),
      forceStartGame: jest.fn(() => true),
      toggleRoomLock: jest.fn(() => true),
      setRoomMaxPlayers: jest.fn(() => true),
      closeRoomByAdmin: jest.fn(() => true),
    };
    const bans: any = { isIpBanned: () => null };
    host = new HttpServer(config, logger, rooms, protocol, bans);
    app = host.getExpressApp();
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: any, options: any) => {
      const id = String(url).endsWith('/login')
        ? Number(JSON.parse(options.body).email)
        : Number(options.headers.Authorization.replace('Bearer token-', ''));
      return {
        ok: true,
        json: async () =>
          String(url).endsWith('/login') ? { token: 'token-' + id } : { id, name: 'User' + id },
      };
    }) as any;
    const intervals = jest.spyOn(global, 'setInterval');
    await plugin.init({
      config,
      httpServer: host,
      logger,
      events: { emit: jest.fn() },
      roomManager: rooms,
      protocolHandler: protocol,
      banManager: bans,
      getExpressApp: () => app,
      readPluginConfig: () => ({}),
    });
    cleanup = intervals.mock.calls.find((call) => call[1] === 60 * 60 * 1000)![0] as () => void;
  });
  afterEach(async () => {
    await plugin.destroy();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('does not allocate anonymous sessions or cookies', async () => {
    const response = await request(app).get('/check-session').expect(200);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('issues opaque local credentials, proxies profiles with the upstream token and rotates cookies', async () => {
    const response = await request(app)
      .post('/api/user-login')
      .send({ email: '10', password: 'test' })
      .expect(200);
    const cookie = (response.headers['set-cookie'] as unknown as string[]).find((value: string) =>
      value.startsWith('access_token='),
    )!;
    const token = cookie.split(';')[0].substring('access_token='.length);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(JSON.stringify(response.body)).not.toContain('token-10');
    await request(app)
      .get('/check-session')
      .set('Authorization', 'Bearer token-10')
      .expect({ valid: false });
    const profile = await request(app)
      .get('/api/user-profile')
      .set('Cookie', cookie.split(';')[0])
      .expect(200);
    expect(profile.body.id).toBe(10);
    await request(app)
      .post('/api/user-login')
      .set('Cookie', cookie.split(';')[0])
      .set('Origin', 'http://127.0.0.1')
      .set('Host', '127.0.0.1')
      .send({ email: '10', password: 'test' })
      .expect(200);
    await request(app)
      .get('/check-session')
      .set('Authorization', 'Bearer ' + token)
      .expect({ valid: false });
  });

  it('uses the trusted host scheme for auto Secure cookies and ignores forged forwarding headers', async () => {
    const forged = await request(app)
      .post('/api/user-login')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: '10', password: 'test' })
      .expect(200);
    expect((forged.headers['set-cookie'] as unknown as string[]).join(';')).not.toContain(
      '; Secure',
    );
    jest.spyOn(host, 'getRequestOrigin').mockReturnValue('https://dashboard.example');
    const secure = await request(app)
      .post('/api/user-login')
      .send({ email: '10', password: 'test' })
      .expect(200);
    expect((secure.headers['set-cookie'] as unknown as string[]).join(';')).toContain('; Secure');
  });

  it.each([true, false])('honors explicit cookieSecure=%s', async (cookieSecure) => {
    await plugin.destroy();
    const isolated = express();
    isolated.use(express.json());
    await plugin.init({
      config,
      httpServer: host,
      logger,
      events: { emit: jest.fn() },
      roomManager: rooms,
      protocolHandler: protocol,
      banManager: { isIpBanned: () => null },
      getExpressApp: () => isolated,
      readPluginConfig: () => ({ cookieSecure }),
    });
    const response = await request(isolated)
      .post('/api/user-login')
      .send({ email: '10', password: 'test' })
      .expect(200);
    const cookies = (response.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies.includes('; Secure')).toBe(cookieSecure);
  });

  it('does not issue a credential or leak the upstream token when identity lookup fails', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
      ok: url.endsWith('/login'),
      json: async () => ({ token: 'sensitive-upstream-token', id: 1, name: 'Admin' }),
    }));
    const response = await request(app)
      .post('/api/user-login')
      .send({ email: '10', password: 'test' })
      .expect(502);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('sensitive-upstream-token');
  });

  it('cleans expired sessions using the existing cleanup timer', async () => {
    await login(10);
    const req = { headers: { cookie: 'access_token=' + tokens.get(10) } };
    const session = app.locals.webDashboardAuth(req);
    expect(session.userId).toBe(10);
    expect(session.upstreamToken).not.toContain('token-10');
    expect(Buffer.from(session.upstreamToken, 'base64').includes(Buffer.from('token-10'))).toBe(
      false,
    );
    session.expiresAt = Date.now() - 1;
    cleanup();
    session.expiresAt = Date.now() + 10000;
    expect(app.locals.webDashboardAuth(req)).toBeUndefined();
  });

  it.each(routes)(
    '%s %s accepts creator, rejects strangers and anonymous callers',
    async (method, route, body) => {
      await login(10);
      await login(20);
      const data = { roomId: 'private-own', ...body };
      await call(method, route, data).expect(401);
      await call(method, route, data, 20).expect(403);
      await call(method, route, data, 10).expect(200);
      await call(method, route, { ...data, roomId: 'missing' }, 10).expect(404);
    },
  );

  it('keeps creator rights after host transfer and rejects replacement host', async () => {
    await login(10);
    await login(30);
    rooms.changeRoomOwner('private-own', 30);
    rooms.removePlayerFromRoom('private-own', 10);
    expect(rooms.getRoom('private-own')?.creatorId).toBe(10);
    await call('post', 'toggle-lock', { roomId: 'private-own' }, 10).expect(200);
    await call('post', 'toggle-lock', { roomId: 'private-own' }, 30).expect(403);
    rooms.deleteRoom('private-own');
    rooms.createRoom({
      id: 'private-own',
      name: 'new',
      ownerId: 30,
      ownerInfo: { id: 30, name: 'New', monitor: false },
      connectionId: 'd',
    });
    await call('post', 'toggle-lock', { roomId: 'private-own' }, 10).expect(403);
  });

  it('requires roomId for creator kicks and prevents cross-room kicks', async () => {
    await login(10);
    await login(1);
    await call('post', 'kick-player', { userId: 20 }, 10).expect(400);
    await call('post', 'kick-player', { roomId: 'private-own', userId: 20 }, 10).expect(403);
    expect(protocol.kickPlayer).not.toHaveBeenCalled();
    await call('post', 'kick-player', { userId: 20 }, 1).expect(200);
  });

  it('sends creator messages as the authenticated user without a system prefix', async () => {
    await login(10);
    const realProtocol = new ProtocolHandler(
      rooms,
      {} as any,
      logger,
      'Test',
      'https://example.test',
    );
    protocol.sendRoomMessage.mockImplementation((roomId: string, userId: number, content: string) =>
      realProtocol.sendRoomMessage(roomId, userId, content),
    );
    const send = jest.fn();
    realProtocol.addVirtualSession('b', 30, { id: 30, name: 'Player', monitor: false }, send);
    await request(app)
      .post('/api/admin/room-message')
      .set('Authorization', 'Bearer ' + tokens.get(10))
      .send({ roomId: 'private-own', content: 'Hello room' })
      .expect(200);
    expect(rooms.getRoom('private-own')?.messages.slice(-1)[0]).toEqual({
      type: 'Chat',
      user: 10,
      content: 'Hello room',
      senderName: 'Creator',
      isHost: true,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          type: 'Chat',
          user: 10,
          content: 'Hello room',
          isHost: true,
        }),
      }),
    );
    await call(
      'post',
      'server-message',
      { roomId: 'private-own', content: 'fake system' },
      10,
    ).expect(403);
  });

  it('allows members to chat and only the current host or server roles to toggle room chat', async () => {
    for (const id of [1, 2, 10, 20, 30]) await login(id);
    const toggle = (id: number, enabled: any, roomId = 'private-own') =>
      request(app)
        .post('/api/admin/chat')
        .set('Authorization', 'Bearer ' + tokens.get(id))
        .send({ roomId, enabled });
    const send = (id: number) =>
      request(app)
        .post('/api/admin/room-message')
        .set('Authorization', 'Bearer ' + tokens.get(id))
        .send({ roomId: 'private-own', content: 'hi' });
    protocol.sendRoomMessage.mockReturnValue(true);
    await send(30).expect(200);
    await send(20).expect(403);
    await toggle(30, false).expect(403);
    await toggle(20, false).expect(403);
    await toggle(10, 'false').expect(400);
    await toggle(10, false).expect(200);
    expect(rooms.getRoom('private-own')?.chatEnabled).toBe(false);
    await send(30).expect(403);
    const real = new ProtocolHandler(rooms, {} as any, logger, 'Test', 'https://example.test');
    expect(real.sendRoomMessage('private-own', 30, 'hi')).toBe(false);
    const respond = jest.fn();
    const broadcastMessage = jest.fn();
    const ctx: any = {
      sessions: new Map([['b', { userId: 30, userInfo: { name: 'Player' } }]]),
      roomManager: rooms,
      respond,
      broadcastMessage,
      logger,
    };
    handleChat(ctx, 'b', 'hello', jest.fn());
    expect(respond.mock.calls[0][2].result.ok).toBe(false);
    expect(broadcastMessage).not.toHaveBeenCalled();
    await toggle(1, true).expect(200);
    await send(30).expect(200);
    handleChat(ctx, 'b', 'hello', jest.fn());
    expect(broadcastMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user: 30, isHost: false }),
    );
    rooms.changeRoomOwner('private-own', 30);
    await toggle(10, false).expect(403);
    await toggle(30, false).expect(200);
    await toggle(2, true).expect(200);
    expect(rooms.getRoom('private-other')?.chatEnabled).toBe(true);
    await request(app)
      .post('/api/admin/chat')
      .send({ roomId: 'private-own', enabled: false })
      .expect(401);
    await request(app)
      .post('/api/admin/chat')
      .set('Origin', 'https://attacker.test')
      .set('Cookie', 'access_token=' + tokens.get(30))
      .send({ roomId: 'private-own', enabled: false })
      .expect(403);
  });

  it('delegates Web message validation to the host authoritative validator', async () => {
    await login(10);
    const validator = jest.spyOn(protocol, 'isValidChatContent').mockReturnValue(false);
    await request(app)
      .post('/api/admin/room-message')
      .set('Authorization', 'Bearer ' + tokens.get(10))
      .send({ roomId: 'private-own', content: 'otherwise valid text' })
      .expect(400);
    expect(validator).toHaveBeenCalledWith('otherwise valid text');
    expect(protocol.sendRoomMessage).not.toHaveBeenCalled();
  });

  it('sends browser cookie requests and returns actionable JSON for an outdated host', async () => {
    await login(10);
    const send = () =>
      request(app)
        .post('/api/admin/room-message')
        .set('Host', 'dashboard.example.test')
        .set('Origin', 'http://dashboard.example.test')
        .set('Cookie', 'access_token=' + tokens.get(10))
        .send({ roomId: 'private-own', content: '你好' });
    protocol.sendRoomMessage.mockReturnValue(true);
    await send().expect(200);
    protocol.sendRoomMessage = undefined;
    const res = await send().expect(503);
    expect(res.body.error).toContain('宿主版本不匹配');
  });

  it('rejects anonymous, foreign-room, invalid-content and CSRF room messages', async () => {
    await login(10);
    await login(20);
    const send = (token?: number, body: any = { roomId: 'private-own', content: 'test' }) => {
      const req = request(app).post('/api/admin/room-message');
      if (token !== undefined) req.set('Authorization', 'Bearer ' + tokens.get(token));
      return req.send(body);
    };
    await send().expect(401);
    await send(20).expect(403);
    await send(10, { roomId: 'missing', content: 'test' }).expect(404);
    for (const content of [
      '',
      '   ',
      10,
      {},
      [],
      null,
      '<script>alert(1)</script>',
      'a\nb',
      'a\tb',
      'a\u0000b',
      'a\u202eb',
      '\ud800',
      'x'.repeat(2049),
    ]) {
      await send(10, { roomId: 'private-own', content }).expect(400);
    }
    await request(app)
      .post('/api/admin/room-message')
      .set('Origin', 'https://attacker.test')
      .set('Cookie', 'access_token=' + tokens.get(10))
      .send({ roomId: 'private-own', content: 'test' })
      .expect(403);
    expect(protocol.sendRoomMessage).not.toHaveBeenCalled();
  });

  it('retains administrator system messages and creator messages after host transfer', async () => {
    await login(1);
    await login(10);
    await login(30);
    await call('post', 'server-message', { roomId: 'private-own', content: 'notice' }, 1).expect(
      200,
    );
    expect(protocol.sendServerMessage).toHaveBeenCalledWith('private-own', '【系统】notice');
    rooms.changeRoomOwner('private-own', 30);
    rooms.removePlayerFromRoom('private-own', 10);
    protocol.sendRoomMessage.mockReturnValue(true);
    await request(app)
      .post('/api/admin/room-message')
      .set('Authorization', 'Bearer ' + tokens.get(10))
      .send({ roomId: 'private-own', content: 'still creator' })
      .expect(403);
    await request(app)
      .post('/api/admin/room-message')
      .set('Authorization', 'Bearer ' + tokens.get(30))
      .send({ roomId: 'private-own', content: 'new host' })
      .expect(200);
  });

  it('enforces a JSON-only exact message schema and validates again before broadcasting', async () => {
    await login(10);
    const endpoint = '/api/admin/room-message';
    for (const body of [
      [],
      { roomId: ['private-own'], content: 'hi' },
      { roomId: 'private-own', content: 'hi', userId: 20 },
      { roomId: 'private-own', content: 'hi', isAdmin: true },
    ]) {
      await request(app)
        .post(endpoint)
        .set('Authorization', 'Bearer ' + tokens.get(10))
        .send(body)
        .expect(400);
    }
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer ' + tokens.get(10))
      .type('form')
      .send({ roomId: 'private-own', content: 'hi' })
      .expect(415);
    expect(protocol.sendRoomMessage).not.toHaveBeenCalled();
    const real = new ProtocolHandler(rooms, {} as any, logger, 'Test', 'https://example.test');
    for (const content of ['<b>hi</b>', 'a\nb', 'a\u0000b', 'a\u202eb', '\ud800']) {
      expect(real.sendRoomMessage('private-own', 10, content)).toBe(false);
    }
    expect(rooms.getRoom('private-own')?.messages).toEqual([]);
    protocol.sendRoomMessage.mockImplementation((roomId: string, id: number, content: string) =>
      real.sendRoomMessage(roomId, id, content),
    );
    const content = '中文 English 123 🎵 “hello” & friends';
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer ' + tokens.get(10))
      .send({ roomId: 'private-own', content })
      .expect(200);
    expect(rooms.getRoom('private-own')?.messages[0]).toMatchObject({ content, user: 10 });
  });

  it('rejects cross-room kick when membership and the user-room index disagree', async () => {
    await login(10);
    // Federation joins can add the same user without clearing their previous room membership.
    rooms.addPlayerToRoom(
      'private-other',
      30,
      { id: 30, name: 'Player', monitor: false },
      'remote',
    );
    expect(rooms.getRoom('private-own')?.players.has(30)).toBe(true);
    expect(rooms.getRoomByUserId(30)?.id).toBe('private-other');
    const realProtocol = new ProtocolHandler(
      rooms,
      {} as any,
      logger,
      'Test',
      'https://example.test',
    );
    protocol.kickPlayer.mockImplementation((id: number, roomId?: string) =>
      realProtocol.kickPlayer(id, roomId),
    );
    await call('post', 'kick-player', { roomId: 'private-own', userId: 30 }, 10).expect(403);
    expect(protocol.kickPlayer).not.toHaveBeenCalled();
    expect(realProtocol.kickPlayer(30, 'private-own')).toBe(false);
    expect(rooms.getRoom('private-other')?.players.has(30)).toBe(true);
  });

  it('rejects a foreign-Origin form POST carrying a victim cookie', async () => {
    await login(20);
    expect(rooms.getRoom('private-other')?.cycle).toBe(false);
    await request(app)
      .post('/api/admin/toggle-mode')
      .set('Host', 'dashboard.example.test')
      .set('Origin', 'http://untrusted.example.test')
      .set('Sec-Fetch-Site', 'same-site')
      .set('Cookie', 'access_token=' + tokens.get(20))
      .type('form')
      .send({ roomId: 'private-other' })
      .expect(403);
    expect(rooms.getRoom('private-other')?.cycle).toBe(false);
  });

  it('requires a trusted exact origin for cookie writes, including logout', async () => {
    await login(10);
    const write = (origin?: string) => {
      const req = request(app)
        .post('/api/admin/toggle-mode')
        .set('Host', 'dashboard.example.test')
        .set('Cookie', 'access_token=' + tokens.get(10));
      if (origin !== undefined) req.set('Origin', origin);
      return req.send({ roomId: 'private-own' });
    };
    for (const origin of [
      undefined,
      'null',
      'https://dashboard.example.test',
      'http://dashboard.example.test:8080',
      'http://dashboard.example.test.attacker.test',
      'http://dashboard.example.test/path',
    ]) {
      await write(origin).expect(403);
    }
    expect(rooms.getRoom('private-own')?.cycle).toBe(false);
    await write('http://dashboard.example.test').expect(200);
    expect(rooms.getRoom('private-own')?.cycle).toBe(true);
    await request(app)
      .post('/api/admin/toggle-mode')
      .set('Host', 'dashboard.example.test')
      .set('Cookie', 'access_token=' + tokens.get(10))
      .set('Referer', 'http://dashboard.example.test/room?id=private-own')
      .send({ roomId: 'private-own' })
      .expect(200);
    await request(app)
      .post('/api/admin/toggle-mode')
      .set('Host', 'dashboard.example.test')
      .set('Cookie', 'access_token=' + tokens.get(10))
      .set('Origin', 'null')
      .set('Referer', 'http://dashboard.example.test/')
      .send({ roomId: 'private-own' })
      .expect(403);
    await request(app)
      .get('/LOGOUT/')
      .set('Cookie', 'access_token=' + tokens.get(10))
      .expect(403);
    expect(
      app.locals.webDashboardAuth({ headers: { cookie: 'access_token=' + tokens.get(10) } })
        ?.userId,
    ).toBe(10);
    await request(app)
      .post('/logout')
      .set('Host', 'dashboard.example.test')
      .set('Origin', 'http://dashboard.example.test')
      .set('Cookie', 'access_token=' + tokens.get(10))
      .expect(302);
    expect(
      app.locals.webDashboardAuth({ headers: { cookie: 'access_token=' + tokens.get(10) } }),
    ).toBeUndefined();
  });

  it('rejects cross-site login forms and preserves explicitly trusted origins', async () => {
    await request(app)
      .post('/api/user-login')
      .set('Origin', 'https://attacker.test')
      .type('form')
      .send({ email: '10', password: 'test' })
      .expect(403);
    await request(app)
      .post('/api/user-login')
      .set('Sec-Fetch-Site', 'cross-site')
      .type('form')
      .send({ email: '10', password: 'test' })
      .expect(403);
    await plugin.destroy();
    config.allowedOrigins = ['https://trusted.example.test'];
    try {
      // Boot a fresh app: the old plugin's route stack is owned by its host in production.
      app = express();
      await plugin.init({
        config,
        logger,
        roomManager: rooms,
        protocolHandler: protocol,
        banManager: { isIpBanned: () => null },
        getExpressApp: () => app,
        readPluginConfig: () => ({}),
      });
      await login(10);
      await request(app)
        .post('/api/admin/toggle-mode')
        .set('Cookie', 'access_token=' + tokens.get(10))
        .set('Origin', 'https://trusted.example.test')
        .send({ roomId: 'private-own' })
        .expect(200);
    } finally {
      config.allowedOrigins = [];
    }
  });

  it.each(routes)(
    'audit: %s %s rejects forged identity and role fields',
    async (method, route, body) => {
      await login(20);
      await call(
        method,
        route,
        {
          ...body,
          roomId: 'private-own',
          creatorId: 20,
          ownerId: 20,
          isAdmin: true,
          isOwner: true,
          isAdminSecretAuthed: true,
        },
        20,
      ).expect(403);
    },
  );

  it('audit: rejects forged tokens, admin secrets and malformed room identifiers', async () => {
    await login(20);
    await call('post', 'toggle-lock', { roomId: 'private-own' }, 999).expect(401);
    await call('post', 'toggle-lock', { roomId: 'private-own' }, 20)
      .set('X-Admin-Secret', 'forged')
      .expect(403);
    for (const roomId of [['private-other', 'private-own'], { id: 'private-own' }, null, 10]) {
      await call('post', 'toggle-lock', { roomId }, 20).expect(400);
    }
    await request(app)
      .get('/api/admin/room-blacklist?roomId=private-other&roomId=private-own')
      .set('Authorization', 'Bearer ' + tokens.get(20))
      .expect(400);
  });

  it.each([1, 2])('retains elevated access for user %s', async (id) => {
    await login(id);
    for (const [method, route, body] of routes) {
      await call(method, route, { roomId: 'private-own', ...body }, id).expect(200);
    }
  });

  it('does not grant global admin permissions to creators', async () => {
    await login(10);
    for (const route of [
      'server-message',
      'broadcast',
      'ban',
      'unban',
      'blacklist-ip',
      'unblacklist-ip',
    ]) {
      await call(
        'post',
        route,
        { content: 'test', type: 'id', target: 20, ip: '127.0.0.1' },
        10,
      ).expect(403);
    }
    await request(app)
      .get('/panel')
      .set('Authorization', 'Bearer ' + tokens.get(10))
      .expect(403);
    await request(app)
      .get('/api/owner/system-info')
      .set('Authorization', 'Bearer ' + tokens.get(10))
      .expect(403);
  });

  it('supports encrypted admin tokens without a login session', async () => {
    const previous = process.env.ADMIN_SECRET;
    const secret = 'creator-test-admin-secret';
    process.env.ADMIN_SECRET = secret;
    try {
      for (const [method, route, body] of routes) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
          'aes-256-cbc',
          crypto.createHash('sha256').update(secret).digest(),
          iv,
        );
        const plain = `${Math.floor(Date.now() / 1000)}_${crypto.randomBytes(8).toString('hex')}_${secret}_xy521`;
        const token = Buffer.concat([iv, cipher.update(plain), cipher.final()]).toString('hex');
        await call(method, route, { roomId: 'private-own', ...body })
          .set('X-Admin-Secret', token)
          .expect(200);
      }
    } finally {
      if (previous === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = previous;
    }
  });

  it('isolates personalized status from the anonymous cache in the actual HTTP host', async () => {
    await login(10);
    expect((await request(app).get('/api/status')).body.rooms).toEqual([]);
    const own = await request(app)
      .get('/api/status')
      .set('Cookie', 'access_token=' + tokens.get(10));
    expect(own.body.rooms).toEqual([
      expect.objectContaining({ id: 'private-own', creatorId: 10, canManage: true }),
    ]);
    expect((await request(app).get('/api/status')).body.rooms).toEqual([]);
  });

  it('rechecks live sessions for HTTP and WebSocket detail/list responses', async () => {
    await login(10);
    const req = { headers: { cookie: 'access_token=' + tokens.get(10) } };
    const socket: any = {
      send: jest.fn(),
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      resolveIdentity: () => app.locals.webDashboardAuth?.(req),
    };
    const ws: any = Object.create(PluginWebSocketServer.prototype);
    Object.assign(ws, {
      roomManager: rooms,
      config,
      logger,
      protocolHandler: protocol,
      limits: { maxBufferedBytes: 1048576, maxOutboundBytes: 524288 },
    });
    ws.sendRoomDetails(socket, 'private-own');
    const details = JSON.parse(socket.send.mock.calls[0][0]).payload;
    expect(details).toMatchObject({ creatorId: 10, canManage: true });
    expect(details.otherRooms).toEqual([]);
    expect(details.players.every((p: any) => !('ip' in p))).toBe(true);
    ws.sendRoomDetails(socket, 'private-other');
    expect(JSON.parse(socket.send.mock.calls[1][0]).payload).toBeNull();
    expect(ws.getSanitizedRoomList(false, 10).map((r: any) => r.id)).toEqual(['private-own']);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 31 * 24 * 3600 * 1000);
    await call('post', 'toggle-lock', { roomId: 'private-own' }, 10).expect(401);
    ws.sendRoomDetails(socket, 'private-own');
    expect(JSON.parse(socket.send.mock.calls[2][0]).payload).toBeNull();
  });

  it('revokes an existing WebSocket identity on logout', async () => {
    await login(10);
    const req = { headers: { cookie: 'access_token=' + tokens.get(10) } };
    expect(app.locals.webDashboardAuth(req)?.userId).toBe(10);
    await request(app)
      .get('/logout')
      .set('Host', 'dashboard.example.test')
      .set('Origin', 'http://dashboard.example.test')
      .set('Cookie', req.headers.cookie)
      .expect(302);
    expect(app.locals.webDashboardAuth(req)).toBeUndefined();
  });

  it('authenticates a real WebSocket connection and revokes access without reconnecting', async () => {
    await login(10);
    protocol.handleConnection = jest.fn();
    protocol.handleDisconnection = jest.fn();
    const server = host.getInternalServer();
    const wsServer = new PluginWebSocketServer(
      server,
      rooms,
      protocol,
      config,
      logger,
      host.getSessionParser(),
      undefined,
      (req: any) => app.locals.webDashboardAuth?.(req),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
      headers: { Cookie: 'access_token=' + tokens.get(10) },
    });
    function message(type: string): Promise<any> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          client.off('message', onMessage);
          reject(new Error('WebSocket timeout'));
        }, 3000);
        function onMessage(raw: WebSocket.RawData) {
          const data = JSON.parse(raw.toString());
          if (data.type === type) {
            clearTimeout(timer);
            client.off('message', onMessage);
            resolve(data.payload);
          }
        }
        client.on('message', onMessage);
      });
    }
    try {
      const list = await message('roomList');
      expect(list).toEqual([expect.objectContaining({ id: 'private-own', canManage: true })]);
      let response = message('roomDetails');
      client.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId: 'private-own' } }));
      expect(await response).toMatchObject({ creatorId: 10, canManage: true });
      await request(app)
        .get('/logout')
        .set('Host', 'dashboard.example.test')
        .set('Origin', 'http://dashboard.example.test')
        .set('Cookie', 'access_token=' + tokens.get(10))
        .expect(302);
      response = message('roomDetails');
      client.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId: 'private-own' } }));
      expect(await response).toBeNull();
      response = message('roomList');
      wsServer.broadcastRooms();
      expect(await response).toEqual([]);
    } finally {
      client.terminate();
      wsServer.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
