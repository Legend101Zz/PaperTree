/**
 * `pnpm --filter @papertree/agent test` runs this. It starts `node --test` on every test file with:
 *
 *   - the audit preload (support/audit-preload.mjs) in every per-file process: any DNS name lookup,
 *     any connection off loopback, any read of a Pi config/context path fails that process;
 *   - the network denied at the kernel where the platform allows it: `sandbox-exec` on macOS
 *     (outbound denied except to localhost), `unshare -rn` on Linux (a fresh network namespace
 *     with only loopback up). Without either it says so, loudly, and the audit still enforces;
 *   - a clean Pi environment: PI_OFFLINE=1, PI_TELEMETRY=0, PI_CODING_AGENT_DIR = a new empty
 *     directory, and no MINIMAX_API_KEY / PAPERTREE_MINIMAX_API_KEY (a live key in the shell never
 *     reaches the offline suite).
 *
 * Usage: node --experimental-strip-types test/run.ts [--no-sandbox] [test files…]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = dirname(here);
const args = process.argv.slice(2);
const noSandbox = args.includes('--no-sandbox');
const named = args.filter((a) => !a.startsWith('--'));
const files =
  named.length > 0
    ? named
    : readdirSync(here)
        .filter((f) => f.endsWith('.test.ts'))
        .toSorted()
        .map((f) => join(here, f));

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
delete env['MINIMAX_API_KEY'];
delete env['PAPERTREE_MINIMAX_API_KEY'];
env['PI_OFFLINE'] = '1';
env['PI_TELEMETRY'] = '0';
env['PI_CODING_AGENT_DIR'] = mkdtempSync(join(tmpdir(), 'papertree-agent-test-pi-'));

const nodeArgs = [
  '--experimental-strip-types',
  '--disable-warning=ExperimentalWarning',
  '--import',
  join(here, 'support', 'audit-preload.mjs'),
  '--test',
  // A file whose teardown failed (say, the agent never booted) must still end, not hang the run.
  '--test-force-exit',
  '--test-reporter=spec',
  ...files.map((f) => relative(pkg, f)),
];

/** macOS: deny every outbound connection except to localhost (the tests' own servers). */
const PROFILE =
  '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';

let command = process.execPath;
let commandArgs = nodeArgs;
let sandbox = 'none';
if (!noSandbox && process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
  command = '/usr/bin/sandbox-exec';
  commandArgs = ['-p', PROFILE, process.execPath, ...nodeArgs];
  sandbox = 'sandbox-exec (outbound denied except localhost)';
} else if (
  !noSandbox &&
  process.platform === 'linux' &&
  spawnSync('unshare', ['-rn', 'true']).status === 0
) {
  command = 'unshare';
  const quoted = [process.execPath, ...nodeArgs]
    .map((a) => `'${a.replaceAll("'", "'\\''")}'`)
    .join(' ');
  commandArgs = ['-rn', 'sh', '-c', `ip link set lo up 2>/dev/null || true; exec ${quoted}`];
  sandbox = 'unshare -rn (a network namespace with loopback only)';
}
if (sandbox === 'none') {
  console.log(
    '[agent tests] !!! NETWORK NOT DENIED at the kernel on this machine; the audit preload still fails any',
  );
  console.log(
    '[agent tests] !!! DNS name lookup or non-loopback connection, but nothing stops one from being attempted.',
  );
} else {
  env['PAPERTREE_AGENT_SANDBOX'] = '1';
}
console.log(`[agent tests] network: ${sandbox}; audit preload: on; ${String(files.length)} files`);
const result = spawnSync(command, commandArgs, { cwd: pkg, env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
