/**
 * lib/api/highlights — contracts.md §2.4. Owned by S4 after S0.
 *
 * Thin typed wrappers. Until S4 lands the release routes, the server still has the 0001-shaped
 * highlight routes on these paths, so nothing calls this module in S0.
 */
import { request } from './client';
import type { Anchor, AnchorFailureReason, Highlight, HighlightColor, ResolutionWire } from './types';

const seg = encodeURIComponent;

/** A resolution computed by the reader, sent with a create (`anchor_id` names which anchor). */
export interface ResolutionIn {
  readonly anchor_id: string;
  readonly generation: number;
  readonly tier: ResolutionWire['tier'];
  readonly state: ResolutionWire['state'];
  readonly block_ids: readonly string[];
  readonly score: number | null;
  readonly reason?: AnchorFailureReason | null;
  readonly resolver_version: string;
}

export interface CreateHighlightBody {
  /** Client-minted (`hl_` + 26 Crockford chars, or a UUID): a repeat create is idempotent. */
  readonly highlight_id: string;
  readonly color: HighlightColor;
  readonly note?: string | null;
  /** 1..64; the ordinal is the index. */
  readonly anchors: readonly { readonly anchor: Anchor }[];
  readonly resolutions?: readonly ResolutionIn[];
}

export interface UpdateHighlightBody {
  readonly color?: HighlightColor;
  readonly note?: string | null;
}

export interface ResolutionItem {
  readonly anchor_id: string;
  readonly tier: ResolutionWire['tier'];
  readonly state: ResolutionWire['state'];
  readonly block_ids: readonly string[];
  readonly score: number | null;
  readonly reason?: AnchorFailureReason | null;
  readonly resolver_version: string;
  /** Only for a `legacy-0001` anchor, which the reader upgrades on first open (ADR-002 §6.3). */
  readonly upgraded_anchor?: Anchor;
}

export interface PutResolutionsBody {
  readonly generation: number;
  /** ≤ 500 */
  readonly items: readonly ResolutionItem[];
}

export const highlightsApi = {
  /** Every highlight, orphans and legacy rows included. `gen` defaults to the promoted one. */
  list: (paperId: string, gen?: number) =>
    request<Highlight[]>(
      `/papers/${seg(paperId)}/highlights${gen === undefined ? '' : `?gen=${String(gen)}`}`,
    ),
  /** 201 on a new id; 200 when the same id and body already exist. */
  create: (paperId: string, body: CreateHighlightBody) =>
    request<Highlight>(`/papers/${seg(paperId)}/highlights`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (paperId: string, highlightId: string, body: UpdateHighlightBody) =>
    request<Highlight>(`/papers/${seg(paperId)}/highlights/${seg(highlightId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (paperId: string, highlightId: string) =>
    request<void>(`/papers/${seg(paperId)}/highlights/${seg(highlightId)}`, { method: 'DELETE' }),
  /** 204. The T0 cache for one generation; also carries legacy-anchor upgrades. */
  putResolutions: (paperId: string, body: PutResolutionsBody) =>
    request<void>(`/papers/${seg(paperId)}/highlights/resolutions`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
