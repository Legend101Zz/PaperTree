'use client';

/**
 * board/components/ThreadEdge — one of the seven threads (DESIGN.md §5): its colour token AND its
 * second cue from `THREAD_LINES` (dashes with crosses, chevrons, an arrowhead, a doubled line,
 * dots, a fine line), and a paper tag at the middle with the kind's glyph and its words (the
 * reader's own label when there is one). Colour is never the only cue; the tag names it too.
 */
import { THREAD_LINES } from '@papertree/ui';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';

import { edgeText, type PtEdge } from '../model/flow';
import {
  curvePath,
  marksAlong,
  pointAt,
  tagTransform,
  threadCurve,
  threadInfo,
  threadKindOf,
  type ThreadCurve,
} from '../model/threads';

import type { ReactNode } from 'react';

/** The marks drawn on a thread, rotated with it at each `t`. */
function Marks({ curve, mark }: { curve: ThreadCurve; mark: 'cross' | 'chevron' }): ReactNode {
  const shape = mark === 'cross' ? 'M-4 -4l8 8M4 -4l-8 8' : 'M-6 -4l4 4l-4 4M0 -4l4 4l-4 4';
  // Chevrons sit as one pair mid-thread; crosses run its length.
  const at = mark === 'cross' ? marksAlong(curve, 28) : [0.5];
  return at.map((t) => {
    const p = pointAt(curve, t);
    return (
      <path
        key={t}
        className="pt-thread__mark"
        d={shape}
        transform={`translate(${String(p.x)} ${String(p.y)}) rotate(${String(p.angle)})`}
      />
    );
  });
}

/** A thread between two pins. */
export function ThreadEdge(props: EdgeProps<PtEdge>): ReactNode {
  const edge = props.data?.edge;
  const wire = edge?.kind ?? 'relates';
  const kind = threadKindOf(wire);
  const info = threadInfo(wire);
  const spec = THREAD_LINES[kind];
  const curve = threadCurve(
    { x: props.sourceX, y: props.sourceY },
    props.sourcePosition,
    { x: props.targetX, y: props.targetY },
    props.targetPosition,
  );
  const d = curvePath(curve);
  const end = pointAt(curve, 1);
  return (
    <g
      className="pt-thread"
      data-kind={kind}
      data-cue={info.cue}
      style={{ color: `var(--pt-wire-${kind})` }}
    >
      <path className="pt-thread__halo" d={d} />
      <BaseEdge
        id={props.id}
        path={d}
        className="pt-thread__line"
        interactionWidth={28}
        style={{
          strokeWidth: spec.doubled === true ? 6.5 : spec.width + 0.35,
          ...(spec.dash === undefined ? {} : { strokeDasharray: spec.dash }),
        }}
      />
      {spec.doubled === true ? <path className="pt-thread__inner" d={d} /> : null}
      {spec.marks === 'cross' || spec.marks === 'chevron' ? (
        <Marks curve={curve} mark={spec.marks} />
      ) : null}
      {spec.arrow === true ? (
        <path
          className="pt-thread__head"
          d="M-7 0L-19 -6L-19 6z"
          transform={`translate(${String(end.x)} ${String(end.y)}) rotate(${String(end.angle)})`}
        />
      ) : null}
      {edge === undefined ? null : (
        <EdgeLabelRenderer>
          <div
            className="pt-thread-tag nodrag nopan"
            data-kind={kind}
            data-selected={props.selected}
            style={{ transform: tagTransform(curve) }}
          >
            <span
              className="pt-thread-tag__glyph"
              aria-hidden="true"
              style={{ color: `var(--pt-wire-${kind})` }}
            >
              {info.glyph}
            </span>
            <span data-testid="edge-label">{edgeText(edge)}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

/** Edge type → the component that draws it. */
export const edgeTypes = { thread: ThreadEdge };
