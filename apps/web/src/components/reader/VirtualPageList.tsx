'use client';

/**
 * reader/VirtualPageList — the scroller that keeps a 55-page PDF at 60 fps.
 *
 * THE PROPERTY THAT MAKES 60 fps POSSIBLE, and it is a property rather than a benchmark: at any
 * scroll position the number of MOUNTED pages is bounded by `2 × overscan + visibleCount`, and
 * every geometric number the scroller needs — each page's height, each page's absolute offset, the
 * document's total height, which pages intersect the viewport — is ARITHMETIC over `PdfPageMeta`
 * and `zoom`. Nothing is read back from the DOM, so there is no forced reflow in the scroll path
 * and no measurement to be stale. `test/perf.spec.ts` asserts exactly that, in Node, with no DOM
 * present at all.
 *
 * WHY THE MATH IS EXPORTED. `computePageLayout` and `computePageWindow` are pure and live at module
 * scope precisely so the windowing contract can be tested without mounting anything. A virtual
 * scroller tested only through the DOM is tested through the thing it exists to avoid.
 *
 * WHY SPACERS AND NOT ABSOLUTE POSITIONING. Absolute positioning inside a fixed-height container
 * would also keep the scrollbar still, but it puts every page in its own layer and hands the
 * browser 55 stacking contexts. A leading spacer of exactly `offsets[firstMounted]` and a trailing
 * spacer of exactly the remainder keeps the pages in normal flow, keeps the scroll height exact to
 * the pixel, and makes "the scrollbar never jumps" checkable arithmetically rather than by eye.
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEventHandler,
  type ReactNode,
} from 'react';

import type { BBox } from '@papertree/document-ir';

import { PdfPage, type TextLayerInfo } from './PdfPage';
import { pageUnitSize, usePdfDocument, type PdfPageMeta } from './PdfDocumentProvider';

/* ────────────────────────────── the pure windowing math ────────────────────────────── */

/** A page's CSS box at zoom 1. Unrounded — rounding happens once, at `zoom`. */
export interface UnitSize {
  readonly width: number;
  readonly height: number;
}

export interface PageLayout {
  /** Absolute top of each page inside the scrolled content, in CSS px. */
  readonly offsets: readonly number[];
  readonly heights: readonly number[];
  readonly widths: readonly number[];
  /** Exactly `offsets[n-1] + heights[n-1]`, or 0 for an empty document. */
  readonly totalHeight: number;
  readonly maxWidth: number;
  readonly gap: number;
}

export interface PageWindow {
  /** First and last page intersecting the viewport. `-1`/`-2` when the document is empty. */
  readonly firstVisible: number;
  readonly lastVisible: number;
  readonly firstMounted: number;
  readonly lastMounted: number;
  /** Contiguous, ascending, `[firstMounted … lastMounted]`. The ONLY pages that may be mounted. */
  readonly mounted: readonly number[];
  readonly visible: readonly number[];
  /** The page occupying the most of the viewport — what the Navigator should mark "current". */
  readonly current: number;
  readonly leadingSpacer: number;
  readonly trailingSpacer: number;
}

/** A constant, unscaled gutter. Scaling it with zoom makes the gutter dominate the page at 400%. */
export const DEFAULT_PAGE_GAP = 16;
export const DEFAULT_OVERSCAN = 2;

const EMPTY_LAYOUT: PageLayout = {
  offsets: [],
  heights: [],
  widths: [],
  totalHeight: 0,
  maxWidth: 0,
  gap: DEFAULT_PAGE_GAP,
};

const EMPTY_WINDOW: PageWindow = {
  firstVisible: -1,
  lastVisible: -2,
  firstMounted: -1,
  lastMounted: -2,
  mounted: [],
  visible: [],
  current: -1,
  leadingSpacer: 0,
  trailingSpacer: 0,
};

/**
 * Absolute offsets by prefix sum. O(n) once per zoom change, never per frame.
 *
 * Heights are rounded HERE, so `offsets` are integers and a page's rendered box (rounded by
 * `pageCssSize` from the same product, in the same order) is the same integer. Rounding in two
 * places with two different expressions is how a virtual list acquires a one-pixel-per-page drift
 * that only shows up 30 pages in.
 */
export function computePageLayout(
  pages: readonly UnitSize[],
  zoom: number,
  gap: number = DEFAULT_PAGE_GAP,
): PageLayout {
  if (pages.length === 0) return { ...EMPTY_LAYOUT, gap };

  const offsets: number[] = new Array<number>(pages.length);
  const heights: number[] = new Array<number>(pages.length);
  const widths: number[] = new Array<number>(pages.length);
  let cursor = 0;
  let maxWidth = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i] as UnitSize;
    const height = Math.max(1, Math.round(page.height * zoom));
    const width = Math.max(1, Math.round(page.width * zoom));
    offsets[i] = cursor;
    heights[i] = height;
    widths[i] = width;
    if (width > maxWidth) maxWidth = width;
    cursor += height + gap;
  }

  const last = pages.length - 1;
  return {
    offsets,
    heights,
    widths,
    // No trailing gap: the document ends at the bottom of the last page.
    totalHeight: (offsets[last] as number) + (heights[last] as number),
    maxWidth,
    gap,
  };
}

/**
 * The page containing `y`, by binary search over `offsets`.
 *
 * Binary search rather than a linear scan because this runs on every scroll tick and a linear scan
 * makes the cost of scrolling proportional to how far down the document the reader already is —
 * which is precisely the page count at which a reader starts to care.
 */
export function pageIndexAtOffset(layout: PageLayout, y: number): number {
  const n = layout.offsets.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((layout.offsets[mid] as number) <= y) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function offsetForPage(layout: PageLayout, pageIndex: number): number {
  const n = layout.offsets.length;
  if (n === 0) return 0;
  const clamped = Math.min(Math.max(pageIndex, 0), n - 1);
  return layout.offsets[clamped] as number;
}

/**
 * Which pages intersect the viewport, plus `overscan` on each side.
 *
 * A page counts as visible when it OVERLAPS the viewport, strictly: a page whose bottom edge is
 * exactly at `scrollTop` is behind you, not on screen. When the viewport has no height yet — the
 * first render, before the ResizeObserver has fired — the page at `scrollTop` is treated as visible
 * so the reader shows something rather than an empty scroller.
 */
export function computePageWindow(
  layout: PageLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number = DEFAULT_OVERSCAN,
): PageWindow {
  const n = layout.offsets.length;
  if (n === 0) return EMPTY_WINDOW;

  const top = Math.max(0, scrollTop);
  const bottom = top + Math.max(0, viewportHeight);

  const anchor = pageIndexAtOffset(layout, top);

  let firstVisible = -1;
  let lastVisible = -2;
  let current = anchor;
  let bestOverlap = -1;

  // Walk forward from the page containing the viewport's top edge; stop at the first page that
  // starts below the viewport. Bounded by the number of visible pages, not by the document length.
  for (let i = anchor; i < n; i += 1) {
    const pageTop = layout.offsets[i] as number;
    if (pageTop >= bottom) break;
    const pageBottom = pageTop + (layout.heights[i] as number);
    if (pageBottom <= top) continue;
    if (firstVisible === -1) firstVisible = i;
    lastVisible = i;
    const overlap = Math.min(pageBottom, bottom) - Math.max(pageTop, top);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      current = i;
    }
  }

  if (firstVisible === -1) {
    // Zero-height viewport, or a scroll position past the end. Anchor on one page regardless.
    firstVisible = anchor;
    lastVisible = anchor;
    current = anchor;
  }

  const pad = Math.max(0, Math.trunc(overscan));
  const firstMounted = Math.max(0, firstVisible - pad);
  const lastMounted = Math.min(n - 1, lastVisible + pad);

  const mounted: number[] = [];
  for (let i = firstMounted; i <= lastMounted; i += 1) mounted.push(i);
  const visible: number[] = [];
  for (let i = firstVisible; i <= lastVisible; i += 1) visible.push(i);

  const consumedTop = layout.offsets[firstMounted] as number;
  const lastBottom = (layout.offsets[lastMounted] as number) + (layout.heights[lastMounted] as number);
  // Every page but the document's last carries a bottom gutter, so the trailing spacer must not
  // count it twice.
  const trailingGap = lastMounted < n - 1 ? layout.gap : 0;

  return {
    firstVisible,
    lastVisible,
    firstMounted,
    lastMounted,
    mounted,
    visible,
    current,
    leadingSpacer: consumedTop,
    trailingSpacer: Math.max(0, layout.totalHeight - lastBottom - trailingGap),
  };
}

/**
 * The scroll position that brings an IR-space bbox on `pageIndex` into view.
 *
 * `bbox` is IR SPACE — PDF user-space points, origin top-left — so the only conversion is the
 * IR→CSS scalar. There is no element to measure and no rectangle to read back.
 */
export function offsetForBlock(
  layout: PageLayout,
  pageIndex: number,
  bbox: BBox,
  irScale: number,
  opts: { readonly margin?: number; readonly viewportHeight?: number } = {},
): { top: number; left: number } {
  const margin = opts.margin ?? 24;
  const pageTop = offsetForPage(layout, pageIndex);
  const pageWidth = layout.widths[Math.min(Math.max(pageIndex, 0), layout.widths.length - 1)] ?? 0;
  const pageLeft = Math.max(0, (layout.maxWidth - pageWidth) / 2);

  const blockTop = pageTop + bbox[1] * irScale;
  const blockHeight = Math.max(0, (bbox[3] - bbox[1]) * irScale);
  const viewportHeight = opts.viewportHeight ?? 0;

  // Bias the target a third of the way down rather than pinning it to the top edge: a block flush
  // against the top of the viewport reads as cut off, and there is nowhere for a popover to go.
  const bias = viewportHeight > 0 ? Math.max(margin, (viewportHeight - blockHeight) / 3) : margin;

  return {
    top: Math.max(0, blockTop - bias),
    left: Math.max(0, pageLeft + bbox[0] * irScale - margin),
  };
}

/* ────────────────────────────── visible-page publication ────────────────────────────── */

export interface VisiblePages {
  readonly pages: readonly number[];
  /** The page occupying the most of the viewport, or `-1` when nothing is mounted. */
  readonly current: number;
}

const NO_VISIBLE_PAGES: VisiblePages = { pages: [], current: -1 };

interface VisiblePagesStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): VisiblePages;
  publish(next: VisiblePages): void;
}

function createVisiblePagesStore(): VisiblePagesStore {
  let snapshot: VisiblePages = NO_VISIBLE_PAGES;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    publish(next) {
      if (next.current === snapshot.current && sameNumbers(next.pages, snapshot.pages)) return;
      snapshot = next;
      // `forEach` rather than `for…of`: apps/web compiles without `downlevelIteration`.
      listeners.forEach((listener) => listener());
    },
  };
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * An external store rather than a context value.
 *
 * The Navigator is a SIBLING of the scroller, not a descendant, so a context provided by
 * `VirtualPageList` would never reach it. A store threaded through a context that has a working
 * default means the Navigator can subscribe from anywhere in the tree and the scroller does not
 * re-render its own subtree on every scroll tick just to publish a number.
 */
const defaultVisiblePagesStore = createVisiblePagesStore();
const VisiblePagesContext = createContext<VisiblePagesStore>(defaultVisiblePagesStore);

export function VisiblePagesProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const store = useMemo(createVisiblePagesStore, []);
  return <VisiblePagesContext.Provider value={store}>{children}</VisiblePagesContext.Provider>;
}

/** Subscribe to the pages currently on screen. Safe to call outside `VisiblePagesProvider`. */
export function useVisiblePages(): VisiblePages {
  const store = useContext(VisiblePagesContext);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => NO_VISIBLE_PAGES);
}

/* ────────────────────────────── the component ────────────────────────────── */

export interface ScrollToOptions {
  readonly behavior?: ScrollBehavior;
  readonly margin?: number;
}

export interface VirtualPageListHandle {
  scrollToPage(pageIndex: number, opts?: ScrollToOptions): void;
  /** `bbox` is IR space: PDF points, origin top-left, `/Rotate` applied. */
  scrollToBlock(pageIndex: number, bbox: BBox, opts?: ScrollToOptions): void;
  getVisiblePages(): VisiblePages;
  getScrollElement(): HTMLDivElement | null;
}

/** Pointer plumbing the reader shell forwards from `usePinchZoom`. */
export interface PointerSurfaceProps {
  readonly onPointerDown?: PointerEventHandler<HTMLDivElement>;
  readonly onPointerMove?: PointerEventHandler<HTMLDivElement>;
  readonly onPointerUp?: PointerEventHandler<HTMLDivElement>;
  readonly onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  readonly style?: CSSProperties;
}

export interface VirtualPageListProps {
  readonly zoom: number;
  readonly overscan?: number;
  readonly gap?: number;
  readonly className?: string;
  /** The highlight overlay for a page, rendered into `PdfPage`'s overlay slot. */
  readonly renderOverlay?: (pageIndex: number, meta: PdfPageMeta) => ReactNode;
  /** Forwarded to every mounted `PdfPage`. The reader shell stamps the IR attributes from it. */
  readonly onTextLayer?: (info: TextLayerInfo) => void;
  /**
   * The scroller's own box, reported on resize.
   *
   * The reader shell needs it for `resolveZoom`: "fit width" that resolves to a number ONCE stops
   * fitting the moment the window changes, so the mode is kept and re-resolved against this. It is
   * published from the observer that already runs rather than measured a second time — a second
   * `clientWidth` read somewhere else is a second source of truth for the same pixel.
   */
  readonly onViewportResize?: (size: { readonly width: number; readonly height: number }) => void;
  readonly onVisibleChange?: (visible: VisiblePages) => void;
  /** Pinch handlers and `touch-action`, from `usePinchZoom` in `ZoomControl`. */
  readonly surfaceProps?: PointerSurfaceProps;
}

export const VirtualPageList = forwardRef<VirtualPageListHandle, VirtualPageListProps>(
  function VirtualPageList(
    {
      zoom,
      overscan = DEFAULT_OVERSCAN,
      gap = DEFAULT_PAGE_GAP,
      className,
      renderOverlay,
      onTextLayer,
      onViewportResize,
      onVisibleChange,
      surfaceProps,
    },
    ref,
  ) {
    const { numPages, pageMeta } = usePdfDocument();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const store = useContext(VisiblePagesContext);

    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);

    const units = useMemo<UnitSize[]>(() => {
      const out: UnitSize[] = [];
      for (let i = 0; i < numPages; i += 1) {
        const meta = pageMeta.get(i);
        if (meta === undefined) break;
        out.push(pageUnitSize(meta));
      }
      return out;
    }, [numPages, pageMeta]);

    const layout = useMemo(() => computePageLayout(units, zoom, gap), [units, zoom, gap]);
    const win = useMemo(
      () => computePageWindow(layout, scrollTop, viewportHeight, overscan),
      [layout, scrollTop, viewportHeight, overscan],
    );

    /**
     * rAF-coalesced. A trackpad fling delivers scroll events faster than frames; without the gate
     * React would be asked to reconcile several times between two paints, which is the jank the
     * whole file is arranged to avoid. `scrollTop` is a scalar read, not a layout query.
     */
    const frameRef = useRef<number | null>(null);
    const onScroll = useCallback(() => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const el = scrollRef.current;
        if (el !== null) setScrollTop(el.scrollTop);
      });
    }, []);

    useEffect(
      () => () => {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      },
      [],
    );

    // The ONLY measurement in this file, and it happens on resize rather than on scroll: the
    // viewport's own box, which cannot be derived from the IR. Held in a ref so a caller passing an
    // inline lambda does not re-run the observer on every render.
    const onViewportResizeRef = useRef(onViewportResize);
    onViewportResizeRef.current = onViewportResize;

    useEffect(() => {
      const el = scrollRef.current;
      if (el === null) return;
      setViewportHeight(el.clientHeight);
      onViewportResizeRef.current?.({ width: el.clientWidth, height: el.clientHeight });
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry === undefined) return;
        setViewportHeight(entry.contentRect.height);
        onViewportResizeRef.current?.({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    const visible = useMemo<VisiblePages>(
      () => ({ pages: win.visible, current: win.current }),
      [win.visible, win.current],
    );

    useEffect(() => {
      store.publish(visible);
      onVisibleChange?.(visible);
    }, [store, visible, onVisibleChange]);

    const irScaleFor = useCallback(
      (pageIndex: number): number => {
        const meta = pageMeta.get(pageIndex);
        return zoom * (meta?.userUnit ?? 1);
      },
      [pageMeta, zoom],
    );

    useImperativeHandle(
      ref,
      (): VirtualPageListHandle => ({
        scrollToPage(pageIndex, opts) {
          const el = scrollRef.current;
          if (el === null) return;
          el.scrollTo({ top: offsetForPage(layout, pageIndex), behavior: opts?.behavior ?? 'auto' });
        },
        scrollToBlock(pageIndex, bbox, opts) {
          const el = scrollRef.current;
          if (el === null) return;
          const target = offsetForBlock(layout, pageIndex, bbox, irScaleFor(pageIndex), {
            margin: opts?.margin ?? 24,
            viewportHeight,
          });
          el.scrollTo({ top: target.top, left: target.left, behavior: opts?.behavior ?? 'auto' });
        },
        getVisiblePages() {
          return visible;
        },
        getScrollElement() {
          return scrollRef.current;
        },
      }),
      [layout, irScaleFor, viewportHeight, visible],
    );

    const surfaceStyle: CSSProperties = {
      // Native vertical panning stays with the browser; the browser's own pinch-zoom does not, so
      // both pointers reach `usePinchZoom`. The gesture surface overrides this to `none` for the
      // duration of a pinch.
      touchAction: 'pan-y',
      ...surfaceProps?.style,
    };

    return (
      <div
        ref={scrollRef}
        className={joinClasses('relative h-full w-full overflow-auto overscroll-contain', className)}
        onScroll={onScroll}
        onPointerDown={surfaceProps?.onPointerDown}
        onPointerMove={surfaceProps?.onPointerMove}
        onPointerUp={surfaceProps?.onPointerUp}
        onPointerCancel={surfaceProps?.onPointerCancel}
        style={surfaceStyle}
        data-papertree-scroller=""
        // WCAG 2.2 AA, axe `scrollable-region-focusable`. A region that scrolls but cannot be
        // focused is unreachable by keyboard: the pages are not themselves focusable, so without
        // this a keyboard-only reader can open the paper and never move down it. Found by running
        // axe in a REAL browser — happy-dom performs no layout, so it never sees an overflow and
        // this rule could not fire in `reader/a11y.spec` (issue #42).
        tabIndex={0}
        role="region"
        aria-label="Paper pages"
      >
        <div style={{ width: `${layout.maxWidth}px`, margin: '0 auto' }}>
          {/* Exact-height spacers: the scroll height never depends on what happens to be mounted. */}
          <div aria-hidden="true" style={{ height: `${win.leadingSpacer}px` }} />
          {win.mounted.map((pageIndex) => {
            const meta = pageMeta.get(pageIndex);
            if (meta === undefined) return null;
            return (
              <div
                key={pageIndex}
                style={{
                  height: `${layout.heights[pageIndex] as number}px`,
                  width: `${layout.widths[pageIndex] as number}px`,
                  marginBottom: pageIndex < layout.offsets.length - 1 ? `${layout.gap}px` : 0,
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
              >
                <PdfPage pageIndex={pageIndex} zoom={zoom} onTextLayer={onTextLayer}>
                  {renderOverlay?.(pageIndex, meta)}
                </PdfPage>
              </div>
            );
          })}
          <div aria-hidden="true" style={{ height: `${win.trailingSpacer}px` }} />
        </div>
      </div>
    );
  },
);

function joinClasses(...values: readonly (string | undefined)[]): string {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0).join(' ');
}
