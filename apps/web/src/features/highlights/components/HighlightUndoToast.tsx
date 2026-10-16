'use client';

/**
 * "Highlight deleted" with Undo (#177): the shared `Toast` while `useHighlights` still holds the
 * highlight the reader deleted last. Undo puts it back with the same id and Anchors; the toast's
 * end (Dismiss, or its time) lets the highlight go for good. Focus moves to Undo when it appears
 * (the card that held Delete is gone), which also holds the toast until the reader acts or leaves
 * it; when it goes, focus returns to where it was, else to the paper's pages. It sits clear of the
 * explain sheet on a phone (`bottomInset`) and of the drawer on a wide screen (CSS, #204 review).
 */
import { Toast } from '@papertree/ui';
import { useLayoutEffect, useRef, useState } from 'react';

import type { UseHighlights } from '@/components/reader/useHighlights';
import type { ReactNode } from 'react';

/** Props for `HighlightUndoToast`. */
export interface HighlightUndoToastProps {
  readonly highlights: Pick<UseHighlights, 'removed' | 'restore' | 'forgetRemoved'>;
}

/** How much of the window's bottom the explain sheet covers (0 when it is not open). */
function sheetInset(): number {
  const sheet = document.querySelector('.pt-explain-sheet');
  if (sheet === null) return 0;
  return Math.max(0, window.innerHeight - sheet.getBoundingClientRect().top);
}

function UndoToast({ highlights }: HighlightUndoToastProps): ReactNode {
  const { restore, forgetRemoved } = highlights;
  const holder = useRef<HTMLDivElement | null>(null);
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    setInset(sheetInset());
    const before = document.activeElement;
    const box = holder.current;
    box?.querySelector('button')?.focus({ preventScroll: true });
    return () => {
      if (box === null || !box.contains(document.activeElement)) return;
      const back =
        before instanceof HTMLElement && before !== document.body && before.isConnected
          ? before
          : document.querySelector<HTMLElement>('[data-papertree-scroller]');
      back?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div ref={holder} className="pt-notice-holder">
      <Toast
        className="pt-notice--undo"
        message="Highlight deleted"
        bottomInset={inset}
        onUndo={() => void restore()}
        onDismiss={forgetRemoved}
      />
    </div>
  );
}

/**
 * The Undo toast of a highlight delete, or nothing.
 *
 * @example
 * <HighlightUndoToast highlights={highlights} />
 */
export function HighlightUndoToast({ highlights }: HighlightUndoToastProps): ReactNode {
  const { removed } = highlights;
  if (removed === null) return null;
  // A second delete is a new toast with its own time, not the first one's remainder.
  return <UndoToast key={removed.highlightId} highlights={highlights} />;
}
