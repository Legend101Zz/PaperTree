/**
 * library/model/states — who is "reading now", and where Continue opens the reader (#196,
 * DESIGN.md §1). Pure, so the strip and Continue's reader place are tested without a DOM.
 */
import { isReadingNow, type ShelfPaper } from './shelf';

/** The Reading now strip shows at most this many papers on a desktop (frame 01). */
export const READING_NOW_MAX = 3;

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
