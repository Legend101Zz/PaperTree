/**
 * CoverShelf: a short library stands face-out (#196, frame 01c, DESIGN.md §9: below about 12
 * papers). Covers in the arranged order, cut into as many planks as the width needs, each cover
 * with its caption under the plank. The keyboard model is the spines' (`useRovingShelf`): one tab
 * stop, ←/→ along the covers, Enter takes a book down into the catalogue card, Esc puts it back.
 */
'use client';

import { useMemo, useRef } from 'react';

import { useElementWidth } from '../hooks/useElementWidth';
import { useRovingShelf, type LiftedFocus } from '../hooks/useRovingShelf';
import { coverRows, coversPerRow } from '../model/states';
import { Cover } from './Cover';
import { CoverCaption } from './CoverCaption';
import { ShelfPlank } from './ShelfPlank';

import type { LibraryBook } from '../hooks/useLibrary';
import type { Arrangement } from '../model/shelf';
import type { ReactNode } from 'react';

/** Props for `CoverShelf`; the `Shelf`'s, plus the captions' two actions. */
export interface CoverShelfProps {
  readonly papers: readonly LibraryBook[];
  readonly arrangement: Arrangement;
  /** The ids a search matched, or null when no search is active. */
  readonly matches: ReadonlySet<string> | null;
  readonly openId: string | null;
  readonly cardId: string;
  /** A cover was clicked or Entered: take the book down. */
  readonly onActivate: (paperId: string) => void;
  readonly onPutBack?: () => void;
  /** The section's tab stop, so it survives a change of layout. */
  readonly focus?: LiftedFocus;
  /** A caption's Open. */
  readonly onOpen: (paperId: string) => void;
  /** A caption's Continue. */
  readonly onContinue: (book: LibraryBook) => void;
}

/**
 * The face-out shelf.
 *
 * @example
 * <CoverShelf papers={books} arrangement="topic" matches={null} openId={null} cardId="card"
 *   onActivate={takeDown} onOpen={read} onContinue={resume} />
 */
export function CoverShelf({
  papers,
  arrangement,
  matches,
  openId,
  cardId,
  onActivate,
  onPutBack,
  focus,
  onOpen,
  onContinue,
}: CoverShelfProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const width = useElementWidth(host);
  const rows = useMemo(
    () => coverRows(papers, arrangement, coversPerRow(width)),
    [papers, arrangement, width],
  );
  const order = useMemo(() => rows.flat().map((paper) => paper.id), [rows]);
  const { toolbar, stop, onFocusBook, onKeyDown } = useRovingShelf(order, openId, onPutBack, focus);
  return (
    <div ref={host} className="pt-covers">
      <div
        ref={toolbar}
        role="toolbar"
        aria-label="Shelf"
        aria-orientation="horizontal"
        data-searching={matches === null ? undefined : 'true'}
        onKeyDown={onKeyDown}
      >
        {rows.map((row) => (
          <div key={row[0]?.id} className="pt-covers__shelf">
            <ShelfPlank>
              <div className="pt-covers__row">
                {row.map((paper) => (
                  <div key={paper.id} className="pt-covers__slot">
                    <Cover
                      paper={paper}
                      tabIndex={paper.id === stop ? 0 : -1}
                      {...(matches === null ? {} : { match: matches.has(paper.id) })}
                      expanded={paper.id === openId}
                      cardId={cardId}
                      onActivate={onActivate}
                      onFocusCover={onFocusBook}
                    />
                  </div>
                ))}
              </div>
            </ShelfPlank>
            <div className="pt-covers__captions">
              {row.map((paper) => (
                <CoverCaption key={paper.id} book={paper} onOpen={onOpen} onContinue={onContinue} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
