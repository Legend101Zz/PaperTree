/**
 * ui/slips — the call slip (your ask) and the AI slip (its answer) of "ask -> answer -> trace"
 * (v0.2, #190, DESIGN.md §3-§4).
 *
 * Two stocks, two typefaces, so no one has to read a label to know who is speaking: the ask is on
 * ruled ivory in Courier Prime pen-ink (`YouText`); the answer is on AI-slip stock in the AI sans.
 * A quote from the paper inside the call slip stays in the paper's serif (`PaperText`).
 *
 * `AiSlip` does NOT compose `AiText`: `AiText` adds its own header with the reserved derived
 * marker and an "AI" label, which would duplicate this slip's standing "AI" tab and show the marker
 * twice. The slip therefore sets `data-voice="ai"` and the same `role="note"` announcement itself
 * and emits no marker.
 */

import type { ReactNode } from 'react';

import { PageTab } from './citations.js';
import { PaperText, YouText } from './provenance.js';

/** Props for `CallSlip`. */
export interface CallSlipProps {
  /** The account's initial, stamped in the circle. Default `M`. */
  readonly initial?: string;
  /** The passage the person selected, quoted from the paper. */
  readonly quote?: {
    readonly text: string;
    readonly page: number;
    readonly para?: number | null;
  };
  /** The ask, in the person's own words. */
  readonly ask: string;
  /** When it was asked, e.g. `"2:14 pm"`. */
  readonly time: string;
}

/** The person's ask on a ruled ivory slip: stamp, optional quoted passage, the ask, the time. */
export function CallSlip({ initial = 'M', quote, ask, time }: CallSlipProps): ReactNode {
  return (
    <section className="pt-call-slip" aria-label="Your question">
      <span className="pt-call-slip__stamp" aria-hidden="true">
        {initial}
      </span>
      <div className="pt-call-slip__main">
        {quote === undefined ? null : (
          <div className="pt-call-slip__quote">
            <PaperText as="span" className="pt-paper-quote pt-call-slip__quote-text">
              {`“${quote.text}”`}
            </PaperText>
            <PageTab page={quote.page} para={quote.para ?? null} />
          </div>
        )}
        <YouText className="pt-call-slip__ask">{ask}</YouText>
      </div>
      <time className="pt-call-slip__time">{time}</time>
    </section>
  );
}

/** Props for `AiSlip`. */
export interface AiSlipProps {
  /** The model, e.g. `"M3.1 Flash"`. */
  readonly model: string;
  /** What it read, e.g. `"from the paper"`. */
  readonly source: string;
  /** The answer: the caller renders paragraphs with their markers. */
  readonly children: ReactNode;
  /** Desktop margin column of marker + tab per claim. */
  readonly aside?: ReactNode;
  /** Usage line (an estimate) and actions. */
  readonly footer?: ReactNode;
  /** Uncited AI paragraphs; always labelled under a dashed rule. */
  readonly uncited?: ReactNode;
}

/** The AI's answer on AI-slip stock under a standing "AI" tab. */
export function AiSlip({
  model,
  source,
  children,
  aside,
  footer,
  uncited,
}: AiSlipProps): ReactNode {
  return (
    <section
      className="pt-ai-slip"
      data-voice="ai"
      role="note"
      aria-label={`AI answer by ${model}, not the paper's words`}
    >
      <span className="pt-ai-tab">AI</span>
      <p className="pt-ai-slip__source">
        {model} · {source}
      </p>
      <div className="pt-ai-slip__grid">
        <div className="pt-ai-slip__body">{children}</div>
        {aside === undefined ? null : <div className="pt-ai-slip__aside">{aside}</div>}
      </div>
      {uncited === undefined ? null : (
        <div className="pt-ai-slip__uncited">
          <h4 className="pt-ai-slip__uncited-head">no citation · the AI&apos;s own reading</h4>
          <div className="pt-ai-slip__uncited-body">{uncited}</div>
        </div>
      )}
      {footer === undefined ? null : <div className="pt-ai-slip__footer">{footer}</div>}
    </section>
  );
}
