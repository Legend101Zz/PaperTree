/**
 * explain/createBody — the body of the request that starts a thread, from what the panel is open
 * on. Pure, so the shape the API refuses anything else than is pinned in a test.
 *
 * Three kinds: `ask` (no passage, a free question), `explain` (a passage's anchor) and `image` (a
 * figure or a region, v0.3 #348): an image thread's anchor is the picture's, its question is
 * optional (the server asks "Explain this figure."), and the words selected with the picture go as
 * `with_text_anchor`.
 */
import type { CreateThreadBody } from '@/lib/api/threads';
import type { AnswerLevel } from '@/lib/api/types';
import type { ExplainRequest } from './state';

/**
 * The first request of a thread.
 *
 * @param request What the panel is open on, or null for a free question.
 * @param question The reader's question; undefined for the default one (never for a free ask).
 * @param level How deep the answer goes.
 * @returns The `POST /papers/{id}/threads` body.
 */
export function createBodyFor(
  request: ExplainRequest | null,
  question: string | undefined,
  level: AnswerLevel,
): CreateThreadBody {
  if (request === null) return { kind: 'ask', question: question ?? '', level };
  const asked = question === undefined ? {} : { question };
  if (request.image !== undefined) {
    return {
      kind: 'image',
      anchor: request.anchor,
      ...asked,
      level,
      ...(request.image.withText === undefined
        ? {}
        : { with_text_anchor: request.image.withText.anchor }),
    };
  }
  return { kind: 'explain', anchor: request.anchor, ...asked, level };
}
