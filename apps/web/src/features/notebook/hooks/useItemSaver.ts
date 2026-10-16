'use client';

/**
 * useItemSaver — saves a notebook page's items in the background and says, honestly, where that
 * stands (S5c, #208). Saves run one at a time PER ITEM and read the latest local state when they
 * run, so a burst of nudges costs one PATCH per round trip (10 quick nudges measured 3), and two
 * PATCHes of one item never race on `version`.
 *
 * Nothing stops silently. A 409 stops saving for good and is a conflict until reload; a failure is
 * counted and kept until a save of that item succeeds; `retry` re-sends every failed item; a 422 is
 * a refusal that is never retried; a 404 means the item was deleted elsewhere. While the page is
 * being left (`pagehide`, or the tab hidden) writes go out with `keepalive` so they outlive it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { pushItem } from '../api/pushItem';
import { saveOp, savedFromWire } from '../model/save';

import type { NotebookItemWire } from '../api/notebookApi';
import type { Item } from '../model/page';
import type { SavedItem } from '../model/save';

/** Where saving stands. Every field is something the page shows. */
export interface SaveStatus {
  /** A 409: another tab or device changed this page. Saving has stopped until reload. */
  readonly conflict: boolean;
  /** Items whose last save failed; `retry` sends them again. */
  readonly failed: number;
  /** Bumped by every new failure, so a dismissed notice comes back for the next one. */
  readonly failure: number;
  /** The server's words for saves it refused (422); sending them again cannot help. */
  readonly rejected: readonly string[];
  /** Items dropped because they were deleted somewhere else. */
  readonly gone: number;
}

/** What the saver needs from the page. */
export interface SaverSource {
  /** The items on the page now. */
  readonly items: () => readonly Item[];
  /** An item's stored body (`wire.bodyOf`). */
  readonly body: (item: Item) => string;
  /** The server no longer has this item (deleted elsewhere): drop it from the page. */
  readonly onGone: (id: string) => void;
  /** Called once a burst of saves has landed (to refresh counts). */
  readonly onSettled?: () => void;
}

/** What `useItemSaver` returns. */
export interface ItemSaver {
  readonly status: SaveStatus;
  /** Take the server's state as the confirmed one (after the page loads). */
  readonly seed: (items: readonly NotebookItemWire[]) => void;
  /** Save these items. */
  readonly sync: (ids: readonly string[]) => void;
  /** Send every failed item again. */
  readonly retry: () => void;
  /** How many items on the page differ from what the server confirmed. */
  readonly unsaved: () => number;
}

const CLEAN: SaveStatus = { conflict: false, failed: 0, failure: 0, rejected: [], gone: 0 };

/** Each run re-checks after a save, in case the server kept an older row; this bounds the loop. */
const MAX_ROUNDS = 3;

/**
 * The background saver of one page's items.
 *
 * @param pageId - The page.
 * @param source - The page's items and what to do when one is gone.
 * @returns The saver.
 */
export function useItemSaver(pageId: string, source: SaverSource): ItemSaver {
  const [status, setStatus] = useState<SaveStatus>(CLEAN);
  const saved = useRef(new Map<string, SavedItem>());
  const failed = useRef(new Set<string>());
  const queue = useRef(new Map<string, Promise<void>>());
  const pending = useRef(0);
  const stopped = useRef(false);
  const leaving = useRef(false);
  const latest = useRef(source);
  latest.current = source;

  useEffect(() => {
    const away = (): void => {
      leaving.current = document.visibilityState === 'hidden';
    };
    const gone = (): void => {
      leaving.current = true;
    };
    const back = (): void => {
      leaving.current = false; // restored from the back-forward cache
    };
    document.addEventListener('visibilitychange', away);
    window.addEventListener('pagehide', gone);
    window.addEventListener('pageshow', back);
    return () => {
      document.removeEventListener('visibilitychange', away);
      window.removeEventListener('pagehide', gone);
      window.removeEventListener('pageshow', back);
    };
  }, []);

  const opFor = useCallback((id: string) => {
    const local = latest.current.items().find((i) => i.id === id);
    return saveOp(saved.current.get(id), local, local ? latest.current.body(local) : '');
  }, []);

  const saveItem = useCallback(
    async (id: string): Promise<void> => {
      for (let round = 0; round < MAX_ROUNDS && !stopped.current; round += 1) {
        const op = opFor(id);
        if (op === null) break;
        const result = await pushItem(pageId, id, op, { keepalive: leaving.current });
        if (result.kind === 'saved') saved.current.set(id, result.saved);
        else if (result.kind === 'deleted') saved.current.delete(id);
        else if (result.kind === 'conflict') {
          stopped.current = true;
          setStatus((s) => ({ ...s, conflict: true }));
          return;
        } else if (result.kind === 'gone') {
          saved.current.delete(id);
          latest.current.onGone(id);
          setStatus((s) => ({ ...s, gone: s.gone + 1 }));
          break;
        } else if (result.kind === 'rejected') {
          setStatus((s) => ({ ...s, rejected: [...s.rejected, result.detail] }));
          return;
        } else {
          failed.current.add(id);
          setStatus((s) => ({ ...s, failed: failed.current.size, failure: s.failure + 1 }));
          return;
        }
      }
      if (failed.current.delete(id)) setStatus((s) => ({ ...s, failed: failed.current.size }));
    },
    [pageId, opFor],
  );

  const sync = useCallback(
    (ids: readonly string[]) => {
      for (const id of ids) {
        pending.current += 1;
        const next = (queue.current.get(id) ?? Promise.resolve()).then(() => saveItem(id));
        queue.current.set(
          id,
          next.finally(() => {
            pending.current -= 1;
            if (pending.current === 0) latest.current.onSettled?.();
          }),
        );
      }
    },
    [saveItem],
  );

  const seed = useCallback((items: readonly NotebookItemWire[]) => {
    saved.current = new Map(items.map((w) => [w.item_id, savedFromWire(w)]));
  }, []);

  const unsaved = useCallback((): number => {
    const ids = new Set([...saved.current.keys(), ...latest.current.items().map((i) => i.id)]);
    return [...ids].filter((id) => opFor(id) !== null).length;
  }, [opFor]);

  const retry = useCallback(() => sync([...failed.current]), [sync]);

  return { status, seed, sync, retry, unsaved };
}
