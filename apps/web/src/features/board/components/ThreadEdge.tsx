'use client';

/**
 * board/components/ThreadEdge — one of the seven threads (DESIGN.md §5): its colour token AND its
 * second cue from `THREAD_LINES` (dashes with crosses, chevrons, an arrowhead, a doubled line,
 * dots, a fine line), and a paper tag at the middle with the kind's glyph and its words (the
 * reader's own label when there is one). Colour is never the only cue; the tag names it too.
 *
 * At 500 cards (#215) a thread is memoised and its geometry (the curve, its marks, the head) is
 * worked out only when an end or the kind moves, not when the board re-renders around it.
 */
import { THREAD_LINES, THREAD_MARK_PATHS, markPositions, type ThreadLine } from '@papertree/ui';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';

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

/** Where the kind's marks (`THREAD_LINES`) sit along the thread, turned with it. */
function markTransforms(curve: ThreadCurve, line: ThreadLine): string[] {
  if (line.marks === undefined) return [];
  return tAtFractions(curve, markPositions(line, curveLength(curve))).map((t) => {
    const p = pointAt(curve, t);
    return `translate(${String(p.x)} ${String(p.y)}) rotate(${String(p.angle)})`;
  });
}

/** The kind's marks, at the places `markTransforms` worked out. */
function Marks({ at, line }: { at: readonly string[]; line: ThreadLine }): ReactNode {
  const marks = line.marks;
  if (marks === undefined) return null;
  return at.map((transform, i) => (
    <path
      key={i}
      className="pt-thread__mark"
      d={THREAD_MARK_PATHS[marks.shape]}
      transform={transform}
      {...(marks.weight === undefined ? {} : { strokeWidth: marks.weight })}
    />
  ));
}

/** A thread between two pins. */
export function ThreadEdge(props: EdgeProps<PtEdge>): ReactNode {
  const edge = props.data?.edge;
  const wire = edge?.kind ?? 'relates';
  const kind = threadKindOf(wire);
  const info = threadInfo(wire);
  const spec = THREAD_LINES[kind];
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  const { curve, d, end, marks } = useMemo(() => {
    const at = threadCurve(
      { x: sourceX, y: sourceY },
      sourcePosition,
      { x: targetX, y: targetY },
      targetPosition,
    );
    return {
      curve: at,
      d: curvePath(at),
      end: pointAt(at, 1),
      marks: markTransforms(at, THREAD_LINES[kind]),
    };
  }, [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, kind]);
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
      <Marks at={marks} line={spec} />
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

/** Edge type → the component that draws it, memoised. */
export const edgeTypes = { thread: memo(ThreadEdge) };
