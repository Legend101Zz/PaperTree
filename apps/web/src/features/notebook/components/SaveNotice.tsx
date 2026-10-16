'use client';

/**
 * What the notebook page says about saving (S5c, #208). Saving never stops silently:
 * - a conflict (409) is a bar that cannot be dismissed and stays until Reload: the saver that met
 *   it has stopped, and the bar counts, at every render, the items not saved here;
 * - a page deleted elsewhere is a bar too, with "Copy text" for the words that can no longer be
 *   saved;
 * - a failure is a notice with Try again; dismissed, it shrinks to a "Not saved" chip that stays
 *   until the saves succeed, and the next new failure brings the notice back;
 * - an item deleted elsewhere that held changes is saved again from this page, and says so; a
 *   refusal (422) is said once.
 */
import { Button, Toast } from '@papertree/ui';
import { useState } from 'react';

import type { SaveStatus } from '../hooks/useItemSaver';
import type { ReactNode } from 'react';

/** Props for `SaveNotice`. */
export interface SaveNoticeProps {
  readonly status: SaveStatus;
  /** What is not saved here, in words (`unsavedPhrase`). */
  readonly unsaved: string;
  /** The words of the unsaved notes and stickies, read when "Copy text" is pressed. */
  readonly unsavedText: () => string;
  /** Send every failed save again. */
  readonly onRetry: () => void;
  readonly onReload: () => void;
}

/**
 * "2 items", "1 item and the paper template", "the paper template": what is not saved, counted
 * by item (five nudges of one note are one unsaved item).
 *
 * @param items - Items that differ from the server.
 * @param template - True when the page's template is not saved either.
 * @returns The phrase; "nothing" when everything is saved.
 */
export function unsavedPhrase(items: number, template = false): string {
  const counted = items === 0 ? '' : items === 1 ? '1 item' : `${String(items)} items`;
  const paper = template ? 'the paper template' : '';
  return [counted, paper].filter(Boolean).join(' and ') || 'nothing';
}

function edits(n: number): string {
  return n === 1 ? '1 edit' : `${String(n)} edits`;
}

/** "Copy text", with a fallback that shows the words when the clipboard is not available. */
function CopyText({ text }: { text: () => string }): ReactNode {
  const [state, setState] = useState<'idle' | 'copied' | 'shown'>('idle');
  const words = text();
  if (words === '') return null;
  if (state === 'shown') {
    return (
      <textarea
        className="pt-nb-alert__text"
        aria-label="Your unsaved text"
        readOnly
        value={words}
      />
    );
  }
  return (
    <Button
      onClick={() => {
        navigator.clipboard.writeText(words).then(
          () => setState('copied'),
          () => setState('shown'),
        );
      }}
    >
      {state === 'copied' ? 'Copied' : 'Copy text'}
    </Button>
  );
}

/** The page's saving notices. */
export function SaveNotice(props: SaveNoticeProps): ReactNode {
  const { status, unsaved, onRetry, onReload } = props;
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (status.conflict) {
    return (
      <div className="pt-nb-alert" role="alert">
        <span>
          Not saved: this page changed somewhere else. Reload to see it (not saved here: {unsaved}).
        </span>
        <Button variant="primary" onClick={onReload}>
          Reload
        </Button>
      </div>
    );
  }
  if (status.pageGone) {
    return (
      <div className="pt-nb-alert" role="alert">
        <span>
          This page was deleted somewhere else, so nothing more can be saved here. Copy your text
          before you leave.
        </span>
        <CopyText text={props.unsavedText} />
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
      : status.recreated > 0
        ? {
            key: `recreated-${String(status.recreated)}`,
            message:
              'A note you changed had been deleted somewhere else. Your version is kept and saved again.',
          }
        : null;
  if (quiet === null || dismissed === quiet.key) return null;
  return (
    <Toast
      key={quiet.key}
      message={quiet.message}
      duration={0}
      onDismiss={() => setDismissed(quiet.key)}
    />
  );
}
