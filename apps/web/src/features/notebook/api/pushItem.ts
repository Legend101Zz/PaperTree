/**
 * Sends one `SaveOp` (model/save.ts) and says how it went, in words the page can act on (S5c,
 * #208). The one rule that matters: a 409 `stale_version` is reported as a conflict and NEVER
 * retried with the newer version, because that retry would silently overwrite an edit made
 * somewhere else.
 */
import { ApiError } from '@/lib/api/types';

import { isStaleVersion, notebookApi } from './notebookApi';
import { savedFromWire } from '../model/save';

import type { SaveOp, SavedItem } from '../model/save';

/** How one save went. */
export type PushResult =
  | { readonly kind: 'saved'; readonly saved: SavedItem }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failed'; readonly error: unknown };

/**
 * Sends one save operation for one item.
 *
 * @param pageId - The page the item is on.
 * @param itemId - The item.
 * @param op - What to send (`saveOp`'s answer).
 * @returns `saved` with the server's new state, `deleted`, `conflict` for a 409, or `failed`.
 */
export async function pushItem(pageId: string, itemId: string, op: SaveOp): Promise<PushResult> {
  try {
    switch (op.kind) {
      case 'create':
        return {
          kind: 'saved',
          saved: savedFromWire(await notebookApi.createItem(pageId, op.body)),
        };
      case 'patch':
        return {
          kind: 'saved',
          saved: savedFromWire(await notebookApi.patchItem(pageId, itemId, op.body)),
        };
      case 'delete':
        await notebookApi.deleteItem(pageId, itemId);
        return { kind: 'deleted' };
    }
  } catch (error) {
    if (isStaleVersion(error)) return { kind: 'conflict' };
    // Deleting what is already gone has reached the state the person asked for.
    if (op.kind === 'delete' && error instanceof ApiError && error.status === 404) {
      return { kind: 'deleted' };
    }
    return { kind: 'failed', error };
  }
}
