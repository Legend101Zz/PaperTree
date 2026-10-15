'use client';

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

import { edgeText, type PtEdge } from './model';

/** A bezier edge whose words are always on it: the reader's label, or the kind it was given. */
export function LabeledEdge(props: EdgeProps<PtEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  });
  const edge = props.data?.edge;
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} className="pt-cv-edge" interactionWidth={28} />
      {edge === undefined ? null : (
        <EdgeLabelRenderer>
          <div
            className="pt-cv-edge-label nodrag nopan"
            data-testid="edge-label"
            data-selected={props.selected}
            data-kind={edge.kind}
            style={{ transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)` }}
          >
            {edgeText(edge)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { labeled: LabeledEdge };
