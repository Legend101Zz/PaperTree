/**
 * canvas/sendToCanvas — the `sendToCanvas` half of `ReaderActions` (contracts.md §5), S7.
 *
 *   { kind: 'excerpt', anchor }       -> an excerpt node holding the Anchor (never a bare block id)
 *   { kind: 'explanation', messageId } -> an explanation node holding the answer's text
 *   { kind: 'diagram', messageId, title } -> a diagram card holding the plate's message id (#217),
 *                                          one card per plate
 *
 * A board is created ONLY here, by an explicit send: the first `createNode` creates it in the
 * same transaction (ADR-002 §3.7). The new node is placed where it overlaps no existing node, and
 * a toast says so with an "Open board" link: a passage from the selection toolbar's "Send to board"
 * (#203) and an answer from the explain panel's "Send to board" alike (#214). A failure throws (the reader shows its notice); an
 * explanation send also shows its own error toast, because the explain panel is another slice's.
 */
import { displayQuote } from '@/components/reader/quote';
import { ApiError } from '@/lib/api/types';
import { boardsApi } from '@/lib/api/boards';
import { threadsApi } from '@/lib/api/threads';
import { newNodeId } from '@/features/board/model/ids';
import { DEFAULT_SIZE, freeSpot } from '@/features/board/model/placement';

import { findExcerptFor } from './duplicate';
import { showCanvasToast } from './toast';

import type { SendToCanvasInput } from '@/components/reader/actions';

const MAX_THREADS_SEARCHED = 6;
/** The API's card limits (schemas.py), so a long answer is clipped instead of refused. */
const CANVAS_BODY_MAX = 20_000;
const CANVAS_TITLE_MAX = 200;
const ADDED: Record<SendToCanvasInput['kind'], string> = {
  excerpt: 'Passage added to your board.',
  explanation: 'Answer added to your board.',
  diagram: 'Plate added to your board.',
};

/** The text of an assistant message: the newest threads first, which is where the open panel is. */
async function messageText(
  paperId: string,
  messageId: string,
): Promise<{ text: string; threadTitle: string } | null> {
  const threads = await threadsApi.list(paperId);
  const newest = [...threads]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, MAX_THREADS_SEARCHED);
  for (const thread of newest) {
    const { messages } = await threadsApi.get(paperId, thread.thread_id);
    const found = messages.find((m) => m.message_id === messageId);
    if (found !== undefined) return { text: found.content, threadTitle: thread.title };
  }
  return null;
}

/** The board's route (#214; `/canvas` redirects to it). */
const boardHref = (paperId: string): string => `/paper/${encodeURIComponent(paperId)}/board`;

function sentence(error: unknown): string {
  if (error instanceof ApiError && error.detail.length > 0) return error.detail;
  return "Couldn't add this to the board. Check your connection and try again.";
}

export async function sendToCanvas(
  paperId: string | null,
  input: SendToCanvasInput,
): Promise<void> {
  if (paperId === null) {
    // A fixture paper has no account, so there is nowhere to keep a board.
    const message = 'This sample paper is not in your library, so it has no board.';
    if (input.kind === 'explanation') showCanvasToast({ message, tone: 'error' });
    throw new Error(message);
  }
  try {
    const view = await boardsApi.get(paperId);
    const size = DEFAULT_SIZE[input.kind];
    const spot = freeSpot(view.nodes, size);
    if (input.kind === 'diagram') {
      // One plate, one card: a second send points at the card already there (#217).
      if (view.nodes.some((n) => n.kind === 'diagram' && n.source_diagram_id === input.messageId)) {
        showCanvasToast({
          message: 'This plate is already on your board',
          href: boardHref(paperId),
          linkLabel: 'Open board',
        });
        return;
      }
      await boardsApi.createNode(paperId, {
        node_id: newNodeId(),
        kind: 'diagram',
        ...spot,
        ...size,
        title: input.title.slice(0, CANVAS_TITLE_MAX),
        source_diagram_id: input.messageId,
      });
    } else if (input.kind === 'excerpt') {
      // The same passage twice would be two identical cards: say so and point at the board.
      if (findExcerptFor(view.nodes, input.anchor) !== null) {
        showCanvasToast({
          message: 'Already on your board',
          href: boardHref(paperId),
          linkLabel: 'Open board',
        });
        return;
      }
      await boardsApi.createNode(paperId, {
        node_id: newNodeId(),
        kind: 'excerpt',
        ...spot,
        ...size,
        body: displayQuote([input.anchor]).slice(0, CANVAS_BODY_MAX),
        source_anchor: input.anchor,
      });
    } else {
      const found = await messageText(paperId, input.messageId);
      if (found === null) {
        throw new ApiError(
          404,
          'not_found',
          "This answer isn't saved yet, so it can't be added.",
          false,
        );
      }
      await boardsApi.createNode(paperId, {
        node_id: newNodeId(),
        kind: 'explanation',
        ...spot,
        ...size,
        title: found.threadTitle.slice(0, CANVAS_TITLE_MAX),
        body: found.text.slice(0, CANVAS_BODY_MAX),
        source_message_id: input.messageId,
      });
    }
    showCanvasToast({
      message: ADDED[input.kind],
      href: boardHref(paperId),
      linkLabel: 'Open board',
    });
  } catch (error) {
    if (input.kind === 'explanation') showCanvasToast({ message: sentence(error), tone: 'error' });
    throw error;
  }
}
