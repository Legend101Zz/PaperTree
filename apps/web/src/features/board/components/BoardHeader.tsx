/**
 * board/components/BoardHeader — frame 06's bar: Back to the paper, "Board" with the paper's title in
 * italic and the counts ("11 cards · 7 threads · 2 frames"), and the board's tools on the right. On
 * a phone the way back is its arrow alone and the title is "Board": the tools keep one row.
 */
import { readerHref } from '../model/chrome';
import { BoardIcon } from './BoardIcon';

import type { ReactNode } from 'react';

/** Props for `BoardHeader`. */
export interface BoardHeaderProps {
  readonly paperId: string;
  /** The paper's title, once read; null leaves "Board" alone. */
  readonly paperTitle: string | null;
  /** `countsLine`'s words, or null while the board loads. */
  readonly counts: string | null;
  /** The tool bar. */
  readonly children: ReactNode;
}

/**
 * The board's header.
 *
 * @example
 * <BoardHeader paperId={id} paperTitle="Attention Is All You Need" counts="3 cards"><BoardToolbar … /></BoardHeader>
 */
export function BoardHeader({
  paperId,
  paperTitle,
  counts,
  children,
}: BoardHeaderProps): ReactNode {
  return (
    <header className="pt-boardbar">
      <a className="pt-toolbtn pt-boardbar__back" href={readerHref(paperId)}>
        <BoardIcon name="back" />
        <span className="pt-boardbar__backlabel">Back to the paper</span>
      </a>
      <span className="pt-boardbar__rule" aria-hidden="true" />
      <div className="pt-boardbar__title">
        <h1 className="pt-boardbar__h1">
          Board
          {paperTitle === null ? null : (
            <>
              {' '}
              <cite className="pt-boardbar__paper">{paperTitle}</cite>
            </>
          )}
        </h1>
        {counts === null ? null : <p className="pt-boardbar__counts">{counts}</p>}
      </div>
      {children}
    </header>
  );
}
