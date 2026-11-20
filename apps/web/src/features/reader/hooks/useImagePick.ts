'use client';

/**
 * reader/useImagePick — picking a picture on a Source page (v0.3 #348, items 1, 2 and 7): a click on
 * a detected float selects it whole, the area tool (armed, or Alt held) draws a rectangle that can be
 * moved and resized, and Esc backs out one level at a time.
 *
 * THE POINTER PATTERN is `useHighlightClick`'s: the page overlay is `pointer-events: none` so it
 * never eats a text drag, and the page's own listeners decide here from the press itself, in IR
 * space (`closest('.papertree-page[data-page-index]')`, and the press offset divided by
 * `zoom x userUnit`). Nothing is measured from the DOM but the page's own box.
 *
 * THE SHIFT RULE (item 4). A figure and a paragraph are asked about together, so Shift keeps the
 * text selection when a float is picked and keeps the picked picture when text is selected. Without
 * Shift either one replaces the other.
 *
 * ESC, one level per press: a rectangle being drawn is dropped; else an armed tool is put away (the
 * rectangle it drew stays, with its menu); else the selection goes.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { floatAt, floatsOnPage, type PageFloat } from '../model/floats';
import { CLICK_SLOP_PX } from '../model/highlightClick';
import { pickOfArea, pickOfFloat, type ImagePick } from '../model/imagePick';
import {
  boxBetween,
  isArrow,
  isUsable,
  moveBox,
  nudgeBox,
  resizeBox,
  starterBox,
  type Handle,
  type PageSize,
} from '../model/imageRegion';
import { useImageTool } from './useImageTool';

import type { IndexedDocument } from '@papertree/anchoring';
import type { BBox } from '@papertree/document-ir';

/** A page as the pointer needs it. */
export interface PageGeometry extends PageSize {
  readonly userUnit: number;
}

/** What `useImagePick` needs. */
export interface UseImagePickArgs {
  readonly doc: IndexedDocument | null;
  /** The scroller that holds the pages, or null before it mounts. */
  readonly root: HTMLElement | null;
  readonly zoom: number;
  readonly pageOf: (pageIndex: number) => PageGeometry | null;
  /** A text selection is live. */
  readonly textSelected: boolean;
  /** Drops the text selection (and the DOM one with it). */
  readonly clearText: () => void;
  /** Is this point on a painted highlight? A click there opens the highlight, not the float. */
  readonly onHighlight: (pageIndex: number, x: number, y: number) => boolean;
  /** The page most in view, or -1: where a keyboard-armed tool puts its starter rectangle. */
  readonly currentPage: () => number;
}

/** A rectangle being drawn, and the page it is on. */
export interface Draft {
  readonly page: number;
  readonly box: BBox;
}

/** What the page layer draws and calls. */
export interface ImagePicking {
  readonly pick: ImagePick | null;
  readonly draft: Draft | null;
  /** The float under the pointer (its id and page), for the faint outline. */
  readonly hover: { readonly page: number; readonly id: string } | null;
  readonly armed: boolean;
  /** Bumps whenever a pick is made, so the layer can put focus on its frame. */
  readonly focusNonce: number;
  /** Selects a float (the keyboard's Enter); `keepText` keeps a live text selection beside it. */
  readonly pickFloat: (float: PageFloat, keepText: boolean) => void;
  /** Drops the selection and the text selection with it. */
  readonly clear: () => void;
  /** A press on the frame (`move`) or one of its handles. */
  readonly beginAdjust: (kind: 'move' | Handle, event: PointerEvent<HTMLElement>) => void;
  /** Arrow keys on the focused frame: nudge, and with Alt resize. */
  readonly onFrameKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/** What a page element says about itself. */
interface PageAt {
  readonly el: HTMLElement;
  readonly index: number;
}

function pageAt(target: EventTarget | null): PageAt | null {
  const el = target instanceof Element ? target.closest('.papertree-page[data-page-index]') : null;
  return el instanceof HTMLElement
    ? { el, index: Number(el.getAttribute('data-page-index')) }
    : null;
}

/** Things that act on the selection and must not be read as a press on the page. */
const OWN_UI = '[data-pt-imgui], [role="toolbar"]';

// A point on a page in IR points.
function pointOn(el: HTMLElement, scale: number, x: number, y: number): [number, number] {
  const rect = el.getBoundingClientRect();
  return [(x - rect.left) / scale, (y - rect.top) / scale];
}

/**
 * Picking floats and drawing areas on the Source pages.
 *
 * @param args The parse, the scroller, the zoom and how to reach the text selection.
 * @returns The pick, the draft and the gestures the page layer calls.
 */
export function useImagePick(args: UseImagePickArgs): ImagePicking {
  const tool = useImageTool();
  const [pick, setPick] = useState<ImagePick | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hover, setHover] = useState<ImagePicking['hover']>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const latest = useRef({ ...args, pick, tool });
  latest.current = { ...args, pick, tool };
  const drawing = useRef<{ page: PageAt; origin: [number, number]; size: PageSize } | null>(null);
  const shiftDown = useRef(false);
  const { root, textSelected } = args;
  const armed = tool?.armed === true;

  const made = useCallback((next: ImagePick): void => {
    setPick(next);
    setFocusNonce((n) => n + 1);
  }, []);
  const clear = useCallback((): void => {
    setPick(null);
    setDraft(null);
    latest.current.clearText();
  }, []);
  const pickFloat = useCallback(
    (float: PageFloat, keepText: boolean): void => {
      if (!keepText) latest.current.clearText();
      made(pickOfFloat(float));
    },
    [made],
  );

  // The tool is on: the pages say so (a cross-hair, no text selection starts under a drag).
  useEffect(() => {
    if (root === null || !armed) return undefined;
    root.setAttribute('data-pt-areatool', '');
    return () => root.removeAttribute('data-pt-areatool');
  }, [root, armed]);

  // The pointer: hover, a click on a float, a drag for a rectangle.
  useEffect(() => {
    if (root === null) return undefined;
    let down: { x: number; y: number } | null = null;
    const scaleOf = (index: number): number => {
      const page = latest.current.pageOf(index);
      return latest.current.zoom * (page?.userUnit ?? 1);
    };

    const onDown = (event: globalThis.PointerEvent): void => {
      shiftDown.current = event.shiftKey;
      down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
      if (down === null || (event.target instanceof Element && event.target.closest(OWN_UI))) {
        down = null;
        return;
      }
      const page = pageAt(event.target);
      const geometry = page === null ? null : latest.current.pageOf(page.index);
      if (page === null || geometry === null || latest.current.doc === null) return;
      if (latest.current.tool?.armed !== true && !event.altKey) return;
      latest.current.clearText();
      const scale = scaleOf(page.index);
      if (!(scale > 0)) return;
      const origin = pointOn(page.el, scale, event.clientX, event.clientY);
      drawing.current = { page, origin, size: geometry };
      setDraft({ page: page.index, box: boxBetween(origin, origin, geometry) });
      setHover(null);
    };
    // The text drag a press would start is the mousedown's default; the area tool takes the press.
    const onMouseDown = (event: MouseEvent): void => {
      if (drawing.current !== null) event.preventDefault();
    };
    const onMove = (event: globalThis.PointerEvent): void => {
      const now = drawing.current;
      if (now !== null) {
        const scale = scaleOf(now.page.index);
        const at = pointOn(now.page.el, scale, event.clientX, event.clientY);
        setDraft({ page: now.page.index, box: boxBetween(now.origin, at, now.size) });
        return;
      }
      if (event.buttons !== 0 || latest.current.tool?.armed === true) {
        setHover((was) => (was === null ? was : null));
        return;
      }
      const page = pageAt(event.target);
      const doc = latest.current.doc;
      let next: ImagePicking['hover'] = null;
      if (page !== null && doc !== null && !(event.target as Element).closest(OWN_UI)) {
        const scale = scaleOf(page.index);
        const [x, y] = pointOn(page.el, scale, event.clientX, event.clientY);
        const float = floatAt(floatsOnPage(doc, page.index), x, y);
        if (float !== null) next = { page: page.index, id: float.id };
      }
      setHover((was) => (was?.id === next?.id && was?.page === next?.page ? was : next));
    };
    const finish = (event: globalThis.PointerEvent): void => {
      const now = drawing.current;
      if (now === null) return;
      drawing.current = null;
      const scale = scaleOf(now.page.index);
      const box = boxBetween(
        now.origin,
        pointOn(now.page.el, scale, event.clientX, event.clientY),
        now.size,
      );
      setDraft(null);
      if (event.type === 'pointerup' && isUsable(box)) made(pickOfArea(now.page.index, box));
    };
    const onClick = (event: MouseEvent): void => {
      const press = down;
      down = null;
      const { doc, tool: t } = latest.current;
      // A click with no press (the keyboard's) is the float buttons' own; a drag is not a click.
      if (press === null || doc === null || event.detail > 1 || event.altKey) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) return;
      if (t?.armed === true) return;
      if (event.target instanceof Element && event.target.closest(OWN_UI)) return;
      const page = pageAt(event.target);
      if (page === null) return;
      const [x, y] = pointOn(page.el, scaleOf(page.index), event.clientX, event.clientY);
      const float = floatAt(floatsOnPage(doc, page.index), x, y);
      if (float !== null && !latest.current.onHighlight(page.index, x, y)) {
        pickFloat(float, event.shiftKey);
        return;
      }
      if (latest.current.pick !== null && !event.shiftKey) setPick(null);
    };
    const onLeave = (): void => setHover(null);

    root.addEventListener('pointerdown', onDown, true);
    root.addEventListener('mousedown', onMouseDown);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('click', onClick);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      root.removeEventListener('pointerdown', onDown, true);
      root.removeEventListener('mousedown', onMouseDown);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('click', onClick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [root, made, pickFloat]);

  // Words selected without Shift replace the picture; with Shift they ride with it (item 4).
  useEffect(() => {
    if (textSelected && latest.current.pick !== null && !shiftDown.current) setPick(null);
  }, [textSelected]);

  // The tool armed from the keyboard puts a rectangle in the middle of the page being read.
  const starter = tool?.starter ?? 0;
  useEffect(() => {
    if (starter === 0) return;
    const index = latest.current.currentPage();
    const page = index < 0 ? null : latest.current.pageOf(index);
    if (page !== null) made(pickOfArea(index, starterBox(page)));
  }, [starter, made]);

  // Esc, one level: a rectangle being drawn, then the armed tool, then the selection.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      if (drawing.current !== null) {
        drawing.current = null;
        setDraft(null);
      } else if (latest.current.tool?.armed === true) {
        latest.current.tool.disarm();
      } else if (latest.current.pick !== null) {
        clear();
      } else {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clear]);

  const beginAdjust = useCallback(
    (kind: 'move' | Handle, event: PointerEvent<HTMLElement>): void => {
      const start = latest.current.pick;
      if (start === null || start.origin !== 'area' || event.button !== 0) return;
      const geometry = latest.current.pageOf(start.page);
      if (geometry === null) return;
      event.preventDefault();
      event.stopPropagation();
      const scale = latest.current.zoom * geometry.userUnit;
      const from = { x: event.clientX, y: event.clientY };
      const onMove = (e: globalThis.PointerEvent): void => {
        const dx = (e.clientX - from.x) / scale;
        const dy = (e.clientY - from.y) / scale;
        const box =
          kind === 'move'
            ? moveBox(start.box, dx, dy, geometry)
            : resizeBox(start.box, kind, dx, dy, geometry);
        setPick({ ...start, box });
      };
      const end = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [],
  );

  const onFrameKeyDown = useCallback((event: KeyboardEvent<HTMLElement>): void => {
    const current = latest.current.pick;
    if (current === null || current.origin !== 'area' || !isArrow(event.key)) return;
    const geometry = latest.current.pageOf(current.page);
    if (geometry === null) return;
    event.preventDefault();
    const box = nudgeBox(
      current.box,
      event.key,
      { shift: event.shiftKey, alt: event.altKey },
      geometry,
    );
    setPick({ ...current, box });
  }, []);

  return { pick, draft, hover, armed, focusNonce, pickFloat, clear, beginAdjust, onFrameKeyDown };
}
