'use client';

/**
 * useDeleteUndo — a delete on the phone says so, with Undo (S5e, #210, DESIGN.md §3's toast with
 * Undo). A phone has no keyboard for Ctrl+Z and its bar shows Undo only while a drawing tool is
 * held, so every delete there, whatever is in the hand, leaves a toast whose Undo is the history's
 * undo. The toast goes as soon as anything else joins the history: its Undo must undo the delete.
 */
import { useMemo, useRef, useState } from 'react';

import type { PageNotice } from '../components/PageToast';
import type { Item } from '../model/page';

/** What `useDeleteUndo` returns. */
export interface DeleteUndo {
  /** Deletes the item; on the phone, then offers Undo. One identity for the page's lifetime. */
  readonly remove: (id: string) => void;
  /** The toast, while the delete is the last thing done; null otherwise. */
  readonly notice: PageNotice | null;
}

/** What a deleted item is called in the toast. */
const NOUN: Readonly<Record<Item['kind'], string>> = {
  text: 'Typed note',
  sticky: 'Sticky note',
  shape: 'Shape',
  quote: 'Quote card',
  exchange: 'Exchange',
};

/**
 * Deletes with an Undo toast where the layout has no other Undo in view.
 *
 * @param on - True on the phone.
 * @param items - The page's items now.
 * @param last - The history's newest command now (its identity; the history is capped, so its
 *   length says nothing once full).
 * @param editing - The page's `remove` and `undo`.
 * @returns The wrapped `remove` and the toast.
 */
export function useDeleteUndo(
  on: boolean,
  items: readonly Item[],
  last: unknown,
  editing: { readonly remove: (id: string) => void; readonly undo: () => void },
): DeleteUndo {
  const [deleted, setDeleted] = useState<{ key: number; noun: string; before: unknown } | null>(
    null,
  );
  // The delete's own command: the first newest command seen after the one it found.
  const command = useRef<unknown>(undefined);
  if (deleted !== null && command.current === undefined && last !== deleted.before) {
    command.current = last;
  }
  const latest = useRef({ on, items, last, editing });
  latest.current = { on, items, last, editing };
  // Stable, as the page's memoised notes keep the first callback they were given.
  const remove = useMemo(
    () => (id: string) => {
      const now = latest.current;
      const item = now.items.find((i) => i.id === id);
      now.editing.remove(id);
      if (now.on && item !== undefined) {
        command.current = undefined;
        setDeleted({ key: Date.now(), noun: NOUN[item.kind], before: now.last });
      }
    },
    [],
  );
  const notice =
    deleted === null || command.current === undefined || last !== command.current
      ? null
      : {
          key: deleted.key,
          message: `${deleted.noun} deleted.`,
          undo: () => {
            setDeleted(null);
            editing.undo();
          },
          onDismiss: () => setDeleted(null),
        };
  return { remove, notice };
}
