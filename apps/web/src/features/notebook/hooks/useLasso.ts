'use client';

/**
 * useLasso — the closed lasso and its five actions (S5d, #209, frame 05). A loop is tested against
 * the page AS SHOWN (`shown`: the open answer pushes what is below it down) with S5b's
 * `lassoSelect`; the menu then acts on what it picked: Ask about this hands the typed words to the
 * reader through this tab's storage (`model/askHandoff`) and opens it on a new ask holding them
 * (the ask API cannot take notebook text as context), Make sticky and Delete are each ONE history
 * command, Send to board creates one note card from the typed words, Copy puts them on the
 * clipboard. Ink is never sent.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { boardsApi } from '@/lib/api/boards';

import { sessionStore } from './useAskFromNotebook';
import { boardKey } from './useBoardCard';
import { newClientId } from '../api/notebookApi';
import { stashAsk } from '../model/askHandoff';
import { lassoSelect } from '../model/hitTest';
import { deleteCommand, lassoText, picked, shown, stickyCommand } from '../model/lasso';
import { askHref, boardHref } from '../model/links';

import type { NotebookPageModel } from './useNotebookPage';
import type { InkInHand } from './useInkInput';
import type { BoardView } from '@/lib/api/boards';
import type { LassoAction, Picked } from '../model/lasso';
import type { Vec2 } from '../model/page';

/** A notice the lasso leaves on the page (a Toast). */
export interface LassoNotice {
  readonly key: string;
  readonly message: string;
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

/** What `useLasso` returns. */
export interface Lasso {
  /** The closed loop and what it picked up; null while there is none. */
  readonly selection: { readonly path: readonly Vec2[]; readonly picked: Picked } | null;
  readonly onLasso: NonNullable<InkInHand['onLasso']>;
  readonly act: (action: LassoAction) => void;
  /** Closes the menu and gives the keyboard back to the Lasso button. */
  readonly close: () => void;
  readonly notice: LassoNotice | null;
  readonly dismiss: () => void;
}

/** The board's note cards hold 20,000 characters (`CANVAS_BODY_MAX`). */
const CARD_MAX = 20_000;

/**
 * Puts the typed words on the board as one note card, below everything already there.
 *
 * @param paperId - The paper whose board it is.
 * @param board - The board as read (undefined: it could not be read, the card goes at the top).
 * @param text - The typed words.
 * @returns Whether the card was created, and whether the words had to be cut to fit it.
 */
async function sendCard(
  paperId: string,
  board: BoardView | undefined,
  text: string,
): Promise<{ sent: boolean; cut: boolean }> {
  const y = (board?.nodes ?? []).reduce((max, n) => Math.max(max, n.y + n.h + 40), 0);
  const body = text.slice(0, CARD_MAX);
  try {
    const at = { x: 0, y, w: 280, h: 180 };
    await boardsApi.createNode(paperId, { node_id: newClientId('cn'), kind: 'note', ...at, body });
    return { sent: true, cut: body.length < text.length };
  } catch {
    return { sent: false, cut: false };
  }
}

/**
 * The lasso of one page.
 *
 * @param paperId - The paper (the reader and the board to send to).
 * @param model - The page model (its state, and `run` for one history command).
 * @param active - Whether the lasso is in the hand; putting it down closes the menu.
 * @returns The selection, its actions and the notice they leave.
 */
export function useLasso(paperId: string, model: NotebookPageModel, active: boolean): Lasso {
  const router = useRouter();
  const client = useQueryClient();
  const [selection, setSelection] = useState<Lasso['selection']>(null);
  const [notice, setNotice] = useState<LassoNotice | null>(null);
  const state = model.step?.state ?? null;
  const say = (message: string, action?: LassoNotice['action']): void =>
    setNotice({ key: `${message}-${String(Date.now())}`, message, ...(action ? { action } : {}) });

  useEffect(() => {
    if (!active) setSelection(null);
  }, [active]);

  const close = (): void => {
    setSelection(null);
    document.querySelector<HTMLElement>('[data-ink-tool="lasso"]')?.focus();
  };
  const onLasso: Lasso['onLasso'] = (path, view) => {
    if (path === null || state === null) {
      setSelection(null);
      return;
    }
    const page = shown(state, view.shift);
    const ids = lassoSelect(page.strokes, page.items, path, 2 / view.scale);
    const got = picked(state, ids);
    setSelection(got.count === 0 ? null : { path, picked: got });
  };
  const toBoard = async (text: string): Promise<void> => {
    // Below everything already there: the board is read first when this page has not read it.
    const board = await client
      .ensureQueryData({ queryKey: boardKey(paperId), queryFn: () => boardsApi.get(paperId) })
      .catch(() => undefined);
    const { sent, cut } = await sendCard(paperId, board, text);
    if (!sent) {
      say('The note card could not be sent to the board. Try again.');
      return;
    }
    void client.invalidateQueries({ queryKey: boardKey(paperId) });
    const fit = cut ? ', cut to the card’s 20,000 characters' : '';
    say(`Sent to the board as a note card${fit}. Ink stays on this page.`, {
      label: 'Open board',
      onAction: () => router.push(boardHref(paperId)),
    });
  };
  const act = (action: LassoAction): void => {
    if (selection === null || state === null) return;
    const text = lassoText(selection.picked.typed);
    if (action === 'ask') {
      router.push(askHref(paperId, stashAsk(text, newClientId('ak'), sessionStore())));
      return;
    }
    const cmd =
      action === 'sticky'
        ? stickyCommand(state, selection.picked, newClientId('ni'))
        : action === 'delete'
          ? deleteCommand(state, selection.picked)
          : null;
    if (cmd !== null) model.run(cmd);
    if (action === 'board') void toBoard(text);
    if (action === 'copy') {
      (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).then(
        () => say('Copied the typed text. Handwriting is not copied.'),
        () => say('The browser did not allow copying here.'),
      );
    }
    close();
  };
  return { selection, onLasso, act, close, notice, dismiss: () => setNotice(null) };
}
