import { createServer, Server } from 'http';
import WebSocket from 'ws';
import { InMemoryRoomManager } from '../src/domain/rooms/RoomManager';
jest.mock('../plugins/websocket/res/lib/WebSocketServer', () =>
  jest.requireActual('../plugins/websocket/res/lib/WebSocketServer.js'),
);
const { PluginWebSocketServer } = require('../plugins/websocket/res/lib/WebSocketServer.js');

describe('WebSocket resource budgets (isolated ephemeral ports)', () => {
  let server: Server;
  let instance: any;
  let rooms: InMemoryRoomManager;
  let address: string;
  let clients: WebSocket[];
  const logger: any = Object.fromEntries(
    ['info', 'debug', 'warn', 'error'].map((k) => [k, jest.fn()]),
  );
  const protocol: any = {
    getSessionCount: () => 3,
    handleConnection: jest.fn(),
    handleDisconnection: jest.fn(),
  };
  const parser = jest.fn();
  const config: any = {
    trustProxyHops: 0,
    allowedOrigins: [],
    adminPhiraId: [],
    ownerPhiraId: [],
    serverName: 'Test',
  };
  async function boot(limits: any = {}, banned = false, federation: any = undefined) {
    instance = new PluginWebSocketServer(
      server,
      rooms,
      protocol,
      config,
      logger,
      parser,
      federation,
      undefined,
      limits,
      () => banned,
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    address = `ws://127.0.0.1:${(server.address() as any).port}`;
  }
  function connect(path = '/ws', options: any = {}): WebSocket {
    const client = new WebSocket(address + path, options);
    clients.push(client);
    client.on('error', () => {});
    return client;
  }
  function message(client: WebSocket, type: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.off('message', receive);
        reject(new Error(`Missing ${type}`));
      }, 2000);
      function receive(raw: WebSocket.RawData) {
        const value = JSON.parse(raw.toString());
        if (value.type === type) {
          clearTimeout(timer);
          client.off('message', receive);
          resolve(value.payload);
        }
      }
      client.on('message', receive);
    });
  }
  async function open() {
    const client = connect();
    await message(client, 'roomList');
    return client;
  }
  function closed(client: WebSocket): Promise<number> {
    return new Promise((resolve) => client.once('close', (code) => resolve(code)));
  }
  async function rejected(path: string, options: any = {}) {
    const client = connect(path, options);
    return new Promise<number>((resolve) =>
      client.once('unexpected-response', (_req, res) => {
        res.resume();
        client.terminate();
        resolve(res.statusCode!);
      }),
    );
  }

  it('normalizes untrusted federation counts in every room snapshot without mutation', async () => {
    const remote: any = { id: 'remote', name: 'Remote', ownerId: 2, players: [], state: {} };
    await boot({}, false, { getRemoteRooms: () => [remote] });
    for (const value of [
      '<img src=x onerror=alert(1)>',
      '8',
      null,
      {},
      -1,
      1.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
      0,
      8,
    ]) {
      remote.playerCount = value;
      remote.maxPlayers = value;
      const expected =
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
      const snapshots = [
        instance.getSanitizedRoomList().find((room: any) => room.id === remote.id),
        instance.getSanitizedRemoteRoomDetails(remote),
        instance
          .getSanitizedRoomDetails(rooms.getRoom('a'))
          .otherRooms.find((room: any) => room.id === remote.id),
      ];
      for (const snapshot of snapshots)
        expect(snapshot).toMatchObject({ playerCount: expected, maxPlayers: expected });
      expect(remote.playerCount).toBe(value);
      expect(remote.maxPlayers).toBe(value);
    }
  });

  beforeEach(() => {
    instance = undefined;
    server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    clients = [];
    rooms = new InMemoryRoomManager(logger);
    for (const id of ['a', 'b'])
      rooms.createRoom({
        id,
        name: id,
        ownerId: id === 'a' ? 1 : 2,
        ownerInfo: { id: id === 'a' ? 1 : 2, name: id, monitor: false },
        connectionId: id,
      });
    jest.clearAllMocks();
  });
  afterEach(async () => {
    instance?.close();
    clients.forEach((client) => client.terminate());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.restoreAllMocks();
  });

  it('restricts the upgrade path and checks full origin, banned IPs and proxy trust', async () => {
    await boot();
    expect(await rejected('/anything')).toBe(404);
    expect(await rejected('/')).toBe(404);
    expect(await rejected('/ws', { origin: 'https://evil.test' })).toBe(403);
    const client = await open();
    expect(client.extensions).toBe('');
    expect(parser).not.toHaveBeenCalled();
    expect(protocol.handleConnection).not.toHaveBeenCalled();
    expect(
      instance.getClientIp({
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '8.8.8.8' },
      }),
    ).toBe('127.0.0.1');
    instance.isIpBanned = () => true;
    expect(await rejected('/ws')).toBe(403);
  });

  it('neutralizes local, federated, cached and generic display fields at the real WS boundary', async () => {
    const tainted = '<img src=x>\u0000\u202e🎵';
    const clean = 'img src=x🎵';
    const url = 'https://cdn.test/<keep>?x=1&y=2';
    const room = rooms.getRoom('a')!;
    room.name = tainted;
    const player = room.players.get(1)!;
    player.user.name = tainted;
    player.bio = tainted;
    (player as any)._title = tainted;
    room.selectedChart = {
      id: 1,
      name: tainted,
      composer: tainted,
      charter: tainted,
      illustration: url,
      uploaderInfo: { id: 1, name: tainted, bio: tainted, rks: 1, avatar: url },
    };
    rooms.getRoom('b')!.name = tainted;
    rooms.addMessageToRoom('a', { type: 'Chat', user: 1, content: tainted, senderName: tainted });
    const remote = {
      id: 'remote<id>',
      name: tainted,
      nodeName: tainted,
      nodeId: 'node<id>',
      ownerId: 2,
      players: [{ id: 2, name: tainted, avatar: url }],
      maxPlayers: 8,
      playerCount: 1,
      state: { type: 'SelectChart', chartName: tainted },
      selectedChart: { name: tainted, illustration: url },
      messages: [
        { type: 'Chat', user: 2, content: tainted, senderName: tainted, userName: tainted },
      ],
    };
    const original = JSON.stringify({
      room: { name: room.name, chart: room.selectedChart, messages: room.messages },
      remote,
    });
    const previousName = config.serverName;
    config.serverName = tainted;
    try {
      await boot({}, false, {
        getRemoteRooms: () => [remote],
        getRemoteRoomInfo: (id: string) => (id === remote.id ? remote : undefined),
      });
      const client = connect();
      const list = await message(client, 'roomList');
      expect(list.find((r: any) => r.id === 'a')).toMatchObject({
        name: clean,
        ownerName: clean,
        serverName: clean,
        state: { chartName: clean },
      });
      expect(list.find((r: any) => r.id === remote.id)).toMatchObject({
        name: clean,
        serverName: clean,
        nodeId: 'node<id>',
      });
      let response = message(client, 'roomDetails');
      client.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId: 'a' } }));
      const details = await response;
      expect(details).toMatchObject({
        name: clean,
        selectedChart: {
          name: clean,
          composer: clean,
          charter: clean,
          illustration: url,
          uploaderInfo: { name: clean, bio: clean, avatar: url },
        },
      });
      expect(details.players.find((p: any) => p.id === 1)).toMatchObject({
        name: clean,
        bio: clean,
        title: clean,
      });
      expect(details.players[0].name).toBe(clean);
      expect(details.messages[0]).toMatchObject({
        content: clean,
        userName: clean,
        senderName: clean,
      });
      expect(details.otherRooms[0].name).toBe(clean);
      response = message(client, 'roomDetails');
      client.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId: remote.id } }));
      const foreign = await response;
      expect(foreign).toMatchObject({
        id: remote.id,
        name: clean,
        serverName: clean,
        state: { chartName: clean },
        selectedChart: { name: clean, illustration: url },
      });
      expect(foreign.players.find((p: any) => p.id === 2)).toMatchObject({
        name: clean,
        avatar: url,
      });
      expect(foreign.messages[0]).toMatchObject({
        content: clean,
        senderName: clean,
        userName: clean,
      });
      response = message(client, 'roomList');
      instance.broadcastRooms();
      expect((await response).find((r: any) => r.id === 'a').name).toBe(clean);
      response = message(client, 'custom-display');
      instance.broadcast('custom-display', {
        name: tainted,
        nested: { serverName: tainted, title: tainted },
        id: 'id<keep>',
        url,
        unknownLabel: tainted,
      });
      expect(await response).toEqual({
        name: clean,
        nested: { serverName: clean, title: clean },
        id: 'id<keep>',
        url,
        unknownLabel: tainted,
      });
      expect(
        JSON.stringify({
          room: { name: room.name, chart: room.selectedChart, messages: room.messages },
          remote,
        }),
      ).toBe(original);
    } finally {
      config.serverName = previousName;
    }
  });

  it('enforces message size before parsing and rejects binary or malformed messages', async () => {
    await boot({ maxPayload: 64 });
    for (const [payload, expected] of [
      ['x'.repeat(65), 1009],
      [Buffer.from('hi'), 1008],
      ['null', 1008],
      ['{', 1008],
    ] as const) {
      const client = await open();
      const close = closed(client);
      client.send(payload);
      expect(await close).toBe(expected);
    }
  });

  it('limits per-connection and shared IP detail requests before expensive work', async () => {
    await boot({ messagesPerSecond: 2, messagesPerIpPerSecond: 3 });
    const first = await open();
    const second = await open();
    const details = jest.spyOn(instance, 'getSanitizedRoomDetails');
    const request = JSON.stringify({ type: 'getRoomDetails', payload: { roomId: 'a' } });
    let response = message(first, 'roomDetails');
    first.send(request);
    await response;
    response = message(first, 'roomDetails');
    first.send(request);
    await response;
    let close = closed(first);
    first.send(request);
    expect(await close).toBe(1008);
    response = message(second, 'roomDetails');
    second.send(request);
    await response;
    close = closed(second);
    second.send(request);
    expect(await close).toBe(1008);
    expect(details).toHaveBeenCalledTimes(3);
  });

  it('caps active connections and upgrade bursts even if forwarding headers are spoofed', async () => {
    await boot({
      maxConnections: 2,
      maxConnectionsPerIp: 1,
      upgradeBurst: 2,
      upgradesPerSecond: 1,
    });
    const client = await open();
    expect(
      await rejected('/ws', { headers: { 'X-Real-IP': '8.8.8.8', 'X-Forwarded-For': '8.8.8.8' } }),
    ).toBe(429);
    const close = closed(client);
    client.terminate();
    await close;
    expect(await rejected('/ws')).toBe(429);
    expect(instance.connectionCount).toBe(0);
  });

  it('enforces the global connection cap independently of the IP cap', async () => {
    await boot({ maxConnections: 1, maxConnectionsPerIp: 2 });
    await open();
    expect(await rejected('/ws')).toBe(429);
    expect(instance.connectionCount).toBe(1);
  });

  it('routes plugin chat events only to room details and game connections only to stats', async () => {
    const plugin = require('../plugins/websocket/res/main.js').default;
    const handlers = new Map<string, (event: any) => void>();
    const roomLists = jest.spyOn(PluginWebSocketServer.prototype, 'broadcastRooms');
    const details = jest.spyOn(PluginWebSocketServer.prototype, 'broadcastRoomDetails');
    const stats = jest.spyOn(PluginWebSocketServer.prototype, 'broadcastStats');
    await plugin.init({
      config,
      logger,
      roomManager: rooms,
      protocolHandler: protocol,
      banManager: { isIpBanned: () => null },
      httpServer: { getInternalServer: () => server, getSessionParser: () => parser },
      readPluginConfig: () => ({}),
      getExpressApp: () => undefined,
      events: {
        on: (name: string, fn: (event: any) => void) => {
          handlers.set(name, fn);
          return () => handlers.delete(name);
        },
      },
    });
    try {
      handlers.get('chat:message')!({ room: { id: 'a' } });
      handlers.get('player:connect')!({});
      expect(details).toHaveBeenCalledWith('a');
      expect(stats).toHaveBeenCalledTimes(1);
      expect(roomLists).not.toHaveBeenCalled();
      handlers.get('room:join')!({ room: { id: 'b' } });
      expect(roomLists).toHaveBeenCalledTimes(1);
      expect(details).toHaveBeenCalledWith('b');
    } finally {
      await plugin.destroy();
    }
    expect(handlers.size).toBe(0);
    expect(server.listenerCount('upgrade')).toBe(0);
  });

  it('coalesces room broadcasts and only pushes chat details to matching subscribers', async () => {
    await boot({ broadcastIntervalMs: 50 });
    const first = await open();
    const second = await open();
    let response = message(first, 'roomDetails');
    first.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId: 'a' } }));
    await response;
    response = message(second, 'roomDetails');
    second.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId: 'b' } }));
    await response;
    const counts = { firstLists: 0, secondLists: 0, firstDetails: 0, secondDetails: 0 };
    first.on('message', (raw) => {
      const type = JSON.parse(raw.toString()).type;
      if (type === 'roomList') counts.firstLists++;
      if (type === 'roomDetails') counts.firstDetails++;
    });
    second.on('message', (raw) => {
      const type = JSON.parse(raw.toString()).type;
      if (type === 'roomList') counts.secondLists++;
      if (type === 'roomDetails') counts.secondDetails++;
    });
    const lists = jest.spyOn(instance, 'getSanitizedRoomList');
    const one = message(first, 'roomList');
    const two = message(second, 'roomList');
    for (let i = 0; i < 20; i++) instance.broadcastRooms();
    await Promise.all([one, two]);
    expect(counts.firstLists).toBe(1);
    expect(counts.secondLists).toBe(1);
    expect(lists).toHaveBeenCalledTimes(1); // one anonymous serialization per flush
    const updated = message(first, 'roomDetails');
    for (let i = 0; i < 20; i++) instance.broadcastRoomDetails('a');
    await updated;
    expect(counts.firstDetails).toBe(1);
    expect(counts.secondDetails).toBe(0);
    expect(counts.firstLists).toBe(1);
  });

  it('terminates stale and slow clients, bounds snapshots and removes timers/listeners on close', async () => {
    await boot();
    const client = await open();
    const serverClient: any = [...instance.wss.clients][0];
    const previousPong = Date.now() - 1;
    serverClient.lastPong = previousPong;
    const pong = new Promise<void>((resolve) => serverClient.once('pong', () => resolve()));
    instance.heartbeat();
    await pong;
    expect(serverClient.lastPong).toBeGreaterThan(previousPong);
    for (let i = 0; i < 70; i++)
      rooms.addMessageToRoom('a', { type: 'Chat', user: 1, content: String(i) });
    expect(instance.getSanitizedRoomDetails(rooms.getRoom('a')).messages).toHaveLength(50);
    const terminate = jest.spyOn(serverClient, 'terminate');
    Object.defineProperty(serverClient, 'bufferedAmount', {
      get: () => 2 * 1024 * 1024,
      configurable: true,
    });
    const close = closed(client);
    instance.executeBroadcast();
    expect(terminate).toHaveBeenCalled();
    await close;
    const next = await open();
    const nextServer: any = [...instance.wss.clients][0];
    nextServer.lastPong = Date.now() - 60001;
    const stale = closed(next);
    instance.heartbeat();
    await stale;
    const third = await open();
    const thirdClose = closed(third);
    instance.broadcastRooms();
    expect(server.listenerCount('upgrade')).toBe(1);
    instance.close();
    await thirdClose;
    expect(server.listenerCount('upgrade')).toBe(0);
    expect(instance.broadcastTimer).toBeNull();
    expect(instance.ipBudgets.size).toBe(0);
  });
});
