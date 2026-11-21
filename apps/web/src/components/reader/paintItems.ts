/**
 * reader/paintItems — every highlight anchor's Source paint, or its absence (out of `SourcePane`).
 * The unanchored tray lists exactly the absences, so nothing falls between the two.
 */
import {
  sourcePaint,
  type Anchor,
  type IndexedDocument,
  type Resolution,
} from '@papertree/anchoring';

import { isImageAnchor } from '@/lib/imageAnchor';

import { displayQuote } from './quote';

import type { PaintItem } from './HighlightOverlay';
import type { ReaderHighlight } from './useHighlights';

function quoteOf(anchor: Anchor): string {
  return displayQuote([anchor]) || (isImageAnchor(anchor) ? 'picture' : 'highlight');
}

/** Every anchor's Source paint, or its absence. The tray lists exactly the absences. */
export function paintItemsOf(
  doc: IndexedDocument | null,
  highlights: readonly ReaderHighlight[],
): {
  readonly items: PaintItem[];
  readonly unplaced: { anchor: Anchor; resolution: Resolution; highlightId: string }[];
} {
  const items: PaintItem[] = [];
  const unplaced: { anchor: Anchor; resolution: Resolution; highlightId: string }[] = [];
  if (doc === null) return { items, unplaced };
  for (const highlight of highlights) {
    for (const { anchor, resolution } of highlight.anchors) {
      const paint = sourcePaint(anchor, doc, resolution);
      if (paint === null) {
        unplaced.push({ anchor, resolution, highlightId: highlight.highlightId });
        continue;
      }
      items.push({
        key: anchor.id,
        highlightId: highlight.highlightId,
        color: highlight.color,
        pageIndex: paint.pageIndex,
        polygons: paint.polygons,
        quads: paint.quads,
        approximate: paint.approximate,
        label: quoteOf(anchor),
        saving: highlight.status === 'saving' || highlight.status === 'unsaved',
      });
    }
  }
  return { items, unplaced };
}
