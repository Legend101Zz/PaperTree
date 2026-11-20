/**
 * The layered layout of the figure inside an answer (v0.3 diagram review, 2026-11-20). The plate's
 * slot grid (`layout.ts`) puts every part in one column in part order, so two branches that both
 * start at "Input" and meet at "Add" read as a chain. This lays the same parts out as a graph:
 *
 *  1. Rank: a part with no `after` is rank 0; any other is one more than its deepest parent.
 *  2. Levels: a rank is one row of boxes side by side; a rank too wide for the width wraps onto
 *     further rows (`columns`), its siblings stay unconnected so nothing is implied.
 *  3. An arrow that skips rows gets a virtual lane box on each row it crosses, ordered and spaced
 *     like a box, so it runs between boxes and never through one.
 *  4. Order each row by the barycentre of its neighbours, a few sweeps, keeping the ordering with
 *     the fewest crossings; then spread x by an order-preserving least-squares pull towards the
 *     neighbours.
 *  5. Arrows leave the bottom of a parent and enter the top of a child at spread ports, straight
 *     when the ends line up, else one short elbow in the gap between the rows.
 *
 * A pure chain (one box per row) comes out as the column it always was. Pure, deterministic and
 * measured in SVG user units; `maxWidth` is the room the drawing has (the Explain panel ~520, a
 * board card ~300), and boxes narrow (down to `minW`) before a row wraps.
 */
import { mathToPlain } from '@/lib/markdown';

import { wrapLabel } from './fit';
import { withBareMaths } from './maths';

import type { DiagramLink, DiagramPart } from '@/lib/api/types';

/** The measures of the layered figure, in SVG user units. */
export const LAYERED = {
  /** Outer margin; the right and bottom also hold the hatched shadow (5). */
  pad: 6,
  gapX: 14,
  minW: 100,
  maxW: 156,
  /** The width of a virtual lane box: the room an arrow passing a row takes. */
  laneW: 14,
  minH: 38,
  lineH: 16,
  /** Vertical padding inside a box. */
  boxPad: 14,
  defaultWidth: 520,
  /** What a link's margin lane stands from the boxes and from its neighbour. */
  linkOut: 12,
  linkGap: 8,
} as const;

/** What the layout needs of a part. */
export type LayeredPart = Pick<DiagramPart, 'letter' | 'label' | 'kind' | 'after' | 'edge'>;

/** A drawn box. */
export interface LayeredBox {
  readonly letter: string;
  readonly kind: DiagramPart['kind'];
  /** The label with bare maths marked as `$…$`; `math` says it holds some. */
  readonly tex: string;
  readonly math: boolean;
  /** The label as plain words, wrapped, at `size`. */
  readonly size: number;
  readonly lines: readonly string[];
  readonly rank: number;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A drawn arrow: from a parent's bottom to a child's top (a link leaves and enters by the gaps). */
export interface LayeredEdge {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
  readonly feedback: boolean;
  /** The polyline, in drawing order; the arrowhead sits on the last point. */
  readonly points: readonly (readonly [number, number])[];
  readonly labelAt: readonly [number, number];
  readonly labelRoom: number;
}

/** Everything the layered drawing needs. */
export interface LayeredLayout {
  readonly boxes: readonly LayeredBox[];
  readonly edges: readonly LayeredEdge[];
  readonly width: number;
  readonly height: number;
  /** The most boxes on one row: 1 is a column (a pure chain). */
  readonly columns: number;
}

interface Node {
  readonly id: number;
  /** The part's letter, or null for a lane box. */
  readonly letter: string | null;
  level: number;
  w: number;
  /** Centre x. */
  cx: number;
}

interface Seg {
  readonly a: number;
  readonly b: number;
  readonly edge: number;
}

const mean = (values: readonly number[]): number =>
  values.reduce((s, v) => s + v, 0) / values.length;

/**
 * The closest non-decreasing sequence (pool adjacent violators, unit weights).
 *
 * @param values The sequence to fit.
 * @returns The fitted sequence.
 */
function isotonic(values: readonly number[]): number[] {
  const blocks: { sum: number; n: number }[] = [];
  for (const v of values) {
    blocks.push({ sum: v, n: 1 });
    while (blocks.length > 1) {
      const top = blocks[blocks.length - 1] as { sum: number; n: number };
      const below = blocks[blocks.length - 2] as { sum: number; n: number };
      if (below.sum / below.n <= top.sum / top.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: below.sum + top.sum, n: below.n + top.n });
    }
  }
  return blocks.flatMap((b) => Array.from({ length: b.n }, () => b.sum / b.n));
}

/**
 * Drop repeated and collinear points of a polyline.
 *
 * @param points The polyline.
 * @returns The polyline without them.
 */
function simplify(points: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === p[0] && last[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  for (let i = out.length - 2; i > 0; i -= 1) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]] as [
      [number, number],
      [number, number],
      [number, number],
    ];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(i, 1);
  }
  return out;
}

/**
 * Lay out a figure as layers.
 *
 * @param parts The parts, letters rising; an `after` letter must name an earlier part (others are
 *   ignored).
 * @param links Feedback links (`from` and `to` letters), drawn round the right-hand side.
 * @param maxWidth The room the drawing has; boxes narrow and rows wrap to fit it.
 * @returns Boxes, arrows and the drawing's size.
 * @example
 * layoutLayered(resnetParts, [], 520).columns; // 2 (the main path and the shortcut side by side)
 */
export function layoutLayered(
  parts: readonly LayeredPart[],
  links: readonly DiagramLink[] = [],
  maxWidth: number = LAYERED.defaultWidth,
): LayeredLayout {
  const { pad, gapX, laneW } = LAYERED;
  const avail = Math.max(LAYERED.minW + 2 * pad, maxWidth) - 2 * pad;

  // 1. Rank.
  const known = new Map<string, number>();
  const rank = new Map<string, number>();
  const parents = new Map<string, string[]>();
  const edgeLabel = new Map<string, string | null>();
  const placed: LayeredPart[] = [];
  for (const part of parts) {
    if (known.has(part.letter)) continue;
    const ps = [...new Set(part.after)].filter((l) => known.has(l));
    parents.set(part.letter, ps);
    part.after.forEach((l, i) => {
      if (!edgeLabel.has(`${l}>${part.letter}`))
        edgeLabel.set(`${l}>${part.letter}`, part.edge[i] ?? null);
    });
    rank.set(part.letter, ps.length === 0 ? 0 : 1 + Math.max(...ps.map((l) => rank.get(l) ?? 0)));
    known.set(part.letter, placed.length);
    placed.push(part);
  }
  if (placed.length === 0)
    return { boxes: [], edges: [], width: 2 * pad, height: 2 * pad, columns: 0 };

  /**
   * Steps 2-4 for a row holding at most `perRow` boxes.
   *
   * @param perRow The most boxes a row holds before it wraps.
   * @returns The nodes, rows and segments.
   */
  const build = (perRow: number) => {
    // 2. Levels: one row per rank, a wide rank wrapped onto several.
    const nodes: Node[] = [];
    const nodeOf = new Map<string, number>();
    const rows: number[][] = [];
    const centred = (row: readonly number[], id: number): number =>
      row.indexOf(id) - (row.length - 1) / 2;
    const maxRank = Math.max(...rank.values());
    for (let r = 0; r <= maxRank; r += 1) {
      const here = placed.filter((p) => rank.get(p.letter) === r);
      const bary = (p: LayeredPart): number => {
        const ps = parents.get(p.letter) ?? [];
        if (ps.length === 0) return known.get(p.letter) as number;
        return mean(
          ps.map((l) => {
            const id = nodeOf.get(l) as number;
            return centred(rows[(nodes[id] as Node).level] as number[], id);
          }),
        );
      };
      const sorted = here
        .map((p) => ({ p, b: bary(p) }))
        .sort(
          (x, y) =>
            x.b - y.b || (known.get(x.p.letter) as number) - (known.get(y.p.letter) as number),
        )
        .map((x) => x.p);
      const chunks = Math.ceil(sorted.length / perRow);
      const size = Math.ceil(sorted.length / chunks);
      for (let c = 0; c < chunks; c += 1) {
        const level = rows.length;
        const row: number[] = [];
        for (const p of sorted.slice(c * size, (c + 1) * size)) {
          const id = nodes.length;
          nodes.push({ id, letter: p.letter, level, w: 0, cx: 0 });
          nodeOf.set(p.letter, id);
          row.push(id);
        }
        rows.push(row);
      }
    }

    // 3. Virtual lane boxes for the arrows that skip rows.
    const edgeList: { from: string; to: string }[] = [];
    const segs: Seg[] = [];
    for (const part of placed) {
      for (const from of parents.get(part.letter) ?? []) {
        const e = edgeList.length;
        edgeList.push({ from, to: part.letter });
        let prev = nodeOf.get(from) as number;
        const end = nodeOf.get(part.letter) as number;
        for (
          let level = (nodes[prev] as Node).level + 1;
          level < (nodes[end] as Node).level;
          level += 1
        ) {
          const id = nodes.length;
          nodes.push({ id, letter: null, level, w: laneW, cx: 0 });
          (rows[level] as number[]).push(id);
          segs.push({ a: prev, b: id, edge: e });
          prev = id;
        }
        segs.push({ a: prev, b: end, edge: e });
      }
    }

    // 4. Order each row: barycentre sweeps, keep the fewest crossings.
    const pos = (id: number): number => centred(rows[(nodes[id] as Node).level] as number[], id);
    const crossings = (): number => {
      let n = 0;
      for (let i = 0; i < segs.length; i += 1) {
        for (let j = i + 1; j < segs.length; j += 1) {
          const [s, t] = [segs[i] as Seg, segs[j] as Seg];
          if ((nodes[s.a] as Node).level !== (nodes[t.a] as Node).level) continue;
          if ((pos(s.a) - pos(t.a)) * (pos(s.b) - pos(t.b)) < 0) n += 1;
        }
      }
      return n;
    };
    const sweep = (level: number, down: boolean): void => {
      const row = rows[level] as number[];
      const keyed = row.map((id, i) => {
        const near = segs
          .filter((s) => (down ? s.b : s.a) === id)
          .map((s) => pos(down ? s.a : s.b));
        return { id, k: near.length === 0 ? i - (row.length - 1) / 2 : mean(near), i };
      });
      keyed.sort((x, y) => x.k - y.k || x.i - y.i);
      rows[level] = keyed.map((x) => x.id);
    };
    let best = rows.map((r) => [...r]);
    let bestCross = crossings();
    for (let pass = 0; pass < 6 && bestCross > 0; pass += 1) {
      if (pass % 2 === 0) for (let l = 1; l < rows.length; l += 1) sweep(l, true);
      else for (let l = rows.length - 2; l >= 0; l -= 1) sweep(l, false);
      const now = crossings();
      if (now < bestCross) {
        bestCross = now;
        best = rows.map((r) => [...r]);
      }
    }
    best.forEach((r, i) => (rows[i] = r));

    return { nodes, nodeOf, rows, edgeList, segs };
  };
  // 5. Sizes: one box width for the figure (wrapping rows tighter until boxes keep their minimum).
  let perRow = Math.max(1, Math.floor((avail + gapX) / (LAYERED.minW + gapX)));
  let built = build(perRow);
  let boxW = 0;
  for (;;) {
    boxW = LAYERED.maxW;
    for (const row of built.rows) {
      const real = row.filter((id) => (built.nodes[id] as Node).letter !== null).length;
      const lanes = row.length - real;
      boxW = Math.min(boxW, Math.floor((avail - lanes * laneW - (row.length - 1) * gapX) / real));
    }
    if (boxW >= LAYERED.minW || perRow === 1) break;
    perRow -= 1;
    built = build(perRow);
  }
  const { nodes, nodeOf, rows, edgeList, segs } = built;
  boxW = Math.max(LAYERED.minW, boxW);
  const byLetter = new Map(placed.map((p) => [p.letter, p] as const));
  const texOf = (p: LayeredPart): string => withBareMaths(p.label);
  const wrapped = new Map(
    placed.map((p) => [p.letter, wrapLabel(mathToPlain(texOf(p)), boxW - 16)] as const),
  );
  for (const n of nodes) n.w = n.letter === null ? laneW : boxW;
  const rowH = rows.map((row) =>
    Math.max(
      LAYERED.minH,
      ...row.map((id) => {
        const letter = (nodes[id] as Node).letter;
        return letter === null
          ? 0
          : LAYERED.boxPad +
              (wrapped.get(letter) as { lines: string[] }).lines.length * LAYERED.lineH;
      }),
    ),
  );

  // x: centre each row, then pull towards the neighbours without crossing the order.
  const rowWidth = (row: readonly number[]): number =>
    row.reduce((s, id) => s + (nodes[id] as Node).w, 0) + (row.length - 1) * gapX;
  const widest = Math.max(...rows.map(rowWidth));
  const pack = (): void => {
    for (const row of rows) {
      let x = (widest - rowWidth(row)) / 2;
      for (const id of row) {
        const n = nodes[id] as Node;
        n.cx = x + n.w / 2;
        x += n.w + gapX;
      }
    }
  };
  pack();
  const relax = (level: number): void => {
    const row = rows[level] as number[];
    const desired = row.map((id) => {
      const near = segs
        .filter((s) => s.a === id || s.b === id)
        .map((s) => (nodes[s.a === id ? s.b : s.a] as Node).cx);
      return near.length === 0 ? (nodes[id] as Node).cx : mean(near);
    });
    const off: number[] = [0];
    for (let i = 1; i < row.length; i += 1) {
      const [p, q] = [nodes[row[i - 1] as number] as Node, nodes[row[i] as number] as Node];
      off.push((off[i - 1] as number) + (p.w + q.w) / 2 + gapX);
    }
    const fitted = isotonic(desired.map((d, i) => d - (off[i] as number)));
    row.forEach((id, i) => {
      (nodes[id] as Node).cx = (fitted[i] as number) + (off[i] as number);
    });
  };
  for (let pass = 0; pass < 4; pass += 1) {
    for (let l = 0; l < rows.length; l += 1) relax(l);
    for (let l = rows.length - 1; l >= 0; l -= 1) relax(l);
  }
  const left = (): number => Math.min(...nodes.map((n) => n.cx - n.w / 2));
  const right = (): number => Math.max(...nodes.map((n) => n.cx + n.w / 2));
  if (right() - left() > widest + 0.5) pack(); // the pull widened it: the packed rows always fit
  const shift = pad - left();
  for (const n of nodes) n.cx += shift;

  // y: rows, with a gap between each pair that holds its arrows' elbows.
  const gaps = rows.map((_, l) => {
    const k = segs.filter((s) => (nodes[s.a] as Node).level === l).length;
    return Math.min(52, 24 + 5 * k);
  });
  const feedbackLinks = links.filter(
    (l) => nodeOf.has(l.source) && nodeOf.has(l.target) && l.source !== l.target,
  );
  const levelOfLetter = (letter: string): number =>
    (nodes[nodeOf.get(letter) as number] as Node).level;
  const needTop = feedbackLinks.some((l) => levelOfLetter(l.target) < levelOfLetter(l.source));
  const needBottom = feedbackLinks.some(
    (l) =>
      levelOfLetter(l.source) >= levelOfLetter(l.target) &&
      levelOfLetter(l.source) === rows.length - 1,
  );
  const topPad = pad + (needTop ? 24 : 0);
  const rowY: number[] = [];
  let y = topPad;
  rows.forEach((_, l) => {
    rowY.push(y);
    y += (rowH[l] as number) + (l < rows.length - 1 ? (gaps[l] as number) : 0);
  });
  const bodyBottom = y;
  const bottomGap = needBottom ? 26 : 0;

  // Ports: an arrow leaves its parent's bottom and enters its child's top, spread along the side.
  const segKey = (s: Seg): number => s.a * 100000 + s.b;
  const portOut = new Map<number, number>();
  const portIn = new Map<number, number>();
  for (const n of nodes) {
    const spread = (list: Seg[], other: (s: Seg) => number, into: Map<number, number>): void => {
      list.sort((s, t) => (nodes[other(s)] as Node).cx - (nodes[other(t)] as Node).cx);
      list.forEach((s, i) => {
        into.set(
          segKey(s),
          n.letter === null ? n.cx : n.cx - n.w / 2 + (n.w * (i + 1)) / (list.length + 1),
        );
      });
    };
    spread(
      segs.filter((s) => s.a === n.id),
      (s) => s.b,
      portOut,
    );
    spread(
      segs.filter((s) => s.b === n.id),
      (s) => s.a,
      portIn,
    );
  }
  const geometry = segs.map((s) => {
    let xa = portOut.get(segKey(s)) as number;
    let xb = portIn.get(segKey(s)) as number;
    if (Math.abs(xa - xb) < 10) {
      const [na, nb] = [nodes[s.a] as Node, nodes[s.b] as Node];
      // Line the ends up: on a lane box's x if there is one, else halfway.
      const m = na.letter === null ? xa : nb.letter === null ? xb : (xa + xb) / 2;
      const ok = (n: Node): boolean =>
        n.letter === null || (m >= n.cx - n.w / 2 + 6 && m <= n.cx + n.w / 2 - 6);
      if (ok(na) && ok(nb)) {
        xa = m;
        xb = m;
      }
    }
    return { s, xa, xb };
  });
  // Elbows in a gap sit at staggered heights, ordered so that two do not cross needlessly.
  const elbowY = new Map<Seg, number>();
  rows.forEach((_, l) => {
    const here = geometry.filter((g) => (nodes[g.s.a] as Node).level === l && g.xa !== g.xb);
    const right = here.filter((g) => g.xb > g.xa).sort((p, q) => q.xa - p.xa);
    const leftward = here.filter((g) => g.xb < g.xa).sort((p, q) => p.xa - q.xa);
    const ordered = [...right, ...leftward];
    const top = (rowY[l] as number) + (rowH[l] as number);
    ordered.forEach((g, i) =>
      elbowY.set(g.s, top + ((gaps[l] as number) * (i + 1)) / (ordered.length + 1)),
    );
  });

  const edges: LayeredEdge[] = edgeList.map((e, i) => {
    const mine = geometry.filter((g) => g.s.edge === i);
    const pts: [number, number][] = [];
    mine.forEach((g) => {
      const [a, b] = [nodes[g.s.a] as Node, nodes[g.s.b] as Node];
      const ya = (rowY[a.level] as number) + (rowH[a.level] as number);
      const yb = rowY[b.level] as number;
      pts.push([g.xa, ya]);
      if (g.xa !== g.xb) {
        const ym = elbowY.get(g.s) as number;
        pts.push([g.xa, ym], [g.xb, ym]);
      }
      pts.push([g.xb, yb]);
      // Through a lane box: straight down its whole row.
      if (b.letter === null) pts.push([g.xb, yb + (rowH[b.level] as number)]);
    });
    const last = mine[mine.length - 1] as (typeof geometry)[number];
    const lastTop = rowY[(nodes[last.s.b] as Node).level] as number;
    const ym = elbowY.get(last.s);
    const stub = ym === undefined ? null : lastTop - ym;
    const lx = last.xb + 6;
    const ly =
      ym === undefined || stub === null
        ? lastTop - (gaps[(nodes[last.s.a] as Node).level] as number) / 2
        : stub >= 16
          ? (ym + lastTop) / 2
          : ym - 5;
    return {
      key: `${e.from}>${e.to}`,
      from: e.from,
      to: e.to,
      label: edgeLabel.get(`${e.from}>${e.to}`) ?? null,
      feedback: false,
      points: simplify(pts),
      labelAt: [lx, ly + 5],
      labelRoom: 0,
    };
  });

  // Feedback links: out of a box by the gap, along the right-hand margin, back in by the gap.
  const boxRight = right();
  const linkEdges: LayeredEdge[] = [];
  const seen = new Set<string>();
  let lane = 0;
  for (const link of feedbackLinks) {
    const key = `${link.source}~${link.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [s, t] = [
      nodes[nodeOf.get(link.source) as number] as Node,
      nodes[nodeOf.get(link.target) as number] as Node,
    ];
    const sx = s.cx + s.w / 2 - 9;
    const tx = t.cx + t.w / 2 - 9;
    const sBottom = (rowY[s.level] as number) + (rowH[s.level] as number);
    const tTop = rowY[t.level] as number;
    const tBottom = tTop + (rowH[t.level] as number);
    const mx = boxRight + LAYERED.linkOut + lane * LAYERED.linkGap;
    const jog = 5 * (lane % 3);
    let pts: [number, number][];
    if (t.level < s.level) {
      // Backward: up the margin from the gap above the source to the gap above the target.
      const ya = (rowY[s.level] as number) - ((gaps[s.level - 1] as number) * 0.3 + jog);
      const yb = tTop - (t.level === 0 ? 12 : (gaps[t.level - 1] as number) * 0.3) - jog;
      pts = [
        [sx, rowY[s.level] as number],
        [sx, ya],
        [mx, ya],
        [mx, yb],
        [tx, yb],
        [tx, tTop],
      ];
    } else if (t.level > s.level) {
      const ya = sBottom + (gaps[s.level] as number) * 0.3 + jog;
      const yb = tTop - (gaps[t.level - 1] as number) * 0.3 - jog;
      pts = [
        [sx, sBottom],
        [sx, ya],
        [mx, ya],
        [mx, yb],
        [tx, yb],
        [tx, tTop],
      ];
    } else {
      const ya = sBottom + (gaps[s.level] ?? bottomGap) * 0.5 + jog;
      pts = [
        [sx, sBottom],
        [sx, ya],
        [tx, ya],
        [tx, tBottom],
      ];
    }
    lane += 1;
    linkEdges.push({
      key,
      from: link.source,
      to: link.target,
      label: link.label,
      feedback: true,
      points: simplify(pts),
      labelAt: [0, 0],
      labelRoom: 0,
    });
  }

  const lanesRight =
    linkEdges.length === 0 ? boxRight : boxRight + LAYERED.linkOut + (lane - 1) * LAYERED.linkGap;
  const width = Math.ceil(lanesRight + pad);
  const height = Math.ceil(bodyBottom + bottomGap + pad);
  const sized = [...edges, ...linkEdges].map((e) => ({
    ...e,
    labelRoom: Math.max(0, Math.min(90, width - e.labelAt[0] - 2)),
  }));

  const boxes: LayeredBox[] = placed.map((p) => {
    const n = nodes[nodeOf.get(p.letter) as number] as Node;
    const lines = wrapped.get(p.letter) as { size: number; lines: string[] };
    const tex = texOf(p);
    return {
      letter: p.letter,
      kind: byLetter.get(p.letter)?.kind ?? 'step',
      tex,
      math: tex.includes('$'),
      size: lines.size,
      lines: lines.lines,
      rank: rank.get(p.letter) as number,
      level: n.level,
      x: n.cx - n.w / 2,
      y: rowY[n.level] as number,
      w: n.w,
      h: rowH[n.level] as number,
    };
  });
  return {
    boxes,
    edges: sized,
    width,
    height,
    columns: Math.max(
      ...rows.map((r) => r.filter((id) => (nodes[id] as Node).letter !== null).length),
    ),
  };
}
