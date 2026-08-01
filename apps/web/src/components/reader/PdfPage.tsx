'use client';

/**
 * reader/PdfPage — one page: a canvas, pdf.js's text layer, and a slot for the highlight overlay.
 *
 * THE FOUR THINGS THIS FILE EXISTS TO GET RIGHT
 *
 * 1. `getViewport({ scale: z })` AND NOT `getViewport({ scale: z, rotation: 0 })`. In pdf.js the
 *    `rotation` argument is the ABSOLUTE rotation and defaults to `page.rotate`; passing 0 DISCARDS
 *    the page's `/Rotate`. IR space already has `/Rotate` applied, so the viewport that corresponds
 *    to IR space is the one with no rotation argument at all. See `anchoring/bridge.ts`.
 *
 * 2. DPR AND LAYOUT ARE SEPARATE. The backing store is `cssSize × dpr` device pixels; the CSS box is
 *    `irSize × zoom × userUnit` and knows nothing about dpr. If layout depended on dpr, the same
 *    document would lay out differently on a laptop and an external monitor, and every stored
 *    highlight would be a device-specific fiction — the v1 bug, in a new costume.
 *
 * 3. RENDERS ARE CANCELLED. `page.render()` returns a `RenderTask`; a zoom change while one is in
 *    flight leaves the old task painting into a canvas the new task has already resized, which
 *    reads as flicker and, on a reused canvas, as a page briefly showing the wrong content.
 *
 * 4. THE CANVAS IS SHRUNK TO 1×1 BEFORE IT IS DROPPED. Safari keeps canvas backing stores alive well
 *    past GC. At 55 pages × ~8 MB a scroll through a document is an iPad OOM. Setting `width` and
 *    `height` to 1 releases the store synchronously.
 *
 * WHAT THIS FILE NEVER DOES: measure. There is no `getBoundingClientRect`, no `offsetWidth`, no
 * `getClientRects`. Every number comes from `PdfPageMeta` and `zoom`.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { RenderTask } from 'pdfjs-dist';

import type { BBox } from '@papertree/document-ir';

import { getPdfjs } from '@/lib/pdf/worker';

import { alignedItems } from './stampTextLayer';


import {
  irToCssScale,
  pageCssSize,
  usePdfDocument,
  type PdfPageMeta,
} from './PdfDocumentProvider';

/**
 * ~16 megapixels. Above this Safari on iOS silently hands back a blank canvas rather than throwing,
 * so the failure mode of NOT clamping is an invisible page with no error anywhere.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

export interface PdfPageProps {
  /** 0-based. */
  readonly pageIndex: number;
  readonly zoom: number;
  /**
   * The highlight-overlay slot. Rendered above the canvas and the text layer in a box whose CSS
   * size is the page's, with `--papertree-ir-scale` set to the IR-points→CSS-pixels scalar so the
   * overlay can be built at scale 1 and composited with `transform: scale(var(--papertree-ir-scale))`.
   *
   * The slot itself is `pointer-events: none` so it cannot eat text selection; overlay elements
   * that need taps opt back in with `pointer-events: auto`.
   */
  readonly children?: ReactNode;
  /** Off for thumbnails and print, where nothing selects text and the divs cost real time. */
  readonly textLayer?: boolean;
  readonly className?: string;
  readonly onRenderError?: (error: Error) => void;
  /**
   * Called once per successful text-layer build, with the divs and the items they were built from.
   *
   * The reader shell uses it to stamp `data-block-id`/`data-cp-start` (`stampTextLayer`). It lives
   * here rather than in this file because the mapping needs the IR and this file deliberately does
   * not have it: `PdfPage` renders a PDF, and a page component that knew about PaperIR blocks would
   * be a second place the two coordinate systems meet. `anchoring/bridge.ts` is the only one.
   */
  readonly onTextLayer?: (info: TextLayerInfo) => void;
}

/** What `onTextLayer` hands back. Everything needed to map items to blocks, and nothing measured. */
export interface TextLayerInfo {
  readonly pageIndex: number;
  /** `TextLayer.textDivs`, render order. */
  readonly divs: readonly HTMLElement[];
  /** The items those divs were built from, `str`-defined only — index-aligned with `divs`. */
  readonly items: readonly { readonly str: string; readonly transform: readonly number[] }[];
  readonly viewport: { convertToPdfPoint(x: number, y: number): number[] };
  /** `PDFPageProxy.view` / `.rotate`. Raw PDF space; `bridge.ts` turns them into an IR frame. */
  readonly page: { readonly view: BBox; readonly rotate: number };
}

/** The v5 `TextLayer` instance surface this uses. Deliberately not the pdf.js type. */
interface TextLayerHandle {
  render(): Promise<unknown>;
  cancel(): void;
  /** v5 only. Absent on the v3 fallback path, which is why `onTextLayer` is not fired there. */
  readonly textDivs?: HTMLElement[];
}

/** v3's free function, kept as a fallback so a version downgrade degrades instead of crashing. */
interface LegacyTextLayerTask {
  promise: Promise<void>;
  cancel(): void;
}

interface PdfjsTextLayerApi {
  readonly TextLayer?: new (args: {
    textContentSource: ReadableStream | unknown;
    container: HTMLElement;
    viewport: unknown;
  }) => TextLayerHandle;
  readonly renderTextLayer?: (args: {
    textContentSource: ReadableStream | unknown;
    container: HTMLElement;
    viewport: unknown;
  }) => LegacyTextLayerTask;
}

/**
 * The device pixel ratio, as state rather than a read at paint time.
 *
 * Read at paint time it would be a per-frame measurement of the environment, and dragging a window
 * between a Retina and a non-Retina display would leave every mounted page rendered at the old
 * ratio until something else happened to re-render it. `matchMedia('(resolution: Xdppx)')` fires
 * exactly on that transition and nothing else.
 */
function useDevicePixelRatio(): number {
  // 1 on the server and on the first client render, so hydration matches; the effect corrects it.
  const [dpr, setDpr] = useState(1);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const current = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    if (current !== dpr) setDpr(current);
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(`(resolution: ${current}dppx)`);
    const onChange = (): void => {
      setDpr(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [dpr]);

  return dpr;
}

/**
 * Device pixels per CSS pixel for the backing store, clamped so the store stays under
 * `MAX_CANVAS_PIXELS`.
 *
 * Clamped by AREA and not by either dimension: a page at 400% is over budget in total while both
 * of its sides are individually unremarkable, and `sqrt` is the factor that brings the product back
 * to the cap while keeping the aspect ratio.
 */
export function backingScale(cssWidth: number, cssHeight: number, dpr: number): number {
  const wanted = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const area = cssWidth * cssHeight * wanted * wanted;
  if (!Number.isFinite(area) || area <= 0) return wanted;
  if (area <= MAX_CANVAS_PIXELS) return wanted;
  return wanted * Math.sqrt(MAX_CANVAS_PIXELS / area);
}

export function PdfPage({
  pageIndex,
  zoom,
  children,
  textLayer = true,
  className,
  onRenderError,
  onTextLayer,
}: PdfPageProps): JSX.Element {
  const { pdf, pageMeta } = usePdfDocument();
  const meta = pageMeta.get(pageIndex) ?? null;
  const dpr = useDevicePixelRatio();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  // Held in a ref rather than listed as a dependency: callers pass an inline lambda, and a lambda
  // in the dependency list would re-run — and therefore re-raster — the page on every render.
  const onRenderErrorRef = useRef(onRenderError);
  onRenderErrorRef.current = onRenderError;
  const onTextLayerRef = useRef(onTextLayer);
  onTextLayerRef.current = onTextLayer;

  const css = meta === null ? { width: 0, height: 0 } : pageCssSize(meta, zoom);
  const irScale = meta === null ? zoom : irToCssScale(meta, zoom);
  const backing = backingScale(css.width, css.height, dpr);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (pdf === null || meta === null || canvas === null) return;
    if (css.width <= 0 || css.height <= 0) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let text: TextLayerHandle | LegacyTextLayerTask | null = null;

    void (async () => {
      try {
        const pdfjs = await getPdfjs();
        if (cancelled) return;
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled) return;

        // NO `rotation` ARGUMENT. See the header — passing one discards the page's own /Rotate.
        const cssViewport = page.getViewport({ scale: zoom });
        const renderViewport = page.getViewport({ scale: zoom * backing });

        canvas.width = Math.max(1, Math.round(renderViewport.width));
        canvas.height = Math.max(1, Math.round(renderViewport.height));
        canvas.style.width = `${css.width}px`;
        canvas.style.height = `${css.height}px`;

        renderTask = page.render({ canvas, viewport: renderViewport });
        await renderTask.promise;
        if (cancelled) return;

        const container = textLayerRef.current;
        if (!textLayer || container === null) return;

        // Re-rendering appends; without this a zoom change doubles every span.
        container.replaceChildren();

        // `TextLayer` lays text out in the page's UNROTATED frame and expects CSS to turn the
        // container, so the box is the CSS page box with its axes exchanged at 90°/270°.
        const swapped = normaliseRotation(meta.rotate) % 180 !== 0;
        container.style.width = `${swapped ? css.height : css.width}px`;
        container.style.height = `${swapped ? css.width : css.height}px`;

        const api = pdfjs as unknown as PdfjsTextLayerApi;

        // `getTextContent()` AND NOT `streamTextContent()`. `TextLayer` accepts either, but the
        // stream is consumed by the layer and its items are then unreachable — and the items are
        // exactly what `stampTextLayer` needs, because a div carries only glyphs while an item
        // carries the text matrix those glyphs were placed by. Handing the SAME resolved object to
        // the layer is what guarantees the two views cannot disagree; re-fetching afterwards would
        // be a second extraction, and `Anchor.textStreamId` exists because two extractions of one
        // document are not required to agree.
        const content = await page.getTextContent();
        if (cancelled) return;

        if (typeof api.TextLayer === 'function') {
          const layer = new api.TextLayer({
            textContentSource: content,
            container,
            viewport: cssViewport,
          });
          text = layer;
          await layer.render();
          if (cancelled) return;

          const divs = layer.textDivs;
          if (divs !== undefined) {
            onTextLayerRef.current?.({
              pageIndex,
              divs,
              items: alignedItems(content.items as readonly { str?: string }[]) as TextLayerInfo['items'],
              viewport: cssViewport as unknown as TextLayerInfo['viewport'],
              page: { view: page.view as BBox, rotate: page.rotate },
            });
          }
        } else if (typeof api.renderTextLayer === 'function') {
          const task = api.renderTextLayer({
            textContentSource: content,
            container,
            viewport: cssViewport,
          });
          text = task;
          await task.promise;
        }
      } catch (cause) {
        // A cancelled render and a cancelled text layer both reject. Neither is a failure.
        if (cancelled) return;
        if (isCancellation(cause)) return;
        onRenderErrorRef.current?.(cause instanceof Error ? cause : new Error(String(cause)));
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      text?.cancel();
    };
    // `css.width`/`css.height` rather than `zoom` alone: they are what the canvas is sized from, and
    // they change on zoom, on userUnit and on a page swap, which is exactly when a re-render is due.
  }, [pdf, pageIndex, meta, zoom, backing, css.width, css.height, textLayer]);

  useEffect(() => {
    // Declared AFTER the render effect so React runs this cleanup second — the render task must be
    // cancelled before the canvas it is painting into is shrunk out from under it.
    const canvas = canvasRef.current;
    return () => {
      if (canvas === null) return;
      canvas.width = 1;
      canvas.height = 1;
    };
  }, []);

  // `CSSProperties` has no index signature, so the custom properties are declared on a widened
  // alias rather than cast away one at a time.
  const pageStyle: CSSProperties & Record<string, string | number> = {
    width: `${css.width}px`,
    height: `${css.height}px`,
    // The IR-points → CSS-pixels scalar, published for the highlight overlay. `zoom × userUnit`.
    '--papertree-ir-scale': `${irScale}`,
    // pdf.js's own names: `TextLayer` sizes its container and its fonts from these.
    '--scale-factor': `${zoom}`,
    '--user-unit': `${meta?.userUnit ?? 1}`,
    '--total-scale-factor': `${irScale}`,
  };

  return (
    <div className={joinClasses('papertree-page', className)} data-page-index={pageIndex} style={pageStyle}>
      <canvas
        ref={canvasRef}
        role="presentation"
        className="absolute left-0 top-0 block"
        style={{ width: `${css.width}px`, height: `${css.height}px` }}
      />
      {textLayer ? (
        <div
          ref={textLayerRef}
          className="papertree-text-layer"
          data-main-rotation={normaliseRotation(meta?.rotate ?? 0)}
        />
      ) : null}
      <div
        className="absolute left-0 top-0"
        style={{ width: `${css.width}px`, height: `${css.height}px`, pointerEvents: 'none', zIndex: 2 }}
        data-papertree-overlay-slot=""
      >
        {children}
      </div>
    </div>
  );
}

function joinClasses(...values: readonly (string | undefined)[]): string {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0).join(' ');
}

/** `/Rotate` is any multiple of 90, positive or negative; pdf.js's `data-main-rotation` wants 0–270. */
function normaliseRotation(rotate: number): number {
  return (((rotate % 360) + 360) % 360);
}

/** pdf.js signals cancellation by name, not by type, and the names differ between layers. */
function isCancellation(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const name = (cause as { name?: unknown }).name;
  return name === 'RenderingCancelledException' || name === 'AbortException';
}
