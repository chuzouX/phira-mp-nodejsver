import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import http from 'http';
import path from 'path';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import plugin from '../plugins/server-control/res/main';

describe('server-control security surface', () => {
  const app = express();
  const password = 'security-test-password';
  const salt = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  const passwordHash = `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  const executeConsoleCommand = jest.fn(async () => undefined);
  const createdFiles = [
    path.join(process.cwd(), 'config', 'security-test', 'secrets.json'),
    path.join(process.cwd(), 'logs', 'server-2099-02-03.log'),
  ];

  beforeAll(async () => {
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: true, limit: '2mb' }));
    app.use(cookieParser());
    await plugin.init({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      config: {},
      getExpressApp: () => app,
      readPluginConfig: () => ({ passwordHash, sampleIntervalMs: 60_000, maxLogStreams: 1 }),
      getOnlinePlayers: () => [],
      getRooms: () => [],
      listPlugins: () => [{ directory: 'server-control', enabled: true, loaded: true }],
      reloadPlugin: jest.fn(async () => true),
      reloadServerConfig: jest.fn(() => true),
      executeConsoleCommand,
      registerCommand: jest.fn(),
    } as any);
  });

  afterAll(async () => {
    await plugin.destroy?.();
    for (const file of createdFiles) if (fs.existsSync(file)) fs.unlinkSync(file);
    const directory = path.join(process.cwd(), 'config', 'security-test');
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  });

  async function login() {
    const response = await request(app)
      .post('/control/api/auth/login')
      .send({ password })
      .expect(200);
    return { cookie: response.headers['set-cookie'], csrf: response.body.csrf as string };
  }

  it('protects every authenticated read endpoint', async () => {
    const routes = [
      '/control/api/auth/session',
      '/control/api/metrics',
      '/control/api/users',
      '/control/api/plugins',
      '/control/api/logs/stream',
      '/control/api/log-history/files',
      '/control/api/log-history/analyze?name=command.log',
      '/control/api/log-history/lines?name=command.log&offset=0',
      '/control/api/files',
      '/control/api/file?path=.env',
    ];
    for (const route of routes) await request(app).get(route).expect(401);
  });

  it('requires CSRF for every state-changing endpoint', async () => {
    const session = await login();
    const mutations = [
      ['/control/api/auth/logout', 'post', {}],
      ['/control/api/command', 'post', { input: '/status' }],
      ['/control/api/file/reveal', 'post', { path: '.env' }],
      ['/control/api/file', 'put', { path: 'config/security-test.json', content: '{}' }],
      ['/control/api/reload/plugin', 'post', { name: 'missing' }],
      ['/control/api/reload/config', 'post', {}],
    ] as const;
    for (const [route, method, body] of mutations) {
      const call = request(app)[method](route).set('Cookie', session.cookie).send(body);
      await call.expect(403);
    }
  });

  it('rejects unauthenticated mutations before CSRF validation', async () => {
    await request(app).post('/control/api/auth/logout').expect(401);
    await request(app).post('/control/api/command').send({ input: '/status' }).expect(401);
    await request(app).post('/control/api/file/reveal').send({ path: '.env' }).expect(401);
    await request(app)
      .put('/control/api/file')
      .send({ path: 'config/security-test.json', content: '{}' })
      .expect(401);
    await request(app).post('/control/api/reload/plugin').send({ name: 'example' }).expect(401);
    await request(app).post('/control/api/reload/config').expect(401);
  });

  it('rejects traversal and arbitrary file names in every file/log endpoint', async () => {
    const session = await login();
    await request(app)
      .get('/control/api/file?path=../package.json')
      .set('Cookie', session.cookie)
      .expect(400);
    await request(app)
      .post('/control/api/file/reveal')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ path: '../package.json' })
      .expect(400);
    await request(app)
      .put('/control/api/file')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ path: '../package.json', content: '{}' })
      .expect(400);
    await request(app)
      .get('/control/api/log-history/analyze?name=../package.json')
      .set('Cookie', session.cookie)
      .expect(404);
    await request(app)
      .get('/control/api/log-history/lines?name=../package.json&offset=0')
      .set('Cookie', session.cookie)
      .expect(404);
  });

  it('masks secrets and only reveals them through a CSRF-protected request', async () => {
    const file = createdFiles[0];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ token: 'do-not-leak', enabled: true }));
    const session = await login();
    const masked = await request(app)
      .get('/control/api/file?path=config/security-test/secrets.json')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(masked.body.content).not.toContain('do-not-leak');
    await request(app)
      .post('/control/api/file/reveal')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ path: 'config/security-test/secrets.json' })
      .expect(200)
      .expect((response) => expect(response.body.content).toContain('do-not-leak'));
  });

  it('validates command and historical cursor boundaries', async () => {
    fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'logs', 'server-2099-02-03.log'), '');
    const session = await login();
    await request(app)
      .post('/control/api/command')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ input: 'status' })
      .expect(400);
    await request(app)
      .post('/control/api/command')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ input: `/${'x'.repeat(512)}` })
      .expect(400);
    await request(app)
      .get('/control/api/log-history/lines?name=server-2099-02-03.log&offset=-1')
      .set('Cookie', session.cookie)
      .expect(400);
    await request(app)
      .get('/control/api/log-history/lines?name=server-2099-02-03.log&offset=not-a-number')
      .set('Cookie', session.cookie)
      .expect(400);
    expect(executeConsoleCommand).not.toHaveBeenCalledWith('status');
  });

  it('invalidates a session on logout', async () => {
    const session = await login();
    const cookie = String(session.cookie);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/control');
    await request(app)
      .post('/control/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .expect(200);
    await request(app).get('/control/api/metrics').set('Cookie', session.cookie).expect(401);
  });

  it('limits concurrent live log streams', async () => {
    const session = await login();
    const server = await new Promise<http.Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind TCP');
    const cookie = Array.isArray(session.cookie)
      ? session.cookie.join('; ')
      : String(session.cookie);
    let firstResponse: http.IncomingMessage | undefined;
    const firstRequest = await new Promise<http.ClientRequest>((resolve, reject) => {
      const liveRequest = http.get(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/control/api/logs/stream',
          headers: { Cookie: cookie },
        },
        (response) => {
          firstResponse = response;
          response.resume();
          if (response.statusCode === 200) resolve(liveRequest);
          else reject(new Error(`Unexpected SSE status ${response.statusCode}`));
        },
      );
      liveRequest.on('error', reject);
    });
    try {
      await request(server)
        .get('/control/api/logs/stream')
        .set('Cookie', session.cookie)
        .expect(429);
    } finally {
      firstResponse?.destroy();
      firstRequest.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('serializes concurrent login failures before enforcing the lock', async () => {
    const auditFile = path.join(process.cwd(), 'logs', 'server-control-audit.log');
    const auditOffset = fs.existsSync(auditFile) ? fs.statSync(auditFile).size : 0;
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app).post('/control/api/auth/login').send({ password: 'wrong-password' }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      401, 401, 401, 401, 401, 429,
    ]);
    const failures = fs
      .readFileSync(auditFile, 'utf8')
      .slice(auditOffset)
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.action === 'login-failed');
    expect(failures.length).toBe(5);
    expect(failures[0].ip).toBeDefined();
    expect(failures[0].attempts).toBe(1);
    expect(failures[4].ip).toBeDefined();
    expect(failures[4].lockedUntil).toBeGreaterThan(Date.now());
  });
});
