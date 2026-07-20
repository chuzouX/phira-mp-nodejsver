import { StressConfig } from '../config';
import { Metrics } from '../metrics';
import { PhiraClient, createClient } from '../client';

export async function runConnectionScenario(
  config: StressConfig,
  metrics: Metrics,
  clients: PhiraClient[],
): Promise<void> {
  const { token, duration, rampUp } = config;

  console.log(`\n  Ramping up ${clients.length} connections over ${rampUp}s...\n`);

  const startTime = Date.now();
  const interval = (rampUp * 1000) / Math.max(clients.length, 1);

  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  let connected = 0;

  for (let i = 0; i < clients.length; i++) {
    clients[i].connect().then(() => {
      connected++;
      clients[i].authenticate(token).catch(() => {});
    }).catch(() => {});
    if (i < clients.length - 1) await wait(interval);
  }

  const deadline = startTime + duration * 1000;
  while (Date.now() < deadline) {
    await wait(1000);
    console.log(`  [${metrics.elapsed().toFixed(0)}s] connected: ${connected}/${clients.length}, ${formatInline(metrics)}`);
  }

  for (const c of clients) c.close();
}

function formatInline(m: Metrics): string {
  const parts: string[] = [];
  for (const [name, entry] of m.all()) {
    parts.push(`${name}: ${entry.count}/${entry.errors ? entry.errors + 'e' : '0e'}`);
  }
  return parts.join(' | ');
}
