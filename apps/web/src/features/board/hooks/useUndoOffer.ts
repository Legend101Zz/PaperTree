'use client';

/**
 * board/hooks/useUndoOffer — the Undo toast after a delete or a new thread, and how a gesture is
 * recorded. Only a delete and a new thread show the toast; any other step puts an earlier toast
 * away, since its Undo would now take back this one. The toast names its own step (`offerKey`) and
 * takes back that step or nothing (#215 review S1).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { NOT_NEWEST, UNDO_VISIBLE_MS, type UndoOffer } from './controllerShared';

import type { BoardCommand } from '../model/history';
import type { HistoryControl } from './useBoardHistory';

/** The toast's state and the recording of a gesture's step. */
export interface UndoOfferControl {
  readonly undo: UndoOffer | null;
  readonly dismissUndo: () => void;
  readonly runUndo: () => Promise<void>;
  /** A gesture's one step; `toast` is the words of the Undo offer, when it gets one. */
  readonly recordStep: (command: BoardCommand, toast?: string) => void;
  /** Forgets the steps that would write over a row changed elsewhere, and a toast naming one. */
  readonly forgetRow: (id: string) => void;
}

/**
 * The Undo toast and step recording for one board.
 *
 * @param hist The board's history.
 * @param setNotice Where a refused toast Undo says why.
 * @returns The toast's state and actions.
 */
export function useUndoOffer(
  hist: HistoryControl,
  setNotice: (notice: string | null) => void,
): UndoOfferControl {
  const [undo, setUndo] = useState<UndoOffer | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoSeq = useRef(0);
  /** The `key` of the step the Undo toast names. */
  const offerKey = useRef<string | null>(null);
  const { record: remember, forget: forgetHistory, undoIf } = hist;

  useEffect(
    () => () => {
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    },
    [],
  );

  const offerUndo = useCallback((message: string, key: string) => {
    undoSeq.current += 1;
    offerKey.current = key;
    setUndo({ token: undoSeq.current, message });
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      offerKey.current = null;
      setUndo(null);
    }, UNDO_VISIBLE_MS);
  }, []);

  const dismissUndo = useCallback(() => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    offerKey.current = null;
    setUndo(null);
  }, []);

  const forgetRow = useCallback(
    (id: string) => {
      forgetHistory(id);
      if (offerKey.current !== null && !hist.contains(offerKey.current)) dismissUndo();
    },
    [dismissUndo, forgetHistory, hist],
  );

  const recordStep = useCallback(
    (command: BoardCommand, toast?: string) => {
      if (toast === undefined) {
        remember(command);
        dismissUndo();
        return;
      }
      const key = `toast-${String(undoSeq.current + 1)}`;
      remember({ ...command, key });
      offerUndo(toast, key);
    },
    [dismissUndo, offerUndo, remember],
  );

  const runUndo = useCallback(async () => {
    const key = offerKey.current;
    // Only while the toast shows: after it goes, Cmd/Ctrl+Z and the toolbar's Undo still can.
    if (key === null || undoTimer.current === null) return;
    dismissUndo();
    // The toast takes back the step it names, or nothing: never an older one (#215 review S1).
    if ((await undoIf(key)) === null) setNotice(NOT_NEWEST);
  }, [dismissUndo, setNotice, undoIf]);

  return { undo, dismissUndo, runUndo, recordStep, forgetRow };
}
