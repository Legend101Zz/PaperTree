'use client';

/**
 * board/components/ThreadEdge — one of the seven threads (DESIGN.md §5): its colour token AND its
 * second cue from `THREAD_LINES` (dashes with crosses, chevrons, an arrowhead, a doubled line,
 * dots, a fine line), and a paper tag at the middle with the kind's glyph and its words (the
 * reader's own label when there is one). Colour is never the only cue; the tag names it too.
 */
import { THREAD_LINES, THREAD_MARK_PATHS, markPositions, type ThreadLine } from '@papertree/ui';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';

import { edgeText, type PtEdge } from '../model/flow';
import {
  curveLength,
  curvePath,
  pointAt,
  tAtFractions,
  tagTransform,
  threadCurve,
  threadInfo,
  threadKindOf,
  type ThreadCurve,
} from '../model/threads';

import type { ReactNode } from 'react';

/** The kind's marks (`THREAD_LINES`), placed along the thread and turned with it. */
function Marks({ curve, line }: { curve: ThreadCurve; line: ThreadLine }): ReactNode {
  const marks = line.marks;
  if (marks === undefined) return null;
  const at = tAtFractions(curve, markPositions(line, curveLength(curve)));
  return at.map((t, i) => {
    const p = pointAt(curve, t);
    return (
      <path
        key={i}
        className="pt-thread__mark"
        d={THREAD_MARK_PATHS[marks.shape]}
        transform={`translate(${String(p.x)} ${String(p.y)}) rotate(${String(p.angle)})`}
        {...(marks.weight === undefined ? {} : { strokeWidth: marks.weight })}
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
      <Marks curve={curve} line={spec} />
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
