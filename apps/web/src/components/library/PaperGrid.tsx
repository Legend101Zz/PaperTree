'use client';

/**
 * library/PaperGrid — §18.4's card view.
 *
 * A card shows title, authors, page count, reading progress, PROCESSING STATE, audio state and
 * highlight count. The v1 card (`dashboard/PaperList.tsx`) showed title, a date and — conditionally
 * — a page count, and then offered "Read" whatever the state of the parse. This one cannot do that:
 * the badge and the action are driven from the same `processing` field, so a paper that failed to
 * parse cannot present a Guided-mode entry point.
 *
 * WHAT THE CARD DOES *NOT* DO: it never disables reading. Source mode is available in every one of
 * the five states, including `failed` — the PDF was uploaded successfully; it is our reading of it
 * that did not finish (§19.8). Hiding the Read action on failure would lose the user the one thing
 * that definitely still works.
 *
 * The whole card is deliberately NOT one big tap target. A card that is a button cannot contain the
 * Retry button (nested interactives), and it makes the title unreadable to a screen reader that
 * announces the entire card contents as the button's label. The title is the target instead, and it
 * spans the card's full width so it is a large one.
 */

import { RotateCcw } from 'lucide-react';
import {
  AudioBadge,
  HighlightCountBadge,
  ProcessingBadge,
  ProgressMeter,
  TOUCH_TARGET,
  pointerActivate,
} from './primitives';
import { derivedFeaturesReady, type LibraryPaper } from './types';

export interface PaperCardProps {
  readonly paper: LibraryPaper;
  readonly onOpen: (paperId: string) => void;
  /** Only meaningful for `processing === 'failed'`; the card hides the control otherwise. */
  readonly onRetry?: (paperId: string) => void;
}

function authorLine(authors: readonly string[]): string {
  // Front matter is not always in a section (the fixtures disagree about this), so an empty author
  // list is a normal outcome and gets an honest label rather than an empty line.
  if (authors.length === 0) return 'Authors not identified';
  if (authors.length <= 3) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')} +${String(authors.length - 3)} more`;
}

export function PaperCard({ paper, onOpen, onRetry }: PaperCardProps) {
  const titleId = `paper-title-${paper.id}`;
  const progressPct = Math.round(Math.max(0, Math.min(1, paper.readingProgress)) * 100);
  const ready = derivedFeaturesReady(paper.processing);

  return (
    <article
      aria-labelledby={titleId}
      data-paper-id={paper.id}
      data-processing-state={paper.processing}
      className="flex h-full flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    >
      <h3 id={titleId} className="text-base font-medium">
        <button
          type="button"
          className={`${TOUCH_TARGET} flex w-full items-center rounded-lg text-left text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-white`}
          {...pointerActivate<HTMLButtonElement>(() => {
            onOpen(paper.id);
          })}
        >
          {paper.title}
        </button>
      </h3>

      <p className="text-sm text-gray-600 dark:text-gray-400">{authorLine(paper.authors)}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        <span>{paper.pageCount === 1 ? '1 page' : `${String(paper.pageCount)} pages`}</span>
        <AudioBadge state={paper.audio} />
        <HighlightCountBadge count={paper.highlightCount} />
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <ProgressMeter
          value={paper.readingProgress}
          label={`Reading progress, ${paper.title}: ${String(progressPct)} percent`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ProcessingBadge
            state={paper.processing}
            pagesParsed={paper.pagesParsed}
            pageCount={paper.pageCount}
          />
          <span className="text-xs text-gray-500">
            {ready ? `${String(progressPct)}% read` : 'Source mode ready'}
          </span>
        </div>

        {paper.processing === 'failed' && onRetry !== undefined ? (
          <button
            type="button"
            className={`${TOUCH_TARGET} inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-medium text-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:border-red-800 dark:text-red-200`}
            {...pointerActivate<HTMLButtonElement>(() => {
              onRetry(paper.id);
            })}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {paper.failedStep === undefined
              ? `Retry reading ${paper.title}`
              : `Retry ${paper.title} from ${paper.failedStep}`}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export interface PaperGridProps {
  readonly papers: readonly LibraryPaper[];
  readonly onOpen: (paperId: string) => void;
  readonly onRetry?: (paperId: string) => void;
  /**
   * Shown when the list is empty. This is the "your filter matched nothing" state and NOT the empty
   * library — that one is `EmptyLibrary` in `SystemStates.tsx`, and conflating them would show a
   * first-run onboarding screen to someone who just mistyped a search.
   */
  readonly emptyMessage?: string;
}

export function PaperGrid({ papers, onOpen, onRetry, emptyMessage }: PaperGridProps) {
  if (papers.length === 0) {
    return (
      <p role="status" className="py-12 text-center text-sm text-gray-600 dark:text-gray-400">
        {emptyMessage ?? 'No papers match.'}
      </p>
    );
  }

  return (
    <ul className="grid list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-view="grid">
      {papers.map((paper) => (
        <li key={paper.id}>
          <PaperCard
            paper={paper}
            onOpen={onOpen}
            {...(onRetry === undefined ? {} : { onRetry })}
          />
        </li>
      ))}
    </ul>
  );
}
