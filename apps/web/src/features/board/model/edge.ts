/**
 * board/model/edge — which cards get the faint amber edge beside the paper (V3-26, R3 decision 6).
 *
 * The edge says "this is from the page you are reading". It is INHERITED: an answer has it when its
 * root passage is on a visible page, not only when its own source link is. Pure.
 */
import { anchorPageIndex } from './cards';

import type { BoardTree } from './tree';

/**
 * Whether the tree rooted at `rootId` has its passage on one of the pages on screen.
 *
 * @param tree The board's trees.
 * @param rootId The card's tree root.
 * @param visible The 0-based pages on screen in the paper beside.
 * @returns True when the root is a passage whose page is visible.
 */
export function rootOnVisiblePage(
  tree: BoardTree,
  rootId: string,
  visible: ReadonlySet<number>,
): boolean {
  if (visible.size === 0) return false;
  const root = tree.byId.get(rootId);
  if (root === undefined || root.kind !== 'excerpt') return false;
  const page = anchorPageIndex(root.source_anchor);
  return page !== null && visible.has(page);
}
