/**
 * lib/api/client — the ONE transport to `services/api` (contracts.md §5).
 *
 * Every feature module (`papers`, `highlights`, `threads`, `summary`, `usage`, `boards`) is a thin
 * typed wrapper over the four functions here, so the things that must be true of every request are
 * true in one place:
 *
 *   - the session token rides in `Authorization: Bearer …`, never in a URL (`papersApi.file`'s
 *     header explains the leak a query-string token causes);
 *   - a non-2xx answer becomes an `ApiError(status, code, detail, retryable)` parsed from the §0
 *     error envelope `{detail, code, retryable}` — with a sane fallback for the bodies the server
 *     sends today that are NOT an envelope (FastAPI's `{detail: "…"}`, its 422 `{detail: [...]}`,
 *     and plain text);
 *   - THE 401 POLICY: only a 401 clears the session and sends the user to `/login?next=…`. A
 *     network error or a 5xx NEVER signs anyone out (frontend-map §1.3: a flaky connection used to
 *     log the user out of a session that was perfectly valid). A 401 from `/auth/login` or
 *     `/auth/register` is a wrong password, not an expired session, so it is exempt.
 *
 * SSE IS READ WITH `fetch` + `ReadableStream`, NOT `EventSource`: `EventSource` cannot send an
 * `Authorization` header (contracts.md §0), and the only way to give it one is the token-in-URL
 * leak above. `SseFrameParser` is exported on its own so its framing rules are testable without a
 * network: `event:`/`data:` lines, a blank line dispatches, `: ping` comment heartbeats are dropped,
 * and a frame split across two network chunks is reassembled.
 *
 * THE UPLOAD USES XHR because `fetch` still cannot report upload progress in any browser the
 * product supports; `xhr.upload.onprogress` can.
 */
import type { UploadResponse } from './papers';
import { ApiError, type ErrorCode, type SseEvent } from './types';

export const API_BASE_URL = process.env.NEXT_PUBLIC_PAPERTREE_API_URL ?? 'http://localhost:8000';

// ─── the session token ────────────────────────────────────────────────────────────────────────

/**
 * Where the session token lives — THE ONLY KEY, since #77.
 *
 * `lib/auth.ts` delegates here, so there is one key and one session (UX-WALK-77 §D2): the reader
 * and the library can no longer disagree about whether the user is signed in.
 */
const TOKEN_KEY = 'papertree.session';

export function getSessionToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function setSessionToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearSessionToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

// ─── errors ───────────────────────────────────────────────────────────────────────────────────

/**
 * The request never got an HTTP answer: offline, DNS, a refused connection, CORS.
 *
 * Deliberately NOT an `ApiError`. An `ApiError` means the server answered, and a caller that
 * branches on `status` must not be able to mistake "no answer" for one — that confusion is how a
 * network blip used to sign the user out.
 */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

/** Exhaustive by construction: a code added to `ErrorCode` and not here is a type error. */
const ERROR_CODES: Record<ErrorCode, true> = {
  auth_required: true,
  invalid_credentials: true,
  email_taken: true,
  not_found: true,
  validation_failed: true,
  empty_upload: true,
  payload_too_large: true,
  unsupported_media_type: true,
  not_parsed: true,
  not_failed: true,
  busy: true,
  stale_version: true,
  generation_not_found: true,
  anchor_incomplete: true,
  anchor_mismatch: true,
  budget_exhausted: true,
  agent_unavailable: true,
  not_configured: true,
  internal: true,
  not_implemented: true,
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/**
 * The code for a body that is not an envelope. Only statuses with ONE §2.9 meaning get a specific
 * code; a 409 has six possible meanings and guessing one would be worse than `internal`.
 */
function fallbackCode(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'validation_failed';
    case 401:
      return 'auth_required';
    case 404:
      return 'not_found';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'budget_exhausted';
    case 503:
      return 'agent_unavailable';
    default:
      return 'internal';
  }
}

/** Gateway-class failures are worth one more try; everything else would fail the same way again. */
function fallbackRetryable(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `detail` as a sentence: a string as-is, or the first entry of FastAPI's 422 list. */
function detailSentence(detail: unknown): string | null {
  if (typeof detail === 'string') return detail.length > 0 ? detail : null;
  if (Array.isArray(detail) && detail.length > 0 && isRecord(detail[0])) {
    const first = detail[0];
    const loc = Array.isArray(first['loc'])
      ? first['loc'].filter((part) => part !== 'body').join('.')
      : '';
    const msg = typeof first['msg'] === 'string' ? first['msg'] : 'is invalid';
    return loc.length > 0 ? `${loc}: ${msg}` : msg;
  }
  return null;
}

const MAX_DETAIL = 400;

/**
 * Parse a non-2xx body into an `ApiError`.
 *
 * The §0 envelope wins field by field; anything missing or malformed falls back to what the status
 * alone can say. Plain text is kept (truncated) rather than replaced, because it is often the only
 * useful sentence — `ask-wiring.spec` pins that a 503's "set PAPERTREE_LLM_API_KEY" survives.
 */
export function apiErrorFrom(status: number, statusText: string, bodyText: string): ApiError {
  let parsed: unknown;
  try {
    parsed = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
  } catch {
    parsed = undefined;
  }

  const fallbackDetail =
    bodyText.trim().slice(0, MAX_DETAIL) ||
    statusText ||
    `The server answered HTTP ${String(status)}.`;

  if (isRecord(parsed)) {
    const detail = detailSentence(parsed['detail']);
    return new ApiError(
      status,
      isErrorCode(parsed['code']) ? parsed['code'] : fallbackCode(status),
      detail === null ? fallbackDetail : detail.slice(0, MAX_DETAIL),
      typeof parsed['retryable'] === 'boolean' ? parsed['retryable'] : fallbackRetryable(status),
    );
  }
  return new ApiError(status, fallbackCode(status), fallbackDetail, fallbackRetryable(status));
}

// ─── the 401 policy ───────────────────────────────────────────────────────────────────────────

/** A 401 here means "wrong password", which is a form error, not an expired session. */
const CREDENTIAL_ENTRY_PATHS: ReadonlySet<string> = new Set(['/auth/login', '/auth/register']);

/**
 * Where a 401 sends the user: the login page, carrying where they were so sign-in can return them.
 * `null` when they are already on a credential page — redirecting there again would loop.
 */
export function loginRedirectTarget(pathname: string, search = ''): string | null {
  if (pathname.startsWith('/login') || pathname.startsWith('/register')) return null;
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;
}

export type UnauthorizedHandler = (info: { readonly path: string }) => void;

const redirectToLogin: UnauthorizedHandler = () => {
  if (typeof window === 'undefined') return;
  const target = loginRedirectTarget(window.location.pathname, window.location.search);
  if (target !== null) window.location.assign(target);
};

let onUnauthorized: UnauthorizedHandler = redirectToLogin;

/** Replace what a 401 does after the session is cleared. Tests only; `null` restores the default. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler ?? redirectToLogin;
}

/**
 * Apply the policy to one HTTP answer. EXACTLY a 401 signs out — never a 5xx, never a 403, never a
 * network error (which does not reach this function at all: it has no status).
 */
function applyAuthPolicy(status: number, path: string): void {
  if (status !== 401) return;
  if (CREDENTIAL_ENTRY_PATHS.has(path)) return;
  clearSessionToken();
  onUnauthorized({ path });
}

// ─── requests ─────────────────────────────────────────────────────────────────────────────────

function urlFor(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_BASE_URL}${path}`;
}

function pathOf(path: string): string {
  if (!/^https?:\/\//.test(path)) return path.split('?')[0] ?? path;
  try {
    return new URL(path).pathname;
  } catch {
    return path;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

/**
 * `fetch` with the Bearer header, the error envelope and the 401 policy. Resolves only on 2xx.
 *
 * `Content-Type: application/json` is set for a string body and NEVER for `FormData`: `fetch` sets
 * `multipart/form-data` and its boundary itself, and a hand-set header omits the boundary.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getSessionToken();
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  if (init.body !== undefined && init.body !== null && !(init.body instanceof FormData)) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(urlFor(path), { ...init, headers });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new NetworkError(`Could not reach PaperTree at ${API_BASE_URL}.`, { cause: error });
  }

  if (!response.ok) {
    // The service answers 404 for "not yours" as well as "not there" — deliberately, so a paper id
    // is not an existence oracle. The message must not pretend to know which it was.
    const body = await response.text().catch(() => '');
    const error = apiErrorFrom(response.status, response.statusText, body);
    applyAuthPolicy(response.status, pathOf(path));
    throw error;
  }
  return response;
}

/** JSON in, JSON out. A 204 (or an empty 2xx body, e.g. a 202 with nothing to say) is `undefined`. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(
      response.status,
      'internal',
      'The server sent a response that is not JSON.',
      false,
    );
  }
}

// ─── SSE ──────────────────────────────────────────────────────────────────────────────────────

const SSE_EVENTS: ReadonlySet<string> = new Set([
  'run',
  'status',
  'text',
  'citations',
  'usage',
  'done',
]);

/**
 * An incremental parser for `text/event-stream` (the WHATWG framing, restricted to what
 * contracts.md §0 sends: LF or CRLF line ends, one-line JSON `data`).
 *
 * - `event: <name>` names the next frame; `data: <json>` carries it; a blank line dispatches.
 * - A line starting with `:` is a comment — the `: ping` heartbeat — and is dropped.
 * - Several `data:` lines join with `\n`, as the standard says; `id:` and `retry:` are ignored.
 * - An event name outside §2.6 is skipped, so a server that adds one does not break old readers.
 * - Malformed `data` JSON THROWS. A frame the reader cannot parse is a broken contract, and
 *   swallowing it would turn a missing `done` into a panel that spins forever.
 * - `push` is fed arbitrary chunks: a frame (or a line, or a CRLF pair) split across two network
 *   reads is held until it is complete.
 */
export class SseFrameParser {
  private buffer = '';
  private eventName = '';
  private dataLines: string[] = [];

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const out: SseEvent[] = [];
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const event = this.line(line);
      if (event !== null) out.push(event);
    }
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line.length === 0) return this.dispatch();
    if (line.startsWith(':')) return null;

    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') this.eventName = value;
    else if (field === 'data') this.dataLines.push(value);
    return null;
  }

  private dispatch(): SseEvent | null {
    const name = this.eventName.length > 0 ? this.eventName : 'message';
    const data = this.dataLines.join('\n');
    const hadData = this.dataLines.length > 0;
    this.eventName = '';
    this.dataLines = [];
    if (!hadData || !SSE_EVENTS.has(name)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error(`The server sent a malformed "${name}" event: its data is not JSON.`);
    }
    return { event: name, data: parsed } as SseEvent;
  }
}

/**
 * Every event on a `text/event-stream` body, in order.
 *
 * A frame still incomplete when the stream ends is DISCARDED, as the standard specifies — a
 * truncated `done` must read as "no done", not as a done with half its fields. Returning early
 * (a `break` in the consumer's `for await`) cancels the underlying read.
 */
export async function* readSseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new SseFrameParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    yield* parser.push(decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * POST a JSON body and stream the §2.6 events back.
 *
 * Pre-stream failures (409 `not_parsed`, 429 `budget_exhausted`, 503 `agent_unavailable`, …) are
 * JSON and arrive BEFORE any event, so they throw an `ApiError` from the first `next()`, through
 * the same envelope parsing and 401 policy as every other request.
 */
export async function* streamSse(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const response = await apiFetch(url, {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    body: JSON.stringify(body ?? {}),
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.body === null) {
    throw new ApiError(response.status, 'internal', 'The server sent an empty event stream.', true);
  }
  yield* readSseEvents(response.body);
}

// ─── upload ───────────────────────────────────────────────────────────────────────────────────

export interface UploadProgress {
  readonly loaded: number;
  /** `null` when the browser cannot compute the request's total size. */
  readonly total: number | null;
}

export interface UploadOptions {
  readonly onProgress?: (progress: UploadProgress) => void;
  readonly signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException('The upload was cancelled.', 'AbortError');
}

/**
 * `POST /papers` as multipart, reporting upload progress. Resolves with the 202 body.
 *
 * Aborting (the signal, or a signal that is already aborted) rejects with an `AbortError` and sends
 * nothing further; a transport failure rejects with `NetworkError`; a non-2xx rejects with an
 * `ApiError` after the 401 policy has run — the same three outcomes as `apiFetch`.
 */
export function uploadWithProgress(
  file: File,
  options: UploadOptions = {},
): Promise<UploadResponse> {
  const { onProgress, signal } = options;
  return new Promise<UploadResponse>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    const onAbort = (): void => xhr.abort();
    const settle = (): void => signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', urlFor('/papers'));
    const token = getSessionToken();
    if (token !== null) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.onprogress = (event: ProgressEvent) => {
      onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null });
    };
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } catch {
          reject(
            new ApiError(xhr.status, 'internal', 'The upload response was not JSON.', false),
          );
        }
        return;
      }
      const error = apiErrorFrom(xhr.status, xhr.statusText, xhr.responseText);
      applyAuthPolicy(xhr.status, '/papers');
      reject(error);
    };
    xhr.onerror = () => {
      settle();
      reject(new NetworkError(`Could not reach PaperTree at ${API_BASE_URL}.`));
    };
    xhr.onabort = () => {
      settle();
      reject(abortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
