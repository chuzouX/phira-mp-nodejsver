import { assertSecureRuntime } from '../src/common/RuntimeSecurity';

describe('Node.js security baseline', () => {
  test.each(['22.23.4', '22.24.0', '24.22.1', '24.23.0', '26.12.1', '26.13.0'])(
    'accepts patched runtime %s',
    (version) => expect(() => assertSecureRuntime(version)).not.toThrow(),
  );
  test.each([
    '18.20.8',
    '20.19.5',
    '22.23.3',
    '24.22.0',
    '26.12.0',
    '25.0.0',
    '27.0.0',
    '24.22.1-rc.1',
    'invalid',
  ])('refuses unpatched or unverified runtime %s', (version) =>
    expect(() => assertSecureRuntime(version)).toThrow('CVE-2026-111497'),
  );
});
