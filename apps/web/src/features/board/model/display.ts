/**
 * board/model/display — the cards as xyflow draws them once Tidy has placed the trees.
 *
 * The store keeps each card as the server has it (a stored x, y that only roots and loose cards
 * use). What xyflow is given is derived: a tree card sits where the layout puts it, a card of a
 * folded branch is hidden, off-path cards dim under a path focus, and the ask box being written is
 * a box of its own (`AskLayer`), placed by the same layout so the next card has its room before it
 * exists.
 * Pure: the same inputs give the same nodes.
 */
import type { Draft } from './ui';
import type { BoardLayout } from './layout';
import type { PtNode } from './flow';
import type { BoardBranch, CanvasNode } from '@/lib/api/types';

/** The id of the ask box in the layout and on the board (never a real card's). */
export const DRAFT_ID = '__draft__';

/** The handle a tree card is dragged by: its top strip, so the words below stay selectable. */
export const DRAG_HANDLE = '.pt-tc__strip';

/**
 * The ask box as a node the layout can place: an answer-to-be, child of the card it asks from.
 *
 * @param boardId The board.
 * @param draft What is being written.
 * @param branch Which way it leaves its parent (`branchFor`'s answer).
 * @returns A node the tree and the layout treat as the last child of its kind.
 */
export function draftNode(boardId: string, draft: Draft, branch: BoardBranch): CanvasNode {
  return {
    node_id: DRAFT_ID,
    board_id: boardId,
    kind: 'explanation',
    group_id: null,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    z: 0,
    title: null,
    body: '',
    source_anchor: null,
    source_message_id: null,
    source_page_id: null,
    source_diagram_id: null,
    counts: null,
    parent_id: draft.parentId,
    branch,
    parent_span: draft.span,
    question: null,
    uses: draft.uses,
    offset_x: 0,
    offset_y: 0,
    folded: false,
    final_text: null,
    level: draft.uses.level,
    model: null,
    answer_status: null,
    version: 0,
    // Sorts after every real sibling asked from the same words.
    created_at: '9999-12-31T23:59:59Z',
    updated_at: '9999-12-31T23:59:59Z',
  };
}

/** What `displayNodes` reads besides the cards and the layout. */
export interface DisplayInput {
  readonly paperId: string;
  /** The cards the path focus keeps lit; null when nothing is focused. */
  readonly onPath: ReadonlySet<string> | null;
  /** The card that just arrived (#342): it glows once. */
  readonly arrivedId: string | null;
}

/**
 * The nodes xyflow draws.
 *
 * @param nodes The store's cards.
 * @param layout Tidy's placement of every tree card.
 * @param input The path focus and the arrival.
 * @returns The same cards, placed, hidden or dimmed.
 */
export function displayNodes(
  nodes: readonly PtNode[],
  layout: BoardLayout,
  input: DisplayInput,
): PtNode[] {
  const out = nodes.map((node): PtNode => {
    const placed = layout.cards.get(node.id);
    if (placed === undefined) {
      return layout.hidden.has(node.id) ? { ...node, hidden: true } : node;
    }
    const classes = [
      input.onPath !== null && !input.onPath.has(node.id) ? 'pt-tn--dim' : '',
      input.arrivedId === node.id ? 'pt-tn--arrived' : '',
    ].filter((c) => c !== '');
    return {
      ...node,
      position: { x: placed.x, y: placed.y },
      width: placed.w,
      // Height is the card's own (its text up to the cap), measured and fed back to the layout.
      height: undefined,
      hidden: layout.hidden.has(node.id),
      dragHandle: placed.pill === null ? DRAG_HANDLE : '.pt-pill__grip',
      ...(classes.length === 0 ? {} : { className: classes.join(' ') }),
    };
  });
  return out;
}
