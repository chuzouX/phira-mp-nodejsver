import { parseArgs } from './config';
import { Metrics, formatTable } from './metrics';
import { createClient, PhiraClient } from './client';
import { runConnectionScenario } from './scenarios/connection';
import { runRoomScenario } from './scenarios/room';
import { runChatScenario } from './scenarios/chat';
import { runMixedScenario } from './scenarios/mixed';

async function main(): Promise<void> {
  const config = parseArgs(process.argv);

  console.log(`
═════════════════════════════════════════════════
  Phira MP Server — Stress Test
═════════════════════════════════════════════════
  Target:      ${config.host}:${config.port}
  Scenario:    ${config.scenario}
  Clients:     ${config.connections}
  Duration:    ${config.duration}s
  Rate:        ${config.rate}/s
  Ramp-up:     ${config.rampUp}s
  Token:       ${config.token.substring(0, 10)}...
═════════════════════════════════════════════════`);

  const metrics = new Metrics();

  const clients: PhiraClient[] = [];
  for (let i = 0; i < config.connections; i++) {
    clients.push(createClient(config.host, config.port, i, metrics));
  }

  const startTime = Date.now();

  switch (config.scenario) {
    case 'connection':
      await runConnectionScenario(config, metrics, clients);
      break;
    case 'room':
      await runRoomScenario(config, metrics, clients);
      break;
    case 'chat':
      await runChatScenario(config, metrics, clients);
      break;
    case 'mixed':
      await runMixedScenario(config, metrics, clients);
      break;
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n  Completed in ${elapsed.toFixed(1)}s\n`);
  console.log(formatTable(metrics));
  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
