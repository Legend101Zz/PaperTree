/**
 * What to send while the page is being left (S5c, #208). Browsers let `keepalive` requests outlive
 * the page, but cap the bodies of ALL keepalive requests in flight at 64 KiB together; a request
 * past the cap is refused outright ("Failed to fetch"). So the leaving writes go out in chunks under
 * the cap, one request per item, and a write that alone is over the cap can never go that way: the
 * page warns before it closes instead. Pure: the saver owns the network.
 */
import type { SaveOp, SavedItem } from './save';

/** Our share of the browser's 64 KiB keepalive budget, leaving room for anything else in flight. */
export const KEEPALIVE_CAP = 60 * 1024;

/** One write the page still owes the server. */
export interface Write {
  readonly id: string;
  readonly op: SaveOp;
  /** The request body's size in bytes (UTF-8). */
  readonly bytes: number;
}

const encoder = new TextEncoder();

/**
 * The size of a write's request body, as the browser counts it against the keepalive budget.
 *
 * @param op - A save operation.
 * @returns Bytes of its JSON body (0 for a delete, which has none).
 */
export function opBytes(op: SaveOp): number {
  return op.kind === 'delete' ? 0 : encoder.encode(JSON.stringify(op.body)).length;
}

/**
 * Splits the leaving writes into chunks whose bodies fit the cap together, in order; a write that
 * alone is over the cap is put aside, because no keepalive request can carry it.
 *
 * @param writes - The writes, in the order they should go.
 * @param cap - Bytes allowed in flight at once.
 * @returns The chunks (send one, then the next) and the writes too big for any chunk.
 * @example
 * // 40 KB, 40 KB, 10 KB and 70 KB bodies under a 60 KB cap, in order:
 * chunkWrites([a, b, c, d]); // { chunks: [[a], [b, c]], oversize: [d] }
 */
export function chunkWrites(
  writes: readonly Write[],
  cap: number = KEEPALIVE_CAP,
): { chunks: Write[][]; oversize: Write[] } {
  const chunks: Write[][] = [];
  const oversize: Write[] = [];
  let current: Write[] = [];
  let used = 0;
  for (const w of writes) {
    if (w.bytes > cap) {
      oversize.push(w);
      continue;
    }
    if (used + w.bytes > cap && current.length > 0) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(w);
    used += w.bytes;
  }
  if (current.length > 0) chunks.push(current);
  return { chunks, oversize };
}

/**
 * Whether closing the page now would lose words that no keepalive request can carry: true only
 * while some unsaved write (or note being typed) is bigger than the cap on its own.
 *
 * @param bytes - The body sizes of the unsaved writes and of any note still being typed.
 * @param cap - The keepalive cap.
 * @returns True when the page should warn before it closes.
 */
export function needsLeaveWarning(bytes: readonly number[], cap: number = KEEPALIVE_CAP): boolean {
  return bytes.some((b) => b > cap);
}

/**
 * What the server will hold once the write in flight lands, so a write queued behind it can be
 * sent at once, with the version it will have, instead of waiting for a page that is closing.
 *
 * @param saved - What the server last confirmed (undefined: it does not have the item).
 * @param inflight - The write being sent now, if any.
 * @returns The predicted saved state (undefined after a delete).
 */
export function predictedSaved(
  saved: SavedItem | undefined,
  inflight: SaveOp | undefined,
): SavedItem | undefined {
  if (inflight === undefined) return saved;
  if (inflight.kind === 'delete') return undefined;
  if (inflight.kind === 'create') {
    const { x, y, w, h, z, body } = inflight.body;
    return { version: 1, x, y, w, h, z: z ?? 0, body: body ?? '' };
  }
  if (saved === undefined) return undefined;
  const { version, ...fields } = inflight.body;
  return { ...saved, ...fields, version: version + 1 };
}

/**
 * What the server will hold once every write in flight for an item lands, in the order they were
 * sent (a queued save, then the writes a closing page added behind it).
 *
 * @param saved - What the server last confirmed.
 * @param inflight - The writes in flight for the item, oldest first.
 * @returns The predicted saved state.
 */
export function predictedAfter(
  saved: SavedItem | undefined,
  inflight: readonly SaveOp[],
): SavedItem | undefined {
  return inflight.reduce<SavedItem | undefined>((s, op) => predictedSaved(s, op), saved);
}
