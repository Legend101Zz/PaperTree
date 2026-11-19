'use client';

/**
 * One answer paragraph on the AI slip (#202, #340): the safe Markdown subset of `lib/markdown`,
 * then, under it, ONE quiet source line: `From the paper: p. 1 · p. 4`, or `General knowledge`
 * when the paragraph leans on no page. The `[bN]` handles stay in the model's text and are never
 * drawn: the parser hands them over and this component only keeps the punctuation they carried.
 * Each page is a button: hover or focus peeks the passage, a click flashes it in the paper.
 * Every string is a React text child; nothing is injected as HTML.
 */
import { AiParagraph, SourceLine } from '@papertree/ui';
import { Fragment, type ReactNode } from 'react';

import { Maths } from '@/lib/math';
import { dehyphenate, parseMarkdown, type Block, type Inline } from '@/lib/markdown';

import type { AnswerParagraph, PaperSource } from '../model/exchange';

/** Props for `AnswerText`. */
export interface AnswerTextProps {
  readonly paragraph: AnswerParagraph;
  /** The answer is still arriving: an unclosed Markdown mark at the end is dropped. */
  readonly streaming: boolean;
  /**
   * Say "General knowledge" under a paragraph with no paper source. False until the answer has
   * settled: a handle may not have resolved yet, and the line must never flip under the reader.
   */
  readonly general: boolean;
  /** The typed caret at the end of a streaming answer (frame 04b); decoration, hidden from AT. */
  readonly caret?: boolean;
  /** The citation flash: scroll to the passage and flash it. */
  readonly onShow: (source: PaperSource) => void;
  /** The phone sheet: each page answers taps over 44 px. */
  readonly touch?: boolean;
}

function renderInline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((node, index) => {
    const key = String(index);
    if (node.t === 'cite') {
      // The handle is gathered into the source line; only the punctuation it carried is drawn.
      return node.after === '' ? null : <Fragment key={key}>{node.after}</Fragment>;
    }
    if (node.t === 'text') return <Fragment key={key}>{node.v}</Fragment>;
    if (node.t === 'code') return <code key={key}>{node.v}</code>;
    if (node.t === 'math') return <Maths key={key} tex={node.tex} display={node.display} />;
    const Tag = node.t;
    return <Tag key={key}>{renderInline(node.c)}</Tag>;
  });
}

function renderBlock(block: Block, index: number): ReactNode {
  if (block.k === 'dm') return <Maths key={index} tex={block.tex} display />;
  if (block.k === 'p') {
    return block.lines.map((line, i) => (
      <Fragment key={`${String(index)}.${String(i)}`}>
        {i > 0 ? <br /> : null}
        {renderInline(line)}
      </Fragment>
    ));
  }
  if (block.k === 'h') return <strong key={index}>{renderInline(block.c)}</strong>;
  const items = block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>);
  return block.k === 'ul' ? (
    <ul key={index}>{items}</ul>
  ) : (
    <ol key={index} start={block.start}>
      {items}
    </ol>
  );
}

/** One paragraph of the answer and its one quiet source line. */
export function AnswerText({
  paragraph,
  streaming,
  general,
  caret = false,
  onShow,
  touch = false,
}: AnswerTextProps): ReactNode {
  const blocks = parseMarkdown(dehyphenate(paragraph.text), { streaming });
  const end = caret ? <span className="pt-exchange__caret" aria-hidden="true" /> : null;
  const source = (
    <SourceLine
      general={general}
      touch={touch}
      sources={paragraph.sources.map((s) => ({
        page: s.page,
        passage: s.passage,
        onShow: () => onShow(s),
      }))}
    />
  );
  if (blocks.every((b) => b.k === 'p' || b.k === 'h' || b.k === 'dm')) {
    return (
      <AiParagraph source={source}>
        {blocks.map((b, i) => renderBlock(b, i))}
        {end}
      </AiParagraph>
    );
  }
  // AiParagraph is a <p>, which cannot hold a list: a list paragraph uses the same row.
  return (
    <div className="pt-ai-slip__row">
      <div className="pt-ai-slip__text">
        {blocks.map((b, i) => renderBlock(b, i))}
        {end}
      </div>
      {source}
    </div>
  );
}
