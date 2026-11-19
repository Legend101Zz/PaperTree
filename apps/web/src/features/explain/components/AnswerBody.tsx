'use client';

/**
 * An answer's body in the tutor format (v0.3, prototype Explain panel), shared by every surface
 * that shows an answer: the Explain panel, the board's explanation card and the notebook page. It
 * draws the answer's blocks in reading order: the small lower-case section labels, each paragraph
 * through `AnswerText` (the TL;DR as the lead), the answer's ONE quiet source line at the end of "In
 * the paper" (#340; an older unsectioned answer keeps a line under each paragraph with handles), the figure of a ```diagram fence, and, only where a `check` is handed in, the Check yourself block.
 *
 * Small surfaces pass no `check`: the block is heavy in a 328 px card (#349) and a notebook page
 * has no one to ask, so it is simply not drawn there, and never as raw text.
 */
import { SourceLine } from '@papertree/ui';

import { InlineDiagram } from '@/features/diagram';

import { SECTION_LABEL } from '../model/sections';
import { AnswerText, type AnswerTextProps } from './AnswerText';
import { CheckYourself } from './CheckYourself';

import './answer.css';

import type { ReactNode } from 'react';
import type { AnswerBlock } from '../model/answer';
import type { CheckState } from '../model/check';

/** What the panel hands in to draw the check block. */
export interface CheckControl {
  readonly state: CheckState;
  readonly onChange: (next: CheckState) => void;
}

/** Props for `AnswerBody`. */
export interface AnswerBodyProps extends Pick<AnswerTextProps, 'streaming' | 'onShow'> {
  readonly blocks: readonly AnswerBlock[];
  /**
   * Say "General knowledge" in the source line of an answer with no paper source. False until the
   * answer has settled: a handle may not have resolved yet, and the line must never flip.
   */
  readonly general: boolean;
  /** The phone sheet: each page answers taps over 44 px. */
  readonly touch?: boolean;
  /** The paragraph that ends the text so far: the typed caret sits on it while streaming. */
  readonly caretAt?: number | null;
  /** Present only in the Explain panel: the Check yourself block. */
  readonly check?: CheckControl | undefined;
}

/** The blocks of one answer. */
export function AnswerBody({
  blocks,
  streaming,
  general,
  onShow,
  touch = false,
  caretAt = null,
  check,
}: AnswerBodyProps): ReactNode {
  return blocks.map((block, i) => {
    switch (block.k) {
      case 'label':
        return (
          <h3 key={i} className="pt-ai-label" data-section={block.section}>
            {SECTION_LABEL[block.section]}
          </h3>
        );
      case 'p':
        return (
          <AnswerText
            key={i}
            paragraph={block.paragraph}
            streaming={streaming}
            caret={caretAt === block.paragraph.index}
            onShow={onShow}
            touch={touch}
          />
        );
      case 'source':
        return (
          <div key={i} className="pt-ai-slip__row pt-ai-sourceline">
            <SourceLine
              general={general}
              touch={touch}
              sources={block.sources.map((s) => ({
                page: s.page,
                passage: s.passage,
                onShow: () => onShow(s),
              }))}
            />
          </div>
        );
      case 'diagram':
        return <InlineDiagram key={i} body={block.body} closed={block.closed} />;
      case 'check':
        return check === undefined ? null : (
          <CheckYourself key={i} spec={block.spec} state={check.state} onChange={check.onChange} />
        );
    }
  });
}
