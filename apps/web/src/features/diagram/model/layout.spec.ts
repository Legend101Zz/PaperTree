/**
 * The slot grid (#217, ADR-004 §2.9): slots never move as parts stream in, the plate grows
 * downward, arrows come only from earlier letters, a dropped letter keeps its empty row, the same
 * parts always give the same picture, and a 12-part plate lays out well inside a frame (16 ms).
 */
import { loadavg } from 'node:os';

import { describe, expect, it } from 'vitest';

import { plateEvents } from '../../../../test/fixtures/diagram-plate';
import { GRID, layoutPlate, rowOf, slotOf, type LayoutPart, type Route } from './layout';

import type { DiagramLink, DiagramPart } from '@/lib/api/types';

const RECORDED: DiagramPart[] = plateEvents('diagram-plate').flatMap((e) =>
  e.event === 'part' ? [e.data] : [],
);

/** A route's lines, without its label's room (a later lane at the label's height may shorten it). */
const lines = (r: Route) => ({ key: r.key, points: r.points, labelAt: r.labelAt });

const part = (
  letter: string,
  after: string[] = [],
  kind: LayoutPart['kind'] = 'step',
): LayoutPart => ({
  letter,
  kind,
  after,
  edge: after.map(() => null),
});

describe('layoutPlate: streaming', () => {
  it('reads the recorded plate: six parts, E fed by D and by A along a lane, F below E', () => {
    expect(RECORDED.map((p) => p.letter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const layout = layoutPlate(RECORDED, [], false);
    const keys = layout.routes.map((r) => r.key);
    expect(keys).toEqual(['A>B', 'B>C', 'C>D', 'D>E', 'A>E', 'D>F']);
    const ae = layout.routes.find((r) => r.key === 'A>E');
    expect(ae?.points[1]?.[0]).toBe(GRID.laneX);
    expect(ae?.label).toBe('V');
    // D>F skips E's row, so it takes a lane too: the next arrow lane, since A>E holds the first.
    const df = layout.routes.find((r) => r.key === 'D>F');
    expect(df?.points[1]?.[0]).toBe(GRID.laneX + 2 * GRID.laneGap);
  });

  it('never moves a slot or a route once drawn, and grows downward', () => {
    const final = layoutPlate(RECORDED, [], false);
    let height = 0;
    for (let n = 1; n <= RECORDED.length; n += 1) {
      const partial = layoutPlate(RECORDED.slice(0, n), [], true);
      expect(partial.slots).toEqual(final.slots.slice(0, n));
      for (const route of partial.routes) {
        const same = final.routes.find((r) => r.key === route.key);
        expect(same === undefined ? null : lines(same)).toEqual(lines(route));
      }
      expect(partial.height).toBeGreaterThan(height);
      height = partial.height;
    }
  });

  it('keeps a link on its own lanes, so a part arriving after it moves nothing', () => {
    const link: DiagramLink = { source: 'C', target: 'A', label: 'repeat' };
    const before = layoutPlate(RECORDED.slice(0, 4), [link], false);
    const after = layoutPlate(RECORDED, [link], false);
    const route = (l: ReturnType<typeof layoutPlate>, key: string) =>
      l.routes.find((r) => r.key === key);
    expect(lines(route(after, 'C~A') as Route)).toEqual(lines(route(before, 'C~A') as Route));
    expect(route(after, 'C~A')?.points[1]?.[0]).toBe(GRID.laneX + GRID.laneGap);
    expect(route(after, 'C~A')?.feedback).toBe(true);
    // And the `after` arrows are the same with or without the link.
    expect(after.routes.filter((r) => !r.feedback).map(lines)).toEqual(
      layoutPlate(RECORDED, [], false).routes.map(lines),
    );
  });

  it('shows the part still arriving on the next row while drawing, and not after', () => {
    expect(layoutPlate([part('A')], [], true).ghost).toMatchObject({ letter: 'B', row: 1 });
    expect(layoutPlate([part('A')], [], false).ghost).toBeNull();
    const full = 'ABCDEFGHIJKL'.split('').map((l) => part(l));
    expect(layoutPlate(full, [], true).ghost).toBeNull();
  });
});

describe('layoutPlate: honesty and determinism', () => {
  it('draws arrows only from earlier, placed letters', () => {
    const layout = layoutPlate(
      [part('A'), part('B', ['A', 'C', 'B', 'Z', 'A']), part('C', ['B'])],
      [],
      false,
    );
    expect(layout.routes.map((r) => r.key)).toEqual(['A>B', 'B>C']);
  });

  it('keeps a dropped letter as an empty row: D stays D, never renumbered', () => {
    const layout = layoutPlate([part('A'), part('B', ['A']), part('D', ['B'])], [], false);
    expect(layout.gaps.map((g) => g.letter)).toEqual(['C']);
    expect(layout.slots.map((s) => [s.letter, s.row])).toEqual([
      ['A', 0],
      ['B', 1],
      ['D', 3],
    ]);
    // Nothing stands between B and D, so the arrow runs straight down the column.
    expect(layout.routes[1]?.points).toHaveLength(2);
  });

  it('is deterministic: the same parts in any arrival order give the same picture', () => {
    const shuffled = [...RECORDED].reverse();
    expect(layoutPlate(shuffled, [], false)).toEqual(layoutPlate(RECORDED, [], false));
    expect(layoutPlate(RECORDED, [], false)).toEqual(layoutPlate(RECORDED, [], false));
  });

  it('never puts two arrows on one lane: more skips widen the drawing (review S4)', () => {
    // The reviewer's 12-part plate: A and B both skip far down, with many skips between.
    const twelve = [
      part('A'),
      part('B', ['A']),
      part('C', ['B']),
      part('D', ['C', 'A']),
      part('E', ['D', 'B']),
      part('F', ['E', 'A']),
      part('G', ['F', 'B']),
      part('H', ['G', 'C']),
      part('I', ['H', 'B']),
      part('J', ['I', 'A']),
      part('K', ['J', 'C']),
      part('L', ['K', 'D']),
    ];
    const layout = layoutPlate(twelve, [{ source: 'L', target: 'B', label: 'again' }], false);
    const lanes = layout.routes.filter((r) => r.points.length === 4);
    const x = (key: string) => lanes.find((r) => r.key === key)?.points[1]?.[0];
    expect(x('A>J')).not.toBe(x('B>I'));
    // Any two lane routes whose rows overlap stand on different lanes.
    const rowSpan = (r: (typeof lanes)[number]) =>
      [r.from, r.to].map((l) => rowOf(l)).sort((a, b) => a - b) as [number, number];
    for (const a of lanes) {
      for (const b of lanes) {
        if (a === b) continue;
        const [a0, a1] = rowSpan(a);
        const [b0, b1] = rowSpan(b);
        if (a0 <= b1 && b0 <= a1) expect(a.points[1]?.[0]).not.toBe(b.points[1]?.[0]);
      }
    }
    expect(layout.width).toBeGreaterThan(GRID.width);
    // Widening moves nothing already drawn: the first eleven parts' arrows keep their lanes.
    const before = layoutPlate(twelve.slice(0, 11), [], false);
    for (const r of before.routes) {
      expect(lines(layout.routes.find((q) => q.key === r.key) as Route)).toEqual(lines(r));
    }
    // A lane label never runs into the next lane at its height: its room stops short of it.
    for (const r of layout.routes.filter((q) => q.points.length === 4)) {
      expect(r.labelAt[0] + r.labelRoom).toBeLessThanOrEqual(layout.width);
    }
  });

  it('places a slot by its letter alone, an output a size larger', () => {
    expect(rowOf('A')).toBe(0);
    expect(rowOf('L')).toBe(11);
    expect(rowOf('M')).toBe(-1);
    expect(slotOf('C', 'step')).toMatchObject({ row: 2, y: GRID.top + 2 * GRID.row, w: GRID.boxW });
    expect(slotOf('C', 'output').w).toBe(GRID.boxW + 2 * GRID.outGrow);
  });

  it('lays out a 12-part plate in under 16 ms (the median of 50, with the load average)', () => {
    const twelve = 'ABCDEFGHIJKL'
      .split('')
      .map((l, i) => part(l, i === 0 ? [] : i > 2 ? ['A', 'ABCDEFGHIJKL'[i - 1] ?? 'A'] : ['A']));
    const links: DiagramLink[] = [{ source: 'L', target: 'B', label: 'again' }];
    const times: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const t0 = performance.now();
      layoutPlate(twelve, links, true);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[25] ?? Infinity;
    console.info(
      `layoutPlate 12 parts: median ${median.toFixed(3)} ms, max ${(times[49] ?? 0).toFixed(3)} ms; load average ${loadavg()
        .map((n) => n.toFixed(2))
        .join(' ')}`,
    );
    expect(median).toBeLessThan(16);
  });
});
