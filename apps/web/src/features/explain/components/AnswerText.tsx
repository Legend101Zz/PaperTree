'use client';

/**
 * One answer paragraph on the AI slip (#202): the safe Markdown subset of `lib/markdown`, with each
 * `[bN]` handle drawn as the numbered marker of its PASSAGE (`[b1, b8]` → markers 1 and 4), and the
 * margin cell that repeats marker + page tab level with the claim. While the answer streams, a
 * handle draws its marker as soon as it resolves (#204) and nothing before. The v0.1 per-citation chips
 * ("p. 3 p. 3 p. 3") are gone. Every string is a React text child; nothing is injected as HTML.
 */
import { AiParagraph, NumberedMarker, PageTab, formatPageLabel } from '@papertree/ui';
import { Fragment, type ReactNode } from 'react';

import { dehyphenate, parseMarkdown, type Block, type Inline } from '@/lib/markdown';

import type { AnswerParagraph, PassageMarker } from '../model/exchange';

/** How markers behave in one exchange: which is lit, and what hovering or clicking one does. */
export interface MarkerHandlers {
  /** Handle → passage number in this answer. */
  readonly handleNumbers: ReadonlyMap<string, number>;
  /** Passage number → its marker (page, ¶, the citation to flash). */
  readonly markers: ReadonlyMap<number, PassageMarker>;
  readonly lit: number | null;
  /** Hover or focus lights a passage everywhere in the exchange; null puts it out. */
  readonly onLight: (n: number | null) => void;
  /** The citation flash: scroll to the passage and flash it. */
  readonly onShow: (marker: PassageMarker) => void;
}

/** Props for `AnswerText`. */
export interface AnswerTextProps extends MarkerHandlers {
  readonly paragraph: AnswerParagraph;
  /** The answer is still arriving: an unclosed Markdown mark at the end is dropped. */
  readonly streaming: boolean;
  /** Draw the margin cell (the cited body); off for the uncited block. */
  readonly withMargin: boolean;
  /** The typed caret at the end of a streaming answer (frame 04b); decoration, hidden from AT. */
  readonly caret?: boolean;
}

function Marker({ marker, ctx }: { marker: PassageMarker; ctx: MarkerHandlers }): ReactNode {
  return (
    <NumberedMarker
      n={marker.n}
      label={formatPageLabel(marker.page, marker.para)}
      lit={ctx.lit === marker.n}
      notVerified={marker.notVerified}
      onFlash={() => ctx.onShow(marker)}
      onLight={(on) => ctx.onLight(on ? marker.n : null)}
    />
  );
}

function renderInline(nodes: readonly Inline[], ctx: MarkerHandlers): ReactNode {
  return nodes.map((node, index) => {
    const key = String(index);
    if (node.t !== 'cite') {
      if (node.t === 'text') return <Fragment key={key}>{node.v}</Fragment>;
      if (node.t === 'code') return <code key={key}>{node.v}</code>;
      const Tag = node.t;
      return <Tag key={key}>{renderInline(node.c, ctx)}</Tag>;
    }
    const numbers = [
      ...new Set(node.markers.flatMap((h) => ctx.handleNumbers.get(h) ?? [])),
    ].flatMap((n) => ctx.markers.get(n) ?? []);
    if (numbers.length === 0) {
      return node.after === '' ? null : <Fragment key={key}>{node.after}</Fragment>;
    }
    // The marker and the punctuation after it travel as one unbreakable run (`.pt-cite-run`).
    return (
      <span className="pt-cite-run" key={key}>
        {numbers.map((marker) => (
          <span
            key={marker.n}
            className="pt-exchange__inline-marker"
            data-passage={marker.n}
            data-citation-id={marker.citation.citation_id}
          >
            <Marker marker={marker} ctx={ctx} />
          </span>
        ))}
        {node.after}
      </span>
    );
  });
}

function renderBlock(block: Block, index: number, ctx: MarkerHandlers): ReactNode {
  if (block.k === 'p') {
    return block.lines.map((line, i) => (
      <Fragment key={`${String(index)}.${String(i)}`}>
        {i > 0 ? <br /> : null}
        {renderInline(line, ctx)}
      </Fragment>
    ));
  }
  if (block.k === 'h') return <strong key={index}>{renderInline(block.c, ctx)}</strong>;
  const items = block.items.map((item, i) => <li key={i}>{renderInline(item, ctx)}</li>);
  return block.k === 'ul' ? (
    <ul key={index}>{items}</ul>
  ) : (
    <ol key={index} start={block.start}>
      {items}
    </ol>
  );
}

/**
 * The margin cell: marker + tab for each passage the paragraph cites, level with it. A visual
 * echo of the inline markers (which are the buttons), so it is hidden from assistive tech and
 * from the Tab order; it lights with them.
 */
function MarginCell({ paragraph, ctx }: { paragraph: AnswerParagraph; ctx: MarkerHandlers }) {
  return paragraph.markers.map((marker) => (
    <span
      key={marker.n}
      className="pt-exchange__sidenote"
      aria-hidden="true"
      data-lit={ctx.lit === marker.n ? 'true' : undefined}
    >
      <span className={`pt-marker pt-marker--static${ctx.lit === marker.n ? ' is-lit' : ''}`}>
        {marker.n}
      </span>
      <PageTab
        page={marker.page}
        para={marker.para}
        status={marker.notVerified ? 'not-verified' : 'cited'}
        lit={ctx.lit === marker.n}
      />
    </span>
  ));
}

/** One paragraph of the answer, its markers inline and (on the cited body) in the margin. */
export function AnswerText({
  paragraph,
  streaming,
  withMargin,
  caret = false,
  ...ctx
}: AnswerTextProps): ReactNode {
  const blocks = parseMarkdown(dehyphenate(paragraph.text), { streaming });
  const aside = withMargin ? <MarginCell paragraph={paragraph} ctx={ctx} /> : undefined;
  const end = caret ? <span className="pt-exchange__caret" aria-hidden="true" /> : null;
  if (blocks.every((b) => b.k === 'p' || b.k === 'h')) {
    return (
      <AiParagraph aside={aside}>
        {blocks.map((b, i) => renderBlock(b, i, ctx))}
        {end}
      </AiParagraph>
    );
  }
  // AiParagraph is a <p>, which cannot hold a list: a list paragraph uses the same grid row.
  return (
    <div className="pt-ai-slip__row">
      <div className="pt-ai-slip__text">
        {blocks.map((b, i) => renderBlock(b, i, ctx))}
        {end}
      </div>
      <div className="pt-ai-slip__aside">{aside}</div>
    </div>
  );
}
