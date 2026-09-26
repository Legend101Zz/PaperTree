/**
 * The HTTP service (contracts.md §3.2), bound to 127.0.0.1 only:
 *
 *   POST   /v1/runs            X-PaperTree-Agent-Secret; body = run-request.schema.json -> SSE
 *   DELETE /v1/runs/{run_id}   abort; 204, idempotent (a finished run is 204 too), 404 if never seen
 *   GET    /healthz            no auth, no secrets
 *
 * Errors before the stream starts are the §0 JSON envelope `{detail, code, retryable}`.
 *
 * Boot (createAgentApp) refuses to start unless the process environment is the §3.1 one and one
 * probe session, built by the same `createPaperSession()` every run uses, has exactly the four paper
 * tools and the §3.1 settings (spike-verify must-fix 6/7). The M5/M6 mutants
 * (`test/mutants.ts`) prove the test suite fails when either tool-isolation layer is removed.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryCredentialStore, type Model } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

import { type AgentConfig, environmentProblems } from './config.ts';
import {
  MODEL_ID,
  MODEL_LABEL,
  PI_AI_VERSION,
  PINNED_SDK_VERSION,
  PROVIDER_ID,
  SDK_LABEL,
  SDK_VERSION,
  TOOL_NAMES,
  validateRunRequest,
} from './contract.ts';
import { createFauxModel, defaultBrain, type FauxBrain, type FauxModel } from './faux.ts';
import type { Logger } from './log.ts';
import { type ActiveRun, startRun } from './run.ts';
import { createPaperSession } from './session.ts';
import { SseWriter } from './sse.ts';
import { createPaperTools } from './tools.ts';

export const DEFAULT_PING_MS = 5_000;
/** A run request is a few KB plus the thread's history; this bounds a hostile or broken body. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** How many finished run ids DELETE still answers 204 for. */
const FINISHED_KEPT = 2_000;

export interface AppOptions {
  readonly config: AgentConfig;
  readonly log: Logger;
  readonly pingMs?: number;
  /** Faux mode only: the script chooser (default `defaultBrain`). */
  readonly brain?: FauxBrain;
  /**
   * TESTS ONLY, never read from the environment: rewrite the live model, e.g. point its `baseUrl`
   * at a local mock Anthropic server so the real provider code path runs offline.
   */
  readonly modelOverride?: (model: Model<any>) => Model<any>;
  /** TESTS ONLY, never from the environment: the provider's time-to-headers bound (§3.1: 30 s). */
  readonly providerTimeoutMs?: number;
}

export interface Health {
  ok: boolean;
  sdk: string;
  pi_ai: string;
  model: string;
  key_present: boolean;
  wiring_ok: boolean;
  active_runs: number;
  faux: boolean;
}

export interface AgentApp {
  readonly server: Server;
  readonly faux: FauxModel | undefined;
  readonly model: Model<any>;
  readonly modelRuntime: ModelRuntime;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  health(): Health;
}

export class BootError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`agent refused to start: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

function sameSecret(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  requestId?: string,
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    ...(requestId ? { 'x-request-id': requestId } : {}),
  });
  response.end(text);
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  detail: string,
  retryable = false,
  requestId?: string,
): void {
  sendJson(response, status, { detail, code, retryable }, requestId);
}

class BodyTooLarge extends Error {}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLarge());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** The §3.1 wiring, checked on a probe session built exactly as every run's is. */
const noop = (): undefined => undefined;

async function wiringProblems(runtime: ModelRuntime, model: Model<any>): Promise<string[]> {
  const problems: string[] = [];
  const tools = createPaperTools({
    baseUrl: 'http://127.0.0.1:9/internal/agent/runs/run_probe',
    token: 'probe',
    requestId: 'req_probe',
    runId: 'run_probe',
    log: { debug: noop, info: noop, warn: noop, error: noop, redact: noop, forget: noop },
    callIndex: () => undefined,
    maxToolCalls: 0,
    onResult: noop,
    onFatal: noop,
  });
  const probe = await createPaperSession({
    modelRuntime: runtime,
    model,
    maxOutputTokens: 4096,
    maxRetries: 1,
    systemPrompt: 'PaperTree wiring probe.',
    tools,
    sessionId: 'wiring-probe',
    entries: [],
  });
  try {
    const session = probe.session;
    const all = session.getAllTools().map((tool) => tool.name);
    if (JSON.stringify(all) !== JSON.stringify(TOOL_NAMES))
      problems.push(`getAllTools() is [${all.join(', ')}]`);
    const active = session.getActiveToolNames();
    if (JSON.stringify(active) !== JSON.stringify(TOOL_NAMES))
      problems.push(`active tools are [${active.join(', ')}]`);
    const settings = session.settingsManager;
    const defaults = settings.getDefaultTools();
    if (!Array.isArray(defaults) || defaults.length !== 0) problems.push('defaultTools is not []');
    if (settings.getCompactionEnabled()) problems.push('compaction is on');
    if (settings.getCacheWarmingMode() !== 'off') problems.push('cache warming is on');
    if (settings.getEnableInstallTelemetry()) problems.push('install telemetry is on');
    if (settings.getHttpIdleTimeoutMs() !== 60_000) problems.push('httpIdleTimeoutMs is not 60000');
    const retry = settings.getRetrySettings();
    if (!retry.enabled || retry.maxRetries !== 1 || retry.baseDelayMs !== 1_000)
      problems.push("agent retry is not §3.1's");
    const provider = settings.getProviderRetrySettings();
    if (provider.maxRetries !== 0 || provider.timeoutMs !== 30_000)
      problems.push("provider retry is not §3.1's");
    if (session.sessionManager.isPersisted()) problems.push('the session manager persists to disk');
    if (session.model?.maxTokens !== 4096)
      problems.push("the model's maxTokens is not the run's cap");
    if (!session.systemPrompt.startsWith('PaperTree wiring probe.'))
      problems.push('the system prompt is not ours');
  } finally {
    probe.dispose();
  }
  return problems;
}

export async function createAgentApp(options: AppOptions): Promise<AgentApp> {
  const { config, log } = options;
  const pingMs = options.pingMs ?? DEFAULT_PING_MS;
  const problems = environmentProblems();
  if (SDK_VERSION !== PINNED_SDK_VERSION)
    problems.push(`pi-coding-agent is ${SDK_VERSION}, pinned ${PINNED_SDK_VERSION}`);
  if (PI_AI_VERSION !== PINNED_SDK_VERSION)
    problems.push(`pi-ai is ${PI_AI_VERSION}, pinned ${PINNED_SDK_VERSION}`);
  if (problems.length > 0) throw new BootError(problems);

  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  let faux: FauxModel | undefined;
  let model: Model<any>;
  if (config.faux) {
    faux = createFauxModel();
    modelRuntime.registerNativeProvider(faux.provider);
    model = faux.model;
  } else {
    if (config.minimaxKey === undefined) throw new BootError(['no MiniMax key']);
    log.redact(config.minimaxKey);
    await modelRuntime.setRuntimeApiKey(PROVIDER_ID, config.minimaxKey);
    const m3 = modelRuntime.getModel(PROVIDER_ID, MODEL_ID);
    if (!m3) throw new BootError([`${MODEL_LABEL} is missing from Pi's built-in catalog`]);
    model = options.modelOverride ? options.modelOverride(m3) : m3;
  }
  log.redact(config.secret);

  const wiring = await wiringProblems(modelRuntime, model);
  if (wiring.length > 0) throw new BootError(wiring);

  const active = new Map<string, ActiveRun>();
  const threads = new Set<string>();
  const finished: string[] = [];
  const finishedSet = new Set<string>();
  const brain = options.brain ?? defaultBrain;

  const remember = (runId: string): void => {
    finished.push(runId);
    finishedSet.add(runId);
    while (finished.length > FINISHED_KEPT) {
      const old = finished.shift();
      if (old !== undefined) finishedSet.delete(old);
    }
  };

  const health = (): Health => ({
    ok: true,
    sdk: SDK_LABEL,
    pi_ai: PI_AI_VERSION,
    model: MODEL_LABEL,
    key_present: config.minimaxKey !== undefined,
    wiring_ok: true,
    active_runs: active.size,
    faux: config.faux,
  });

  const postRun = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const requestId =
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined;
    const secret = request.headers['x-papertree-agent-secret'];
    if (!sameSecret(typeof secret === 'string' ? secret : undefined, config.secret)) {
      sendError(
        response,
        401,
        'auth_required',
        'The agent secret is missing or wrong.',
        false,
        requestId,
      );
      return;
    }
    let raw: string;
    try {
      raw = await readBody(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLarge)
        sendError(response, 413, 'payload_too_large', 'The run request is too large.');
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      sendError(
        response,
        422,
        'validation_failed',
        'body: the request body could not be parsed',
        false,
        requestId,
      );
      return;
    }
    const checked = validateRunRequest(body);
    if (!checked.ok) {
      sendError(response, 422, 'validation_failed', checked.detail, false, requestId);
      return;
    }
    const run = checked.request;
    if (new URL(run.tool.base_url).origin !== config.apiInternalOrigin) {
      sendError(
        response,
        422,
        'validation_failed',
        "tool.base_url: not this agent's API origin",
        false,
        run.request_id,
      );
      return;
    }
    if (active.has(run.run_id) || finishedSet.has(run.run_id)) {
      sendError(response, 409, 'busy', 'This run id has already been used.', false, run.request_id);
      return;
    }
    const thread = run.history?.session_id;
    if (thread !== undefined && threads.has(thread)) {
      sendError(
        response,
        409,
        'busy',
        'A run is already live on this thread.',
        true,
        run.request_id,
      );
      return;
    }
    if (thread !== undefined) threads.add(thread);
    const sse = new SseWriter(response);
    sse.start(run.request_id);
    const gone = new AbortController();
    const onClose = (): void => {
      if (!response.writableEnded) gone.abort();
    };
    response.on('close', onClose);
    const handle = startRun(
      run,
      sse,
      {
        modelRuntime,
        model,
        log,
        pingMs,
        ...(faux ? { faux: { model: faux, brain } } : {}),
        ...(options.providerTimeoutMs === undefined
          ? {}
          : { providerTimeoutMs: options.providerTimeoutMs }),
      },
      gone.signal,
    );
    active.set(run.run_id, handle);
    try {
      await handle.finished;
    } finally {
      active.delete(run.run_id);
      if (thread !== undefined) threads.delete(thread);
      remember(run.run_id);
      response.off('close', onClose);
      sse.end();
    }
  };

  const deleteRun = (request: IncomingMessage, response: ServerResponse, runId: string): void => {
    const secret = request.headers['x-papertree-agent-secret'];
    if (!sameSecret(typeof secret === 'string' ? secret : undefined, config.secret)) {
      sendError(response, 401, 'auth_required', 'The agent secret is missing or wrong.');
      return;
    }
    const run = active.get(runId);
    if (run) {
      run.abort('client');
      response.writeHead(204).end();
      return;
    }
    if (finishedSet.has(runId)) {
      response.writeHead(204).end();
      return;
    }
    sendError(response, 404, 'not_found', 'No such run.');
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = request.method ?? 'GET';
    const handle = async (): Promise<void> => {
      if (path === '/healthz') {
        if (method !== 'GET') return sendError(response, 405, 'not_found', 'GET only.');
        return sendJson(response, 200, health());
      }
      if (path === '/v1/runs') {
        if (method !== 'POST') return sendError(response, 405, 'not_found', 'POST only.');
        return postRun(request, response);
      }
      const match = /^\/v1\/runs\/([^/]+)$/.exec(path);
      if (match?.[1]) {
        if (method !== 'DELETE') return sendError(response, 405, 'not_found', 'DELETE only.');
        return deleteRun(request, response, decodeURIComponent(match[1]));
      }
      return sendError(response, 404, 'not_found', 'No such route.');
    };
    handle().catch((error: unknown) => {
      log.error('agent.http.error', {
        route: path,
        error_type: error instanceof Error ? error.name : typeof error,
      });
      if (!response.headersSent) sendError(response, 500, 'internal', 'Something went wrong.');
      else response.end();
    });
  });
  server.keepAliveTimeout = 5_000;

  return {
    server,
    faux,
    model,
    modelRuntime,
    health,
    listen: (port = config.port) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve((server.address() as AddressInfo).port);
        });
      }),
    close: async () => {
      for (const run of active.values()) run.abort('client');
      await Promise.allSettled([...active.values()].map((run) => run.finished));
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}
