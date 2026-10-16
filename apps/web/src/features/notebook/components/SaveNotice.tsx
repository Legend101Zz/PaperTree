'use client';

/**
 * What the notebook page says about saving (S5c, #208). Saving never stops silently:
 * - a conflict (409) is a bar that cannot be dismissed, counts the unsaved edits, and stays until
 *   Reload, because from then on nothing on the page is saved;
 * - a failure is a notice with Try again; dismissed, it shrinks to a "Not saved" chip that stays
 *   until the saves succeed, and the next new failure brings the notice back;
 * - a refusal (422) and an item deleted elsewhere are said once, quietly.
 */
import { Button, Toast } from '@papertree/ui';
import { useState } from 'react';

import type { SaveStatus } from '../hooks/useItemSaver';
import type { ReactNode } from 'react';

/** Props for `SaveNotice`. */
export interface SaveNoticeProps {
  readonly status: SaveStatus;
  /** Items on the page that the server does not have as shown. */
  readonly unsaved: number;
  /** Send every failed save again. */
  readonly onRetry: () => void;
  readonly onReload: () => void;
}

function edits(n: number): string {
  return n === 1 ? '1 edit' : `${String(n)} edits`;
}

/** The page's saving notices. */
export function SaveNotice({ status, unsaved, onRetry, onReload }: SaveNoticeProps): ReactNode {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (status.conflict) {
    return (
      <div className="pt-nb-alert" role="alert">
        <span>
          Not saved: this page changed somewhere else. Reload to see it (your unsaved edits:{' '}
          {unsaved}).
        </span>
        <Button variant="primary" onClick={onReload}>
          Reload
        </Button>
      </div>
    );
  }
  if (status.failed > 0) {
    const key = `failed-${String(status.failure)}`;
    if (dismissed === key) {
      return (
        <div className="pt-nb-chip" role="status">
          <span>Not saved ({edits(status.failed)})</span>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      );
    }
    return (
      <Toast
        key={key}
        message={`Not saved yet: ${edits(status.failed)} could not be sent. They are still on this page.`}
        duration={0}
        action={{ label: 'Try again', onAction: onRetry }}
        onDismiss={() => setDismissed(key)}
      />
    );
  }
  const quiet =
    status.rejected.length > 0
      ? {
          key: `rejected-${String(status.rejected.length)}`,
          message: `A note could not be saved: ${status.rejected.at(-1) ?? ''}`,
        }
      : status.gone > 0
        ? {
            key: `gone-${String(status.gone)}`,
            message: 'A note was deleted somewhere else, so it is gone here too.',
          }
        : null;
  if (quiet === null || dismissed === quiet.key) return null;
  return (
    <Toast key={quiet.key} message={quiet.message} onDismiss={() => setDismissed(quiet.key)} />
  );
}
