/**
 * The e2e stack: the real processes a user's browser talks to, on scratch ports, against a fresh
 * data root.
 *
 *   api     `python -m papertree_api`         PAPERTREE_HOST=127.0.0.1, PAPERTREE_PORT=<free>
 *   worker  `python -m papertree_api.worker`  the same PAPERTREE_DATA_ROOT, so it parses uploads
 *   agent   `services/agent`                  SKIPPED, loudly, until S5 writes it
 *   web     `next dev`                        NEXT_PUBLIC_PAPERTREE_API_URL=<the api above>
 *
 * WHAT "READY" MEANS, per process, because a harness that starts things and hopes is how an e2e
 * suite measures its own startup race instead of the product:
 *   - api: `GET /healthz` answers 200. Before S0's wave 2 adds that route the API answers 404 there,
 *     which still proves it is serving HTTP, and the harness says so rather than pretending.
 *   - worker: its process is alive once the API is (it migrates the same SQLite file and then
 *     polls), and it is still alive after a settle period. It has no port to probe.
 *   - web: `GET /login` answers 200, which means `next dev` has compiled a route.
 *
 * Every process's stdout+stderr goes to `<data root>/logs/<name>.log`, and a failure to become
 * ready names that file. Teardown sends SIGTERM to each process GROUP (next dev forks), then
 * SIGKILL after a grace period.
 *
 * A child's environment is BUILT, not inherited: `INHERITED_ENV` names the few variables it takes
 * from the shell running the suite, and everything else it needs is passed explicitly (`childEnv`).
 *
 * Never `~/.papertree`, never `~/.papertree-demo`: the data root is always a new directory.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(__dirname, '..', '..');
const WEB_DIR = join(REPO_ROOT, 'apps', 'web');
const AGENT_ENTRY = join(REPO_ROOT, 'services', 'agent', 'src', 'server.ts');

export interface StackInfo {
  readonly apiUrl: string;
  readonly webUrl: string;
  readonly dataRoot: string;
  readonly logDir: string;
  readonly agent: 'running' | 'skipped';
  readonly health: { readonly api: string; readonly worker: string; readonly web: string };
}

export interface Proc {
  readonly name: string;
  readonly child: ChildProcess;
  readonly log: string;
  readonly out: WriteStream;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function say(message: string): void {
  console.log(`[e2e] ${message}`);
}

/** A port the OS says is free right now. Racy by nature; the bind failure is loud if it loses. */
async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.unref();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') fail(new Error('no port'));
        else done(address.port);
      });
    });
  });
}

function envPort(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`${name}=${raw} is not a port`);
  return port;
}

/**
 * The ONLY variables a child inherits from the shell that runs the suite.
 *
 * An allowlist, not `process.env` minus a few names, because what must never reach these processes
 * is a model key (contracts.md §7: `PAPERTREE_MINIMAX_API_KEY` belongs to the agent alone), and a
 * denylist is only as complete as the list of every name a key has ever had — `MINIMAX_API_KEY`
 * (Pi's ambient fallback), `PAPERTREE_LLM_API_KEY`, `LLM_API_KEY`, `PAPERTREE_VLM_API_KEY`, and
 * whatever comes next. It also keeps a developer's own `PAPERTREE_*` settings (a signing secret, a
 * data root, CORS origins) out of a stack that is meant to be fresh.
 *
 * `PATH` is here because `next`'s `.bin` shim execs `node` by name. Anything else a process needs
 * goes in its own `env` explicitly — including, from S5, the faux agent's settings.
 */
export const INHERITED_ENV: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'CI',
];

/** A child's whole environment: the allowlisted inherited variables, then its own (which win). */
export function childEnv(
  own: Readonly<Record<string, string>>,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...own };
}

export function start(
  name: string,
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: Record<string, string>; readonly logDir: string },
): Proc {
  const log = join(options.logDir, `${name}.log`);
  const out = createWriteStream(log);
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: childEnv(options.env),
    // Its own process group, so teardown reaches the children `next dev` forks.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(out, { end: false });
  child.stderr?.pipe(out, { end: false });
  say(`started ${name} (pid ${String(child.pid)}), log ${log}`);
  return { name, child, log, out };
}

function exited(proc: Proc): boolean {
  return proc.child.exitCode !== null || proc.child.signalCode !== null;
}

async function waitUntil(
  proc: Proc,
  timeoutMs: number,
  ready: () => Promise<string | null>,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    if (exited(proc)) {
      throw new Error(
        `${proc.name} exited (${String(proc.child.exitCode ?? proc.child.signalCode)}) before it ` +
          `was ready; see ${proc.log}`,
      );
    }
    try {
      const verdict = await ready();
      if (verdict !== null) return verdict;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(
    `${proc.name} was not ready after ${String(timeoutMs)} ms (${last}); see ${proc.log}`,
  );
}

async function stopProc(proc: Proc): Promise<void> {
  if (!exited(proc) && proc.child.pid !== undefined) {
    const pid = proc.child.pid;
    const gone = new Promise<void>((done) => proc.child.once('exit', () => done()));
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
    const graceful = await Promise.race([gone.then(() => true), sleep(8_000).then(() => false)]);
    if (!graceful) {
      say(`${proc.name} ignored SIGTERM for 8 s; sending SIGKILL`);
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      await Promise.race([gone, sleep(2_000)]);
    }
  }
  proc.out.end();
}

/** Stage `public/pdf.worker.min.mjs` and `public/fixtures/` exactly as `pnpm dev`'s predev does. */
function prepareWebAssets(logDir: string): void {
  for (const script of ['scripts/copy-pdf-worker.mjs', 'scripts/copy-fixtures.mjs']) {
    const result = spawnSync(process.execPath, [script], { cwd: WEB_DIR, encoding: 'utf8' });
    writeFileSync(
      join(logDir, `web-predev-${script.split('/').pop() ?? script}.log`),
      `${result.stdout}\n${result.stderr}`,
    );
    if (result.status !== 0) {
      throw new Error(`apps/web ${script} failed (${String(result.status)}): ${result.stderr}`);
    }
  }
}

export async function startStack(): Promise<{
  readonly info: StackInfo;
  readonly stop: () => Promise<void>;
}> {
  const scratch = process.env['PAPERTREE_E2E_SCRATCH'] ?? tmpdir();
  mkdirSync(scratch, { recursive: true });
  const dataRoot = mkdtempSync(join(scratch, 'papertree-e2e-'));
  const logDir = join(dataRoot, 'logs');
  mkdirSync(logDir);

  const python = process.env['PAPERTREE_E2E_PYTHON'] ?? join(REPO_ROOT, '.venv', 'bin', 'python');
  if (!existsSync(python)) {
    throw new Error(
      `No Python at ${python}. Run \`uv sync --locked --all-packages\` in the repo root, ` +
        'or point PAPERTREE_E2E_PYTHON at an interpreter that has the workspace installed.',
    );
  }

  const apiPort = envPort('PAPERTREE_E2E_API_PORT') ?? (await freePort());
  const webPort = envPort('PAPERTREE_E2E_WEB_PORT') ?? (await freePort());
  const apiUrl = `http://127.0.0.1:${String(apiPort)}`;
  const webUrl = `http://127.0.0.1:${String(webPort)}`;
  say(`fresh data root ${dataRoot}`);

  const procs: Proc[] = [];
  const stop = async (): Promise<void> => {
    for (const proc of [...procs].reverse()) await stopProc(proc);
    say(`stopped; data root and logs kept at ${dataRoot}`);
  };

  // On top of INHERITED_ENV, only what each process needs. Never a model key: the API's AI paths
  // are S5's, and a key here would reach a process that must not hold one (contracts.md §7).
  const pythonEnv = { PAPERTREE_DATA_ROOT: dataRoot, PYTHONUNBUFFERED: '1' };

  try {
    const api = start('api', python, ['-m', 'papertree_api'], {
      cwd: REPO_ROOT,
      env: { ...pythonEnv, PAPERTREE_HOST: '127.0.0.1', PAPERTREE_PORT: String(apiPort) },
      logDir,
    });
    procs.push(api);
    const apiHealth = await waitUntil(api, 60_000, async () => {
      const response = await fetch(`${apiUrl}/healthz`);
      if (response.status === 200) return `GET /healthz 200 ${await response.text()}`;
      if (response.status === 404) {
        return 'GET /healthz 404: the route does not exist yet (S0 wave 2 adds it); the API is serving HTTP';
      }
      return null;
    });
    say(`api ready at ${apiUrl}: ${apiHealth}`);

    const worker = start('worker', python, ['-m', 'papertree_api.worker'], {
      cwd: REPO_ROOT,
      env: pythonEnv,
      logDir,
    });
    procs.push(worker);
    await sleep(1_500);
    if (exited(worker)) throw new Error(`the worker exited at startup; see ${worker.log}`);
    const workerHealth = `alive after 1.5 s (pid ${String(worker.child.pid)}), polling ${dataRoot}`;
    say(`worker ${workerHealth}`);

    const agent: StackInfo['agent'] = 'skipped';
    if (existsSync(AGENT_ENTRY)) {
      // S5 replaces this branch: start `pnpm --filter @papertree/agent start` in faux mode on a
      // free port, wait for its /healthz, and pass PAPERTREE_AGENT_URL + _SECRET to the API.
      throw new Error(
        `${AGENT_ENTRY} exists, so services/agent has source, but this harness does not start it ` +
          'yet. S5: wire the faux agent into e2e/harness/stack.ts.',
      );
    }
    say('');
    say('!!! AGENT SKIPPED: services/agent has no source yet (S5 implements it). No AI journey');
    say('!!! can run against this stack; specs that need it must skip and say so.');
    say('');

    prepareWebAssets(logDir);
    const web = start(
      'web',
      join(WEB_DIR, 'node_modules', '.bin', 'next'),
      ['dev', '--port', String(webPort), '--hostname', '127.0.0.1'],
      {
        cwd: WEB_DIR,
        env: {
          NEXT_PUBLIC_PAPERTREE_API_URL: apiUrl,
          // The committed fixtures stay reachable for the smoke; the product default flips to
          // `off` in S3 (#137), and a spec that needs it says so here rather than inheriting it.
          NEXT_PUBLIC_PAPERTREE_FIXTURES: 'on',
          NEXT_TELEMETRY_DISABLED: '1',
        },
        logDir,
      },
    );
    procs.push(web);
    const webHealth = await waitUntil(web, 240_000, async () => {
      const response = await fetch(`${webUrl}/login`);
      return response.status === 200 ? 'GET /login 200' : null;
    });
    say(`web ready at ${webUrl}: ${webHealth}`);

    const info: StackInfo = {
      apiUrl,
      webUrl,
      dataRoot,
      logDir,
      agent,
      health: { api: apiHealth, worker: workerHealth, web: webHealth },
    };
    writeFileSync(join(dataRoot, 'stack.json'), `${JSON.stringify(info, null, 2)}\n`);
    return { info, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
