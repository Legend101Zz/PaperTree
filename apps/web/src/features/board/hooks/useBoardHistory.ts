'use client';

/**
 * board/hooks/useBoardHistory — the board's undo and redo (#215) as React state: the names on the
 * Undo and Redo buttons, and one replay at a time. The steps and how they replay are
 * `model/history`'s; the writes are the controller's (`ReplayIo`), so an undo sends the requests
 * the gesture sent, carrying the version the board holds when it runs.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  EMPTY_HISTORY,
  forget,
  invert,
  record,
  replay,
  settle,
  take,
  type BoardCommand,
  type History,
  type ReplayIo,
} from '../model/history';

/** What the board shows and offers: the names of the next undo and redo, and the two actions. */
export interface BoardHistory {
  /** The step Undo would take back, e.g. "move of 3 cards"; null when there is none. */
  readonly undoName: string | null;
  readonly redoName: string | null;
  readonly undo: () => Promise<void>;
  readonly redo: () => Promise<void>;
}

/** The controller's handle on the history. */
export interface HistoryControl {
  readonly view: BoardHistory;
  /** A gesture's one step. */
  readonly record: (command: BoardCommand) => void;
  /** Drops every step about a row that changed somewhere else (a 409). */
  readonly forget: (id: string) => void;
  /** A write still on its way (a delete) that the next undo or redo must wait for. */
  readonly after: (work: Promise<unknown>) => void;
}

/** Hooks around a replay: what runs first, and the writes for one step. */
export interface HistoryHooks {
  /** Runs before an undo or redo is taken (the controller sends a pending nudge first). */
  readonly before: () => void;
  /** The board's writes, failures said with `lead` ("Couldn't undo move of 3 cards."). */
  readonly io: (lead: string) => ReplayIo;
}

const nameOf = (steps: readonly BoardCommand[]): string | null => steps.at(-1)?.label ?? null;

/**
 * The history of one board.
 *
 * @param hooks Read on every undo and redo (a ref the controller fills on each render).
 * @returns The view for the board and the handle for the controller.
 */
export function useBoardHistory(hooks: { readonly current: HistoryHooks | null }): HistoryControl {
  const historyRef = useRef<History>(EMPTY_HISTORY);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const publish = useCallback((next: History) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const step = useCallback(
    (side: 'undo' | 'redo') => {
      const io = hooks.current;
      if (io === null) return Promise.resolve();
      io.before();
      const taken = take(historyRef.current, side);
      if (taken === null) return Promise.resolve();
      publish(taken.rest);
      const { command } = taken;
      const lead = `Couldn't ${side} ${command.label}.`;
      const run = chain.current.then(async () => {
        const ok = await replay(side === 'undo' ? invert(command) : command, io.io(lead));
        // A step whose replay failed is dropped: the board was reloaded and said why.
        if (ok) publish(settle(historyRef.current, command, side));
      });
      chain.current = run.catch(() => undefined);
      return run;
    },
    [hooks, publish],
  );

  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);
  // Stable, so the controller's gestures (and the cards' actions built from them) never change
  // identity when a step is recorded: a new step must not re-render 500 cards.
  const remember = useCallback(
    (command: BoardCommand) => publish(record(historyRef.current, command)),
    [publish],
  );
  const drop = useCallback((id: string) => publish(forget(historyRef.current, id)), [publish]);
  const after = useCallback((work: Promise<unknown>) => {
    chain.current = chain.current.then(() => work).catch(() => undefined);
  }, []);
  const view = useMemo(
    () => ({ undoName: nameOf(history.past), redoName: nameOf(history.future), undo, redo }),
    [history, undo, redo],
  );
  return useMemo(
    () => ({ view, record: remember, forget: drop, after }),
    [view, remember, drop, after],
  );
}
