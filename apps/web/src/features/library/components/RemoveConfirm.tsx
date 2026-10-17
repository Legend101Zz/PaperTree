/**
 * RemoveConfirm: the inline confirmation before a paper is deleted (#195), shared by the catalogue
 * card and a Table row (#197). Danger is red ink, never a red fill; "Keep it" takes focus when it
 * appears, so the button that opened it vanishing never drops focus to the page. Keep it removes
 * this group, so `onKeep` puts focus back where the confirmation came from.
 */
'use client';

import { Button } from '@papertree/ui';
import { useEffect, useRef } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import type { ReactNode } from 'react';

/** Props for `RemoveConfirm`. */
export interface RemoveConfirmProps {
  /** The paper's title, for the group's name. */
  readonly title: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  /** Close the confirmation and focus what opened it (the card's Delete, the row's title). */
  readonly onKeep: () => void;
}

/**
 * "Delete this paper and its highlights?" with Delete paper and Keep it.
 *
 * @example
 * <RemoveConfirm title={book.title} busy={busy} onConfirm={remove} onKeep={() => setConfirming(false)} />
 */
export function RemoveConfirm({ title, busy, onConfirm, onKeep }: RemoveConfirmProps): ReactNode {
  const group = useRef<HTMLDivElement>(null);
  // `Button` does not forward refs, so Keep it is found by its mark.
  useEffect(() => {
    group.current?.querySelector<HTMLElement>('[data-keep-it]')?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={group}
      role="group"
      aria-label={`Confirm deleting ${title}`}
      className="pt-catalogue__confirm"
      data-delete-confirm=""
    >
      <p>Delete this paper and its highlights? This cannot be undone.</p>
      <Button
        variant="danger"
        size="touch"
        className={TOUCH_TARGET}
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? 'Deleting' : 'Delete paper'}
      </Button>
      <Button
        size="touch"
        className={TOUCH_TARGET}
        disabled={busy}
        data-keep-it=""
        onClick={onKeep}
      >
        Keep it
      </Button>
    </div>
  );
}
