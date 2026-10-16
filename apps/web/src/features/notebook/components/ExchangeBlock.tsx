'use client';

/**
 * The exchange a dived page starts from (S5c, #208, DESIGN.md §4): the call slip (your question,
 * in your voice), the AI slip (the answer, its markers numbered as the quote cards below it), and
 * the coverage line. The three voices go through the shared slips, so `data-voice` is `you`,
 * `paper` (the quoted passage) and `ai`. Collapsed, the slip shows its first paragraph.
 */
import { AiParagraph, AiSlip, CallSlip, CoverageReadout, PageTab } from '@papertree/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AnswerProse, paragraphNumbers } from './AnswerProse';
import { anchorQuote, dayAndTime, modelLabel, originPlace, usageLine } from '../model/exchange';

import type { Exchange } from '../hooks/useExchange';
import type { ExchangeBody } from '../model/wire';
import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

/** Props for `ExchangeBlock`. */
export interface ExchangeBlockProps {
  /** What Dive in stored on the page. */
  readonly body: ExchangeBody;
  /** The stored thread's answer and question (null while loading or when it cannot be read). */
  readonly exchange: Exchange;
  /** Scroll the paper to an Anchor and flash it. */
  readonly onFocusAnchor: (anchor: Anchor) => void;
}

function Margin({ numbers, exchange }: { numbers: number[]; exchange: Exchange }): ReactNode {
  if (numbers.length === 0) return null;
  return (
    <span className="pt-nb-exchange__margin" aria-hidden="true">
      {numbers.map((n) => {
        const passage = exchange.layout?.passages[n - 1];
        return (
          <span key={n} className="pt-nb-exchange__claim">
            <span className="pt-marker pt-marker--static">{n}</span>
            <PageTab page={passage?.page ?? 1} para={passage?.para ?? null} />
          </span>
        );
      })}
    </span>
  );
}

/** The call slip, the AI slip and the coverage line of a dived page. */
export function ExchangeBlock({ body, exchange, onFocusAnchor }: ExchangeBlockProps): ReactNode {
  const [open, setOpen] = useState(false);
  const { answer, question, layout } = exchange;
  const citations = useMemo(
    () => new Map((answer?.citations ?? []).map((c) => [c.marker, c] as const)),
    [answer],
  );
  const origin = body.call.originAnchor;
  const place = origin === null ? null : originPlace(origin, layout);
  const asked = question === null ? null : dayAndTime(question.created_at);
  const uncited = new Set(answer?.coverage?.uncited_paragraphs ?? []);
  const paragraphs = (layout?.paragraphs ?? [body.ai.content]).map((text, i) => ({ text, i }));
  const shown = open ? paragraphs : paragraphs.slice(0, 1);
  const prose = (text: string): ReactNode =>
    layout === null ? (
      text.replace(/\s*\[b\d+(?:\s*,\s*b\d+)*\]/g, '')
    ) : (
      <AnswerProse
        text={text}
        layout={layout}
        citations={citations}
        onFocusAnchor={onFocusAnchor}
      />
    );
  const cited = shown.filter((p) => !uncited.has(p.i));
  const own = shown.filter((p) => uncited.has(p.i));
  // Without the thread the handles cannot be numbered, so the slip says so instead of showing
  // claims with no marker as if they were uncited.
  const usage =
    layout === null && !exchange.loading
      ? 'Its citations could not be read; the passages it stood on are the cards below.'
      : usageLine(answer?.run ?? null);
  return (
    <section className="pt-nb-exchange" aria-label="The exchange this page started from">
      <CallSlip
        ask={body.call.text}
        time={asked === null ? '' : `${asked.day} · ${asked.time}`}
        {...(question === null ? {} : { dateTime: question.created_at })}
        {...(origin === null || place === null
          ? {}
          : { quote: { text: anchorQuote(origin), page: place.page, para: place.para } })}
      />
      <div className="pt-nb-exchange__answer" data-open={open ? 'true' : 'false'}>
        {paragraphs.length > 1 ? (
          <button
            type="button"
            className="pt-nb-exchange__toggle"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
            {open ? 'Collapse' : `Show all ${String(paragraphs.length)} paragraphs`}
          </button>
        ) : null}
        <AiSlip
          model={modelLabel(answer?.run?.model ?? body.ai.model)}
          source="from the paper"
          {...(own.length === 0
            ? {}
            : { uncited: own.map((p) => <p key={p.i}>{prose(p.text)}</p>) })}
          {...(usage === null
            ? {}
            : { footer: <span className="pt-nb-exchange__usage">{usage}</span> })}
        >
          {cited.map((p) => (
            <AiParagraph
              key={p.i}
              aside={
                layout === null ? null : (
                  <Margin numbers={paragraphNumbers(p.text, layout)} exchange={exchange} />
                )
              }
            >
              {prose(p.text)}
            </AiParagraph>
          ))}
        </AiSlip>
      </div>
      {answer?.coverage === undefined ? null : (
        <CoverageReadout
          passages={answer.coverage.passages}
          citations={answer.coverage.citations}
          uncitedParagraphs={answer.coverage.uncited_paragraphs.length}
        />
      )}
    </section>
  );
}
