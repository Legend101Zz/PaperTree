'use client';

/**
 * board/components/ThreadPreview — the dashed navy thread that stands between two pins before it
 * has a kind (DESIGN.md §3.10 "dragging", frame 06): while the keyboard highlight walks the
 * targets, and while the "Link as" picker is open. It is drawn in the edge-label layer, so it sits
 * above frames and under every card, like a thread; `pinCentre` also places the picker.
 */
import { EdgeLabelRenderer, useInternalNode, type InternalNode } from '@xyflow/react';

import { PIN_SIDE, type Port } from '../model/pins';
import { curvePath, threadCurve, type Point } from '../model/threads';

import type { PtNode } from '../model/flow';
import type { ReactNode } from 'react';

/**
 * A pin's centre on the board (flow px), from xyflow's measured handles; the card's own centre
 * when the pin is not drawn (a thread saved without pins).
 *
 * @param node The card as xyflow measured it.
 * @param port The pin, or null.
 * @returns The point.
 */
export function pinCentre(node: InternalNode<PtNode>, port: Port | null): Point {
  const at = node.internals.positionAbsolute;
  const bounds = node.internals.handleBounds;
  const handle = [...(bounds?.source ?? []), ...(bounds?.target ?? [])].find((h) => h.id === port);
  if (handle === undefined) {
    const w = node.measured.width ?? node.width ?? 0;
    const h = node.measured.height ?? node.height ?? 0;
    return { x: at.x + w / 2, y: at.y + h / 2 };
  }
  return { x: at.x + handle.x + handle.width / 2, y: at.y + handle.y + handle.height / 2 };
}

/** Props for `ThreadPreview`. */
export interface ThreadPreviewProps {
  readonly from: string;
  readonly fromPort: Port | null;
  readonly to: string;
  readonly toPort: Port | null;
}

/** The thread to be, from an out-pin to an in-pin. Decorative: the live region says the words. */
export function ThreadPreview({ from, fromPort, to, toPort }: ThreadPreviewProps): ReactNode {
  const a = useInternalNode<PtNode>(from);
  const b = useInternalNode<PtNode>(to);
  if (a === undefined || b === undefined) return null;
  const curve = threadCurve(
    pinCentre(a, fromPort),
    fromPort === null ? 'right' : PIN_SIDE[fromPort],
    pinCentre(b, toPort),
    toPort === null ? 'left' : PIN_SIDE[toPort],
  );
  return (
    <EdgeLabelRenderer>
      <svg className="pt-thread-preview" aria-hidden="true" data-testid="thread-preview">
        <path d={curvePath(curve)} />
      </svg>
    </EdgeLabelRenderer>
  );
}
