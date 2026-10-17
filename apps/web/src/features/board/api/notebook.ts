/**
 * board/api/notebook — the one notebook read the board makes: a page's title and item boxes, so a
 * notebook card can draw its miniature (frame 06). `GET /notebook/pages/{pid}` is S5a's route
 * (contracts/api/notebooks.schema.json); the board reads only the fields it draws.
 */
import { request } from '@/lib/api/client';

/** One item of a notebook page, as much of it as a miniature needs (page units, 960 wide). */
export interface NotebookItemBox {
  readonly item_id: string;
  readonly kind: 'exchange' | 'text' | 'sticky' | 'quote' | 'shape';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly z: number;
}

/** A notebook page as the board reads it. */
export interface NotebookPageRead {
  readonly page: { readonly page_id: string; readonly title: string };
  readonly items: readonly NotebookItemBox[];
}

/** The board's notebook reads. */
export const notebookPagesApi = {
  /**
   * One page with its items. A page that is not the caller's is a 404.
   *
   * @param pageId The page a notebook card shows.
   * @returns The page and its items.
   */
  get: (pageId: string): Promise<NotebookPageRead> =>
    request<NotebookPageRead>(`/notebook/pages/${encodeURIComponent(pageId)}`),
};
