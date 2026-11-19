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
 *
 * Every visible or announced word the slips add is a prop with its design default, so the notebook
 * and the diagram pages can reuse them in their own words.
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
    /** 1-based; null when the passage's page is not known, and then no tab is drawn. */
    readonly page: number | null;
    readonly para?: number | null;
  };
  /** The ask, in the person's own words. */
  readonly ask: string;
  /** When it was asked, e.g. `"2:14 pm"`. Omitted where the time is not shown (a board card). */
  readonly time?: string;
  /** Machine-readable time for `<time dateTime>`, e.g. an ISO string. Omitted when unknown. */
  readonly dateTime?: string;
  /**
   * The group's accessible name. Default `Your question`. A thread repeats this slip, so it is a
   * labelled group and not a landmark.
   */
  readonly label?: string;
}

/** The person's ask on a ruled ivory slip: stamp, optional quoted passage, the ask, the time. */
export function CallSlip({
  initial = 'M',
  quote,
  ask,
  time,
  dateTime,
  label = 'Your question',
}: CallSlipProps): ReactNode {
  return (
    <div className="pt-call-slip" role="group" aria-label={label}>
      <span className="pt-call-slip__stamp" aria-hidden="true">
        {initial}
      </span>
      <div className="pt-call-slip__main">
        {quote === undefined ? null : (
          <div className="pt-call-slip__quote">
            <PaperText as="span" className="pt-paper-quote pt-call-slip__quote-text">
              {`“${quote.text}”`}
            </PaperText>
            {quote.page === null ? null : <PageTab page={quote.page} para={quote.para ?? null} />}
          </div>
        )}
        <YouText className="pt-call-slip__ask">{ask}</YouText>
      </div>
      {time === undefined ? null : (
        <time className="pt-call-slip__time" {...(dateTime === undefined ? {} : { dateTime })}>
          {time}
        </time>
      )}
    </div>
  );
}

/** Props for `AiParagraph`. */
export interface AiParagraphProps {
  /** The paragraph's text. */
  readonly children: ReactNode;
  /** The quiet source line under it (`SourceLine`), when it has one to draw. */
  readonly source?: ReactNode;
}

/**
 * One paragraph of an `AiSlip` answer and, under it, its one quiet source line. Both are one row
 * of the slip's grid, so a paragraph never loses its line to the next one.
 *
 * @example
 * <AiParagraph source={<SourceLine sources={pages} />}>The passage states the proposal.</AiParagraph>
 */
export function AiParagraph({ children, source }: AiParagraphProps): ReactNode {
  return (
    <div className="pt-ai-slip__row">
      <p className="pt-ai-slip__text">{children}</p>
      {source}
    </div>
  );
}

/** Props for `AiSlip`. */
export interface AiSlipProps {
  /**
   * The model, e.g. `"M3.1 Flash"`. Omitted where the slip is too small for the line beside its
   * tab (a board card): then no model line is drawn and the label names no model.
   */
  readonly model?: string;
  /** The answer: `AiParagraph`s or any other content. */
  readonly children: ReactNode;
  /** Usage line (an estimate) and actions. */
  readonly footer?: ReactNode;
  /** The standing tab's text. Default `AI`. */
  readonly tabLabel?: string;
  /**
   * Replaces the model line beside the tab while the answer is not simply done: the working label
   * as it streams, `Stopped · M3.1 Flash` after Stop. Inline content only (it sits in a `<p>`).
   * The slip's accessible name still names the model.
   */
  readonly meta?: ReactNode;
}

/** The AI's answer on AI-slip stock under a standing "AI" tab. */
export function AiSlip({ model, children, footer, tabLabel = 'AI', meta }: AiSlipProps): ReactNode {
  return (
    <section
      className="pt-ai-slip"
      data-voice="ai"
      role="note"
      aria-label={`${tabLabel} answer${model === undefined ? '' : ` by ${model}`}, not the paper's words`}
    >
      <span className="pt-ai-tab">{tabLabel}</span>
      {meta !== undefined ? (
        <p className="pt-ai-slip__source">{meta}</p>
      ) : model === undefined ? null : (
        <p className="pt-ai-slip__source">{model}</p>
      )}
      <div className="pt-ai-slip__grid">{children}</div>
      {footer === undefined ? null : <div className="pt-ai-slip__footer">{footer}</div>}
    </section>
  );
}
