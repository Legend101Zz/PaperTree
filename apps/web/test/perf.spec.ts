// @vitest-environment node

/**
 * reader/perf.spec — the windowing contract for a 55-page PDF.
 *
 * WHY THERE IS NO FPS ASSERTION HERE. Frame rate is not a property of this code; it is a property of
 * this code plus a GPU, a compositor, a display refresh rate and whatever else the machine is doing.
 * A test that renders 55 pages in headless Chrome and asserts `fps >= 60` measures the CI runner and
 * fails on a busy one, which trains everybody to ignore it. So this file asserts the two properties
 * that MAKE 60 fps achievable, and it asserts them exactly:
 *
 *   1. THE MOUNTED SET IS BOUNDED. At every scroll position in the document, the pages that may be
 *      mounted are precisely the visible ones plus `overscan` on each side — never the whole
 *      document, never a set that grows as you scroll. Bounded mounted pages is bounded canvas
 *      memory and a bounded reconciliation per frame.
 *
 *   2. NOTHING IS MEASURED. Every offset, height and total is arithmetic over page sizes and zoom.
 *      This file runs under `@vitest-environment node`, so there is NO `document`, NO `window` and
 *      no layout engine at all — an implementation that reached for `getBoundingClientRect()` or
 *      `offsetHeight` would throw here rather than quietly work in a browser and jank in the wild.
 *      The environment pragma is the assertion; `it('has no DOM to measure')` states it out loud.
 *
 * Between them those two are what a per-frame budget actually needs. What is left — paint time for
 * the pages that ARE mounted — belongs to `PdfPage`'s canvas clamp, not to the scroller.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OVERSCAN,
  DEFAULT_PAGE_GAP,
  computePageLayout,
  computePageWindow,
  offsetForBlock,
  offsetForPage,
  pageIndexAtOffset,
  type PageLayout,
  type UnitSize,
} from '@/components/reader/VirtualPageList';

/** US Letter at 72 dpi, the size every fixture page happens to be. */
const LETTER: UnitSize = { width: 612, height: 792 };

/** 55 pages, most Letter, with three odd ones so nothing can secretly assume a uniform height. */
const PAGES: readonly UnitSize[] = Array.from({ length: 55 }, (_, i) => {
  if (i === 7) return { width: 612, height: 1008 }; // a fold-out table
  if (i === 23) return { width: 842, height: 595 }; // A4 landscape figure page
  if (i === 54) return { width: 612, height: 400 }; // a short final page
  return LETTER;
});

const VIEWPORT = 900;

function windowAt(layout: PageLayout, scrollTop: number, overscan = DEFAULT_OVERSCAN) {
  return computePageWindow(layout, scrollTop, VIEWPORT, overscan);
}

/** The visible set, recomputed independently of the implementation's forward walk. */
function visibleByBruteForce(layout: PageLayout, scrollTop: number, viewportHeight: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < layout.offsets.length; i += 1) {
    const top = layout.offsets[i] as number;
    const bottom = top + (layout.heights[i] as number);
    if (top < scrollTop + viewportHeight && bottom > scrollTop) out.push(i);
  }
  return out;
}

describe('page layout is computed, never measured', () => {
  it('has no DOM to measure', () => {
    // The point of `@vitest-environment node`. If this ever fails, the file has been moved into a
    // DOM environment and the purity guarantee below stops being enforced by anything.
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
  });

  it('derives every offset arithmetically from page heights and zoom', () => {
    const layout = computePageLayout(PAGES, 1);
    expect(layout.offsets).toHaveLength(55);

    let expected = 0;
    for (let i = 0; i < PAGES.length; i += 1) {
      expect(layout.offsets[i]).toBe(expected);
      expect(layout.heights[i]).toBe(Math.round((PAGES[i] as UnitSize).height));
      expected += (layout.heights[i] as number) + DEFAULT_PAGE_GAP;
    }

    // No trailing gutter: the document ends at the bottom edge of the last page.
    expect(layout.totalHeight).toBe(
      (layout.offsets[54] as number) + (layout.heights[54] as number),
    );
  });

  it('takes the content width from the widest page, not the first', () => {
    const layout = computePageLayout(PAGES, 1);
    expect(layout.maxWidth).toBe(842);
  });

  it('finds the page at an offset by search, matching a linear scan', () => {
    const layout = computePageLayout(PAGES, 1);
    for (let i = 0; i < PAGES.length; i += 1) {
      const top = layout.offsets[i] as number;
      expect(pageIndexAtOffset(layout, top)).toBe(i);
      expect(pageIndexAtOffset(layout, top + (layout.heights[i] as number) - 1)).toBe(i);
    }
    expect(pageIndexAtOffset(layout, -50)).toBe(0);
    expect(pageIndexAtOffset(layout, layout.totalHeight + 5_000)).toBe(54);
  });

  it('handles an empty document without special-casing at the call site', () => {
    const layout = computePageLayout([], 1);
    expect(layout.totalHeight).toBe(0);
    expect(computePageWindow(layout, 0, VIEWPORT).mounted).toEqual([]);
    expect(offsetForPage(layout, 3)).toBe(0);
  });
});

describe('total height is stable', () => {
  it('does not depend on scroll position or on which pages are mounted', () => {
    const layout = computePageLayout(PAGES, 1);
    for (const scrollTop of [0, 1_000, 20_000, layout.totalHeight]) {
      const win = windowAt(layout, scrollTop);
      // The mounted set changes; the scroll height must not, or the scrollbar jumps under the thumb.
      expect(win.leadingSpacer + mountedExtent(layout, win.firstMounted, win.lastMounted) + win.trailingSpacer)
        .toBe(layout.totalHeight);
    }
  });

  it('returns to the identical value after a zoom round trip', () => {
    const at1 = computePageLayout(PAGES, 1).totalHeight;
    const at2 = computePageLayout(PAGES, 2).totalHeight;
    const at4 = computePageLayout(PAGES, 4).totalHeight;
    const backTo1 = computePageLayout(PAGES, 1).totalHeight;

    expect(backTo1).toBe(at1);
    expect(at2).toBeGreaterThan(at1);
    expect(at4).toBeGreaterThan(at2);
    // The gutters are unscaled, so the growth is the page area alone — the check is that zoom
    // changes are recomputed from scratch and never accumulated onto the previous total.
    expect(at2 - DEFAULT_PAGE_GAP * 54).toBe((at1 - DEFAULT_PAGE_GAP * 54) * 2);
  });

  it('is unaffected by the overscan setting', () => {
    const layout = computePageLayout(PAGES, 1.5);
    const tight = computePageWindow(layout, 5_000, VIEWPORT, 0);
    const loose = computePageWindow(layout, 5_000, VIEWPORT, 5);
    for (const win of [tight, loose]) {
      expect(win.leadingSpacer + mountedExtent(layout, win.firstMounted, win.lastMounted) + win.trailingSpacer)
        .toBe(layout.totalHeight);
    }
  });
});

describe('only visible pages ±2 are mounted', () => {
  const layout = computePageLayout(PAGES, 1);

  it('mounts exactly the visible set padded by the overscan, at every scroll position', () => {
    // Stops one step short of the very bottom: at `scrollTop === totalHeight` nothing overlaps the
    // viewport at all and the window falls back to anchoring, which the zero-height case covers.
    for (let scrollTop = 0; scrollTop < layout.totalHeight; scrollTop += 137) {
      const win = windowAt(layout, scrollTop);
      const visible = visibleByBruteForce(layout, scrollTop, VIEWPORT);

      expect(win.visible).toEqual(visible);

      const expectedFirst = Math.max(0, (visible[0] as number) - DEFAULT_OVERSCAN);
      const expectedLast = Math.min(54, (visible[visible.length - 1] as number) + DEFAULT_OVERSCAN);
      const expectedMounted: number[] = [];
      for (let i = expectedFirst; i <= expectedLast; i += 1) expectedMounted.push(i);

      expect(win.mounted).toEqual(expectedMounted);
    }
  });

  it('never mounts the whole document, however far it is scrolled', () => {
    // Two Letter pages fit in a 900px viewport, so the bound is 2 visible + 2×2 overscan = 6, plus
    // one for a viewport straddling three short pages. The assertion that matters is that the bound
    // exists and does not grow with the page count.
    let worst = 0;
    for (let scrollTop = 0; scrollTop <= layout.totalHeight; scrollTop += 41) {
      worst = Math.max(worst, windowAt(layout, scrollTop).mounted.length);
    }
    expect(worst).toBeLessThanOrEqual(8);
    expect(worst).toBeLessThan(PAGES.length);
  });

  it('clamps the overscan at both ends instead of producing negative indices', () => {
    const top = windowAt(layout, 0);
    expect(top.firstMounted).toBe(0);
    expect(top.mounted[0]).toBe(0);

    const bottom = windowAt(layout, layout.totalHeight);
    expect(bottom.lastMounted).toBe(54);
    expect(bottom.mounted[bottom.mounted.length - 1]).toBe(54);
  });

  it('keeps the mounted set contiguous and ascending', () => {
    for (let scrollTop = 0; scrollTop <= layout.totalHeight; scrollTop += 311) {
      const { mounted } = windowAt(layout, scrollTop);
      for (let i = 1; i < mounted.length; i += 1) {
        expect(mounted[i]).toBe((mounted[i - 1] as number) + 1);
      }
    }
  });

  it('reports the page occupying most of the viewport as current', () => {
    // Scroll so page 3 fills the viewport from its very top.
    const layoutAt1 = computePageLayout(PAGES, 1);
    const win = computePageWindow(layoutAt1, layoutAt1.offsets[3] as number, 400);
    expect(win.current).toBe(3);
  });

  it('still anchors on one page when the viewport has no height yet', () => {
    // The first render, before the ResizeObserver has reported. Mounting nothing would show a blank
    // reader that only fills in on the first resize.
    const win = computePageWindow(layout, layout.offsets[10] as number, 0);
    expect(win.visible).toEqual([10]);
    expect(win.mounted).toEqual([8, 9, 10, 11, 12]);
  });
});

describe('imperative scrolling targets are arithmetic', () => {
  const layout = computePageLayout(PAGES, 2);

  it('scrolls to a page by its precomputed offset', () => {
    expect(offsetForPage(layout, 12)).toBe(layout.offsets[12]);
    expect(offsetForPage(layout, -1)).toBe(layout.offsets[0]);
    expect(offsetForPage(layout, 999)).toBe(layout.offsets[54]);
  });

  it('scrolls to an IR-space bbox using only the zoom scalar', () => {
    // IR space: PDF points, origin TOP-LEFT, y DOWN. No client rects, no percentages of an element.
    const bbox: [number, number, number, number] = [72, 300, 540, 340];
    const target = offsetForBlock(layout, 9, bbox, 2, { margin: 24 });
    expect(target.top).toBe((layout.offsets[9] as number) + 300 * 2 - 24);

    // Centred on the widest page's column, the narrower page 9 is inset by half the difference.
    const pageLeft = (layout.maxWidth - (layout.widths[9] as number)) / 2;
    expect(target.left).toBe(pageLeft + 72 * 2 - 24);
  });

  it('biases the target down the viewport so the block is not flush against the top edge', () => {
    const bbox: [number, number, number, number] = [72, 300, 540, 340];
    const pinned = offsetForBlock(layout, 9, bbox, 2, { margin: 24 });
    const biased = offsetForBlock(layout, 9, bbox, 2, { margin: 24, viewportHeight: 900 });
    expect(biased.top).toBeLessThan(pinned.top);
  });
});

/** The flow height the mounted pages themselves occupy, gutters included. */
function mountedExtent(layout: PageLayout, first: number, last: number): number {
  if (first < 0 || last < first) return 0;
  let total = 0;
  for (let i = first; i <= last; i += 1) {
    total += layout.heights[i] as number;
    if (i < layout.offsets.length - 1) total += layout.gap;
  }
  return total;
}
