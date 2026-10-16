'use client';

/**
 * The lasso's menu (S5d, #209, frame 05): Ask about this, Make sticky, Send to board, Copy and
 * Delete, in one row under the loop. It takes the keyboard when it opens (its first action on
 * offer); the arrow keys move along it, Home and End jump, Escape closes it (and keeps the lasso in
 * the hand). An action it cannot offer stays in its place, says why, and does nothing.
 */
import { MessageSquare } from 'lucide-react';
import { Fragment, useEffect, useRef } from 'react';

import { ACTION_NEEDS } from '../model/lasso';

import type { LassoAction } from '../model/lasso';
import type { KeyboardEvent, ReactNode } from 'react';

/** Props for `LassoMenu`. */
export interface LassoMenuProps {
  /** How many things the lasso holds (strokes and items). */
  readonly count: number;
  /** What each action needs (`enabledActions`). */
  readonly enabled: Readonly<Record<LassoAction, boolean>>;
  readonly onAction: (action: LassoAction) => void;
  readonly onClose: () => void;
}

const ACTIONS: readonly { action: LassoAction; label: string }[] = [
  { action: 'ask', label: 'Ask about this' },
  { action: 'sticky', label: 'Make sticky' },
  { action: 'board', label: 'Send to board' },
  { action: 'copy', label: 'Copy' },
  { action: 'delete', label: 'Delete' },
];

const MOVES: Readonly<Record<string, (i: number, n: number) => number>> = {
  ArrowRight: (i) => i + 1,
  ArrowDown: (i) => i + 1,
  ArrowLeft: (i) => i - 1,
  ArrowUp: (i) => i - 1,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

/** The menu under a closed lasso. */
export function LassoMenu({ count, enabled, onAction, onClose }: LassoMenuProps): ReactNode {
  const menu = useRef<HTMLDivElement>(null);
  const first = Math.max(
    0,
    ACTIONS.findIndex((a) => enabled[a.action]),
  );
  const buttons = (): HTMLButtonElement[] => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];
  useEffect(() => {
    buttons()[first]?.focus();
    // Once, when the menu opens: a later render must not pull the keyboard back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the window's Escape would put the lasso down too
      onClose();
      return;
    }
    const move = MOVES[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(move(at, all.length) + all.length) % all.length]?.focus();
  };
  return (
    <>
      <div
        ref={menu}
        role="menu"
        tabIndex={-1}
        aria-orientation="horizontal"
        aria-label={`Lasso selection, ${String(count)} ${count === 1 ? 'item' : 'items'}`}
        className="pt-nb-lasso-menu"
        onKeyDown={onKeyDown}
      >
        {ACTIONS.map((a, i) => (
          <Fragment key={a.action}>
            {a.action === 'delete' ? (
              <span className="pt-nb-tools__rule" role="separator" aria-orientation="vertical" />
            ) : null}
            <button
              type="button"
              role="menuitem"
              tabIndex={i === first ? 0 : -1}
              data-action={a.action}
              aria-disabled={enabled[a.action] ? undefined : true}
              aria-describedby={enabled[a.action] ? undefined : `pt-nb-lasso-needs-${a.action}`}
              title={enabled[a.action] ? undefined : ACTION_NEEDS[a.action]}
              onClick={() => {
                if (enabled[a.action]) onAction(a.action);
              }}
            >
              {a.action === 'ask' ? <MessageSquare size={16} aria-hidden /> : null}
              {a.label}
            </button>
          </Fragment>
        ))}
      </div>
      {ACTIONS.filter((a) => !enabled[a.action]).map((a) => (
        <span key={a.action} id={`pt-nb-lasso-needs-${a.action}`} className="pt-sr-only">
          {ACTION_NEEDS[a.action]}
        </span>
      ))}
    </>
  );
}
