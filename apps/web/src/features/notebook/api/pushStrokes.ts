/**
 * The network half of the ink's saver (S5d, #209), as `pushItem` is the items': one POST of a
 * batch of strokes, or one DELETE, and what became of each stroke, in words `useStrokeSaver` acts
 * on. A 404 on the POST is the PAGE deleted elsewhere; a 422/413 is a refusal that would fail the
 * same way again, so a refused batch of several is sent again one by one and only the bad stroke
 * is lost; a DELETE answered 404 is already the state asked for. A failure records whether the
 * request may have reached the server (anything but a 4xx answer: no answer, a 5xx, a proxy's
 * 502 after the commit), because such a stroke, if it later leaves the page, must be DELETEd.
 */
import { ApiError } from '@/lib/api/types';

import { notebookApi } from './notebookApi';

import type { NotebookStrokeIn } from './notebookApi';
import type { BatchOutcome } from '../model/inkLedger';

const encoder = new TextEncoder();

/**
 * The size of a strokes POST's body, as the browser counts it against the keepalive budget.
 *
 * @param batch - The strokes.
 * @returns Bytes of its JSON body (UTF-8).
 */
export function bodyBytes(batch: readonly NotebookStrokeIn[]): number {
  return encoder.encode(JSON.stringify(batch)).length;
}

const statusOf = (error: unknown): number => (error instanceof ApiError ? error.status : 0);
/**
 * Whether a failed POST may have reached the server: no answer or a 5xx may hide a commit; a 4xx
 * answer means the server did not take it.
 *
 * @param status - The HTTP status (0: no answer).
 * @returns True when the stroke may be on the server.
 */
const mayHaveLanded = (status: number): boolean => status < 400 || status >= 500;

/**
 * POSTs one batch of strokes.
 *
 * @param pageId - The page.
 * @param batch - The strokes, in paint order.
 * @param keepalive - Send with `keepalive` (the caller reserved the budget for it).
 * @returns What became of each stroke.
 */
export async function postBatch(
  pageId: string,
  batch: readonly NotebookStrokeIn[],
  keepalive: boolean,
): Promise<BatchOutcome> {
  const ids = batch.map((w) => w.stroke_id);
  const none = { saved: [], refused: [], failed: [], uncertain: [], pageGone: false };
  try {
    await notebookApi.addStrokes(pageId, batch, { keepalive });
    return { ...none, saved: ids };
  } catch (error) {
    const status = statusOf(error);
    if (status === 404) return { ...none, failed: ids, pageGone: true };
    if ((status === 422 || status === 413) && batch.length > 1) {
      const each: BatchOutcome[] = [];
      for (const w of batch) each.push(await postBatch(pageId, [w], keepalive));
      return merge(each);
    }
    if (status === 422 || status === 413) {
      const detail = error instanceof ApiError ? error.detail : 'The stroke was refused.';
      return { ...none, refused: ids.map((id) => ({ id, detail })) };
    }
    return { ...none, failed: ids, uncertain: mayHaveLanded(status) ? ids : [] };
  }
}

/**
 * The outcomes of several POSTs as one.
 *
 * @param all - The outcomes.
 * @returns Their union.
 */
function merge(all: readonly BatchOutcome[]): BatchOutcome {
  return {
    saved: all.flatMap((o) => o.saved),
    refused: all.flatMap((o) => o.refused),
    failed: all.flatMap((o) => o.failed),
    uncertain: all.flatMap((o) => o.uncertain),
    pageGone: all.some((o) => o.pageGone),
  };
}

/**
 * DELETEs one stroke (the eraser, an undone drawing, or a stroke whose POST may have landed).
 *
 * @param pageId - The page.
 * @param strokeId - The stroke.
 * @param keepalive - Send with `keepalive` (a DELETE has no body, so it costs no budget).
 * @returns True once the stroke is not on the server (a 404 included).
 */
export async function deleteOne(
  pageId: string,
  strokeId: string,
  keepalive: boolean,
): Promise<boolean> {
  try {
    await notebookApi.deleteStroke(pageId, strokeId, { keepalive });
    return true;
  } catch (error) {
    return statusOf(error) === 404;
  }
}
