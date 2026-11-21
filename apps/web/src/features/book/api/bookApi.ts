/**
 * book/api — the opened book's routes (`routers/book.py`, #200): the figures the parser found, the
 * cover plate, the abstract; and the react-query keys they cache under. Transport, auth and the
 * error envelope are `lib/api/client`'s. The wire types are held to the exported contract by
 * `test/contracts.spec.ts`.
 */
import { request } from '@/lib/api/client';

import type { BookFigure } from '../model/types';
import type { Anchor } from '@papertree/anchoring';

const seg = encodeURIComponent;

/** One figure as `GET /papers/{id}/figures` sends it. */
export interface PaperFigure {
  readonly block_id: string;
  readonly page_index: number;
  readonly bbox: [number, number, number, number];
  readonly caption_text: string | null;
  readonly caption_block_id: string | null;
  readonly label: string | null;
  readonly asset_url: string | null;
  readonly anchor: Anchor | null;
}

/** `GET /papers/{id}/abstract`: every field null when the parser found no abstract. */
export interface PaperAbstract {
  /** The paper's words, line breaks and line-end hyphens kept (the book joins them). */
  readonly text: string | null;
  readonly page_index: number | null;
  readonly anchor: Anchor | null;
}

/** A block of the sheet (Problem, Idea, How it works, Limits): words and the page they cite. */
export interface GlanceBlock {
  /** At most 30 words; maths as `$…$`. */
  readonly text: string;
  /** The 1-based page of the passage it comes from (`p. 3 ›`), or null when it cites none. */
  readonly page: number | null;
}

/** A large number under Results. */
export interface GlanceNumber {
  readonly value: string;
  readonly measures: string;
}

/** Results: at most two large numbers and a note. */
export interface GlanceResults {
  readonly numbers: readonly GlanceNumber[];
  readonly note: string | null;
  readonly page: number | null;
}

/** One of the five words to know. */
export interface GlanceWord {
  readonly term: string;
  readonly gloss: string;
}

/** `GET /papers/{id}/glance`'s sheet: the AI's map of the paper, every cap already applied. */
export interface Glance {
  readonly gist: string;
  readonly problem: GlanceBlock;
  readonly idea: GlanceBlock;
  readonly how: GlanceBlock;
  readonly results: GlanceResults;
  readonly limits: GlanceBlock;
  /** Names sections; no page mark. */
  readonly read_first: string;
  readonly words: readonly GlanceWord[];
  /** The model that wrote it (`MiniMax-M3.1-Flash`). */
  readonly model: string;
  readonly generation: number;
}

/** `GET /papers/{id}/glance`: `ready` (the sheet), `making` (202: a run is writing it), `none`. */
export interface GlanceStatus {
  readonly state: 'ready' | 'making' | 'none';
  readonly glance: Glance | null;
}

/** `PUT /papers/{id}/plate`. */
export interface PlatePut {
  readonly anchor: Anchor;
}

/**
 * One wire figure in the book's terms.
 *
 * @param wire - A `PaperFigure`.
 * @returns The `BookFigure`.
 */
export function bookFigureFromWire(wire: PaperFigure): BookFigure {
  return {
    blockId: wire.block_id,
    pageIndex: wire.page_index,
    label: wire.label,
    captionText: wire.caption_text,
    assetUrl: wire.asset_url,
    anchor: wire.anchor,
  };
}

/** The cache keys, scoped by paper. */
export const bookKeys = {
  figures: (paperId: string) => ['book', paperId, 'figures'] as const,
  abstract: (paperId: string) => ['book', paperId, 'abstract'] as const,
  summary: (paperId: string) => ['book', paperId, 'summary'] as const,
  glance: (paperId: string) => ['book', paperId, 'glance'] as const,
};

/** The book's calls. */
export const bookApi = {
  /**
   * The figures the parser found, in reading order (409 `not_parsed` until the parse is in).
   *
   * @param paperId - The paper.
   * @returns The figures in the book's terms.
   */
  figures: async (paperId: string): Promise<readonly BookFigure[]> =>
    (await request<PaperFigure[]>(`/papers/${seg(paperId)}/figures`)).map(bookFigureFromWire),
  /**
   * The abstract the parser found, with an Anchor on it.
   *
   * @param paperId - The paper.
   * @returns `PaperAbstract`; every field null when there is none.
   */
  abstract: (paperId: string): Promise<PaperAbstract> =>
    request<PaperAbstract>(`/papers/${seg(paperId)}/abstract`),
  /**
   * The "At a glance" sheet, or the state it is in. 200 `ready` with the sheet, 202 `making` while
   * a run writes it (ask again), 200 `none` when none is coming; the 202 is a success to the
   * transport, so `state` is what says which.
   *
   * @param paperId - The paper.
   * @returns The status.
   */
  glance: (paperId: string): Promise<GlanceStatus> =>
    request<GlanceStatus>(`/papers/${seg(paperId)}/glance`),
  /**
   * Makes a figure the cover (204; 422 when the Anchor names no figure of this paper).
   *
   * @param paperId - The paper.
   * @param anchor - The figure's Anchor, as `figures` gave it.
   * @returns Nothing.
   */
  setPlate: (paperId: string, anchor: Anchor): Promise<void> =>
    request<void>(`/papers/${seg(paperId)}/plate`, {
      method: 'PUT',
      body: JSON.stringify({ anchor } satisfies PlatePut),
    }),
  /**
   * The typographic cover again (204).
   *
   * @param paperId - The paper.
   * @returns Nothing.
   */
  clearPlate: (paperId: string): Promise<void> =>
    request<void>(`/papers/${seg(paperId)}/plate`, { method: 'DELETE' }),
};
