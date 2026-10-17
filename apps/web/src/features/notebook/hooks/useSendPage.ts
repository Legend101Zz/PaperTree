'use client';

/**
 * useSendPage — the header's and the panel's "Send page to board" (S5c, #208; moved out of
 * `NotebookView` by S5e to keep the screen under its size): one card per page, so a page already
 * on the board opens the board instead of sending again; the result is said once in a toast with
 * Open board.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { boardHref } from '../model/links';

import type { BoardCard, SendResult } from './useBoardCard';

const SENT: Readonly<Record<SendResult, string>> = {
  sent: 'The page is on the board now, as one card.',
  failed: 'The page could not be sent to the board. Try again.',
};

/** What a send says, until dismissed. */
export interface SendNotice {
  readonly key: string;
  readonly message: string;
  readonly action: { readonly label: string; readonly onAction: () => void };
}

/** What `useSendPage` returns. */
export interface SendPage {
  readonly send: () => void;
  /** The last send's toast; null when there is none or it was dismissed. */
  readonly notice: SendNotice | null;
  readonly dismiss: () => void;
}

/**
 * Send page to board, and what it says.
 *
 * @param paperId - The paper whose board it is.
 * @param board - `useBoardCard`'s card and send.
 * @returns `send`, the toast and its dismissal.
 */
export function useSendPage(paperId: string, board: BoardCard): SendPage {
  const router = useRouter();
  const [sent, setSent] = useState<SendResult | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const send = (): void => {
    if (board.card !== null && board.card !== undefined) {
      router.push(boardHref(paperId));
      return;
    }
    void board.send().then((result) => {
      setSent(result);
      setDismissed(null);
    });
  };
  const key = sent === null ? null : `sent-${sent}`;
  const notice =
    sent === null || key === null || dismissed === key
      ? null
      : {
          key,
          message: SENT[sent],
          action: { label: 'Open board', onAction: () => router.push(boardHref(paperId)) },
        };
  return { send, notice, dismiss: () => setDismissed(key) };
}
