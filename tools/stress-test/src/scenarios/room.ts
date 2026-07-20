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

  if (authenticated.length === 0) {
    console.log('  No clients authenticated, aborting');
    return;
  }

  const deadline = Date.now() + duration * 1000;
  const interval = 1000 / Math.max(rate, 1);
  let roomSeq = 0;

  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

  while (Date.now() < deadline) {
    const c = authenticated[Math.floor(Math.random() * authenticated.length)];
    roomSeq++;
    const roomId = `stress_${roomSeq % 100}`;

    try { await c.createRoom(roomId); } catch {}
    await wait(interval / 3);

    try { await c.leaveRoom(); } catch {}
    await wait(interval / 3);

    try { await c.joinRoom(roomId); } catch {}
    await wait(interval / 3);

    if (roomSeq % 10 === 0) {
      console.log(`  [${metrics.elapsed().toFixed(0)}s] ${roomSeq} ops | ${formatInline(metrics)}`);
    }
  }

  for (const c of clients) c.close();
}

function formatInline(m: Metrics): string {
  const parts: string[] = [];
  for (const [name, entry] of m.all()) {
    parts.push(`${name}: ${entry.count}`);
  }
  return parts.join(' | ');
}
