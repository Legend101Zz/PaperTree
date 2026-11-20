import { useFocusFromCanvas } from '@/components/canvas/useFocusFromCanvas';
import { useFocusFromBook, usePageFromBook } from '@/features/book';
import { useFocusFromNotebook } from '@/features/notebook/hooks/useFocusFromNotebook';

import type { FocusOptions } from '@/components/reader/actions';
import type { Anchor } from '@papertree/anchoring';
import type { PaperRef } from '@/lib/paperSource';

/**
 * The places that land in the reader with a passage or a page in the URL, each wired to the same
 * two actions. One hook so the workspace does not list four feature hooks; each waits for the parse.
 * @param paper The paper, referentially stable.
 * @param parsed True once the parse is in.
 * @param focusAnchor Resolve, scroll to and flash an anchor.
 * @param jumpToPage Scroll to a 0-based page.
 */
export function useFocusFromUrl(
  paper: PaperRef,
  parsed: boolean,
  focusAnchor: (anchor: Anchor, opts?: FocusOptions) => void,
  jumpToPage: (pageIndex: number) => void,
): void {
  const paperId = paper.kind === 'api' ? paper.paperId : null;
  // S7: the canvas's "Open source" lands here as `?focus=<node_id>`.
  useFocusFromCanvas(paperId, parsed, focusAnchor);
  // S5c: the notebook's "Open source" lands here as `?nb=<page>&item=<item>`.
  useFocusFromNotebook(paperId, parsed, focusAnchor);
  // The opened book's "p. 1 · Abstract" tab (#200): flash the abstract once the parse is in.
  useFocusFromBook(paperId, parsed, focusAnchor);
  // The "At a glance" sheet's `p. 3 ›` and "from the start" (v0.3 #337): open at that page.
  usePageFromBook(paperId, parsed, jumpToPage);
}
