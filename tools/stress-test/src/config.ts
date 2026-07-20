export interface StressConfig {
  host: string;
  port: number;
  scenario: 'connection' | 'room' | 'chat' | 'mixed';
  connections: number;
  duration: number;
  rate: number;
  rampUp: number;
  token: string;
}

export function parseArgs(args: string[]): StressConfig {
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
  };

  const randomToken = 'stress_' + Array.from({ length: 13 }, () =>
    '0123456789abcdef'[Math.floor(Math.random() * 16)]
  ).join('');

  return {
    host: get('--host', '127.0.0.1'),
    port: parseInt(get('--port', '12346')),
    scenario: (get('--scenario', 'connection') as StressConfig['scenario']),
    connections: parseInt(get('--connections', '100')),
    duration: parseInt(get('--duration', '30')),
    rate: parseInt(get('--rate', '10')),
    rampUp: parseInt(get('--ramp-up', '5')),
    token: get('--token', randomToken),
  };
}
