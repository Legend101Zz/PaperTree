/**
 * DeleteUndoToast: "Deleted “Title”, with your 3 highlights and 2 threads" with Undo, for the 10
 * seconds a deleted paper is only hidden (`usePendingDelete`, v0.3 #337). The clock is the hook's,
 * not the toast's: the shared `Toast` would pause its own countdown while Undo has focus, and a
 * delete that waited on a focused button would never be sent. So the toast is told not to expire
 * (`duration={0}`) and goes when the hook says so.
 *
 * Focus moves to Undo when it appears (the book that held it is gone), so Undo is one Enter away;
 * when the toast leaves with focus inside it, focus goes to the shelf, not to the page. After Undo
 * the hook focuses the returned spine instead.
 */
'use client';

import { Toast } from '@papertree/ui';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { deletedMessage } from '../model/catalogue';

import type { LibraryBook } from '../hooks/useLibrary';

/** Props for `DeleteUndoToast`. */
export interface DeleteUndoToastProps {
  /** The paper whose delete is waiting. */
  readonly book: LibraryBook;
  readonly onUndo: () => void;
  /** "Dismiss": let it go now. */
  readonly onDismiss: () => void;
}

/**
 * The toast of a staged delete.
 *
 * @example
 * <DeleteUndoToast book={undoable} onUndo={undo} onDismiss={dismiss} />
 */
export function DeleteUndoToast({ book, onUndo, onDismiss }: DeleteUndoToastProps): ReactNode {
  const holder = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = holder.current;
    box?.querySelector('button')?.focus({ preventScroll: true });
    return () => {
      if (box === null || !box.contains(document.activeElement)) return;
      document
        .querySelector<HTMLElement>('[role="toolbar"][aria-label="Shelf"] [tabindex="0"]')
        ?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div ref={holder} className="pt-notice-holder">
      <Toast message={deletedMessage(book)} duration={0} onUndo={onUndo} onDismiss={onDismiss} />
    </div>
  );
}
