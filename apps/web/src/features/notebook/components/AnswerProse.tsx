'use client';

/**
 * One paragraph of the dived-from answer on the notebook page (S5c, #208): the model's words with
 * every `[bN]` handle drawn as the passage's numbered marker, which flashes that passage in the
 * paper. Parsing is `lib/markdown`'s (no HTML path); a handle with no stored citation is dropped,
 * as the explain panel drops it, because a reader cannot act on "b9".
 */
import { NumberedMarker, formatPageLabel } from '@papertree/ui';
import { Fragment } from 'react';

import { dehyphenate, parseMarkdown } from '@/lib/markdown';

import type { AnswerLayout } from '../model/exchange';
import type { Citation } from '@/lib/api/types';
import type { Inline } from '@/lib/markdown';
import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

/** Props for `AnswerProse`. */
export interface AnswerProseProps {
  /** One paragraph of the answer, handles included. */
  readonly text: string;
  readonly layout: AnswerLayout;
  /** Handle → the stored citation (for the Anchor a marker flashes). */
  readonly citations: ReadonlyMap<string, Citation>;
  /** Scroll the paper to an Anchor and flash it. */
  readonly onFocusAnchor: (anchor: Anchor) => void;
}

/**
 * The passage numbers of a paragraph, deduplicated in reading order, for its margin cell.
 *
 * @param text - The paragraph.
 * @param layout - The answer's layout.
 * @returns The numbers.
 */
export function paragraphNumbers(text: string, layout: AnswerLayout): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\[(b\d+(?:\s*,\s*b\d+)*)\]/g)) {
    for (const handle of (m[1] ?? '').split(',')) {
      const n = layout.numberOf.get(handle.trim());
      if (n !== undefined && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

function Inlines({
  nodes,
  props,
}: {
  nodes: readonly Inline[];
  props: AnswerProseProps;
}): ReactNode {
  return nodes.map((node, i) => {
    switch (node.t) {
      case 'text':
        return <Fragment key={i}>{node.v}</Fragment>;
      case 'em':
        return (
          <em key={i}>
            <Inlines nodes={node.c} props={props} />
          </em>
        );
      case 'strong':
        return (
          <strong key={i}>
            <Inlines nodes={node.c} props={props} />
          </strong>
        );
      case 'code':
        return <code key={i}>{node.v}</code>;
      case 'cite': {
        const seen = new Set<number>();
        const markers = node.markers.flatMap((handle) => {
          const citation = props.citations.get(handle);
          const n = props.layout.numberOf.get(handle);
          if (citation === undefined || n === undefined || seen.has(n)) return [];
          seen.add(n);
          const passage = props.layout.passages[n - 1];
          return (
            <NumberedMarker
              key={handle}
              n={n}
              label={formatPageLabel(passage?.page ?? 1, passage?.para ?? null)}
              notVerified={citation.supported === false}
              onFlash={() => props.onFocusAnchor(citation.anchor)}
            />
          );
        });
        return (
          <span key={i} className="pt-cite-run">
            {markers}
            {node.after}
          </span>
        );
      }
    }
  });
}

/** One paragraph of the answer, its markers live. */
export function AnswerProse(props: AnswerProseProps): ReactNode {
  const blocks = parseMarkdown(dehyphenate(props.text));
  return blocks.map((block, i) => {
    switch (block.k) {
      case 'p':
        return (
          <Fragment key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                <Inlines nodes={line} props={props} />
              </Fragment>
            ))}
          </Fragment>
        );
      case 'h':
        return (
          <strong key={i}>
            <Inlines nodes={block.c} props={props} />
          </strong>
        );
      case 'ul':
      case 'ol':
        return block.items.map((item, j) => (
          <Fragment key={`${String(i)}-${String(j)}`}>
            {j > 0 ? <br /> : null}• <Inlines nodes={item} props={props} />
          </Fragment>
        ));
    }
  });
}
