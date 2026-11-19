/**
 * board/components/tree/answerView — a stored or streaming board answer as the tutor format's
 * blocks (`features/explain`), compact: the section labels, paragraphs, maths and the inline
 * figure, WITHOUT the source line (the card's foot carries the pages) and without the Check block.
 */
import { buildAnswer, type AnswerModel, type PaperSource } from '@/features/explain/model/answer';
import { threadHandles, type ThreadHandles } from '@/features/explain/model/passages';

import type { Citation } from '@/lib/api/types';

/** No thread read yet: no handle resolves beyond the answer's own citations. */
const UNREAD: ThreadHandles = threadHandles([]);

/** What the card shows of the answer. */
export interface AnswerView {
  readonly model: AnswerModel;
  /** The pages the answer draws on, in document order (the foot's "p. 3"). */
  readonly pages: readonly PaperSource[];
  readonly characters: number;
}

/**
 * Builds the compact view of an answer.
 *
 * @param key The card's id.
 * @param text The answer: the Markdown the model wrote, handles kept.
 * @param state `live` while it streams, `done` once it settled, `cut` when it was stopped or failed.
 * @param citations The citations that resolve its handles.
 * @param numbers The thread's handles, when the thread has been read.
 * @returns The blocks (no source line, no check) and the pages.
 */
export function answerView(
  key: string,
  text: string,
  state: 'live' | 'done' | 'cut',
  citations: readonly Citation[],
  numbers: ThreadHandles = UNREAD,
): AnswerView {
  const full = buildAnswer(
    {
      key,
      role: 'assistant',
      text,
      status: state === 'live' ? 'streaming' : state === 'done' ? 'complete' : 'aborted',
      citations,
      question: '',
      createdAt: null,
    },
    numbers,
  );
  const source = full.blocks.find((b) => b.k === 'source');
  // An older answer has no source block: its paragraphs' pages, each once, are the foot's.
  const pages =
    source?.k === 'source'
      ? source.sources
      : full.paragraphs
          .flatMap((p) => p.sources)
          .filter((s, i, all) => all.findIndex((o) => o.page === s.page) === i);
  return {
    model: {
      ...full,
      // The foot carries the pages, so no paragraph draws its own source line either.
      blocks: full.blocks
        .filter((b) => b.k !== 'source' && b.k !== 'check')
        .map((b) => (b.k === 'p' ? { ...b, paragraph: { ...b.paragraph, ownLine: false } } : b)),
    },
    pages,
    characters: text.length,
  };
}
