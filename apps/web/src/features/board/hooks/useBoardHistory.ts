'use client';

/**
 * board/hooks/useBoardHistory — the board's undo and redo (#215) as React state: the names on the
 * Undo and Redo buttons, and one replay at a time. The steps and how they replay are
 * `model/history`'s; the writes are the controller's (`ReplayIo`), so an undo sends the requests
 * the gesture sent, carrying the version the board holds when it runs.
 *
 * ONE REPLAY AT A TIME, IN ORDER. Each undo or redo takes its step only when the replays before it
 * have settled, and a gesture made while a replay is saving is recorded after that replay settles,
 * so the stacks keep the order things happened in and no Redo outlives a newer gesture (#215
 * review S5).
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
  touches,
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
  /** Drops the steps that would write over a row changed somewhere else (a 409). */
  readonly forget: (id: string) => void;
  /** A write still on its way (a delete) that the next undo or redo must wait for. */
  readonly after: (work: Promise<unknown>) => void;
  /**
   * Undoes the step with this `key` only if it is still the newest one (the Undo toast's step).
   * Resolves null, having undone nothing, when it is not; else whether the replay was saved.
   */
  readonly undoIf: (key: string) => Promise<boolean | null>;
  /** Whether a step with this `key` can still be undone. */
  readonly contains: (key: string) => boolean;
  /** Whether any step (or one waiting to be recorded) writes this card or thread. */
  readonly holds: (id: string) => boolean;
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
  /** Steps recorded while a replay is saving, recorded once it settles. */
  const waiting = useRef<BoardCommand[] | null>(null);

  const publish = useCallback((next: History) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  /** Replays one step taken from `side`; then records what waited for it. */
  const run = useCallback(
    async (side: 'undo' | 'redo', io: HistoryHooks, key?: string): Promise<boolean | null> => {
      const top = (side === 'undo' ? historyRef.current.past : historyRef.current.future).at(-1);
      if (key !== undefined && top?.key !== key) return null;
      const taken = take(historyRef.current, side);
      if (taken === null) return null;
      publish(taken.rest);
      const { command } = taken;
      waiting.current = [];
      try {
        const lead = `Couldn't ${side} ${command.label}.`;
        const ok = await replay(side === 'undo' ? invert(command) : command, io.io(lead));
        // A step whose replay failed is dropped: the board was reloaded and said why.
        if (ok) publish(settle(historyRef.current, command, side));
        return ok;
      } finally {
        const later = waiting.current;
        waiting.current = null;
        for (const step of later) publish(record(historyRef.current, step));
      }
    },
    [publish],
  );

  const queue = useCallback(<T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    const next = chain.current.then(work, work);
    chain.current = next.catch(() => fallback);
    return next;
  }, []);

  const step = useCallback(
    (side: 'undo' | 'redo') =>
      queue(async () => {
        const io = hooks.current;
        if (io === null) return;
        io.before();
        await run(side, io);
      }, undefined),
    [hooks, queue, run],
  );

  const undoIf = useCallback(
    (key: string) =>
      queue(async () => {
        const io = hooks.current;
        // No `before`: a nudge still in its debounce is newer, and is recorded after this undo.
        return io === null ? null : run('undo', io, key);
      }, null),
    [hooks, queue, run],
  );

  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);
  // Stable, so the controller's gestures (and the cards' actions built from them) never change
  // identity when a step is recorded: a new step must not re-render 500 cards.
  const remember = useCallback(
    (command: BoardCommand) => {
      if (waiting.current !== null) waiting.current.push(command);
      else publish(record(historyRef.current, command));
    },
    [publish],
  );
  const drop = useCallback(
    (id: string) => {
      publish(forget(historyRef.current, id));
      if (waiting.current !== null) {
        const kept = forget({ past: waiting.current, future: [] }, id).past;
        waiting.current = [...kept];
      }
    },
    [publish],
  );
  const after = useCallback((work: Promise<unknown>) => {
    chain.current = chain.current.then(() => work).catch(() => undefined);
  }, []);
  const contains = useCallback(
    (key: string) => historyRef.current.past.some((c) => c.key === key),
    [],
  );
  const holds = useCallback((id: string) => {
    const { past, future } = historyRef.current;
    return [...past, ...future, ...(waiting.current ?? [])].some((c) => touches(c, id));
  }, []);
  const view = useMemo(
    () => ({ undoName: nameOf(history.past), redoName: nameOf(history.future), undo, redo }),
    [history, undo, redo],
  );
  return useMemo(
    () => ({ view, record: remember, forget: drop, after, undoIf, contains, holds }),
    [view, remember, drop, after, undoIf, contains, holds],
  );
}
