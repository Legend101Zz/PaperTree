'use client';

/**
 * reader/PdfDocumentProvider — one pdf.js document, loaded once, described in IR terms.
 *
 * WHY A PROVIDER AND NOT A HOOK PER PAGE. `getDocument()` opens a worker and a transport; calling it
 * from each page component would open one per page and then race them. The document is loaded here,
 * once, and every page reads the same `PDFDocumentProxy`.
 *
 * WHY PAGE METADATA IS COLLECTED UP FRONT. The virtual list must know every page's height BEFORE it
 * decides what to mount, or it has to mount a page to measure it — which is the DOM-measurement
 * loop that makes virtual scrolling jank. `page.view` and `page.rotate` are already in the document
 * catalogue, so `getPage()` here is a cheap worker round-trip, not a render.
 *
 * COORDINATES. `PdfPageMeta.width`/`.height` are IR SPACE: PDF user-space points, origin top-left,
 * `/Rotate` APPLIED, `/UserUnit` NOT applied — exactly what `frameForPdfPage` produces and exactly
 * what every stored polygon is expressed in. They are NOT CSS pixels. The single scalar taking IR
 * points to CSS pixels is `irToCssScale()` = `zoom × userUnit`, matching `viewportScale()` in
 * `@papertree/document-ir`, and it is the number the highlight overlay's `transform: scale(...)`
 * must use.
 *
 * THE /UserUnit TRAP, stated once so nobody rediscovers it: pdf.js v5's
 * `PageViewport` does `scale *= userUnit` in its constructor, so `getViewport({ scale: z })` is
 * already `z × userUnit` big. IR space has `/UserUnit` NOT applied. The two agree only because we
 * define the CSS page box as `irSize × zoom × userUnit` — i.e. `getViewport({ scale: zoom })` — and
 * put `userUnit` in the overlay's scale factor rather than in the stored geometry. Divide anywhere
 * and every highlight on a large-format figure page lands wrong.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

import { frameForPdfPage } from '@papertree/anchoring';
import type { BBox, PageFrame } from '@papertree/document-ir';

import { getPdfjs } from '@/lib/pdf/worker';

/** What `getDocument` will accept. An `ArrayBuffer` is TRANSFERRED to the worker — do not reuse it. */
export type PdfSource = string | URL | ArrayBuffer | Uint8Array;

export interface PdfPageMeta {
  /** 0-based. `PDFPageProxy.pageNumber` is 1-based; every API in this epic is 0-based. */
  readonly index: number;
  /** IR-space page width in points: post-`/Rotate`, `/UserUnit` NOT applied. */
  readonly width: number;
  /** IR-space page height in points: post-`/Rotate`, `/UserUnit` NOT applied. */
  readonly height: number;
  /** The page's `/Rotate`, already folded into `width`/`height`. Recorded, not to be applied twice. */
  readonly rotate: number;
  /** The page's `/UserUnit`. Applied to the CSS scale, never to IR geometry. */
  readonly userUnit: number;
  /** `PDFPageProxy.view` = intersect(CropBox, MediaBox), RAW pdf space, bottom-left origin. */
  readonly view: BBox;
  /** The IR frame, for `pdfPointToIr` / `pdfRectToIr`. */
  readonly frame: PageFrame;
}

export interface PdfDocumentValue {
  readonly pdf: PDFDocumentProxy | null;
  readonly numPages: number;
  readonly pageMeta: ReadonlyMap<number, PdfPageMeta>;
  /** A designed state, not a thrown exception: the reader renders a retry affordance from it. */
  readonly error: Error | null;
  readonly loading: boolean;
  /** Re-runs the load. Safe to call while loading; the in-flight task is destroyed first. */
  readonly reload: () => void;
}

const EMPTY_META: ReadonlyMap<number, PdfPageMeta> = new Map();

const PdfDocumentContext = createContext<PdfDocumentValue | null>(null);

export function usePdfDocument(): PdfDocumentValue {
  const value = useContext(PdfDocumentContext);
  if (value === null) {
    throw new Error('usePdfDocument() requires a <PdfDocumentProvider> ancestor.');
  }
  return value;
}

/** The page's meta, or `null` while the document is still being described. */
export function usePdfPageMeta(pageIndex: number): PdfPageMeta | null {
  const { pageMeta } = usePdfDocument();
  return pageMeta.get(pageIndex) ?? null;
}

/**
 * IR points → CSS pixels. `zoom × userUnit`, the same product `viewportScale()` computes, and the
 * same product pdf.js's `getViewport({ scale: zoom })` applies internally.
 */
export function irToCssScale(meta: PdfPageMeta, zoom: number): number {
  return zoom * meta.userUnit;
}

/**
 * The page box in CSS pixels at zoom 1 — UNROUNDED, because the virtual list multiplies it by zoom
 * before rounding and rounding twice accumulates a pixel per page across 55 pages.
 */
export function pageUnitSize(meta: PdfPageMeta): { width: number; height: number } {
  return { width: meta.width * meta.userUnit, height: meta.height * meta.userUnit };
}

/**
 * The page box in CSS pixels at `zoom`, rounded once.
 *
 * Rounded HERE and nowhere else, so the canvas box, the text-layer box and the virtual list's
 * arithmetic offsets are the same integers. A half-pixel disagreement between them is invisible on
 * one page and a visible seam by page 20.
 */
export function pageCssSize(meta: PdfPageMeta, zoom: number): { width: number; height: number } {
  const unit = pageUnitSize(meta);
  return { width: Math.round(unit.width * zoom), height: Math.round(unit.height * zoom) };
}

function toBBox(view: readonly number[]): BBox {
  return [view[0] ?? 0, view[1] ?? 0, view[2] ?? 0, view[3] ?? 0];
}

function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error(typeof cause === 'string' ? cause : 'The PDF could not be opened.');
}

function describePage(page: PDFPageProxy): PdfPageMeta {
  const view = toBBox(page.view);
  // v3 has no `userUnit` at all and a malformed file can carry 0; either way 1 is the spec default.
  const rawUnit = (page as { userUnit?: number }).userUnit;
  const userUnit = typeof rawUnit === 'number' && Number.isFinite(rawUnit) && rawUnit > 0 ? rawUnit : 1;
  const frame = frameForPdfPage({ view, rotate: page.rotate, userUnit });
  return {
    index: page.pageNumber - 1,
    width: frame.width,
    height: frame.height,
    rotate: page.rotate,
    userUnit,
    view,
    frame,
  };
}

/** 16 pages at a time: enough to saturate the worker, few enough that a 900-page thesis stays responsive. */
const META_CHUNK = 16;

async function describeAllPages(
  doc: PDFDocumentProxy,
  isCancelled: () => boolean,
): Promise<Map<number, PdfPageMeta>> {
  const out = new Map<number, PdfPageMeta>();
  for (let start = 1; start <= doc.numPages; start += META_CHUNK) {
    if (isCancelled()) return out;
    const end = Math.min(doc.numPages, start + META_CHUNK - 1);
    const numbers: number[] = [];
    for (let n = start; n <= end; n += 1) numbers.push(n);
    const pages = await Promise.all(numbers.map((n) => doc.getPage(n)));
    for (const page of pages) out.set(page.pageNumber - 1, describePage(page));
  }
  return out;
}

interface LoadState {
  readonly pdf: PDFDocumentProxy | null;
  readonly numPages: number;
  readonly pageMeta: ReadonlyMap<number, PdfPageMeta>;
  readonly error: Error | null;
  readonly loading: boolean;
}

const IDLE: LoadState = {
  pdf: null,
  numPages: 0,
  pageMeta: EMPTY_META,
  error: null,
  loading: false,
};

export interface PdfDocumentProviderProps {
  /** `null` is a legitimate state — nothing is open yet — and is not an error. */
  readonly src: PdfSource | null;
  readonly children: ReactNode;
}

export function PdfDocumentProvider({ src, children }: PdfDocumentProviderProps): JSX.Element {
  const [state, setState] = useState<LoadState>(IDLE);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (src === null) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;

    setState({ pdf: null, numPages: 0, pageMeta: EMPTY_META, error: null, loading: true });

    void (async () => {
      try {
        const pdfjs = await getPdfjs();
        if (cancelled) return;

        task = pdfjs.getDocument(src);
        const doc = await task.promise;
        if (cancelled) return;

        const pageMeta = await describeAllPages(doc, () => cancelled);
        if (cancelled) return;

        setState({ pdf: doc, numPages: doc.numPages, pageMeta, error: null, loading: false });
      } catch (cause) {
        // A cancelled load rejects too; reporting that as an error would flash a failure screen on
        // every navigation away.
        if (cancelled) return;
        setState({
          pdf: null,
          numPages: 0,
          pageMeta: EMPTY_META,
          error: toError(cause),
          loading: false,
        });
      }
    })();

    return () => {
      cancelled = true;
      // `destroy()` tears down the worker and the transport; without it every reload leaks one.
      void task?.destroy().catch(() => undefined);
    };
  }, [src, attempt]);

  const value = useMemo<PdfDocumentValue>(
    () => ({
      pdf: state.pdf,
      numPages: state.numPages,
      pageMeta: state.pageMeta,
      error: state.error,
      loading: state.loading,
      reload,
    }),
    [state, reload],
  );

  return (
    <PdfDocumentContext.Provider value={value}>
      <PdfLayerStyles />
      {children}
    </PdfDocumentContext.Provider>
  );
}

/**
 * The pdf.js text-layer stylesheet, inlined.
 *
 * `pdfjs-dist/web/pdf_viewer.css` is 7000 lines of viewer chrome we do not use, and Next only
 * accepts global CSS imports from the root layout — which would make the reader's stylesheet a
 * dependency of every route. These are the rules the v5 `TextLayer` actually requires:
 *
 *   - spans are absolutely positioned at PERCENTAGES of the container, so the container box is the
 *     only thing that has to be right;
 *   - font size is `--total-scale-factor × --font-height`, so the scale vars must be set;
 *   - `setLayerDimensions` writes `round(down, calc(var(--total-scale-factor) * Npx),
 *     var(--scale-round-x))`, which is INVALID — and therefore silently `auto` — unless
 *     `--scale-round-x`/`-y` exist. That one is easy to miss and produces a text layer of the wrong
 *     size with no error;
 *   - `[data-main-rotation]` rotates the container, because `TextLayer` lays text out in the page's
 *     UNROTATED frame and expects CSS to turn it.
 */
function PdfLayerStyles(): JSX.Element {
  return <style>{TEXT_LAYER_CSS}</style>;
}

const TEXT_LAYER_CSS = `
.papertree-page {
  --scale-round-x: 1px;
  --scale-round-y: 1px;
  position: relative;
  overflow: hidden;
  direction: ltr;
  background-color: #fff;
}
.papertree-text-layer {
  position: absolute;
  top: 0;
  left: 0;
  text-align: initial;
  overflow: clip;
  line-height: 1;
  text-size-adjust: none;
  -webkit-text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 1;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.papertree-text-layer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
.papertree-text-layer > :not(.markedContent),
.papertree-text-layer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  --scale-x: 1;
  --rotate: 0deg;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.papertree-text-layer .markedContent { display: contents; }
.papertree-text-layer span[role="img"] { user-select: none; cursor: default; }
.papertree-text-layer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.papertree-text-layer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.papertree-text-layer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
.papertree-text-layer ::selection { background: rgb(59 130 246 / 0.35); }
`;
