/**
 * lib/api/papers — auth, papers, jobs: everything `lib/papertree.ts` did, with the same behaviour,
 * over the shared transport in `client.ts`.
 *
 * `lib/papertree.ts` was deleted in S0 (contracts.md §5) and every importer points here or at
 * `client.ts`. What did NOT change is deliberate: `list()` still types the rows `GET /papers`
 * returns TODAY (`PaperListRow`), because the server keeps that shape until S1 moves it to
 * `LibraryPaper[]` — typing it as `LibraryPaper` now would be the cast-over-the-gap that hid #77 D4
 * for an epic. S1 changes the route and S3 (which owns this file after S0) retypes the call.
 *
 * The routes S1 adds (`DELETE /papers/{id}`, `/retry`, `/reparse`) have typed wrappers here already;
 * until S1 lands they answer 404/405/501 and the wrappers throw an `ApiError` saying so.
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
  /** Contracts §2.2 adds the library row to the 202. Absent until S1 lands it. */
  readonly paper?: LibraryPaper;
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

/**
 * The `/ask` answer as it comes off the wire — `GroundedAnswer`'s field names, and NOT its types.
 *
 * ONE FIELD DIFFERS AND IT IS THE IMPORTANT ONE. `GroundedAnswer.sourceRegions` is `Citation[]`: a
 * resolved `Anchor` plus its `Resolution`. The server cannot produce one today, so it sends the
 * ADDRESS an anchor is minted from and `liveAnswerSource` mints it on this side. S5 replaces `/ask`
 * with threads, whose citations are server-minted Anchors (#124); S6 deletes this path.
 */
export interface WireSourceRegion {
  readonly blockId: string;
  readonly pageIndex: number;
  readonly bbox: readonly number[];
  /** The server's bucket. Re-derived on this side from the parse the READER is looking at. */
  readonly targetType: string;
  /** e.g. `"p3 · equation"`. Built by the server from the parser's own page and block type. */
  readonly label: string;
}

export interface WireClaim {
  readonly text: string;
  readonly supportedBy: readonly string[];
  readonly supported: boolean;
  readonly reason: string | null;
}

export interface WireAnswer {
  readonly states: string;
  readonly interpretation: string | null;
  readonly supportingBlockIds: readonly string[];
  readonly sourcePages: readonly number[];
  readonly sourceRegions: readonly WireSourceRegion[];
  readonly confidence: number;
  readonly unresolvedAmbiguities: readonly string[];
  readonly claims: readonly WireClaim[];
}

/** What the turn did, for the panel and for a log. Never the prompt, never the datamark. */
export interface AskMeta {
  readonly model: string;
  readonly steps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: readonly { readonly tool: string; readonly status: string }[];
  readonly evidenceBlockIds: readonly string[];
  readonly systemPromptHash: string;
}

export interface AskResponse {
  readonly answer: WireAnswer;
  readonly meta: AskMeta;
}

export interface AskBody {
  readonly question: string;
  /** snake_case: this is the server's field name, not ours. See `ask.py`'s `Ask` model. */
  readonly block_ids: readonly string[];
}

/**
 * One row of `GET /papers`, as the service sends it BEFORE S1 (#77 D4).
 *
 * The id key is `paper_id`, there is no title or page count, and `metadata` arrives as a JSON
 * STRING that `libraryPaperFromPaperRow` parses. S1 replaces the whole row with `LibraryPaper`.
 */
export interface PaperListRow {
  readonly paper_id: string;
  readonly created_at: string;
  readonly status?: string | null;
  readonly partial_reason?: string | null;
  readonly metadata?: string | null;
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

  /** Every paper this caller owns — in the pre-S1 row shape; see the module header. */
  list: () => request<readonly PaperListRow[]>('/papers'),

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
   * One grounded agent turn over the pre-release `/ask` route. NOT streaming; S5 removes the route
   * and S6 removes this call with the Inspector.
   *
   * `signal` is threaded through to `fetch` so the Inspector's abort actually cancels the request
   * rather than only ignoring its result — an ask can cost several model round trips.
   */
  ask: (paperId: string, body: AskBody, signal?: AbortSignal) =>
    request<AskResponse>(`/papers/${seg(paperId)}/ask`, {
      method: 'POST',
      body: json(body),
      ...(signal === undefined ? {} : { signal }),
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
