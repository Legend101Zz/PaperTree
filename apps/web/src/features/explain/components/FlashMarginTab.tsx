'use client';

/**
 * The margin tab beside a flashed passage (#202, frame 04's left margin): the lit marker, its page
 * tab and "from marker 2 in the answer", right-aligned to the passage's left edge, level with its
 * first line. Drawn in the reader's floating layer for as long as the flash (and its faint
 * outline) lasts. A visual echo of the marker that was pressed, so it is hidden from assistive
 * tech: focus stays on that marker, whose name already says which passage it is.
 */
import { PageTab } from '@papertree/ui';

import type { FlashSource } from '@/components/reader/actions';
import type { ReactNode } from 'react';

/** Props for `FlashMarginTab`. */
export interface FlashMarginTabProps {
  readonly from: FlashSource;
  /** Where the passage starts, in the floating layer's px: its left edge and its top. */
  readonly left: number;
  readonly top: number;
}

/** "2 · p. 2 ¶2 · from marker 2 in the answer", in the page margin beside the passage. */
export function FlashMarginTab({ from, left, top }: FlashMarginTabProps): ReactNode {
  return (
    <div
      className="pt-flash-tab"
      aria-hidden="true"
      data-flash-tab={from.n}
      style={{ right: `calc(100% - ${String(left)}px + 10px)`, top: `${String(top)}px` }}
    >
      <span className="pt-flash-tab__ribbon">
        <span className="pt-marker pt-marker--static is-lit">{from.n}</span>
        <PageTab
          page={from.page}
          para={from.para}
          status={from.notVerified ? 'not-verified' : 'cited'}
          lit
        />
      </span>
      <span className="pt-flash-tab__note">from marker {from.n} in the answer</span>
    </div>
  );
}
