import { StressConfig } from '../config';
import { Metrics } from '../metrics';
import { PhiraClient, createClient } from '../client';

export async function runRoomScenario(
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
    console.log('  Need at least 2 clients for room test');
    return;
  }

  const deadline = Date.now() + duration * 1000;
  const interval = 1000 / Math.max(rate, 1);
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  let roomSeq = 0;
  let ops = 0;

  while (Date.now() < deadline) {
    const host = authenticated[Math.floor(Math.random() * authenticated.length)];
    const guest = authenticated[Math.floor(Math.random() * authenticated.length)];
    if (host.id === guest.id) { await wait(100); continue; }

    const roomId = `stress_${roomSeq++ % 50}`;
    ops++;

    try { await host.createRoom(roomId); } catch {}
    await wait(interval);

    try { await guest.joinRoom(roomId); } catch {}
    await wait(interval);

    try { await guest.leaveRoom(); } catch {}
    await wait(interval);

    try { await host.leaveRoom(); } catch {}
    await wait(interval);

    if (ops % 10 === 0) {
      console.log(`  [${metrics.elapsed().toFixed(0)}s] ${ops} ops | ` +
        `create:${metrics.get('create_room')?.count ?? 0}/` +
        `join:${metrics.get('join_room')?.count ?? 0}/` +
        `leave:${metrics.get('leave_room')?.count ?? 0}`);
    }
  }

  for (const c of clients) c.close();
}
