/**
 * lib/api/papers — auth, papers, jobs: everything `lib/papertree.ts` did, with the same behaviour,
 * over the shared transport in `client.ts`.
 *
 * `lib/papertree.ts` was deleted in S0 (contracts.md §5) and every importer points here or at
 * `client.ts`. Since S1, `list()` returns `LibraryPaper[]` (S3 retyped it; the pre-S1 row type is
 * gone) and `DELETE /papers/{id}`, `/retry` and `/reparse` are live.
 */
import type { PaperSource } from '@papertree/anchoring';

import {
  apiFetch,
  request,
  uploadWithProgress as uploadWithProgressTransport,
  type UploadOptions,
} from './client';
import type { LibraryPaper } from './types';

const seg = encodeURIComponent;

function json(body: unknown): string {
  return JSON.stringify(body);
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
      body: json({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<SessionResponse>('/auth/login', {
      method: 'POST',
      body: json({ email, password }),
    }),
  /** 204. Contracts §2.1: the web now CALLS it on sign-out (wired by S3). */
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user_id: string; email: string }>('/auth/me'),
};

// ─── papers ───────────────────────────────────────────────────────────────────────────────────

export interface UploadResponse {
  readonly paper_id: string;
  readonly job_id: string;
  /** False when these bytes were already uploaded — the service returns the ORIGINAL job. */
  readonly created: boolean;
  /** The library row for this upload, in the 202 (contracts §2.2). */
  readonly paper: LibraryPaper;
}

/** `GET /jobs/{id}` — the existing shape; contracts §2.2 adds `error_code` (S1). */
export interface JobStatus {
  readonly job_id: string;
  readonly state: 'pending' | 'running' | 'succeeded' | 'cancelled' | 'dead_letter';
  readonly progress_done: number;
  readonly progress_total: number;
  readonly progress_note: string | null;
  readonly error: string | null;
  readonly is_terminal: boolean;
  readonly error_code?: string | null;
}

export const papersApi = {
  /** A plain multipart POST. `uploadWithProgress` is the same request with progress and cancel. */
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<UploadResponse>('/papers', { method: 'POST', body: form });
  },
  uploadWithProgress: (file: File, options: UploadOptions = {}) =>
    uploadWithProgressTransport(file, options),

  /** Every paper this caller owns, newest first (contracts §2.2). */
  list: () => request<readonly LibraryPaper[]>('/papers'),

  /** PaperIR 1.0.0 for the promoted generation, or `gen` when given (§2.2). */
  ir: (paperId: string, gen?: number) =>
    request<PaperSource & { ir_version?: string }>(
      `/papers/${seg(paperId)}/ir${gen === undefined ? '' : `?gen=${String(gen)}`}`,
    ),
  job: (jobId: string) => request<JobStatus>(`/jobs/${seg(jobId)}`),

  /** 204. The DB rows, the upload and the assets go (S1). */
  remove: (paperId: string) => request<void>(`/papers/${seg(paperId)}`, { method: 'DELETE' }),
  /** 202; 409 `not_failed` unless the latest job dead-lettered (S1). */
  retry: (paperId: string) =>
    request<{ job_id: string; generation: number }>(`/papers/${seg(paperId)}/retry`, {
      method: 'POST',
    }),
  /** 202 with the next generation; 409 `busy` while a parse is pending or running (S1). */
  reparse: (paperId: string, reason?: string) =>
    request<{ job_id: string; generation: number }>(`/papers/${seg(paperId)}/reparse`, {
      method: 'POST',
      body: json(reason === undefined ? {} : { reason }),
    }),

  /**
   * The original PDF, as bytes rather than as a URL.
   *
   * pdf.js would happily take a URL, and v1's `getFileUrl` put the token in the QUERY STRING to
   * make that work. That is a credential in a URL — it lands in server logs, in `Referer`, and in
   * browser history. `PdfSource` already accepts an `ArrayBuffer`, so fetching with the header and
   * handing over the buffer costs one extra copy of a PDF and removes the whole class of leak.
   */
  file: async (paperId: string): Promise<ArrayBuffer> => {
    const response = await apiFetch(`/papers/${seg(paperId)}/file`);
    return response.arrayBuffer();
  },
};
