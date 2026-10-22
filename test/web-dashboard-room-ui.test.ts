import fs from 'fs';
import path from 'path';
import vm from 'vm';

function boot() {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        innerHTML: '',
        textContent: '',
        style: {},
        classList: { add() {}, remove() {} },
      });
    return elements.get(id);
  };
  const state: { socket?: any } = {};
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send = jest.fn();
    close = jest.fn();
    constructor() {
      state.socket = this;
    }
  }
  const fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  }));
  const alert = jest.fn();
  const errors = jest.fn();
  let ready: any;
  const context: any = {
    URLSearchParams,
    WebSocket: Socket,
    fetch,
    alert,
    confirm: () => true,
    console: { error: errors, log() {} },
    setTimeout: jest.fn(),
    clearTimeout: jest.fn(),
    I18n: { isReady: true, t: (key: string) => key },
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: (name: string, fn: any) => {
        if (name === 'DOMContentLoaded') ready = fn;
      },
    },
    location: { reload() {} },
  };
  context.window = {
    location: { search: '?id=mine', protocol: 'http:', host: 'localhost' },
    escapeHtml: (value: any) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
    escapeJs: String,
    safeUrl: String,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../plugins/web-dashboard/res/public/room.js'), 'utf8'),
    context,
  );
  ready();
  const socket = state.socket;
  const render = (canManage: boolean, isRemote = false, canChat = canManage, extra = {}) => {
    socket.onmessage({
      data: JSON.stringify({
        type: 'roomDetails',
        payload: {
          id: 'mine',
          canManage,
          canChat,
          isRemote,
          ownerId: 10,
          players: [
            { id: -1, name: 'Bot' },
            { id: 10, name: '<img src=x>' },
          ],
          messages: [],
          otherRooms: [],
          state: { type: 'SelectChart' },
          maxPlayers: 8,
          ...extra,
        },
      }),
    });
    expect(errors).not.toHaveBeenCalled();
  };
  return { context, element, fetch, alert, render, socket };
}

describe('room management page permissions', () => {
  it('shows creator controls and an escaped room-member selector, hides them for visitors and remote rooms', () => {
    const page = boot();
    page.render(true);
    expect(page.element('room-details').innerHTML).toContain('id="card-admin-panel"');
    expect(page.element('room-details').innerHTML).toContain(
      '<option value="10">&lt;img src=x&gt; (10)</option>',
    );
    expect(page.element('room-details').innerHTML).not.toContain('<option value="-1">');
    page.render(false);
    expect(page.element('room-details').innerHTML).not.toContain('id="card-admin-panel"');
    page.render(true, true);
    expect(page.element('room-details').innerHTML).not.toContain('id="card-admin-panel"');
  });
  it('blocks unauthorized and cross-room actions before sending and always includes roomId', async () => {
    const page = boot();
    page.render(false);
    await page.context.window.adminAction('toggle-lock');
    expect(page.fetch).not.toHaveBeenCalled();
    page.render(true);
    for (const text of ['<script>hi</script>', 'a\nb', 'a\u0000b', 'a\u202eb', 'x'.repeat(2049)]) {
      await page.context.window.adminAction('message', text);
    }
    expect(page.fetch).not.toHaveBeenCalled();
    await page.context.window.adminAction('kick', '20');
    expect(page.fetch).not.toHaveBeenCalled();
    await page.context.window.adminAction('kick', '10');
    expect(JSON.parse((page.fetch.mock.calls as any)[0][1].body)).toMatchObject({
      roomId: 'mine',
      userId: 10,
    });
    await page.context.window.adminAction('message', 'hello');
    expect((page.fetch.mock.calls as any)[1][0]).toBe('/api/admin/room-message');
    expect(JSON.parse((page.fetch.mock.calls as any)[1][1].body)).toMatchObject({
      roomId: 'mine',
      content: 'hello',
    });
  });
  it('removes controls on server denial and prevents subsequent operations', async () => {
    const page = boot();
    page.render(true);
    page.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ success: false }),
    });
    await page.context.window.adminAction('toggle-lock');
    expect(page.alert).toHaveBeenCalledWith('room.denied');
    expect(page.element('room-details').innerHTML).not.toContain('id="card-admin-panel"');
    await page.context.window.adminAction('toggle-lock');
    expect(page.fetch).toHaveBeenCalledTimes(1);
  });
  it('reports HTTP status for non-JSON endpoint errors', async () => {
    const page = boot();
    page.render(true);
    page.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('HTML response');
      },
    });
    await page.context.window.adminAction('message', 'hello');
    expect(page.alert).toHaveBeenCalledWith('room.endpoint_missing (HTTP 404)');
  });

  it('shows a member composer, host prefixes and a separate host chat switch', async () => {
    const page = boot();
    page.render(false, false, true, {
      canControlChat: true,
      chatEnabled: true,
      messages: [{ type: 'Chat', user: 10, userName: 'Creator', isHost: true, content: 'hi' }],
    });
    expect(page.element('room-details').innerHTML).toContain('id="card-room-chat"');
    expect(page.element('room-details').innerHTML).toContain('[房主]Creator');
    expect(page.element('room-details').innerHTML).not.toContain('id="card-admin-panel"');
    await page.context.window.adminAction('toggle-chat');
    expect((page.fetch.mock.calls as any)[0][0]).toBe('/api/admin/chat');
    expect(JSON.parse((page.fetch.mock.calls as any)[0][1].body)).toMatchObject({
      roomId: 'mine',
      enabled: false,
    });
    page.render(false, false, false, { chatEnabled: false });
    expect(page.element('room-details').innerHTML).not.toContain('id="card-room-chat"');
    expect(page.element('room-details').innerHTML).toContain('room.chat_disabled');
  });
});

describe('federated player counts', () => {
  it('escapes malicious counts in details and quick info with the real renderer', () => {
    const page = boot();
    const payload = '<img src=x onerror=alert(1)>';
    page.render(false, true, false, { playerCount: payload, maxPlayers: payload });
    const html = page.element('room-details').innerHTML;
    expect(html).toContain(
      '&lt;img src=x onerror=alert(1)&gt; / &lt;img src=x onerror=alert(1)&gt;',
    );
    expect(html).not.toContain(payload);
    page.socket.onmessage({
      data: JSON.stringify({ type: 'roomList', payload: [{ id: 'mine', playerCount: payload }] }),
    });
    expect(page.element('total-players').innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(page.element('total-players').innerHTML).not.toContain(payload);
  });
});
