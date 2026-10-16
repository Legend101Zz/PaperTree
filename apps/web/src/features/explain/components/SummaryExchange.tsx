'use client';

/**
 * The paper summary as an exchange (#204, frame 04d): the call slip "Summary of the whole paper"
 * (cached · 15 Oct), the bullets on the AI slip with numbered markers (the open thread's numbers
 * for its passages) and "not verified" tabs, the footer's facts ("Cached 15 Oct · no new tokens
 * used · made with M3") with Summarise again, then the readout and the trace by page. Dive in and
 * Send to board are left out: their APIs take a message, not a summary (#258).
 */
import { AiSlip, CallSlip, TraceList } from '@papertree/ui';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { formatAskTime } from '../model/exchange';
import { buildSummary, shortModelName, summaryDay } from '../model/summary';
import { formatUsage } from './AnswerStates';
import { AnswerText } from './AnswerText';

import type { SummaryView as SummaryState } from '@/components/explain/useExplainActions';
import type { Summary } from '@/lib/api/types';
import type { PassageMarker } from '../model/answer';
import type { PassageNumbers } from '../model/passages';

/** Props for `SummaryExchange`. */
export interface SummaryExchangeProps {
  readonly summary: Summary;
  /** The controller's summary state: whether it was cached, the run's usage, the phase. */
  readonly state: SummaryState;
  /** The open thread's passage numbers (null when none is open). */
  readonly numbers: PassageNumbers | null;
  /** The account's initial for the call slip. */
  readonly initial: string;
  /** The citation flash for a passage. */
  readonly onShow: (marker: PassageMarker) => void;
  /** Summarise again: a new run, skipping the cache. */
  readonly onRegenerate: () => void;
}

const UNCITED = "no citation · the AI's own reading";

/** What the footer can say, each fact from data. */
function footerFacts(summary: Summary, state: SummaryState): string {
  const made = `made with ${shortModelName(summary.model)}`;
  const day = summaryDay(summary.created_at);
  if (state.cached) return `Cached ${day} · no new tokens used · ${made}`;
  return [day, formatUsage(state.usage) ?? 'usage not reported', made].join(' · ');
}

/**
 * The summary, drawn as ask → answer → trace.
 *
 * @example
 * <SummaryExchange summary={s} state={state.summary} numbers={null} initial="M" onShow={flash} onRegenerate={again} />
 */
export function SummaryExchange({
  summary,
  state,
  numbers,
  initial,
  onShow,
  onRegenerate,
}: SummaryExchangeProps): ReactNode {
  const [lit, setLit] = useState<number | null>(null);
  const model = useMemo(() => buildSummary(summary, numbers), [summary, numbers]);
  const showRow = useCallback(
    (n: number) => {
      const row = model.trace.find((r) => r.n === n);
      if (row === undefined) return;
      const { page, para, status, citation } = row;
      onShow({ n, page, para, notVerified: status === 'not-verified', citation, locator: null });
    },
    [model, onShow],
  );
  const partial = state.phase === 'partial' || summary.status === 'partial';
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
        {partial ? (
          <p className="pt-explain__warn" role="note" data-summary-warning>
            Some points could not be linked to a passage.
          </p>
        ) : null}
        <AiSlip model={shortModelName(summary.model)} source="from the paper" headingLevel={3}>
          <ul className="pt-summary__bullets">
            {model.bullets.map((bullet) => (
              <li
                key={bullet.paragraph.index}
                className="pt-summary__bullet"
                data-summary-bullet
                data-supported={String(bullet.supported)}
              >
                <AnswerText
                  paragraph={bullet.paragraph}
                  streaming={false}
                  withMargin
                  handleNumbers={model.handleNumbers}
                  markers={bullet.markers}
                  lit={lit}
                  onLight={setLit}
                  onShow={onShow}
                />
                {bullet.paragraph.cited ? null : (
                  <span className="pt-summary__uncited">{UNCITED}</span>
                )}
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
      <div className="pt-exchange__trace">
        <p className="pt-coverage" data-summary-readout>
          <span className="pt-coverage__icon" aria-hidden="true">
            ¶
          </span>
          <span>{model.readout}</span>
        </p>
        <TraceList
          rows={model.trace}
          lit={lit}
          onLight={setLit}
          onShowInPaper={showRow}
          label="Passages the summary stands on"
        />
      </div>
    </div>
  );
}
