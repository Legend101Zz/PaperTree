'use client';

/**
 * board/cards/FrameNode — a frame (the wire's `group`, frame 06): a dashed outline behind the cards
 * it holds, with a paper tag that names it. The tag is the frame's handle: a drag on it moves the
 * frame, and the controller carries its cards along; a press anywhere inside the outline reaches
 * the board, so cards in a frame are panned past and area-selected as anywhere else. The name is
 * typed in place on the tag; a new frame (Add frame) opens with its name selected (#214).
 */
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, type ReactNode } from 'react';

import { useCanvasActions } from '../BoardContext';
import { FallbackHandles } from '../CardPins';

import type { PtNode } from '../../model/flow';

/** The API's limit on a frame name (schemas.py). */
const FRAME_NAME_MAX = 200;

/** A frame around cards. */
export function FrameNode({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const ctx = useCanvasActions();
  const name = data.node.title ?? 'Frame';
  const naming = ctx.editingId === id;
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!naming) return;
    field.current?.focus();
    field.current?.select();
  }, [naming]);

  const done = (value: string): void => {
    ctx.commitTitle(id, value);
    if (naming) ctx.setEditingId(null);
  };

  return (
    <div className="pt-frame" data-kind="group" data-selected={selected}>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        handleClassName="pt-cv-resize"
        lineClassName="pt-cv-resize-line"
        onResizeEnd={(_, p) => ctx.commitSize(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      <div className="pt-frame__tag" title="Drag the tag to move the frame and its cards.">
        <span className="pt-frame__grip" aria-hidden="true" />
        <input
          ref={field}
          key={name}
          className="pt-frame__name nodrag"
          data-voice="you"
          aria-label="Frame name"
          maxLength={FRAME_NAME_MAX}
          // Sized to its words (where `field-sizing` is not supported, the CSS falls back to this).
          size={Math.min(32, Math.max(6, name.length + 1))}
          defaultValue={name}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = name;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => done(e.target.value)}
        />
      </div>
      <FallbackHandles />
    </div>
  );
}
