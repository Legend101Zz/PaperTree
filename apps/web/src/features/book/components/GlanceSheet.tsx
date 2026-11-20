/**
 * GlanceSheet: the AI's map of the paper on the spread's right page (v0.3 #337; V3-AI-NOTES §5,
 * frames V3-33 and V3-15b). The gist, then Problem · Idea · How it works · Results · Limits, Read
 * first and five Words to know, under an "AI · Paper at a glance" tab with a quiet model line.
 *
 * NO PAGE MARKS AT REST. Each block is itself the link: it carries the page of the passage it comes
 * from, and on hover or focus a single quiet `p. 3 ›` appears at its end; a click opens the reader
 * there (`?from=book&page=3`, `usePageFromBook`). A block that cited nothing is plain text. Read
 * first names sections and needs no mark. There is no "Stands on", no "verified", no tab under a
 * label. Maths is `$…$` (KaTeX, `MathText`).
 *
 * It never waits on a spinner: until the sheet is made (`making`, or the first answer is still on
 * its way) the labels stand in their places over quiet hairlines (V3-15b) and a line says it is
 * being written and that reading can start now; the abstract above is always there. When no sheet
 * is coming (`none`, or the request failed) nothing is drawn: the abstract is the page.
 */
'use client';

import Link from 'next/link';

import { MathText } from '@/lib/MathText';

import { shortModel, type GlanceView } from '../model/book';
import { bookReaderHref } from '../hooks/useFromBook';

import type { Glance, GlanceBlock } from '../api/bookApi';
import type { ReactNode } from 'react';

/** Props for `GlanceSheet`. */
export interface GlanceSheetProps {
  readonly paperId: string;
  readonly view: GlanceView;
}

/** The labels, in the sheet's fixed order (V3-33). */
const LABELS = {
  problem: 'Problem',
  idea: 'Idea',
  how: 'How it works',
  results: 'Results',
  limits: 'Limits',
  readFirst: 'Read first',
  words: 'Words to know',
} as const;

/** The quiet `p. 3 ›` at a block's end: drawn on hover or focus only (the CSS), never at rest. */
function PageMark({ page }: { readonly page: number }): ReactNode {
  return (
    <span className="pt-glance__page" aria-hidden="true">
      {`p. ${String(page)} ›`}
    </span>
  );
}

/**
 * One labelled row. With a page it is a link to the reader there; without, plain.
 *
 * @example
 * <Row paperId="ppr_1" label="Problem" page={3}>words</Row>
 */
function Row({
  paperId,
  label,
  page,
  children,
}: {
  readonly paperId: string;
  readonly label: string;
  readonly page: number | null;
  readonly children: ReactNode;
}): ReactNode {
  const inner = (
    <>
      <span className="pt-glance__label">{label}</span>
      <span className="pt-glance__body">
        {children}
        {page === null ? null : <PageMark page={page} />}
      </span>
    </>
  );
  if (page === null) return <div className="pt-glance__row">{inner}</div>;
  return (
    <Link
      className="pt-glance__row pt-glance__row--link"
      href={bookReaderHref(paperId, { page })}
      data-glance-page={page}
    >
      {inner}
      <span className="pt-sr-only">{`, page ${String(page)}: show it in the paper`}</span>
    </Link>
  );
}

function BlockRow({
  paperId,
  label,
  block,
}: {
  readonly paperId: string;
  readonly label: string;
  readonly block: GlanceBlock;
}): ReactNode {
  return (
    <Row paperId={paperId} label={label} page={block.page}>
      <MathText text={block.text} />
    </Row>
  );
}

/** The made sheet. */
function Made({
  paperId,
  glance,
}: {
  readonly paperId: string;
  readonly glance: Glance;
}): ReactNode {
  const { results } = glance;
  return (
    <div className="pt-glance__sheet" data-glance="ready">
      <p className="pt-glance__gist">
        <MathText text={glance.gist} />
      </p>
      <BlockRow paperId={paperId} label={LABELS.problem} block={glance.problem} />
      <BlockRow paperId={paperId} label={LABELS.idea} block={glance.idea} />
      <BlockRow paperId={paperId} label={LABELS.how} block={glance.how} />
      <Row paperId={paperId} label={LABELS.results} page={results.page}>
        {results.numbers.length === 0 ? null : (
          <span className="pt-glance__numbers">
            {results.numbers.map((n) => (
              <span className="pt-glance__number" key={`${n.value}|${n.measures}`}>
                <span className="pt-glance__value">{n.value}</span>
                <span className="pt-glance__measures">{n.measures}</span>
              </span>
            ))}
          </span>
        )}
        {results.note === null ? null : (
          <span className="pt-glance__note">
            <MathText text={results.note} />
          </span>
        )}
      </Row>
      <BlockRow paperId={paperId} label={LABELS.limits} block={glance.limits} />
      <div className="pt-glance__dash" aria-hidden="true" />
      <Row paperId={paperId} label={LABELS.readFirst} page={null}>
        <MathText text={glance.read_first} />
      </Row>
      <div className="pt-glance__row">
        <span className="pt-glance__label">{LABELS.words}</span>
        <ul className="pt-glance__words">
          {glance.words.map((w) => (
            <li key={w.term}>
              <span className="pt-glance__term" title={w.gloss}>
                {w.term}
              </span>
              <span className="pt-sr-only">{`: ${w.gloss}`}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The sheet as it is made: the labels in their places over hairlines (V3-15b), no skeleton. */
function Making({ known }: { readonly known: boolean }): ReactNode {
  return (
    <div
      className="pt-glance__sheet pt-glance__sheet--making"
      data-glance="making"
      aria-busy="true"
    >
      {Object.values(LABELS).map((label) => (
        <div className="pt-glance__row" key={label}>
          <span className="pt-glance__label">{label}</span>
          <span className="pt-glance__hairline" aria-hidden="true" />
        </div>
      ))}
      <p className="pt-glance__status" role="status">
        <span className="pt-glance__dots" aria-hidden="true" />
        {known ? 'Writing it now. You can start reading.' : 'Looking for it…'}
      </p>
    </div>
  );
}

/**
 * The sheet, or the state it is in, or nothing.
 *
 * @example
 * <GlanceSheet paperId="ppr_1" view={{ kind: 'ready', glance }} />
 */
export function GlanceSheet({ paperId, view }: GlanceSheetProps): ReactNode {
  if (view.kind === 'none') return null;
  const model = view.kind === 'ready' ? shortModel(view.glance.model) : null;
  return (
    <section className="pt-glance" aria-label="Paper at a glance" data-glance-section="">
      <div className="pt-glance__tabs">
        <span className="pt-tab pt-glance__tab">AI</span>
        <span className="pt-glance__title">Paper at a glance</span>
        {model === null ? null : (
          <span
            className="pt-glance__model"
            title={`Written by ${model} from the paper's abstract and the opening of each section. The abstract above is the paper's own words.`}
          >
            {model}
          </span>
        )}
      </div>
      {view.kind === 'ready' ? (
        <Made paperId={paperId} glance={view.glance} />
      ) : (
        <Making known={view.known} />
      )}
    </section>
  );
}
