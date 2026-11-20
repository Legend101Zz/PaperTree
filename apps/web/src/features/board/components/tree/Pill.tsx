'use client';

/**
 * board/components/tree/Pill — a folded branch (P4 decision 5, #349): one line with the question
 * and "2 answers · 1 note". Click, or Enter, unfolds it. The grip at its left edge drags it, so
 * the button's own click stays a click.
 */
import type { ReactNode } from 'react';

/** Props for `Pill`. */
export interface PillProps {
  readonly id: string;
  /** The question of the folded card. */
  readonly label: string;
  /** "2 answers · 1 note". */
  readonly count: string;
  readonly onUnfold: () => void;
}

/** The pill that stands for a folded branch. */
export function Pill({ id, label, count, onUnfold }: PillProps): ReactNode {
  return (
    <div className="pt-pill" data-nid={id}>
      <span className="pt-pill__grip" aria-hidden="true" title="Drag the folded branch" />
      <button
        type="button"
        className="pt-pill__btn nodrag"
        aria-expanded={false}
        title="Unfold this branch"
        onClick={onUnfold}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="pt-pill__q">{label}</span>
        <span className="pt-pill__n">{count}</span>
      </button>
    </div>
  );
}
