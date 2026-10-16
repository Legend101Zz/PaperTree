/**
 * library/model/states — which shelf the library shows, and who is "reading now" (#196, DESIGN.md
 * §1 and §9). Pure: the strip, the face-out covers and Continue's reader place are decided here so
 * they can be tested without a DOM. Thresholds are the design's "about 12" (owner may change).
 */
import { arrangeShelf, isReadingNow, type Arrangement, type ShelfPaper } from './shelf';

/** At or below this many papers the books stand face-out as covers (frame 01c). */
export const FACE_OUT_MAX = 12;

/** The Reading now strip shows at most this many papers on a desktop (frame 01). */
export const READING_NOW_MAX = 3;

/** How the shelf draws its books: covers face-out, or spines on one plank (frame 01). */
export type ShelfLayout = 'face-out' | 'spines';

/**
 * The shelf's layout for a number of papers on it.
 *
 * @param count - Papers on the shelf (after the "need a look" filter, never after a search, which
 *   dims in place and must not re-lay the shelf out while you type).
 * @returns The layout.
 */
export function shelfLayout(count: number): ShelfLayout {
  return count <= FACE_OUT_MAX ? 'face-out' : 'spines';
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

const ZOOM_KINDS = new Set(['fit-width', 'fit-page', 'scale']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The reader place Continue writes before it opens a paper (contracts.md §5's `papertree/reader/
 * <paper_id>`, the reader's own restore). The server's page wins: it is the place on every device,
 * the browser's only on this one. A saved place already on that page is kept as it is (its exact
 * line), and a saved mode and zoom are kept; with none, the reader's own defaults (Source; fit-width
 * on a phone, 125 % otherwise).
 *
 * @param saved - What the browser holds for the paper, parsed (null when nothing).
 * @param page - The server's zero-based `last_page`.
 * @param narrow - The window is phone-width (under 768 px, as the reader decides).
 * @returns The place to store, or null when the stored one already opens on that page.
 */
export function placeForContinue(
  saved: unknown,
  page: number,
  narrow: boolean,
): Record<string, unknown> | null {
  const zoom = isRecord(saved) ? saved['zoomMode'] : undefined;
  const valid =
    isRecord(saved) &&
    saved['v'] === 1 &&
    typeof saved['mode'] === 'string' &&
    isRecord(zoom) &&
    ZOOM_KINDS.has(String(zoom['kind']));
  if (valid && saved['page'] === page) return null;
  const kept = valid
    ? { mode: saved['mode'], zoomMode: zoom }
    : {
        mode: 'source',
        zoomMode: narrow ? { kind: 'fit-width' } : { kind: 'scale', scale: 1.25 },
      };
  return { v: 1, ...kept, page, yPt: 0 };
}
