'use client';

/**
 * useItemSaver — saves a notebook page's items in the background and says, honestly, where that
 * stands (S5c, #208). Saves run one at a time PER ITEM and read the latest local state when they
 * run, so a burst of nudges costs one PATCH per round trip (10 quick nudges measured 3), and two
 * PATCHes of one item never race on `version`.
 *
 * Nothing stops silently. A 409 stops saving until reload (a conflict); a failure is kept until a
 * save of that item succeeds, and `retry` re-sends every failed item; a 422 is said once and never
 * retried; an item deleted elsewhere while it held unsaved changes is re-created, never dropped;
 * a page deleted elsewhere stops saving and offers the unsaved words to copy.
 *
 * Leaving: while the tab is hidden, writes use `keepalive` when they fit the browser's 64 KiB
 * budget. On `pagehide` every open editor commits first, then everything still owed goes out at
 * once in chunks under the budget (`model/leave.ts`), including a write queued behind one in
 * flight, sent with the version it will have; `beforeunload` warns while a write too big for any
 * keepalive request is unsaved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { commitOpenEditors, openEditorTexts } from './pageLeave';
import { releaseKeepalive, reserveKeepalive } from '../api/keepalive';
import { pushItem } from '../api/pushItem';
import { chunkWrites, needsLeaveWarning, opBytes, predictedAfter } from '../model/leave';
import { saveOp, savedFromWire } from '../model/save';

import type { PushResult } from '../api/pushItem';
import type { NotebookItemWire } from '../api/notebookApi';
import type { Write } from '../model/leave';
import type { Item } from '../model/page';
import type { SaveOp, SavedItem } from '../model/save';

/** Where saving stands. Every field is something the page shows. */
export interface SaveStatus {
  /** A 409: another tab or device changed this page. Saving has stopped until reload. */
  readonly conflict: boolean;
  /** The page itself was deleted somewhere else: nothing more can be saved. */
  readonly pageGone: boolean;
  /** Items whose last save failed; `retry` sends them again. */
  readonly failed: number;
  /** Bumped by every new failure, so a dismissed notice comes back for the next one. */
  readonly failure: number;
  /** The server's words for saves it refused (422); sending them again cannot help. */
  readonly rejected: readonly string[];
  /** Items deleted elsewhere that held unsaved changes, and were saved again from this page. */
  readonly recreated: number;
}

/** What the saver needs from the page. */
export interface SaverSource {
  /** The items on the page now. */
  readonly items: () => readonly Item[];
  /** An item's stored body (`wire.bodyOf`). */
  readonly body: (item: Item) => string;
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
  /** Items on the page that differ from what the server confirmed, counted now. */
  readonly unsaved: () => number;
  /** The words of unsaved notes and stickies, for "Copy text" when nothing can be saved. */
  readonly unsavedText: () => string;
}

const CLEAN: SaveStatus = {
  conflict: false,
  pageGone: false,
  failed: 0,
  failure: 0,
  rejected: [],
  recreated: 0,
};

/** A run re-checks after each save (the server may have kept an older row); this bounds it. */
const MAX_ROUNDS = 3;

/** What `beforeunload` says while a note too long for a keepalive request is unsaved. */
export const LONG_NOTE_WARNING = 'A long note has not been saved yet';

/**
 * The background saver of one page's items.
 *
 * @param pageId - The page.
 * @param source - The page's items.
 * @returns The saver.
 */
export function useItemSaver(pageId: string, source: SaverSource): ItemSaver {
  const [status, setStatus] = useState<SaveStatus>(CLEAN);
  // Bumped by every answer, so what is counted from the refs below is counted again.
  const [, setAnswers] = useState(0);
  const saved = useRef(new Map<string, SavedItem>());
  // The writes in flight per item, oldest first: a closing page may add one behind the queue's.
  const inflight = useRef(new Map<string, SaveOp[]>());
  const failed = useRef(new Set<string>());
  const queue = useRef(new Map<string, Promise<void>>());
  const pending = useRef(0);
  const stopped = useRef(false);
  const hidden = useRef(false);
  const leaving = useRef(false);
  const latest = useRef(source);
  latest.current = source;

  const local = useCallback((id: string) => latest.current.items().find((i) => i.id === id), []);
  const opFrom = useCallback(
    (id: string, base: SavedItem | undefined) => {
      const item = local(id);
      return saveOp(base, item, item ? latest.current.body(item) : '');
    },
    [local],
  );

  /** Marks a write as in flight, so a write added behind it is predicted past it. */
  const claim = useCallback((id: string, op: SaveOp): void => {
    inflight.current.set(id, [...(inflight.current.get(id) ?? []), op]);
  }, []);
  const release = useCallback((id: string, op: SaveOp): void => {
    const rest = (inflight.current.get(id) ?? []).filter((o) => o !== op);
    if (rest.length === 0) inflight.current.delete(id);
    else inflight.current.set(id, rest);
  }, []);

  /**
   * Sends one claimed write, with keepalive while the page is hidden or closing and the budget
   * allows it.
   */
  const send = useCallback(
    async (id: string, op: SaveOp, allowKeepalive: boolean): Promise<PushResult> => {
      const bytes = opBytes(op);
      // One budget with the ink's saver (`api/keepalive`): the browser counts every request.
      const keepalive = allowKeepalive && reserveKeepalive(bytes);
      try {
        return await pushItem(pageId, id, op, { keepalive });
      } finally {
        release(id, op);
        if (keepalive) releaseKeepalive(bytes);
      }
    },
    [pageId, release],
  );

  /** Records an answer; returns true when the item should be looked at again. */
  const handle = useCallback((id: string, result: PushResult): boolean => {
    setAnswers((n) => n + 1);
    switch (result.kind) {
      case 'saved':
        saved.current.set(id, result.saved);
        return true;
      case 'deleted':
        saved.current.delete(id);
        return true;
      case 'gone':
        // Deleted elsewhere while this page still had changes to it: forgetting the server copy
        // makes the next round create it again, so the person's words are never dropped.
        saved.current.delete(id);
        setStatus((s) => ({ ...s, recreated: s.recreated + 1 }));
        return true;
      case 'conflict':
      case 'pageGone':
        stopped.current = true;
        setStatus((s) => ({ ...s, [result.kind]: true }));
        return false;
      case 'rejected':
        failed.current.delete(id);
        setStatus((s) => ({
          ...s,
          failed: failed.current.size,
          rejected: [...s.rejected, result.detail],
        }));
        return false;
      case 'failed':
        failed.current.add(id);
        setStatus((s) => ({ ...s, failed: failed.current.size, failure: s.failure + 1 }));
        return false;
    }
  }, []);

  const saveItem = useCallback(
    async (id: string): Promise<void> => {
      for (let round = 0; round < MAX_ROUNDS && !stopped.current; round += 1) {
        const op = opFrom(id, saved.current.get(id));
        if (op === null) break;
        claim(id, op);
        if (!handle(id, await send(id, op, hidden.current || leaving.current))) return;
      }
      if (failed.current.delete(id)) setStatus((s) => ({ ...s, failed: failed.current.size }));
    },
    [opFrom, handle, send, claim],
  );

  /** What the page still owes, item by item, as it will stand once the writes in flight land. */
  const owed = useCallback(
    (ids?: readonly string[]): Write[] => {
      const all = ids ?? [
        ...new Set([...saved.current.keys(), ...latest.current.items().map((i) => i.id)]),
      ];
      return all.flatMap((id) => {
        const op = opFrom(
          id,
          predictedAfter(saved.current.get(id), inflight.current.get(id) ?? []),
        );
        return op === null ? [] : [{ id, op, bytes: opBytes(op) }];
      });
    },
    [opFrom],
  );

  /** The page is closing: send everything owed now, chunk by chunk under the keepalive budget. */
  const flush = useCallback(
    (ids?: readonly string[]) => {
      if (stopped.current) return;
      const { chunks, oversize } = chunkWrites(owed(ids));
      // Claimed at once, so a second flush in the same pagehide (an editor's commit, then the
      // rest) predicts past these writes instead of sending them again.
      for (const w of [...chunks.flat(), ...oversize]) claim(w.id, w.op);
      const sendAll = (writes: readonly Write[], keepalive: boolean) =>
        Promise.all(writes.map(async (w) => handle(w.id, await send(w.id, w.op, keepalive))));
      // The first chunk goes out now, inside pagehide; the next ones as the budget frees up, which
      // only a page that stays alive (back from the cache) will see.
      const [first = [], ...rest] = chunks;
      const sent = sendAll(first, true);
      void rest.reduce<Promise<unknown>>((prev, c) => prev.then(() => sendAll(c, true)), sent);
      // Too big for any keepalive request: best effort, and `beforeunload` warned about these.
      void sendAll(oversize, false);
    },
    [owed, handle, send, claim],
  );

  const sync = useCallback(
    (ids: readonly string[]) => {
      if (leaving.current) {
        flush(ids);
        return;
      }
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
    [saveItem, flush],
  );

  useLeaveListeners({ hidden, leaving, flush, owed });

  const seed = useCallback((items: readonly NotebookItemWire[]) => {
    saved.current = new Map(items.map((w) => [w.item_id, savedFromWire(w)]));
  }, []);

  // What is NOT confirmed by the server, counting a write still in flight as unsaved until it lands.
  const unconfirmed = useCallback(
    () =>
      [...new Set([...saved.current.keys(), ...latest.current.items().map((i) => i.id)])].filter(
        (id) => opFrom(id, saved.current.get(id)) !== null,
      ),
    [opFrom],
  );
  const unsaved = useCallback((): number => unconfirmed().length, [unconfirmed]);
  const unsavedText = useCallback(
    () =>
      unconfirmed()
        .flatMap((id) => {
          const item = local(id);
          return item?.kind === 'text' || item?.kind === 'sticky' ? [item.text] : [];
        })
        .join('\n\n'),
    [unconfirmed, local],
  );

  const retry = useCallback(() => sync([...failed.current]), [sync]);

  return { status, seed, sync, retry, unsaved, unsavedText };
}

/**
 * The page-lifecycle listeners: a hidden tab sends with keepalive; `pagehide` commits every open
 * editor and flushes; `pageshow` (back from the cache) resumes normal saving; `beforeunload` warns
 * while a write too big for keepalive is unsaved.
 */
function useLeaveListeners(refs: {
  hidden: { current: boolean };
  leaving: { current: boolean };
  flush: () => void;
  owed: () => Write[];
}): void {
  const latest = useRef(refs);
  latest.current = refs;
  useEffect(() => {
    const visibility = (): void => {
      latest.current.hidden.current = document.visibilityState === 'hidden';
    };
    const pagehide = (): void => {
      latest.current.leaving.current = true;
      commitOpenEditors(); // their commits go straight into the flush (`sync` while leaving)
      latest.current.flush();
    };
    const pageshow = (): void => {
      latest.current.leaving.current = false;
    };
    const beforeunload = (e: BeforeUnloadEvent): void => {
      const editors = openEditorTexts().map((t) =>
        opBytes({ kind: 'patch', body: { version: 1, body: t } }),
      );
      const writes = latest.current.owed().map((w) => w.bytes);
      if (!needsLeaveWarning([...writes, ...editors])) return;
      e.preventDefault();
      e.returnValue = LONG_NOTE_WARNING;
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('beforeunload', beforeunload);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('beforeunload', beforeunload);
    };
  }, []);
}
