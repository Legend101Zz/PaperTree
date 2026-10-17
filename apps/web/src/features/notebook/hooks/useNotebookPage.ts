'use client';

/**
 * useNotebookPage — one page, loaded once and then edited locally through S5b's `history.ts`
 * (S5c, #208). Every command's touched items go to `useItemSaver`, which saves them in the
 * background and reports where saving stands; after every command `useStrokeSaver` sends what the
 * server lacks of the ink (S5d, #209).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { boardKey, cardOn } from './useBoardCard';
import { useItemSaver } from './useItemSaver';
import { useStrokeSaver } from './useStrokeSaver';
import { notebookApi, notebookKeys } from '../api/notebookApi';
import { createHistory, execute, redo, undo } from '../model/history';
import { bodyOf, itemFromWire, strokeFromWire } from '../model/wire';

import type { SaveStatus } from './useItemSaver';
import type { InkSaveStatus } from './useStrokeSaver';
import type { NotebookPageView } from '../api/notebookApi';
import type { BoardView } from '@/lib/api/boards';
import type { Command, Step } from '../model/history';
import type { Item } from '../model/page';
import type { Stroke } from '../model/stroke';

/** What `useNotebookPage` returns. */
export interface NotebookPageModel {
  /** The page as loaded (title, template, the exchange bodies). */
  readonly view: NotebookPageView | undefined;
  readonly loadError: unknown;
  /** The local page; null until the first load. */
  readonly step: Step | null;
  /** Where saving stands (conflict, failures, refusals, items gone). */
  readonly save: SaveStatus;
  /** Items on the page that the server does not have as shown, counted at this render. */
  readonly unsaved: number;
  /** Where saving the ink stands. */
  readonly ink: InkSaveStatus;
  /** Strokes the server does not hold as shown, counted at this render. */
  readonly unsavedInk: number;
  /** The words of unsaved notes and stickies, for "Copy text". */
  readonly unsavedText: () => string;
  readonly run: (cmd: Command) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  /** Re-sends every item whose save failed. */
  readonly retry: () => void;
}

/**
 * The items a command touches.
 *
 * @param cmd - A history command.
 * @returns Their ids.
 */
function touched(cmd: Command): string[] {
  switch (cmd.type) {
    case 'add-items':
      return cmd.items.map((i) => i.id);
    case 'remove-items':
      return cmd.removed.map((r) => r.value.id);
    case 'move':
      return [...cmd.itemIds];
    case 'edit-text':
    case 'resize':
      return [cmd.itemId];
    case 'batch':
      return cmd.commands.flatMap(touched);
    default:
      return [];
  }
}

function initialStep(view: NotebookPageView): Step {
  const items = view.items.flatMap((w) => itemFromWire(w) ?? []);
  const strokes = view.strokes.flatMap((w) => strokeFromWire(w) ?? []);
  return {
    state: { items: items as Item[], strokes: strokes as Stroke[] },
    history: createHistory(),
  };
}

/**
 * Loads a page and returns its local model plus the commands that edit it.
 *
 * @param paperId - The paper (scopes the cache key).
 * @param pageId - The page.
 * @returns The page model.
 */
export function useNotebookPage(paperId: string, pageId: string): NotebookPageModel {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: notebookKeys.page(paperId, pageId),
    queryFn: () => notebookApi.getPage(pageId),
    staleTime: Infinity,
  });
  const [step, setStep] = useState<Step | null>(null);
  const stepRef = useRef<Step | null>(null);
  const bodies = useRef(new Map<string, string>());
  // The panel's counts and the board card's are the server's; re-read them once a burst has
  // landed, so neither goes stale after an edit. The board only while it holds this page's card:
  // a board read returns every node and edge, and a page not on it has no counts there.
  const onSettled = (): void => {
    void client.invalidateQueries({ queryKey: notebookKeys.pages(paperId) });
    const card = cardOn(client.getQueryData<BoardView>(boardKey(paperId)), pageId);
    if (card !== null && card !== undefined) {
      void client.invalidateQueries({ queryKey: boardKey(paperId) });
    }
  };
  const saver = useItemSaver(pageId, {
    items: () => stepRef.current?.state.items ?? [],
    body: (item) => bodyOf(item, bodies.current),
    onSettled,
  });
  const strokes = useStrokeSaver(pageId, () => stepRef.current?.state.strokes ?? [], onSettled);
  const { seed, sync } = saver;
  const { seed: seedInk, sync: syncInk } = strokes;

  useEffect(() => {
    const view = query.data;
    if (view === undefined || stepRef.current !== null) return;
    seed(view.items);
    bodies.current = new Map(view.items.map((w) => [w.item_id, w.body]));
    stepRef.current = initialStep(view);
    // Only the strokes that decoded: one this page cannot draw is not on it, and must never be
    // taken for erased and deleted.
    seedInk(stepRef.current.state.strokes.map((st) => st.id));
    setStep(stepRef.current);
  }, [query.data, seed, seedInk]);

  const apply = useCallback(
    (next: (s: Step) => Step, ids: (before: Step, after: Step) => string[]) => {
      const before = stepRef.current;
      if (before === null) return;
      const after = next(before);
      if (after === before) return;
      stepRef.current = after;
      setStep(after);
      sync(ids(before, after));
      syncInk();
    },
    [sync, syncInk],
  );

  return {
    view: query.data,
    loadError: query.error,
    step,
    save: saver.status,
    unsaved: step === null ? 0 : saver.unsaved(),
    ink: strokes.status,
    unsavedInk: step === null ? 0 : strokes.unsaved(),
    unsavedText: saver.unsavedText,
    run: (cmd) =>
      apply(
        (s) => execute(s, cmd),
        (_b, a) => touched(a.history.past.at(-1) ?? cmd),
      ),
    undo: () => apply(undo, (b) => touched(b.history.past.at(-1) as Command)),
    redo: () => apply(redo, (b) => touched(b.history.future.at(-1) as Command)),
    retry: () => {
      saver.retry();
      syncInk();
    },
  };
}
