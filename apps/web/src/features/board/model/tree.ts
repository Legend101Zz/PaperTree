/**
 * board/model/tree — the v0.3 branching board as pure data (v03-BOARD-SPEC section 1).
 *
 * A board holds TREES. A root is a passage card (an `excerpt`); its children are answer cards
 * (`explanation`) and note cards (`note`), each with a `branch` of `down` (the conversation goes on
 * below its parent) or `right` (a branch). Anything else without a parent, loose notes and frames
 * from v0.2 boards, is NOT part of a tree: Tidy and fold never touch it.
 *
 * No DOM, no clock, no randomness: the same nodes always build the same tree, so the layout, the
 * outline and the tests are deterministic.
 */
import { spanWords } from './spans';

import type { BoardBranch, CanvasNode, ParentSpan } from '@/lib/api/types';

/** The fields of a node the tree reads (`CanvasNode` satisfies it; tests build smaller ones). */
export interface TreeNodeInput {
  readonly node_id: string;
  readonly kind: CanvasNode['kind'];
  readonly created_at: string;
  readonly parent_id?: string | null;
  readonly branch?: BoardBranch | null;
  readonly parent_span?: ParentSpan | null;
}

/** A tree of nodes: every node is a root, somebody's child, or loose. */
export interface BoardTree<N extends TreeNodeInput = CanvasNode> {
  /** Every node by id. */
  readonly byId: ReadonlyMap<string, N>;
  /** Roots in creation order (then id), so two builds of one board agree. */
  readonly roots: readonly N[];
  /** Nodes with no parent that are not a tree root: v0.2 notes and frames. Left alone. */
  readonly loose: readonly N[];
  /** Children by parent id, in drawing order: right children by span, then the down child last. */
  readonly children: ReadonlyMap<string, readonly N[]>;
}

/** How many answers and notes a branch holds, for the fold pill. */
export interface BranchCounts {
  readonly answers: number;
  readonly notes: number;
}

/** One underlined span in an answer and the branches that start from it. */
export interface SpanKnot {
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  /** Children that start here, in drawing order. The knot shows this many. */
  readonly childIds: readonly string[];
  readonly count: number;
}

const byCreation = <N extends TreeNodeInput>(a: N, b: N): number =>
  a.created_at < b.created_at
    ? -1
    : a.created_at > b.created_at
      ? 1
      : a.node_id < b.node_id
        ? -1
        : a.node_id > b.node_id
          ? 1
          : 0;

/**
 * The order of a parent's right children. They go by where their words sit in the parent's answer,
 * so a branch from a sentence near the top stays above one from a sentence near the bottom
 * whichever was asked first (the reader's eye then travels down the answer and down the column
 * together). Branches without words ("Ask differently") follow the span ones. Ties, the same words
 * asked twice, fall back to creation order.
 *
 * @param a One right child.
 * @param b The other.
 * @returns Negative when `a` goes first.
 */
export function compareRightChildren<N extends TreeNodeInput>(a: N, b: N): number {
  const sa = a.parent_span ?? null;
  const sb = b.parent_span ?? null;
  if (sa !== null && sb === null) return -1;
  if (sa === null && sb !== null) return 1;
  if (sa !== null && sb !== null) {
    if (sa.start !== sb.start) return sa.start - sb.start;
    if (sa.end !== sb.end) return sa.end - sb.end;
  }
  return byCreation(a, b);
}

/**
 * Where a child leaves its parent. A child with a parent but no recorded branch reads as `right`:
 * it must never look like the (single) continuation of the conversation.
 *
 * @param node The child.
 * @returns `down` or `right`.
 */
export function branchOf(node: TreeNodeInput): BoardBranch {
  return node.branch === 'down' ? 'down' : 'right';
}

/**
 * Builds the trees of a board.
 *
 * A node whose parent is not on the board (it should not happen: deleting a node deletes its
 * subtree) is treated as loose rather than dropped, so nothing disappears from the screen.
 *
 * @param nodes Every node of the board.
 * @returns The trees.
 */
export function buildTree<N extends TreeNodeInput>(nodes: readonly N[]): BoardTree<N> {
  const byId = new Map(nodes.map((n) => [n.node_id, n] as const));
  const kids = new Map<string, N[]>();
  const parentless: N[] = [];
  const orphans: N[] = [];
  for (const node of nodes) {
    const parentId = node.parent_id ?? null;
    if (parentId === null) {
      parentless.push(node);
    } else if (byId.has(parentId) && parentId !== node.node_id) {
      const list = kids.get(parentId) ?? [];
      list.push(node);
      kids.set(parentId, list);
    } else {
      orphans.push(node);
    }
  }
  const children = new Map<string, readonly N[]>();
  for (const [parentId, list] of kids) {
    const down = list.filter((c) => branchOf(c) === 'down').sort(byCreation);
    const right = list.filter((c) => branchOf(c) === 'right').sort(compareRightChildren);
    // The down child is last: it hangs below the right-hand stack's start, and the layout and the
    // outline both walk "right branches first, then the continuation".
    children.set(parentId, [...right, ...down]);
  }
  const roots: N[] = [];
  const loose: N[] = [...orphans].sort(byCreation);
  for (const node of [...parentless].sort(byCreation)) {
    // A card with children is a root whatever its kind (an image card, later); a childless
    // excerpt is a tree of one; everything else is a loose v0.2 card.
    if (node.kind === 'excerpt' || children.has(node.node_id)) roots.push(node);
    else loose.push(node);
  }
  return { byId, roots, loose, children };
}

/**
 * A node's children in drawing order.
 *
 * @param tree The tree.
 * @param id The parent.
 * @returns Its children (empty for a leaf).
 */
export function childrenOf<N extends TreeNodeInput>(tree: BoardTree<N>, id: string): readonly N[] {
  return tree.children.get(id) ?? [];
}

/**
 * A node's `right` children, ordered by span position.
 *
 * @param tree The tree.
 * @param id The parent.
 * @returns The branches.
 */
export function rightChildren<N extends TreeNodeInput>(tree: BoardTree<N>, id: string): N[] {
  return childrenOf(tree, id).filter((c) => branchOf(c) === 'right');
}

/**
 * A node's one `down` child, the continuation of the conversation.
 *
 * @param tree The tree.
 * @param id The parent.
 * @returns The child, or undefined when it has none.
 */
export function downChild<N extends TreeNodeInput>(tree: BoardTree<N>, id: string): N | undefined {
  return childrenOf(tree, id).find((c) => branchOf(c) === 'down');
}

/**
 * The path from the root to a node, both included. Ends early (without looping) if the data holds a
 * cycle, which the server forbids.
 *
 * @param tree The tree.
 * @param id The node.
 * @returns Root first, `id` last; empty when `id` is not on the board.
 */
export function pathTo<N extends TreeNodeInput>(tree: BoardTree<N>, id: string): N[] {
  const out: N[] = [];
  const seen = new Set<string>();
  let current = tree.byId.get(id);
  while (current !== undefined && !seen.has(current.node_id)) {
    seen.add(current.node_id);
    out.unshift(current);
    const parentId = current.parent_id ?? null;
    current = parentId === null ? undefined : tree.byId.get(parentId);
  }
  return out;
}

/**
 * How many steps below its root a node is (a root is 0; `down` and `right` both count one).
 *
 * @param tree The tree.
 * @param id The node.
 * @returns The depth, or 0 for an unknown node.
 */
export function depthOf<N extends TreeNodeInput>(tree: BoardTree<N>, id: string): number {
  return Math.max(0, pathTo(tree, id).length - 1);
}

/**
 * The other children of a node's parent, in drawing order. A root has none.
 *
 * @param tree The tree.
 * @param id The node.
 * @returns Its siblings, not including itself.
 */
export function siblingsOf<N extends TreeNodeInput>(tree: BoardTree<N>, id: string): N[] {
  const parentId = tree.byId.get(id)?.parent_id ?? null;
  if (parentId === null) return [];
  return childrenOf(tree, parentId).filter((c) => c.node_id !== id);
}

/**
 * Every node below `id`, depth first: a node's right branches in span order, each with its own
 * subtree, then the down continuation.
 *
 * @param tree The tree.
 * @param id The top of the subtree.
 * @returns The descendants, not including `id`.
 */
export function descendantsOf<N extends TreeNodeInput>(tree: BoardTree<N>, id: string): N[] {
  const out: N[] = [];
  const visit = (parentId: string): void => {
    for (const child of childrenOf(tree, parentId)) {
      out.push(child);
      visit(child.node_id);
    }
  };
  visit(id);
  return out;
}

/**
 * The cards a delete takes, parents first: each chosen card with everything below it (the server
 * deletes the whole subtree, so the screen and the Undo must hold the same set). A card chosen
 * together with its own ancestor is listed once, under that ancestor.
 *
 * @param rows Every card of the board.
 * @param chosen The ids the reader chose.
 * @returns The chosen cards and their descendants, every parent before its children.
 */
export function withSubtrees<N extends TreeNodeInput>(
  rows: readonly N[],
  chosen: ReadonlySet<string>,
): N[] {
  const tree = buildTree(rows);
  const underChosen = (row: N): boolean => {
    const seen = new Set<string>();
    let at = row.parent_id ?? null;
    while (at !== null && !seen.has(at)) {
      if (chosen.has(at)) return true;
      seen.add(at);
      at = tree.byId.get(at)?.parent_id ?? null;
    }
    return false;
  };
  const out = new Map<string, N>();
  for (const row of rows) {
    if (!chosen.has(row.node_id) || underChosen(row)) continue;
    out.set(row.node_id, row);
    for (const below of descendantsOf(tree, row.node_id)) out.set(below.node_id, below);
  }
  return [...out.values()];
}

/**
 * Rule 3: which way an ask from `parentId` goes. `down` exists only under ANSWER cards: any ask on
 * a passage or a note is always `right` (the question and its answer are one card, placed to the
 * right). On an answer, an ask with no span and no "Ask differently" is `down` ("Follow up") when
 * the answer has no down child yet; every other ask, including every span ask, is `right`.
 * The server enforces this; the web uses it to draw the ask box's wording and the pending card.
 *
 * @param tree The tree.
 * @param parentId The card being asked from.
 * @param ask What the reader asked: the selected words, or "Ask differently".
 * @param ask.span The selected words, when the ask starts from some.
 * @param ask.askDifferently True when the reader chose "Ask differently".
 * @returns `down` or `right`.
 */
export function branchFor<N extends TreeNodeInput>(
  tree: BoardTree<N>,
  parentId: string,
  ask: { readonly span?: ParentSpan | null; readonly askDifferently?: boolean },
): BoardBranch {
  if (tree.byId.get(parentId)?.kind !== 'explanation') return 'right';
  if (ask.span != null || ask.askDifferently === true) return 'right';
  return downChild(tree, parentId) === undefined ? 'down' : 'right';
}

/**
 * Rule 6: an answer that has children is never rewritten in place. A retry or re-level of it makes
 * a `right` sibling instead; a retry of a failed answer with no children replaces it.
 *
 * @param tree The tree.
 * @param id The card.
 * @returns True for an answer that has at least one child.
 */
export function isFrozen<N extends TreeNodeInput>(tree: BoardTree<N>, id: string): boolean {
  const node = tree.byId.get(id);
  return node?.kind === 'explanation' && childrenOf(tree, id).length > 0;
}

/**
 * The underlined spans of an answer and how many branches start at each: the count knot (rule 4).
 * Branches with the same start and end share one knot; they stay in drawing order.
 *
 * @param tree The tree.
 * @param answerId The answer.
 * @returns One knot per distinct span, by position in the answer.
 */
export function spanKnots<N extends TreeNodeInput>(
  tree: BoardTree<N>,
  answerId: string,
): SpanKnot[] {
  const knots = new Map<string, { span: ParentSpan; childIds: string[] }>();
  for (const child of childrenOf(tree, answerId)) {
    const span = child.parent_span ?? null;
    if (span === null) continue;
    const key = `${String(span.start)}:${String(span.end)}`;
    const knot = knots.get(key) ?? { span, childIds: [] };
    knot.childIds.push(child.node_id);
    knots.set(key, knot);
  }
  return [...knots.values()]
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end)
    .map(({ span, childIds }) => ({
      start: span.start,
      end: span.end,
      quote: spanWords(span.quote),
      childIds,
      count: childIds.length,
    }));
}

/**
 * The answers and notes in a branch, the card itself included (a folded card is one of the answers
 * its pill counts, as in the prototype: "2 answers" for a card and one reply).
 *
 * @param tree The tree.
 * @param id The top of the branch.
 * @returns The counts.
 */
export function branchCounts<N extends TreeNodeInput>(
  tree: BoardTree<N>,
  id: string,
): BranchCounts {
  let answers = 0;
  let notes = 0;
  const top = tree.byId.get(id);
  const members = top === undefined ? [] : [top, ...descendantsOf(tree, id)];
  for (const node of members) {
    if (node.kind === 'explanation') answers += 1;
    else if (node.kind === 'note') notes += 1;
  }
  return { answers, notes };
}

/**
 * The fold pill's words: "2 answers · 1 note" (#349), leaving out whichever count is zero.
 *
 * @param counts What the branch holds.
 * @returns The label.
 */
export function countsPhrase(counts: BranchCounts): string {
  const parts: string[] = [];
  if (counts.answers > 0) {
    parts.push(`${String(counts.answers)} ${counts.answers === 1 ? 'answer' : 'answers'}`);
  }
  if (counts.notes > 0) {
    parts.push(`${String(counts.notes)} ${counts.notes === 1 ? 'note' : 'notes'}`);
  }
  return parts.length === 0 ? '0 answers' : parts.join(' · ');
}
