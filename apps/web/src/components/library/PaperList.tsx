'use client';

/**
 * library/PaperList — the list view: the same facts as the card, one row deep, reflowing to two
 * lines on a phone. Rows rather than a `<table>` so processing state is never a dropped column.
 */

import { HighlightCountBadge, ProcessingBadge, pointerActivate } from './primitives';
import { PaperActions, type PaperActionsProps } from './PaperActions';
import { addedLabel, authorLine, badgeLabel, pagesLabel } from './PaperGrid';
import type { LibraryPaper } from './types';

export interface PaperListProps {
  readonly papers: readonly LibraryPaper[];
  readonly onOpen: (paperId: string) => void;
  readonly onRetry?: PaperActionsProps['onRetry'];
  readonly onDelete?: PaperActionsProps['onDelete'];
  readonly emptyMessage?: string;
}

export interface PaperRowProps {
  readonly paper: LibraryPaper;
  readonly onOpen: (paperId: string) => void;
  readonly onRetry?: PaperActionsProps['onRetry'];
  readonly onDelete?: PaperActionsProps['onDelete'];
}

export function PaperRow({ paper, onOpen, onRetry, onDelete }: PaperRowProps) {
  const facts = [authorLine(paper.authors), pagesLabel(paper.pageCount), addedLabel(paper.addedAt)]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const label = badgeLabel(paper);

  return (
    <div
      data-paper-id={paper.id}
      data-processing-state={paper.processing}
      className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
      style={{ borderColor: 'var(--pt-rule)' }}
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="pt-s3-cardlink pt-s3-card__title"
          {...pointerActivate<HTMLButtonElement>(() => {
            onOpen(paper.id);
          })}
        >
          {paper.title}
        </button>
        {facts.length > 0 ? <p className="pt-s3-muted pt-s3-small">{facts}</p> : null}
        {paper.processing === 'failed' && paper.failureReason !== undefined ? (
          <p className="pt-s3-alert pt-s3-alert--error mt-2" data-failure-reason="">
            {paper.failureReason}
          </p>
        ) : null}
        {paper.processing === 'partial' && paper.partialReason !== undefined ? (
          <p className="pt-s3-alert pt-s3-alert--warn mt-2">{paper.partialReason}</p>
        ) : null}
      </div>

      <div className="flex w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto">
        {paper.highlightCount > 0 ? <HighlightCountBadge count={paper.highlightCount} /> : null}
        <ProcessingBadge
            state={paper.processing}
            reasonShown={
              (paper.processing === 'failed' && paper.failureReason !== undefined) ||
              (paper.processing === 'partial' && paper.partialReason !== undefined)
            }
            {...(label === undefined ? {} : { label })}
          />
        <PaperActions
          paper={paper}
          {...(onRetry === undefined ? {} : { onRetry })}
          {...(onDelete === undefined ? {} : { onDelete })}
        />
      </div>
    </div>
  );
}

export function PaperList({ papers, onOpen, onRetry, onDelete, emptyMessage }: PaperListProps) {
  if (papers.length === 0) {
    return (
      <p role="status" className="pt-s3-muted py-12 text-center text-sm">
        {emptyMessage ?? 'No papers match.'}
      </p>
    );
  }

  return (
    <ul className="list-none p-0" data-view="list">
      {papers.map((paper) => (
        <li key={paper.id}>
          <PaperRow
            paper={paper}
            onOpen={onOpen}
            {...(onRetry === undefined ? {} : { onRetry })}
            {...(onDelete === undefined ? {} : { onDelete })}
          />
        </li>
      ))}
    </ul>
  );
}
