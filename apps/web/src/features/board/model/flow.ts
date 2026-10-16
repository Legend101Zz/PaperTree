/**
 * board/model/flow — the board's two vocabularies and the pure functions between them: the wire's
 * `CanvasNode` / `CanvasEdge` (contracts.md §2.7) and xyflow's `Node` / `Edge`.
 *
 * The server row rides along in `data.node` / `data.edge`; xyflow owns position, size and selection
 * while the reader works, and the controller writes them back on the explicit gestures only.
 */
import { type Edge, type Node } from '@xyflow/react';

import { threadInfo } from './threads';

import type { CanvasEdge, CanvasNode, EdgeKind } from '@/lib/api/types';

/** What every card carries: the server row and the paper the board belongs to. */
export interface PtNodeData extends Record<string, unknown> {
  node: CanvasNode;
  paperId: string;
}
/** What every link carries: the server row. */
export interface PtEdgeData extends Record<string, unknown> {
  edge: CanvasEdge;
}
/** The card kinds as xyflow node types; `group` is xyflow's own built-in type, so a frame is `frame`. */
export type PtNodeType =
  'excerpt' | 'explanation' | 'note' | 'question' | 'notebook' | 'diagram' | 'frame';
/** A card on the board, as xyflow holds it. */
export type PtNode = Node<PtNodeData, PtNodeType>;
/** A thread on the board, as xyflow holds it. */
export type PtEdge = Edge<PtEdgeData, 'thread'>;

/** The seven relation kinds in the design's order, named as `THREAD_KINDS` names them. */
export const EDGE_KINDS: readonly {
  readonly kind: EdgeKind;
  readonly label: string;
  readonly hint: string;
}[] = (
  [
    ['supports', 'This backs up that'],
    ['contradicts', 'This disagrees with that'],
    ['derives_from', 'This follows from that'],
    ['answers', 'This answers that'],
    ['compares', 'Read these side by side'],
    ['references', 'This points to that'],
    ['relates', 'Connected, no stronger claim'],
  ] as const
).map(([kind, hint]) => ({ kind, label: threadInfo(kind).label, hint }));

/**
 * The words for a relation kind.
 *
 * @param kind The wire kind.
 * @returns Its words, e.g. "derives from".
 */
export function kindLabel(kind: EdgeKind): string {
  return EDGE_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

/**
 * The words on the edge: the reader's own label when there is one, the kind otherwise.
 *
 * @param edge The link.
 * @returns The text the link shows.
 */
export function edgeText(edge: CanvasEdge): string {
  return edge.label !== null && edge.label.trim() !== '' ? edge.label : kindLabel(edge.kind);
}

/** What each card kind is called, in a name and in a sentence. */
const KIND_WORDS: Readonly<Record<CanvasNode['kind'], readonly [string, string]>> = {
  excerpt: ['Passage', 'a passage'],
  explanation: ['AI explanation', 'an AI explanation'],
  note: ['Note', 'an empty note'],
  question: ['Question', 'a question'],
  notebook: ['Notebook page', 'a notebook page'],
  diagram: ['Diagram', 'a diagram'],
  group: ['Group', 'a group'],
};

/**
 * The accessible name of a card: its kind and its first words, e.g. `Note: next, read 3.2`.
 *
 * @param node The card.
 * @returns The name xyflow puts on the card's focusable wrapper.
 */
export function nodeLabel(node: CanvasNode): string {
  const what = KIND_WORDS[node.kind][0];
  const text = (node.title ?? node.body).replace(/\s+/g, ' ').trim();
  return text === '' ? what : `${what}: ${text.length > 70 ? `${text.slice(0, 70)}…` : text}`;
}

/**
 * The xyflow node type a card kind renders as.
 *
 * @param kind The wire kind.
 * @returns The node type; a `group` is drawn as a `frame`.
 */
export function flowType(kind: CanvasNode['kind']): PtNodeType {
  return kind === 'group' ? 'frame' : kind;
}

/**
 * A wire card as an xyflow node.
 *
 * @param node The server row.
 * @param paperId The paper the board belongs to.
 * @param selected Whether it starts selected.
 * @returns The xyflow node.
 */
export function toFlowNode(node: CanvasNode, paperId: string, selected = false): PtNode {
  return {
    id: node.node_id,
    type: flowType(node.kind),
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

/**
 * The cards with each notebook card named by its page's title (the row holds only the page id;
 * the title arrives with the page read), so two notebook cards can be told apart by name.
 *
 * @param nodes The board's cards.
 * @param titleOf The title of a page that has been read, by page id.
 * @returns The same array when no name changes, else a copy with the renamed cards.
 */
export function withPageTitles(
  nodes: PtNode[],
  titleOf: (pageId: string) => string | undefined,
): PtNode[] {
  let changed = false;
  const out = nodes.map((n) => {
    const node = n.data.node;
    const title =
      node.kind === 'notebook' && node.source_page_id !== null
        ? titleOf(node.source_page_id)
        : undefined;
    const label = title === undefined ? undefined : nodeLabel({ ...node, title });
    if (label === undefined || n.ariaLabel === label) return n;
    changed = true;
    return { ...n, ariaLabel: label };
  });
  return changed ? out : nodes;
}

/**
 * A wire link as an xyflow edge, drawn between the pins it was made on. A link with no pins (a
 * keyboard link, every v0.1 link) joins each card's first out-pin and first in-pin.
 *
 * @param edge The server row.
 * @returns The xyflow edge.
 */
export function toFlowEdge(edge: CanvasEdge): PtEdge {
  return {
    id: edge.edge_id,
    type: 'thread',
    source: edge.from_node_id,
    target: edge.to_node_id,
    sourceHandle: edge.from_port,
    targetHandle: edge.to_port,
    ariaLabel: `${edgeText(edge)} thread`,
    data: { edge },
  };
}

/**
 * A card by name for a sentence: `“first words”` (its title or text), or the kind when it is empty.
 *
 * @param node The card.
 * @returns The phrase, e.g. `“Next: read 3.2”` or `a passage`.
 */
export function cardName(node: CanvasNode): string {
  const text = (node.title ?? node.body).replace(/\s+/g, ' ').trim();
  if (text !== '') return `“${text.length > 40 ? `${text.slice(0, 40)}…` : text}”`;
  return KIND_WORDS[node.kind][1];
}
