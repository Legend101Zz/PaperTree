/**
 * library/model/map — the Map view's plan as pure functions (#198, frame 01e, DESIGN.md §1: "only
 * real links"). Each topic is an island in a fixed cell of a grid (the topics' own order, then
 * Unshelved last), sized by its papers; its papers stand inside it as tokens in rows. A cell never
 * depends on another island, so a paper keeps its place when papers arrive in other topics, and no
 * two islands can overlap. Links are drawn only from what `GET /library/links` returned. No physics.
 */
import { isReadingNow, spineState, spineTitle, type ShelfPaper } from './shelf';
import { topicShelves, topicStats } from './topics';

import type { Topic } from '@/lib/api/topics';
import type { LibraryLink } from '@/lib/api/types';

/** One island's input: a topic (or Unshelved) and its papers in shelving order. */
export interface MapGroup<P extends ShelfPaper = ShelfPaper> {
  readonly key: string;
  readonly label: string;
  /** `unshelved` is drawn dashed: it is not a topic anyone accepted. */
  readonly kind: 'topic' | 'unshelved';
  /** The cartouche's second line ("2 papers · 31 pages · arXiv cs.CL"). */
  readonly meta: string;
  readonly papers: readonly P[];
}

/** A paper on the plan: its token's left edge and middle, the short title that fits, its state. */
export interface MapToken {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  /** "being read" (a kraft spine) or "could not read" (red), drawn after the label. */
  readonly note: 'being read' | 'could not read' | null;
}

/** An island, placed. */
export interface MapIsland<P extends ShelfPaper = ShelfPaper> {
  readonly group: MapGroup<P>;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly tokens: readonly MapToken[];
  /** Papers past the island's room, shown as one "+n more" token at `more`. */
  readonly hidden: number;
  readonly more: { readonly x: number; readonly y: number } | null;
  /** The cartouche over the circle: its top-left corner and width (it is 44 px tall). */
  readonly cart: { readonly x: number; readonly y: number; readonly w: number };
}

/** A point on the plan. */
export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

/** The whole plan. `at` holds each paper's two link points: its spine, and its label's end. */
export interface MapLayout<P extends ShelfPaper = ShelfPaper> {
  readonly width: number;
  readonly height: number;
  readonly islands: readonly MapIsland<P>[];
  readonly at: ReadonlyMap<string, { readonly left: MapPoint; readonly right: MapPoint }>;
}

/** A link as drawn: the API's link, its curve, its label and where the label sits. */
export interface MapLink {
  readonly link: LibraryLink;
  readonly d: string;
  readonly label: string;
  /** The label's paper tag: its centre and width, kept inside the plan. It sits on the curve, or
   * just left of an upright link's curve (on the curve it would cover the papers it joins). */
  readonly tag: MapPoint;
  readonly tagWidth: number;
}

const PAD = 24;
const MIN_CELL = 380;
const CART_H = 56;
const ROW = 32;
const INSET = 18;
const GAP = 16;
const R_MIN = 64;
/** Caslon at 14 px is about 7.2 px a character (an estimate: no text is measured); the spine
 * glyph and its gap take 20. */
export const MAP_CHAR = 7.2;
const CHAR = MAP_CHAR;
const GLYPH = 20;
const LABEL_MAX = 26;

// A label cut to `chars` with an ellipsis; never shorter than four characters.
function clip(text: string, chars: number): string {
  const room = Math.max(4, chars);
  return text.length <= room ? text : `${text.slice(0, room - 1).trimEnd()}…`;
}

const tokenWidth = (label: string): number => GLYPH + CHAR * label.length;

// The state a token says in words, with its " · " (its spine says it in colour too).
function noteOf(paper: ShelfPaper): MapToken['note'] {
  const state = spineState(paper);
  if (state === 'failed') return 'could not read';
  return state === 'queued' || state === 'parsing' ? 'being read' : null;
}
const noted = (label: string, note: MapToken['note']): string =>
  note === null ? label : `${label} · ${note}`;

// The island's columns, rows and radius: as small as its papers allow, at most `rMax`.
function islandSize(labels: readonly string[], rMax: number): { cols: number; r: number } {
  const n = labels.length;
  const cols = n > 5 ? 2 : 1;
  const widest = Math.max(0, ...labels.map(tokenWidth));
  const half = cols === 1 ? widest / 2 + INSET : widest + GAP / 2 + INSET;
  const edge = (Math.ceil(n / cols) * ROW) / 2 + INSET / 2;
  return { cols, r: Math.min(rMax, Math.max(R_MIN, Math.hypot(half, edge))) };
}

// Lays out one island's tokens in rows inside its circle; labels cut to the chord they stand on.
function placeTokens<P extends ShelfPaper>(
  papers: readonly P[],
  cx: number,
  cy: number,
  r: number,
  cols: number,
): Pick<MapIsland<P>, 'tokens' | 'hidden' | 'more'> {
  const capacity = Math.max(1, Math.floor((2 * r - 2 * INSET) / ROW)) * cols;
  const shown = papers.length > capacity ? capacity - 1 : papers.length;
  const rows = Math.ceil((shown + (papers.length > shown ? 1 : 0)) / cols);
  const top = cy - (rows * ROW) / 2;
  const slot = (index: number) => {
    const row = Math.floor(index / cols);
    const y = top + row * ROW + ROW / 2;
    // The chord at the row's edge farther from the centre bounds the row.
    const far = Math.max(Math.abs(y - ROW / 2 - cy), Math.abs(y + ROW / 2 - cy));
    const halfChord = Math.sqrt(Math.max(0, r * r - far * far)) - INSET / 2;
    const colWidth = (2 * halfChord - GAP * (cols - 1)) / cols;
    const colLeft = cx - halfChord + (index % cols) * (colWidth + GAP);
    return { y, colLeft, colWidth };
  };
  const tokens = papers.slice(0, shown).map((paper, index) => {
    const { y, colLeft, colWidth } = slot(index);
    const note = noteOf(paper);
    const room = Math.floor((colWidth - GLYPH) / CHAR) - (note === null ? 0 : note.length + 3);
    const label = clip(spineTitle(paper.title), Math.min(LABEL_MAX, room));
    const width = tokenWidth(noted(label, note));
    return { id: paper.id, x: colLeft + Math.max(0, (colWidth - width) / 2), y, label, note };
  });
  const hidden = papers.length - shown;
  const last = hidden > 0 ? slot(shown) : null;
  return {
    tokens,
    hidden,
    more: last === null ? null : { x: last.colLeft + 4, y: last.y },
  };
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}
const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
const overlaps = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const byShelving = (a: ShelfPaper, b: ShelfPaper): number =>
  a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id);

/**
 * The islands to draw: every topic in its own order (an empty one too, so a topic's first paper
 * never moves another island), then Unshelved when any paper has no accepted topic.
 *
 * @param topics - `GET /topics`.
 * @param papers - Every paper.
 * @returns The groups, each with its cartouche line ("2 papers · 31 pages · arXiv cs.CL").
 */
export function mapGroups<P extends ShelfPaper>(
  topics: readonly Topic[],
  papers: readonly P[],
): MapGroup<P>[] {
  const meta = (held: readonly P[]): string => {
    // The counts without the state part (a stats line ends in it); the tokens show each state.
    const counts =
      held.length === 0
        ? ['No papers yet']
        : topicStats(held)
            .slice(0, -1)
            .map((part) => `${String(part.value)} ${part.noun}`);
    const categories = [
      ...new Set(held.flatMap((p) => (p.arxivCategory ? [p.arxivCategory] : []))),
    ].sort();
    return [...counts, ...(categories.length > 0 ? [`arXiv ${categories.join(', ')}`] : [])].join(
      ' · ',
    );
  };
  // A paper's accepted topic that `topics` lacks (its read failed, or is a step behind a write)
  // still gets an island, after the listed ones, so no paper ever drops off the plan.
  const listed = new Set(topics.map((t) => t.topic_id));
  const strays = new Map<string, Topic>();
  for (const { topic: t } of papers) {
    if (t && !listed.has(t.id) && !strays.has(t.id)) {
      strays.set(t.id, {
        topic_id: t.id,
        name: t.name,
        cloth: t.cloth,
        sort_order: 0,
        paper_count: 0,
        page_count: 0,
        categories: [],
      });
    }
  }
  const shelves = topicShelves([...topics, ...strays.values()], papers);
  const groups: MapGroup<P>[] = shelves.map(({ topic, papers: held }) => ({
    key: topic.topic_id,
    label: topic.name,
    kind: 'topic',
    meta: meta(held),
    papers: held,
  }));
  const unshelved = papers.filter((p) => !p.topic).sort(byShelving);
  if (unshelved.length === 0) return groups;
  return [
    ...groups,
    {
      key: 'unshelved',
      label: 'Unshelved',
      kind: 'unshelved',
      meta: `${meta(unshelved)} · no topic yet`,
      papers: unshelved,
    },
  ];
}

/**
 * The plan: every group in a fixed cell (up to three to a row, as the width allows), its circle
 * centred there. Pure and deterministic: the same groups and width give the same plan.
 *
 * @param groups - The topics in their own order, Unshelved last.
 * @param width - The plan's width in CSS px.
 * @returns The islands, the plan's size and each paper's link point.
 * @example
 * const plan = layoutMap(mapGroups(topics, books), 1216);
 */
export function layoutMap<P extends ShelfPaper>(
  groups: readonly MapGroup<P>[],
  width: number,
): MapLayout<P> {
  const columns = Math.min(3, Math.max(1, Math.floor((width - 2 * PAD) / MIN_CELL)));
  const cellW = (width - 2 * PAD) / columns;
  const rMax = Math.min(cellW, 400) / 2 - 12;
  const cellH = CART_H + 2 * rMax + 24;
  const at = new Map<string, { left: MapPoint; right: MapPoint }>();
  const islands = groups.map((group, index) => {
    const labels = group.papers.map((p) => noted(clip(spineTitle(p.title), LABEL_MAX), noteOf(p)));
    const { cols, r } = islandSize(labels, rMax);
    // Each island hangs from the top of its own cell, under its cartouche: its place depends on
    // its index and its own papers only.
    const cx = PAD + (index % columns) * cellW + cellW / 2;
    const cy = PAD + Math.floor(index / columns) * cellH + CART_H + r;
    const placed = placeTokens(group.papers, cx, cy, r, cols);
    placed.tokens.forEach((token, i) => {
      const paper = group.papers[i];
      const ribbon = paper !== undefined && isReadingNow(paper) ? 16 : 0;
      const end = token.x + tokenWidth(noted(token.label, token.note)) + ribbon;
      at.set(token.id, { left: { x: token.x + 4, y: token.y }, right: { x: end, y: token.y } });
    });
    const rest = placed.more ?? { x: cx, y: cy };
    for (const paper of group.papers.slice(placed.tokens.length)) {
      at.set(paper.id, { left: rest, right: rest });
    }
    // The cartouche's width from its two lines (Caslon bold 14.5 px, Alegreya 13 px: estimates).
    const w = Math.max(group.label.length * 8.4, group.meta.length * 6.4) + 28;
    return { group, cx, cy, r, ...placed, cart: { x: cx - w / 2, y: cy - r - 54, w } };
  });
  const bottom = Math.max(0, ...islands.map((island) => island.cy + island.r));
  return { width, height: bottom + PAD, islands, at };
}

/**
 * How a link is labelled, worded from the field that matched (never assumed).
 *
 * @param link - A link from `GET /library/links`.
 * @returns "cites it · matched by title" or "cites it · matched by arXiv id".
 */
export function linkLabel(link: Pick<LibraryLink, 'matched_by'>): string {
  return `cites it · matched by ${link.matched_by === 'arxiv_id' ? 'arXiv id' : 'title'}`;
}

/**
 * The links to draw: exactly the API's links whose two papers are on the plan, each a gentle
 * curve from the citing paper to the cited one, leaving and reaching each paper on the side that
 * faces the other (a paper's label end, or its spine). A mostly level link arcs over the papers
 * between; a mostly upright one (two papers in one column) arcs out to the left of the spines.
 * Nothing else is ever drawn.
 *
 * @param layout - The plan.
 * @param links - `GET /library/links`.
 * @returns One drawn link per API link with both ends on the plan.
 */
export function mapLinks(layout: MapLayout, links: readonly LibraryLink[]): MapLink[] {
  // What a tag must not cover: every paper, every cartouche, and the tags placed before it.
  const taken: Box[] = [
    ...[...layout.at.values()].map(({ left, right }) =>
      box(left.x - 6, left.y - 14, right.x + 4, left.y + 14),
    ),
    ...layout.islands.map(({ cart }) => box(cart.x, cart.y, cart.x + cart.w, cart.y + 44)),
  ];
  return links.flatMap((link) => {
    const from = layout.at.get(link.from_paper_id);
    const to = layout.at.get(link.to_paper_id);
    if (from === undefined || to === undefined || link.from_paper_id === link.to_paper_id)
      return [];
    const rightward = to.left.x > from.right.x;
    const leftward = from.left.x > to.right.x;
    const a = rightward ? from.right : from.left;
    const b = rightward ? to.left : leftward ? to.right : to.left;
    // Two papers one above the other (neither clear of the other) arc out left of both spines.
    const upright = !rightward && !leftward;
    const bow = Math.min(160, Math.max(upright ? 56 : 28, Math.hypot(b.x - a.x, b.y - a.y) * 0.3));
    const c = upright
      ? { x: Math.max(8, Math.min(a.x, b.x) - bow), y: (a.y + b.y) / 2 }
      : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - bow };
    // The curve's midpoint (t = 0.5) is halfway between the chord's midpoint and the control.
    const mid = { x: (a.x + b.x) / 4 + c.x / 2, y: (a.y + b.y) / 4 + c.y / 2 };
    const label = linkLabel(link);
    const tagWidth = Math.max(...label.split(' · ').map((line) => line.length)) * 6.4 + 14;
    const want = upright ? mid.x - tagWidth / 2 - 6 : mid.x;
    const tagX = Math.min(layout.width - 4 - tagWidth / 2, Math.max(4 + tagWidth / 2, want));
    // Slide the tag up or down its lane, a row at a time, to the first place that covers nothing.
    const at = (dy: number): Box =>
      box(tagX - tagWidth / 2, mid.y + dy - 17, tagX + tagWidth / 2, mid.y + dy + 17);
    const dy =
      [0, -36, 36, -72, 72, -108, 108].find((d) => !taken.some((t) => overlaps(t, at(d)))) ?? 0;
    taken.push(at(dy));
    const round = (n: number): string => n.toFixed(1);
    return [
      {
        link,
        d: `M${round(a.x)} ${round(a.y)} Q${round(c.x)} ${round(c.y)} ${round(b.x)} ${round(b.y)}`,
        label,
        tag: { x: tagX, y: mid.y + dy },
        tagWidth,
      },
    ];
  });
}
