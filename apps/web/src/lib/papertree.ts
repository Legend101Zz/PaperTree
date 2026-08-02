/**
 * The client for `services/api` — v2. Not `lib/api.ts`, which is v1 and talks to `archive/v1-api`.
 *
 * WHY A SECOND CLIENT RATHER THAN AN EDIT TO THE FIRST
 *
 * They talk to different servers with different auth and different shapes, and they will overlap
 * only until the v1 endpoints stop being called. `lib/api.ts`'s own header already says "nothing
 * here returns a document the reader can open"; this is the one that does. Merging them now would
 * produce one file where every method needs a comment saying which server it means — and #60 is
 * open precisely because "the second API client" was allowed to blur once already.
 *
 * WHAT THIS DOES NOT DO: retries, caching, or request de-duplication. `loadDocument` memoises the
 * indexed document, which is the expensive part; a second GET of a 3 MB JSON is not worth a cache
 * layer nobody asked for.
 */
import type { PaperSource } from '@papertree/anchoring';

const BASE = process.env.NEXT_PUBLIC_PAPERTREE_API_URL ?? 'http://localhost:8000';

/** Where the v2 session token lives. Separate from v1's `token`, so signing into one is not the other. */
const TOKEN_KEY = 'papertree.session';

export function getSessionToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function setSessionToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearSessionToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSessionToken();
  const headers = new Headers(init.headers);
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    // The service answers 404 for "not yours" as well as "not there" — deliberately, so a paper id
    // is not an existence oracle. The message here must not pretend to know which it was.
    const detail = await response.text().catch(() => '');
    throw new ApiError(response.status, detail.slice(0, 400) || response.statusText);
  }
  return (await response.json()) as T;
}

// ─── auth ─────────────────────────────────────────────────────────────────────────────────────

export interface SessionResponse {
  readonly token: string;
  readonly user_id: string;
  readonly email: string;
}

export const authApi = {
  register: (email: string, password: string) =>
    request<SessionResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<SessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ user_id: string; email: string }>('/auth/me'),
};

// ─── papers ───────────────────────────────────────────────────────────────────────────────────

export interface UploadResponse {
  readonly paper_id: string;
  readonly job_id: string;
  /** False when these bytes were already uploaded — the service returns the ORIGINAL job. */
  readonly created: boolean;
}

export interface JobStatus {
  readonly job_id: string;
  readonly state: 'pending' | 'running' | 'succeeded' | 'cancelled' | 'dead_letter';
  readonly progress_done: number;
  readonly progress_total: number;
  readonly progress_note: string | null;
  readonly error: string | null;
  readonly is_terminal: boolean;
}

export const papersApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<UploadResponse>('/papers', { method: 'POST', body: form });
  },
  list: () => request<readonly Record<string, unknown>[]>('/papers'),
  ir: (paperId: string) => request<PaperSource & { ir_version?: string }>(`/papers/${paperId}/ir`),
  job: (jobId: string) => request<JobStatus>(`/jobs/${jobId}`),

  /**
   * The original PDF, as bytes rather than as a URL.
   *
   * pdf.js would happily take a URL, and v1's `getFileUrl` put the token in the QUERY STRING to
   * make that work. That is a credential in a URL — it lands in server logs, in `Referer`, and in
   * browser history. `PdfSource` already accepts an `ArrayBuffer`, so fetching with the header and
   * handing over the buffer costs one extra copy of a PDF and removes the whole class of leak.
   */
  file: async (paperId: string): Promise<ArrayBuffer> => {
    const token = getSessionToken();
    const headers = new Headers();
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${BASE}/papers/${paperId}/file`, { headers });
    if (!response.ok) throw new ApiError(response.status, `could not fetch the PDF for ${paperId}`);
    return response.arrayBuffer();
  },
};

export const API_BASE_URL = BASE;
