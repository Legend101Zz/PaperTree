/**
 * ReadingNow: the strip above the shelf (#196, frame 01; the owner's default, which may become a
 * book stand). One `ReadingNowRow` per paper you are reading, most recently opened first, at most
 * three: its cloth and ribbon, the short title (the spine's), the rule with "p. 4 of 15", and
 * Continue, which opens the reader at that page. Absent when nothing is in progress.
 */
'use client';

import { ReadingNowRow } from '@papertree/ui';
import { ArrowRight } from 'lucide-react';
import { useId } from 'react';

import { useTouchTargets } from '../hooks/useTouchTargets';
import { clothFor, readingPage, spineTitle, type ShelfPaper } from '../model/shelf';

import type { ReactNode } from 'react';

/** Props for `ReadingNow`. */
export interface ReadingNowProps {
  /** The papers to show, from `readingNow` (already ordered and limited). */
  readonly papers: readonly ShelfPaper[];
  /** Continue: the reader at the paper's page. */
  readonly onContinue: (paper: ShelfPaper) => void;
}

/**
 * The Reading now strip, or nothing when no paper is in progress.
 *
 * @example
 * <ReadingNow papers={readingNow(books)} onContinue={resume} />
 */
export function ReadingNow({ papers, onContinue }: ReadingNowProps): ReactNode {
  const headingId = useId();
  const touch = useTouchTargets();
  if (papers.length === 0) return null;
  return (
    <section className="pt-readingnow" aria-labelledby={headingId}>
      <h2 id={headingId} className="pt-readingnow__heading">
        Reading now
      </h2>
      <ul className="pt-readingnow__list">
        {papers.map((paper) => {
          const at = readingPage(paper);
          if (at === null) return null;
          return (
            <li key={paper.id} className="pt-readingnow__item" data-reading-paper-id={paper.id}>
              <ReadingNowRow
                title={spineTitle(paper.title)}
                page={at.page}
                pageCount={at.of}
                cloth={`var(--pt-cloth-${clothFor(paper)})`}
                arrow={<ArrowRight size={18} strokeWidth={1.5} />}
                size={touch ? 'touch' : 'md'}
                onContinue={() => onContinue(paper)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
