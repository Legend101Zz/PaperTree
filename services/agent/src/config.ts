/**
 * The agent's configuration (contracts.md §7, the agent's rows) and the process environment Pi runs
 * in (§3.1). Boot refuses to start rather than run half-configured.
 *
 *   PAPERTREE_AGENT_SECRET      required; the API's `X-PaperTree-Agent-Secret`
 *   PAPERTREE_MINIMAX_API_KEY   required, unless PAPERTREE_AGENT_FAUX=1; read once, then removed
 *                               from process.env so nothing later in the process can pick it up
 *   PAPERTREE_AGENT_FAUX        "1": the scripted faux model (tests, e2e). The key is not read.
 *   PAPERTREE_AGENT_PORT        default 8200; the service binds 127.0.0.1 only
 *   PAPERTREE_API_INTERNAL_URL  default http://127.0.0.1:8000; a run's `tool.base_url` must be on
 *                               this origin, so a run token is never sent anywhere else
 *   PAPERTREE_AGENT_LOG_LEVEL   default info; `debug` adds raw provider error text (§3.3)
 *
 * Set here, before any Pi code runs: PI_OFFLINE=1, PI_TELEMETRY=0, and PI_CODING_AGENT_DIR = a new
 * empty directory this process owns (mode 0700, removed at exit). `MINIMAX_API_KEY` — Pi's ambient
 * fallback, which the in-memory credential store does NOT block (spike-verify S4a) — is deleted.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Level, parseLevel } from './log.ts';

export interface AgentConfig {
  readonly secret: string;
  /** Absent in faux mode. */
  readonly minimaxKey: string | undefined;
  readonly faux: boolean;
  readonly port: number;
  readonly apiInternalOrigin: string;
  readonly logLevel: Level;
}

export class ConfigError extends Error {}

function port(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 8200;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new ConfigError(`PAPERTREE_AGENT_PORT=${raw} is not a port`);
  }
  return value;
}

function origin(raw: string | undefined): string {
  const text = raw === undefined || raw === '' ? 'http://127.0.0.1:8000' : raw;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError('PAPERTREE_API_INTERNAL_URL is not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('PAPERTREE_API_INTERNAL_URL must be http or https');
  }
  return url.origin;
}

/** Read the configuration from an environment. Throws ConfigError, never naming a secret's value. */
export function readConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const secret = env['PAPERTREE_AGENT_SECRET'] ?? '';
  if (secret === '') throw new ConfigError('PAPERTREE_AGENT_SECRET is not set');
  const faux = env['PAPERTREE_AGENT_FAUX'] === '1';
  const key = env['PAPERTREE_MINIMAX_API_KEY'] ?? '';
  if (!faux && key === '') {
    throw new ConfigError(
      'PAPERTREE_MINIMAX_API_KEY is not set (or set PAPERTREE_AGENT_FAUX=1 for the scripted test model)',
    );
  }
  return {
    secret,
    minimaxKey: faux ? undefined : key,
    faux,
    port: port(env['PAPERTREE_AGENT_PORT']),
    apiInternalOrigin: origin(env['PAPERTREE_API_INTERNAL_URL']),
    logLevel: parseLevel(env['PAPERTREE_AGENT_LOG_LEVEL']),
  };
}

/**
 * Put the process environment in the state §3.1 fixes, and return the empty agent directory.
 * Idempotent: a directory already set up by this process is kept.
 */
let ownedAgentDir: string | undefined;

export function preparePiEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  delete env['MINIMAX_API_KEY'];
  delete env['PAPERTREE_MINIMAX_API_KEY'];
  env['PI_OFFLINE'] = '1';
  env['PI_TELEMETRY'] = '0';
  if (ownedAgentDir !== undefined && ownedAgentDir === env['PI_CODING_AGENT_DIR'])
    return ownedAgentDir;
  const dir = mkdtempSync(join(tmpdir(), 'papertree-agent-pi-'));
  env['PI_CODING_AGENT_DIR'] = dir;
  ownedAgentDir = dir;
  process.once('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort: it is an empty temporary directory.
    }
  });
  return dir;
}

/** What the boot wiring check asserts about the environment (returns the problems, or none). */
export function environmentProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (env['MINIMAX_API_KEY'] !== undefined)
    problems.push("MINIMAX_API_KEY is set (Pi's ambient key fallback)");
  if (env['PAPERTREE_MINIMAX_API_KEY'] !== undefined)
    problems.push('PAPERTREE_MINIMAX_API_KEY is still in process.env');
  if (env['PI_OFFLINE'] !== '1') problems.push('PI_OFFLINE is not 1');
  if (env['PI_TELEMETRY'] !== '0') problems.push('PI_TELEMETRY is not 0');
  const dir = env['PI_CODING_AGENT_DIR'];
  if (dir === undefined || dir === '') {
    problems.push('PI_CODING_AGENT_DIR is not set');
  } else {
    try {
      if (!statSync(dir).isDirectory()) problems.push('PI_CODING_AGENT_DIR is not a directory');
      else if (readdirSync(dir).length > 0) problems.push('PI_CODING_AGENT_DIR is not empty');
    } catch {
      problems.push('PI_CODING_AGENT_DIR does not exist');
    }
  }
  return problems;
}
