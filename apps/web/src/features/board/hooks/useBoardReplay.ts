'use client';

/**
 * board/hooks/useBoardReplay — wires the board's writes into the history (#215). Every gesture
 * that writes records ONE step; an undo or redo replays it through these same writes with the
 * version held when they run, so a card changed somewhere else answers 409: the board reloads, says
 * so, and forgets the steps that would write over it.
 *
 * The hooks are filled at the end of every render (the history reads them through a ref), exactly
 * as the single controller did, so a replay always runs the newest closures.
 */
import { withFields } from '../model/flow';

import type { MutableRefObject } from 'react';
import type { ReplayIo } from '../model/history';
import type { HistoryHooks } from './useBoardHistory';
import type { BoardPositions } from './useBoardPositions';
import type { BoardRows } from './useBoardRows';
import type { BoardStore } from './useBoardStore';
import type { BoardThreads } from './useBoardThreads';
import type { UndoOfferControl } from './useUndoOffer';
import type { BoardWrites } from './useBoardWrites';

/** What the replay needs from the other hooks. */
interface ReplayParts {
  readonly store: BoardStore;
  readonly writes: BoardWrites;
  readonly offer: UndoOfferControl;
  readonly positions: BoardPositions;
  readonly rows: BoardRows;
  readonly threads: BoardThreads;
}

/**
 * Fills the history's hooks for this render.
 *
 * @param hooks The ref the history reads on every undo and redo.
 * @param parts The other controller hooks whose writes a replay runs.
 */
export function useBoardReplay(
  hooks: MutableRefObject<HistoryHooks | null>,
  { store, writes, offer, positions, rows, threads }: ReplayParts,
): void {
  const { nodesRef, sentRef, setNodes, setNotice } = store;

  /**
   * The writes an undo or redo replays.
   *
   * @param lead The sentence each failure starts with ("Couldn't undo move of 3 cards.").
   * @returns The board's writes for one replay.
   */
  const replayIo = (lead: string): ReplayIo => ({
    patchCards: async (changes) => {
      if (changes.some((c) => !nodesRef.current.some((n) => n.id === c.id))) {
        setNotice(`${lead} That card is no longer on the board.`);
        return false;
      }
      const by = new Map(changes.map((c) => [c.id, c.fields] as const));
      setNodes(
        nodesRef.current.map((n) => {
          const fields = by.get(n.id);
          return fields === undefined ? n : withFields(n, fields);
        }),
      );
      for (const { id, fields } of changes) {
        if (fields.x !== undefined && fields.y !== undefined)
          sentRef.current.set(id, { x: fields.x, y: fields.y });
      }
      const saved = await Promise.all(changes.map((c) => writes.patchNode(c.id, c.fields, lead)));
      return saved.every(Boolean);
    },
    patchThread: (id, fields, expect) =>
      writes.edgeWrite(id, () => threads.replayThread(id, fields, expect, lead)),
    restore: (set) => rows.restoreRows(set, lead),
    remove: (set) => rows.removeRows(set, lead),
  });
  hooks.current = {
    before: () => {
      positions.flushNudges();
      offer.dismissUndo();
    },
    io: replayIo,
  };
}
