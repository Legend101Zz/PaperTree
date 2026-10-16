'use client';

/**
 * usePageEditing — the editing session on a notebook page (S5c, #208): which note is being typed
 * in, the draft of a new one (it joins the page, as ONE history command, only when it has words),
 * moves and deletes, and the Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl+Y shortcuts. Every finished
 * gesture is one S5b command run through `useNotebookPage`, which saves what it touched. The
 * keyboard never falls to `<body>`: whatever takes an item away (a delete, undoing an add, redoing
 * a delete) moves it to the next item, else the previous, else the page title; whatever brings
 * one back gives it to that item.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { newClientId } from '../api/notebookApi';
import { focusItem } from './focus';
import { neighbourOf, placeNewItem } from '../model/layout';
import { STICKY_COLOUR } from '../model/wire';

import type { NotebookPageModel } from './useNotebookPage';
import type { Command } from '../model/history';
import type { Item, StickyItem, TextItem } from '../model/page';

/** What `usePageEditing` returns: the session state, and actions whose identity never changes. */
export interface PageEditing extends Actions {
  readonly editingId: string | null;
  readonly draft: TextItem | StickyItem | null;
}

/** The session's actions. */
interface Actions {
  readonly edit: (id: string) => void;
  readonly startDraft: (kind: 'text' | 'sticky') => void;
  readonly commit: (id: string, text: string) => void;
  readonly move: (id: string, dx: number, dy: number) => void;
  readonly remove: (id: string) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

const NEW_SIZE = { text: { w: 288, h: 72 }, sticky: { w: 168, h: 144 } } as const;

/**
 * True when a key event belongs to a field's own text editing (its own undo, its own arrows).
 *
 * @param target - The event's target.
 * @returns Whether it is inside a text field.
 */
function inField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.closest('textarea, input, [contenteditable]') !== null
  );
}

/**
 * Where the keyboard goes after an undo or redo of `cmd`, worked out BEFORE the step: to the item
 * it puts back on the page, or, when it takes one away, to the next item in reading order, else
 * the previous one, else the page title (`null`). `undefined`: the step moves nothing in or out.
 *
 * @param cmd - The command being undone (or redone).
 * @param undoing - True for an undo.
 * @param items - The page's items before the step.
 * @returns The item id to focus, null for the page title, or undefined to leave focus alone.
 */
function focusAfter(
  cmd: Command | undefined,
  undoing: boolean,
  items: readonly Item[],
): string | null | undefined {
  if (cmd?.type !== 'add-items' && cmd?.type !== 'remove-items') return undefined;
  const first = cmd.type === 'add-items' ? cmd.items[0]?.id : cmd.removed[0]?.value.id;
  if (first === undefined) return undefined;
  const bringsBack = (cmd.type === 'remove-items') === undoing;
  return bringsBack ? first : neighbourOf(items, first);
}

/**
 * The page's editing session.
 *
 * @param model - The page model from `useNotebookPage`.
 * @returns The session state and its actions.
 */
export function usePageEditing(model: NotebookPageModel): PageEditing {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TextItem | StickyItem | null>(null);
  const items: readonly Item[] = model.step?.state.items ?? [];
  const history = model.step?.history;
  const { run } = model;

  const actions: Actions = {
    edit: setEditingId,
    startDraft: (kind) => {
      const { w, h } = NEW_SIZE[kind];
      const z = items.reduce((m, i) => Math.max(m, i.z), 0) + 1;
      const base = { id: newClientId('ni'), ...placeNewItem(items, w, h), w, h, z, text: '' };
      setDraft(kind === 'text' ? { ...base, kind } : { ...base, kind, color: STICKY_COLOUR });
      setEditingId(base.id);
    },
    commit: (id, text) => {
      setEditingId(null);
      if (draft !== null && draft.id === id) {
        setDraft(null);
        if (text.trim() !== '') run({ type: 'add-items', items: [{ ...draft, text }] });
      } else {
        const before = items.find((i) => i.id === id);
        if (before?.kind === 'text' || before?.kind === 'sticky') {
          run({ type: 'edit-text', itemId: id, before: before.text, after: text });
        }
      }
      focusItem(id);
    },
    move: (id, dx, dy) => run({ type: 'move', strokeIds: [], itemIds: [id], dx, dy }),
    remove: (id) => {
      const index = items.findIndex((i) => i.id === id);
      const value = items[index];
      if (value === undefined) return;
      const next = neighbourOf(items, id);
      run({ type: 'remove-items', removed: [{ value, index }] });
      focusItem(next);
    },
    undo: () => {
      const next = focusAfter(history?.past.at(-1), true, items);
      model.undo();
      if (next !== undefined) focusItem(next);
    },
    redo: () => {
      const next = focusAfter(history?.future.at(-1), false, items);
      model.redo();
      if (next !== undefined) focusItem(next);
    },
  };
  // Stable identities for the page's memoised items: each wrapper calls this render's action.
  const latest = useRef(actions);
  latest.current = actions;
  const stable = useMemo<Actions>(
    () => ({
      edit: (id) => latest.current.edit(id),
      startDraft: (kind) => latest.current.startDraft(kind),
      commit: (id, text) => latest.current.commit(id, text),
      move: (id, dx, dy) => latest.current.move(id, dx, dy),
      remove: (id) => latest.current.remove(id),
      undo: () => latest.current.undo(),
      redo: () => latest.current.redo(),
    }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || inField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') (e.shiftKey ? stable.redo : stable.undo)();
      else if (key === 'y') stable.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stable]);

  return { editingId, draft, ...stable };
}
