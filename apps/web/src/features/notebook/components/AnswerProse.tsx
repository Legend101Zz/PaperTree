'use client';

/**
 * One paragraph of the dived-from answer on the notebook page (S5c, #208, #340): the model's words
 * with every `[bN]` handle left out (the paragraph's sources are one quiet line under it, drawn by
 * `ExchangeBlock`). Parsing is `lib/markdown`'s (no HTML path); only the punctuation a handle
 * carried is kept.
 */
import { Fragment } from 'react';

import { dehyphenate, parseMarkdown } from '@/lib/markdown';
import { Maths } from '@/lib/math';

import type { Inline } from '@/lib/markdown';
import type { ReactNode } from 'react';

/** Props for `AnswerProse`. */
export interface AnswerProseProps {
  /** One paragraph of the answer, handles included. */
  readonly text: string;
}

function Inlines({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.t) {
      case 'text':
        return <Fragment key={i}>{node.v}</Fragment>;
      case 'em':
        return (
          <em key={i}>
            <Inlines nodes={node.c} />
          </em>
        );
      case 'strong':
        return (
          <strong key={i}>
            <Inlines nodes={node.c} />
          </strong>
        );
      case 'code':
        return <code key={i}>{node.v}</code>;
      case 'math':
        return <Maths key={i} tex={node.tex} display={node.display} />;
      case 'cite':
        return node.after === '' ? null : <Fragment key={i}>{node.after}</Fragment>;
    }
  });
}

/** One paragraph of the answer, its handles left to the source line. */
export function AnswerProse({ text }: AnswerProseProps): ReactNode {
  const blocks = parseMarkdown(dehyphenate(text));
  return blocks.map((block, i) => {
    switch (block.k) {
      case 'dm':
        return <Maths key={i} tex={block.tex} display />;
      case 'p':
        return (
          <Fragment key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                <Inlines nodes={line} />
              </Fragment>
            ))}
          </Fragment>
        );
      case 'h':
        return (
          <strong key={i}>
            <Inlines nodes={block.c} />
          </strong>
        );
      case 'ul':
      case 'ol':
        return block.items.map((item, j) => (
          <Fragment key={`${String(i)}-${String(j)}`}>
            {j > 0 ? <br /> : null}• <Inlines nodes={item} />
          </Fragment>
        ));
    }
  });
}
