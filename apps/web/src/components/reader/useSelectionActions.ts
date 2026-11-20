'use client';

/**
 * reader/useSelectionActions — what the selection menu's items DO, and the two keys that act on a
 * selection without the menu (out of `SourcePane`).
 *
 *   Explain         opens the panel on the passage and asks the default question.
 *   Ask…            opens the panel on the passage with the question box ready.
 *   Send to board   Board beside: sends the card and opens the board next to the paper, on the new
 *                   card (the split view, #344). Just send: stays reading; toasts "Added · Show".
 *   Note            makes a highlight (a highlight already carries a note) and opens its card on the
 *                   note field. No AI call, no board card.
 *   a colour        keeps the highlight, as it always did.
 *
 * KEYS. Enter on a fresh selection is Explain; Escape clears the selection and with it the menu, one
 * level. Enter is left alone when focus is on something that handles it itself (the menu's own
 * buttons, a highlight, a field, a link), so a keyboard reader's Enter on "Ask…" asks, not explains.
 */

import { useCallback, useEffect, useMemo } from 'react';

import { holdScroll } from './scrollHold';
import { useReaderActions } from './actions';

import type { SelectionActions, SendToBoardHow } from './SelectionItems';
import type { SelectionCapture, PendingSelection } from './useSelectionCapture';
import type { HighlightColor } from '@/lib/api/types';

/** Where a card opens from, client px: the selection's own box. */
export interface NoteAt {
  readonly clientX: number;
  readonly clientY: number;
  readonly top: number;
  readonly bottom: number;
}

export interface UseSelectionActionsArgs {
  readonly selection: PendingSelection | null;
  readonly capture: (kind?: 'text') => SelectionCapture | null;
  readonly clear: () => void;
  /** The scroller, for `holdScroll`. */
  readonly root: HTMLElement | null;
  readonly onCreateHighlight: (captured: SelectionCapture, color?: HighlightColor) => void;
  /** Note: drawn only when given. */
  readonly onCreateNote?: (captured: SelectionCapture, at: NoteAt | null) => void;
  /**
   * Board beside: open the board on the card just sent (`cardId`; null when the send made none).
   * Without it the choice is not offered.
   */
  readonly onOpenBoard?: (cardId: string | null) => void;
  readonly onNotice?: (message: string) => void;
  readonly highlightDisabledReason?: string | undefined;
}

/** Things that take Enter for themselves. */
const TAKES_ENTER =
  'button, a[href], input, textarea, select, [role="button"], [role="toolbar"], [contenteditable]';

/** The selection's box in client px, for a card to open beside it. */
function selectionBox(): NoteAt | null {
  const picked = typeof window === 'undefined' ? null : window.getSelection();
  if (picked === null || picked.rangeCount === 0) return null;
  const box = picked.getRangeAt(0).getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return {
    clientX: (box.left + box.right) / 2,
    clientY: box.top,
    top: box.top,
    bottom: box.bottom,
  };
}

/**
 * The menu's actions, and the Enter and Escape keys.
 *
 * @param args - The selection, the capture, and what the reader shell provides.
 * @returns The actions for `useSelectionToolbar`.
 */
export function useSelectionActions(args: UseSelectionActionsArgs): SelectionActions {
  const { selection, capture, clear, root, onCreateHighlight, onCreateNote, onOpenBoard } = args;
  const { onNotice, highlightDisabledReason } = args;
  const actions = useReaderActions();
  const hasSelection = selection !== null;

  // A toolbar action must not move the page (RFIX2 R2): the hold puts back any scroll the reader
  // did not ask for in the moments after it.
  const onHighlight = useCallback(
    (color: HighlightColor) => {
      const captured = capture('text');
      if (captured === null) return;
      holdScroll(root);
      onCreateHighlight(captured, color);
      clear();
    },
    [capture, clear, onCreateHighlight, root],
  );

  // Explain runs now; Ask opens the panel on the passage for the reader's own question. No scroll
  // hold for either: the explain panel opens beside the paper and the page list repositions it.
  const onExplain = useCallback(() => {
    const captured = capture('text');
    if (captured === null) return;
    actions.openExplain({ anchor: captured.anchor, quote: captured.selection.text });
    clear();
  }, [actions, capture, clear]);

  const askAbout = actions.askAbout;
  const onAsk = useCallback(() => {
    const captured = capture('text');
    if (captured === null) return;
    askAbout?.({ anchor: captured.anchor, quote: captured.selection.text });
    clear();
  }, [askAbout, capture, clear]);

  const onSendToBoard = useCallback(
    (how: SendToBoardHow) => {
      const captured = capture('text');
      if (captured === null) return;
      holdScroll(root);
      clear();
      const beside = how === 'beside' && onOpenBoard !== undefined;
      actions
        .sendToCanvas({
          kind: 'excerpt',
          anchor: captured.anchor,
          toast: beside ? 'none' : 'added',
        })
        .then((cardId) => {
          if (beside) onOpenBoard(cardId ?? null);
        })
        .catch(() => {
          onNotice?.("Couldn't send this passage to the board. Try again.");
        });
    },
    [actions, capture, clear, onNotice, onOpenBoard, root],
  );

  const onNote = useMemo(
    () =>
      onCreateNote === undefined
        ? undefined
        : () => {
            const at = selectionBox();
            const captured = capture('text');
            if (captured === null) return;
            onCreateNote(captured, at);
            clear();
          },
    [capture, clear, onCreateNote],
  );

  // Escape drops the selection and, with it, the menu (RFIX). Enter on a fresh selection explains.
  useEffect(() => {
    if (!hasSelection) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        // One level per press: the selection is this press's, so the board beside keeps its own.
        event.preventDefault();
        clear();
        return;
      }
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      if (event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TAKES_ENTER) != null) return;
      event.preventDefault();
      onExplain();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasSelection, clear, onExplain]);

  return {
    onHighlight,
    onExplain,
    ...(askAbout === undefined ? {} : { onAsk }),
    onSendToBoard,
    ...(onNote === undefined ? {} : { onNote }),
    ...(highlightDisabledReason === undefined ? {} : { highlightDisabledReason }),
  };
}
