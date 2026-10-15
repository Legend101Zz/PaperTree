/**
 * canvas/model — the canvas's two vocabularies and the pure functions between them: the wire's
 * `CanvasNode` / `CanvasEdge` (contracts.md §2.7) and xyflow's `Node` / `Edge`.
 *
 * The server row rides along in `data.node` / `data.edge`; xyflow owns position, size and selection
 * while the reader works, and the controller writes them back on the explicit gestures only.
 */
import { MarkerType, type Edge, type Node } from '@xyflow/react';

import type { CanvasEdge, CanvasNode, EdgeKind } from '@/lib/api/types';

export interface PtNodeData extends Record<string, unknown> {
  node: CanvasNode;
  paperId: string;
}
export interface PtEdgeData extends Record<string, unknown> {
  edge: CanvasEdge;
}
/** `group` is xyflow's own built-in node type (with its own CSS), so the frame is `frame`. */
export type PtNode = Node<PtNodeData, 'excerpt' | 'explanation' | 'note' | 'frame'>;
export type PtEdge = Edge<PtEdgeData, 'labeled'>;

export const EDGE_KINDS: readonly { readonly kind: EdgeKind; readonly label: string; readonly hint: string }[] = [
  { kind: 'supports', label: 'supports', hint: 'This backs up that' },
  { kind: 'contradicts', label: 'contradicts', hint: 'This disagrees with that' },
  { kind: 'derives_from', label: 'derives from', hint: 'This follows from that' },
  { kind: 'answers', label: 'answers', hint: 'This answers that' },
  { kind: 'compares', label: 'compares with', hint: 'Read these side by side' },
  { kind: 'references', label: 'references', hint: 'This points to that' },
  { kind: 'relates', label: 'relates to', hint: 'Connected, no stronger claim' },
];

export function kindLabel(kind: EdgeKind): string {
  return EDGE_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

/** The words on the edge: the reader's own label when there is one, the kind otherwise. */
export function edgeText(edge: CanvasEdge): string {
  return edge.label !== null && edge.label.trim() !== '' ? edge.label : kindLabel(edge.kind);
}

export function nodeLabel(node: CanvasNode): string {
  const what =
    node.kind === 'excerpt'
      ? 'Passage'
      : node.kind === 'explanation'
        ? 'AI explanation'
        : node.kind === 'group'
          ? 'Group'
          : 'Note';
  const text = (node.title ?? node.body).replace(/\s+/g, ' ').trim();
  return text === '' ? what : `${what}: ${text.length > 70 ? `${text.slice(0, 70)}…` : text}`;
}

export function toFlowNode(node: CanvasNode, paperId: string, selected = false): PtNode {
  return {
    id: node.node_id,
    type: node.kind === 'group' ? 'frame' : node.kind,
    position: { x: node.x, y: node.y },
    width: node.w,
    height: node.h,
    // Groups sit under the cards they hold; everything else sits above by its own `z`.
    zIndex: node.kind === 'group' ? 0 : 10 + node.z,
    selected,
    ariaLabel: nodeLabel(node),
    data: { node, paperId },
  };
}

export function toFlowEdge(edge: CanvasEdge): PtEdge {
  return {
    id: edge.edge_id,
    type: 'labeled',
    source: edge.from_node_id,
    target: edge.to_node_id,
    markerEnd: { type: MarkerType.ArrowClosed },
    ariaLabel: `${edgeText(edge)} edge`,
    data: { edge },
  };
}

/** A card by name for a sentence: `“first words”` (its title or text), or the kind when it is empty. */
export function cardName(node: CanvasNode): string {
  const text = (node.title ?? node.body).replace(/\s+/g, ' ').trim();
  if (text !== '') return `\u201c${text.length > 40 ? `${text.slice(0, 40)}\u2026` : text}\u201d`;
  return node.kind === 'excerpt'
    ? 'a passage'
    : node.kind === 'explanation'
      ? 'an AI explanation'
      : node.kind === 'group'
        ? 'a group'
        : 'an empty note';
}
