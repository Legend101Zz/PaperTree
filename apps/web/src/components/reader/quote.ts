/**
 * reader/quote — a highlight's words, as a reader should see them in a list or a card.
 *
 * The stored `TextQuoteSelector.exact` is the paper's text stream verbatim — line breaks and the
 * typesetter's line-end hyphens included ("regression prob-\nlem"). That is right for matching and
 * wrong for reading, so every place the reader SHOWS a quote runs it through `reflow`, the same
 * rule Guided uses (a line-end hyphen before a lower-case letter joins; whitespace collapses).
 */
import { reflow, type Anchor, type TextQuoteSelector } from '@papertree/anchoring';

export function rawQuoteOf(anchor: Anchor): string {
  const quote = anchor.selectors.find((s): s is TextQuoteSelector => s.type === 'TextQuoteSelector');
  return quote?.exact ?? '';
}

/** The words of one or more anchors, joined and reflowed for display. Empty when none has a quote. */
export function displayQuote(anchors: readonly Anchor[]): string {
  return reflow(anchors.map(rawQuoteOf).filter((q) => q.length > 0).join('\n'))
    .replace(/\s+/g, ' ')
    .trim();
}
