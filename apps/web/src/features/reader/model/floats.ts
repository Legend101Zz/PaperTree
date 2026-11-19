/**
 * reader/floats — the floats of a page (figure, table, algorithm, display equation) that one click
 * selects whole, caption included (v0.3 #348, item 1). Pure, built from the IR's blocks.
 *
 * The parser reports a multi-panel figure as the whole crop AND each panel inside it, and does not
 * always attach the caption; so the rules are: the outermost figure box wins (the same containment
 * rule as `figureRegions` and Guided), the caption is the one the parser named (`caption_block`, or
 * a `caption_of` relation), else the nearest caption block just above or below, and the float's
 * selectable box is the float and its caption together. A float the parser missed is not here; the
 * area tool is the fallback that always works (#103).
 */
import { longLabel } from '@/lib/imageAnchor';

import type { IndexedBlock, IndexedDocument } from '@papertree/anchoring';
import type { BBox } from '@papertree/document-ir';

/** What a float is, for its label and its outline. */
export type FloatKind = 'figure' | 'table' | 'algorithm' | 'equation';

/** One selectable float on a page. */
export interface PageFloat {
  /** The float's own block id (not its caption's). */
  readonly id: string;
  readonly kind: FloatKind;
  readonly page: number;
  /** The float and its caption, in PDF points (IR space). This is what is selected and cropped. */
  readonly box: BBox;
  /** The float's block, for the anchor's BlockSelector. */
  readonly block: IndexedBlock;
  /** The caption block's text, or null. */
  readonly caption: string | null;
  /** "Figure 4", or what stands in for a name when the parser read no number. */
  readonly label: string;
}

const FIGURE_LIKE: ReadonlySet<string> = new Set(['figure', 'image', 'diagram', 'plot']);
const FLOAT_TYPES: ReadonlySet<string> = new Set([
  ...FIGURE_LIKE,
  'table',
  'algorithm',
  'equation',
]);

/** How much of the smaller box must lie inside the larger for it to be a panel of it. */
const PANEL_CONTAINMENT = 0.85;
/** A caption this far (points) above or below a float, with no parser link, still belongs to it. */
const CAPTION_REACH = 48;
/** A box this small (points a side) is a speck, not a float. */
const MIN_SIDE = 8;

const KIND_NAMES: Readonly<Record<FloatKind, string>> = {
  figure: 'Figure',
  table: 'Table',
  algorithm: 'Algorithm',
  equation: 'Equation',
};

function kindOf(type: string): FloatKind {
  if (type === 'table' || type === 'algorithm' || type === 'equation') return type;
  return 'figure';
}

function area(b: BBox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function overlap(a: BBox, b: BBox): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

function union(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

// The caption block the parser linked to a float: its payload, else a `caption_of` relation.
function linkedCaption(doc: IndexedDocument, block: IndexedBlock): IndexedBlock | undefined {
  const named = block.payload?.['caption_block'];
  if (typeof named === 'string') {
    const found = doc.byId.get(named);
    if (found !== undefined) return found;
  }
  for (const relation of doc.relations) {
    if (relation.type !== 'caption_of') continue;
    const to = relation.to ?? relation.to_block_id;
    const from = relation.from ?? relation.from_block_id;
    if (to === block.id && from !== undefined) return doc.byId.get(from);
  }
  return undefined;
}

// The nearest caption block within reach above or below the float, sharing some of its width.
function nearbyCaption(
  blocks: readonly IndexedBlock[],
  float: IndexedBlock,
  taken: ReadonlySet<string>,
): IndexedBlock | undefined {
  let best: { block: IndexedBlock; gap: number } | undefined;
  for (const c of blocks) {
    if (c.type !== 'caption' || taken.has(c.id)) continue;
    const across = Math.min(c.bbox[2], float.bbox[2]) - Math.max(c.bbox[0], float.bbox[0]);
    if (across <= 0) continue;
    const gap = Math.max(c.bbox[1] - float.bbox[3], float.bbox[1] - c.bbox[3]);
    if (gap > CAPTION_REACH) continue;
    if (best === undefined || gap < best.gap) best = { block: c, gap };
  }
  return best?.block;
}

// The label a float is called by: its printed number, else its caption's first words, else its kind.
function labelOf(kind: FloatKind, block: IndexedBlock, caption: string | null): string {
  const number = block.payload?.['figure_number'];
  if (kind === 'figure' && typeof number === 'string' && number !== '') return `Figure ${number}`;
  const named = longLabel(caption);
  if (named !== null) return named;
  return KIND_NAMES[kind];
}

// A figure-like block inside a larger one on the same page is a panel of it, not a float.
function isPanel(block: IndexedBlock, others: readonly IndexedBlock[]): boolean {
  return others.some((other) => {
    if (other.id === block.id || !FIGURE_LIKE.has(other.type)) return false;
    const [a, b] = [area(block.bbox), area(other.bbox)];
    if (overlap(block.bbox, other.bbox) < PANEL_CONTAINMENT * Math.min(a, b)) return false;
    return b > a * 1.05 || (b >= a / 1.05 && other.readingIndex < block.readingIndex);
  });
}

const cache = new WeakMap<IndexedDocument, Map<number, readonly PageFloat[]>>();

/**
 * The floats of one page, in reading order (the Tab order), each with its caption folded in.
 *
 * @param doc The indexed parse.
 * @param pageIndex 0-based page.
 * @returns The page's floats; empty for a page with none. Kept per document and page.
 */
export function floatsOnPage(doc: IndexedDocument, pageIndex: number): readonly PageFloat[] {
  let pages = cache.get(doc);
  if (pages === undefined) {
    pages = new Map();
    cache.set(doc, pages);
  }
  const kept = pages.get(pageIndex);
  if (kept !== undefined) return kept;
  const blocks = doc.byPage.get(pageIndex) ?? [];
  const taken = new Set<string>();
  const floats: PageFloat[] = [];
  for (const block of blocks) {
    if (!FLOAT_TYPES.has(block.type)) continue;
    if (block.bbox[2] - block.bbox[0] < MIN_SIDE || block.bbox[3] - block.bbox[1] < MIN_SIDE) {
      continue;
    }
    // A float nested in another (a table's cell, a panel of a figure) is selected through its parent.
    const parent = block.parentId === null ? undefined : doc.byId.get(block.parentId);
    if (parent !== undefined && FLOAT_TYPES.has(parent.type)) continue;
    if (FIGURE_LIKE.has(block.type) && isPanel(block, blocks)) continue;
    const kind = kindOf(block.type);
    const caption =
      kind === 'equation'
        ? undefined
        : (linkedCaption(doc, block) ?? nearbyCaption(blocks, block, taken));
    if (caption !== undefined) taken.add(caption.id);
    const text = caption === undefined ? null : caption.text.replace(/\s+/g, ' ').trim() || null;
    floats.push({
      id: block.id,
      kind,
      page: pageIndex,
      box: caption === undefined ? block.bbox : union(block.bbox, caption.bbox),
      block,
      caption: text,
      label: labelOf(kind, block, text),
    });
  }
  floats.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  pages.set(pageIndex, floats);
  return floats;
}

/**
 * The float under a point, the smallest when floats overlap.
 *
 * @param floats One page's floats.
 * @param x The point's x in PDF points.
 * @param y The point's y in PDF points (origin top-left).
 * @returns The float, or null.
 */
export function floatAt(floats: readonly PageFloat[], x: number, y: number): PageFloat | null {
  let best: PageFloat | null = null;
  for (const f of floats) {
    if (x < f.box[0] || x > f.box[2] || y < f.box[1] || y > f.box[3]) continue;
    if (best === null || area(f.box) < area(best.box)) best = f;
  }
  return best;
}
