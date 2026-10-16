'use client';

/**
 * library/PaperGrid — the card view.
 *
 * A card shows the title (the one big target that opens the paper), authors, pages, the date it was
 * added, its PROCESSING STATE in words, and whatever that state owes the reader: the step a reading
 * paper is on, the plain sentence a partial paper owes, the reason a failed one failed with Retry.
 *
 * It never hides Open. Source mode works in every state, including `failed`: the PDF arrived, only
 * our reading of it did not finish (§19.8). The title is the target rather than the whole card so
 * Retry and Delete are not nested interactives inside a button.
 */

import { HighlightCountBadge, ProcessingBadge, ProgressMeter, pointerActivate } from './primitives';
import { PaperActions, type PaperActionsProps } from './PaperActions';
import type { LibraryPaper } from './types';

export interface PaperCardProps {
  readonly paper: LibraryPaper;
  readonly onOpen: (paperId: string) => void;
  readonly onRetry?: PaperActionsProps['onRetry'];
  readonly onDelete?: PaperActionsProps['onDelete'];
}

export function authorLine(authors: readonly string[]): string | null {
  if (authors.length === 0) return null;
  if (authors.length <= 3) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')} +${String(authors.length - 3)} more`;
}

export function pagesLabel(pageCount: number): string | null {
  if (pageCount <= 0) return null;
  return pageCount === 1 ? '1 page' : `${String(pageCount)} pages`;
}

export function addedLabel(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Added ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** "Reading the PDF - step 1 of 3" for a reading paper, the plain label otherwise. */
export function badgeLabel(paper: LibraryPaper): string | undefined {
  if (paper.processing === 'parsing' && paper.step !== undefined) {
    return `${paper.step.name} - step ${String(paper.step.n)} of ${String(paper.step.of)}`;
  }
  return undefined;
}

export function PaperCard({ paper, onOpen, onRetry, onDelete }: PaperCardProps) {
  const titleId = `paper-title-${paper.id}`;
  const authors = authorLine(paper.authors);
  const meta = [pagesLabel(paper.pageCount), addedLabel(paper.addedAt)].filter(
    (part): part is string => part !== null,
  );
  const label = badgeLabel(paper);

  return (
    <article
      aria-labelledby={titleId}
      data-paper-id={paper.id}
      data-processing-state={paper.processing}
      className="pt-s3-card"
    >
      <h3 id={titleId} className="pt-s3-card__title">
        <button
          type="button"
          className="pt-s3-cardlink"
          {...pointerActivate<HTMLButtonElement>(() => {
            onOpen(paper.id);
          })}
        >
          {paper.title}
        </button>
      </h3>

      {authors !== null ? <p className="pt-s3-muted pt-s3-small">{authors}</p> : null}

      {meta.length > 0 || paper.highlightCount > 0 ? (
        <div className="pt-s3-muted pt-s3-small flex flex-wrap items-center gap-x-3 gap-y-1">
          {meta.map((part) => (
            <span key={part}>{part}</span>
          ))}
          {paper.highlightCount > 0 ? <HighlightCountBadge count={paper.highlightCount} /> : null}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-3">
        <div>
          <ProcessingBadge
            state={paper.processing}
            reasonShown={
              (paper.processing === 'failed' && paper.failureReason !== undefined) ||
              (paper.processing === 'partial' && paper.partialReason !== undefined)
            }
            {...(label === undefined ? {} : { label })}
          />
        </div>

        {paper.processing === 'parsing' && paper.step !== undefined ? (
          <ProgressMeter
            value={(paper.step.n - 1) / paper.step.of}
            label={`Reading progress, ${paper.title}`}
          />
        ) : null}

        {paper.processing === 'partial' && paper.partialReason !== undefined ? (
          <p className="pt-s3-alert pt-s3-alert--warn">{paper.partialReason}</p>
        ) : null}

        {paper.processing === 'failed' && paper.failureReason !== undefined ? (
          <p className="pt-s3-alert pt-s3-alert--error" data-failure-reason="">
            {paper.failureReason}
          </p>
        ) : null}

        <PaperActions
          paper={paper}
          {...(onRetry === undefined ? {} : { onRetry })}
          {...(onDelete === undefined ? {} : { onDelete })}
        />
      </div>
    </article>
  );
}

export interface PaperGridProps {
  readonly papers: readonly LibraryPaper[];
  readonly onOpen: (paperId: string) => void;
  readonly onRetry?: PaperActionsProps['onRetry'];
  readonly onDelete?: PaperActionsProps['onDelete'];
  /** Shown when the list is empty (a filter matched nothing); NOT the first-run empty library. */
  readonly emptyMessage?: string;
}

export function PaperGrid({ papers, onOpen, onRetry, onDelete, emptyMessage }: PaperGridProps) {
  if (papers.length === 0) {
    return (
      <p role="status" className="pt-s3-muted py-12 text-center text-sm">
        {emptyMessage ?? 'No papers match.'}
      </p>
    );
  }

  return (
    <ul
      className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3"
      data-view="grid"
    >
      {papers.map((paper) => (
        <li key={paper.id}>
          <PaperCard
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
