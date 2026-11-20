import { useMemo } from 'react';

import { displayQuote } from '@/components/reader/quote';
import { paintItemsOf } from '@/components/reader/paintItems';

import type { IndexedDocument } from '@papertree/anchoring';
import type { NavigatorHighlight } from '@/components/reader/Navigator';
import type { ReaderHighlight } from '@/components/reader/useHighlights';

function quoteOfHighlight(highlight: ReaderHighlight): string {
  return displayQuote(highlight.anchors.map((a) => a.anchor));
}

/**
 * What the page paints, what it paints nowhere (the tray's), and the Contents panel's row for each
 * highlight. One hook because the panel's state is derived from the paint, not from the highlight.
 * @param doc The indexed parse, or null while the paper is still being read.
 * @param highlights The highlights controller.
 * @returns The paint items, the unplaced ones and the Contents rows.
 */
export function useNavigatorHighlights(
  doc: IndexedDocument | null,
  highlights: readonly ReaderHighlight[],
) {
  const { items: painted, unplaced } = useMemo(
    () => paintItemsOf(doc, highlights),
    [doc, highlights],
  );

  /**
   * The Navigator says what the PAGE shows: "approximate" only when a highlight's paint is (a
   * ladder answer without stored quads), never because the ladder's LINK is approximate while the
   * stored quads paint it exactly — a figure label captured from pdf.js is linked by geometry (T4)
   * and painted to the glyph.
   */
  const navigatorHighlights = useMemo<NavigatorHighlight[]>(() => {
    const unplacedAnchors = new Set(unplaced.map((u) => u.anchor.id));
    return highlights.map((highlight) => {
      const first = highlight.anchors[0];
      const paints = painted.filter((item) => item.highlightId === highlight.highlightId);
      const pageIndex =
        first === undefined
          ? null
          : ((
              first.anchor.selectors.find((s) => s.type === 'PageSelector') as
                { index?: number } | undefined
            )?.index ?? first.resolution.pageIndex);
      const nowhere =
        highlight.anchors.length > 0 &&
        highlight.anchors.every((a) => unplacedAnchors.has(a.anchor.id));
      return {
        id: highlight.highlightId,
        blockIds: highlight.anchors.flatMap((a) => a.resolution.blockIds),
        quote: quoteOfHighlight(highlight) || 'Highlight',
        state: nowhere ? 'orphan' : paints.some((p) => p.approximate) ? 'approximate' : 'anchored',
        pageIndex: pageIndex ?? null,
        colour: highlight.color,
        note: highlight.note,
        status: highlight.status,
        unplaced: nowhere,
      };
    });
  }, [highlights, painted, unplaced]);

  return { painted, unplaced, navigatorHighlights };
}
