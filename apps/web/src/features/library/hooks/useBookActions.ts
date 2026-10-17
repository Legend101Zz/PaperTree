/**
 * useBookActions: Retry and Remove for one book, shared by the catalogue card (#195) and a Table
 * row (#197): the inline confirmation's state, a busy flag while a request runs (a second press
 * meanwhile does nothing, so a double click sends one request), and a failure said as a sentence
 * (never a raw error).
 */
'use client';

import { useCallback, useRef, useState } from 'react';

import { describeError } from '@/components/ui/errors';

/** What `useBookActions` gives a card or a row. */
export interface BookActions {
  /** Remove was pressed: the confirmation is showing. */
  readonly confirming: boolean;
  readonly setConfirming: (confirming: boolean) => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly retry: () => void;
  readonly remove: () => void;
}

/**
 * One book's Retry and confirmed Remove.
 *
 * @param paperId - The book.
 * @param onRetry - Starts reading it again.
 * @param onDelete - Removes it, once confirmed.
 * @returns The state and the two actions.
 */
export function useBookActions(
  paperId: string,
  onRetry: (paperId: string) => Promise<unknown>,
  onDelete: (paperId: string) => Promise<unknown>,
): BookActions {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not `busy`: two clicks in one frame both see the state from before the first.
  const inFlight = useRef(false);
  const run = useCallback(async (action: () => Promise<unknown>, fallback: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(false);
    } catch (caught) {
      setError(describeError(caught, fallback));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  const retry = useCallback(
    () =>
      void run(
        () => onRetry(paperId),
        'Could not start reading again. Check your connection and retry.',
      ),
    [run, onRetry, paperId],
  );
  const remove = useCallback(
    () =>
      void run(
        () => onDelete(paperId),
        'Could not delete this paper. Check your connection and try again.',
      ),
    [run, onDelete, paperId],
  );
  return { confirming, setConfirming, busy, error, retry, remove };
}
