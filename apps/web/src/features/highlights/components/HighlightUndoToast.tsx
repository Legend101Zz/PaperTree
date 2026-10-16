'use client';

/**
 * "Highlight deleted" with Undo (#177): the shared `Toast` while `useHighlights` still holds the
 * highlight the reader deleted last. Undo puts it back with the same id and Anchors; the toast's
 * end (Dismiss, or its time) lets the highlight go for good.
 */
import { Toast } from '@papertree/ui';

import type { UseHighlights } from '@/components/reader/useHighlights';
import type { ReactNode } from 'react';

/** Props for `HighlightUndoToast`. */
export interface HighlightUndoToastProps {
  readonly highlights: Pick<UseHighlights, 'removed' | 'restore' | 'forgetRemoved'>;
}

/**
 * The Undo toast of a highlight delete, or nothing.
 *
 * @example
 * <HighlightUndoToast highlights={highlights} />
 */
export function HighlightUndoToast({ highlights }: HighlightUndoToastProps): ReactNode {
  const { removed, restore, forgetRemoved } = highlights;
  if (removed === null) return null;
  return (
    <Toast
      // A second delete is a new toast with its own time, not the first one's remainder.
      key={removed.highlightId}
      message="Highlight deleted"
      onUndo={() => void restore()}
      onDismiss={forgetRemoved}
    />
  );
}
