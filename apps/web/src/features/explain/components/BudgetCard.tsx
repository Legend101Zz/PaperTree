'use client';

/**
 * The daily-cap refusal (#204, frame 04c state 2): the card that replaces an answer when the
 * server's 24-hour spend cap refused the question before it was sent. Its figures and today's usage
 * by kind come from `GET /usage`. "Change the daily cap" is left out: the cap is a server setting
 * (`PAPERTREE_DAILY_BUDGET_USD`) with no place in the app to change it (#256), and a dead link
 * would promise one.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';

import { usageApi, type UsageTotals } from '@/lib/api/usage';

import { budgetFigures, usageRows } from '../model/states';

/** Props for `BudgetCard`. */
export interface BudgetCardProps {
  /** What was not sent and what was kept, true now (`refusalSentence`). */
  readonly lead: string;
}

function useUsage(): UsageTotals | null {
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  useEffect(() => {
    let live = true;
    usageApi.get().then(
      (totals) => {
        if (live) setUsage(totals);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return usage;
}

/** The refusal: what happened, the figures, what still works, and today's usage on request. */
export function BudgetCard({ lead }: BudgetCardProps): ReactNode {
  const usage = useUsage();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rows = usage === null ? [] : usageRows(usage);
  return (
    <div className="pt-budget-card" role="alert" data-error-code="budget_exhausted">
      <p className="pt-budget-card__title">
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
          <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 9v5M10 6.2v.1"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        Daily spend cap reached
      </p>
      {usage === null ? null : (
        <p className="pt-budget-card__figures" data-budget-detail>
          {budgetFigures(usage)}
        </p>
      )}
      <p>{lead} Reading, highlights, the board and cached summaries still work.</p>
      <p className="pt-budget-card__note">
        The cap is set by whoever runs this server and counts the last 24 hours, so questions work
        again as older ones age out.
      </p>
      {usage === null ? null : (
        <>
          <button
            type="button"
            className="pt-budget-card__usage"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((was) => !was)}
          >
            See today’s usage
          </button>
          <ul id={listId} className="pt-budget-card__rows" hidden={!open}>
            {rows.length === 0 ? <li>No AI work in the last 24 hours.</li> : null}
            {rows.map((row) => (
              <li key={row.kind}>
                <span className="pt-budget-card__kind">{row.kind}</span> {row.line}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
