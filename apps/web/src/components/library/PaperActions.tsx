'use client';

/**
 * library/PaperActions — Retry and Delete for one paper, with the Delete confirmation INLINE.
 *
 * `window.confirm` is not used anywhere: it blocks the page, cannot be styled, cannot be driven by
 * the keyboard consistently and is invisible to a screenshot. The confirmation is two buttons that
 * replace the Delete button in place.
 *
 * A failed action is a sentence under the buttons with the next step in it, never a raw error.
 */
import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';

import { describeError } from '@/components/ui/errors';
import { TOUCH_TARGET, pointerActivate } from './primitives';
import type { LibraryPaper } from './types';

export interface PaperActionsProps {
  readonly paper: LibraryPaper;
  readonly onRetry?: (paperId: string) => void | Promise<unknown>;
  readonly onDelete?: (paperId: string) => void | Promise<unknown>;
}

export function PaperActions({ paper, onRetry, onDelete }: PaperActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'retry' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRetry = paper.processing === 'failed' && onRetry !== undefined;
  const canDelete = paper.isSample !== true && onDelete !== undefined;
  if (!canRetry && !canDelete) return null;

  const run = async (kind: 'retry' | 'delete', action: () => void | Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      setConfirming(false);
    } catch (caught) {
      setError(
        describeError(
          caught,
          kind === 'retry'
            ? 'Could not start reading again. Check your connection and retry.'
            : 'Could not delete this paper. Check your connection and try again.',
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-paper-actions="">
      <div className="flex flex-wrap items-center gap-2">
        {canRetry ? (
          <button
            type="button"
            className="pt-s3-btn pt-s3-btn--small"
            disabled={busy !== null}
            {...pointerActivate<HTMLButtonElement>(() => {
              if (onRetry !== undefined) void run('retry', () => onRetry(paper.id));
            })}
          >
            <RotateCcw
              className={`h-4 w-4 ${busy === 'retry' ? 'pt-s3-spin' : ''}`}
              aria-hidden="true"
            />
            Retry
            <span className="sr-only">{` reading ${paper.title}`}</span>
          </button>
        ) : null}

        {canDelete && !confirming ? (
          <button
            type="button"
            className={`pt-s3-btn pt-s3-btn--quiet pt-s3-btn--small ${TOUCH_TARGET}`}
            aria-label={`Delete ${paper.title}`}
            {...pointerActivate<HTMLButtonElement>(() => {
              setError(null);
              setConfirming(true);
            })}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete
          </button>
        ) : null}
      </div>

      {canDelete && confirming ? (
        <div
          role="group"
          aria-label={`Confirm deleting ${paper.title}`}
          className="pt-s3-alert pt-s3-alert--error flex flex-col gap-2"
          data-delete-confirm=""
        >
          <p>Delete this paper and its highlights? This cannot be undone.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pt-s3-btn pt-s3-btn--danger pt-s3-btn--small"
              disabled={busy !== null}
              {...pointerActivate<HTMLButtonElement>(() => {
                if (onDelete !== undefined) void run('delete', () => onDelete(paper.id));
              })}
            >
              {busy === 'delete' ? 'Deleting' : 'Delete paper'}
            </button>
            <button
              type="button"
              className="pt-s3-btn pt-s3-btn--small"
              disabled={busy !== null}
              {...pointerActivate<HTMLButtonElement>(() => {
                setConfirming(false);
              })}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <p role="alert" className="pt-s3-alert pt-s3-alert--error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
