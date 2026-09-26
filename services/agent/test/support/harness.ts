/**
 * Start the agent in-process on a free loopback port, a tool server beside it, and read its SSE.
 * Everything binds 127.0.0.1 and is addressed by IP, so a test makes no DNS lookup.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Model } from '@earendil-works/pi-ai';

import { type AgentApp, createAgentApp } from '../../src/app.ts';
import { type AgentConfig, preparePiEnvironment } from '../../src/config.ts';
import type { FauxBrain } from '../../src/faux.ts';
import { createLogger, type Level } from '../../src/log.ts';

preparePiEnvironment(process.env);

export const SECRET = `test-secret-${randomBytes(12).toString('hex')}`;
export const FAKE_KEY = `sk-test-${randomBytes(12).toString('hex')}`;

export interface LogLine {
  readonly level: string;
  readonly event: string;
  readonly [key: string]: unknown;
}

export interface Agent {
  readonly app: AgentApp;
  readonly url: string;
  readonly logs: LogLine[];
  readonly rawLogs: string[];
  close(): Promise<void>;
}

export async function startAgent(options: {
  readonly apiOrigin: string;
  readonly faux?: boolean;
  readonly brain?: FauxBrain;
  readonly modelOverride?: (model: Model<any>) => Model<any>;
  readonly pingMs?: number;
  readonly logLevel?: Level;
  readonly key?: string;
  readonly providerTimeoutMs?: number;
}): Promise<Agent> {
  const faux = options.faux ?? true;
  const config: AgentConfig = {
    secret: SECRET,
    minimaxKey: faux ? undefined : (options.key ?? FAKE_KEY),
    faux,
    port: 0,
    apiInternalOrigin: options.apiOrigin,
    logLevel: options.logLevel ?? 'debug',
  };
  const logs: LogLine[] = [];
  const rawLogs: string[] = [];
  const log = createLogger({
    level: config.logLevel,
    write: (line) => {
      rawLogs.push(line);
      logs.push(JSON.parse(line) as LogLine);
    },
  });
  const app = await createAgentApp({
    config,
    log,
    ...(options.pingMs === undefined ? {} : { pingMs: options.pingMs }),
    ...(options.brain === undefined ? {} : { brain: options.brain }),
    ...(options.modelOverride === undefined ? {} : { modelOverride: options.modelOverride }),
    ...(options.providerTimeoutMs === undefined
      ? {}
      : { providerTimeoutMs: options.providerTimeoutMs }),
  });
  const port = await app.listen(0);
  return { app, url: `http://127.0.0.1:${String(port)}`, logs, rawLogs, close: () => app.close() };
}

export type Frame =
  | {
      readonly kind: 'event';
      readonly event: string;
      readonly data: Record<string, unknown>;
      readonly raw: string;
      readonly at: number;
    }
  | { readonly kind: 'ping'; readonly at: number };

export interface RunResult {
  readonly status: number;
  readonly headers: Headers;
  readonly frames: Frame[];
  readonly events: Array<{ readonly event: string; readonly data: Record<string, unknown> }>;
  readonly text: string;
  readonly json?: unknown;
}

/** Parse a whole SSE body into frames, failing on anything that is not the §0 framing. */
export function parseSse(text: string): Frame[] {
  const frames: Frame[] = [];
  if (text.length === 0) return frames;
  if (!text.endsWith('\n\n'))
    throw new Error(
      `stream does not end with a complete frame: ${JSON.stringify(text.slice(-80))}`,
    );
  for (const block of text.slice(0, -2).split('\n\n')) {
    if (block === ': ping') {
      frames.push({ kind: 'ping', at: 0 });
      continue;
    }
    const lines = block.split('\n');
    if (lines.length !== 2 || !lines[0]?.startsWith('event: ') || !lines[1]?.startsWith('data: ')) {
      throw new Error(`not a §0 frame: ${JSON.stringify(block)}`);
    }
    const raw = lines[1].slice('data: '.length);
    frames.push({
      kind: 'event',
      event: lines[0].slice('event: '.length),
      data: JSON.parse(raw) as Record<string, unknown>,
      raw,
      at: 0,
    });
  }
  return frames;
}

/**
 * POST /v1/runs and read the stream to its end. `onFrame` sees each frame as it arrives (a test can
 * cancel the run from there).
 */
export async function postRun(
  url: string,
  body: unknown,
  options: {
    readonly secret?: string | null;
    readonly onFrame?: (frame: Frame, events: RunResult['events']) => void | Promise<void>;
    readonly signal?: AbortSignal;
  } = {},
): Promise<RunResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  const secret = options.secret === undefined ? SECRET : options.secret;
  if (secret !== null) headers['x-papertree-agent-secret'] = secret;
  if (typeof body === 'object' && body !== null && 'request_id' in body)
    headers['x-request-id'] = String((body as { request_id: unknown }).request_id);
  const t0 = performance.now();
  const response = await fetch(`${url}/v1/runs`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('text/event-stream')) {
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      frames: [],
      events: [],
      text,
      json: JSON.parse(text),
    };
  }
  const frames: Frame[] = [];
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let text = '';
  let pending = '';
  const decoder = new TextDecoder();
  const reader = response.body?.getReader();
  if (!reader) throw new Error('no body');
  for (;;) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (options.signal?.aborted) break;
      throw error;
    }
    if (chunk.done) break;
    const piece = decoder.decode(chunk.value, { stream: true });
    text += piece;
    pending += piece;
    let cut = pending.indexOf('\n\n');
    while (cut !== -1) {
      const block = pending.slice(0, cut + 2);
      pending = pending.slice(cut + 2);
      const at = Math.round(performance.now() - t0);
      const [parsed] = parseSse(block);
      if (parsed) {
        const frame: Frame = { ...parsed, at };
        frames.push(frame);
        if (frame.kind === 'event') events.push({ event: frame.event, data: frame.data });
        await options.onFrame?.(frame, events);
      }
      cut = pending.indexOf('\n\n');
    }
  }
  return { status: response.status, headers: response.headers, frames, events, text };
}

export async function deleteRun(
  url: string,
  run: string,
  secret: string | null = SECRET,
): Promise<number> {
  const response = await fetch(`${url}/v1/runs/${run}`, {
    method: 'DELETE',
    headers: secret === null ? {} : { 'x-papertree-agent-secret': secret },
  });
  await response.text();
  return response.status;
}

export interface ToolHit {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly authorization: string | undefined;
  readonly requestId: string | undefined;
}

export type ToolAnswer = {
  readonly status: number;
  readonly body?: unknown;
  readonly delayMs?: number;
  readonly raw?: string;
};

export interface ToolServer {
  readonly origin: string;
  readonly hits: ToolHit[];
  baseUrl(run: string): string;
  close(): Promise<void>;
}

/** A stand-in for the API's §4 internal tool routes. `answer` decides each response. */
export async function startToolServer(
  answer: (hit: ToolHit) => ToolAnswer | Promise<ToolAnswer>,
): Promise<ToolServer> {
  const hits: ToolHit[] = [];
  const server: Server = createServer((request: IncomingMessage, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const hit: ToolHit = {
      method: request.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      authorization: request.headers.authorization,
      requestId:
        typeof request.headers['x-request-id'] === 'string'
          ? request.headers['x-request-id']
          : undefined,
    };
    hits.push(hit);
    void (async () => {
      const result = await answer(hit);
      if (result.delayMs) await new Promise((resolve) => setTimeout(resolve, result.delayMs));
      const text = result.raw ?? JSON.stringify(result.body ?? {});
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(text);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    origin,
    hits,
    baseUrl: (run) => `${origin}/internal/agent/runs/${run}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** A structurally valid run id (`run_` + 26 Crockford base32 characters). */
export function runId(n: number): string {
  return `run_01K6TEST${String(n).padStart(18, '0')}`;
}
export function requestId(n: number): string {
  return `req_01K6TEST${String(n).padStart(18, '0')}`;
}
export function threadId(n: number): string {
  return `thr_01K6TEST${String(n).padStart(18, '0')}`;
}
