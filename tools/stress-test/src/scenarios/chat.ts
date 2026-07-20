import { StressConfig } from '../config';
import { Metrics } from '../metrics';
import { PhiraClient, createClient } from '../client';

export async function runChatScenario(
  config: StressConfig,
  metrics: Metrics,
  clients: PhiraClient[],
): Promise<void> {
  const { token, duration } = config;

  console.log(`\n  Connecting ${clients.length} clients...\n`);

  const authenticated: { client: PhiraClient; roomId: string }[] = [];
  let roomSeq = 0;

  for (let i = 0; i < clients.length; i++) {
    const c = clients[i];
    try {
      await c.connect();
      const ok = await c.authenticate(token);
      if (!ok) continue;
      const roomId = `chat_${roomSeq++ % 50}`;
      await c.createRoom(roomId);
      authenticated.push({ client: c, roomId });
    } catch {}
  }

  console.log(`  Ready: ${authenticated.length}/${clients.length}\n`);

  const chatMessages = ['hello', 'gg', 'nice', 'lol', '再来', '666', '加油', '打得好', 'test'];

  const deadline = Date.now() + duration * 1000;
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

  while (Date.now() < deadline) {
    const batch = Math.min(50, authenticated.length);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < batch; i++) {
      const { client } = authenticated[Math.floor(Math.random() * authenticated.length)];
      const msg = chatMessages[Math.floor(Math.random() * chatMessages.length)];
      promises.push(client.sendChat(msg));
    }
    await Promise.all(promises);
    await wait(200);

    if (Math.floor(Date.now() / 1000) % 5 === 0) {
      console.log(`  [${metrics.elapsed().toFixed(0)}s] ${metrics.get('chat')?.count ?? 0} msgs`);
    }
  }

  for (const c of clients) c.close();
}
