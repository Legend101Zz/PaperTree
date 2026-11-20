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
  /** True beside the paper (the split view): no way back to leave, the board's name and its tools. */
  readonly beside?: boolean;
  /** The board's own name beside the paper; "Board" when it has none. */
  readonly name?: string;
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
  beside = false,
  name,
}: BoardHeaderProps): ReactNode {
  if (beside) {
    // The pane's own bar (V3-25): the paper is already on the left, so there is no way back to take.
    return (
      <header className="pt-boardbar pt-boardbar--beside">
        <h1 className="pt-boardbar__h1" title={paperTitle ?? undefined}>
          {name ?? 'Board'}
        </h1>
        {counts === null ? null : <p className="pt-boardbar__counts">{counts}</p>}
        {children}
      </header>
    );
  }
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
              {/* The full title on hover, where a narrow bar cuts it short. */}
              <cite className="pt-boardbar__paper" title={paperTitle}>
                {paperTitle}
              </cite>
            </>
          )}
        </h1>
        {counts === null ? null : <p className="pt-boardbar__counts">{counts}</p>}
      </div>
      {children}
    </header>
  );
}
