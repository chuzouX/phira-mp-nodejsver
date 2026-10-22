const { spawnSync } = require('child_process');
const { mkdirSync } = require('fs');
const path = require('path');
const { assertSecureRuntime } = require('../dist/common/RuntimeSecurity');

assertSecureRuntime();
// pkg chooses a bundled runtime independently of the Node running this script.
// Validate its actual patch inventory rather than trusting a major-only target.
const pkgRequire = require('module').createRequire(require.resolve('@yao-pkg/pkg/package.json'));
const runtimeVersion = pkgRequire('@yao-pkg/pkg-fetch').getNodeVersion('node22');
assertSecureRuntime(runtimeVersion || 'unavailable');

const version = require('../package.json').version;
const platform = process.argv[2];
const targets = {
  'win-x64': {
    target: 'node22-win-x64',
    filename: `phira-mp-nodejsver-v${version}.exe`,
  },
  'linux-x64': {
    target: 'node22-linux-x64',
    filename: `phira-mp-nodejsver-linux-v${version}`,
  },
  'linux-arm64': {
    target: 'node22-linux-arm64',
    filename: `phira-mp-nodejsver-linux-arm64-v${version}`,
  },
  'linux-static': {
    target: 'node22-linuxstatic-x64',
    filename: `phira-mp-nodejsver-linuxstatic-x64-v${version}`,
  },
  'macos-x64': {
    target: 'node22-macos-x64',
    filename: `phira-mp-nodejsver-macos-x64-v${version}`,
  },
  'macos-arm64': {
    target: 'node22-macos-arm64',
    filename: `phira-mp-nodejsver-macos-arm64-v${version}`,
  },
};

const config = targets[platform];
if (!config) {
  console.error(`Unknown package platform: ${platform ?? '(missing)'}`);
  console.error(`Expected one of: ${Object.keys(targets).join(', ')}`);
  process.exit(1);
}

const outputDirectory = path.join(process.cwd(), 'outputs', version);
const outputPath = path.join(outputDirectory, config.filename);
mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    require.resolve('@yao-pkg/pkg/lib-es5/bin.js'),
    '.',
    '--targets',
    config.target,
    '--output',
    outputPath,
    '--no-bytecode',
  ],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
