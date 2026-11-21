/**
 * The layered layout of the figure inside an answer, on the ten real diagrams of the 2026-11-20
 * review (`fixtures/diagram-review-fences.jsonl`, the agent's own fences): parallel branches sit
 * side by side, no box overlaps another, every arrow runs from its parent to its child and never
 * through a box, and the drawing fits the Explain panel and a board card.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseDiagramFence } from '@/features/diagram/model/fence';
import {
  layoutLayered,
  type LayeredBox,
  type LayeredLayout,
} from '@/features/diagram/model/layered';
import { withBareMaths } from '@/features/diagram/model/maths';
import { wrapLabel } from '@/features/diagram/model/fit';

interface Fixture {
  id: string;
  fence: string;
}

const FIXTURES: Fixture[] = readFileSync(
  `${process.cwd()}/test/fixtures/diagram-review-fences.jsonl`,
  'utf8',
)
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as Fixture);

const figure = (f: Fixture) => {
  const body = f.fence.replace(/^```diagram\n/, '').replace(/\n```$/, '');
  const parsed = parseDiagramFence(body);
  if (parsed === null) throw new Error(`${f.id} did not parse`);
  return parsed;
};

const lay = (f: Fixture, width: number): LayeredLayout => {
  const fig = figure(f);
  return layoutLayered(fig.parts, fig.links, width);
};

const overlaps = (a: LayeredBox, b: LayeredBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Does the segment run through the inside of the box (shrunk by 1)? */
const cuts = (
  p: readonly [number, number],
  q: readonly [number, number],
  b: LayeredBox,
): boolean => {
  const [x0, x1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])];
  const [y0, y1] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  return x1 > b.x + 1 && x0 < b.x + b.w - 1 && y1 > b.y + 1 && y0 < b.y + b.h - 1;
};

describe('layered diagram layout on the reviewed fixtures', () => {
  it('has all ten fixtures', () => {
    expect(FIXTURES).toHaveLength(10);
  });

  for (const width of [520, 300]) {
    describe(`at ${String(width)} px`, () => {
      for (const f of FIXTURES) {
        it(`${f.id}: no overlap, every arrow parent -> child, none through a box, fits`, () => {
          const fig = figure(f);
          const layout = lay(f, width);
          const box = new Map(layout.boxes.map((b) => [b.letter, b] as const));
          expect(layout.boxes).toHaveLength(fig.parts.length);
          for (let i = 0; i < layout.boxes.length; i += 1) {
            for (let j = i + 1; j < layout.boxes.length; j += 1) {
              expect(overlaps(layout.boxes[i] as LayeredBox, layout.boxes[j] as LayeredBox)).toBe(
                false,
              );
            }
          }
          // Every `after` pair is an arrow, parent above child, ends on the right sides.
          const wanted = fig.parts.flatMap((p) => p.after.map((a) => `${a}>${p.letter}`));
          expect(layout.edges.map((e) => e.key).sort()).toEqual([...wanted].sort());
          for (const e of layout.edges) {
            const [from, to] = [box.get(e.from) as LayeredBox, box.get(e.to) as LayeredBox];
            expect(from.level).toBeLessThan(to.level);
            const first = e.points[0] as readonly [number, number];
            const last = e.points[e.points.length - 1] as readonly [number, number];
            expect(first[1]).toBe(from.y + from.h);
            expect(first[0]).toBeGreaterThan(from.x);
            expect(first[0]).toBeLessThan(from.x + from.w);
            expect(last[1]).toBe(to.y);
            expect(last[0]).toBeGreaterThan(to.x);
            expect(last[0]).toBeLessThan(to.x + to.w);
            // Orthogonal, and never through a box.
            for (let k = 1; k < e.points.length; k += 1) {
              const [p, q] = [e.points[k - 1], e.points[k]] as [
                readonly [number, number],
                readonly [number, number],
              ];
              expect(p[0] === q[0] || p[1] === q[1]).toBe(true);
              for (const b of layout.boxes) expect(cuts(p, q, b)).toBe(false);
            }
          }
          // Everything drawn is inside the drawing, and the drawing is no wider than its room.
          for (const b of layout.boxes) {
            expect(b.x).toBeGreaterThanOrEqual(0);
            expect(b.x + b.w + 5).toBeLessThanOrEqual(layout.width);
            expect(b.y + b.h + 5).toBeLessThanOrEqual(layout.height);
          }
          expect(layout.width).toBeLessThanOrEqual(width);
        });
      }
    });
  }

  it('is deterministic', () => {
    for (const f of FIXTURES) expect(lay(f, 520)).toEqual(lay(f, 520));
  });

  it("draws ResNet's main path and shortcut side by side, both under the input", () => {
    const l = lay(FIXTURES[0] as Fixture, 520);
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((x) =>
      l.boxes.find((p) => p.letter === x),
    ) as LayeredBox[];
    expect(b.level).toBe(c.level);
    expect(b.y).toBe(c.y);
    expect(b.x + b.w).toBeLessThanOrEqual(c.x);
    expect(a.level).toBeLessThan(b.level);
    expect(d.level).toBeGreaterThan(b.level);
    expect(l.columns).toBe(2);
    // Three levels of boxes above the output, not five: it is shorter than the old column.
    expect(l.height).toBeLessThan(5 * 72);
  });

  it("draws GPT-3's three settings side by side, and the three inputs of attention in a row", () => {
    const gpt = lay(FIXTURES[7] as Fixture, 520);
    expect(new Set(['B', 'C', 'D'].map((x) => gpt.boxes.find((b) => b.letter === x)?.y)).size).toBe(
      1,
    );
    const attn = lay(FIXTURES[8] as Fixture, 520);
    expect(
      new Set(['A', 'B', 'C'].map((x) => attn.boxes.find((b) => b.letter === x)?.y)).size,
    ).toBe(1);
  });

  it('routes a long skip edge round the boxes, down a lane (the values reach the weighted sum)', () => {
    const l = lay(FIXTURES[8] as Fixture, 520);
    const skip = l.edges.find((e) => e.key === 'C>G') as LayeredLayout['edges'][number];
    expect(skip.points.length).toBeGreaterThan(2);
    // A lane: some vertical stretch longer than one row.
    const longest = Math.max(
      ...skip.points
        .slice(1)
        .map((p, i) => Math.abs(p[1] - (skip.points[i] as [number, number])[1])),
    );
    expect(longest).toBeGreaterThan(60);
  });

  it('keeps a pure chain as one column', () => {
    const l = lay(FIXTURES[2] as Fixture, 520);
    expect(l.columns).toBe(1);
    expect(new Set(l.boxes.map((b) => Math.round(b.x + b.w / 2))).size).toBe(1);
    expect(l.edges.every((e) => e.points.length === 2)).toBe(true);
  });

  it('wraps a rank too wide for the width onto more rows, and narrows no box below its minimum', () => {
    const parts = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((letter, i) => ({
      letter,
      label: `Head ${String(i + 1)}`,
      kind: 'step' as const,
      after: i === 0 || i === 6 ? [] : ['A'],
      edge: [],
    }));
    // A fans out to B..F; G has no parent: rank 0 holds A and G, rank 1 holds five boxes.
    const l = layoutLayered(parts, [], 300);
    expect(l.boxes.every((b) => b.w >= 100)).toBe(true);
    expect(l.width).toBeLessThanOrEqual(300);
    const levels = new Set(l.boxes.filter((b) => b.rank === 1).map((b) => b.level));
    expect(levels.size).toBeGreaterThan(1);
    for (let i = 0; i < l.boxes.length; i += 1) {
      for (let j = i + 1; j < l.boxes.length; j += 1) {
        expect(overlaps(l.boxes[i] as LayeredBox, l.boxes[j] as LayeredBox)).toBe(false);
      }
    }
  });

  it('draws a feedback link round the right-hand side without entering a box', () => {
    const fig = figure(FIXTURES[0] as Fixture);
    const l = layoutLayered(fig.parts, [{ source: 'E', target: 'B', label: 'again' }], 520);
    const link = l.edges.find((e) => e.feedback) as LayeredLayout['edges'][number];
    expect(link.key).toBe('E~B');
    for (let k = 1; k < link.points.length; k += 1) {
      for (const b of l.boxes) {
        expect(
          cuts(link.points[k - 1] as [number, number], link.points[k] as [number, number], b),
        ).toBe(false);
      }
    }
    for (const p of link.points) expect(p[0]).toBeLessThanOrEqual(l.width);
  });
});

describe('maths in labels', () => {
  it("marks bare maths as $…$ and leaves the model's own and plain words alone", () => {
    expect(withBareMaths('Scale by √d_k')).toBe('Scale by $\\sqrt{d_k}$');
    expect(withBareMaths('score_i = q·k_i')).toBe('$score_i$ = $q·k_i$');
    expect(withBareMaths('Scale by $\\sqrt{d_k}$')).toBe('Scale by $\\sqrt{d_k}$');
    expect(withBareMaths('Softmax over vocab')).toBe('Softmax over vocab');
    expect(withBareMaths('weights (α_i),')).toBe('weights ($α_i$),');
  });

  it("marks the real fixture's maths, and wraps long labels inside the box", () => {
    const l = lay(FIXTURES[8] as Fixture, 520);
    const scale = l.boxes.find((b) => b.letter === 'E') as LayeredBox;
    expect(scale.math).toBe(true);
    expect(scale.tex).toContain('$');
    const w = wrapLabel('Weighted sum of values', 100 - 16);
    expect(w.lines.length).toBeGreaterThan(1);
    expect(w.lines.length).toBeLessThanOrEqual(3);
  });
});
