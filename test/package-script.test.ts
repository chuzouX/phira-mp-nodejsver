import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { assertSecureRuntime } from '../src/common/RuntimeSecurity';

const source = fs.readFileSync(path.join(__dirname, '../scripts/package.js'), 'utf8');

function run(platform: string, hostVersion = '22.23.4', status = 0) {
  const spawnSync = jest.fn(() => ({ status }));
  const error = jest.fn();
  const modules: Record<string, unknown> = {
    child_process: { spawnSync },
    fs: { mkdirSync: jest.fn() },
    path,
    '../package.json': { version: '0.7.0' },
    '../dist/common/RuntimeSecurity': {
      assertSecureRuntime: (version = hostVersion) => assertSecureRuntime(version),
    },
  };
  const load = Object.assign(
    (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },
    { resolve: (name: string) => name },
  );
  let exit: unknown;
  try {
    vm.runInNewContext(source, {
      require: load,
      console: { error },
      process: {
        argv: ['node', 'package.js', platform],
        execPath: '/safe/node',
        cwd: () => '/workspace',
        exit: (code: number) => {
          throw new Error(`exit:${code}`);
        },
      },
    });
  } catch (cause) {
    exit = cause;
  }
  return { spawnSync, error, exit: String(exit) };
}

describe('secure executable packaging', () => {
  test.each(['win-x64', 'linux-x64', 'linux-arm64', 'macos-x64', 'macos-arm64'])(
    '%s uses official patched Node via SEA',
    (platform) => {
      const result = run(platform);
      expect(result.exit).toBe('Error: exit:0');
      const [binary, args] = result.spawnSync.mock.calls[0] as unknown as [string, string[]];
      expect(binary).toBe('/safe/node');
      expect(args).toContain('--sea');
      expect(args[args.indexOf('--targets') + 1]).toBe(`node22.23.4-${platform}`);
    },
  );

  test('rejects an unsafe build host before packaging', () => {
    const result = run('win-x64', '22.23.2');
    expect(result.spawnSync).not.toHaveBeenCalled();
    expect(result.exit).toContain('CVE-2026-111497');
  });

  test.each(['linux-static', 'unknown'])(
    'rejects unsupported target %s without fallback',
    (target) => {
      const result = run(target);
      expect(result.spawnSync).not.toHaveBeenCalled();
      expect(result.error).toHaveBeenCalled();
      expect(result.exit).toBe('Error: exit:1');
    },
  );

  test('propagates packager failures', () => {
    expect(run('win-x64', '22.23.4', 7).exit).toBe('Error: exit:7');
  });
});
