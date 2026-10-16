/**
 * What to send to make the server match the page (S5c, #208). The page edits a local model through
 * `history.ts`; after every command the hook asks, per touched item, "what does the server lack?"
 * and this answers with ONE operation: create, patch only the fields that differ, delete, or
 * nothing. Asking with the latest local state at send time coalesces a burst of keyboard nudges
 * into a few PATCHes (one per round trip: 10 quick nudges measured 3). Pure: the hook owns the
 * network and the per-item queue.
 */
import type { CreateItemBody, NotebookItemWire, PatchItemBody } from '../api/notebookApi';
import type { Item } from './page';

/** What the server last confirmed about an item (its `version` is what the next PATCH sends). */
export interface SavedItem {
  readonly version: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly z: number;
  readonly body: string;
}

/** One request that brings the server in line with the local item. */
export type SaveOp =
  | { readonly kind: 'create'; readonly body: CreateItemBody }
  | { readonly kind: 'patch'; readonly body: PatchItemBody }
  | { readonly kind: 'delete'; readonly version: number };

/**
 * The confirmed state carried by a server answer.
 *
 * @param wire - An item the API returned.
 * @returns Its saved snapshot.
 */
export function savedFromWire(wire: NotebookItemWire): SavedItem {
  const { version, x, y, w, h, z, body } = wire;
  return { version, x, y, w, h, z, body };
}

const GEOMETRY = ['x', 'y', 'w', 'h', 'z'] as const;

/**
 * The operation that makes the server hold `local`.
 *
 * @param saved - The server's last confirmed state, or undefined when it does not have the item.
 * @param local - The item on the page now, or undefined when it was removed.
 * @param body - `local`'s body as `wire.bodyOf` encodes it (ignored when `local` is undefined).
 * @returns The request to send, or null when the two already agree.
 * @example
 * saveOp(saved, { ...note, x: note.x + 8 }, note.text); // { kind: 'patch', body: { version, x } }
 */
export function saveOp(
  saved: SavedItem | undefined,
  local: Item | undefined,
  body: string,
): SaveOp | null {
  if (local === undefined) {
    return saved === undefined ? null : { kind: 'delete', version: saved.version };
  }
  if (saved === undefined) {
    const { id, kind, x, y, w, h, z } = local;
    const anchor = local.kind === 'quote' ? { anchor: local.anchor } : {};
    return { kind: 'create', body: { item_id: id, kind, x, y, w, h, z, body, ...anchor } };
  }
  const changed: Record<string, number | string> = {};
  for (const key of GEOMETRY) if (local[key] !== saved[key]) changed[key] = local[key];
  if (body !== saved.body) changed['body'] = body;
  if (Object.keys(changed).length === 0) return null;
  return { kind: 'patch', body: { version: saved.version, ...changed } };
}
