'use client';

/**
 * split/components/BoardBeside — the right-hand pane of the split view (#344, P4 step 7, V3-25/26):
 * the REAL board (`BoardView`, sized by this pane) behind a draggable divider that is also a
 * keyboard separator, with a button to fold either side to a strip. The paper stays where it is on
 * the left (the page makes room, as for the explain drawer); folded, it is a strip with one button.
 *
 * The pane gives the board its host: which pages are on screen (the faint amber edge), what to do
 * with a source link (flash it in the paper, the board stays put), the passage dropped across the
 * divider, the first branch (more room) and Escape with nothing left to close (the board goes).
 */
import { useMemo, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { BoardHostProvider, BoardView, type BoardArrival, type BoardHost } from '@/features/board';

import { shareForKey, STRIP_WIDTH } from '../model/split';

import type { BoardBeside as BoardBesideState } from '../hooks/useBoardBeside';
import './split.css';

/** Props for `BoardBeside`. */
export interface BoardBesideProps {
  readonly paperId: string;
  readonly split: BoardBesideState;
  readonly visiblePages: ReadonlySet<number>;
  readonly arrival: BoardArrival | null;
  /** A source link clicked on a card: flash it in the paper. */
  readonly onShowInPaper: BoardHost['showInPaper'];
  readonly dragIn: BoardHost['dragIn'];
}

const Chevrons = ({ dir }: { readonly dir: 'left' | 'right' }): ReactNode => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className="pt-split__icon">
    <path
      d={dir === 'left' ? 'M10.5 5l-5 5 5 5M15.5 5l-5 5 5 5' : 'M9.5 5l5 5-5 5M4.5 5l5 5-5 5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

/**
 * The board beside the paper, with its divider.
 *
 * @example
 * <BoardBeside paperId={id} split={split} visiblePages={pages} arrival={arrival} … />
 */
export function BoardBeside(props: BoardBesideProps): ReactNode {
  const { paperId, split, visiblePages, arrival, onShowInPaper, dragIn } = props;
  const { state, viewport, boardWidth } = split;
  const dragging = useRef(false);
  const paperFolded = state.folded === 'paper';
  const boardFolded = state.folded === 'board';

  const host = useMemo<BoardHost>(
    () => ({
      beside: true,
      visiblePages,
      arrival,
      dragIn,
      showInPaper: onShowInPaper,
      onBranched: split.widen,
      onEscapeUnused: split.close,
      toggleSplit: split.toggle,
    }),
    [visiblePages, arrival, dragIn, onShowInPaper, split.widen, split.close, split.toggle],
  );

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    dragging.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* a synthetic pointer: the move still arrives */
    }
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    if (dragging.current) split.dragTo(event.clientX);
  };
  const onPointerUp = (): void => {
    dragging.current = false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      // On the divider itself Enter folds nothing; Escape and B stay the board's and the reader's.
      return;
    }
    const share = shareForKey(state, event.key, viewport, event.shiftKey);
    if (share === null) return;
    event.preventDefault();
    split.setShare(share);
  };

  return (
    <>
      <aside
        className="pt-beside"
        aria-label="Board"
        data-folded={boardFolded ? 'board' : paperFolded ? 'paper' : 'none'}
        style={{ inlineSize: boardWidth }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- a focusable ARIA separator (a window splitter): the keys are its own */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize paper and board"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((boardWidth / viewport) * 100)}
          aria-valuetext={`The board takes ${String(Math.round((boardWidth / viewport) * 100))}% of the window`}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a window splitter takes focus
          tabIndex={0}
          className="pt-split__divider"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        />
        <div className="pt-split__grip" role="group" aria-label="Fold a side">
          <button
            type="button"
            className="pt-split__fold"
            aria-label={paperFolded ? 'Show the paper' : 'Hide the paper'}
            aria-pressed={paperFolded}
            onClick={() => (paperFolded ? split.restore() : split.fold('paper'))}
          >
            <Chevrons dir={paperFolded ? 'right' : 'left'} />
          </button>
          <button
            type="button"
            className="pt-split__fold"
            aria-label={boardFolded ? 'Show the board' : 'Hide the board'}
            aria-pressed={boardFolded}
            onClick={() => (boardFolded ? split.restore() : split.fold('board'))}
          >
            <Chevrons dir={boardFolded ? 'left' : 'right'} />
          </button>
        </div>
        <div className="pt-split__board" hidden={boardFolded}>
          <BoardHostProvider value={host}>
            <BoardView paperId={paperId} />
          </BoardHostProvider>
        </div>
      </aside>
      {paperFolded ? (
        <div className="pt-split__strip" style={{ inlineSize: STRIP_WIDTH }}>
          <button
            type="button"
            className="pt-split__restore"
            onClick={split.restore}
            aria-label="Show the paper"
          >
            <Chevrons dir="right" />
            <span className="pt-split__restore-label" aria-hidden="true">
              Paper
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
}
