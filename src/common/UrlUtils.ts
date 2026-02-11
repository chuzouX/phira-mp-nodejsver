import { URL } from 'url';
import * as net from 'net';

/**
 * 检查 URL 是否安全，防止 SSRF。
 * 屏蔽本地和私有 IP 地址。
 */
export function isSafeUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);

    // 1. 仅允许 HTTP 和 HTTPS
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname;

    // 2. 屏蔽 localhost
    if (hostname === 'localhost') {
      return false;
    }

    // 3. 屏蔽私有和回环 IP 地址
    if (net.isIP(hostname)) {
      if (isPrivateIP(hostname)) {
        return false;
      }
    }

    return true;
  } catch (e) {
    return false;
  }
}

function isPrivateIP(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.')) {
    return true;
  }

  const ipv4Match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, b1, b2] = ipv4Match.map(Number);
    if (b1 === 10) return true;
    if (b1 === 172 && b2 >= 16 && b2 <= 31) return true;
    if (b1 === 192 && b2 === 168) return true;
    if (b1 === 169 && b2 === 254) return true;
  }

  if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd') || ip.toLowerCase().startsWith('fe80')) {
    return true;
  }

  return false;
}
