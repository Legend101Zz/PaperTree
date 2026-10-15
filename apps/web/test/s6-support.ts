/**
 * Shared helpers for the S6 specs: an SSE `Response` built from §2.6 frames, a fetch router, and a
 * real Anchor. Not a spec itself (no `.spec`), so vitest does not collect it.
 */
import { vi } from 'vitest';

import type { Anchor } from '@papertree/anchoring';

export const PAPER = 'ppr_s6test';

export function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const run = (over: Record<string, unknown> = {}) =>
  frame('run', {
    run_id: 'run_1',
    thread_id: 'thr_1',
    user_message_id: 'msg_u1',
    message_id: 'msg_a1',
    generation: 1,
    ...over,
  });

export const text = (delta: string) => frame('text', { delta });
export const status = (data: Record<string, unknown>) => frame('status', data);

export function citation(marker: string, over: Record<string, unknown> = {}) {
  return {
    citation_id: `cit_${marker}`,
    ordinal: Number(marker.slice(1)),
    marker,
    page_index: 3,
    anchor: anchorFixture(marker),
    supported: true,
    ...over,
  };
}

export const usage = (over: Record<string, unknown> = {}) =>
  frame('usage', {
    run_id: 'run_1',
    model: 'MiniMax-M3',
    provider: 'minimax',
    agent_sdk: 'pi-coding-agent@0.87.1',
    input_tokens: 1000,
    output_tokens: 234,
    cache_read_tokens: 0,
    reasoning_tokens: 0,
    cost_usd_est: 0.0012,
    first_text_ms: 900,
    latency_ms: 2400,
    retries: 0,
    tool_calls: 1,
    ...over,
  });

export const done = (st = 'complete', error: unknown = null, id = 'msg_a1') =>
  frame('done', { status: st, error, message_id: id });

export function anchorFixture(id: string): Anchor {
  return {
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id: `anchor-${id}`,
    doc: { paperId: PAPER, pdfSha256: 'sha256:x', parserVersion: 'v1', textStreamId: 't' },
    targetKind: 'text',
    provenanceClass: 'source',
    selectors: [{ type: 'PageSelector', index: 3 }],
    created: { mode: 'source', at: '1970-01-01T00:00:00.000Z', client: 'test' },
  } as unknown as Anchor;
}

export interface SseHandle {
  push(chunk: string): void;
  close(): void;
}

/**
 * A 200 event-stream response. With `hold`, the stream stays open after the frames until the
 * request's signal aborts (then it errors with an AbortError, as fetch's body does).
 */
export function sseResponse(
  frames: readonly string[],
  options: { readonly hold?: boolean; readonly signal?: AbortSignal | null; readonly onHandle?: (h: SseHandle) => void } = {},
): Response {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const f of frames) c.enqueue(encoder.encode(f));
      if (options.hold !== true) c.close();
      options.signal?.addEventListener('abort', () => {
        try {
          c.error(new DOMException('The operation was aborted.', 'AbortError'));
        } catch {
          /* already closed */
        }
      });
    },
  });
  options.onHandle?.({
    push: (chunk) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body,
    text: async () => '',
    json: async () => ({}),
  } as unknown as Response;
}

export function jsonResponse(status: number, body: unknown): Response {
  const raw = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    text: async () => raw,
    json: async () => body,
  } as unknown as Response;
}

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** Install a fetch stub that records calls and answers by `METHOD path` from `routes`. */
export function installFetch(
  routes: Record<string, (call: Call, signal: AbortSignal | null) => Response | Promise<Response>>,
): { calls: Call[]; fetch: ReturnType<typeof vi.fn> } {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const call = { method, path, body };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) {
      return jsonResponse(404, { detail: `no route ${method} ${path}`, code: 'not_found', retryable: false });
    }
    return handler(call, init.signal ?? null);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetch: fetchMock };
}

export const errorBody = (code: string, detail = 'x', retryable = false) => ({ detail, code, retryable });
