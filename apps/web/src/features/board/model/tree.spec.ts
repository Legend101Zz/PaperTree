import { beforeEach, describe, expect, it } from 'vitest';

import {
  branchCounts,
  branchFor,
  buildTree,
  childrenOf,
  compareRightChildren,
  countsPhrase,
  depthOf,
  descendantsOf,
  downChild,
  isFrozen,
  pathTo,
  rightChildren,
  siblingsOf,
  spanKnots,
  withSubtrees,
} from './tree';
import { node, resetClock, spanOf } from './treeFixtures';

const TEXT = 'An identity mapping adds no extra parameters, so the block can do nothing.';
const ids = (list: readonly { node_id: string }[]): string[] => list.map((n) => n.node_id);

beforeEach(resetClock);

describe('buildTree', () => {
  it('finds roots, children and loose cards', () => {
    const tree = buildTree([
      node({ id: 'p' }),
      node({ id: 'a', parent: 'p', branch: 'down' }),
      node({ id: 'note', kind: 'note' }),
      node({ id: 'frame', kind: 'group' }),
    ]);
    expect(ids(tree.roots)).toEqual(['p']);
    expect(ids(tree.loose)).toEqual(['note', 'frame']);
    expect(ids(childrenOf(tree, 'p'))).toEqual(['a']);
  });

  it('keeps a childless passage as a tree of one, not a loose card', () => {
    const tree = buildTree([node({ id: 'p' })]);
    expect(ids(tree.roots)).toEqual(['p']);
    expect(tree.loose).toEqual([]);
  });

  it('treats a card whose parent is not on the board as loose instead of dropping it', () => {
    const tree = buildTree([node({ id: 'a', parent: 'gone' })]);
    expect(ids(tree.loose)).toEqual(['a']);
    expect(tree.roots).toEqual([]);
  });

  it('reads a child with no recorded branch as right, never as the continuation', () => {
    const lone = { ...node({ id: 'a', parent: 'p' }), branch: null };
    const tree = buildTree([node({ id: 'p' }), lone]);
    expect(ids(rightChildren(tree, 'p'))).toEqual(['a']);
    expect(downChild(tree, 'p')).toBeUndefined();
  });
});

describe('child order', () => {
  it('puts right children by where their words sit, whichever was asked first', () => {
    const late = spanOf(TEXT, 'the block can do nothing');
    const early = spanOf(TEXT, 'identity mapping');
    const tree = buildTree([
      node({ id: 'p' }),
      node({ id: 'ans', parent: 'p', branch: 'down' }),
      node({ id: 'askedFirst', parent: 'ans', span: late }),
      node({ id: 'askedSecond', parent: 'ans', span: early }),
    ]);
    expect(ids(rightChildren(tree, 'ans'))).toEqual(['askedSecond', 'askedFirst']);
  });

  it('puts branches without words after the ones with words', () => {
    const tree = buildTree([
      node({ id: 'p' }),
      node({ id: 'ans', parent: 'p', branch: 'down' }),
      node({ id: 'differently', parent: 'ans' }),
      node({ id: 'spanned', parent: 'ans', span: spanOf(TEXT, 'extra parameters') }),
    ]);
    expect(ids(rightChildren(tree, 'ans'))).toEqual(['spanned', 'differently']);
  });

  it('breaks a tie on the same words by creation order', () => {
    const span = spanOf(TEXT, 'identity mapping');
    const tree = buildTree([
      node({ id: 'p' }),
      node({ id: 'ans', parent: 'p', branch: 'down' }),
      node({ id: 'second', parent: 'ans', span, createdAt: '2026-11-20T11:00:00Z' }),
      node({ id: 'first', parent: 'ans', span, createdAt: '2026-11-20T10:00:00Z' }),
    ]);
    expect(ids(rightChildren(tree, 'ans'))).toEqual(['first', 'second']);
  });

  it('orders a shorter span before a longer one that starts at the same place', () => {
    const a = node({ id: 'short', parent: 'p', span: { start: 3, end: 5, quote: 'ab' } });
    const b = node({ id: 'long', parent: 'p', span: { start: 3, end: 9, quote: 'abcdef' } });
    expect(compareRightChildren(a, b)).toBeLessThan(0);
    expect(compareRightChildren(b, a)).toBeGreaterThan(0);
  });

  it('lists the right branches first and the one down child last', () => {
    const tree = buildTree([
      node({ id: 'p' }),
      node({ id: 'down', parent: 'p', branch: 'down' }),
      node({ id: 'right', parent: 'p' }),
    ]);
    expect(ids(childrenOf(tree, 'p'))).toEqual(['right', 'down']);
    expect(downChild(tree, 'p')?.node_id).toBe('down');
  });
});

describe('withSubtrees', () => {
  const rows = [
    node({ id: 'p' }),
    node({ id: 'a1', parent: 'p', branch: 'down' }),
    node({ id: 'b', parent: 'a1' }),
    node({ id: 'b1', parent: 'b', branch: 'down' }),
    node({ id: 'other', parent: 'p' }),
    node({ id: 'loose', kind: 'note' }),
  ];

  it('takes everything under a chosen card, parents first', () => {
    expect(ids(withSubtrees(rows, new Set(['a1'])))).toEqual(['a1', 'b', 'b1']);
  });

  it('lists a card chosen with its own ancestor once, under the ancestor', () => {
    expect(ids(withSubtrees(rows, new Set(['b1', 'a1'])))).toEqual(['a1', 'b', 'b1']);
  });

  it('leaves a loose card alone, and a leaf is just itself', () => {
    expect(ids(withSubtrees(rows, new Set(['loose', 'other'])))).toEqual(['other', 'loose']);
    expect(withSubtrees(rows, new Set(['nope']))).toEqual([]);
  });
});

describe('path, depth, siblings, descendants', () => {
  const tree = buildTree([
    node({ id: 'p' }),
    node({ id: 'a1', parent: 'p', branch: 'down' }),
    node({ id: 'a2', parent: 'a1', branch: 'down' }),
    node({ id: 'b', parent: 'a1', span: spanOf(TEXT, 'identity mapping') }),
    node({ id: 'c', parent: 'a1', span: spanOf(TEXT, 'the block') }),
    node({ id: 'b1', parent: 'b', branch: 'down' }),
  ]);

  it('walks from the root to the node, both included', () => {
    expect(ids(pathTo(tree, 'b1'))).toEqual(['p', 'a1', 'b', 'b1']);
    expect(ids(pathTo(tree, 'p'))).toEqual(['p']);
    expect(pathTo(tree, 'nope')).toEqual([]);
  });

  it('stops on a cycle instead of looping', () => {
    const cyclic = buildTree([
      { ...node({ id: 'x', parent: 'y' }) },
      { ...node({ id: 'y', parent: 'x' }) },
    ]);
    expect(pathTo(cyclic, 'x').length).toBeLessThanOrEqual(2);
  });

  it('counts depth in steps from the root', () => {
    expect(depthOf(tree, 'p')).toBe(0);
    expect(depthOf(tree, 'b1')).toBe(3);
  });

  it('lists siblings without the card itself, and none for a root', () => {
    expect(ids(siblingsOf(tree, 'b'))).toEqual(['c', 'a2']);
    expect(siblingsOf(tree, 'p')).toEqual([]);
  });

  it('lists descendants depth first: right branches with their subtrees, then the continuation', () => {
    expect(ids(descendantsOf(tree, 'a1'))).toEqual(['b', 'b1', 'c', 'a2']);
    expect(descendantsOf(tree, 'a2')).toEqual([]);
  });
});

describe('branchFor (rule 3)', () => {
  const base = [node({ id: 'p' }), node({ id: 'a', parent: 'p', branch: 'down' })];

  it('makes every ask on a passage a right branch, even with no down child', () => {
    const tree = buildTree([node({ id: 'p' })]);
    expect(branchFor(tree, 'p', {})).toBe('right');
    expect(branchFor(tree, 'p', { askDifferently: true })).toBe('right');
  });

  it('makes every ask on a note a right branch', () => {
    const tree = buildTree([node({ id: 'p' }), node({ id: 'n', parent: 'p', kind: 'note' })]);
    expect(branchFor(tree, 'n', {})).toBe('right');
  });

  it('makes an ask with no words on an answer without a down child a follow-up', () => {
    const tree = buildTree(base);
    expect(branchFor(tree, 'a', {})).toBe('down');
  });

  it('makes the second plain ask from the same card a right branch', () => {
    const tree = buildTree([...base, node({ id: 'f', parent: 'a', branch: 'down' })]);
    expect(branchFor(tree, 'a', {})).toBe('right');
  });

  it('makes Ask differently a right branch even when no down child exists', () => {
    expect(branchFor(buildTree(base), 'a', { askDifferently: true })).toBe('right');
  });

  it('makes every span ask a right branch', () => {
    expect(branchFor(buildTree(base), 'a', { span: spanOf(TEXT, 'identity mapping') })).toBe(
      'right',
    );
  });

  it('is not fooled by right children when deciding the down slot', () => {
    const tree = buildTree([...base, node({ id: 'r', parent: 'a' })]);
    expect(branchFor(tree, 'a', {})).toBe('down');
  });
});

describe('isFrozen (rule 6)', () => {
  const tree = buildTree([
    node({ id: 'p' }),
    node({ id: 'withKids', parent: 'p', branch: 'down' }),
    node({ id: 'leaf', parent: 'withKids', branch: 'down' }),
    node({ id: 'note', parent: 'withKids', kind: 'note' }),
  ]);

  it('freezes an answer that has children', () => {
    expect(isFrozen(tree, 'withKids')).toBe(true);
  });

  it('leaves an answer with no children free to be retried in place', () => {
    expect(isFrozen(tree, 'leaf')).toBe(false);
  });

  it('never freezes a passage, a note or an unknown id', () => {
    expect(isFrozen(tree, 'p')).toBe(false);
    expect(isFrozen(tree, 'note')).toBe(false);
    expect(isFrozen(tree, 'nope')).toBe(false);
  });

  it('freezes an answer whose only child is a note', () => {
    const noted = buildTree([
      node({ id: 'p' }),
      node({ id: 'a', parent: 'p' }),
      node({ id: 'n', parent: 'a', kind: 'note' }),
    ]);
    expect(isFrozen(noted, 'a')).toBe(true);
  });
});

describe('spanKnots', () => {
  const identity = spanOf(TEXT, 'identity mapping');
  const params = spanOf(TEXT, 'extra parameters');
  const tree = buildTree([
    node({ id: 'p' }),
    node({ id: 'ans', parent: 'p', branch: 'down' }),
    node({ id: 'p1', parent: 'ans', span: params }),
    node({ id: 'i1', parent: 'ans', span: identity }),
    node({ id: 'i2', parent: 'ans', span: identity }),
    node({ id: 'plain', parent: 'ans' }),
  ]);

  it('counts the branches that start at each span, by position in the answer', () => {
    const knots = spanKnots(tree, 'ans');
    expect(knots.map((k) => [k.quote, k.count])).toEqual([
      ['identity mapping', 2],
      ['extra parameters', 1],
    ]);
    expect(knots[0]?.childIds).toEqual(['i1', 'i2']);
  });

  it('ignores branches without words and answers without branches', () => {
    expect(spanKnots(tree, 'plain')).toEqual([]);
    expect(spanKnots(tree, 'ans').some((k) => k.childIds.includes('plain'))).toBe(false);
  });

  it('keeps the offsets the server stored, for underlining', () => {
    const [first] = spanKnots(tree, 'ans');
    expect(first).toMatchObject({ start: identity.start, end: identity.end });
  });
});

describe('branchCounts and countsPhrase', () => {
  const tree = buildTree([
    node({ id: 'p' }),
    node({ id: 'a', parent: 'p', branch: 'down' }),
    node({ id: 'b', parent: 'a', branch: 'down' }),
    node({ id: 'n', parent: 'a', kind: 'note' }),
  ]);

  it('counts only what is hidden under the card, never the card itself', () => {
    expect(branchCounts(tree, 'a')).toEqual({ answers: 1, notes: 1 });
    expect(branchCounts(tree, 'b')).toEqual({ answers: 0, notes: 0 });
    expect(branchCounts(tree, 'p')).toEqual({ answers: 2, notes: 1 });
  });

  it('says "2 answers · 1 note" and leaves out a zero count', () => {
    expect(countsPhrase({ answers: 2, notes: 1 })).toBe('2 answers · 1 note');
    expect(countsPhrase({ answers: 1, notes: 0 })).toBe('1 answer');
    expect(countsPhrase({ answers: 0, notes: 2 })).toBe('2 notes');
    expect(countsPhrase({ answers: 0, notes: 0 })).toBe('nothing under it');
  });
});
