import request from 'supertest';
import WebSocket from 'ws';
import { HttpServer } from '../src/network/HttpServer';
import { InMemoryRoomManager } from '../src/domain/rooms/RoomManager';
const { PluginWebSocketServer } = require('../plugins/websocket/res/lib/WebSocketServer.js');

describe('HTTP and WS shared address/ban policy (isolated ephemeral ports)', () => {
  let host: HttpServer;
  let wsServer: any;
  let url: string;
  let clients: WebSocket[];
  let banned: Set<string>;
  let config: any;
  let seenIps: string[];
  const logger: any = Object.fromEntries(
    ['info', 'debug', 'warn', 'error'].map((k) => [k, jest.fn()]),
  );
  async function boot(hops = 0) {
    config = {
      trustProxyHops: hops,
      sessionSecret: 'ip-policy-test-secret',
      serverName: 'Test',
      adminPhiraId: [],
      ownerPhiraId: [],
      allowedOrigins: ['https://trusted.test:444'],
      enablePubWeb: false,
      enablePriWeb: false,
    };
    const rooms = new InMemoryRoomManager(logger);
    rooms.createRoom({
      id: 'a',
      name: 'a',
      ownerId: 1,
      ownerInfo: { id: 1, name: 'User', monitor: false },
      connectionId: 'game',
    });
    const protocol: any = { getSessionCount: () => 1 };
    const bans: any = {
      isIpBanned: (ip: string) => {
        seenIps.push(ip);
        return banned.has(ip) ? { reason: 'banned' } : null;
      },
    };
    host = new HttpServer(config, logger, rooms, protocol, bans);
    wsServer = new PluginWebSocketServer(
      host.getInternalServer(),
      rooms,
      protocol,
      config,
      logger,
      host.getSessionParser(),
      undefined,
      undefined,
      { maxConnectionsPerIp: 1 },
      (ip: string) => Boolean(bans.isIpBanned(ip)),
      host,
    );
    await new Promise<void>((resolve) => host.getInternalServer().listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${(host.getInternalServer().address() as any).port}/ws`;
  }
  function connect(headers: any = {}) {
    const client = new WebSocket(url, { headers });
    clients.push(client);
    client.on('error', () => {});
    return client;
  }
  async function open() {
    const client = connect({ 'X-Real-IP': '9.9.9.9', 'X-Forwarded-For': '8.8.8.8' });
    await new Promise<void>((resolve) => client.once('message', () => resolve()));
    return client;
  }
  async function rejected(headers: any = {}) {
    const client = connect(headers);
    return new Promise<number>((resolve) =>
      client.once('unexpected-response', (_req, res) => {
        res.resume();
        client.terminate();
        resolve(res.statusCode!);
      }),
    );
  }
  beforeEach(() => {
    clients = [];
    banned = new Set();
    seenIps = [];
  });
  afterEach(async () => {
    wsServer?.close();
    clients.forEach((c) => c.terminate());
    if (host) await new Promise<void>((resolve) => host.getInternalServer().close(() => resolve()));
  });
  it('uses one IP key for HTTP limits and WS bans despite forged headers', async () => {
    await boot();
    const client = await open();
    for (let i = 0; i < 60; i++)
      await request(host.getExpressApp())
        .get('/api/status')
        .set('X-Forwarded-For', `198.51.100.${i}`)
        .expect(200);
    await request(host.getExpressApp()).get('/api/status').set('X-Real-IP', '7.7.7.7').expect(429);
    expect(await rejected({ 'X-Real-IP': '6.6.6.6', 'X-Forwarded-For': '5.5.5.5' })).toBe(429);
    expect([...wsServer.ipBudgets.keys()]).toEqual(['127.0.0.1']);
    expect(seenIps.every((ip) => ip === '127.0.0.1')).toBe(true);
    banned.add('127.0.0.1');
    await request(host.getExpressApp()).get('/api/status').set('X-Real-IP', '4.4.4.4').expect(403);
    await request(host.getExpressApp()).get('/api/version').expect(403);
    expect(await rejected({ 'X-Real-IP': '3.3.3.3' })).toBe(403);
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    client.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId: 'a' } }));
    await closed;
  });
  it.each(['push', 'heartbeat'])('revokes already connected banned clients on %s', async (path) => {
    await boot();
    const client = await open();
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    const data = jest.fn();
    client.on('message', data);
    banned.add('127.0.0.1');
    if (path === 'push') wsServer.broadcast('test', { content: 'must not arrive' });
    else wsServer.heartbeat();
    await closed;
    expect(data).not.toHaveBeenCalled();
  });
  it('uses configured proxy hops equally for HTTP and WS and compares complete origins', async () => {
    await boot(1);
    banned.add('198.51.100.7');
    await request(host.getExpressApp())
      .get('/api/status')
      .set('X-Forwarded-For', '198.51.100.7')
      .expect(403);
    expect(await rejected({ 'X-Forwarded-For': '198.51.100.7' })).toBe(403);
    expect(await rejected({ Origin: 'https://trusted.test:445' })).toBe(403);
    expect(await rejected({ Origin: 'http://trusted.test:444' })).toBe(403);
    expect(await rejected({ Origin: 'http://evil.test', 'X-Forwarded-Host': 'evil.test' })).toBe(
      403,
    );
    const client = connect({
      Origin: 'https://trusted.test:444',
      'X-Forwarded-For': '203.0.113.8',
    });
    await new Promise<void>((resolve) => client.once('message', () => resolve()));
    expect([...wsServer.ipBudgets.keys()]).toEqual(['203.0.113.8']);
  });
});
