/**
 * Where the notebook's links go (S5c, #208). "Show in paper" leaves the page for the reader, which
 * cannot be handed an Anchor through a URL; it is handed the page and the ITEM that stores the
 * Anchor (`?nb=<page>&item=<item>`), reads that item back, and flashes its stored Anchor
 * (`hooks/useFocusFromNotebook`). Pure.
 */
import { blockIdOf } from './exchange';

import type { Item } from './page';
import type { ExchangeBody } from './wire';
import type { Anchor } from '@papertree/anchoring';

/**
 * The reader's URL, optionally aimed at a notebook item's passage.
 *
 * @param paperId - The paper.
 * @param at - The page and the item whose stored Anchor the reader should flash.
 * @returns A path such as `/paper/ppr_1/read?nb=np_1&item=ni_2`.
 */
export function readerHref(paperId: string, at?: { pageId: string; itemId: string }): string {
  const base = `/paper/${encodeURIComponent(paperId)}/read`;
  if (at === undefined) return base;
  return `${base}?${new URLSearchParams({ nb: at.pageId, item: at.itemId }).toString()}`;
}

/**
 * The notebook page's URL.
 *
 * @param paperId - The paper.
 * @param pageId - The page.
 * @returns `/paper/<id>/notebook/<page>`.
 */
export function notebookHref(paperId: string, pageId: string): string {
  return `/paper/${encodeURIComponent(paperId)}/notebook/${encodeURIComponent(pageId)}`;
}

/**
 * The item on the page that stores `anchor`: a quote card holding that very Anchor, else the quote
 * card on the same block (by S4a's passage key that is the same passage, so the same number), else
 * the exchange whose question started on it.
 *
 * @param items - The page's items.
 * @param exchanges - Exchange item id → its stored body.
 * @param anchor - The Anchor to show in the paper.
 * @returns The item id, or null when nothing on the page stores it.
 */
export function itemForAnchor(
  items: readonly Item[],
  exchanges: ReadonlyMap<string, ExchangeBody | null>,
  anchor: Anchor,
): string | null {
  const block = blockIdOf(anchor);
  const quotes = items.flatMap((i) => (i.kind === 'quote' ? [i] : []));
  const same =
    quotes.find((q) => q.anchor.id === anchor.id) ??
    quotes.find((q) => block !== null && blockIdOf(q.anchor) === block);
  if (same !== undefined) return same.id;
  for (const [id, body] of exchanges) if (body?.call.originAnchor?.id === anchor.id) return id;
  return null;
}

/**
 * The paper's board.
 *
 * @param paperId - The paper.
 * @returns `/paper/<id>/board` (#214; the v0.1 `/canvas` route redirects there).
 */
export function boardHref(paperId: string): string {
  return `/paper/${encodeURIComponent(paperId)}/board`;
}
