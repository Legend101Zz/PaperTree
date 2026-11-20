'use client';

/**
 * board/hooks/useBoardWrites — the primitives every write goes through: the card's PATCH (one at a
 * time per card, each carrying the version the last one returned), a thread's write queue, and what
 * the reader is told when a write fails.
 *
 * LOCAL FIRST, THEN THE SERVER. A change is applied to the screen at once and sent after; if the
 * server refuses it, the reader sees a sentence and the board is reloaded from the server, so the
 * screen never keeps a change the server does not have (failures are visible, never faked). A 409
 * (`stale_version`) names the card by what the SERVER has after the reload.
 */
import { useCallback, useEffect, useRef } from 'react';

import { boardsApi } from '@/lib/api/boards';
import { ApiError } from '@/lib/api/types';

import { cardName } from '../model/flow';
import { RELOADED, STALE_NOTICE_MS, sentence, staleSubject } from './controllerShared';

import type { CardFields } from '../model/history';
import type { BoardStore } from './useBoardStore';
import type { UndoOfferControl } from './useUndoOffer';

/** What a refusal is about: the card (named after the reload), the thread, the undo's lead. */
export interface FailureAbout {
  readonly card?: string;
  readonly thread?: string;
  readonly lead?: string;
}

/** The write primitives. */
export interface BoardWrites {
  readonly failed: (error: unknown, fallback: string, about?: FailureAbout) => void;
  readonly clearStale: () => void;
  /** Hides the notice and stops a stale notice's own timer. */
  readonly dismissNotice: () => void;
  /** One PATCH, after the card's earlier ones; resolves true once saved (`lead` heads a refusal). */
  readonly patchNode: (id: string, fields: CardFields, lead?: string) => Promise<boolean>;
  /** One write at a time per thread: `work` starts once the thread's earlier writes settled. */
  readonly edgeWrite: <T>(id: string, work: () => Promise<T>) => Promise<T>;
}

/**
 * The write primitives for one board.
 *
 * @param store The board's working copy.
 * @param offer The Undo toast (a refused card is forgotten there).
 * @returns The write primitives.
 */
export function useBoardWrites(store: BoardStore, offer: UndoOfferControl): BoardWrites {
  const { aliveRef, boardRef, versionRef, chainRef, nodesRef, mergeData, reload, setNotice } =
    store;
  const { forgetRow } = offer;
  /** One write at a time per thread, as `chainRef` does for cards (#215 review S4). */
  const edgeChainRef = useRef(new Map<string, Promise<unknown>>());
  /** True while the notice on screen is the stale-version one, which clears itself. */
  const staleShown = useRef(false);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (staleTimer.current !== null) clearTimeout(staleTimer.current);
    },
    [],
  );

  const clearStale = useCallback(() => {
    if (!staleShown.current) return;
    staleShown.current = false;
    if (staleTimer.current !== null) clearTimeout(staleTimer.current);
    staleTimer.current = null;
    setNotice(null);
  }, [setNotice]);

  const dismissNotice = useCallback(() => {
    staleShown.current = false;
    setNotice(null);
  }, [setNotice]);

  /**
   * `about.card` is the card a stale-version refusal was about. The notice names it by what the
   * SERVER has after the reload, never by the reader's unsaved text still on the card when the save
   * failed. `about.lead` starts the sentence of an undo or redo that failed.
   */
  const failed = useCallback(
    (error: unknown, fallback: string, about: FailureAbout = {}) => {
      if (!aliveRef.current) return;
      const { card: cardId, lead } = about;
      if (error instanceof ApiError && error.code === 'stale_version') {
        // No later undo may overwrite what changed somewhere else (#215).
        if (cardId !== undefined) forgetRow(cardId);
        staleShown.current = true;
        if (staleTimer.current !== null) clearTimeout(staleTimer.current);
        staleTimer.current = setTimeout(clearStale, STALE_NOTICE_MS);
        void reload().then(() => {
          if (!aliveRef.current || !staleShown.current) return;
          const fresh =
            cardId === undefined ? undefined : nodesRef.current.find((n) => n.id === cardId);
          setNotice(
            `${lead === undefined ? '' : `${lead} `}${staleSubject(fresh === undefined ? undefined : cardName(fresh.data.node))} was changed somewhere else. The latest version is shown.`,
          );
        });
        return;
      }
      staleShown.current = false;
      const gone = error instanceof ApiError && error.code === 'not_found';
      const what = about.thread === undefined ? 'That card' : 'That thread';
      setNotice(
        lead === undefined
          ? sentence(error, fallback)
          : `${lead} ${gone ? `${what} is no longer on the board.` : sentence(error, RELOADED)}`,
      );
      void reload();
    },
    [aliveRef, clearStale, forgetRow, nodesRef, reload, setNotice],
  );

  const patchNode = useCallback(
    (id: string, fields: CardFields, lead?: string): Promise<boolean> => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined) return Promise.resolve(false);
      let saved = false;
      const run = async (): Promise<void> => {
        const version = versionRef.current.get(id);
        if (version === undefined) return;
        try {
          const row = await boardsApi.patchNode(boardId, id, { version, ...fields });
          versionRef.current.set(id, row.version);
          saved = true;
          if (aliveRef.current) {
            mergeData(id, { version: row.version, updated_at: row.updated_at });
            clearStale();
          }
        } catch (error) {
          failed(error, `Couldn't save that change. ${RELOADED}`, { card: id, lead });
        }
      };
      const done = (chainRef.current.get(id) ?? Promise.resolve()).then(run);
      chainRef.current.set(id, done);
      return done.then(() => saved);
    },
    [aliveRef, boardRef, chainRef, clearStale, failed, mergeData, versionRef],
  );

  const edgeWrite = useCallback(<T>(id: string, work: () => Promise<T>): Promise<T> => {
    const done = (edgeChainRef.current.get(id) ?? Promise.resolve()).then(work, work);
    edgeChainRef.current.set(
      id,
      done.catch(() => undefined),
    );
    return done;
  }, []);

  return { failed, clearStale, dismissNotice, patchNode, edgeWrite };
}
