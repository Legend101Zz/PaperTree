'use client';

/**
 * reader/SplitView — F2.6. Source beside Guided, LINKED BY BLOCK, never by page or scroll ratio.
 *
 * §18.3: "linking is by block, never by page or scroll ratio." The two panes have unrelated heights
 * (a two-column PDF at some zoom beside one reflowed column), so the only quantity both agree on is
 * the block id.
 *
 * THIS COMPONENT IS NOW ONLY THE LAYOUT (S4). The linking it used to do — an IntersectionObserver
 * over every `[data-block-id]` in both panes, and `offsetTop` sums to move a container — observed
 * thousands of text-layer spans, and scrolled the Source pane's WRAPPER, which does not scroll
 * (the page list inside it does), so Guided → Source never moved the PDF. The workspace now links
 * the panes through the one thing that knows where the reader is: the reading position
 * (`{page, yPt}` → the topmost block, `ReaderWorkspace`), driving Guided with `followBlockId`, and
 * Guided's reader-initiated scrolls driving Source through the document handle.
 *
 * Below 768 px the panes stack (Source above, the reading below) instead of splitting 390 px in two.
 */

import type { ReactNode } from 'react';

export type SplitPane = 'source' | 'guided';

export interface SplitViewProps {
  readonly source: ReactNode;
  readonly guided: ReactNode;
  readonly className?: string;
}

export function SplitView({ source, guided, className }: SplitViewProps) {
  return (
    <div
      className={`flex h-full min-h-0 w-full flex-col md:flex-row ${className ?? ''}`}
      data-split-root="true"
    >
      <div
        data-split-pane="source"
        aria-label="Source"
        role="region"
        className="min-h-0 min-w-0 flex-1 border-b border-[--pt-rule] md:border-b-0 md:border-r"
      >
        {source}
      </div>
      <div
        data-split-pane="guided"
        aria-label="Guided"
        role="region"
        className="min-h-0 min-w-0 flex-1"
      >
        {guided}
      </div>
    </div>
  );
}
