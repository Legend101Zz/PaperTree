'use client';

/**
 * useInkInput — the pointer half of the ink tools (S5d, #209; RESEARCH-R2 §4). One inking pointer at
 * a time: its moves, with every coalesced sample where the browser offers them, are kept in a ref
 * (never React state) and the live stroke's ONE `<path>` is rewritten once per animation frame;
 * pen-up builds the stroke and hands it on as one history command. Where ink is shown and stored
 * while the open answer pushes the page down is `model/inkPlace`'s rule: the eraser hit-tests the
 * strokes where they are SHOWN, and a stroke cannot start in the band the answer opened. The eraser
 * hides what it touches at once and hands every stroke of the gesture on at pointer-up, so one undo
 * brings them all back. Palm rejection (`pointerRole`): once a pen has touched the page a finger
 * scrolls instead of inking, never while the pen is down, and a pen landing on a resting palm takes
 * over from it. The latch (`penSeen`) belongs to the page, not to this surface. The lasso draws its
 * dashed loop over the items and hands the loop on at pointer-up.
 */
import { useRef } from 'react';

import { newClientId } from '../api/notebookApi';
import { eraseStrokes } from '../model/hitTest';
import { inFold, storedPoints, strokesAsShown } from '../model/inkPlace';
import { loopPath } from '../model/lasso';
import { strokeToPath } from '../model/outline';
import { MAX_STROKE_POINTS } from '../model/stroke';
import { hasRealPressure, pointerRole } from '../model/tools';

import type { ExchangeShift } from '../model/layout';
import type { Vec2 } from '../model/page';
import type { Stroke, StrokeNib, StrokePoint, StrokeTool } from '../model/stroke';
import type { InkTool } from '../model/tools';
import type { MutableRefObject, PointerEvent, RefObject } from 'react';

/** What the ink surface needs to know, read at each event (so handlers never go stale). */
export interface InkInputOptions {
  readonly tool: InkTool;
  /** The pen or highlighter in the hand, with its nib and colour token; null for the eraser. */
  readonly pen: {
    readonly tool: StrokeTool;
    readonly nib: StrokeNib;
    readonly color: string;
  } | null;
  /** Screen px per page unit. */
  readonly scale: number;
  /** The page's strokes, as stored. */
  readonly strokes: readonly Stroke[];
  /** The open answer's push (`exchangeShift`): where ink is shown and stored (`model/inkPlace`). */
  readonly shift: ExchangeShift | null;
  /** The live stroke's path, in the items layer under the items. */
  readonly live: RefObject<SVGPathElement>;
  /** Palm rejection's latch: set once a pen touches the page, kept while the page is open. */
  readonly penSeen: MutableRefObject<boolean>;
  readonly onStroke: (stroke: Stroke) => void;
  readonly onErase: (ids: readonly string[]) => void;
  /** A stroke was begun in the band the open answer opened, where it has no place (`inFold`). */
  readonly onRefused?: () => void;
  /** The lasso's loop as it is drawn, over the items. */
  readonly lassoLive?: RefObject<SVGPathElement>;
  /** A lasso closed (its loop, in page units as shown), or a new one began (null). */
  readonly onLasso?: (path: readonly Vec2[] | null) => void;
}

/** The tool in the hand as the page is given it (`inkInHand`); the page adds the rest. */
export type InkInHand = Pick<
  InkInputOptions,
  'tool' | 'pen' | 'onStroke' | 'onErase' | 'penSeen' | 'onRefused'
> & {
  /** A lasso closed (or a new one began: null), with the page's scale and the answer's push. */
  readonly onLasso?: (
    path: readonly Vec2[] | null,
    view: Pick<InkInputOptions, 'scale' | 'shift'>,
  ) => void;
};

/** The handlers to spread on the ink surface. */
export interface InkHandlers {
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

interface Base {
  readonly id: number;
  /** `PointerEvent.pointerType`: a pen outranks a touch that got there first. */
  readonly type: string;
  readonly rect: DOMRect;
}
type Draw = Base & { kind: 'draw'; pressure: boolean; pts: StrokePoint[] };
type Erase = Base & {
  kind: 'erase';
  last: Vec2;
  hit: Set<string>;
  page: Element | null;
  /** The strokes where they are shown, taken at pointer-down. */
  shown: readonly Stroke[];
};
/** A lasso loop, in page units as shown. */
type Loop = Base & { kind: 'lasso'; pts: Vec2[] };
type Ink = Draw | Erase | Loop;
interface Pan {
  readonly id: number;
  x: number;
  y: number;
  readonly desk: Element | null;
}

/** A long scribble is cut into strokes from here, where the next piece can start (not in the band). */
const SPLIT_AT = MAX_STROKE_POINTS - 1000;

const at = (rect: DOMRect, e: { clientX: number; clientY: number }, scale: number): Vec2 => [
  (e.clientX - rect.left) / scale,
  (e.clientY - rect.top) / scale,
];

/**
 * Hides (or shows again) stored strokes by id, straight on the DOM: no render per eraser move.
 *
 * @param page - The page element the strokes are drawn in.
 * @param ids - The strokes.
 * @param hidden - True to hide them, false to show them again.
 */
function hide(page: Element | null, ids: Iterable<string>, hidden: boolean): void {
  for (const id of ids) {
    const path = page?.querySelector<SVGElement>(`[data-stroke-id="${id}"]`);
    if (hidden) path?.style.setProperty('visibility', 'hidden');
    else path?.style.removeProperty('visibility');
  }
}

/**
 * Sweeps the eraser from its last point to `to`, hiding every stroke it touches as shown.
 *
 * @param g - The eraser gesture (its hits grow).
 * @param to - Where the pointer is now, in page units as shown.
 * @param scale - Screen px per page unit (the eraser is a few px wide on screen).
 */
function sweep(g: Erase, to: Vec2, scale: number): void {
  const hits = eraseStrokes(g.shown, g.last, to, Math.max(2.25, 5 / scale));
  const fresh = hits.filter((id) => !g.hit.has(id));
  for (const id of fresh) g.hit.add(id);
  hide(g.page, fresh, true);
  g.last = to;
}

/**
 * A finger after a pen: it moves the desk, as a scroll would (`scrollBy` is not everywhere).
 *
 * @param g - The scroll.
 * @param e - The pointer's position now.
 */
function scroll(g: Pan, e: { clientX: number; clientY: number }): void {
  if (g.desk !== null) {
    g.desk.scrollLeft += g.x - e.clientX;
    g.desk.scrollTop += g.y - e.clientY;
  }
  [g.x, g.y] = [e.clientX, e.clientY];
}

/**
 * What an inking pointer that just went down starts: a lasso, an erase or a stroke; null for a
 * stroke begun where the open answer leaves it no place.
 *
 * @param e - The pointerdown.
 * @param o - The surface's options.
 * @returns The gesture, or null.
 */
function begin(e: PointerEvent<HTMLElement>, o: InkInputOptions): Ink | null {
  const el = e.currentTarget;
  const base = { id: e.pointerId, type: e.pointerType, rect: el.getBoundingClientRect() };
  const start = at(base.rect, e, o.scale);
  if (o.tool === 'lasso') {
    o.onLasso?.(null);
    return { ...base, kind: 'lasso', pts: [start] };
  }
  if (o.tool === 'eraser') {
    const shown = strokesAsShown(o.strokes, o.shift);
    const page = el.closest('.pt-nb-page');
    const erase: Erase = { ...base, kind: 'erase', last: start, hit: new Set(), page, shown };
    sweep(erase, start, o.scale);
    return erase;
  }
  if (inFold(start[1], o.shift)) return null;
  const pressure = hasRealPressure(e.pointerType, e.pressure);
  return { ...base, kind: 'draw', pressure, pts: [[...start, pressure ? e.pressure : 0.5]] };
}

/**
 * The ink surface's pointer handlers.
 *
 * @param options - Read at every event.
 * @returns Stable handlers.
 */
export function useInkInput(options: InkInputOptions): InkHandlers {
  const latest = useRef(options);
  latest.current = options;
  const ink = useRef<Ink | null>(null);
  const pan = useRef<Pan | null>(null);
  const frame = useRef<number | null>(null);
  const handlers = useRef<InkHandlers | null>(null);

  const paint = (): void => {
    frame.current = null;
    const [g, o] = [ink.current, latest.current];
    if (g?.kind === 'lasso') o.lassoLive?.current?.setAttribute('d', loopPath(g.pts));
    if (g?.kind !== 'draw' || o.pen === null) return;
    const live = { id: 'live', ...o.pen, hasPressure: g.pressure, points: g.pts };
    o.live.current?.setAttribute('d', strokeToPath(live, true));
  };
  const commit = (g: Draw): void => {
    const o = latest.current;
    const points = storedPoints(g.pts, o.shift);
    if (points === null || points.length === 0) return;
    const pen = o.pen ?? { tool: 'pen', nib: 'F', color: 'pen' };
    o.onStroke({ id: newClientId('ns'), ...pen, hasPressure: g.pressure, points });
  };
  const add = (g: Draw, ev: globalThis.PointerEvent): void => {
    const o = latest.current;
    const p = at(g.rect, ev, o.scale);
    const prev = g.pts.at(-1);
    if (prev !== undefined && prev[0] === p[0] && prev[1] === p[1]) return;
    // A piece never starts in the band the open answer opened (`inFold`), even after a cut.
    if (g.pts.length === 0 && inFold(p[1], o.shift)) return;
    g.pts.push([p[0], p[1], g.pressure ? ev.pressure : 0.5]);
    // A scribble longer than the encoder takes is stored as several strokes, never refused.
    const fold = inFold(p[1], o.shift);
    if (g.pts.length >= MAX_STROKE_POINTS || (g.pts.length >= SPLIT_AT && !fold)) {
      commit(g);
      g.pts = fold ? [] : g.pts.slice(-1);
    }
  };
  /**
   * Ends the inking gesture.
   *
   * @param g - The gesture.
   * @param keep - True to keep it (pen-up); false drops it (an eraser cancelled, a palm overruled).
   */
  const finish = (g: Ink, keep: boolean): void => {
    ink.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    latest.current.live.current?.setAttribute('d', '');
    latest.current.lassoLive?.current?.setAttribute('d', '');
    if (g.kind === 'draw') {
      if (keep) commit(g);
      return;
    }
    if (g.kind === 'lasso') {
      latest.current.onLasso?.(keep && g.pts.length >= 3 ? g.pts : null);
      return;
    }
    if (keep && g.hit.size > 0) latest.current.onErase([...g.hit]);
    // After the erase has rendered: whatever is still on the page (a cancel) shows again.
    requestAnimationFrame(() => hide(g.page, g.hit, false));
  };

  handlers.current ??= {
    onPointerDown: (e) => {
      const o = latest.current;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'pen') o.penSeen.current = true;
      e.preventDefault();
      if (pointerRole(e.pointerType, o.penSeen.current) === 'scroll') {
        // A finger after a pen scrolls the desk, but never while the pen is down: that is a palm.
        if (ink.current?.type !== 'pen' && pan.current === null) {
          const desk = e.currentTarget.closest('.pt-nb__desk');
          pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, desk };
        }
        return;
      }
      if (ink.current !== null) {
        // Only a pen landing where a palm got there first (before any pen was seen) takes over.
        if (e.pointerType !== 'pen' || ink.current.type !== 'touch') return;
        finish(ink.current, false);
      }
      pan.current = null; // a pen going down stops a resting hand from scrolling
      const g = begin(e, o);
      if (g === null) {
        o.onRefused?.();
        return;
      }
      e.currentTarget.setPointerCapture?.(e.pointerId);
      ink.current = g;
      paint();
    },
    onPointerMove: (e) => {
      const g = ink.current;
      if (g?.id === e.pointerId) {
        const native = e.nativeEvent;
        const samples = native.getCoalescedEvents?.() ?? [];
        for (const ev of samples.length > 0 ? samples : [native]) {
          const p = at(g.rect, ev, latest.current.scale);
          if (g.kind === 'erase') sweep(g, p, latest.current.scale);
          else if (g.kind === 'lasso') g.pts.push(p);
          else add(g, ev);
        }
        if (g.kind !== 'erase') frame.current ??= requestAnimationFrame(paint);
        return;
      }
      if (pan.current?.id === e.pointerId) scroll(pan.current, e);
    },
    onPointerUp: (e) => {
      if (ink.current?.id === e.pointerId) finish(ink.current, true);
      else if (pan.current?.id === e.pointerId) pan.current = null;
    },
    // A system gesture can cancel a pencil mid-stroke: the ink drawn so far is kept. A cancelled
    // erase erases nothing.
    onPointerCancel: (e) => {
      const g = ink.current;
      if (g?.id === e.pointerId) finish(g, g.kind === 'draw');
      else if (pan.current?.id === e.pointerId) pan.current = null;
    },
  };
  return handlers.current;
}
