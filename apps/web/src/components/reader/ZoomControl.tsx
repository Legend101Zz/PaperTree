'use client';

/**
 * reader/ZoomControl — real zoom, not a CSS width slider.
 *
 * THE DIFFERENCE MATTERS AND IT IS NOT COSMETIC. A width slider stretches an already-rasterised
 * canvas, so 200% is a 100% render blown up: text goes soft exactly when the reader zoomed in to
 * read it. Real zoom changes the scale passed to `page.getViewport()`, so the page is re-rastered
 * at the new size and stays sharp. It also means the zoom scalar is the SAME number the highlight
 * overlay composites with, which is what keeps highlights on the words they were drawn on.
 *
 * FIT MODES ARE MODES, NOT SCALES. "Fit width" that resolves to a number once and is stored as
 * `1.37` stops fitting the moment the window is resized. The mode is kept, and `resolveZoom` turns
 * it into a scalar again on every resize.
 *
 * TOUCH. Every control is at least 44×44 CSS px. Presses are Pointer Events plus explicit
 * Enter/Space handling — `onClick` alone would be mouse-shaped, and `onPointerDown` alone would be
 * unreachable from a keyboard. Nothing here is hover-only.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type PointerEventHandler,
} from 'react';

export type ZoomMode =
  | { readonly kind: 'scale'; readonly scale: number }
  | { readonly kind: 'fit-width' }
  | { readonly kind: 'fit-page' };

export const ZOOM_PRESETS: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 4];
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;

export const FIT_WIDTH: ZoomMode = { kind: 'fit-width' };
export const FIT_PAGE: ZoomMode = { kind: 'fit-page' };

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Quantised to whole percents so a pinch does not produce 1.0000000000000002 and re-render forever. */
export function quantiseZoom(scale: number): number {
  return Math.round(clampZoom(scale) * 100) / 100;
}

export interface FitContext {
  /** The reference page's IR-space size, in points. `/UserUnit` NOT applied. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** The page's `/UserUnit`, so a fit mode lands on the same CSS box the renderer will draw. */
  readonly userUnit?: number;
  readonly containerWidth: number;
  readonly containerHeight: number;
  /** Gutter left around the page so it never touches the scroller's edge. */
  readonly padding?: number;
}

/**
 * A mode plus the current container to a zoom scalar.
 *
 * The container size is the ONE thing here that genuinely has to be measured — it is the browser
 * window, not the document — and it is measured by the scroller's ResizeObserver on resize, never
 * per frame. Page geometry comes from the IR.
 */
export function resolveZoom(mode: ZoomMode, fit: FitContext): number {
  if (mode.kind === 'scale') return clampZoom(mode.scale);

  const padding = fit.padding ?? 24;
  const unit = fit.userUnit ?? 1;
  const cssPageWidth = fit.pageWidth * unit;
  const cssPageHeight = fit.pageHeight * unit;
  if (cssPageWidth <= 0 || cssPageHeight <= 0) return 1;

  const availableWidth = Math.max(1, fit.containerWidth - padding * 2);
  if (mode.kind === 'fit-width') return quantiseZoom(availableWidth / cssPageWidth);

  const availableHeight = Math.max(1, fit.containerHeight - padding * 2);
  return quantiseZoom(Math.min(availableWidth / cssPageWidth, availableHeight / cssPageHeight));
}

/** The next preset strictly above `scale`, or `MAX_ZOOM`. */
export function nextZoomUp(scale: number): number {
  for (const preset of ZOOM_PRESETS) if (preset > scale + 1e-6) return preset;
  return MAX_ZOOM;
}

/** The next preset strictly below `scale`, or `MIN_ZOOM`. */
export function nextZoomDown(scale: number): number {
  for (let i = ZOOM_PRESETS.length - 1; i >= 0; i -= 1) {
    const preset = ZOOM_PRESETS[i] as number;
    if (preset < scale - 1e-6) return preset;
  }
  return MIN_ZOOM;
}

/* ────────────────────────────── pinch ────────────────────────────── */

export interface PinchZoomState {
  readonly pinching: boolean;
  readonly surfaceProps: {
    readonly onPointerDown: PointerEventHandler<HTMLElement>;
    readonly onPointerMove: PointerEventHandler<HTMLElement>;
    readonly onPointerUp: PointerEventHandler<HTMLElement>;
    readonly onPointerCancel: PointerEventHandler<HTMLElement>;
    readonly style: CSSProperties;
  };
}

export interface UsePinchZoomArgs {
  /** The zoom in force right now, used as the gesture's baseline. */
  readonly zoom: number;
  /** `centre` is in client coordinates, for callers that want to keep the focal point still. */
  readonly onZoom: (scale: number, centre: { x: number; y: number }) => void;
  readonly disabled?: boolean;
}

/**
 * Two-pointer pinch, from Pointer Events only.
 *
 * NOT TouchEvents: Pointer Events are the one input model that covers a trackpad, a stylus and two
 * fingers with the same code, and `pointercancel` is the only reliable signal that the browser has
 * taken the gesture over.
 *
 * `touch-action` is set EXPLICITLY and it changes mid-gesture on purpose. At rest the surface is
 * `pan-y`: native vertical scrolling stays with the compositor (where it is smooth), while the
 * browser's own pinch-zoom is disallowed, so both pointers are delivered to us instead of being
 * swallowed. Once a second pointer is down the surface goes to `none` for the rest of the gesture
 * so a slight vertical drift during the pinch does not also scroll the document.
 */
export function usePinchZoom({ zoom, onZoom, disabled = false }: UsePinchZoomArgs): PinchZoomState {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const base = useRef<{ distance: number; zoom: number } | null>(null);
  const [pinching, setPinching] = useState(false);

  const distance = useCallback((): number => {
    const [a, b] = Array.from(pointers.current.values());
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }, []);

  const centre = useCallback((): { x: number; y: number } => {
    const [a, b] = Array.from(pointers.current.values());
    if (a === undefined || b === undefined) return { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2) {
        base.current = { distance: distance(), zoom };
        setPinching(true);
      }
    },
    [disabled, distance, zoom],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled) return;
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const start = base.current;
      if (start === null || pointers.current.size !== 2) return;
      const now = distance();
      if (start.distance <= 0 || now <= 0) return;
      const next = quantiseZoom(start.zoom * (now / start.distance));
      onZoom(next, centre());
    },
    [disabled, distance, centre, onZoom],
  );

  const release = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2 && base.current !== null) {
      base.current = null;
      setPinching(false);
    }
  }, []);

  return {
    pinching,
    surfaceProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: release,
      onPointerCancel: release,
      style: { touchAction: pinching ? 'none' : 'pan-y' },
    },
  };
}

/* ────────────────────────────── the control ────────────────────────────── */

/**
 * Press handlers for a control that must answer to a finger, a mouse and a keyboard.
 *
 * `onPointerDown` fires on the down stroke, which is what makes a tap feel immediate on touch;
 * `onKeyDown` covers Enter and Space, which `onPointerDown` alone would lose. `onClick` is
 * deliberately absent — with `onPointerDown` already firing it would double every activation.
 */
function pressHandlers(action: () => void): {
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
} {
  return {
    onPointerDown: (event) => {
      // Keep the press from stealing the text selection, but restore the focus it would have given.
      event.preventDefault();
      event.currentTarget.focus();
      action();
    },
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      action();
    },
  };
}

const BUTTON_CLASS =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border ' +
  'border-neutral-300 bg-white px-2 text-sm font-medium text-neutral-800 ' +
  'disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-blue-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';

const ACTIVE_CLASS = 'border-blue-600 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200';

export interface ZoomControlProps {
  readonly mode: ZoomMode;
  /** The resolved scalar — what a fit mode currently works out to. */
  readonly zoom: number;
  readonly onModeChange: (mode: ZoomMode) => void;
  readonly className?: string;
}

export function ZoomControl({ mode, zoom, onModeChange, className }: ZoomControlProps): JSX.Element {
  const percent = Math.round(zoom * 100);

  const setScale = useCallback(
    (scale: number) => onModeChange({ kind: 'scale', scale: quantiseZoom(scale) }),
    [onModeChange],
  );

  const zoomOut = useMemo(() => pressHandlers(() => setScale(nextZoomDown(zoom))), [setScale, zoom]);
  const zoomIn = useMemo(() => pressHandlers(() => setScale(nextZoomUp(zoom))), [setScale, zoom]);
  const fitWidth = useMemo(() => pressHandlers(() => onModeChange(FIT_WIDTH)), [onModeChange]);
  const fitPage = useMemo(() => pressHandlers(() => onModeChange(FIT_PAGE)), [onModeChange]);

  // A native <select> rather than a bespoke menu: it is keyboard- and screen-reader-correct for
  // free, and on touch it opens the platform picker instead of a 20px-tall dropdown.
  const selectValue =
    mode.kind === 'scale'
      ? ZOOM_PRESETS.includes(quantiseZoom(mode.scale))
        ? String(quantiseZoom(mode.scale))
        : 'custom'
      : mode.kind;

  return (
    <div
      className={joinClasses('flex items-center gap-1', className)}
      role="group"
      aria-label="Zoom"
      style={{ touchAction: 'manipulation' }}
    >
      <button
        type="button"
        className={BUTTON_CLASS}
        aria-label="Zoom out"
        disabled={zoom <= MIN_ZOOM + 1e-6}
        {...zoomOut}
      >
        <span aria-hidden="true">&minus;</span>
      </button>

      <label className="sr-only" htmlFor="papertree-zoom-select">
        Zoom level
      </label>
      <select
        id="papertree-zoom-select"
        className={joinClasses(BUTTON_CLASS, 'px-3')}
        value={selectValue}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'fit-width') onModeChange(FIT_WIDTH);
          else if (value === 'fit-page') onModeChange(FIT_PAGE);
          else if (value !== 'custom') setScale(Number(value));
        }}
      >
        {ZOOM_PRESETS.map((preset) => (
          <option key={preset} value={String(preset)}>
            {Math.round(preset * 100)}%
          </option>
        ))}
        <option value="fit-width">Fit width</option>
        <option value="fit-page">Fit page</option>
        {selectValue === 'custom' ? <option value="custom">{percent}%</option> : null}
      </select>

      <button
        type="button"
        className={BUTTON_CLASS}
        aria-label="Zoom in"
        disabled={zoom >= MAX_ZOOM - 1e-6}
        {...zoomIn}
      >
        <span aria-hidden="true">+</span>
      </button>

      <button
        type="button"
        className={joinClasses(BUTTON_CLASS, mode.kind === 'fit-width' ? ACTIVE_CLASS : undefined)}
        aria-label="Fit width"
        aria-pressed={mode.kind === 'fit-width'}
        {...fitWidth}
      >
        Width
      </button>
      <button
        type="button"
        className={joinClasses(BUTTON_CLASS, mode.kind === 'fit-page' ? ACTIVE_CLASS : undefined)}
        aria-label="Fit page"
        aria-pressed={mode.kind === 'fit-page'}
        {...fitPage}
      >
        Page
      </button>

      {/* A live region, not a tooltip: the current zoom must be readable without hovering. */}
      <output className="min-w-[52px] px-1 text-sm tabular-nums text-neutral-600 dark:text-neutral-300" aria-live="polite">
        {percent}%
      </output>
    </div>
  );
}

function joinClasses(...values: readonly (string | undefined)[]): string {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0).join(' ');
}
