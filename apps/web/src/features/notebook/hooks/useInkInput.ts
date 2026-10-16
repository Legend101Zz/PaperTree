'use client';

/**
 * useInkInput — the pointer half of the ink tools (S5d, #209; RESEARCH-R2 §4). One pointer at a
 * time: its moves, with every coalesced sample where the browser offers them, are kept in a ref
 * (never React state) and the live stroke's ONE `<path>` is rewritten once per animation frame;
 * pen-up builds the stroke and hands it on as one history command. The eraser hides what it
 * touches at once and hands every stroke of the gesture on at pointer-up, so one undo brings them
 * all back. Palm rejection is `pointerRole`: once a pen has touched the page, a finger scrolls the
 * desk instead of inking.
 */
import { useRef } from 'react';

import { newClientId } from '../api/notebookApi';
import { eraseStrokes } from '../model/hitTest';
import { strokeToPath } from '../model/outline';
import { MAX_STROKE_POINTS } from '../model/stroke';
import { hasRealPressure, pointerRole } from '../model/tools';

import type { Vec2 } from '../model/page';
import type { Stroke, StrokeNib, StrokePoint, StrokeTool } from '../model/stroke';
import type { InkTool } from '../model/tools';
import type { PointerEvent, RefObject } from 'react';

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
  readonly strokes: readonly Stroke[];
  /** The open answer's push (`exchangeShift`): ink drawn below it is stored where it will sit. */
  readonly shift: { readonly boundary: number; readonly extra: number } | null;
  /** The live stroke's path, in the items layer under the items. */
  readonly live: RefObject<SVGPathElement>;
  readonly onStroke: (stroke: Stroke) => void;
  readonly onErase: (ids: readonly string[]) => void;
}

/** The handlers to spread on the ink surface. */
export interface InkHandlers {
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

type Gesture =
  | { kind: 'draw'; id: number; rect: DOMRect; pressure: boolean; pts: StrokePoint[] }
  | { kind: 'erase'; id: number; rect: DOMRect; last: Vec2; hit: Set<string>; page: Element | null }
  | { kind: 'scroll'; id: number; x: number; y: number; desk: Element | null };

/**
 * A stroke from the points as drawn: ink drawn below the open answer is stored where it sits once
 * the answer closes, so it stays beside the card it was written next to.
 *
 * @param pts - Points in the items layer's units, as on screen.
 * @param options - The tool's settings and the answer's push.
 * @param pressure - Whether the points carry real pressure.
 * @returns The stroke, with a client-minted id.
 */
function strokeFrom(pts: StrokePoint[], options: InkInputOptions, pressure: boolean): Stroke {
  const pen = options.pen ?? { tool: 'pen', nib: 'F', color: 'pen' };
  const top = Math.min(...pts.map((p) => p[1]));
  const s = options.shift;
  const dy = s !== null && s.extra > 0 && top >= s.boundary + s.extra ? s.extra : 0;
  const points = dy === 0 ? pts : pts.map(([x, y, p]) => [x, y - dy, p] as const);
  return { id: newClientId('ns'), ...pen, hasPressure: pressure, points };
}

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
 * Sweeps the eraser from its last point to `to`, hiding every stroke it touches.
 *
 * @param g - The eraser gesture (its hits grow).
 * @param to - Where the pointer is now, in page units.
 * @param o - The surface's options (the strokes, the scale).
 */
function sweep(g: Extract<Gesture, { kind: 'erase' }>, to: Vec2, o: InkInputOptions): void {
  const hits = eraseStrokes(o.strokes, g.last, to, Math.max(2.25, 5 / o.scale));
  const fresh = hits.filter((id) => !g.hit.has(id));
  for (const id of fresh) g.hit.add(id);
  hide(g.page, fresh, true);
  g.last = to;
}

/**
 * A finger after a pen: it moves the desk, as a scroll would (`scrollBy` is not everywhere).
 *
 * @param g - The scroll gesture.
 * @param e - The pointer's position now.
 */
function scroll(g: Extract<Gesture, { kind: 'scroll' }>, e: { clientX: number; clientY: number }) {
  if (g.desk !== null) {
    g.desk.scrollLeft += g.x - e.clientX;
    g.desk.scrollTop += g.y - e.clientY;
  }
  [g.x, g.y] = [e.clientX, e.clientY];
}

/**
 * What a pointer that just went down on the surface starts: a scroll, an erase or a stroke.
 *
 * @param e - The pointerdown.
 * @param o - The surface's options.
 * @param penSeen - Whether a pen has touched the page (palm rejection).
 * @returns The gesture.
 */
function begin(e: PointerEvent<HTMLElement>, o: InkInputOptions, penSeen: boolean): Gesture {
  const el = e.currentTarget;
  const [rect, id] = [el.getBoundingClientRect(), e.pointerId];
  if (pointerRole(e.pointerType, penSeen) === 'scroll') {
    return { kind: 'scroll', id, x: e.clientX, y: e.clientY, desk: el.closest('.pt-nb__desk') };
  }
  if (o.tool === 'eraser') {
    const last = at(rect, e, o.scale);
    const page = el.closest('.pt-nb-page');
    const erase: Gesture = { kind: 'erase', id, rect, last, hit: new Set<string>(), page };
    sweep(erase, last, o);
    return erase;
  }
  const pressure = hasRealPressure(e.pointerType, e.pressure);
  const [x, y] = at(rect, e, o.scale);
  return { kind: 'draw', id, rect, pressure, pts: [[x, y, pressure ? e.pressure : 0.5]] };
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
  const gesture = useRef<Gesture | null>(null);
  const penSeen = useRef(false);
  const frame = useRef<number | null>(null);
  const handlers = useRef<InkHandlers | null>(null);

  const paint = (): void => {
    frame.current = null;
    const [g, o] = [gesture.current, latest.current];
    if (g?.kind !== 'draw' || o.pen === null) return;
    const live = { id: 'live', ...o.pen, hasPressure: g.pressure, points: g.pts };
    o.live.current?.setAttribute('d', strokeToPath(live, true));
  };
  const commit = (g: Extract<Gesture, { kind: 'draw' }>): void => {
    if (g.pts.length > 0) latest.current.onStroke(strokeFrom(g.pts, latest.current, g.pressure));
  };
  const add = (g: Extract<Gesture, { kind: 'draw' }>, ev: globalThis.PointerEvent): void => {
    const p = at(g.rect, ev, latest.current.scale);
    const prev = g.pts.at(-1);
    if (prev !== undefined && prev[0] === p[0] && prev[1] === p[1]) return;
    g.pts.push([p[0], p[1], g.pressure ? ev.pressure : 0.5]);
    // A scribble longer than the encoder takes is stored as two strokes, never refused.
    if (g.pts.length >= MAX_STROKE_POINTS) {
      commit(g);
      g.pts = g.pts.slice(-1);
    }
  };
  const end = (e: PointerEvent<HTMLElement>, keep: boolean): void => {
    const g = gesture.current;
    if (g?.id !== e.pointerId) return;
    gesture.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    latest.current.live.current?.setAttribute('d', '');
    if (g.kind === 'draw' && keep) commit(g);
    if (g.kind !== 'erase') return;
    if (keep && g.hit.size > 0) latest.current.onErase([...g.hit]);
    // After the erase has rendered: whatever is still on the page (a cancel) shows again.
    requestAnimationFrame(() => hide(g.page, g.hit, false));
  };

  handlers.current ??= {
    onPointerDown: (e) => {
      if (gesture.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.pointerType === 'pen') penSeen.current = true;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      gesture.current = begin(e, latest.current, penSeen.current);
      paint();
    },
    onPointerMove: (e) => {
      const g = gesture.current;
      if (g?.id !== e.pointerId) return;
      if (g.kind === 'scroll') {
        scroll(g, e);
        return;
      }
      const native = e.nativeEvent;
      const samples = native.getCoalescedEvents?.() ?? [];
      for (const ev of samples.length > 0 ? samples : [native]) {
        if (g.kind === 'erase') sweep(g, at(g.rect, ev, latest.current.scale), latest.current);
        else add(g, ev);
      }
      if (g.kind === 'draw') frame.current ??= requestAnimationFrame(paint);
    },
    onPointerUp: (e) => end(e, true),
    onPointerCancel: (e) => end(e, false),
  };
  return handlers.current;
}
