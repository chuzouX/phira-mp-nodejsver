/** Minimum patched runtimes from the October 2026 Node.js security release. */
const PATCHED_NODE_VERSIONS: Record<number, readonly [number, number]> = {
  22: [23, 4],
  24: [22, 1],
  26: [12, 1],
};

export function assertSecureRuntime(version: string = process.versions.node): void {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor, patch] = match ? match.slice(1).map(Number) : [];
  const minimum = PATCHED_NODE_VERSIONS[major];
  if (!minimum || minor < minimum[0] || (minor === minimum[0] && patch < minimum[1])) {
    throw new Error(
      `Unsupported Node.js ${version}: CVE-2026-111497 requires Node.js ` +
        '22.23.4+, 24.22.1+ or 26.12.1+ within those release lines. ' +
        'Upgrade the runtime (including embedded executable runtimes) and restart.',
    );
  }
}
