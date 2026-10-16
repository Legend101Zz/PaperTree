/**
 * The notebook's page coordinate model (S5b, #207). Ink and typed blocks both live in fixed
 * "page units", so a resize, a font load or a tablet/phone viewport only changes one scale
 * factor and ink never drifts against the blocks it was drawn next to (RESEARCH-R2 section 6).
 * S5c/S5d render `Item`s; this file owns where they are and how page units map to the screen.
 */

import type { Anchor } from '@papertree/anchoring';

/**
 * Logical page width in page units. 960 = 40 cells of the design's 24 px dot grid
 * (frame 05-notebook-1440), so grid lines land on whole units, and a 1440 px desktop frame
 * shows the page at 1:1 with room for the rails. Never derive it from the viewport.
 */
export const PAGE_WIDTH = 960;

/** The five page templates (DESIGN.md "Notebook"). */
export type PageTemplate = 'blank' | 'dot' | 'lined' | 'cornell' | 'derivation';

/** Spacing constants of one template, in page units. Zero means "not used by this template". */
export interface TemplateSpacing {
  /** Distance between dots or ruled lines; 0 for a blank page. */
  readonly grid: number;
  /** Width of the left cue column (Cornell); 0 otherwise. */
  readonly cueColumn: number;
  /** Height of the bottom summary band (Cornell); 0 otherwise. */
  readonly summaryBand: number;
  /** Width of the left "step" gutter (derivation); 0 otherwise. */
  readonly stepGutter: number;
}

/** Spacing for each template; `grid` 24 matches the dot grid in the design frame. */
export const TEMPLATE_SPACING: Readonly<Record<PageTemplate, TemplateSpacing>> = {
  blank: { grid: 0, cueColumn: 0, summaryBand: 0, stepGutter: 0 },
  dot: { grid: 24, cueColumn: 0, summaryBand: 0, stepGutter: 0 },
  lined: { grid: 32, cueColumn: 0, summaryBand: 0, stepGutter: 0 },
  cornell: { grid: 32, cueColumn: 240, summaryBand: 160, stepGutter: 0 },
  derivation: { grid: 32, cueColumn: 0, summaryBand: 0, stepGutter: 96 },
};

/** Fields every page item shares: a rectangle in page units, plus paint order. */
export interface ItemBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Paint order among items; higher is on top. */
  readonly z: number;
}

/** A question-and-answer exchange from the reader's Ask panel (carries AI text: S5c marks it). */
export interface ExchangeItem extends ItemBase {
  readonly kind: 'exchange';
  readonly exchangeId: string;
}

/** Typed text in the person's own voice. */
export interface TextItem extends ItemBase {
  readonly kind: 'text';
  readonly text: string;
}

/** A sticky note; `color` is a token name (like stroke colours), never a hex. */
export interface StickyItem extends ItemBase {
  readonly kind: 'sticky';
  readonly text: string;
  readonly color: string;
}

/** A passage from the paper. The Anchor is required so it can always scroll back to its source. */
export interface QuoteItem extends ItemBase {
  readonly kind: 'quote';
  readonly anchor: Anchor;
  readonly text: string;
}

/** A simple drawn shape (box, ellipse, arrow) placed as an object rather than as a stroke. */
export interface ShapeItem extends ItemBase {
  readonly kind: 'shape';
  readonly shape: 'rect' | 'ellipse' | 'arrow';
}

/** Everything S5c renders on a page besides ink. */
export type Item = ExchangeItem | TextItem | StickyItem | QuoteItem | ShapeItem;

/** How the page is currently laid out on screen. Scroll offsets are in screen px. */
export interface Viewport {
  /** Width in screen px of the element the page fills. */
  readonly containerWidth: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

/** A point `[x, y]` (page units or screen px, per the function using it). */
export type Vec2 = readonly [number, number];

/**
 * Screen px per page unit for a container width.
 *
 * @param containerWidth - Width in screen px the page is drawn at; must be above zero.
 * @returns The scale factor.
 * @throws RangeError when the width is not a positive finite number.
 */
export function pageScale(containerWidth: number): number {
  if (!(containerWidth > 0) || !Number.isFinite(containerWidth)) {
    throw new RangeError(`containerWidth must be positive, got ${containerWidth}`);
  }
  return containerWidth / PAGE_WIDTH;
}

/**
 * Converts a page-unit point to screen px, in the scroll container's viewport frame (origin at the container's top-left, after scrolling; use `clientX - containerRect.left`, never a scrolled page element's rect).
 *
 * @param p - Point in page units.
 * @param view - The current viewport.
 * @returns The point in screen px.
 */
export function pageToScreen(p: Vec2, view: Viewport): Vec2 {
  const s = pageScale(view.containerWidth);
  return [p[0] * s - view.scrollX, p[1] * s - view.scrollY];
}

/**
 * Converts a screen point (in the scroll container's viewport frame, see `pageToScreen`) to page units.
 *
 * @param p - Point in screen px.
 * @param view - The current viewport.
 * @returns The point in page units.
 */
export function screenToPage(p: Vec2, view: Viewport): Vec2 {
  const s = pageScale(view.containerWidth);
  return [(p[0] + view.scrollX) / s, (p[1] + view.scrollY) / s];
}

/** The title Dive in gives a page: this, then the thread's title (the passage's words). */
export const DIVE_IN_PREFIX = 'Dive in: ';

/**
 * Whose words a page title is, so the three voices stay apart in the `<h1>` too: Dive in's
 * "Dive in: " is the interface's and the rest the paper's; the default "Untitled page" is the
 * interface's; any other title is one the person gave.
 *
 * @param title - The page title.
 * @returns The interface's lead-in, the words, and their voice (null: the interface's).
 * @example
 * titleVoice('Dive in: We propose…'); // { lead: 'Dive in: ', words: 'We propose…', voice: 'paper' }
 */
export function titleVoice(title: string): {
  lead: string;
  words: string;
  voice: 'paper' | 'you' | null;
} {
  if (title.startsWith(DIVE_IN_PREFIX)) {
    return { lead: DIVE_IN_PREFIX, words: title.slice(DIVE_IN_PREFIX.length), voice: 'paper' };
  }
  return { lead: '', words: title, voice: title === 'Untitled page' ? null : 'you' };
}
