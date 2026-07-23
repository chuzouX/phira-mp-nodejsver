import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import plugin from '../plugins/server-control/res/main';

describe('server-control plugin', () => {
  const app = express();
  const password = 'test-control-password';
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  const passwordHash = `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  const reloadServerConfig = jest.fn(() => true);
  const executeConsoleCommand = jest.fn(async () => undefined);
  const registerCommand = jest.fn();
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeAll(async () => {
    app.use(express.json());
    app.use(cookieParser());
    const api: any = {
      logger,
      config: {},
      getExpressApp: () => app,
      readPluginConfig: () => ({ passwordHash, sampleIntervalMs: 60_000 }),
      getOnlinePlayers: () => [],
      getRooms: () => [],
      listPlugins: () => [{ directory: 'server-control', enabled: true, loaded: true }],
      reloadPlugin: jest.fn(async () => true),
      reloadServerConfig,
      executeConsoleCommand,
      registerCommand,
    };
    await plugin.init(api);
  });

  afterAll(async () => {
    await plugin.destroy?.();
    for (const name of ['server-2099-01-02.log', 'command.log', 'ban.log']) {
      const file = path.join(process.cwd(), 'logs', name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  it('rejects protected endpoints without a session', async () => {
    await request(app).get('/control/api/metrics').expect(401);
    await request(app).get('/control/api/logs/stream').expect(401);
  });

  it('authenticates and enforces CSRF on mutations', async () => {
    const login = await request(app).post('/control/api/auth/login').send({ password }).expect(200);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();

    await request(app).get('/control/api/metrics').set('Cookie', cookie).expect(200);
    await request(app).post('/control/api/reload/config').set('Cookie', cookie).expect(403);
    await request(app)
      .post('/control/api/reload/config')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', login.body.csrf)
      .expect(200, { success: true });
    expect(reloadServerConfig).toHaveBeenCalledTimes(1);

    await request(app)
      .post('/control/api/command')
      .set('Cookie', cookie)
      .send({ input: '/status' })
      .expect(403);
    await request(app)
      .post('/control/api/command')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', login.body.csrf)
      .send({ input: '/status' })
      .expect(202, { accepted: true });
    expect(executeConsoleCommand).toHaveBeenCalledWith('/status');
  });

  it('registers helper console commands without changing the password configuration', () => {
    expect(registerCommand).toHaveBeenCalledWith('server-control', expect.any(Function), {
      redactInput: true,
    });
    const handler = registerCommand.mock.calls[0][1] as (...args: string[]) => void;
    handler('hash', 'a-long-console-password');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[ServerControl\] generated passwordHash: scrypt\$/),
    );
    handler('password', 'replacement-password');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('password changes are disabled from the console'),
    );
  });

  it('lists and analyzes supported historical log types', async () => {
    const logDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'server-2099-01-02.log'),
      '[2099-01-02 10:00:00.000] [INFO] started\n[2099-01-02 10:01:00.000] [ERROR] failed\n',
    );
    fs.writeFileSync(
      path.join(logDir, 'command.log'),
      '[2099-01-02 10:00:00.000] [CMD] 执行指令: /status\n',
    );
    fs.writeFileSync(
      path.join(logDir, 'ban.log'),
      '[2099-01-02 10:00:00.000] [BAN] 用户 ID 42 已被 System 封禁。\n[2099-01-02 10:01:00.000] [BAN] 用户 ID 42 已被 System 解封。\n',
    );
    const login = await request(app).post('/control/api/auth/login').send({ password }).expect(200);
    const cookie = login.headers['set-cookie'];
    const files = await request(app)
      .get('/control/api/log-history/files')
      .set('Cookie', cookie)
      .expect(200);
    expect(files.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'server-2099-01-02.log', kind: 'game' }),
        expect.objectContaining({ name: 'command.log', kind: 'commands' }),
        expect.objectContaining({ name: 'ban.log', kind: 'bans' }),
        expect.objectContaining({ name: 'server-control-audit.log', kind: 'control' }),
      ]),
    );
    const readFileSync = jest.spyOn(fs, 'readFileSync');
    const game = await request(app)
      .get('/control/api/log-history/analyze?name=server-2099-01-02.log')
      .set('Cookie', cookie)
      .expect(200);
    expect(readFileSync).not.toHaveBeenCalled();
    readFileSync.mockRestore();
    expect(game.body.levels).toEqual(expect.objectContaining({ INFO: 1, ERROR: 1 }));
    const chunk = await request(app)
      .get('/control/api/log-history/lines?name=server-2099-01-02.log&offset=0')
      .set('Cookie', cookie)
      .expect(200);
    expect(chunk.body.lines).toHaveLength(2);
    expect(chunk.body.hasMore).toBe(false);
    fs.appendFileSync(
      path.join(logDir, 'server-2099-01-02.log'),
      '[2099-01-02 10:02:00.000] [WARN] changed\n',
    );
    const refreshed = await request(app)
      .get('/control/api/log-history/analyze?name=server-2099-01-02.log')
      .set('Cookie', cookie)
      .expect(200);
    expect(refreshed.body.levels).toEqual(expect.objectContaining({ INFO: 1, ERROR: 1, WARN: 1 }));
    const commands = await request(app)
      .get('/control/api/log-history/analyze?name=command.log')
      .set('Cookie', cookie)
      .expect(200);
    expect(commands.body.commands).toEqual(expect.objectContaining({ '/status': 1 }));
    const bans = await request(app)
      .get('/control/api/log-history/analyze?name=ban.log')
      .set('Cookie', cookie)
      .expect(200);
    expect(bans.body.bans).toEqual(expect.objectContaining({ created: 1, removed: 1 }));
    expect(bans.body.targets).toEqual(expect.objectContaining({ '42': 2 }));
    const control = await request(app)
      .get('/control/api/log-history/analyze?name=server-control-audit.log')
      .set('Cookie', cookie)
      .expect(200);
    expect(control.body.login.success).toBeGreaterThan(0);
  });
});
