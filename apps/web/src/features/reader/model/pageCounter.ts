/**
 * The header's page counter ("p. 2 of 15", frame 04), as a pure function so the header stays a
 * view. The page is the one at the top of the reader's view, reported by Source or Guided.
 */

/**
 * The counter's text.
 *
 * @param page - 0-based page at the top of the view, or null before the reader has shown one.
 * @param pageCount - The paper's page count, or null while the PDF is still opening.
 * @returns "p. 2 of 15", "p. 2" without a count, or null when there is no page to name.
 * @example
 * pageCounterLabel(1, 15) // "p. 2 of 15"
 */
export function pageCounterLabel(page: number | null, pageCount: number | null): string | null {
  if (page === null || !Number.isFinite(page) || page < 0) return null;
  const known = pageCount !== null && Number.isFinite(pageCount) && pageCount > 0;
  // A saved position can outlive a re-upload with fewer pages: never claim "p. 18 of 15".
  const shown = known ? Math.min(Math.floor(page) + 1, pageCount) : Math.floor(page) + 1;
  return known ? `p. ${String(shown)} of ${String(pageCount)}` : `p. ${String(shown)}`;
}

/**
 * Which page the counter names. Source and Split: the page filling most of the view (the page
 * list's visible-pages store); Guided, or before the page list reports: the page of the top
 * paragraph, or the saved place.
 *
 * @param mode - The reading mode.
 * @param mostVisible - The page filling most of Source's view, or -1 when none is mounted.
 * @param fallback - Guided's top page, or the saved one.
 * @returns The 0-based page to name.
 */
export function counterPage(
  mode: 'source' | 'guided' | 'split',
  mostVisible: number,
  fallback: number | null,
): number | null {
  return mode !== 'guided' && mostVisible >= 0 ? mostVisible : fallback;
}
