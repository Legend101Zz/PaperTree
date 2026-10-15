/**
 * canvas/duplicate — "is this passage already on the board?" (W2UI #141).
 *
 * Two excerpts are the same passage when they sit on the same page and show the same words. The
 * words are compared the way a reader sees them (reflowed, whitespace collapsed, case folded);
 * the geometry is not compared, because the same sentence selected twice never gives identical
 * quads. An anchor with no quote or no page never matches anything: no match means "add it".
 */
import type { Anchor } from '@papertree/anchoring';

import { displayQuote } from '@/components/reader/quote';
import type { CanvasNode } from '@/lib/api/types';

export function anchorKey(anchor: Anchor): string | null {
  const quote = displayQuote([anchor]).toLowerCase();
  if (quote === '') return null;
  let page: number | null = null;
  for (const selector of anchor.selectors) {
    if (selector.type === 'PageSelector') {
      page = selector.index;
      break;
    }
    if (selector.type === 'ShapeSelector') page ??= selector.pageIndex;
  }
  return page === null ? null : `${String(page)}|${quote}`;
}

/** The excerpt node already holding this passage, or `null`. */
export function findExcerptFor(nodes: readonly CanvasNode[], anchor: Anchor): CanvasNode | null {
  const key = anchorKey(anchor);
  if (key === null) return null;
  return (
    nodes.find(
      (n) => n.kind === 'excerpt' && n.source_anchor !== null && anchorKey(n.source_anchor as Anchor) === key,
    ) ?? null
  );
}
