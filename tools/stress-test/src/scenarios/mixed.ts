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

  if (authenticated.length === 0) {
    console.log('  No clients, aborting');
    return;
  }

  const actions = ['create_room', 'join', 'leave', 'chat'] as const;
  const chatMsgs = ['hello', 'gg', 'nice', '再来', '666'];

  const deadline = Date.now() + duration * 1000;
  const interval = 1000 / Math.max(rate, 1);
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  let roomSeq = 0;

  while (Date.now() < deadline) {
    const c = authenticated[Math.floor(Math.random() * authenticated.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];

    try {
      switch (action) {
        case 'create_room':
          await c.createRoom(`mix_${roomSeq++ % 50}`);
          await wait(50);
          await c.leaveRoom();
          break;
        case 'join':
          await c.joinRoom(`mix_${Math.floor(Math.random() * 50) % 50}`);
          break;
        case 'leave':
          await c.leaveRoom();
          break;
        case 'chat':
          await c.sendChat(chatMsgs[Math.floor(Math.random() * chatMsgs.length)]);
          break;
      }
    } catch {}

    await wait(interval);

    if (roomSeq % 20 === 0) {
      console.log(`  [${metrics.elapsed().toFixed(0)}s] ${roomSeq} ops`);
    }
  }

  for (const c of clients) c.close();
}
