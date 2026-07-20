import { StressConfig } from '../config';
import { Metrics } from '../metrics';
import { PhiraClient, createClient } from '../client';

export async function runMixedScenario(
  config: StressConfig,
  metrics: Metrics,
  clients: PhiraClient[],
): Promise<void> {
  const { token, duration, rate } = config;

  console.log(`\n  Connecting ${clients.length} clients...\n`);

  const authenticated: PhiraClient[] = [];
  for (const c of clients) {
    try {
      await c.connect();
      const ok = await c.authenticate(token);
      if (ok) authenticated.push(c);
    } catch {}
  }
  console.log(`  Authenticated: ${authenticated.length}/${clients.length}\n`);

  if (authenticated.length < 2) {
    console.log('  Need at least 2 clients');
    return;
  }

  const chatMsgs = ['hello', 'gg', 'nice', '再来', '666'];
  const deadline = Date.now() + duration * 1000;
  const interval = 1000 / Math.max(rate, 1);
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  let ops = 0; let roomSeq = 0;

  while (Date.now() < deadline) {
    const a = authenticated[Math.floor(Math.random() * authenticated.length)];
    const b = authenticated[Math.floor(Math.random() * authenticated.length)];
    if (a.id === b.id) { await wait(50); continue; }

    const roomId = `mix_${roomSeq++ % 30}`;
    ops += 4;

    try { await a.createRoom(roomId); } catch {}
    await wait(interval);
    try { await b.joinRoom(roomId); } catch {}
    await wait(interval);
    try { await a.sendChat(chatMsgs[Math.floor(Math.random() * chatMsgs.length)]); } catch {}
    await wait(interval);
    try { await b.leaveRoom(); } catch {}
    await wait(interval);
    try { await a.leaveRoom(); } catch {}

    if (roomSeq % 15 === 0) {
      console.log(`  [${metrics.elapsed().toFixed(0)}s] ${ops} ops`);
    }
  }

  for (const c of clients) c.close();
}
