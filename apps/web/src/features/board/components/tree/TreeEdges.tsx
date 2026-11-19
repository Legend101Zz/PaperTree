'use client';

/**
 * board/components/tree/TreeEdges — the lines from each card to its children, drawn in board
 * coordinates under the same pan and zoom as the cards (xyflow's viewport portal). The layout owns
 * the end points (`PlacedEdge`): a down line runs from the foot of a card to the head of its next
 * turn; a right line leaves the parent's RIGHT PADDING at the height of the words it grew from, so
 * it can never read as an underline (#349), and enters the child at its left edge.
 *
 * Solid ink = it exists. Dashed navy = not there yet (the ask box being written). Lines of cards
 * off the focused path dim with them.
 */
import { ViewportPortal } from '@xyflow/react';
import { type ReactNode } from 'react';

import { DRAFT_ID } from '../../model/display';

import type { BoardLayout, PlacedEdge } from '../../model/layout';

/** The SVG path of one edge. */
export function edgePath(edge: PlacedEdge): string {
  const { from, to } = edge;
  if (edge.branch === 'down') {
    const mid = from.y + (to.y - from.y) / 2;
    return `M${String(from.x)} ${String(from.y)} C${String(from.x)} ${String(mid)} ${String(to.x)} ${String(mid)} ${String(to.x)} ${String(to.y)}`;
  }
  const reach = Math.max(24, (to.x - from.x) / 2);
  return `M${String(from.x)} ${String(from.y)} C${String(from.x + reach)} ${String(from.y)} ${String(to.x - reach)} ${String(to.y)} ${String(to.x)} ${String(to.y)}`;
}

/** Props for `TreeEdges`. */
export interface TreeEdgesProps {
  readonly layout: BoardLayout;
  /** The cards a path focus keeps lit; null when nothing is focused. */
  readonly onPath: ReadonlySet<string> | null;
}

/** Every tree line of the board. */
export function TreeEdges({ layout, onPath }: TreeEdgesProps): ReactNode {
  const edges = layout.edges.filter(
    (e) => !layout.hidden.has(e.id) && !layout.hidden.has(e.parentId),
  );
  if (edges.length === 0) return null;
  return (
    <ViewportPortal>
      <svg className="pt-tree-edges" aria-hidden="true" width="1" height="1">
        {edges.map((edge) => {
          const pending = edge.id === DRAFT_ID;
          const dim = onPath !== null && !(onPath.has(edge.id) && onPath.has(edge.parentId));
          return (
            <path
              key={edge.id}
              d={edgePath(edge)}
              className="pt-tree-edge"
              data-branch={edge.branch}
              data-pending={pending}
              data-dim={dim}
              data-edge-to={edge.id}
            />
          );
        })}
      </svg>
    </ViewportPortal>
  );
}
