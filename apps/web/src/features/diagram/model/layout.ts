/**
 * The plate's slot grid (DESIGN.md §1 "Diagrams", ADR-004 §2.9): where each lettered part, arrow and
 * feedback link of a diagram is drawn. Pure and deterministic. A part's slot is a function of its
 * LETTER alone (row A, B, … L), so a slot never moves once placed and the plate only grows
 * downward as parts stream in; a letter the API dropped leaves its row empty, never renumbered.
 */
import type { DiagramLink, DiagramPart } from '@/lib/api/types';

/** The letters a plate may use, in order (the contract's `^[A-L]$`). */
export const LETTERS = 'ABCDEFGHIJKL';

/** The grid in SVG user units: one column of boxes, letter circles on the left, lanes on the right. */
export const GRID = {
  width: 300,
  top: 16,
  row: 72,
  bottom: 18,
  boxX: 56,
  boxW: 150,
  boxH: 44,
  /** An output box is this much wider on each side, and 6 taller (the frame's double-ruled F). */
  outGrow: 8,
  circleX: 22,
  /**
   * The first lane, right of the boxes. Arrows that skip rows take the even lanes, feedback links
   * the odd ones, so neither bank ever moves the other; the drawing widens past `width` rather
   * than let two arrows share a lane.
   */
  laneX: 222,
  laneGap: 10,
} as const;

/** What the layout needs of a part. */
export type LayoutPart = Pick<DiagramPart, 'letter' | 'kind' | 'after' | 'edge'>;

/** One cell of the grid: a placed part, an empty row (a dropped letter) or the part still arriving. */
export interface Slot {
  readonly letter: string;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly kind: DiagramPart['kind'] | 'gap' | 'ghost';
}

/** A drawn arrow: an `after` edge (down the column or along a lane) or a feedback `link`. */
export interface Route {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
  readonly feedback: boolean;
  /** The polyline, in drawing order; the arrowhead sits on the last point. */
  readonly points: readonly (readonly [number, number])[];
  /** Where the label goes (its left end, vertically centred; its right end for a link). */
  readonly labelAt: readonly [number, number];
  /** How wide the label may run there before it meets a lane or the plate's edge. */
  readonly labelRoom: number;
}

/** Everything the drawing needs. */
export interface PlateLayout {
  readonly slots: readonly Slot[];
  readonly gaps: readonly Slot[];
  readonly ghost: Slot | null;
  readonly routes: readonly Route[];
  readonly width: number;
  readonly height: number;
}

/**
 * A letter's row, or -1 for a letter outside A–L.
 *
 * @param letter The part's letter.
 * @returns Its zero-based row.
 */
export function rowOf(letter: string): number {
  return letter.length === 1 ? LETTERS.indexOf(letter) : -1;
}

/**
 * The slot of a letter: fixed by the letter and the kind, so streaming never moves it.
 *
 * @param letter The part's letter.
 * @param kind The part's kind (an output box is larger), or `gap` / `ghost`.
 * @returns The slot.
 */
export function slotOf(letter: string, kind: Slot['kind']): Slot {
  const row = rowOf(letter);
  const y = GRID.top + row * GRID.row;
  const grow = kind === 'output' ? GRID.outGrow : 0;
  return {
    letter,
    row,
    x: GRID.boxX - grow,
    y: y - (grow === 0 ? 0 : 3),
    w: GRID.boxW + 2 * grow,
    h: GRID.boxH + (grow === 0 ? 0 : 6),
    kind,
  };
}

const cy = (s: Slot): number => s.y + s.h / 2;

/**
 * First-fit lane for a row span among a bank's lanes (`first`, `first + 2`, …). A lane holds spans
 * that do not touch, and a bank never runs out (#217 review S4: two arrows on one lane read as one
 * arrow with two ends), so the drawing widens instead.
 *
 * @param bank The spans each lane holds so far (mutated: the span is added to its lane).
 * @param lo The span's first row.
 * @param hi The span's last row.
 * @param first The bank's first lane: 0 for arrows, 1 for feedback links.
 * @returns The lane's index.
 */
function takeLane(bank: Map<number, [number, number][]>, lo: number, hi: number, first: number) {
  for (let lane = first; ; lane += 2) {
    const spans = bank.get(lane) ?? [];
    if (spans.every(([a, b]) => hi < a || b < lo)) {
      bank.set(lane, [...spans, [lo, hi]]);
      return lane;
    }
  }
}

/**
 * The `after` arrows of the placed parts, in row order (so a new part never reroutes an old one).
 *
 * @param placed The placed parts, in row order.
 * @param slots Each placed letter's slot.
 * @returns The arrows.
 */
function afterRoutes(placed: readonly LayoutPart[], slots: ReadonlyMap<string, Slot>): Route[] {
  const bank = new Map<number, [number, number][]>();
  const routes: Route[] = [];
  for (const part of placed) {
    const to = slots.get(part.letter);
    if (to === undefined) continue;
    const seen = new Set<string>();
    part.after.forEach((letter, i) => {
      const from = slots.get(letter);
      // Arrows only from EARLIER placed letters: the plate is acyclic by construction.
      if (from === undefined || from.row >= to.row || seen.has(letter)) return;
      seen.add(letter);
      const label = part.edge[i] ?? null;
      const key = `${letter}>${part.letter}`;
      const between = [...slots.values()].some((s) => s.row > from.row && s.row < to.row);
      if (!between) {
        const x = GRID.boxX + GRID.boxW / 2;
        const y0 = from.y + from.h;
        routes.push({
          key,
          from: letter,
          to: part.letter,
          label,
          feedback: false,
          points: [
            [x, y0],
            [x, to.y],
          ],
          labelAt: [x + 8, (y0 + to.y) / 2],
          labelRoom: GRID.laneX - (x + 8) - 4,
        });
        return;
      }
      const x = GRID.laneX + takeLane(bank, from.row, to.row, 0) * GRID.laneGap;
      const [y0, y1] = [cy(from), cy(to)];
      routes.push({
        key,
        from: letter,
        to: part.letter,
        label,
        feedback: false,
        points: [
          [from.x + from.w, y0],
          [x, y0],
          [x, y1],
          [to.x + to.w, y1],
        ],
        labelAt: [x + 5, (y0 + y1) / 2],
        labelRoom: 0, // set once every lane is known (`withLabelRooms`)
      });
    });
  }
  return routes;
}

/**
 * Feedback links, on the odd lanes, so they never move an arrow and an arrow never moves them.
 *
 * @param links The links, in arrival order.
 * @param slots Each placed letter's slot.
 * @returns The link routes.
 */
function linkRoutes(links: readonly DiagramLink[], slots: ReadonlyMap<string, Slot>): Route[] {
  const bank = new Map<number, [number, number][]>();
  const routes: Route[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const [from, to] = [slots.get(link.source), slots.get(link.target)];
    const key = `${link.source}~${link.target}`;
    if (from === undefined || to === undefined || from === to || seen.has(key)) continue;
    seen.add(key);
    const lane = takeLane(bank, Math.min(from.row, to.row), Math.max(from.row, to.row), 1);
    const x = GRID.laneX + lane * GRID.laneGap;
    // 8 below the centre line, so a link never shares a segment with an `after` lane arrow.
    const [y0, y1] = [cy(from) + 8, cy(to) + 8];
    routes.push({
      key,
      from: link.source,
      to: link.target,
      label: link.label,
      feedback: true,
      points: [
        [from.x + from.w, y0],
        [x, y0],
        [x, y1],
        [to.x + to.w, y1],
      ],
      labelAt: [x + 5, (y0 + y1) / 2],
      labelRoom: 0, // set once every lane is known (`withLabelRooms`)
    });
  }
  return routes;
}

/**
 * How far each lane label may run to its right before it meets another lane at its height, or the
 * drawing's edge: a label cut to that never crosses a line (the key says it in full).
 *
 * @param routes The routes, lane ones with their label room unset.
 * @param width The drawing's width.
 * @returns The routes with every lane label's room.
 */
function withLabelRooms(routes: readonly Route[], width: number): Route[] {
  const lanes = routes.filter((r) => r.points.length === 4);
  return routes.map((route) => {
    if (route.points.length !== 4) return route;
    const [x, y] = route.labelAt;
    const blocking = lanes.flatMap((other) => {
      const ox = other.points[1]?.[0] ?? 0;
      const [y0, y1] = [other.points[1]?.[1] ?? 0, other.points[2]?.[1] ?? 0];
      return ox > x && Math.min(y0, y1) <= y && y <= Math.max(y0, y1) ? [ox] : [];
    });
    return { ...route, labelRoom: Math.min(width, ...blocking) - x - 2 };
  });
}

/**
 * Lay out a plate: one row per letter, arrows down the column when nothing stands between their
 * ends, else along a lane to the right; feedback links on lanes of their own.
 *
 * @param parts The parts placed so far, in arrival order (letters rise; a repeat is ignored).
 * @param links The feedback links so far.
 * @param arriving True while the run is drawing: the next row shows the part still arriving.
 * @returns Slots, empty rows, the arriving slot, routes and the drawing's size.
 * @example
 * layoutPlate([{ letter: 'A', kind: 'input', after: [], edge: [] }], [], false).height; // 78
 */
export function layoutPlate(
  parts: readonly LayoutPart[],
  links: readonly DiagramLink[],
  arriving: boolean,
): PlateLayout {
  const placed: LayoutPart[] = [];
  const slots = new Map<string, Slot>();
  for (const part of parts) {
    if (rowOf(part.letter) < 0 || slots.has(part.letter)) continue;
    placed.push(part);
    slots.set(part.letter, slotOf(part.letter, part.kind));
  }
  placed.sort((a, b) => rowOf(a.letter) - rowOf(b.letter));
  const last = Math.max(-1, ...placed.map((p) => rowOf(p.letter)));
  const gaps = [...LETTERS.slice(0, last + 1)]
    .filter((letter) => !slots.has(letter))
    .map((letter) => slotOf(letter, 'gap'));
  const next = LETTERS[last + 1];
  const ghost = arriving && next !== undefined ? slotOf(next, 'ghost') : null;
  const rows = Math.max(1, last + 1 + (ghost === null ? 0 : 1));
  const outputLast = placed.some((p) => p.kind === 'output' && rowOf(p.letter) === rows - 1);
  const routes = [...afterRoutes(placed, slots), ...linkRoutes(links, slots)];
  // Wider only when the lanes need it; every x already drawn stays where it is.
  const widest = Math.max(GRID.width, ...routes.map((r) => (r.points[1]?.[0] ?? 0) + 8));
  return {
    slots: placed.map((p) => slots.get(p.letter) as Slot),
    gaps,
    ghost,
    routes: withLabelRooms(routes, widest),
    width: widest,
    height: GRID.top + (rows - 1) * GRID.row + GRID.boxH + GRID.bottom + (outputLast ? 3 : 0),
  };
}
