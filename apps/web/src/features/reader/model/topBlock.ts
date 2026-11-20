import { guidedProjectionFor, type IndexedDocument } from '@papertree/anchoring';

import type { ReadingPosition } from '@/components/reader/VirtualPageList';
import type { SavedReaderState } from './savedState';

/**
 * The first block in reading order still visible at the top of `position` - the Guided link.
 *
 * Only a block Guided has a card for counts (RFIX2 R8): page furniture (a page number, the arXiv
 * stamp) and a figure's panels are on the page but not in the reading, and a position that named one
 * of them could not be found again in Guided.
 * @param doc The indexed parse, or null while the paper is still being read.
 * @param position The top of the view.
 * @returns The block id, or undefined.
 */
export function topBlockAt(doc: IndexedDocument, position: ReadingPosition): string | undefined {
  const placement = guidedProjectionFor(doc).placement;
  const cards = (pageIndex: number) =>
    (doc.byPage.get(pageIndex) ?? [])
      .filter((block) => block.text.trim().length > 0 && placement.get(block.id)?.kind !== 'absent')
      .sort((a, b) => a.readingIndex - b.readingIndex);

  const here = cards(position.page).filter((block) => block.bbox[3] > position.yPt + 2);
  if (here[0] !== undefined) return here[0].id;

  // Nothing on this page ends below the top of the view: the reader is in the page's bottom margin
  // or in the gap between two pages (RFIX2 must-fix: "no block" opened Guided at the paper's title).
  // The reader is about to read whatever comes next, so the first card of the next page that has
  // one; failing that (the last page) the last card at or before this position.
  const indices = doc.pages.map((page) => page.index).sort((a, b) => a - b);
  for (const index of indices) {
    if (index <= position.page) continue;
    const next = cards(index)[0];
    if (next !== undefined) return next.id;
  }
  for (const index of [...indices].reverse()) {
    if (index > position.page) continue;
    const before = cards(index);
    const last = before[before.length - 1];
    if (last !== undefined) return last.id;
  }
  return undefined;
}

/**
 * The block Guided opens at for the position the reader is at. The saved block when there is one;
 * otherwise the one the page and offset name. A position can lack its block - it was saved before
 * the parse had loaded, or the reader scrolled before it did - and "no block" must not mean "the top
 * of the paper" (RFIX2 R8).
 * @param doc The indexed parse, or null while the paper is still being read.
 * @param at The saved place, or null.
 * @returns The block id, or undefined.
 */
export function initialBlockFor(
  doc: IndexedDocument | null,
  at: SavedReaderState | null,
): string | null {
  if (at === null) return null;
  if (at.blockId !== undefined) return at.blockId;
  return doc === null ? null : (topBlockAt(doc, { page: at.page, yPt: at.yPt }) ?? null);
}
