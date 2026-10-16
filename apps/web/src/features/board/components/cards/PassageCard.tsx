'use client';

/**
 * board/cards/PassageCard — the paper's own words on an index card (frame 06): the page tab from
 * the stored anchor, the quote in the paper's serif with its opening mark hung, and "Open source",
 * which opens the reader on the passage and flashes it (`useFocusFromCanvas`).
 */
import { PageTab, PaperText } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';

import { anchorPageIndex } from '../../model/cards';
import { CardShell } from './CardShell';
import { ClipBody } from './ClipBody';

import type { ReactNode } from 'react';
import type { PtNode } from '../../model/flow';

/** The page icon on "Open source" (DESIGN.md icons, 1.5 stroke). */
export function SourceIcon(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 2.8h6.2l3 3v11.4H5.5z" />
      <path d="M11.5 2.8v3.2h3.2M8 10h4.5M8 13h3" />
    </svg>
  );
}

/** A passage card: an `excerpt` row. */
export function PassageCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const node = data.node;
  const page = anchorPageIndex(node.source_anchor);
  return (
    <CardShell id={id} selected={selected} kind="excerpt" stock="card">
      <div className="pt-bc__tabs">
        {page === null ? <span className="pt-bc__tag">passage</span> : <PageTab page={page + 1} />}
      </div>
      <ClipBody>
        {node.body === '' ? (
          <p className="pt-bc__empty">No text was captured for this passage.</p>
        ) : (
          <PaperText as="blockquote" className="pt-bc__quote">
            {`“${node.body.replace(/\s+/g, ' ').trim()}”`}
          </PaperText>
        )}
      </ClipBody>
      <a
        className="pt-btn pt-btn--outline pt-bc__btn nodrag"
        href={`/paper/${encodeURIComponent(data.paperId)}/read?focus=${encodeURIComponent(id)}`}
      >
        <SourceIcon />
        Open source
      </a>
    </CardShell>
  );
}
