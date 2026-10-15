/**
 * reader/guidedFigures — a figure is shown ONCE in Guided.
 *
 * RFIX2 R9. The parser reports a multi-panel figure as the whole crop (`Figure 2`) AND each of its
 * panels as a figure block of their own, all inside the whole one's box, and often all claiming
 * the same caption block. Guided rendered every one of them: the whole crop, then each panel as a
 * separate card, then the caption again under each (DDPM page 2, YOLO page 1 and 2).
 *
 * The reading keeps the OUTERMOST crop and one caption. A figure block whose box lies inside
 * another figure block's box on the same page is a panel of it and is not a card; where the outer
 * block names no caption itself, it takes the first caption its panels name. The dropped blocks
 * stay reachable: `redirect` says which card carries them, for the flash, the marks and "show
 * source". Source is untouched (it paints the PDF); only the projection changes.
 */
import type { IndexedBlock } from '@papertree/anchoring';

/** How much of the smaller box must lie inside the larger for it to be a panel of it. */
export const PANEL_CONTAINMENT = 0.85;

const FIGURE_TYPES: ReadonlySet<string> = new Set(['figure', 'image']);

export interface FigurePlan {
  /** Dropped figure block id -> the outermost figure block whose card shows it. */
  readonly redirect: ReadonlyMap<string, string>;
  /** Kept figure block id -> the caption block its card shows (its own, or one inherited). */
  readonly caption: ReadonlyMap<string, string>;
}

function area(b: IndexedBlock): number {
  return Math.max(0, b.bbox[2] - b.bbox[0]) * Math.max(0, b.bbox[3] - b.bbox[1]);
}

function overlap(a: IndexedBlock, b: IndexedBlock): number {
  const w = Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]);
  const h = Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

function captionOf(block: IndexedBlock): string | undefined {
  const id = block.payload?.['caption_block'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Which figure blocks are panels of another, and which caption each remaining card shows.
 * `rendered` is the reading's blocks in reading order; only figures are looked at.
 */
export function planFigures(rendered: readonly IndexedBlock[]): FigurePlan {
  const figures = rendered.filter((b) => FIGURE_TYPES.has(b.type) && area(b) > 0);
  const parent = new Map<string, string>();

  // `a` contains `b` when most of the smaller box is inside the larger one. Between two boxes of
  // (nearly) the same size the earlier block wins, so exactly one of a duplicated pair survives.
  const contains = (a: IndexedBlock, b: IndexedBlock): boolean => {
    if (a.pageIndex !== b.pageIndex || a.id === b.id) return false;
    const areaA = area(a);
    const areaB = area(b);
    if (overlap(a, b) < PANEL_CONTAINMENT * Math.min(areaA, areaB)) return false;
    if (areaA > areaB * 1.05) return true;
    if (areaB > areaA * 1.05) return false;
    return a.readingIndex < b.readingIndex;
  };

  for (const b of figures) {
    // The smallest box that contains `b`'s is its direct parent; the chain is resolved below.
    let best: IndexedBlock | undefined;
    for (const a of figures) {
      if (!contains(a, b)) continue;
      if (best === undefined || area(a) < area(best)) best = a;
    }
    if (best !== undefined) parent.set(b.id, best.id);
  }

  const outermost = (id: string): string => {
    const seen = new Set<string>([id]);
    let cursor = id;
    for (;;) {
      const up = parent.get(cursor);
      if (up === undefined || seen.has(up)) return cursor;
      seen.add(up);
      cursor = up;
    }
  };

  const redirect = new Map<string, string>();
  for (const id of parent.keys()) redirect.set(id, outermost(id));

  const caption = new Map<string, string>();
  const claimed = new Set<string>();
  for (const b of figures) {
    if (redirect.has(b.id)) continue;
    let id = captionOf(b);
    if (id === undefined) {
      // A panel names it; the whole crop does not.
      for (const p of figures) {
        if (redirect.get(p.id) !== b.id) continue;
        id = captionOf(p);
        if (id !== undefined) break;
      }
    }
    // One caption, one card: a second figure claiming the same caption shows none.
    if (id !== undefined && !claimed.has(id)) {
      claimed.add(id);
      caption.set(b.id, id);
    }
  }
  return { redirect, caption };
}
