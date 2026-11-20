'use client';

/**
 * board/cards/ImageCard — the root of a tree that starts from a picture: a figure, a table or a
 * region of the paper on an index card (v0.3 #348, item 5). Its strip carries the paper's swatch,
 * what it is, and the quiet source "Fig. 4 · p. 6", which opens the paper on it. The body is the
 * crop (asked of `crop-url` per card) with its caption beneath; the alt text is the caption and the
 * first answer's TL;DR. It is a `BranchCard` like the passage: every ask, follow-up and span branch
 * works on it the same way, and the server sends the crop with each.
 */
import { PaperText } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';
import { type ReactNode } from 'react';

import { CropImage } from '@/components/image/CropImage';

import { imageCardOf } from '../../model/imageCard';
import { childrenOf } from '../../model/tree';
import { useBranch } from '../BranchContext';
import { BranchCard } from '../tree/BranchCard';

import type { PtNode } from '../../model/flow';

/** An image card: an `excerpt` row whose anchor is an image anchor. */
export function ImageCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const branch = useBranch();
  const node = data.node;
  const firstAnswer = childrenOf(branch.tree, id).find(
    (child) => child.kind === 'explanation' && (child.final_text ?? '') !== '',
  );
  const view = imageCardOf(node.source_anchor, node.body, firstAnswer?.final_text);
  if (view === null) return null;
  return (
    <BranchCard
      id={id}
      kind="excerpt"
      stock="passage"
      label="Picture from the paper"
      selected={selected}
      characters={view.caption?.length ?? 0}
      strip={
        <>
          <span className="pt-tc__swatch" aria-hidden="true" />
          <span className="pt-tc__tag">picture</span>
          <span className="pt-tc__grow" />
          <button
            type="button"
            className="pt-tc__src nodrag"
            aria-label={`Show ${view.source} in the paper`}
            onClick={(event) => {
              event.stopPropagation();
              branch.openSource(id);
            }}
          >
            {view.source}
          </button>
        </>
      }
    >
      <CropImage paperId={branch.paperId} at={view.at} alt={view.alt} className="pt-tc__crop" />
      {view.caption === null ? null : (
        <PaperText as="p" className="pt-tc__caption">
          {view.caption}
        </PaperText>
      )}
    </BranchCard>
  );
}
