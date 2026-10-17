/**
 * board/components/EmptyBoard — frame 06b: a ruled index card pinned to the linen with a brass pin,
 * the sprout, how things get here ("Select a passage and choose Send to board, or Dive in from an
 * explanation.") and Back to the paper; under it, the two hints. Nothing is made for the reader:
 * the board comes into being with the first thing sent to it.
 */
import { SproutMark } from '@papertree/ui';
import { useId, type ReactNode } from 'react';

import { readerHref } from '../model/chrome';
import { BoardIcon } from './BoardIcon';

/** The words of frame 06b, kept together so a test reads the same ones. */
export const EMPTY_BOARD = {
  title: 'Nothing on this board yet.',
  body: 'Select a passage and choose Send to board, or Dive in from an explanation.',
  back: 'Back to the paper',
  hints: ['Passages arrive as cards', 'Threads link them'],
} as const;

/**
 * The empty board, over the (empty) board itself.
 *
 * @example
 * <EmptyBoard paperId="ppr_…" />
 */
export function EmptyBoard({ paperId }: { readonly paperId: string }): ReactNode {
  const titleId = useId();
  return (
    <div className="pt-cv__empty pt-emptyboard" data-testid="canvas-empty">
      <section className="pt-emptyboard__card" aria-labelledby={titleId}>
        <span className="pt-emptyboard__pin" aria-hidden="true" />
        <SproutMark size={48} className="pt-emptyboard__sprout" />
        <h2 id={titleId} className="pt-emptyboard__title">
          {EMPTY_BOARD.title}
        </h2>
        <p className="pt-emptyboard__body">{EMPTY_BOARD.body}</p>
        <a
          className="pt-button pt-button--secondary pt-emptyboard__back"
          href={readerHref(paperId)}
        >
          <BoardIcon name="back" size={18} />
          {EMPTY_BOARD.back}
        </a>
      </section>
      <ul className="pt-emptyboard__hints">
        <li>
          <BoardIcon name="pin" size={18} />
          {EMPTY_BOARD.hints[0]}
        </li>
        <li>
          <BoardIcon name="thread" size={18} />
          {EMPTY_BOARD.hints[1]}
        </li>
      </ul>
    </div>
  );
}
