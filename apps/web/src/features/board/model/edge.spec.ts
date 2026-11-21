import { describe, expect, it } from 'vitest';

import { rootOnVisiblePage } from './edge';
import { buildTree } from './tree';
import { node } from './treeFixtures';

import type { Anchor } from '@papertree/anchoring';

const onPage = (index: number): Anchor =>
  ({ id: 'a', selectors: [{ type: 'PageSelector', index }] }) as unknown as Anchor;

describe('the amber edge', () => {
  const tree = buildTree([
    { ...node({ id: 'p' }), source_anchor: onPage(2) },
    node({ id: 'a', parent: 'p' }),
    { ...node({ id: 'q' }), source_anchor: onPage(7) },
    node({ id: 'note', kind: 'note' }),
  ]);
  it('lights a tree whose root passage is on a visible page', () => {
    expect(rootOnVisiblePage(tree, 'p', new Set([2, 3]))).toBe(true);
    expect(rootOnVisiblePage(tree, 'q', new Set([2, 3]))).toBe(false);
  });
  it('is the root’s, so it is inherited by the whole tree', () => {
    // A card reads its OWN tree's root: the answer under p is lit by p's page.
    expect(rootOnVisiblePage(tree, 'p', new Set([2]))).toBe(true);
  });
  it('says nothing when no page is known, or the root is not a passage', () => {
    expect(rootOnVisiblePage(tree, 'p', new Set())).toBe(false);
    expect(rootOnVisiblePage(tree, 'note', new Set([2]))).toBe(false);
    expect(rootOnVisiblePage(tree, 'missing', new Set([2]))).toBe(false);
  });
});
