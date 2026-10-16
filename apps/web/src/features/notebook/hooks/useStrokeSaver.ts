'use client';

/**
 * useStrokeSaver — saves a notebook page's ink in the background (S5d, #209) by the item saver's
 * rules (`useItemSaver`): nothing stops silently. Strokes carry no version (they are immutable and
 * their create is idempotent on `stroke_id`), so the saver compares ids (`model/inkSync.ts`): a
 * pen-up's stroke goes out at once, strokes drawn while a batch is in flight join the next one,
 * erased or undone strokes are DELETEd. A failure keeps them owed and counted until a send
 * succeeds (Try again, or the next stroke); a 422/413 is said once and that stroke is never sent
 * again; a POST answered 404 is the page deleted elsewhere. While the tab is hidden, and on
 * `pagehide`, batches are cut to the shared keepalive budget (`api/keepalive`) and sent with
 * keepalive; `beforeunload` warns while a stroke too big for any keepalive request is owed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/types';

import { releaseKeepalive, reserveKeepalive } from '../api/keepalive';
import { notebookApi } from '../api/notebookApi';
import { MAX_BATCH_BYTES, batches, strokeWrites } from '../model/inkSync';
import { KEEPALIVE_CAP } from '../model/leave';
import { strokeToWire } from '../model/wire';

import type { NotebookStrokeIn } from '../api/notebookApi';
import type { StrokeWrites } from '../model/inkSync';
import type { Stroke } from '../model/stroke';

/** Where saving the ink stands; merged into the page's one `SaveNotice`. */
export interface InkSaveStatus {
  /** Strokes whose last send failed; they are still owed. */
  readonly failed: number;
  /** Bumped by every new failure, so a dismissed notice comes back for the next one. */
  readonly failure: number;
  /** The server's words for strokes it refused (422/413). */
  readonly rejected: readonly string[];
  /** A POST answered 404: the page was deleted elsewhere. */
  readonly pageGone: boolean;
}

/** What `useStrokeSaver` returns. */
export interface StrokeSaver {
  readonly status: InkSaveStatus;
  /** Take the loaded strokes as the server's. */
  readonly seed: (ids: readonly string[]) => void;
  /** Send what the server lacks (after every command; also Try again). */
  readonly sync: () => void;
  /** Strokes the server does not hold as the page shows them, counted now. */
  readonly unsaved: () => number;
}

/** What `beforeunload` says while a stroke too big for keepalive is owed. */
export const LONG_STROKE_WARNING = 'A long stroke has not been saved yet';

const CLEAN: InkSaveStatus = { failed: 0, failure: 0, rejected: [], pageGone: false };

const bytesOf = (w: NotebookStrokeIn): number => JSON.stringify(w).length + 1;
const sized = (s: Stroke) => {
  const value = strokeToWire(s);
  return { value, bytes: bytesOf(value) };
};

/**
 * The background saver of one page's strokes.
 *
 * @param pageId - The page.
 * @param strokes - Reads the strokes on the page now.
 * @param onSettled - Called once a burst of sends has landed (the panel's "Ink" count follows).
 * @returns The saver.
 */
export function useStrokeSaver(
  pageId: string,
  strokes: () => readonly Stroke[],
  onSettled?: () => void,
): StrokeSaver {
  const [status, setStatus] = useState<InkSaveStatus>(CLEAN);
  const [, setAnswers] = useState(0);
  const server = useRef(new Set<string>());
  const refused = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  const running = useRef(false);
  const again = useRef(false);
  const stopped = useRef(false);
  const hidden = useRef(false);
  const latest = useRef({ strokes, onSettled });
  latest.current = { strokes, onSettled };

  const fail = useCallback((ids: readonly string[]) => {
    for (const id of ids) failed.current.add(id);
    setStatus((s) => ({ ...s, failed: failed.current.size, failure: s.failure + 1 }));
  }, []);
  const landed = useCallback((ids: readonly string[], kept: boolean) => {
    for (const id of ids) {
      if (kept) server.current.add(id);
      else server.current.delete(id);
      failed.current.delete(id);
    }
    setStatus((s) =>
      s.failed === failed.current.size ? s : { ...s, failed: failed.current.size },
    );
  }, []);

  /** One POST; a refused batch of several is sent again one by one, so only the bad one is lost. */
  const post = useCallback(
    (batch: readonly NotebookStrokeIn[], keep: boolean): Promise<boolean> => {
      const attempt = async (b: readonly NotebookStrokeIn[]): Promise<boolean> => {
        const ids = b.map((w) => w.stroke_id);
        const bytes = b.reduce((n, w) => n + bytesOf(w), 0);
        const keepalive = keep && reserveKeepalive(bytes);
        try {
          await notebookApi.addStrokes(pageId, b, { keepalive });
          landed(ids, true);
          return true;
        } catch (error) {
          const code = error instanceof ApiError ? error.status : 0;
          if (code === 404) {
            stopped.current = true;
            setStatus((s) => ({ ...s, pageGone: true }));
            return false;
          }
          if ((code === 422 || code === 413) && b.length > 1) {
            const each = [];
            for (const w of b) each.push(await attempt([w]));
            return each.every(Boolean);
          }
          if (code === 422 || code === 413) {
            for (const id of ids) refused.current.add(id);
            landed(ids, false);
            setStatus((s) => ({ ...s, rejected: [...s.rejected, (error as ApiError).detail] }));
            return true;
          }
          fail(ids);
          return false;
        } finally {
          if (keepalive) releaseKeepalive(bytes);
        }
      };
      return attempt(batch);
    },
    [pageId, landed, fail],
  );

  const remove = useCallback(
    async (id: string, keep: boolean): Promise<boolean> => {
      try {
        await notebookApi.deleteStroke(pageId, id, { keepalive: keep });
      } catch (error) {
        // Already gone is the state the person asked for.
        if (!(error instanceof ApiError && error.status === 404)) {
          fail([id]);
          return false;
        }
      }
      landed([id], false);
      return true;
    },
    [pageId, landed, fail],
  );

  /** Sends one round of writes; true when every one landed. */
  const send = useCallback(
    async (w: StrokeWrites, keep: boolean): Promise<boolean> => {
      const cut = batches(w.add.map(sized), keep ? KEEPALIVE_CAP : MAX_BATCH_BYTES);
      const removals = Promise.all(w.remove.map((id) => remove(id, keep)));
      let ok = true;
      for (const batch of cut) {
        if (!(await post(batch, keep))) ok = false;
        if (stopped.current) break;
      }
      return (await removals).every(Boolean) && ok;
    },
    [post, remove],
  );

  const sync = useCallback(() => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    void (async () => {
      let sent = false;
      try {
        for (;;) {
          again.current = false;
          const w = strokeWrites(server.current, latest.current.strokes(), refused.current);
          if (stopped.current || w.add.length + w.remove.length === 0) break;
          sent = true;
          const ok = await send(w, hidden.current).catch(() => {
            fail(w.add.map((s) => s.id)); // a stroke the encoder refuses: owed, and said so
            return false;
          });
          setAnswers((n) => n + 1);
          if (!ok && !again.current) break;
        }
      } finally {
        running.current = false;
        if (sent) latest.current.onSettled?.();
      }
    })();
  }, [send, fail]);

  useEffect(() => {
    const visibility = (): void => {
      hidden.current = document.visibilityState === 'hidden';
      if (hidden.current) sync();
    };
    // Closing: everything owed goes now, with keepalive; a duplicate of a POST in flight is
    // harmless (idempotent on stroke_id) and a DELETE of a stroke already gone answers 404.
    const pagehide = (): void => {
      if (!stopped.current) {
        void send(strokeWrites(server.current, latest.current.strokes(), refused.current), true);
      }
    };
    const beforeunload = (e: BeforeUnloadEvent): void => {
      const { add } = strokeWrites(server.current, latest.current.strokes(), refused.current);
      if (!add.some((s) => sized(s).bytes > KEEPALIVE_CAP)) return;
      e.preventDefault();
      e.returnValue = LONG_STROKE_WARNING;
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('beforeunload', beforeunload);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('beforeunload', beforeunload);
    };
  }, [sync, send]);

  const seed = useCallback((ids: readonly string[]) => {
    server.current = new Set(ids);
  }, []);
  const unsaved = useCallback(() => {
    const w = strokeWrites(server.current, latest.current.strokes());
    return w.add.length + w.remove.length;
  }, []);

  return { status, seed, sync, unsaved };
}
