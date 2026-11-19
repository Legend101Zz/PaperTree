'use client';

/**
 * The exchange a dived page starts from (S5c, #208, #340, DESIGN.md §4): the call slip (your
 * question, in your voice) and the AI slip (the answer, each paragraph with one quiet source
 * line). The voices go through the shared slips, so `data-voice` is `you`, `paper` (the quoted
 * passage) and `ai`. Collapsed, the slip shows its first paragraph. On a phone (S5e, #210, frame
 * 08c) "Read the whole answer" sits in the slip's foot with how many paragraphs it holds back.
 */
import { AiParagraph, AiSlip, CallSlip, SourceLine } from '@papertree/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { handleRuns } from '@/features/explain/model/passages';
import { sourcesOf } from '@/features/explain/model/answer';

import { AnswerProse } from './AnswerProse';
import { anchorQuote, dayAndTime, modelLabel, originPlace, usageLine } from '../model/exchange';

import type { Exchange } from '../hooks/useExchange';
import type { ExchangeBody } from '../model/wire';
import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

/**
 * "1 more paragraph" or "4 more paragraphs": what "Read the whole answer" holds back.
 *
 * @param n - Paragraphs not shown.
 * @returns The phrase.
 */
export function moreParagraphs(n: number): string {
  return `${String(n)} more paragraph${n === 1 ? '' : 's'}`;
}

/** Props for `ExchangeBlock`. */
export interface ExchangeBlockProps {
  /** What Dive in stored on the page. */
  readonly body: ExchangeBody;
  /** The stored thread's answer and question (null while loading or when it cannot be read). */
  readonly exchange: Exchange;
  /** Scroll the paper to an Anchor and flash it. */
  readonly onFocusAnchor: (anchor: Anchor) => void;
  /** True when the notebook search matched it: lit on screen, and said. */
  readonly matched?: boolean;
  /** The phone's stack (08c). */
  readonly phone?: boolean;
}

/** The call slip and the AI slip of a dived page. */
export const ExchangeBlock = memo(function ExchangeBlock({
  body,
  exchange,
  onFocusAnchor,
  matched = false,
  phone = false,
}: ExchangeBlockProps): ReactNode {
  const [open, setOpen] = useState(false);
  const { answer, question, layout } = exchange;
  const citations = useMemo(
    () => new Map((answer?.citations ?? []).map((c) => [c.marker, c] as const)),
    [answer],
  );
  const origin = body.call.originAnchor;
  const place = origin === null ? null : originPlace(origin, layout);
  const asked = question === null ? null : dayAndTime(question.created_at);
  const paragraphs = (layout?.paragraphs ?? [body.ai.content]).map((text, i) => ({ text, i }));
  const shown = open ? paragraphs : paragraphs.slice(0, 1);
  // Without the thread the handles cannot be resolved, so no source line is drawn at all: a
  // paragraph is never called "general knowledge" on no evidence.
  const source = (text: string): ReactNode =>
    layout === null ? null : (
      <SourceLine
        sources={sourcesOf(
          handleRuns(text)
            .flat()
            .flatMap((h) => citations.get(h) ?? []),
        ).map((s) => ({
          page: s.page,
          passage: s.passage,
          onShow: () => onFocusAnchor(s.citation.anchor),
        }))}
        touch={phone}
      />
    );
  const usage =
    layout === null && !exchange.loading
      ? 'Its sources could not be read; the passages it drew on are the cards below.'
      : usageLine(answer?.run ?? null);
  return (
    <section
      className="pt-nb-exchange"
      aria-label={`The exchange this page started from${matched ? ' (matches your search)' : ''}`}
    >
      <CallSlip
        ask={body.call.text}
        time={asked === null ? '' : `${asked.day} · ${asked.time}`}
        {...(question === null ? {} : { dateTime: question.created_at })}
        {...(origin === null || place === null
          ? {}
          : { quote: { text: anchorQuote(origin), page: place.page, para: place.para } })}
      />
      <div className="pt-nb-exchange__answer" data-open={open ? 'true' : 'false'}>
        {paragraphs.length > 1 && !phone ? (
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
          {...(usage === null && !(phone && paragraphs.length > 1)
            ? {}
            : {
                footer: (
                  <>
                    {phone && paragraphs.length > 1 ? (
                      <span className="pt-nb-exchange__more">
                        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
                          {open ? 'Show less' : 'Read the whole answer'}
                        </button>
                        {open ? null : <span>{moreParagraphs(paragraphs.length - 1)}</span>}
                      </span>
                    ) : null}
                    {usage === null ? null : <span className="pt-nb-exchange__usage">{usage}</span>}
                  </>
                ),
              })}
        >
          {shown.map((p) => (
            <AiParagraph key={p.i} source={source(p.text)}>
              <AnswerProse text={p.text} />
            </AiParagraph>
          ))}
        </AiSlip>
      </div>
    </section>
  );
});
