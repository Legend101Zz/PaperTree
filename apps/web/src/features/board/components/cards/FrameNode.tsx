'use client';

/**
 * board/cards/FrameNode — a `group` row: a dashed outline with an editable name, behind the cards
 * it holds. Kept as v0.1 drew it; frames with paper tags are S6d (#214).
 */
import { NodeResizer, type NodeProps } from '@xyflow/react';

import { useCanvasActions } from '../BoardContext';
import { FallbackHandles } from '../CardPins';

import type { ReactNode } from 'react';
import type { PtNode } from '../../model/flow';

/** The API's limit on a group name (schemas.py). */
const GROUP_NAME_MAX = 200;

/** A frame around cards. */
export function FrameNode({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const ctx = useCanvasActions();
  const node = data.node;
  return (
    <div className="pt-cv-node pt-cv-node--group" data-kind="group" data-selected={selected}>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        handleClassName="pt-cv-resize"
        lineClassName="pt-cv-resize-line"
        onResizeEnd={(_, p) => ctx.commitSize(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      <input
        key={node.title ?? ''}
        className="pt-cv-group__title nodrag"
        aria-label="Group name"
        maxLength={GROUP_NAME_MAX}
        defaultValue={node.title ?? 'Group'}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => ctx.commitTitle(id, e.target.value)}
      />
      <FallbackHandles />
    </div>
  );
}
