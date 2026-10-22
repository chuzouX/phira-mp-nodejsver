import { IncomingMessage } from 'http';
import { isIP } from 'net';

/** Canonical comparison key for direct/proxied addresses and persisted IP bans. */
export function normalizeIp(value: string): string {
  const ip = value.trim();
  if (isIP(ip) !== 6) return ip;
  let canonical = ip.toLowerCase();
  try {
    canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    /* scoped IPv6 */
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16),
      low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return canonical;
}

function trustsHeaders(hops: number): boolean {
  return Number.isSafeInteger(hops) && hops > 0 && hops <= 32;
}

/** Hops are an explicit deployment trust decision: prevent direct access around trusted proxies.
 * No forwarding header is trusted by default. X-Real-IP is only a single local-proxy fallback.
 */
export function resolveClientIp(req: IncomingMessage, trustProxyHops: number): string {
  const peer = normalizeIp(req.socket.remoteAddress || 'unknown');
  if (!trustsHeaders(trustProxyHops)) return peer;
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded !== undefined) {
    if (typeof forwarded !== 'string' || forwarded.length > 4096) return peer;
    const chain = forwarded.split(',').map((part) => part.trim());
    if (chain.length > 32 || chain.length < trustProxyHops || chain.some((ip) => !isIP(ip)))
      return peer;
    return normalizeIp(chain[chain.length - trustProxyHops]);
  }
  const real = req.headers['x-real-ip'];
  const loopback = peer === '::1' || peer.startsWith('127.');
  if (trustProxyHops === 1 && loopback && typeof real === 'string' && isIP(real.trim()))
    return normalizeIp(real);
  return peer;
}

/** Public origin must use Host. X-Forwarded-Host is intentionally never trusted. */
export function resolveRequestOrigin(
  req: IncomingMessage,
  trustProxyHops: number,
): string | undefined {
  let protocol = (req.socket as IncomingMessage['socket'] & { encrypted?: boolean }).encrypted
    ? 'https'
    : 'http';
  const forwarded = req.headers['x-forwarded-proto'];
  if (trustsHeaders(trustProxyHops) && typeof forwarded === 'string') {
    const candidate = forwarded.split(',')[0].trim();
    if (candidate === 'http' || candidate === 'https') protocol = candidate;
  }
  const host = req.headers.host;
  if (!host || /[\s\/\\?#@]/.test(host)) return undefined;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
}
