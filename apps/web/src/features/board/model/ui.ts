/**
 * board/model/ui — what is open on the board, and what Escape closes (P4 notes, "Esc order").
 *
 * Escape backs out ONE level per press: export sheet, then the Uses picker, then the span menu (and
 * the selection under it), then the ask box, then path focus, then the Outline. The state is plain
 * data and `escapeStep` is pure, so the order is one table the tests can read.
 */
import { pathTo, type BoardTree, type TreeNodeInput } from './tree';

import type { AskUses, ParentSpan } from '@/lib/api/types';

/** The four dotted items of the Uses line, each opens one picker. */
export type PickerName = 'path' | 'paper' | 'level' | 'diagram';

/** An ask being written: where from, from which words, and what it will send. */
export interface Draft {
  /** The card the ask leaves from. */
  readonly parentId: string;
  /** The words it starts from, when it came from a selection. */
  readonly span: ParentSpan | null;
  /** "Ask differently": a sibling to the right, not the next turn. */
  readonly askDifferently: boolean;
  /**
   * False for the one-line "Follow up…" stub under a focused answer; true once it grew (focused,
   * clicked) or was opened on purpose (an Ask edge, a span ask).
   */
  readonly expanded: boolean;
  readonly text: string;
  readonly uses: AskUses;
}

/** The span menu: the words, and where the last line of them is in the stage (px from its corner). */
export interface MenuState {
  readonly cardId: string;
  readonly span: ParentSpan;
  readonly anchor: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/** Everything the board has open. */
export interface BoardUi {
  /** The card whose path is focused: off-path cards dim, a breadcrumb shows, Follow up is pinned. */
  readonly focusId: string | null;
  readonly draft: Draft | null;
  readonly picker: PickerName | null;
  readonly menu: MenuState | null;
  readonly outline: boolean;
  readonly sheet: boolean;
}

/** Nothing open. */
export const CALM: BoardUi = {
  focusId: null,
  draft: null,
  picker: null,
  menu: null,
  outline: false,
  sheet: false,
};

/**
 * One press of Escape.
 *
 * @param ui What is open.
 * @returns The state after the press, and whether the press was used (false: nothing here to close,
 *   so the page may use the key).
 */
export function escapeStep(ui: BoardUi): { readonly ui: BoardUi; readonly used: boolean } {
  if (ui.sheet) return { ui: { ...ui, sheet: false }, used: true };
  if (ui.picker !== null) return { ui: { ...ui, picker: null }, used: true };
  if (ui.menu !== null) return { ui: { ...ui, menu: null }, used: true };
  if (ui.draft !== null) return { ui: { ...ui, draft: null }, used: true };
  if (ui.focusId !== null) return { ui: { ...ui, focusId: null }, used: true };
  if (ui.outline) return { ui: { ...ui, outline: false }, used: true };
  return { ui, used: false };
}

/** One crumb of the focused path. */
export interface Crumb {
  readonly id: string;
  readonly label: string;
}

/** What a crumb reads of a node. */
export interface CrumbNodeInput extends TreeNodeInput {
  readonly body: string;
  readonly title?: string | null;
  readonly question?: string | null;
}

const CRUMB_MAX = 36;

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > CRUMB_MAX ? `${flat.slice(0, CRUMB_MAX - 1)}…` : flat;
};

/**
 * The breadcrumb of a focused card: the passage, then each question down to it.
 *
 * @param tree The tree.
 * @param id The focused card.
 * @returns Root first.
 */
export function breadcrumbOf<N extends CrumbNodeInput>(tree: BoardTree<N>, id: string): Crumb[] {
  return pathTo(tree, id).map((node) => {
    const asked = node.question?.trim() || node.title?.trim() || '';
    const label =
      node.kind === 'excerpt'
        ? 'Passage'
        : node.kind === 'note'
          ? 'Note'
          : asked !== ''
            ? asked
            : 'Answer';
    return { id: node.node_id, label: clip(label) };
  });
}

/**
 * The cards a focus keeps lit: the focused card and everything above it. Others dim.
 *
 * @param tree The tree.
 * @param focusId The focused card, or null.
 * @returns The ids on the path; null when nothing is focused (nothing dims).
 */
export function onPathIds<N extends TreeNodeInput>(
  tree: BoardTree<N>,
  focusId: string | null,
): ReadonlySet<string> | null {
  if (focusId === null || !tree.byId.has(focusId)) return null;
  return new Set(pathTo(tree, focusId).map((n) => n.node_id));
}
