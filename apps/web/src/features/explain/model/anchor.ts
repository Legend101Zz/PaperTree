/**
 * Reading the explain feature's Anchors (#202): one typed selector lookup and the paper's words
 * as a reader should see them. Pure; `exchange.ts`, `answer.ts`, `threads.ts` and the panel use it
 * instead of casting `Anchor` by hand.
 */
import { dehyphenate } from '@/lib/markdown';

import type { Anchor, Selector } from '@papertree/anchoring';

/**
 * An Anchor's selector of one type, typed by that type.
 *
 * @param anchor The Anchor.
 * @param type The selector's `type`, e.g. `PageSelector`.
 * @returns The first selector of that type, or undefined.
 * @example
 * selectorOf(anchor, 'PageSelector')?.index; // 0 for page 1
 */
export function selectorOf<T extends Selector['type']>(
  anchor: Anchor,
  type: T,
): Extract<Selector, { type: T }> | undefined {
  return (anchor.selectors ?? []).find((s): s is Extract<Selector, { type: T }> => s.type === type);
}

/**
 * The paper's words for display: a typesetter's line-end hyphen joined, whitespace collapsed.
 * Display only; the stored quote is never changed.
 *
 * @param text Words from a TextQuoteSelector or a selection.
 * @returns One clean line.
 */
export function cleanQuote(text: string): string {
  return dehyphenate(text).replace(/\s+/g, ' ').trim();
}

/**
 * The words an Anchor quotes, cleaned for display.
 *
 * @param anchor The Anchor.
 * @returns Its TextQuoteSelector's words, or "" when it has none.
 */
export function quoteOf(anchor: Anchor): string {
  const exact = selectorOf(anchor, 'TextQuoteSelector')?.exact;
  return exact === undefined ? '' : cleanQuote(exact);
}
