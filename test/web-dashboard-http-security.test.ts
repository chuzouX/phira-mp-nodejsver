/**
 * web-dashboard 插件的 HTTP 层安全回归测试（真实挂载 + 真实请求）
 *
 * 与 test/web-dashboard-xss.test.ts（纯函数级）互补：本文件把插件真正
 * init() 到一个 express app 上，用 supertest 发真实请求，验证：
 *   1. 安全响应头（CSP / nosniff）确实下发到浏览器
 *   2. CSP 的 connect-src 确实切断了漏洞报告里的 fetch 外带通道
 *   3. serveHtmlWithConfig 注入 window.SERVER_CONFIG 时不会因 `</script>`
 *      越出脚本块（配置型 XSS）
 *   4. 封禁提示改成了 text/plain，浏览器不再把它当 HTML 解析（反射型 XSS）
 *   5. 所有页面依赖的 sanitize.js 真的能被静态服务命中（否则防线整体失效）
 */
import express from 'express';
import request from 'supertest';
import * as path from 'path';

const repoRoot = path.join(__dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginExports = require(path.join(repoRoot, 'plugins/web-dashboard/res/main.js'));
// 编译产物是 CommonJS + `export default`，与 plugins/manager.ts 的取值方式保持一致
const pluginModule = pluginExports.default ?? pluginExports;

/** 触发 `</script>` 越界 / `$&` 展开的配置载荷 */
const SCRIPT_BREAKOUT = '</script><script>alert(1)</script>';
/** 漏洞报告里用于外带 access_token 的外发地址 */
const EXFIL_HOST = 'https://attacker.example/steal';

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    trustProxyHops: 0,
    sessionSecret: 'test-secret-for-jest',
    serverName: 'Test Server',
    displayIp: 'test.example:666',
    captchaProvider: 'none',
    loginBlacklistDuration: 600,
    adminPhiraId: [1],
    ownerPhiraId: [2],
    enablePubWeb: false,
    pubPrefix: 'pub',
    enablePriWeb: false,
    priPrefix: 'sm',
    allowedOrigins: [],
    defaultAvatar: 'https://phira.5wyxi.com/avatar.png',
    ...overrides,
  };
}

interface Harness {
  app: express.Express;
  banReason: string | null;
}

async function boot(configOverrides: Record<string, any> = {}): Promise<Harness> {
  const app = express();
  const harness: Harness = { app, banReason: null };

  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    mark: jest.fn(),
    ban: jest.fn(),
    plugin: jest.fn(),
  };

  const api: any = {
    config: makeConfig(configOverrides),
    logger,
    roomManager: { listRooms: () => [] },
    protocolHandler: { getSessionCount: () => 0, getAllSessions: () => [] },
    banManager: {
      isIpBanned: () =>
        harness.banReason === null ? null : { reason: harness.banReason, expiresAt: Date.now() + 60000 },
    },
    federationManager: undefined,
    getExpressApp: () => app,
    readPluginConfig: () => ({}),
  };

  await pluginModule.init(api);
  return harness;
}

describe('web-dashboard HTTP 安全回归', () => {
  let harness: Harness;

  afterEach(async () => {
    if (harness) await pluginModule.destroy();
  });

  describe('安全响应头', () => {
    beforeEach(async () => {
      harness = await boot();
    });

    it('下发 CSP，且 connect-src 切断漏洞报告中的 fetch 外带通道', async () => {
      const res = await request(harness.app).get('/').expect(200);

      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      // 关键：只允许同源 + WebSocket，攻击者域不在白名单内
      expect(csp).toContain("connect-src 'self' ws: wss:");
      expect(csp).not.toContain('attacker.example');
      // 阻断 <base> 劫持与插件类载体
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("object-src 'none'");
      // 防点击劫持
      expect(csp).toContain("frame-ancestors 'self'");
      // 防表单外发
      expect(csp).toContain("form-action 'self'");
    });

    it('下发 nosniff，阻止响应被嗅探成 HTML', async () => {
      const res = await request(harness.app).get('/').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });
  });

  describe('serveHtmlWithConfig 的配置注入', () => {
    it('serverName 含 </script> 时不会越出脚本块（配置型 XSS）', async () => {
      // 基线：良性 serverName 下的 <script> 标签数量
      harness = await boot({ serverName: 'Benign Server' });
      const baseline = await request(harness.app).get('/').expect(200);
      const baselineCount = (baseline.text.match(/<script\b/gi) || []).length;
      await pluginModule.destroy();

      // 恶意 serverName 不应**新增**任何脚本标签
      harness = await boot({ serverName: SCRIPT_BREAKOUT });
      const res = await request(harness.app).get('/').expect(200);

      expect(res.text).toContain('window.SERVER_CONFIG');
      // 危险字符被转义成 \u003c，注入体仍留在原脚本块的字符串里
      expect(res.text).toContain('\\u003c/script\\u003e');
      expect(res.text).not.toContain(SCRIPT_BREAKOUT);

      const injectedCount = (res.text.match(/<script\b/gi) || []).length;
      expect(injectedCount).toBe(baselineCount);
    });

    it('displayIp 含 $& 时不会被 String.replace 展开成匹配内容', async () => {
      harness = await boot({ displayIp: '$&$&INJECTED' });

      const res = await request(harness.app).get('/').expect(200);

      // "$&" 若被当作特殊模式展开，就会把匹配到的 "</head>" 插入配置值里
      expect(res.text).not.toContain('INJECTED</head>');
      expect(res.text).toContain('INJECTED');
    });

    it('/room?id=x 也走同一套注入与转义', async () => {
      harness = await boot({ serverName: SCRIPT_BREAKOUT });
      const res = await request(harness.app).get('/room?id=abc').expect(200);
      expect(res.text).toContain('\\u003c/script\\u003e');
      expect(res.text).not.toContain(SCRIPT_BREAKOUT);
    });
  });

  describe('封禁提示的反射型 XSS', () => {
    it('改为 text/plain，载荷不会被浏览器解析成元素', async () => {
      harness = await boot();
      harness.banReason = '<img src=x onerror=alert(document.cookie)>';

      const res = await request(harness.app).get('/');

      expect(res.status).toBe(403);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.headers['content-type']).not.toMatch(/text\/html/);
    });
  });

  describe('静态资源可用性（防线的前提）', () => {
    beforeEach(async () => {
      harness = await boot();
    });

    it('sanitize.js 能被取到，且导出编码函数', async () => {
      const res = await request(harness.app).get('/sanitize.js').expect(200);
      expect(res.text).toContain('escapeHtml');
      expect(res.text).toContain('escapeJs');
      expect(res.text).toContain('safeUrl');
    });

    it('每个页面都在 i18n.js 之前加载 sanitize.js', async () => {
      const pages = ['/', '/room?id=x'];
      for (const page of pages) {
        const res = await request(harness.app).get(page).expect(200);
        const sanitizeAt = res.text.indexOf('sanitize.js');
        const i18nAt = res.text.indexOf('i18n.js');
        expect(sanitizeAt).toBeGreaterThan(-1);
        expect(i18nAt).toBeGreaterThan(-1);
        // 必须先加载 sanitize.js，否则 i18n.tHtml / esc 在运行时是 undefined
        expect(sanitizeAt).toBeLessThan(i18nAt);
      }
    });

    it('全部 6 个页面都在 i18n.js 之前加载 sanitize.js', async () => {
      // 其中 /panel.html、/players.html 等被设计为 302 跳转（或需鉴权），
      // 因此这里直接校验磁盘上的页面文件；HTTP 服务链路已由上面的
      // 用例（/ 与 /room、/sanitize.js 均 200）覆盖。
      const fs = require('fs');
      const pages = [
        'index.html',
        'room.html',
        'players.html',
        'panel.html',
        'admin.html',
        'login.html',
      ];
      for (const file of pages) {
        const text = fs.readFileSync(
          path.join(repoRoot, 'plugins/web-dashboard/res/public', file),
          'utf8',
        );
        const sanitizeAt = text.indexOf('sanitize.js');
        const i18nAt = text.indexOf('i18n.js');
        expect(sanitizeAt).toBeGreaterThan(-1);
        expect(i18nAt).toBeGreaterThan(-1);
        // 顺序至关重要：任何页面漏掉 sanitize.js，其 esc()/I18n.tHtml() 都会
        // 在运行时变成 undefined，防线整体失效。
        expect(sanitizeAt).toBeLessThan(i18nAt);
      }
    });
  });
});
