'use client';

/**
 * board/cards/PassageCard — the root of a tree: the paper's own words on an index card (P4 step 7,
 * V3-29). The strip (the drag handle) carries the paper's colour swatch, "passage" and the page the
 * words are on ("p. 3", which opens the reader on them and flashes them). The words are in the
 * paper's serif, in full up to the 60% cap, then they scroll inside with a cue. Every card has an
 * Ask edge; this one starts the tree.
 */
import { PaperText } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';
import { type ReactNode } from 'react';

import { isImageAnchor } from '@/lib/imageAnchor';

import { anchorPageIndex } from '../../model/cards';
import { useBranch } from '../BranchContext';
import { BranchCard } from '../tree/BranchCard';
import { ImageCard } from './ImageCard';

import type { PtNode } from '../../model/flow';

/** A passage card: an `excerpt` row. One whose anchor is a picture is an image card instead. */
export function PassageCard(props: NodeProps<PtNode>): ReactNode {
  return isImageAnchor(props.data.node.source_anchor) ? (
    <ImageCard {...props} />
  ) : (
    <WordsCard {...props} />
  );
}

function WordsCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const branch = useBranch();
  const node = data.node;
  const page = anchorPageIndex(node.source_anchor);
  const words = node.body.replace(/\s+/g, ' ').trim();
  return (
    <BranchCard
      id={id}
      kind="excerpt"
      stock="passage"
      label="Passage from the paper"
      selected={selected}
      characters={words.length}
      strip={
        <>
          <span className="pt-tc__swatch" aria-hidden="true" />
          <span className="pt-tc__tag">passage</span>
          <span className="pt-tc__grow" />
          <button
            type="button"
            className="pt-tc__src nodrag"
            aria-label={
              page === null
                ? 'Open the passage in the paper'
                : `Show p. ${String(page + 1)} in the paper`
            }
            onClick={(event) => {
              event.stopPropagation();
              branch.openSource(id);
            }}
          >
            {page === null ? 'paper' : `p. ${String(page + 1)}`}
          </button>
        </>
      }
    >
      {words === '' ? (
        <p className="pt-tc__empty">No text was captured for this passage.</p>
      ) : (
        <PaperText as="blockquote" className="pt-tc__quote">
          {`“${words}”`}
        </PaperText>
      )}
    </BranchCard>
  );
}
