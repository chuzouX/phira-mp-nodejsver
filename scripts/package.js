const { spawnSync } = require('child_process');
const { mkdirSync } = require('fs');
const path = require('path');
const { assertSecureRuntime } = require('../dist/common/RuntimeSecurity');

assertSecureRuntime();
// Enhanced SEA downloads stock Node.js rather than pkg-fetch's older patched fork.
// Pin the full version so every target and the SEA blob generator agree.
const runtimeVersion = '22.23.4';
assertSecureRuntime(runtimeVersion);

const version = require('../package.json').version;
const platform = process.argv[2];
if (platform === 'linux-static') {
  console.error(
    'SEA requires an official Node.js runtime; a fully static Linux runtime is not available. ' +
      'Use npm run package:linux or npm run package:linux-arm64.',
  );
  process.exit(1);
}
const targets = {
  'win-x64': {
    target: `node${runtimeVersion}-win-x64`,
    filename: `phira-mp-nodejsver-v${version}.exe`,
  },
  'linux-x64': {
    target: `node${runtimeVersion}-linux-x64`,
    filename: `phira-mp-nodejsver-linux-v${version}`,
  },
  'linux-arm64': {
    target: `node${runtimeVersion}-linux-arm64`,
    filename: `phira-mp-nodejsver-linux-arm64-v${version}`,
  },
  'macos-x64': {
    target: `node${runtimeVersion}-macos-x64`,
    filename: `phira-mp-nodejsver-macos-x64-v${version}`,
  },
  'macos-arm64': {
    target: `node${runtimeVersion}-macos-arm64`,
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
    '--sea',
    '--no-bytecode',
  ],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
