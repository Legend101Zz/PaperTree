/**
 * board/model/outline — the tree as a study doc, and as Markdown (P4 steps 10, V3-27).
 *
 * The Outline is the same tree: questions are the headings; a branch shows the words it grew from;
 * a right branch sits one step in and a follow-up stays level; answers are folded to their first
 * line. The Markdown export has three include toggles (full answers, my notes, folded branches),
 * keeps the maths as `$…$` and never includes the Check-yourself block.
 */

import { exportParagraphs, firstLine, moreLineCount } from './answerText';
import {
  branchCounts,
  branchOf,
  childrenOf,
  countsPhrase,
  type BoardTree,
  type BranchCounts,
  type TreeNodeInput,
} from './tree';

import type { CanvasNode } from '@/lib/api/types';

/** What the outline reads of a node. */
export interface OutlineNodeInput extends TreeNodeInput {
  readonly body: string;
  readonly title?: string | null;
  readonly question?: string | null;
  readonly final_text?: string | null;
  readonly folded?: boolean;
}

/** One row of the outline. */
export type OutlineRow =
  | { readonly kind: 'passage'; readonly id: string; readonly depth: 0; readonly text: string }
  | {
      readonly kind: 'note';
      readonly id: string;
      readonly depth: number;
      readonly text: string;
    }
  | {
      readonly kind: 'question';
      readonly id: string;
      readonly depth: number;
      /** True for a follow-up (it stays level with the card it continues). */
      readonly down: boolean;
      readonly question: string;
      /** The words of the parent's answer the branch grew from; null for a follow-up. */
      readonly from: string | null;
      readonly firstLine: string;
      readonly moreLines: number;
      /** The whole answer, for the row's "open" state. */
      readonly text: string;
      /** Set when the branch is folded on the board (and so here too). */
      readonly folded: { readonly counts: BranchCounts; readonly label: string } | null;
    };

/** A contents entry: one per question. */
export interface OutlineNav {
  readonly id: string;
  readonly title: string;
  readonly depth: number;
  readonly down: boolean;
}

/** The outline of a board. */
export interface Outline {
  readonly rows: readonly OutlineRow[];
  readonly nav: readonly OutlineNav[];
  readonly empty: boolean;
}

/** The three include toggles of the export sheet. */
export interface ExportInclude {
  /** Whole answers; off writes each answer's first paragraph and "[…]". */
  readonly full: boolean;
  /** The reader's own note cards. */
  readonly notes: boolean;
  /** Branches folded on the board: their answers, and everything under them. */
  readonly folded: boolean;
}

/** The sheet's defaults: full answers and notes on, folded branches off. */
export const DEFAULT_INCLUDE: ExportInclude = { full: true, notes: true, folded: false };

/** What the Markdown export needs besides the tree. */
export interface ExportOptions {
  /** The board's title: the `#` heading. */
  readonly title: string;
  readonly include?: ExportInclude;
  /** The source line under a passage, e.g. "Deep Residual Learning, p. 3"; omitted when absent. */
  readonly sourceOf?: (passage: OutlineNodeInput) => string | undefined;
}

/** A step of the flattened walk. */
interface Step<N> {
  readonly node: N;
  readonly depth: number;
  readonly down: boolean;
}

/**
 * The answer text of a card: what the model wrote, else the body (v0.2 explanation cards).
 *
 * @param node The card.
 * @returns The answer.
 */
function answerOf(node: OutlineNodeInput): string {
  return node.final_text ?? node.body;
}

function questionOf(node: OutlineNodeInput): string {
  const typed = node.question?.trim() ?? '';
  if (typed !== '') return typed;
  const titled = node.title?.trim() ?? '';
  return titled !== '' ? titled : firstLine(answerOf(node));
}

/**
 * Walks the trees in outline order: a passage, its notes, then each answer; an answer's notes,
 * then its right branches (one step in), then its follow-up (level). A folded answer stops the walk
 * unless `intoFolded`, which the export uses for its "folded branches" toggle.
 *
 * @param tree The tree.
 * @param intoFolded Whether to walk under folded answers.
 * @returns The steps.
 */
function walk<N extends OutlineNodeInput>(tree: BoardTree<N>, intoFolded: boolean): Step<N>[] {
  const steps: Step<N>[] = [];
  const answers = (n: N, depth: number, down: boolean): void => {
    steps.push({ node: n, depth, down });
    if (n.folded === true && !intoFolded) return;
    const kids = childrenOf(tree, n.node_id);
    for (const c of kids.filter((k) => k.kind === 'note'))
      steps.push({ node: c, depth, down: false });
    for (const c of kids.filter((k) => k.kind === 'explanation' && branchOf(k) === 'right')) {
      answers(c, depth + 1, false);
    }
    for (const c of kids.filter((k) => k.kind === 'explanation' && branchOf(k) === 'down')) {
      answers(c, depth, true);
    }
  };
  for (const root of tree.roots) {
    steps.push({ node: root, depth: 0, down: false });
    const kids = childrenOf(tree, root.node_id);
    for (const c of kids.filter((k) => k.kind === 'note'))
      steps.push({ node: c, depth: 0, down: false });
    for (const c of kids.filter((k) => k.kind === 'explanation')) answers(c, 0, false);
  }
  return steps;
}

/**
 * The tree as an indented study doc.
 *
 * @param tree The tree.
 * @returns Its rows, a contents list, and whether the board is empty.
 */
export function buildOutline<N extends OutlineNodeInput = CanvasNode>(tree: BoardTree<N>): Outline {
  const rows: OutlineRow[] = [];
  const nav: OutlineNav[] = [];
  for (const { node, depth, down } of walk(tree, false)) {
    if (node.kind === 'excerpt') {
      rows.push({ kind: 'passage', id: node.node_id, depth: 0, text: node.body });
    } else if (node.kind === 'note') {
      rows.push({ kind: 'note', id: node.node_id, depth, text: node.body });
    } else {
      const text = answerOf(node);
      const counts = node.folded === true ? branchCounts(tree, node.node_id) : null;
      const question = questionOf(node);
      rows.push({
        kind: 'question',
        id: node.node_id,
        depth,
        down,
        question,
        from: down ? null : (node.parent_span?.quote ?? null),
        firstLine: firstLine(text),
        moreLines: moreLineCount(text),
        text,
        folded: counts === null ? null : { counts, label: countsPhrase(counts) },
      });
      nav.push({ id: node.node_id, title: question, depth, down });
    }
  }
  return { rows, nav, empty: tree.roots.length === 0 };
}

/**
 * The tree as Markdown.
 *
 * A heading per question, level `2 + depth` (a follow-up one deeper, so it nests under what it
 * continues), written as `“words” → question` for a span branch and `↓ question` for a follow-up.
 *
 * @param tree The tree.
 * @param options The title, the include toggles and where a passage came from.
 * @returns The document, ending without a trailing blank line.
 */
export function exportMarkdown<N extends OutlineNodeInput = CanvasNode>(
  tree: BoardTree<N>,
  options: ExportOptions,
): string {
  const include = options.include ?? DEFAULT_INCLUDE;
  const lines: string[] = [`# ${options.title}`, ''];
  for (const { node, depth, down } of walk(tree, include.folded)) {
    if (node.kind === 'excerpt') {
      for (const line of node.body.split('\n')) lines.push(`> ${line}`.trimEnd());
      const source = options.sourceOf?.(node);
      if (source !== undefined && source !== '') lines.push(`> (${source})`);
      lines.push('');
    } else if (node.kind === 'note') {
      if (include.notes) lines.push(`> **Note.** ${node.body}`, '');
    } else {
      const level = '#'.repeat(Math.min(6, 2 + depth + (down ? 1 : 0)));
      const from = down ? null : (node.parent_span?.quote ?? null);
      lines.push(
        `${level} ${from === null ? '' : `“${from}” → `}${down ? '↓ ' : ''}${questionOf(node)}`,
      );
      if (node.folded === true && !include.folded) {
        lines.push(`*${countsPhrase(branchCounts(tree, node.node_id))}, folded on the board.*`, '');
        continue;
      }
      const paragraphs = exportParagraphs(answerOf(node));
      if (include.full) {
        for (const p of paragraphs) lines.push(p, '');
      } else {
        const first = paragraphs.find((p) => p !== '' && !p.startsWith('*[diagram')) ?? '';
        lines.push(first === '' ? '[…]' : `${first} […]`, '');
      }
    }
  }
  if (tree.roots.length === 0) lines.push('*Nothing on the board yet.*');
  while (lines.at(-1) === '') lines.pop();
  return lines.join('\n');
}
