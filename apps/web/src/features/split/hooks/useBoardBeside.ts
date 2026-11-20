'use client';

/**
 * split/hooks/useBoardBeside — the split view's state: whether the board is beside the paper, where
 * the divider sits, which side is folded, and what is remembered (#344, P4 step 7).
 *
 * It also owns the page-level effects of being open: the board takes the right-hand side the way the
 * explain drawer does (a rule in `split.css`, keyed on `data-pt-board` and `--pt-board-width`, makes
 * the page room for it), and the key B toggles it (not while typing, not with a modifier). On a
 * window too narrow for two panes it does not open: `onUnavailable` says where the reader goes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  boardWidthOf,
  canSplit,
  readSplit,
  shareAt,
  widenForBranch,
  writeSplit,
  type SplitState,
} from '../model/split';

import type { BoardArrival } from '@/features/board';

/** What the split view's mount and divider need. */
export interface BoardBeside {
  readonly open: boolean;
  /** The window's width in px. */
  readonly viewport: number;
  readonly state: SplitState;
  /** The board pane's width in px (a strip when it is folded). */
  readonly boardWidth: number;
  /** The card the board is to open on (centred with its ask box, or dropped where it was let go). */
  readonly arrival: BoardArrival | null;
  readonly openBeside: () => void;
  /** Opens the board beside the paper on a card (Board beside, a source click); null: just open. */
  readonly openOn: (cardId: string | null) => void;
  /** A card that landed while the board was already open: glow it, centre it or keep the view. */
  readonly arriveAt: (cardId: string, centre: boolean) => void;
  readonly close: () => void;
  readonly toggle: () => void;
  /** The divider dragged to `x`, in px from the window's left. */
  readonly dragTo: (x: number) => void;
  readonly setShare: (share: number) => void;
  readonly fold: (side: 'paper' | 'board') => void;
  /** One click: both sides open again. */
  readonly restore: () => void;
  /** The board's first branch: more room for it (the paper folds to a strip, once). */
  readonly widen: () => void;
}

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Keys typed into a field are the field's. */
const TYPING = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/**
 * The window's width, kept current.
 *
 * @returns Its inner width in px (1280 before the first measure).
 */
function useViewportWidth(): number {
  const [width, setWidth] = useState(1280);
  useEffect(() => {
    const read = (): void => setWidth(window.innerWidth);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return width;
}

/**
 * The split view's state for one reader.
 *
 * @param onUnavailable Called instead of opening when the window has no room for two panes (with
 *   the card that was to be opened on), so the reader can go to the full-width board instead.
 * @returns The state and its gestures.
 */
export function useBoardBeside(onUnavailable?: (cardId: string | null) => void): BoardBeside {
  const [open, setOpen] = useState(false);
  const [arrival, setArrival] = useState<BoardArrival | null>(null);
  const nonce = useRef(0);
  const [state, setState] = useState<SplitState>({ ...readSplit(null), auto: false });
  const viewport = useViewportWidth();
  // The paper folds for the first branch of a board opening ONCE: a reader who unfolds it is not
  // folded again by the next branch.
  const widened = useRef(false);
  const boardWidth = boardWidthOf(state, viewport);

  // The remembered split is read once on the client, before the first open.
  useEffect(() => {
    setState({ ...readSplit(storage()), auto: false });
  }, []);

  const change = useCallback((next: (was: SplitState) => SplitState): void => {
    setState((was) => {
      const to = next(was);
      if (to !== was) writeSplit(storage(), to);
      return to;
    });
  }, []);

  const arriveAt = useCallback((cardId: string, centre: boolean): void => {
    nonce.current += 1;
    setArrival({ cardId, nonce: nonce.current, centre });
  }, []);
  const openOn = useCallback(
    (cardId: string | null): void => {
      if (!canSplit(window.innerWidth)) {
        onUnavailable?.(cardId);
        return;
      }
      // A reader who left the paper folded by a branch finds both sides again, as the reader did.
      change((was) =>
        was.auto || was.folded === 'board' ? { ...was, folded: 'none', auto: false } : was,
      );
      widened.current = false;
      setOpen(true);
      if (cardId !== null) arriveAt(cardId, true);
    },
    [arriveAt, change, onUnavailable],
  );
  const openBeside = useCallback((): void => openOn(null), [openOn]);
  const close = useCallback((): void => {
    setOpen(false);
    setArrival(null);
  }, []);
  const toggle = useCallback((): void => {
    if (open) setOpen(false);
    else openBeside();
  }, [open, openBeside]);

  const dragTo = useCallback(
    (x: number): void =>
      change((was) => ({
        ...was,
        share: shareAt(x, window.innerWidth),
        folded: 'none',
        auto: false,
      })),
    [change],
  );
  const setShare = useCallback(
    (share: number): void => change((was) => ({ ...was, share, folded: 'none', auto: false })),
    [change],
  );
  const fold = useCallback(
    (side: 'paper' | 'board'): void => change((was) => ({ ...was, folded: side, auto: false })),
    [change],
  );
  const restore = useCallback(
    (): void => change((was) => ({ ...was, folded: 'none', auto: false })),
    [change],
  );
  const widen = useCallback((): void => {
    if (widened.current) return;
    widened.current = true;
    change(widenForBranch);
  }, [change]);

  // The page makes room for the pane while it is open (the same rule the explain drawer uses).
  useEffect(() => {
    if (!open) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-pt-board', 'open');
    root.style.setProperty('--pt-board-width', `${String(boardWidth)}px`);
    return () => {
      root.removeAttribute('data-pt-board');
      root.style.removeProperty('--pt-board-width');
    };
  }, [open, boardWidth]);

  // B toggles the board beside the paper.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'b' || event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest(TYPING) !== null) return;
      event.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  return {
    open,
    viewport,
    state,
    boardWidth,
    arrival,
    openBeside,
    openOn,
    arriveAt,
    close,
    toggle,
    dragTo,
    setShare,
    fold,
    restore,
    widen,
  };
}
