/**
 * Sends one `SaveOp` (model/save.ts) and says how it went, in words the page can act on (S5c,
 * #208). A 409 `stale_version` (a patch, or a delete at a version, over an edit made somewhere
 * else) is a conflict and is NEVER retried with the newer version: that retry would overwrite the
 * other edit. A 404 on a patch means the item was deleted somewhere else; a 422 is a refusal that
 * would fail the same way again. Only `failed` is worth trying again.
 */
import { ApiError } from '@/lib/api/types';

import { isStaleVersion, notebookApi } from './notebookApi';
import { savedFromWire } from '../model/save';

import type { SendInit } from './notebookApi';
import type { SaveOp, SavedItem } from '../model/save';

/** How one save went. */
export type PushResult =
  | { readonly kind: 'saved'; readonly saved: SavedItem }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'conflict' }
  /** The item was deleted somewhere else (a patch answered 404). */
  | { readonly kind: 'gone' }
  /** The server refused the item itself (422); sending it again cannot help. */
  | { readonly kind: 'rejected'; readonly detail: string }
  | { readonly kind: 'failed'; readonly error: unknown };

/**
 * Sends one save operation for one item.
 *
 * @param pageId - The page the item is on.
 * @param itemId - The item.
 * @param op - What to send (`saveOp`'s answer).
 * @param init - `keepalive` while the page is being left, so the request outlives it.
 * @returns What happened; see `PushResult`.
 */
export async function pushItem(
  pageId: string,
  itemId: string,
  op: SaveOp,
  init: SendInit = {},
): Promise<PushResult> {
  try {
    switch (op.kind) {
      case 'create':
        return {
          kind: 'saved',
          saved: savedFromWire(await notebookApi.createItem(pageId, op.body, init)),
        };
      case 'patch':
        return {
          kind: 'saved',
          saved: savedFromWire(await notebookApi.patchItem(pageId, itemId, op.body, init)),
        };
      case 'delete':
        await notebookApi.deleteItem(pageId, itemId, op.version, init);
        return { kind: 'deleted' };
    }
  } catch (error) {
    if (isStaleVersion(error)) return { kind: 'conflict' };
    if (error instanceof ApiError && error.status === 404) {
      // Deleting what is already gone has reached the state the person asked for.
      return op.kind === 'delete' ? { kind: 'deleted' } : { kind: 'gone' };
    }
    if (error instanceof ApiError && error.status === 422) {
      return { kind: 'rejected', detail: error.detail };
    }
    return { kind: 'failed', error };
  }
}
