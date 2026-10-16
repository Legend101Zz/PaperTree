/**
 * ui/trace — the numbered passages an AI answer stands on (v0.2, #190).
 *
 * `TraceList` is the third step of ask -> answer -> trace: an ordered list of rows, each a numbered
 * marker, its margin tab, where it sits and how often it is cited, the paper's own words, and a
 * "Show in paper" button. Hovering or focusing a marker lights its row (and the reverse) through
 * the `lit` / `onLight` pair, which the caller owns. The quote is the paper's voice, so it goes
 * through `PaperText`.
 */

import type { ReactNode } from 'react';

import { NumberedMarker, PageTab, formatPageLabel } from './citations.js';
import { PaperText } from './provenance.js';

/** One passage in the trace. */
export interface TraceRowData {
  /** The passage number the answer's markers use. */
  readonly n: number;
  /** 1-based page. */
  readonly page: number;
  /** 1-based paragraph, or null when only the page is known. */
  readonly para: number | null;
  /** Section it sits in, e.g. `"Introduction"`. */
  readonly where: string;
  /** How many times the answer cites it. */
  readonly citedCount: number;
  /** The paper's words, verbatim, without quotation marks. */
  readonly quote: string;
  readonly status: 'cited' | 'not-verified';
}

/** Props for `TraceRow`. */
export interface TraceRowProps extends TraceRowData {
  readonly lit?: boolean;
  readonly onLight?: (n: number | null) => void;
  readonly onShowInPaper: (n: number) => void;
  /** `touch` makes the whole row one 44 px button with a chevron and a two-line quote. */
  readonly layout?: 'desktop' | 'touch';
}

/**
 * The "cited" phrase of a row: `cited 2×`, `cited once`, or `not cited`.
 *
 * @param count How many times the answer cites the passage.
 * @returns The phrase.
 */
export function formatCitedCount(count: number): string {
  if (count <= 0) return 'not cited';
  return count === 1 ? 'cited once' : `cited ${String(count)}×`;
}

/** One passage: marker, tab, where, the paper's words, and a Show in paper button. */
export function TraceRow(props: TraceRowProps): ReactNode {
  const {
    n,
    page,
    para,
    where,
    citedCount,
    quote,
    status,
    lit = false,
    layout = 'desktop',
  } = props;
  const label = formatPageLabel(page, para);
  const className = `pt-trace-row${lit ? ' is-lit' : ''}${layout === 'touch' ? ' pt-trace-row--touch' : ''}`;
  const litProps = lit ? { 'aria-current': 'true' as const, 'data-lit': 'true' } : {};
  const quoted = (
    <PaperText as="span" className="pt-paper-quote pt-trace-row__quote">
      {`“${quote}”`}
    </PaperText>
  );
  const whereLine = (
    <span className="pt-trace-row__where">
      {where} · {formatCitedCount(citedCount)}
    </span>
  );

  if (layout === 'touch') {
    // One button for the whole row: nesting the marker button inside it would be invalid, so the
    // marker is drawn as its static face here.
    return (
      <li className={className} data-n={n} {...litProps}>
        <button
          type="button"
          className="pt-trace-row__touch"
          aria-label={`Show passage ${String(n)} in paper, ${label}`}
          onClick={() => props.onShowInPaper(n)}
        >
          <span className="pt-marker pt-marker--static" aria-hidden="true">
            {n}
          </span>
          <span className="pt-trace-row__body">
            <span className="pt-trace-row__head">
              <PageTab page={page} para={para} status={status} lit={lit} />
              {whereLine}
            </span>
            {quoted}
          </span>
          <span className="pt-trace-row__chevron" aria-hidden="true">
            ›
          </span>
        </button>
      </li>
    );
  }

  return (
    <li
      className={className}
      data-n={n}
      {...litProps}
      onMouseEnter={() => props.onLight?.(n)}
      onMouseLeave={() => props.onLight?.(null)}
    >
      <NumberedMarker
        n={n}
        label={label}
        lit={lit}
        notVerified={status === 'not-verified'}
        onFlash={() => props.onShowInPaper(n)}
        onLight={(on) => props.onLight?.(on ? n : null)}
      />
      <div className="pt-trace-row__body">
        <div className="pt-trace-row__head">
          <PageTab page={page} para={para} status={status} lit={lit} />
          {whereLine}
        </div>
        {quoted}
      </div>
      <button
        type="button"
        className="pt-btn pt-btn--outline pt-trace-row__show"
        aria-label={`Show passage ${String(n)} in paper`}
        onClick={() => props.onShowInPaper(n)}
      >
        Show in paper
      </button>
    </li>
  );
}

/** Props for `TraceList`. */
export interface TraceListProps {
  readonly rows: readonly TraceRowData[];
  /** The lit passage number, or null. */
  readonly lit?: number | null;
  readonly onLight?: (n: number | null) => void;
  readonly onShowInPaper: (n: number) => void;
  readonly layout?: 'desktop' | 'touch';
}

/** The passages an answer stands on, as an ordered list (the numbers are the citation numbers). */
export function TraceList({
  rows,
  lit = null,
  onLight,
  onShowInPaper,
  layout = 'desktop',
}: TraceListProps): ReactNode {
  return (
    <ol className="pt-trace-list" aria-label="Passages the answer stands on">
      {rows.map((row) => (
        <TraceRow
          key={row.n}
          {...row}
          lit={lit === row.n}
          layout={layout}
          onShowInPaper={onShowInPaper}
          {...(onLight === undefined ? {} : { onLight })}
        />
      ))}
    </ol>
  );
}
