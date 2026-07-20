export interface MetricEntry {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  errors: number;
}

export class Metrics {
  private metrics = new Map<string, MetricEntry>();
  private startTime = Date.now();

  record(name: string, latencyMs: number, isError = false): void {
    let m = this.metrics.get(name);
    if (!m) {
      m = { count: 0, totalMs: 0, minMs: latencyMs, maxMs: latencyMs, errors: 0 };
      this.metrics.set(name, m);
    }
    m.count++;
    m.totalMs += latencyMs;
    if (latencyMs < m.minMs) m.minMs = latencyMs;
    if (latencyMs > m.maxMs) m.maxMs = latencyMs;
    if (isError) m.errors++;
  }

  get(name: string): MetricEntry | undefined {
    return this.metrics.get(name);
  }

  all(): [string, MetricEntry][] {
    return Array.from(this.metrics.entries());
  }

  elapsed(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  reset(): void {
    this.metrics.clear();
    this.startTime = Date.now();
  }
}

export function formatTable(metrics: Metrics): string {
  const rows = metrics.all();
  if (rows.length === 0) return 'No data yet';

  const pad = (s: string, w: number) => s.padEnd(w);

  let out = '';
  out += '\n┌──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐\n';
  out += `│ ${pad('Metric', 12)} │ ${pad('Count', 8)} │ ${pad('Avg', 8)} │ ${pad('P50', 8)} │ ${pad('P99', 8)} │ ${pad('Errors', 8)} │\n`;
  out += '├──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤\n';

  for (const [name, m] of rows) {
    const avg = m.count > 0 ? (m.totalMs / m.count).toFixed(1) : '-';
    out += `│ ${pad(name, 12)} │ ${pad(String(m.count), 8)} │ ${pad(avg + 'ms', 8)} │ ${pad(String(m.minMs) + 'ms', 8)} │ ${pad(String(m.maxMs) + 'ms', 8)} │ ${pad(String(m.errors), 8)} │\n`;
  }

  out += '└──────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘\n';

  const total = rows.reduce((s, [, m]) => s + m.count, 0);
  const elapsed = metrics.elapsed();
  out += `  Elapsed: ${elapsed.toFixed(1)}s  |  Total ops: ${total}  |  TPS: ${(total / Math.max(elapsed, 0.1)).toFixed(0)}\n`;

  return out;
}
