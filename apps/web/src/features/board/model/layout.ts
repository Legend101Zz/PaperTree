/**
 * board/model/layout — Tidy: where every card of a tree sits (owner decision C: Tidy owns the
 * layout, and dragging moves a whole branch).
 *
 * The position of a card is ALWAYS computed from the tree, never stored: down children go under
 * their parent, right children go in the next column stacked by span order. A drag adds an OFFSET
 * on top (`offset_x`, `offset_y`), and an offset carries the card's whole subtree, so a parent can
 * never be dragged away from its children and leave long wires. Tidy clears every offset.
 *
 * A root sits at its own stored `x`, `y`: that is where "Send to board" or a drop put it, and the
 * only position the reader chooses directly. Cards of a folded branch are replaced by one pill.
 *
 * Pure and deterministic: no DOM. Heights come in through `measure`, so the same tree, heights and
 * viewport give the same positions.
 */
import {
  branchCounts,
  branchOf,
  buildTree,
  childrenOf,
  countsPhrase,
  type BoardTree,
  type BranchCounts,
  type TreeNodeInput,
} from './tree';

import type { CanvasNode } from '@/lib/api/types';

/** What the layout reads of a node (`CanvasNode` satisfies it). */
export interface LayoutNodeInput extends TreeNodeInput {
  readonly x: number;
  readonly y: number;
  readonly offset_x?: number;
  readonly offset_y?: number;
  readonly folded?: boolean;
}

/**
 * The gap between a card and the column of its right branches. Wide enough for the curve of the
 * span-anchored line to bend and for the count knot (about 22 px) to sit clear of both cards.
 */
export const COLUMN_GAP = 62;
/** The gap between right branches stacked in a column: the room one card's shadow and pins need. */
export const ROW_GAP = 24;
/** A down child sits closer than a stacked sibling: it reads as the same conversation going on. */
export const DOWN_GAP = 18;
/** A card never grows past this share of the viewport's height; past it the body scrolls inside. */
export const MAX_CARD_VIEWPORT_SHARE = 0.6;
/** The right padding inside a card, where a span line leaves it (#349: not as an underline). */
export const CARD_RIGHT_PADDING = 16;
/** A folded branch's pill height. */
export const PILL_HEIGHT = 40;

/** Card widths by kind (the approved prototype's). */
export const CARD_WIDTH = {
  passage: 304,
  note: 276,
  answer: 312,
  /** An answer to the right of a passage is a little wider: the passage's own words are the ask. */
  answerOfPassage: 328,
} as const;

/** Heights used before a card has been measured, so the first frame is already close. */
export const ESTIMATED_HEIGHT = { passage: 270, answer: 190, note: 130 } as const;

/** Where a line enters a child: a little below its top edge (the pill's edge sits lower). */
const ENTRY_Y = 16;
const PILL_ENTRY_Y = 20;
/** Where a right branch without words leaves its parent: level with the card's header. */
const NO_SPAN_EXIT_Y = 32;
/** A span line never leaves closer than this to a card's top or bottom edge. */
const EXIT_MARGIN = 12;

/** A card placed on the board. */
export interface PlacedCard {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Where the card would be with no offset of its own (what a drag measures its offset from). */
  readonly baseX: number;
  readonly baseY: number;
  /** The tree root this card belongs to. */
  readonly rootId: string;
  /** True when the text is taller than the cap and the card scrolls inside. */
  readonly scrolls: boolean;
  /** Set on the pill that stands for a folded branch. */
  readonly pill: { readonly counts: BranchCounts; readonly label: string } | null;
}

/** The line from a parent to a child. */
export interface PlacedEdge {
  /** The child's id: one edge per child. */
  readonly id: string;
  readonly parentId: string;
  readonly branch: 'down' | 'right';
  /** Where the line leaves the parent. */
  readonly from: { readonly x: number; readonly y: number };
  /** Where it enters the child. */
  readonly to: { readonly x: number; readonly y: number };
}

/** The result of a layout. */
export interface BoardLayout {
  readonly cards: ReadonlyMap<string, PlacedCard>;
  /** Ids in drawing order: each root, then its branches depth first. */
  readonly order: readonly string[];
  readonly edges: readonly PlacedEdge[];
  /** Cards hidden inside a folded branch. */
  readonly hidden: ReadonlySet<string>;
}

/** What `layoutBoard` needs besides the tree. */
export interface LayoutInput {
  /** The viewport's height in px; a card is capped at 60% of it. */
  readonly viewportHeight: number;
  /** A card's measured content height in px, or undefined before it was measured. */
  readonly measure: (nodeId: string) => number | undefined;
  /**
   * The y, in px from the top of the parent card, of the last line of a span's words: where the line
   * to the branch should leave. Undefined when the words were not measured (the line then leaves
   * level with the card's header).
   */
  readonly spanY?: (parentId: string, span: { start: number; end: number }) => number | undefined;
  /**
   * A card that exists for the layout only (the ask box being written): it is placed as the last
   * child of its kind so the next card has its room before it exists, but it is not in `tree`, so
   * nothing counted from the tree (pills, knots, `hasNext`) sees it.
   */
  readonly slot?: LayoutNodeInput;
}

/**
 * The tallest a card may be.
 *
 * @param viewportHeight The viewport's height in px.
 * @returns 60% of it, rounded down.
 */
export function heightCap(viewportHeight: number): number {
  return Math.floor(Math.max(0, viewportHeight) * MAX_CARD_VIEWPORT_SHARE);
}

function widthOf(node: TreeNodeInput, parent: TreeNodeInput | undefined): number {
  if (node.kind === 'excerpt') return CARD_WIDTH.passage;
  if (node.kind === 'note') return CARD_WIDTH.note;
  return parent?.kind === 'excerpt' && branchOf(node) === 'right'
    ? CARD_WIDTH.answerOfPassage
    : CARD_WIDTH.answer;
}

function estimateOf(node: TreeNodeInput): number {
  if (node.kind === 'excerpt') return ESTIMATED_HEIGHT.passage;
  if (node.kind === 'note') return ESTIMATED_HEIGHT.note;
  return ESTIMATED_HEIGHT.answer;
}

/**
 * Lays out every tree of a board. Loose cards are not placed: they stay where they are.
 *
 * Right children are stacked from the parent's top, each starting where the one before it ended
 * plus `ROW_GAP`. A down child sits under its parent, but the right branches of the down child may
 * not start above the bottom of its parent's own right stack: both stacks live in the same column
 * and would overlap.
 *
 * @param model The tree (what counts are read from).
 * @param input The viewport, the measured heights, the measured span lines and the ask-box slot.
 * @returns Every card's position and every line's end points.
 */
export function layoutBoard<N extends LayoutNodeInput = CanvasNode>(
  model: BoardTree<N>,
  input: LayoutInput,
): BoardLayout {
  // Placement walks the model tree plus the layout-only slot; counts are read from the model alone.
  const tree: BoardTree<N> =
    input.slot === undefined ? model : buildTree([...model.byId.values(), input.slot as N]);
  const cap = heightCap(input.viewportHeight);
  const cards = new Map<string, PlacedCard>();
  const order: string[] = [];
  const hidden = new Set<string>();
  const edges: PlacedEdge[] = [];

  const hide = (id: string): void => {
    for (const child of childrenOf(tree, id)) {
      hidden.add(child.node_id);
      hide(child.node_id);
    }
  };

  // Places `node` at (x, y) before offsets; returns the bottom of everything it placed.
  const place = (
    node: N,
    parent: N | undefined,
    x: number,
    y: number,
    stackFloor: number | null,
    root: N,
    carried: { x: number; y: number },
  ): number => {
    const own = { x: node.offset_x ?? 0, y: node.offset_y ?? 0 };
    // An offset carries the whole subtree: children inherit what their ancestors carry.
    const shift = { x: carried.x + own.x, y: carried.y + own.y };
    const folded = node.folded === true;
    const measured = input.measure(node.node_id);
    const wanted =
      measured !== undefined && Number.isFinite(measured) ? measured : estimateOf(node);
    const h = folded ? PILL_HEIGHT : Math.min(Math.max(0, Math.round(wanted)), cap);
    const w = widthOf(node, parent);
    const counts = folded ? branchCounts(model, node.node_id) : null;
    cards.set(node.node_id, {
      id: node.node_id,
      x: Math.round(x + shift.x),
      y: Math.round(y + shift.y),
      w,
      h,
      baseX: Math.round(x + carried.x),
      baseY: Math.round(y + carried.y),
      rootId: root.node_id,
      scrolls: !folded && wanted > cap,
      pill: counts === null ? null : { counts, label: countsPhrase(counts) },
    });
    order.push(node.node_id);
    let bottom = y + h;
    if (folded) {
      hide(node.node_id);
      return bottom;
    }
    const kids = childrenOf(tree, node.node_id);
    let cursor = Math.max(y, stackFloor ?? Number.NEGATIVE_INFINITY);
    for (const child of kids.filter((c) => branchOf(c) === 'right')) {
      const end = place(child, node, x + w + COLUMN_GAP, cursor, null, root, shift);
      cursor = end + ROW_GAP;
      bottom = Math.max(bottom, end);
    }
    const down = kids.find((c) => branchOf(c) === 'down');
    if (down !== undefined) {
      bottom = Math.max(bottom, place(down, node, x, y + h + DOWN_GAP, cursor, root, shift));
    }
    return bottom;
  };

  for (const root of tree.roots) place(root, undefined, root.x, root.y, null, root, { x: 0, y: 0 });

  for (const id of order) {
    const node = tree.byId.get(id);
    const parentId = node?.parent_id ?? null;
    if (node === undefined || parentId === null) continue;
    const parent = cards.get(parentId);
    const child = cards.get(id);
    if (parent === undefined || child === undefined) continue;
    edges.push(edgeBetween(node, parent, child, input.spanY));
  }
  return { cards, order, edges, hidden };
}

function edgeBetween(
  node: TreeNodeInput,
  parent: PlacedCard,
  child: PlacedCard,
  spanY: LayoutInput['spanY'],
): PlacedEdge {
  const branch = branchOf(node);
  if (branch === 'down') {
    return {
      id: child.id,
      parentId: parent.id,
      branch,
      from: { x: parent.x + parent.w / 2, y: parent.y + parent.h },
      to: { x: child.x + child.w / 2, y: child.y },
    };
  }
  const span = node.parent_span ?? null;
  const measured = span === null ? undefined : spanY?.(parent.id, span);
  const exit = measured ?? NO_SPAN_EXIT_Y;
  // Clamped so a span on the card's very first or last line still leaves from the card's side.
  const exitY = Math.min(
    Math.max(exit, EXIT_MARGIN),
    Math.max(EXIT_MARGIN, parent.h - EXIT_MARGIN),
  );
  return {
    id: child.id,
    parentId: parent.id,
    branch,
    // Inside the card's right padding, at the words' own height: the line starts in the margin, so
    // it cannot be read as an underline running under the words that follow on that line.
    from: { x: parent.x + parent.w - CARD_RIGHT_PADDING / 2, y: Math.round(parent.y + exitY) },
    to: { x: child.x, y: child.y + (child.pill === null ? ENTRY_Y : PILL_ENTRY_Y) },
  };
}

/**
 * The offset a drag gives a card: where it was dropped, less where Tidy would put it.
 *
 * @param card The card as laid out.
 * @param to Where the reader dropped its top-left corner.
 * @param to.x The dropped x.
 * @param to.y The dropped y.
 * @returns The `offset_x` and `offset_y` to save on the card (its whole subtree moves with it).
 */
export function offsetForDrop(
  card: Pick<PlacedCard, 'baseX' | 'baseY'>,
  to: { readonly x: number; readonly y: number },
): { offset_x: number; offset_y: number } {
  return { offset_x: Math.round(to.x - card.baseX), offset_y: Math.round(to.y - card.baseY) };
}

/**
 * The offsets Tidy clears: every card of the tree that has one. Tidy is one batch request on the
 * server (`POST /boards/{id}/tidy`); the web applies the same list to its working copy.
 *
 * @param tree The tree.
 * @param rootId The root of the tree to tidy.
 * @returns The ids to reset, root first then depth first; empty when the tree is already tidy.
 */
export function tidyResets<N extends LayoutNodeInput>(
  tree: BoardTree<N>,
  rootId: string,
): string[] {
  const out: string[] = [];
  const visit = (node: N): void => {
    if ((node.offset_x ?? 0) !== 0 || (node.offset_y ?? 0) !== 0) out.push(node.node_id);
    for (const child of childrenOf(tree, node.node_id)) visit(child);
  };
  const root = tree.byId.get(rootId);
  if (root !== undefined) visit(root);
  return out;
}
