/**
 * notebook/api — the typed client over S5a's routes (`routers/notebooks.py`, #206) and the
 * react-query keys that scope its caches by paper and page. Transport, auth and the error envelope
 * are `lib/api/client`'s; this file only says where each call goes and what comes back.
 */
import { request } from '@/lib/api/client';
import { ApiError } from '@/lib/api/types';

import type { PageTemplate } from '../model/page';
import type { Anchor } from '@papertree/anchoring';

const seg = encodeURIComponent;

/** What a notebook item is; `exchange` and `shape` carry a JSON object in `body`. */
export type NotebookItemKind = 'exchange' | 'text' | 'sticky' | 'quote' | 'shape';

/** A page as the API sends it. */
export interface NotebookPageWire {
  readonly page_id: string;
  readonly paper_id: string;
  readonly title: string;
  readonly template: PageTemplate;
  readonly source_thread_id: string | null;
  readonly source_message_id: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** An item as the API sends it: a rectangle in page units, a body and, for a quote, its Anchor. */
export interface NotebookItemWire {
  readonly item_id: string;
  readonly page_id: string;
  readonly kind: NotebookItemKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly z: number;
  readonly body: string;
  readonly anchor: Anchor | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** An ink stroke; `points_b64` is `encodeStroke`'s blob in base64. */
export interface NotebookStrokeWire {
  readonly stroke_id: string;
  readonly page_id: string;
  readonly tool: 'pen' | 'highlighter';
  readonly nib: 'EF' | 'F' | 'M';
  readonly colour: string;
  readonly points_b64: string;
  readonly created_at: string;
}

/** `GET /notebook/pages/{id}`. */
export interface NotebookPageView {
  readonly page: NotebookPageWire;
  readonly items: readonly NotebookItemWire[];
  readonly strokes: readonly NotebookStrokeWire[];
}

/** What a page holds, counted by the server on read. */
export interface NotebookCounts {
  readonly quotes: number;
  readonly stickies: number;
  readonly text: number;
  readonly shapes: number;
  readonly strokes: number;
}

/** One row of `GET /papers/{id}/notebook/pages`. */
export interface NotebookPageSummary {
  readonly page_id: string;
  readonly title: string;
  readonly template: PageTemplate;
  readonly counts: NotebookCounts;
  readonly version: number;
  readonly updated_at: string;
}

/** `POST /papers/{id}/notebook/pages`; `from_message_id` is "Dive in". */
export interface CreatePageBody {
  readonly page_id: string;
  readonly title?: string;
  readonly template?: PageTemplate;
  readonly from_message_id?: string;
}

/** `POST /notebook/pages/{id}/items`. A quote must carry its Anchor. */
export interface CreateItemBody {
  readonly item_id: string;
  readonly kind: NotebookItemKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly z?: number;
  readonly body?: string;
  readonly anchor?: Anchor;
}

/** `PATCH /notebook/pages/{id}/items/{iid}`: `version` is the one last seen (409 if stale). */
export interface PatchItemBody {
  readonly version: number;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly z?: number;
  readonly body?: string;
}

/** The S5a routes, one function each. */
export const notebookApi = {
  listPages: (paperId: string) =>
    request<NotebookPageSummary[]>(`/papers/${seg(paperId)}/notebook/pages`),
  createPage: (paperId: string, body: CreatePageBody) =>
    request<{ page: NotebookPageWire; items: NotebookItemWire[] }>(
      `/papers/${seg(paperId)}/notebook/pages`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  getPage: (pageId: string) => request<NotebookPageView>(`/notebook/pages/${seg(pageId)}`),
  createItem: (pageId: string, body: CreateItemBody) =>
    request<NotebookItemWire>(`/notebook/pages/${seg(pageId)}/items`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchItem: (pageId: string, itemId: string, body: PatchItemBody) =>
    request<NotebookItemWire>(`/notebook/pages/${seg(pageId)}/items/${seg(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteItem: (pageId: string, itemId: string) =>
    request<void>(`/notebook/pages/${seg(pageId)}/items/${seg(itemId)}`, { method: 'DELETE' }),
};

/**
 * The react-query keys. Everything sits under `['notebook', paperId]`, so invalidating a paper
 * refreshes its page list and every page of it, and two papers never share an entry.
 */
export const notebookKeys = {
  paper: (paperId: string) => ['notebook', paperId] as const,
  pages: (paperId: string) => ['notebook', paperId, 'pages'] as const,
  page: (paperId: string, pageId: string) => ['notebook', paperId, 'page', pageId] as const,
};

/**
 * True for the server's "this changed somewhere else" answer (409 `stale_version`). The caller must
 * stop and say so; retrying with the newer version would overwrite the other edit silently.
 *
 * @param error - Whatever a notebook call threw.
 * @returns Whether it is a stale-version conflict.
 */
export function isStaleVersion(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'stale_version';
}

/**
 * A client-minted id in the API's shape (`^[a-z]{2,4}_[0-9A-Za-z-]{8,64}$`): a retried create
 * carries the same id, so the server returns what it already stored.
 *
 * @param prefix - Two to four lowercase letters, e.g. `ni` for an item.
 * @returns The id.
 */
export function newClientId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}
