import { beforeEach, describe, expect, it } from 'vitest';

import { buildTree } from './tree';
import { heightCap, layoutBoard } from './layout';
import { GAP, overlaps, rootSpot, type Rect } from './placement';
import { node, resetClock } from './treeFixtures';

const SIZE = { w: 340, h: 200 };
const VIEWPORT = 800;

/** Every box a board draws: the trees as `layoutBoard` places them at their capped height, then loose cards. */
function drawn(rows: ReturnType<typeof node>[]): Rect[] {
  const tree = buildTree(rows);
  const placed = layoutBoard(tree, {
    viewportHeight: VIEWPORT,
    measure: () => heightCap(VIEWPORT),
  });
  return [
    ...[...placed.cards.values()].map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h })),
    ...tree.loose.map((n) => ({ x: n.x, y: n.y, w: 300, h: 200 })),
  ];
}

beforeEach(resetClock);

describe('rootSpot: where a new tree root goes', () => {
  it('is the origin on an empty board', () => {
    expect(rootSpot([], SIZE, VIEWPORT)).toEqual({ x: 0, y: 0 });
  });

  it('goes below the tallest tree, which freeSpot cannot see', () => {
    // A passage with a tall conversation down its left side and a right branch.
    const rows = [
      node({ id: 'p', x: 40, y: 60 }),
      node({ id: 'a1', parent: 'p', branch: 'right' }),
      node({ id: 'a2', parent: 'a1', branch: 'down' }),
      node({ id: 'a3', parent: 'a2', branch: 'down' }),
      node({ id: 'a4', parent: 'a3', branch: 'down' }),
    ];
    const spot = rootSpot(rows, SIZE, VIEWPORT);
    const mine = { ...spot, ...SIZE };
    for (const box of drawn(rows))
      expect(overlaps(mine, box, GAP), JSON.stringify(box)).toBe(false);
    const bottom = Math.max(...drawn(rows).map((r) => r.y + r.h));
    expect(spot.y).toBeGreaterThanOrEqual(bottom + GAP);
    // In line with the tree above it.
    expect(spot.x).toBe(40);
  });

  it('never lands on a second tree to the right of the first', () => {
    const rows = [
      node({ id: 'p1', x: 0, y: 0 }),
      node({ id: 'a', parent: 'p1', branch: 'down' }),
      node({ id: 'p2', x: 900, y: 0 }),
      node({ id: 'b', parent: 'p2', branch: 'right' }),
      node({ id: 'c', parent: 'b', branch: 'down' }),
    ];
    const mine = { ...rootSpot(rows, SIZE, VIEWPORT), ...SIZE };
    for (const box of drawn(rows)) expect(overlaps(mine, box, GAP)).toBe(false);
  });

  it('keeps loose notes and frames out of the way too', () => {
    const rows = [
      node({ id: 'p', x: 0, y: 0 }),
      // A loose v0.2 note sitting right where the new root would start.
      node({ id: 'loose', kind: 'note', x: 0, y: 600 }),
    ];
    const mine = { ...rootSpot(rows, SIZE, VIEWPORT), ...SIZE };
    for (const box of drawn(rows)) expect(overlaps(mine, box, GAP)).toBe(false);
  });

  it('leaves a board of loose cards only to the old grid', () => {
    const rows = [node({ id: 'n', kind: 'note', x: 0, y: 0 })];
    const mine = { ...rootSpot(rows, SIZE, VIEWPORT), ...SIZE };
    expect(overlaps(mine, { x: 0, y: 0, w: 300, h: 200 }, GAP)).toBe(false);
  });
});
