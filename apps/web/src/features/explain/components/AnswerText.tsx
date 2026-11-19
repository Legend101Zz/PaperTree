'use client';

/**
 * One answer paragraph on the AI slip (#202, #340): the safe Markdown subset of `lib/markdown`,
 * then, where the paragraph owns one (an unsectioned older answer, a summary bullet), a quiet
 * source line `From the paper: p. 1 · p. 4`, only when it has handles: never "General knowledge"
 * under a paragraph. A sectioned (tutor format) answer has its one source line in `AnswerBody`,
 * at the end of "In the paper". The `[bN]` handles stay in the model's text and are never drawn:
 * the parser hands them over and this component only keeps the punctuation they carried. Each
 * page is a button: hover or focus peeks the passage, a click flashes it in the paper. Every
 * string is a React text child; nothing is injected as HTML.
 *
 * The tutor format's lead (the TL;DR paragraph) is set larger and carries no source line: it is
 * the whole idea in a breath, not a claim about the paper. A paragraph of display maths alone has
 * no words to stand a source under either.
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
  /** The typed caret at the end of a streaming answer (frame 04b); decoration, hidden from AT. */
  readonly caret?: boolean;
  /** The citation flash: scroll to the passage and flash it. */
  readonly onShow: (source: PaperSource) => void;
  /** The phone sheet: each page answers taps over 44 px. */
  readonly touch?: boolean;
}

/** Inline nodes as React: maths typeset, handles left to the source line (only their punctuation stays). */
export function renderInline(nodes: readonly Inline[]): ReactNode {
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

/** One Markdown block as React (a display equation, a paragraph's lines, a heading, a list). */
export function renderBlock(block: Block, index: number): ReactNode {
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

/** One paragraph of the answer and, when it owns one, its quiet source line. */
export function AnswerText({
  paragraph,
  streaming,
  caret = false,
  onShow,
  touch = false,
}: AnswerTextProps): ReactNode {
  const blocks = parseMarkdown(dehyphenate(paragraph.text), { streaming });
  const end = caret ? <span className="pt-exchange__caret" aria-hidden="true" /> : null;
  const lead = paragraph.section === 'tldr';
  const mathsOnly = blocks.every((b) => b.k === 'dm');
  const owns = paragraph.ownLine !== false && paragraph.sources.length > 0;
  const source =
    lead || mathsOnly || !owns ? undefined : (
      <SourceLine
        general={false}
        touch={touch}
        sources={paragraph.sources.map((s) => ({
          page: s.page,
          passage: s.passage,
          onShow: () => onShow(s),
        }))}
      />
    );
  const inline = blocks.every((b) => b.k === 'p' || b.k === 'h' || b.k === 'dm');
  if (lead && inline) {
    return (
      <div className="pt-ai-slip__row">
        <p className="pt-ai-slip__text pt-ai-lead">
          {blocks.map((b, i) => renderBlock(b, i))}
          {end}
        </p>
      </div>
    );
  }
  if (inline) {
    return (
      <AiParagraph {...(source === undefined ? {} : { source })}>
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
