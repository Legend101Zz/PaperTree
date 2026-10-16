'use client';

/**
 * useStrokeSaver — saves a notebook page's ink in the background (S5d, #209) by the item saver's
 * rules (`useItemSaver`): nothing stops silently, and nothing erased comes back. Strokes carry no
 * version (they are immutable and their create is idempotent on `stroke_id`), so the saver keeps a
 * ledger of ids (`model/inkLedger`): a pen-up's stroke goes out at once, strokes drawn while a batch
 * is in flight join the next one, erased or undone strokes are DELETEd, and so is one whose failed
 * POST may have reached the server. A failure is counted while its stroke is still owed (undoing the
 * stroke clears it); a 422/413 is said once and the stroke is never sent again; a POST answered 404
 * is the page deleted elsewhere (`api/pushStrokes`). Leaving (`useInkLeave`): while the tab is
 * hidden batches use keepalive within what is left of the shared budget (`api/keepalive`); on
 * `pagehide` every request starts at once, with keepalive for what fits; `beforeunload` warns when
 * what the page's savers owe together cannot all go.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isLeaving,
  keepaliveLeft,
  leavingWouldLose,
  owesOnLeave,
  releaseKeepalive,
  reserveKeepalive,
  setLeaving,
} from '../api/keepalive';
import { bodyBytes, deleteOne, postBatch } from '../api/pushStrokes';
import { InkLedger } from '../model/inkLedger';
import { MAX_BATCH_BYTES, MAX_BATCH_STROKES, batches } from '../model/inkSync';
import { KEEPALIVE_CAP } from '../model/leave';
import { strokeToWire } from '../model/wire';

import type { NotebookStrokeIn } from '../api/notebookApi';
import type { Sized, StrokeWrites } from '../model/inkSync';
import type { Stroke } from '../model/stroke';

/** Where saving the ink stands; merged into the page's one `SaveNotice`. */
export interface InkSaveStatus {
  /** Strokes whose last send failed and that are still owed. */
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

/** What `beforeunload` says while some ink could not go with the page. */
export const LONG_STROKE_WARNING = 'Some ink has not been saved yet';

const CLEAN: InkSaveStatus = { failed: 0, failure: 0, rejected: [], pageGone: false };

/**
 * A stroke as sent, with what it adds to a POST's body: its JSON and a comma.
 *
 * @param s - The stroke.
 * @returns Its wire row and that size in bytes.
 */
const sized = (s: Stroke): Sized<NotebookStrokeIn> => {
  const value = strokeToWire(s);
  return { value, bytes: bodyBytes([value]) - 1 };
};

/**
 * Splits the strokes owed at `pagehide` into what fits the keepalive budget left, in order, and
 * the rest.
 *
 * @param owed - The strokes, sized.
 * @param room - Bytes of keepalive budget left.
 * @returns The strokes that fit (each batch's brackets counted) and those that do not.
 */
function fitBudget(owed: readonly Sized<NotebookStrokeIn>[], room: number) {
  let [left, n] = [room, 0];
  for (const s of owed) {
    const cost = s.bytes + (n % MAX_BATCH_STROKES === 0 ? 1 : 0);
    if (cost > left) break;
    left -= cost;
    n += 1;
  }
  return { fit: owed.slice(0, n), rest: owed.slice(n) };
}

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
  const ledger = useRef(new InkLedger());
  const flags = useRef({ running: false, again: false, stopped: false, hidden: false });
  const latest = useRef({ strokes, onSettled });
  latest.current = { strokes, onSettled };

  const writes = useCallback(() => ledger.current.writes(latest.current.strokes()), []);
  const report = useCallback((bump: boolean, rejected: readonly string[] = []) => {
    const failed = ledger.current.failed;
    setStatus((s) =>
      !bump && rejected.length === 0 && s.failed === failed
        ? s
        : {
            ...s,
            failed,
            failure: s.failure + (bump ? 1 : 0),
            rejected: [...s.rejected, ...rejected],
          },
    );
  }, []);

  const post = useCallback(
    async (batch: readonly NotebookStrokeIn[], keep: boolean): Promise<boolean> => {
      const bytes = bodyBytes(batch);
      const keepalive = keep && reserveKeepalive(bytes);
      try {
        const o = await postBatch(pageId, batch, keepalive);
        ledger.current.posted(o);
        if (o.pageGone) {
          flags.current.stopped = true;
          setStatus((s) => ({ ...s, pageGone: true }));
        } else
          report(
            o.failed.length > 0,
            o.refused.map((r) => r.detail),
          );
        return o.failed.length === 0;
      } finally {
        if (keepalive) releaseKeepalive(bytes);
      }
    },
    [pageId, report],
  );
  const remove = useCallback(
    async (id: string, keep: boolean): Promise<boolean> => {
      const gone = await deleteOne(pageId, id, keep);
      ledger.current.deleted(id, gone);
      report(!gone);
      return gone;
    },
    [pageId, report],
  );

  /** Sends one round of writes; true when every one landed. */
  const send = useCallback(
    async (w: StrokeWrites, keep: boolean): Promise<boolean> => {
      const removals = Promise.all(w.remove.map((id) => remove(id, keep)));
      // While hidden, batches are cut to what the shared budget has left (`api/keepalive`).
      const cap = keep ? Math.min(KEEPALIVE_CAP, Math.max(1, keepaliveLeft())) : MAX_BATCH_BYTES;
      let ok = true;
      for (const batch of batches(w.add.map(sized), cap)) {
        if (!(await post(batch, keep))) ok = false;
        if (flags.current.stopped) break;
      }
      return (await removals).every(Boolean) && ok;
    },
    [post, remove],
  );

  const sync = useCallback(() => {
    const f = flags.current;
    if (isLeaving()) return; // `pagehide` sends everything owed at once (`flush`)
    if (f.running) {
      f.again = true;
      return;
    }
    f.running = true;
    void (async () => {
      let sent = false;
      try {
        for (;;) {
          f.again = false;
          const w = writes();
          ledger.current.prune(w); // an undone stroke that never landed is no longer a failure
          report(false);
          if (f.stopped || w.add.length + w.remove.length === 0) break;
          sent = true;
          const ok = await send(w, f.hidden).catch(() => {
            ledger.current.posted({ ...NOTHING, failed: w.add.map((s) => s.id) }); // encoder refused
            report(true);
            return false;
          });
          setAnswers((n) => n + 1);
          if (!ok && !f.again) break;
        }
      } finally {
        f.running = false;
        if (sent) latest.current.onSettled?.();
      }
    })();
  }, [writes, send, report]);

  /** `pagehide`: every request starts now, inside the event; none waits on another. */
  const flush = useCallback(() => {
    if (flags.current.stopped) return;
    const w = writes();
    for (const id of w.remove) void remove(id, true); // a DELETE has no body: no budget
    const { fit, rest } = fitBudget(w.add.map(sized), keepaliveLeft());
    for (const batch of batches(fit, KEEPALIVE_CAP)) void post(batch, true);
    // More than the budget has left: best effort, and `beforeunload` warned about it.
    for (const batch of batches(rest, MAX_BATCH_BYTES)) void post(batch, false);
  }, [writes, remove, post]);

  const owedBytes = useCallback((): number => {
    const add = writes().add.map(sized);
    return add.length === 0 ? 0 : add.reduce((n, s) => n + s.bytes, 1);
  }, [writes]);
  useInkLeave({ flags, sync, flush, owedBytes });

  const seed = useCallback((ids: readonly string[]) => ledger.current.seed(ids), []);
  const unsaved = useCallback(() => ledger.current.unsaved(latest.current.strokes()), []);
  return { status, seed, sync, unsaved };
}

const NOTHING = { saved: [], refused: [], failed: [], uncertain: [], pageGone: false };

/**
 * The ink's page-lifecycle listeners: a hidden tab sends with keepalive; `pagehide` marks the page
 * as leaving (a last command's sync then waits for the flush) and flushes; `pageshow` (back from
 * the cache) resumes; `beforeunload` warns when what the savers owe together cannot all go.
 *
 * @param refs - The saver's flags, its `sync`, `flush` and owed body bytes.
 */
function useInkLeave(refs: {
  flags: { current: { hidden: boolean } };
  sync: () => void;
  flush: () => void;
  owedBytes: () => number;
}): void {
  const latest = useRef(refs);
  latest.current = refs;
  useEffect(() => {
    setLeaving(false); // a page that mounts is not being left
    const unregister = owesOnLeave(() => latest.current.owedBytes());
    const visibility = (): void => {
      latest.current.flags.current.hidden = document.visibilityState === 'hidden';
      if (latest.current.flags.current.hidden) latest.current.sync();
    };
    const pagehide = (): void => {
      setLeaving(true);
      latest.current.flush();
    };
    const pageshow = (): void => setLeaving(false);
    const beforeunload = (e: BeforeUnloadEvent): void => {
      if (latest.current.owedBytes() === 0 || !leavingWouldLose()) return;
      e.preventDefault();
      e.returnValue = LONG_STROKE_WARNING;
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('beforeunload', beforeunload);
    return () => {
      unregister();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('beforeunload', beforeunload);
    };
  }, []);
}
