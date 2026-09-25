/**
 * lib/api/client — the transport every feature module shares (contracts.md §0, §5).
 *
 * What is pinned here, and why each matters:
 *
 *   - ENVELOPE PARSING. `{detail, code, retryable}` becomes `ApiError(status, code, detail,
 *     retryable)`, and the bodies the server sends TODAY that are not an envelope (FastAPI's
 *     `{detail}`, its 422 list, plain text) still produce a readable sentence and a sane code.
 *   - THE 401 POLICY. Only a 401 clears the session and redirects; a 500, a 403 and a network error
 *     never sign the user out (frontend-map §1.3). A wrong password (401 on /auth/login) is a form
 *     error, not an expired session.
 *   - SSE FRAMING. `event:`/`data:`, blank-line dispatch, `: ping` comments dropped, frames split
 *     across network chunks reassembled, a truncated last frame discarded.
 *   - UPLOAD PROGRESS through a fake XHR, plus abort and the same error mapping as fetch.
 *
 * `fetch` and `XMLHttpRequest` are the only stubs; everything under them is the real module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  API_BASE_URL,
  apiErrorFrom,
  getSessionToken,
  loginRedirectTarget,
  NetworkError,
  readSseEvents,
  request,
  setSessionToken,
  setUnauthorizedHandler,
  SseFrameParser,
  streamSse,
  uploadWithProgress,
} from '@/lib/api/client';
import { ApiError, type SseEvent } from '@/lib/api/types';

const TOKEN = 'test-session-token-not-a-credential';

interface FakeResponseInit {
  readonly status?: number;
  readonly statusText?: string;
  readonly body?: string;
  readonly stream?: ReadableStream<Uint8Array>;
  readonly contentType?: string;
}

/** A structural `Response`: exactly the members `client.ts` reads, nothing it could lean on. */
function fakeResponse(init: FakeResponseInit = {}): Response {
  const status = init.status ?? 200;
  const body = init.body ?? '';
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? '',
    headers: new Headers(init.contentType === undefined ? {} : { 'content-type': init.contentType }),
    body: init.stream ?? null,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

function envelope(code: string, detail: string, retryable = false): string {
  return JSON.stringify({ detail, code, retryable });
}

/**
 * A byte stream that delivers `chunks` one `read()` at a time, and records a cancel.
 *
 * `hold` keeps the stream OPEN after the last chunk, like a live SSE connection waiting for its
 * next frame — without it the stream closes eagerly and a cancel has nothing left to cancel.
 */
function chunkedStream(
  chunks: readonly (string | Uint8Array)[],
  options: { readonly hold?: boolean } = {},
): {
  readonly stream: ReadableStream<Uint8Array>;
  readonly cancelled: () => boolean;
} {
  const encoder = new TextEncoder();
  let index = 0;
  let wasCancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[index];
      index += 1;
      if (next === undefined) {
        if (options.hold === true) return new Promise<void>(() => undefined);
        controller.close();
        return;
      }
      controller.enqueue(typeof next === 'string' ? encoder.encode(next) : next);
    },
    cancel() {
      wasCancelled = true;
    },
  });
  return { stream, cancelled: () => wasCancelled };
}

async function collect(events: AsyncIterable<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject, and it resolved');
}

const fetchMock = vi.fn();
const unauthorized = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  unauthorized.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setUnauthorizedHandler(unauthorized);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

// ─── the error envelope ───────────────────────────────────────────────────────────────────────

describe('apiErrorFrom — the §0 envelope, and the bodies that are not one', () => {
  it('takes code, detail and retryable from an envelope', () => {
    const error = apiErrorFrom(409, 'Conflict', envelope('not_parsed', 'Still reading this paper.'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
    expect(error.code).toBe('not_parsed');
    expect(error.detail).toBe('Still reading this paper.');
    expect(error.message).toBe('Still reading this paper.');
    expect(error.retryable).toBe(false);
  });

  it('honours the envelope retryable flag even when the status alone would say otherwise', () => {
    expect(apiErrorFrom(503, '', envelope('not_configured', 'AI is off.', false)).retryable).toBe(
      false,
    );
    expect(apiErrorFrom(429, '', envelope('budget_exhausted', 'Budget used.', true)).retryable).toBe(
      true,
    );
  });

  it("reads FastAPI's bare {detail} and derives the code from the status", () => {
    const error = apiErrorFrom(404, 'Not Found', JSON.stringify({ detail: 'no such paper' }));
    expect(error.code).toBe('not_found');
    expect(error.detail).toBe('no such paper');
    expect(error.retryable).toBe(false);
  });

  it("names the first failing field of FastAPI's 422 list", () => {
    const body = JSON.stringify({
      detail: [
        { loc: ['body', 'password'], msg: 'String should have at least 8 characters', type: 'x' },
        { loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'y' },
      ],
    });
    const error = apiErrorFrom(422, 'Unprocessable Entity', body);
    expect(error.code).toBe('validation_failed');
    expect(error.detail).toBe('password: String should have at least 8 characters');
  });

  it('keeps a plain-text body as the detail, truncated, instead of replacing it', () => {
    const error = apiErrorFrom(503, 'Service Unavailable', 'set PAPERTREE_LLM_API_KEY');
    expect(error.detail).toBe('set PAPERTREE_LLM_API_KEY');
    expect(error.code).toBe('agent_unavailable');
    expect(error.retryable).toBe(true);

    expect(apiErrorFrom(500, '', 'x'.repeat(5000)).detail).toHaveLength(400);
  });

  it('falls back to the status text, then to a sentence, for an empty body', () => {
    expect(apiErrorFrom(502, 'Bad Gateway', '').detail).toBe('Bad Gateway');
    expect(apiErrorFrom(502, '', '').detail).toBe('The server answered HTTP 502.');
    expect(apiErrorFrom(502, '', '').retryable).toBe(true);
  });

  it('never trusts an unknown code: it falls back to the status', () => {
    const error = apiErrorFrom(409, '', envelope('made_up_code', 'Something clashed.'));
    // A 409 has six §2.9 meanings; guessing one would be worse than admitting `internal`.
    expect(error.code).toBe('internal');
    expect(apiErrorFrom(415, '', envelope('nope', 'Not a PDF.')).code).toBe(
      'unsupported_media_type',
    );
  });
});

// ─── request() ────────────────────────────────────────────────────────────────────────────────

describe('request — Bearer, JSON, and the envelope on every call', () => {
  it('sends the session token as a Bearer header and JSON for a string body', async () => {
    setSessionToken(TOKEN);
    fetchMock.mockResolvedValue(fakeResponse({ status: 201, body: '{"token":"t"}' }));

    const result = await request<{ token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.c', password: 'password1' }),
    });

    expect(result).toEqual({ token: 't' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/auth/register`);
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('never sets Content-Type for FormData, so the browser adds the multipart boundary', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 202, body: '{"paper_id":"ppr_1"}' }));
    const form = new FormData();
    form.append('file', new File(['%PDF-1.7'], 'a.pdf', { type: 'application/pdf' }));

    await request('/papers', { method: 'POST', body: form });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('sends no Authorization header when nobody is signed in', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ body: '[]' }));
    await request('/papers');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('resolves a 204 and an empty 202 to undefined rather than failing to parse nothing', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 204 }));
    await expect(request('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 202, body: '' }));
    await expect(request('/runs/run_1/cancel', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws the parsed ApiError on a non-2xx', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 413, body: envelope('payload_too_large', 'Over 100 MB.') }),
    );
    const error = await caught(request('/papers', { method: 'POST', body: '{}' }));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('payload_too_large');
    expect((error as ApiError).detail).toBe('Over 100 MB.');
  });
});

// ─── the 401 policy ───────────────────────────────────────────────────────────────────────────

describe('the 401 policy — only a 401 signs the user out', () => {
  it('a 401 clears the session and calls the redirect, with the path that failed', async () => {
    setSessionToken(TOKEN);
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 401, body: envelope('auth_required', 'Please sign in again.') }),
    );

    const error = await caught(request('/papers?limit=5'));

    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe('auth_required');
    expect(getSessionToken()).toBeNull();
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledWith({ path: '/papers' });
  });

  it('a 500 does NOT sign out: the token survives and nothing redirects', async () => {
    setSessionToken(TOKEN);
    fetchMock.mockResolvedValue(fakeResponse({ status: 500, body: 'Internal Server Error' }));

    const error = await caught(request('/papers'));

    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).code).toBe('internal');
    expect(getSessionToken()).toBe(TOKEN);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('a 503 and a 403 do NOT sign out either', async () => {
    setSessionToken(TOKEN);
    for (const status of [503, 403]) {
      fetchMock.mockResolvedValueOnce(fakeResponse({ status, body: '{"detail":"no"}' }));
      await caught(request('/papers'));
    }
    expect(getSessionToken()).toBe(TOKEN);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('a network error does NOT sign out, and is a NetworkError rather than an ApiError', async () => {
    setSessionToken(TOKEN);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await caught(request('/papers'));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
    expect(getSessionToken()).toBe(TOKEN);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('an abort is passed through untouched: it is neither a network failure nor a sign-out', async () => {
    setSessionToken(TOKEN);
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

    const error = await caught(request('/papers'));

    expect((error as DOMException).name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(getSessionToken()).toBe(TOKEN);
  });

  it('a 401 from login or register is a wrong password, not an expired session', async () => {
    setSessionToken(TOKEN);
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 401, body: envelope('invalid_credentials', 'Wrong email or password.') }),
    );

    const error = await caught(
      request('/auth/login', { method: 'POST', body: '{"email":"a","password":"b"}' }),
    );

    expect((error as ApiError).code).toBe('invalid_credentials');
    expect(getSessionToken()).toBe(TOKEN);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('the redirect carries where the user was, and never loops on the login page', () => {
    expect(loginRedirectTarget('/paper/ppr_x/read', '?focus=cn_1')).toBe(
      '/login?next=%2Fpaper%2Fppr_x%2Fread%3Ffocus%3Dcn_1',
    );
    expect(loginRedirectTarget('/dashboard')).toBe('/login?next=%2Fdashboard');
    expect(loginRedirectTarget('/login', '?next=%2Fdashboard')).toBeNull();
    expect(loginRedirectTarget('/register')).toBeNull();
  });
});

// ─── SSE ──────────────────────────────────────────────────────────────────────────────────────

/** A recorded-shape §2.6 stream: every event kind, with pings between and inside frames. */
const STREAM = [
  ': ping',
  '',
  'event: run',
  'data: {"run_id":"run_1","thread_id":"thr_1","user_message_id":"msg_u","message_id":"msg_a","generation":1}',
  '',
  'event: status',
  'data: {"phase":"tool","label":"Reading p. 4 · §2.1"}',
  '',
  ': ping',
  '',
  'event: text',
  'data: {"delta":"The residual ⊙ "}',
  '',
  'event: text',
  ': ping',
  'data: {"delta":"block adds x."}',
  '',
  'event: usage',
  'data: {"run_id":"run_1","model":"MiniMax-M3","provider":"minimax","agent_sdk":"pi-coding-agent@0.87.1","input_tokens":10,"output_tokens":5,"cache_read_tokens":0,"reasoning_tokens":0,"cost_usd_est":0.0011,"first_text_ms":3800,"latency_ms":7700,"retries":0,"tool_calls":1}',
  '',
  'event: citations',
  'data: {"items":[]}',
  '',
  'event: done',
  'data: {"status":"complete","error":null,"message_id":"msg_a"}',
  '',
  '',
].join('\n');

const EXPECTED_KINDS = ['run', 'status', 'text', 'text', 'usage', 'citations', 'done'];

describe('SseFrameParser — contracts §0 framing', () => {
  it('parses a whole stream in one chunk, dropping every ping comment', () => {
    const events = new SseFrameParser().push(STREAM);
    expect(events.map((event) => event.event)).toEqual(EXPECTED_KINDS);
    expect(events[2]).toEqual({ event: 'text', data: { delta: 'The residual ⊙ ' } });
    // The ping INSIDE the second text frame did not end it or corrupt it.
    expect(events[3]).toEqual({ event: 'text', data: { delta: 'block adds x.' } });
    expect(events[6]).toEqual({
      event: 'done',
      data: { status: 'complete', error: null, message_id: 'msg_a' },
    });
  });

  it('reassembles frames split at EVERY possible position — one character per chunk', () => {
    const parser = new SseFrameParser();
    const events: SseEvent[] = [];
    for (const char of STREAM) events.push(...parser.push(char));
    expect(events).toEqual(new SseFrameParser().push(STREAM));
  });

  it('gives the same events for arbitrary chunk boundaries', () => {
    const whole = new SseFrameParser().push(STREAM);
    for (const size of [2, 3, 7, 13, 64]) {
      const parser = new SseFrameParser();
      const events: SseEvent[] = [];
      for (let at = 0; at < STREAM.length; at += size) {
        events.push(...parser.push(STREAM.slice(at, at + size)));
      }
      expect(events, `chunk size ${String(size)}`).toEqual(whole);
    }
  });

  it('accepts CRLF line ends, including a CR and its LF split across chunks', () => {
    const crlf = 'event: text\r\ndata: {"delta":"a"}\r\n\r\n';
    const parser = new SseFrameParser();
    const events = [...parser.push(crlf.slice(0, 12)), ...parser.push(crlf.slice(12))];
    // The first chunk ends ON the CR; its LF is the first character of the second.
    expect(crlf[11]).toBe('\r');
    expect(crlf[12]).toBe('\n');
    expect(events).toEqual([{ event: 'text', data: { delta: 'a' } }]);
  });

  it('joins several data lines with a newline, as the standard says', () => {
    const events = new SseFrameParser().push('event: text\ndata: {"delta":\ndata: "b"}\n\n');
    expect(events).toEqual([{ event: 'text', data: { delta: 'b' } }]);
  });

  it('holds a frame until its blank line arrives', () => {
    const parser = new SseFrameParser();
    expect(parser.push('event: done\ndata: {"status":"complete","error":null,"message_id":"m"}\n')).toEqual(
      [],
    );
    expect(parser.push('\n')).toHaveLength(1);
  });

  it('skips an event name outside §2.6, and a frame with no data', () => {
    const events = new SseFrameParser().push(
      'event: agent_internal\ndata: {"x":1}\n\nevent: text\n\nevent: text\ndata: {"delta":"z"}\n\n',
    );
    expect(events).toEqual([{ event: 'text', data: { delta: 'z' } }]);
  });

  it('throws on malformed data rather than dropping a frame silently', () => {
    expect(() => new SseFrameParser().push('event: done\ndata: {not json\n\n')).toThrow(
      /malformed "done" event/,
    );
  });
});

describe('readSseEvents / streamSse — over a real ReadableStream', () => {
  it('decodes a multi-byte character split across two network chunks', async () => {
    const bytes = new TextEncoder().encode('event: text\ndata: {"delta":"⊙"}\n\n');
    const marker = bytes.indexOf(0xe2); // the first byte of U+2299
    const { stream } = chunkedStream([bytes.slice(0, marker + 1), bytes.slice(marker + 1)]);

    expect(await collect(readSseEvents(stream))).toEqual([
      { event: 'text', data: { delta: '⊙' } },
    ]);
  });

  it('discards a frame still incomplete when the stream ends', async () => {
    const { stream } = chunkedStream([
      'event: text\ndata: {"delta":"a"}\n\n',
      'event: done\ndata: {"status":"complete","error":null,"message_id":"m"}\n',
    ]);
    const events = await collect(readSseEvents(stream));
    // A truncated `done` must read as "no done", never as a done.
    expect(events.map((event) => event.event)).toEqual(['text']);
  });

  it('POSTs JSON with Accept: text/event-stream and the Bearer header, then yields the events', async () => {
    setSessionToken(TOKEN);
    const { stream } = chunkedStream([STREAM.slice(0, 100), STREAM.slice(100, 333), STREAM.slice(333)]);
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 200, stream, contentType: 'text/event-stream' }),
    );

    const events = await collect(
      streamSse('/papers/ppr_1/threads', { kind: 'ask', question: 'Why?' }),
    );

    expect(events.map((event) => event.event)).toEqual(EXPECTED_KINDS);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/papers/ppr_1/threads`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'ask', question: 'Why?' });
    const headers = new Headers(init.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('throws a pre-stream ApiError from the first next(), before any event', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 429, body: envelope('budget_exhausted', "Today's AI budget is used.") }),
    );
    const error = await caught(streamSse('/papers/ppr_1/threads', { kind: 'ask' }).next());
    expect((error as ApiError).code).toBe('budget_exhausted');
    expect((error as ApiError).status).toBe(429);
  });

  it('cancels the network read when the consumer stops early', async () => {
    const { stream, cancelled } = chunkedStream([STREAM.slice(0, 200)], { hold: true });
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, stream }));

    for await (const event of streamSse('/papers/ppr_1/threads', { kind: 'ask' })) {
      expect(event.event).toBe('run');
      break;
    }
    expect(cancelled()).toBe(true);
  });

  it('passes the abort signal through to fetch', async () => {
    const { stream } = chunkedStream([]);
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, stream }));
    const controller = new AbortController();

    await collect(streamSse('/papers/ppr_1/summary', {}, controller.signal));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

// ─── upload with progress ─────────────────────────────────────────────────────────────────────

class FakeXhr {
  static last: FakeXhr | null = null;

  method = '';
  url = '';
  readonly headers = new Map<string, string>();
  sent: FormData | null = null;
  aborted = false;
  status = 0;
  statusText = '';
  responseText = '';
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  send(body: FormData): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  // ─ test drivers ─
  progress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent);
  }

  respond(status: number, body: string, statusText = ''): void {
    this.status = status;
    this.statusText = statusText;
    this.responseText = body;
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

function lastXhr(): FakeXhr {
  const xhr = FakeXhr.last;
  if (xhr === null) throw new Error('no XMLHttpRequest was constructed');
  return xhr;
}

describe('uploadWithProgress — XHR, because fetch cannot report upload progress', () => {
  const pdf = (): File => new File(['%PDF-1.7 fake'], 'yolo.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    FakeXhr.last = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  it('POSTs the file as multipart to /papers with the Bearer header, and reports progress', async () => {
    setSessionToken(TOKEN);
    const seen: { loaded: number; total: number | null }[] = [];
    const file = pdf();

    const done = uploadWithProgress(file, { onProgress: (progress) => seen.push({ ...progress }) });
    const xhr = lastXhr();
    xhr.progress(0, 2000);
    xhr.progress(1200, 2000);
    xhr.progress(2000, 2000);
    xhr.progress(10, 0, false);
    xhr.respond(202, JSON.stringify({ paper_id: 'ppr_1', job_id: 'job_1', created: true }));

    await expect(done).resolves.toEqual({ paper_id: 'ppr_1', job_id: 'job_1', created: true });
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(`${API_BASE_URL}/papers`);
    expect(xhr.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(xhr.sent?.get('file')).toBeInstanceOf(File);
    expect((xhr.sent?.get('file') as File).name).toBe('yolo.pdf');
    expect(seen).toEqual([
      { loaded: 0, total: 2000 },
      { loaded: 1200, total: 2000 },
      { loaded: 2000, total: 2000 },
      // An uncomputable length is reported as unknown, never as a fabricated 0-byte total.
      { loaded: 10, total: null },
    ]);
  });

  it('maps a non-2xx through the same envelope parsing, without signing out', async () => {
    setSessionToken(TOKEN);
    const done = uploadWithProgress(pdf());
    lastXhr().respond(413, envelope('payload_too_large', 'Over 100 MB.'), 'Payload Too Large');

    const error = await caught(done);
    expect((error as ApiError).code).toBe('payload_too_large');
    expect((error as ApiError).detail).toBe('Over 100 MB.');
    expect(getSessionToken()).toBe(TOKEN);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('applies the 401 policy', async () => {
    setSessionToken(TOKEN);
    const done = uploadWithProgress(pdf());
    lastXhr().respond(401, envelope('auth_required', 'Please sign in again.'));

    expect(((await caught(done)) as ApiError).status).toBe(401);
    expect(getSessionToken()).toBeNull();
    expect(unauthorized).toHaveBeenCalledWith({ path: '/papers' });
  });

  it('a transport failure is a NetworkError, and does not sign out', async () => {
    setSessionToken(TOKEN);
    const done = uploadWithProgress(pdf());
    lastXhr().fail();

    expect(await caught(done)).toBeInstanceOf(NetworkError);
    expect(getSessionToken()).toBe(TOKEN);
  });

  it('aborting the signal aborts the XHR and rejects with AbortError', async () => {
    const controller = new AbortController();
    const done = uploadWithProgress(pdf(), { signal: controller.signal });
    controller.abort();

    const error = await caught(done);
    expect((error as DOMException).name).toBe('AbortError');
    expect(lastXhr().aborted).toBe(true);
  });

  it('an already-aborted signal sends nothing at all', async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await caught(uploadWithProgress(pdf(), { signal: controller.signal }));
    expect((error as DOMException).name).toBe('AbortError');
    expect(FakeXhr.last).toBeNull();
  });
});
