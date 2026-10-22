import { normalizeIp, resolveClientIp, resolveRequestOrigin } from '../src/network/ClientAddress';

const req = (peer: string, headers: any = {}, encrypted = false): any => ({
  socket: { remoteAddress: peer, encrypted },
  headers,
});
describe('single host address policy', () => {
  it.each([
    ['203.0.113.9', 0, { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }, '203.0.113.9'],
    ['::ffff:127.0.0.1', 0, { 'x-real-ip': '1.2.3.4' }, '127.0.0.1'],
    ['127.0.0.1', 1, { 'x-real-ip': '1.2.3.4' }, '1.2.3.4'],
    ['10.0.0.1', 1, { 'x-real-ip': '1.2.3.4' }, '10.0.0.1'],
    ['::1', 2, { 'x-real-ip': '1.2.3.4' }, '::1'],
    ['10.0.0.1', 1, { 'x-forwarded-for': '198.51.100.1, 192.0.2.1' }, '192.0.2.1'],
    ['10.0.0.1', 2, { 'x-forwarded-for': '198.51.100.1, 192.0.2.1' }, '198.51.100.1'],
    ['10.0.0.1', 2, { 'x-forwarded-for': '198.51.100.1' }, '10.0.0.1'],
    ['127.0.0.1', 1, { 'x-forwarded-for': 'bad, 192.0.2.1', 'x-real-ip': '1.2.3.4' }, '127.0.0.1'],
    ['10.0.0.1', -1, { 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1'],
    ['10.0.0.1', 1.5, { 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1'],
    ['10.0.0.1', 1, { 'x-forwarded-for': '::ffff:192.0.2.1' }, '192.0.2.1'],
    ['10.0.0.1', 1, { 'x-forwarded-for': ['1.2.3.4'] }, '10.0.0.1'],
  ] as Array<[string, number, any, string]>)(
    'peer=%s hops=%s respects forwarding policy',
    (peer, hops, headers, expected) => {
      expect(resolveClientIp(req(peer, headers), hops)).toBe(expected);
    },
  );
  it('normalizes IPv4-mapped and equivalent IPv6 spellings', () => {
    expect(normalizeIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(normalizeIp('::FFFF:c000:0201')).toBe('192.0.2.1');
    expect(normalizeIp('2001:0DB8:0:0:0:0:0:1')).toBe('2001:db8::1');
  });
  it('derives full origins without trusting X-Forwarded-Host or unconfigured protocol headers', () => {
    const headers = {
      host: 'example.test:444',
      'x-forwarded-host': 'evil.test',
      'x-forwarded-proto': 'https',
    };
    expect(resolveRequestOrigin(req('10.0.0.1', headers), 0)).toBe('http://example.test:444');
    expect(resolveRequestOrigin(req('10.0.0.1', headers), 1)).toBe('https://example.test:444');
    expect(resolveRequestOrigin(req('10.0.0.1', { host: 'example.test' }, true), 0)).toBe(
      'https://example.test',
    );
    expect(resolveRequestOrigin(req('10.0.0.1', { host: 'evil@target.test' }), 0)).toBeUndefined();
  });
});
