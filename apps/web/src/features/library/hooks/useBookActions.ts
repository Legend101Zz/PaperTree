/**
 * useBookActions: Retry and Remove for one book, shared by the catalogue card (#195) and a Table
 * row (#197): the inline confirmation's state, a busy flag while a request runs, and a failure
 * said as a sentence (never a raw error).
 */
'use client';

import { useCallback, useState } from 'react';

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
  const run = useCallback(async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(false);
    } catch (caught) {
      setError(describeError(caught, fallback));
    } finally {
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
