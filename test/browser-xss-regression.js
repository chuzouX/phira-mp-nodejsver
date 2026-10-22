/** Native-browser XSS-1 regression helper. Pass current sanitize/app/players/panel source strings.
 * Uses real DOM parsing and event dispatch with stubbed network/confirmation; no live service traffic.
 */
async function runDashboardXssRegression(sources) {
  const passed = [];
  const check = (condition, label) => {
    if (!condition) throw new Error(label);
    passed.push(label);
  };
  new Function(sources.sanitize)();
  const payload = '" onmouseover="window.__xssInjected=1" x="';
  window.__xssInjected = 0;
  const baseline = new DOMParser().parseFromString(
    '<button onclick="f(\'' + payload.replace(/"/g, '\\"') + '\')">x</button>',
    'text/html',
  );
  check(
    baseline.querySelector('button').hasAttribute('onmouseover'),
    'positive control reproduces legacy attribute injection',
  );
  for (const value of [
    payload,
    "' onmouseover='window.__xssInjected=1' x='",
    '&quot; onfocus=bad x=&quot;',
    '\\"\n<>&',
  ]) {
    const encoded = window.escapeJs(value);
    for (const quote of ['"', "'"]) {
      const jsQuote = quote === '"' ? "'" : '"';
      const doc = new DOMParser().parseFromString(
        '<button onclick=' +
          quote +
          'f(' +
          jsQuote +
          encoded +
          jsQuote +
          ')' +
          quote +
          '>x</button>',
        'text/html',
      );
      const button = doc.querySelector('button');
      check(
        button.getAttributeNames().length === 1,
        'encoded string stays in one quoted HTML attribute',
      );
      let captured;
      new Function('f', button.getAttribute('onclick'))((value) => {
        captured = value;
      });
      check(captured === value, 'HTML parsing and JS evaluation preserve the original value');
    }
  }
  document.body.innerHTML =
    '<div id="user-menu"></div><div id="player-list-container"></div><div id="empty-players"></div><div id="player-status"></div>' +
    '<div id="all-players-list"></div><div id="total-players"></div><table><tbody id="login-blacklist-body"></tbody><tbody id="ip-ban-list-body"></tbody></table>';
  const i18n = { isReady: false, currentLang: 'en', t: (key) => key };
  const records = [];
  const people = [
    { id: 7, name: payload, ip: payload },
    { id: '7);window.__xssInjected=1;//', name: payload, ip: payload },
  ];
  const fetchStub = async (url, options) => {
    if (options) records.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => (options ? { success: false } : people) };
  };
  const view = { escapeHtml: window.escapeHtml, safeUrl: window.safeUrl, addEventListener() {} };
  const app = new Function(
    'document',
    'window',
    'fetch',
    'I18n',
    'confirm',
    sources.app +
      '\nnotify = function() {}; return { updateUserMenu, loadPlayers, setUser(user) { currentUser=user;isAdmin=true; } };',
  )(document, view, fetchStub, i18n, () => true);
  app.setUser({ name: 'A' });
  app.updateUserMenu();
  const avatar = document.querySelector('.user-avatar');
  check(
    !avatar.hasAttribute('onclick') && !avatar.hasAttribute('onerror'),
    'avatar callbacks are listeners, not inline attributes',
  );
  avatar.click();
  check(
    document.getElementById('user-dropdown').classList.contains('show'),
    'avatar menu listener works',
  );
  avatar.dispatchEvent(new Event('error'));
  check(avatar.src.startsWith('data:image/svg+xml,'), 'avatar error fallback listener works');
  await app.loadPlayers();
  const kicks = [...document.querySelectorAll('[data-player-action="kick"]')];
  check(
    kicks.length === 2 && kicks.every((button) => !button.hasAttribute('onclick')),
    'kick actions contain no inline data expressions',
  );
  kicks[1].click();
  check(records.length === 0, 'malformed player ID cannot execute code or issue kick');
  kicks[0].click();
  check(records[0]?.body.userId === 7, 'valid kick listener preserves numeric user ID');

  let onReady;
  const docProxy = new Proxy(document, {
    get(target, key) {
      if (key === 'addEventListener')
        return (type, fn) => {
          if (type === 'DOMContentLoaded') onReady = fn;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const playersSource = sources.players.replace(
    '  if (I18n.isReady) {',
    '  window.__testPlayers = { renderPlayers, admin() { isAdmin = true; } };\n  if (I18n.isReady) {',
  );
  new Function('document', 'window', 'fetch', 'I18n', playersSource)(
    docProxy,
    view,
    fetchStub,
    i18n,
  );
  onReady();
  view.__testPlayers.admin();
  view.__testPlayers.renderPlayers([people[0]]);
  let banArgs;
  view.banPlayer = (type, target) => {
    banArgs = { type, target };
  };
  const banIp = document.querySelector('[data-ban-type="ip"]');
  check(
    !banIp.hasAttribute('onclick') && !banIp.hasAttribute('onmouseover'),
    'player IP cannot create independent event attributes',
  );
  banIp.click();
  check(
    banArgs.type === 'ip' && banArgs.target === payload,
    'ban IP listener receives the unmodified value as data',
  );
  const panelScript = [...sources.panel.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .find((script) => script.includes('function renderBanList'));
  const panel = new Function(
    'document',
    'window',
    'fetch',
    'I18n',
    'confirm',
    panelScript + '\nreturn {renderBanList,renderLoginBlacklist};',
  )(docProxy, view, fetchStub, i18n, () => true);
  panel.renderLoginBlacklist([{ ip: payload, expiresAt: Date.now() + 60000 }]);
  const unblacklist = document.querySelector('[data-unblacklist-ip]');
  check(
    !unblacklist.hasAttribute('onclick') && !unblacklist.hasAttribute('onmouseover'),
    'blacklist row cannot inject event attributes',
  );
  unblacklist.click();
  check(
    records.some(
      (record) => record.url === '/api/admin/unblacklist-ip' && record.body.ip === payload,
    ),
    'blacklist listener preserves IP data',
  );
  panel.renderBanList('ip', [
    { target: payload, reason: payload, adminName: payload, expiresAt: null },
  ]);
  const unban = document.querySelector('[data-unban-target]');
  check(
    !unban.hasAttribute('onclick') && !unban.hasAttribute('onmouseover'),
    'ban row cannot inject event attributes',
  );
  unban.dispatchEvent(new MouseEvent('mouseover'));
  unban.click();
  check(
    records.some((record) => record.url === '/api/admin/unban' && record.body.target === payload),
    'unban listener preserves target data',
  );
  check(window.__xssInjected === 0, 'no injected script executed');
  return { passed: passed.length, checks: passed };
}
if (typeof module !== 'undefined') module.exports = runDashboardXssRegression;
