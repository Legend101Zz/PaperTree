'use client';

/**
 * explain/RichText — the small subset of Markdown a model answer uses, rendered as React nodes
 * (never as HTML), with its `[bN]` handles turned into citation chips.
 *
 * The parsing lives in `lib/markdown` (pure, tested with hostile input); this file only turns the
 * tree into elements. Every string is a React text child, so `<` is text and nothing is injected.
 *
 * HANDLES. The model writes `[b3]` or `[b3, b4]`; the `citations` event (or the stored message)
 * says what each one points at. A handle with no citation is DROPPED, not shown: a reader cannot
 * act on "b9". While an answer is still streaming the citations have not arrived, so its handles
 * are hidden, and a half-typed `[b` at the end of the text never flashes on screen. A citation
 * whose handle the text never mentions is appended after the text, so no verified source is lost.
 *
 * `citeAs`: `chip` (the explain panel: a button that scrolls to the passage) or `label` (a canvas
 * card: a small "p. 4" that says where, with nothing to press). Either way a handle is never
 * shown as "[b3]".
 *
 * PUNCTUATION. A chip and the punctuation that directly follows it travel as one unbreakable run
 * (`.pt-cite-run`), so a sentence-final "." never wraps onto a line of its own.
 */
import { Fragment, type MouseEvent, type ReactNode } from 'react';

import {
  handlesInBlocks,
  parseMarkdown,
  type Block,
  type Inline,
} from '@/lib/markdown';
import type { Citation } from '@/lib/api/types';

import { CitationChip, citationPageLabel } from './CitationChip';
import { nearestChip } from './chipHit';

export interface RichTextProps {
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly streaming?: boolean;
  readonly citeAs?: 'chip' | 'label';
  readonly onCite?: (citation: Citation) => void;
}

/** A handle cut off by the end of a streaming chunk: `[`, `[b`, `[b12`, `[b1, b`. */
const PARTIAL_TAIL = /\s*\[(?:b\d*(?:\s*,\s*b?\d*)*)?$/;

interface Ctx {
  readonly byMarker: ReadonlyMap<string, Citation>;
  readonly streaming: boolean;
  readonly citeAs: 'chip' | 'label';
  readonly onCite: (citation: Citation) => void;
}

function renderInline(nodes: readonly Inline[], ctx: Ctx): ReactNode {
  return nodes.map((node, index) => {
    const key = String(index);
    switch (node.t) {
      case 'text':
        return <Fragment key={key}>{node.v}</Fragment>;
      case 'em':
        return <em key={key}>{renderInline(node.c, ctx)}</em>;
      case 'strong':
        return <strong key={key}>{renderInline(node.c, ctx)}</strong>;
      case 'code':
        return <code key={key}>{node.v}</code>;
      case 'cite': {
        if (ctx.streaming) return node.after === '' ? null : <Fragment key={key}>{node.after}</Fragment>;
        const found = node.markers.flatMap((marker) => {
          const citation = ctx.byMarker.get(marker);
          return citation === undefined ? [] : [citation];
        });
        if (found.length === 0) return node.after === '' ? null : <Fragment key={key}>{node.after}</Fragment>;
        return (
          <span className="pt-cite-run" key={key}>
            <span className="pt-chips">
              {found.map((citation) =>
                ctx.citeAs === 'chip' ? (
                  <CitationChip key={citation.citation_id} citation={citation} onFocus={ctx.onCite} />
                ) : (
                  <span key={citation.citation_id} className="pt-cite-label" data-cite-label>
                    {citationPageLabel(citation)}
                  </span>
                ),
              )}
            </span>
            {node.after}
          </span>
        );
      }
    }
  });
}

function renderBlock(block: Block, index: number, ctx: Ctx): ReactNode {
  switch (block.k) {
    case 'p':
      return (
        <p key={index}>
          {block.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 ? <br /> : null}
              {renderInline(line, ctx)}
            </Fragment>
          ))}
        </p>
      );
    case 'h':
      return (
        <p key={index} className="pt-md-heading">
          <strong>{renderInline(block.c, ctx)}</strong>
        </p>
      );
    case 'ul':
      return (
        <ul key={index}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, ctx)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={index} start={block.start}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, ctx)}</li>
          ))}
        </ol>
      );
  }
}

const NO_CITE = (): void => undefined;

let redirecting = false;

/**
 * Two chips on neighbouring lines can have overlapping 40 px hit areas, and the browser gives the
 * overlap to the later chip. A click that landed on a chip is handed to the chip whose pill is
 * nearest the pointer instead (`nearestChip`). Keyboard activation has no pointer position
 * (`detail === 0`) and is left alone.
 */
function redirectToNearestChip(event: MouseEvent<HTMLDivElement>): void {
  if (redirecting || event.detail === 0) return;
  const landed = (event.target as HTMLElement).closest<HTMLElement>('.pt-chip');
  if (landed === null) return;
  const chips = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.pt-chip'));
  const index = nearestChip(
    chips.map((chip) => chip.getBoundingClientRect()),
    event.clientX,
    event.clientY,
  );
  const meant = chips[index];
  if (meant === undefined || meant === landed) return;
  event.preventDefault();
  event.stopPropagation();
  redirecting = true;
  try {
    meant.click();
  } finally {
    redirecting = false;
  }
}

export function RichText({
  text,
  citations,
  streaming = false,
  citeAs = 'chip',
  onCite = NO_CITE,
}: RichTextProps): ReactNode {
  const ctx: Ctx = {
    byMarker: new Map(citations.map((c) => [c.marker, c] as const)),
    streaming,
    citeAs,
    onCite,
  };
  const cleaned = streaming ? text.replace(PARTIAL_TAIL, '') : text;
  const blocks = parseMarkdown(cleaned, { streaming });
  const mentioned = new Set(handlesInBlocks(blocks));
  const loose = streaming || citeAs === 'label' ? [] : citations.filter((c) => !mentioned.has(c.marker));
  return (
    <div className="pt-explain__prose" onClickCapture={redirectToNearestChip}>
      {blocks.map((block, index) => renderBlock(block, index, ctx))}
      {loose.length > 0 ? (
        <p className="pt-explain__loose">
          <span className="pt-chips">
            {loose.map((citation) => (
              <CitationChip key={citation.citation_id} citation={citation} onFocus={onCite} />
            ))}
          </span>
        </p>
      ) : null}
    </div>
  );
}
