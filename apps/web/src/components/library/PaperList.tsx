'use client';

/**
 * library/PaperList — §18.4's list view. Same seven facts as the card, one row deep.
 *
 * NOT `components/dashboard/PaperList.tsx`. That file is the v1 grid whose upload path §18.4 names
 * as the defect (`PaperList.tsx:32-46`); this is the Epic 2 replacement and lives beside the rest
 * of the library so the two are not mistaken for each other by path alone.
 *
 * WHY ROWS AND NOT A `<table>`: the list view exists for people with two hundred papers on a phone.
 * A table forces horizontal scroll or a column drop, and dropping a column here means dropping
 * processing state — the one fact §18.4 promotes to first class. Each row is a self-describing
 * `<li>` instead, which reflows to two lines on a narrow viewport without losing anything.
 *
 * The row is not a single tap target, for the reasons in `PaperGrid.tsx`. The title is the target
 * and it fills the row's free width.
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
import type { LibraryPaper } from './types';

export interface PaperListProps {
  readonly papers: readonly LibraryPaper[];
  readonly onOpen: (paperId: string) => void;
  readonly onRetry?: (paperId: string) => void;
  readonly emptyMessage?: string;
}

export interface PaperRowProps {
  readonly paper: LibraryPaper;
  readonly onOpen: (paperId: string) => void;
  readonly onRetry?: (paperId: string) => void;
}

export function PaperRow({ paper, onOpen, onRetry }: PaperRowProps) {
  const progressPct = Math.round(Math.max(0, Math.min(1, paper.readingProgress)) * 100);
  const authors =
    paper.authors.length === 0 ? 'Authors not identified' : paper.authors.slice(0, 2).join(', ');

  return (
    <div
      data-paper-id={paper.id}
      data-processing-state={paper.processing}
      className="flex flex-col gap-2 border-b border-gray-200 py-2 last:border-b-0 dark:border-gray-700 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className={`${TOUCH_TARGET} flex w-full items-center rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600`}
          {...pointerActivate<HTMLButtonElement>(() => {
            onOpen(paper.id);
          })}
        >
          <span className="truncate font-medium text-gray-900 dark:text-white">{paper.title}</span>
        </button>
        <p className="truncate text-xs text-gray-600 dark:text-gray-400">
          {authors}
          {' · '}
          {paper.pageCount === 1 ? '1 page' : `${String(paper.pageCount)} pages`}
        </p>
      </div>

      <div className="flex w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-1 sm:w-auto">
        <AudioBadge state={paper.audio} />
        <HighlightCountBadge count={paper.highlightCount} />
        <div className="w-24">
          <ProgressMeter
            value={paper.readingProgress}
            label={`Reading progress, ${paper.title}: ${String(progressPct)} percent`}
          />
        </div>
        <ProcessingBadge
          state={paper.processing}
          pagesParsed={paper.pagesParsed}
          pageCount={paper.pageCount}
        />
        {paper.processing === 'failed' && onRetry !== undefined ? (
          <button
            type="button"
            aria-label={
              paper.failedStep === undefined
                ? `Retry reading ${paper.title}`
                : `Retry ${paper.title} from ${paper.failedStep}`
            }
            className={`${TOUCH_TARGET} inline-flex items-center justify-center rounded-lg border border-red-300 text-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:border-red-800 dark:text-red-200`}
            {...pointerActivate<HTMLButtonElement>(() => {
              onRetry(paper.id);
            })}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PaperList({ papers, onOpen, onRetry, emptyMessage }: PaperListProps) {
  if (papers.length === 0) {
    return (
      <p role="status" className="py-12 text-center text-sm text-gray-600 dark:text-gray-400">
        {emptyMessage ?? 'No papers match.'}
      </p>
    );
  }

  return (
    <ul className="list-none" data-view="list">
      {papers.map((paper) => (
        <li key={paper.id}>
          <PaperRow paper={paper} onOpen={onOpen} {...(onRetry === undefined ? {} : { onRetry })} />
        </li>
      ))}
    </ul>
  );
}
