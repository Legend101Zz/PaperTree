'use client';

/**
 * The paper summary as an exchange (#204, #340): the call slip "Summary of the whole paper"
 * (cached · 15 Oct), the bullets on the AI slip, each with one quiet source line, and the footer's
 * facts ("Cached 15 Oct · no new tokens used · made with M3") with Summarise again. There is no
 * readout and no passage list. Dive in and Send to board are left out: their APIs take a message,
 * not a summary (#258).
 */
import { AiSlip, CallSlip } from '@papertree/ui';
import { useMemo, type ReactNode } from 'react';

import { formatAskTime } from '../model/exchange';
import { buildSummary, shortModelName, summaryDay } from '../model/summary';
import { formatUsage } from './AnswerStates';
import { AnswerText } from './AnswerText';

import type { SummaryView as SummaryState } from '@/features/explain/model/state';
import type { Summary } from '@/lib/api/types';
import type { PaperSource } from '../model/answer';

/** Props for `SummaryExchange`. */
export interface SummaryExchangeProps {
  readonly summary: Summary;
  /** The controller's summary state: whether it was cached, the run's usage, the phase. */
  readonly state: SummaryState;
  /** The account's initial for the call slip. */
  readonly initial: string;
  /** The citation flash for a bullet's page. */
  readonly onShow: (source: PaperSource) => void;
  /** Summarise again: a new run, skipping the cache. */
  readonly onRegenerate: () => void;
}

/** What the footer can say, each fact from data. */
function footerFacts(summary: Summary, state: SummaryState): string {
  const made = `made with ${shortModelName(summary.model)}`;
  const day = summaryDay(summary.created_at);
  if (state.cached) return `Cached ${day} · no new tokens used · ${made}`;
  // A usage line always ends "(estimate)" (DESIGN §4.8), so the usage goes last.
  return [day, made, formatUsage(state.usage) ?? 'usage not reported'].join(' · ');
}

/**
 * The summary, drawn as ask → answer.
 *
 * @example
 * <SummaryExchange summary={s} state={state.summary} initial="M" onShow={flash} onRegenerate={again} />
 */
export function SummaryExchange({
  summary,
  state,
  initial,
  onShow,
  onRegenerate,
}: SummaryExchangeProps): ReactNode {
  const model = useMemo(() => buildSummary(summary), [summary]);
  const time = state.cached
    ? `cached · ${summaryDay(summary.created_at)}`
    : formatAskTime(summary.created_at);
  return (
    <div
      className="pt-exchange pt-summary-exchange"
      role="group"
      aria-label="Summary of the whole paper"
      data-summary-exchange
      data-summary-phase={state.phase}
    >
      <CallSlip
        initial={initial}
        ask="Summary of the whole paper"
        time={time}
        dateTime={summary.created_at}
      />
      <article className="pt-exchange__answer">
        <AiSlip model={shortModelName(summary.model)}>
          <ul className="pt-summary__bullets">
            {model.bullets.map((bullet) => (
              <li key={bullet.index} className="pt-summary__bullet" data-summary-bullet>
                <AnswerText paragraph={bullet} streaming={false} general onShow={onShow} />
              </li>
            ))}
          </ul>
        </AiSlip>
        <div className="pt-exchange__footer">
          <p
            className="pt-explain__usage"
            data-summary-footer
            {...(state.cached ? {} : { 'data-usage-line': '' })}
          >
            {footerFacts(summary, state)}
          </p>
          <div className="pt-explain__actions">
            <button type="button" className="pt-btn pt-btn--outline" onClick={onRegenerate}>
              Summarise again
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}
