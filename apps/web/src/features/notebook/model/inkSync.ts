/**
 * What to send so the server holds the page's ink (S5d, #209). Strokes are immutable and their
 * create is idempotent on `stroke_id`, so there is no version to carry: the page compares the ids
 * the server confirmed with the strokes on the page, POSTs the missing ones in batches and DELETEs
 * the ones no longer there. Pure: `useStrokeSaver` owns the network.
 */
import type { Stroke } from './stroke';

/** The writes that bring the server in line with the page. */
export interface StrokeWrites {
  /** On the page, not on the server: POST them, in paint order. */
  readonly add: readonly Stroke[];
  /** On the server, not on the page (erased, or a drawing undone): DELETE them. */
  readonly remove: readonly string[];
}

/**
 * The difference between the server and the page.
 *
 * @param server - Stroke ids the server confirmed (plus those a write in flight will add).
 * @param local - The strokes on the page now.
 * @param refused - Ids the server refused (422/413): sending them again cannot help.
 * @returns What to add and what to remove.
 */
export function strokeWrites(
  server: ReadonlySet<string>,
  local: readonly Stroke[],
  refused: ReadonlySet<string> = new Set(),
): StrokeWrites {
  const here = new Set(local.map((s) => s.id));
  return {
    add: local.filter((s) => !server.has(s.id) && !refused.has(s.id)),
    remove: [...server].filter((id) => !here.has(id)),
  };
}

/** Most strokes in one POST (`NotebookStrokeBatch`, schemas.py). */
export const MAX_BATCH_STROKES = 200;

/** Most bytes in one POST: the store's 2 MiB of decoded points, counted as JSON (always more). */
export const MAX_BATCH_BYTES = 2 * 1024 * 1024;

/** A value and the bytes it adds to a request body. */
export interface Sized<T> {
  readonly value: T;
  readonly bytes: number;
}

/**
 * The batching rule: in order, a new batch whenever the next stroke would pass the count or the
 * byte cap. A stroke over the byte cap on its own goes alone (the caller then knows it cannot ride
 * a keepalive request). Strokes drawn while a batch is in flight join the next one, so a fast
 * writer costs one request per round trip, not one per stroke.
 *
 * @param items - The strokes' request entries with their sizes.
 * @param maxBytes - Bytes allowed in one request.
 * @param maxCount - Strokes allowed in one request.
 * @returns The batches, in order; empty for no strokes.
 * @example
 * batches([{ value: a, bytes: 40 }, { value: b, bytes: 40 }], 60); // [[a], [b]]
 */
export function batches<T>(
  items: readonly Sized<T>[],
  maxBytes: number,
  maxCount: number = MAX_BATCH_STROKES,
): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const { value, bytes } of items) {
    if (current.length > 0 && (current.length >= maxCount || used + bytes > maxBytes)) {
      out.push(current);
      current = [];
      used = 0;
    }
    current.push(value);
    used += bytes;
  }
  if (current.length > 0) out.push(current);
  return out;
}
