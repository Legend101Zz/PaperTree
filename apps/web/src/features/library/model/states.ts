/**
 * library/model/states — which shelf the library shows, and who is "reading now" (#196, DESIGN.md
 * §1 and §9). Pure: the strip, the face-out covers, the sideways rows at scale, the stats line and
 * Continue's reader place are decided here so they can be tested without a DOM. Thresholds are the
 * design's "about 12" and "about 40" (owner may change).
 */
import {
  arrangeShelf,
  isReadingNow,
  type Arrangement,
  type LibraryStats,
  type ShelfPaper,
} from './shelf';

import type { ReadingMode } from '@/lib/api/types';

/** At or below this many papers the books stand face-out as covers (frame 01c). */
export const FACE_OUT_MAX = 12;

/** Past this many papers each group gets its own plank that scrolls sideways (frame 01f). */
export const AT_SCALE_MIN = 40;

/** The Reading now strip shows at most this many papers on a desktop (frame 01). */
export const READING_NOW_MAX = 3;

/** How the shelf draws its books: covers face-out, spines on one plank (01), a plank per row (01f). */
export type ShelfLayout = 'face-out' | 'spines' | 'rows';

/**
 * The shelf's layout for a number of papers on it.
 *
 * @param count - Papers on the shelf (after the "need a look" filter, never after a search, which
 *   dims in place and must not re-lay the shelf out while you type).
 * @returns The layout.
 */
export function shelfLayout(count: number): ShelfLayout {
  if (count <= FACE_OUT_MAX) return 'face-out';
  return count > AT_SCALE_MIN ? 'rows' : 'spines';
}

/**
 * "24 papers · 6 topics · 3 reading now · 484 pages", leaving out what is zero; at scale the pages
 * go (frame 01f: a sum of thousands of pages says nothing about a library that size).
 *
 * @param stats - The counts.
 * @param atScale - The shelf is laid out in rows (`shelfLayout` is `'rows'`).
 * @returns The parts, each a count and its noun.
 */
export function statsLine(stats: LibraryStats, atScale: boolean): readonly [number, string][] {
  const parts: [number, string][] = [[stats.papers, stats.papers === 1 ? 'paper' : 'papers']];
  if (stats.topics > 0) parts.push([stats.topics, stats.topics === 1 ? 'topic' : 'topics']);
  if (stats.readingNow > 0) parts.push([stats.readingNow, 'reading now']);
  if (stats.pages > 0 && !atScale) parts.push([stats.pages, stats.pages === 1 ? 'page' : 'pages']);
  return parts;
}

/** What a sideways row shows from where it is scrolled. */
export interface RowWindow {
  /** Spines wholly in view. */
  readonly shown: number;
  /** Spines past the right edge: the "+n more" on the bookend; always the row's last `after`. */
  readonly after: number;
}

/**
 * How much of a sideways row is in view (frame 01f's "28 of 36 shown" and "+8 more").
 *
 * @param widths - Each spine's width in px, in row order (`spineWidth`).
 * @param gap - The gap between spines.
 * @param scrollLeft - How far the row is scrolled.
 * @param room - The row's visible width (0 before it is measured: nothing is in view).
 * @param reserve - What the "+n more" bookend covers at the right edge while the row overflows.
 * @returns The spines in view and those past the right edge (or under the bookend).
 */
export function rowWindow(
  widths: readonly number[],
  gap: number,
  scrollLeft: number,
  room: number,
  reserve = 0,
): RowWindow {
  const total = widths.reduce((sum, width) => sum + width + gap, -gap);
  const overflows = scrollLeft + room < total - 0.5;
  // Half a pixel of slack: sub-pixel layout must not hide a spine that is in view.
  const left = scrollLeft - 0.5;
  const right = scrollLeft + room - (overflows ? reserve : 0) + 0.5;
  let x = 0;
  let shown = 0;
  let after = 0;
  for (const width of widths) {
    if (x + width > right) after += 1;
    else if (x >= left) shown += 1;
    x += width + gap;
  }
  return { shown, after };
}

/**
 * The Reading now strip: papers with a place that are not finished, most recently opened first.
 * The stats line's "N reading now" counts the same set (`isReadingNow`), so the two never disagree.
 *
 * @param papers - Every paper.
 * @param limit - How many to show; the strip's rows, not the count.
 * @returns At most `limit` papers.
 */
export function readingNow<P extends ShelfPaper>(
  papers: readonly P[],
  limit: number = READING_NOW_MAX,
): P[] {
  return papers
    .filter(isReadingNow)
    .sort(
      (a, b) =>
        (b.reading?.opened_at ?? '').localeCompare(a.reading?.opened_at ?? '') ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** A face-out column: the 224 px cover and the caption under it; at least 36 px between. */
const COVER_COLUMN = 264;
const COVER_GAP = 36;
/** The plank's ends: its padding, the bookends and their margins (`library.css`), both sides. */
const PLANK_ENDS = 56;

/**
 * How many covers stand on one plank at a width: four on a 1440 px window, one on a phone.
 *
 * @param width - The shelf's width in px (0 before it is measured).
 * @returns At least 1.
 */
export function coversPerRow(width: number): number {
  const room = width - PLANK_ENDS + COVER_GAP;
  return Math.max(1, Math.floor(room / (COVER_COLUMN + COVER_GAP)));
}

/**
 * The face-out shelf: the arranged order, cut into planks of `perRow`. Grouping labels are not
 * drawn face-out (each caption names its topic), but the order still follows Arrange by.
 *
 * @param papers - The papers on the shelf.
 * @param arrangement - Arrange by.
 * @param perRow - From `coversPerRow`.
 * @returns The planks, each a list of papers, left to right and top to bottom.
 */
export function coverRows<P extends ShelfPaper>(
  papers: readonly P[],
  arrangement: Arrangement,
  perRow: number,
): P[][] {
  const order = arrangeShelf(papers, arrangement).flatMap((group) => group.papers);
  const rows: P[][] = [];
  for (let i = 0; i < order.length; i += Math.max(1, perRow)) {
    rows.push(order.slice(i, i + Math.max(1, perRow)));
  }
  return rows;
}

/** The reader's saved place (contracts.md §5), as `ReaderWorkspace`'s `readSavedReaderState` accepts it. */
export interface ReaderPlace {
  readonly v: 1;
  readonly mode: ReadingMode;
  readonly zoomMode:
    | { readonly kind: 'fit-width' | 'fit-page' }
    | { readonly kind: 'scale'; readonly scale: number };
  readonly page: number;
  readonly yPt: number;
  readonly blockId?: string;
}

const MODES: ReadonlySet<unknown> = new Set(['source', 'guided', 'split']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isZoom(value: unknown): value is ReaderPlace['zoomMode'] {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'fit-width' || value['kind'] === 'fit-page') return true;
  const scale = value['scale'];
  return (
    value['kind'] === 'scale' && typeof scale === 'number' && Number.isFinite(scale) && scale > 0
  );
}

/**
 * The browser's saved place, if the reader would restore it: the same checks as the reader's
 * `readSavedReaderState` (a test holds the two together), so Continue never trusts a place the
 * reader would throw away.
 *
 * @param saved - The parsed `papertree/reader/<paper_id>` value, or null.
 * @returns The place, or null when the reader would ignore it.
 */
export function readerPlace(saved: unknown): ReaderPlace | null {
  if (!isRecord(saved) || saved['v'] !== 1 || !MODES.has(saved['mode'])) return null;
  const { page, yPt, zoomMode } = saved;
  if (!isZoom(zoomMode) || typeof page !== 'number' || !Number.isInteger(page) || page < 0) {
    return null;
  }
  if (typeof yPt !== 'number' || !Number.isFinite(yPt) || yPt < 0) return null;
  return saved as unknown as ReaderPlace;
}

/** What Continue does before it opens the reader. */
export interface ContinuePlan {
  /** The place to store for the reader, or null to keep the one this browser has. */
  readonly store: ReaderPlace | null;
  /** A later page this browser holds than the server: send it again (its write was lost). */
  readonly resend: { readonly page: number; readonly mode: ReadingMode } | null;
}

/**
 * Where Continue opens the reader (contracts.md §5's `papertree/reader/<paper_id>`, the reader's
 * own restore). The server's page is the place on every device, so it is stored when this browser
 * has none, or an earlier one. A place already on that page is kept to the line. A LATER page here
 * than on the server means this browser's write was lost (`readingStateSync` never retries), so
 * that place is kept and sent again rather than erased (review S1). The cost: a person who went
 * back on another device is returned to their furthest place here, which is the place they last
 * saw on this screen.
 *
 * @param saved - What the browser holds for the paper, parsed (null when nothing).
 * @param page - The server's zero-based `last_page`.
 * @param narrow - The window is phone-width (under 768 px, as the reader decides its default zoom).
 * @returns What to store and what to re-send.
 */
export function planContinue(saved: unknown, page: number, narrow: boolean): ContinuePlan {
  const here = readerPlace(saved);
  if (here !== null && here.page > page) {
    return { store: null, resend: { page: here.page, mode: here.mode } };
  }
  if (here !== null && here.page === page) return { store: null, resend: null };
  const zoomMode: ReaderPlace['zoomMode'] =
    here?.zoomMode ?? (narrow ? { kind: 'fit-width' } : { kind: 'scale', scale: 1.25 });
  return { store: { v: 1, mode: here?.mode ?? 'source', zoomMode, page, yPt: 0 }, resend: null };
}
