/**
 * apps/web/src/lib/api — ONE client for `apps/api`.
 *
 * There were two. `fetchApi`, a `fetch` wrapper, and `api`, an axios instance with interceptors,
 * each with thirteen call sites, two auth-header conventions and two error shapes. Epic 2's brief
 * lists "the second API client in `lib/api.ts`" under Must delete; issue #60.
 *
 * THE FETCH ONE WON, and not by preference. The axios instance was the richer of the two — it
 * carried the request interceptor that attaches the bearer token and the response interceptor that
 * signs the user out on a 401 — but both are ten lines to express directly, and expressing them
 * directly removes a runtime dependency from the browser bundle rather than adding one. `FormData`
 * needed no help either: `fetch` sets `multipart/form-data` AND its boundary itself, which is why
 * `upload` below omits `Content-Type` rather than setting it. Setting it by hand omits the
 * boundary, and the server then rejects a body that looks correct — the one axios-to-fetch
 * migration trap that produces a confusing error rather than an obvious one.
 *
 * WHAT THIS TALKS TO. `apps/api`, which is the **v1** application: MongoDB, its own JWT, its own
 * PDF extractor. It is not `services/document-worker` and it does not produce PaperIR. Nothing here
 * returns a document the reader can open; `lib/fixtures.ts` is that path today. Keeping the two
 * clearly separated is the point of this file being small.
 */

import type { AskMode, Highlight } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

function getToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem('token');
}

/**
 * The 401 response interceptor, kept.
 *
 * An expired token otherwise leaves every panel in a permanent loading state with no explanation,
 * because each caller handles its own rejection and none of them can tell "your session ended" from
 * "the server is down". Clearing the token first matters: navigating with it still in storage lands
 * on `/login`, which reads it, believes it, and bounces straight back.
 */
function onUnauthorized(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('token');
  window.location.href = '/login';
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  /** A plain value is JSON-encoded; `FormData` is passed through untouched. See the header. */
  readonly body?: unknown;
}

export async function apiFetch<T>(endpoint: string, options: ApiRequestInit = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const token = getToken();
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...rest,
    ...(body === undefined
      ? {}
      : { body: isForm ? (body as FormData) : JSON.stringify(body) }),
    headers: {
      // Never for FormData: the browser must supply the boundary with it.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...headers,
    },
  });

  if (response.status === 401) {
    onUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((parsed: { detail?: string }) => parsed.detail)
      .catch(() => undefined);
    throw new Error(detail ?? `${String(response.status)} ${response.statusText}`);
  }

  // 204 and an empty body are legitimate — `delete` and `save` both return one.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

/** A URL the browser fetches itself (an `<img>`, an `<iframe>`), so the token rides in the query. */
function withToken(path: string, params: URLSearchParams = new URLSearchParams()): string {
  params.set('token', getToken() ?? '');
  return `${API_URL}${path}?${params.toString()}`;
}

/* ─────────────────────────────────────────── auth ─────────────────────────────────────────── */

export const authApi = {
  register: (email: string, password: string) =>
    apiFetch<{ access_token: string }>('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) =>
    apiFetch<{ access_token: string }>('/auth/login', { method: 'POST', body: { email, password } }),
  getMe: () => apiFetch<{ id: string; email: string; created_at: string }>('/auth/me'),
};

/* ────────────────────────────────────────── papers ────────────────────────────────────────── */

export const papersApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch<{ id: string }>('/papers/upload', { method: 'POST', body: form });
  },
  list: () => apiFetch<unknown[]>('/papers'),
  get: (paperId: string) => apiFetch<unknown>(`/papers/${paperId}`),
  delete: (paperId: string) => apiFetch<void>(`/papers/${paperId}`, { method: 'DELETE' }),

  getFileUrl: (paperId: string) => withToken(`/papers/${paperId}/file`),

  getPageImageUrl: (
    paperId: string,
    page: number,
    region?: { x0: number; y0: number; x1: number; y1: number },
    scale = 2,
  ) => {
    const params = new URLSearchParams({ scale: String(scale) });
    if (region !== undefined) {
      params.set('x0', String(region.x0));
      params.set('y0', String(region.y0));
      params.set('x1', String(region.x1));
      params.set('y1', String(region.y1));
    }
    return withToken(`/papers/${paperId}/page/${String(page)}/image`, params);
  },

  generateBook: (paperId: string, force = false, generateAll = false) =>
    apiFetch<unknown>(`/papers/${paperId}/generate-book`, {
      method: 'POST',
      body: { force_regenerate: force, generate_all: generateAll },
    }),

  generatePages: (paperId: string, pages: number[]) =>
    apiFetch<unknown>(`/papers/${paperId}/generate-pages`, { method: 'POST', body: { pages } }),
};

/* ─────────────────────────────────────── explanations ─────────────────────────────────────── */

export const explanationsApi = {
  list: (paperId: string) => apiFetch<unknown[]>(`/explanations/papers/${paperId}`),

  create: (
    paperId: string,
    data: {
      highlight_id: string;
      question: string;
      parent_id?: string;
      ask_mode?: AskMode;
      auto_add_to_canvas?: boolean;
    },
  ) =>
    apiFetch<unknown>(`/explanations/papers/${paperId}`, {
      method: 'POST',
      body: {
        ...data,
        ask_mode: data.ask_mode ?? 'explain_simply',
        auto_add_to_canvas: data.auto_add_to_canvas ?? true,
      },
    }),

  update: (explanationId: string, data: { is_pinned?: boolean; is_resolved?: boolean }) =>
    apiFetch<unknown>(`/explanations/${explanationId}`, { method: 'PATCH', body: data }),

  summarize: (explanationId: string) =>
    apiFetch<unknown>('/explanations/summarize', {
      method: 'POST',
      body: { explanation_id: explanationId },
    }),
};

/* ──────────────────────────────────────── highlights ──────────────────────────────────────── */

export const highlightsApi = {
  list: (paperId: string) => apiFetch<Highlight[]>(`/highlights/papers/${paperId}`),
  create: (paperId: string, input: unknown) =>
    apiFetch<Highlight>(`/highlights/papers/${paperId}`, { method: 'POST', body: input }),
  delete: (highlightId: string) =>
    apiFetch<void>(`/highlights/${highlightId}`, { method: 'DELETE' }),
};
