import { beforeEach, describe, expect, it } from 'vitest';

import {
  CARD_RIGHT_PADDING,
  CARD_WIDTH,
  COLUMN_GAP,
  DOWN_GAP,
  ESTIMATED_HEIGHT,
  PILL_HEIGHT,
  ROW_GAP,
  heightCap,
  layoutBoard,
  offsetForDrop,
  tidyResets,
  type LayoutInput,
} from './layout';
import { DRAFT_ID } from './display';
import { buildTree } from './tree';
import { node, resetClock, spanOf } from './treeFixtures';

const TEXT = 'An identity mapping adds no extra parameters, so the block can do nothing.';
const VIEWPORT = 1000;

/** Heights by id; anything not listed is "not measured yet". */
const heights =
  (table: Record<string, number>): LayoutInput['measure'] =>
  (id) =>
    table[id];

const input = (table: Record<string, number> = {}): LayoutInput => ({
  viewportHeight: VIEWPORT,
  measure: heights(table),
});

beforeEach(resetClock);

describe('layoutBoard: placing', () => {
  it('puts a root at its own position', () => {
    const tree = buildTree([node({ id: 'p', x: 40, y: 60 })]);
    const card = layoutBoard(tree, input({ p: 200 })).cards.get('p');
    expect(card).toMatchObject({ x: 40, y: 60, w: CARD_WIDTH.passage, h: 200 });
  });

  it('puts the down child straight under its parent, a down gap below', () => {
    const tree = buildTree([
      node({ id: 'p', x: 10, y: 20 }),
      node({ id: 'a', parent: 'p', branch: 'down' }),
    ]);
    const { cards } = layoutBoard(tree, input({ p: 200, a: 150 }));
    expect(cards.get('a')).toMatchObject({ x: 10, y: 20 + 200 + DOWN_GAP });
  });

  it('puts right children in the next column, stacked in span order with a row gap', () => {
    const late = spanOf(TEXT, 'the block can do nothing');
    const early = spanOf(TEXT, 'identity mapping');
    const tree = buildTree([
      node({ id: 'p', x: 0, y: 0 }),
      node({ id: 'ans', parent: 'p', branch: 'down' }),
      node({ id: 'late', parent: 'ans', span: late }),
      node({ id: 'early', parent: 'ans', span: early }),
    ]);
    const { cards } = layoutBoard(tree, input({ p: 100, ans: 180, late: 90, early: 120 }));
    const ans = cards.get('ans');
    const early1 = cards.get('early');
    const late1 = cards.get('late');
    expect(ans).toBeDefined();
    const column = (ans?.x ?? 0) + (ans?.w ?? 0) + COLUMN_GAP;
    expect(early1).toMatchObject({ x: column, y: ans?.y });
    expect(late1).toMatchObject({ x: column, y: (ans?.y ?? 0) + 120 + ROW_GAP });
  });

  it('makes an answer to the right of a passage a little wider than one to the right of an answer', () => {
    const tree = buildTree([
      node({ id: 'p' }),
      node({ id: 'viaPassage', parent: 'p' }),
      node({ id: 'ans', parent: 'p', branch: 'down' }),
      node({ id: 'viaAnswer', parent: 'ans' }),
    ]);
    const { cards } = layoutBoard(tree, input());
    expect(cards.get('viaPassage')?.w).toBe(CARD_WIDTH.answerOfPassage);
    expect(cards.get('viaAnswer')?.w).toBe(CARD_WIDTH.answer);
  });

  it('keeps the right branches of a down child below its parent’s own right stack', () => {
    const tree = buildTree([
      node({ id: 'p', x: 0, y: 0 }),
      node({ id: 'side', parent: 'p', kind: 'note' }),
      node({ id: 'down', parent: 'p', branch: 'down' }),
      node({ id: 'deep', parent: 'down' }),
    ]);
    const { cards } = layoutBoard(tree, input({ p: 100, side: 400, down: 80, deep: 60 }));
    const side = cards.get('side');
    const deep = cards.get('deep');
    // Both sit in the column right of the passage's stack: without the floor, `deep` (a short card
    // under a short parent) would start at the top of it and overlap `side`.
    expect(deep?.y).toBeGreaterThanOrEqual((side?.y ?? 0) + (side?.h ?? 0) + ROW_GAP);
  });

  it('ignores loose cards: they get no place', () => {
    const tree = buildTree([
      node({ id: 'p' }),
      node({ id: 'loose', kind: 'note', x: 500, y: 500 }),
    ]);
    const layout = layoutBoard(tree, input());
    expect(layout.cards.has('loose')).toBe(false);
    expect(layout.order).toEqual(['p']);
  });

  it('is deterministic', () => {
    const rows = [
      node({ id: 'p', x: 5, y: 9 }),
      node({ id: 'a', parent: 'p', branch: 'down' }),
      node({ id: 'b', parent: 'a' }),
    ];
    const a = layoutBoard(buildTree(rows), input({ p: 120, a: 140, b: 99 }));
    const b = layoutBoard(buildTree([...rows].reverse()), input({ p: 120, a: 140, b: 99 }));
    expect([...a.cards.values()]).toEqual([...b.cards.values()]);
    expect(a.order).toEqual(b.order);
  });
});

describe('layoutBoard: heights', () => {
  it('caps a tall card at 60% of the viewport and says it scrolls inside', () => {
    const tree = buildTree([node({ id: 'p' })]);
    const card = layoutBoard(tree, input({ p: 5000 })).cards.get('p');
    expect(heightCap(VIEWPORT)).toBe(600);
    expect(card).toMatchObject({ h: 600, scrolls: true });
  });

  it('does not cap or flag a card that fits', () => {
    const tree = buildTree([node({ id: 'p' })]);
    expect(layoutBoard(tree, input({ p: 599 })).cards.get('p')).toMatchObject({
      h: 599,
      scrolls: false,
    });
  });

  it('follows the viewport: the same text is capped lower in a shorter window', () => {
    const tree = buildTree([node({ id: 'p' })]);
    const short = layoutBoard(tree, { viewportHeight: 500, measure: heights({ p: 5000 }) });
    expect(short.cards.get('p')?.h).toBe(300);
  });

  it('uses an estimate until a card is measured', () => {
    const tree = buildTree([node({ id: 'p' }), node({ id: 'a', parent: 'p', branch: 'down' })]);
    const { cards } = layoutBoard(tree, input());
    expect(cards.get('p')?.h).toBe(ESTIMATED_HEIGHT.passage);
    expect(cards.get('a')?.h).toBe(ESTIMATED_HEIGHT.answer);
  });

  it('shifts what is below when a card above it is measured taller', () => {
    const tree = buildTree([node({ id: 'p' }), node({ id: 'a', parent: 'p', branch: 'down' })]);
    const before = layoutBoard(tree, input({ p: 100 })).cards.get('a')?.y ?? 0;
    const after = layoutBoard(tree, input({ p: 300 })).cards.get('a')?.y ?? 0;
    expect(after - before).toBe(200);
  });
});

describe('layoutBoard: offsets carry the whole subtree', () => {
  const rows = (offset?: { x: number; y: number }, childOffset?: { x: number; y: number }) => [
    node({ id: 'p', x: 0, y: 0 }),
    node({ id: 'a', parent: 'p', branch: 'down', offset }),
    node({ id: 'b', parent: 'a', offset: childOffset }),
    node({ id: 'c', parent: 'b', branch: 'down' }),
  ];
  const table = { p: 100, a: 100, b: 100, c: 100 };

  it('moves a dragged card and every card under it, and nothing else', () => {
    const plain = layoutBoard(buildTree(rows()), input(table)).cards;
    const moved = layoutBoard(buildTree(rows({ x: 30, y: -20 })), input(table)).cards;
    for (const id of ['a', 'b', 'c']) {
      expect(moved.get(id)?.x).toBe((plain.get(id)?.x ?? 0) + 30);
      expect(moved.get(id)?.y).toBe((plain.get(id)?.y ?? 0) - 20);
    }
    expect(moved.get('p')).toEqual(plain.get('p'));
  });

  it('adds a child’s own offset on top of the one it inherits', () => {
    const plain = layoutBoard(buildTree(rows()), input(table)).cards;
    const both = layoutBoard(buildTree(rows({ x: 10, y: 10 }, { x: 5, y: 7 })), input(table)).cards;
    expect(both.get('b')?.x).toBe((plain.get('b')?.x ?? 0) + 15);
    expect(both.get('b')?.y).toBe((plain.get('b')?.y ?? 0) + 17);
    expect(both.get('c')?.x).toBe((plain.get('c')?.x ?? 0) + 15);
    expect(both.get('a')?.x).toBe((plain.get('a')?.x ?? 0) + 10);
  });

  it('reports where the card would be without its own offset, for measuring a drag', () => {
    const cards = layoutBoard(buildTree(rows({ x: 30, y: 40 })), input(table)).cards;
    const a = cards.get('a');
    expect(a).toBeDefined();
    if (a === undefined) return;
    expect(a.baseX).toBe(a.x - 30);
    expect(a.baseY).toBe(a.y - 40);
    expect(offsetForDrop(a, { x: a.baseX + 12, y: a.baseY - 3 })).toEqual({
      offset_x: 12,
      offset_y: -3,
    });
  });

  it('lists the offsets Tidy clears, and none for a tidy tree', () => {
    const tree = buildTree(rows({ x: 30, y: 40 }, { x: 0, y: 5 }));
    expect(tidyResets(tree, 'p')).toEqual(['a', 'b']);
    expect(tidyResets(buildTree(rows()), 'p')).toEqual([]);
    expect(tidyResets(tree, 'nope')).toEqual([]);
  });
});

describe('layoutBoard: fold', () => {
  const rows = [
    node({ id: 'p', x: 0, y: 0 }),
    node({ id: 'a', parent: 'p', branch: 'down', folded: true }),
    node({ id: 'b', parent: 'a', branch: 'down' }),
    node({ id: 'n', parent: 'a', kind: 'note' }),
    node({ id: 'after', parent: 'p' }),
  ];

  it('turns a folded branch into one pill with its counts', () => {
    const layout = layoutBoard(buildTree(rows), input({ p: 100 }));
    const pill = layout.cards.get('a');
    expect(pill?.h).toBe(PILL_HEIGHT);
    expect(pill?.pill?.label).toBe('2 answers · 1 note');
    expect(pill?.pill?.counts).toEqual({ answers: 2, notes: 1 });
  });

  it('hides everything under the pill and draws no line to it', () => {
    const layout = layoutBoard(buildTree(rows), input({ p: 100 }));
    expect([...layout.hidden].sort()).toEqual(['b', 'n']);
    expect(layout.cards.has('b')).toBe(false);
    expect(layout.edges.some((e) => e.id === 'b' || e.id === 'n')).toBe(false);
    expect(layout.edges.some((e) => e.id === 'a')).toBe(true);
  });

  it('keeps the pill where the card was, only shorter than the card', () => {
    const open = layoutBoard(
      buildTree(rows.map((r) => ({ ...r, folded: false }))),
      input({ p: 100, a: 300 }),
    );
    const shut = layoutBoard(buildTree(rows), input({ p: 100, a: 300 }));
    expect(shut.cards.get('a')).toMatchObject({
      x: open.cards.get('a')?.x,
      y: open.cards.get('a')?.y,
    });
    expect(shut.cards.get('a')?.h).toBeLessThan(open.cards.get('a')?.h ?? 0);
  });

  it('gives an unfolded card no pill', () => {
    const layout = layoutBoard(buildTree(rows.map((r) => ({ ...r, folded: false }))), input());
    expect(layout.cards.get('a')?.pill).toBeNull();
    expect(layout.hidden.size).toBe(0);
  });
});

describe('layoutBoard: edges', () => {
  const rows = [
    node({ id: 'p', x: 0, y: 0 }),
    node({ id: 'ans', parent: 'p', branch: 'down' }),
    node({ id: 'viaSpan', parent: 'ans', span: spanOf(TEXT, 'identity mapping') }),
    node({ id: 'differently', parent: 'ans' }),
    node({ id: 'follow', parent: 'ans', branch: 'down' }),
  ];
  const table = { p: 100, ans: 200, viaSpan: 80, differently: 80, follow: 80 };

  it('starts a span line inside the card’s right padding, at the words’ height', () => {
    const layout = layoutBoard(buildTree(rows), {
      ...input(table),
      spanY: (parent, span) =>
        parent === 'ans' && span.start === TEXT.indexOf('identity') ? 74 : undefined,
    });
    const ans = layout.cards.get('ans');
    const edge = layout.edges.find((e) => e.id === 'viaSpan');
    expect(edge?.branch).toBe('right');
    expect(edge?.from.x).toBe((ans?.x ?? 0) + (ans?.w ?? 0) - CARD_RIGHT_PADDING / 2);
    expect(edge?.from.y).toBe((ans?.y ?? 0) + 74);
    // It enters the child at its left edge, near the top.
    const child = layout.cards.get('viaSpan');
    expect(edge?.to.x).toBe(child?.x);
  });

  it('keeps the start inside the card for a span on the very first or last line', () => {
    const top = layoutBoard(buildTree(rows), { ...input(table), spanY: () => -50 });
    const bottom = layoutBoard(buildTree(rows), { ...input(table), spanY: () => 9999 });
    const ans = top.cards.get('ans');
    expect(top.edges.find((e) => e.id === 'viaSpan')?.from.y).toBeGreaterThanOrEqual(ans?.y ?? 0);
    const last = bottom.edges.find((e) => e.id === 'viaSpan');
    expect(last?.from.y).toBeLessThanOrEqual((ans?.y ?? 0) + (ans?.h ?? 0));
  });

  it('leaves a branch with no measured words level with the header', () => {
    const layout = layoutBoard(buildTree(rows), input(table));
    const ans = layout.cards.get('ans');
    expect(layout.edges.find((e) => e.id === 'differently')?.from.y).toBe((ans?.y ?? 0) + 32);
  });

  it('joins a down child from the bottom middle of its parent to its top middle', () => {
    const layout = layoutBoard(buildTree(rows), input(table));
    const ans = layout.cards.get('ans');
    const follow = layout.cards.get('follow');
    const edge = layout.edges.find((e) => e.id === 'follow');
    expect(edge?.branch).toBe('down');
    expect(edge?.from).toEqual({
      x: (ans?.x ?? 0) + (ans?.w ?? 0) / 2,
      y: (ans?.y ?? 0) + (ans?.h ?? 0),
    });
    expect(edge?.to).toEqual({ x: (follow?.x ?? 0) + (follow?.w ?? 0) / 2, y: follow?.y });
  });

  it('draws one line per child, parent first', () => {
    const layout = layoutBoard(buildTree(rows), input(table));
    expect(layout.edges.map((e) => e.id).sort()).toEqual([
      'ans',
      'differently',
      'follow',
      'viaSpan',
    ]);
    expect(layout.edges.every((e) => e.parentId.length > 0)).toBe(true);
  });

  it('draws the follow-up stub of the newest answer as ONE more down line, the pending one', () => {
    // second -> third is a real down line; the focused third offers its own stub (the draft), whose
    // line is the only other down line. The board marks the draft's line `data-pending`.
    const tree = buildTree([
      node({ id: 'p', x: 0, y: 0 }),
      node({ id: 'second', parent: 'p' }),
      node({ id: 'third', parent: 'second', branch: 'down' }),
      node({ id: DRAFT_ID, parent: 'third', branch: 'down' }),
    ]);
    const edges = layoutBoard(tree, input({ p: 100, second: 150, third: 150 })).edges;
    const down = edges.filter((e) => e.branch === 'down');
    expect(down.map((e) => e.id).sort()).toEqual([DRAFT_ID, 'third'].sort());
    expect(down.filter((e) => e.id !== DRAFT_ID)).toHaveLength(1);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });

  it('carries the line with a dragged parent, because both ends move', () => {
    const moved = rows.map((r) => (r.node_id === 'ans' ? { ...r, offset_x: 50, offset_y: 0 } : r));
    const before = layoutBoard(buildTree(rows), input(table)).edges.find((e) => e.id === 'viaSpan');
    const after = layoutBoard(buildTree(moved), input(table)).edges.find((e) => e.id === 'viaSpan');
    expect(after?.from.x).toBe((before?.from.x ?? 0) + 50);
    expect(after?.to.x).toBe((before?.to.x ?? 0) + 50);
  });
});
