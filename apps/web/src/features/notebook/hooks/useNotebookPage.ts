'use client';

/**
 * useNotebookPage — one page, loaded once and then edited locally through S5b's `history.ts`, with
 * every touched item saved in the background (S5c, #208). Saves run one at a time PER ITEM and
 * read the latest local state when they run, so a burst of nudges becomes one PATCH and two
 * PATCHes of one item never race on `version`. A conflict (409) stops all saving until reload.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { notebookApi, notebookKeys } from '../api/notebookApi';
import { pushItem } from '../api/pushItem';
import { createHistory, execute, redo, undo } from '../model/history';
import { saveOp, savedFromWire } from '../model/save';
import { bodyOf, itemFromWire, strokeFromWire } from '../model/wire';

import type { NotebookPageView } from '../api/notebookApi';
import type { Command, Step } from '../model/history';
import type { Item } from '../model/page';
import type { SavedItem } from '../model/save';
import type { Stroke } from '../model/stroke';

/** Where the page's saving stands; `conflict` and `failed` are shown to the person. */
export type SaveState = 'idle' | 'saving' | 'conflict' | 'failed';

/** What `useNotebookPage` returns. */
export interface NotebookPageModel {
  /** The page as loaded (title, template, the exchange bodies). */
  readonly view: NotebookPageView | undefined;
  readonly loadError: unknown;
  /** The local page; null until the first load. */
  readonly step: Step | null;
  readonly save: SaveState;
  readonly run: (cmd: Command) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  /** Re-sends every item that differs from the server (after a failed save). */
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
      return [cmd.itemId];
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
  const query = useQuery({
    queryKey: notebookKeys.page(paperId, pageId),
    queryFn: () => notebookApi.getPage(pageId),
    staleTime: Infinity,
  });
  const [step, setStep] = useState<Step | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const stepRef = useRef<Step | null>(null);
  const saved = useRef(new Map<string, SavedItem>());
  const bodies = useRef(new Map<string, string>());
  const queue = useRef(new Map<string, Promise<void>>());
  const pending = useRef(0);
  const blocked = useRef(false);

  useEffect(() => {
    const view = query.data;
    if (view === undefined || stepRef.current !== null) return;
    saved.current = new Map(view.items.map((w) => [w.item_id, savedFromWire(w)]));
    bodies.current = new Map(view.items.map((w) => [w.item_id, w.body]));
    stepRef.current = initialStep(view);
    setStep(stepRef.current);
  }, [query.data]);

  const saveItem = useCallback(
    async (id: string): Promise<void> => {
      if (blocked.current) return;
      const local = stepRef.current?.state.items.find((i) => i.id === id);
      const op = saveOp(saved.current.get(id), local, local ? bodyOf(local, bodies.current) : '');
      if (op === null) return;
      const result = await pushItem(pageId, id, op);
      if (result.kind === 'saved') saved.current.set(id, result.saved);
      else if (result.kind === 'deleted') saved.current.delete(id);
      else {
        if (result.kind === 'conflict') blocked.current = true;
        setSave(result.kind);
      }
    },
    [pageId],
  );

  const sync = useCallback(
    (ids: readonly string[]) => {
      for (const id of ids) {
        pending.current += 1;
        setSave((s) => (s === 'idle' ? 'saving' : s));
        const next = (queue.current.get(id) ?? Promise.resolve()).then(() => saveItem(id));
        queue.current.set(
          id,
          next.finally(() => {
            pending.current -= 1;
            if (pending.current === 0) setSave((s) => (s === 'saving' ? 'idle' : s));
          }),
        );
      }
    },
    [saveItem],
  );

  const apply = useCallback(
    (next: (s: Step) => Step, ids: (before: Step, after: Step) => string[]) => {
      const before = stepRef.current;
      if (before === null) return;
      const after = next(before);
      if (after === before) return;
      stepRef.current = after;
      setStep(after);
      sync(ids(before, after));
    },
    [sync],
  );

  return {
    view: query.data,
    loadError: query.error,
    step,
    save,
    run: (cmd) =>
      apply(
        (s) => execute(s, cmd),
        (_b, a) => touched(a.history.past.at(-1) ?? cmd),
      ),
    undo: () => apply(undo, (b) => touched(b.history.past.at(-1) as Command)),
    redo: () => apply(redo, (b) => touched(b.history.future.at(-1) as Command)),
    retry: () => {
      setSave('saving');
      const ids = new Set([
        ...saved.current.keys(),
        ...(stepRef.current?.state.items ?? []).map((i) => i.id),
      ]);
      sync([...ids]);
    },
  };
}
