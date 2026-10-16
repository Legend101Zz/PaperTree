/**
 * Page geometry the S5c page needs on top of `page.ts` (#208): how tall the page is, where a new
 * note lands, and how each of the five templates is drawn. All in page units; the component scales
 * the whole page by one factor, so these numbers are also CSS px inside the page layer. Pure.
 */
import { PAGE_WIDTH, TEMPLATE_SPACING } from './page';

import type { Item, PageTemplate } from './page';

/** Height of the title band above the items, in page units (four dot-grid cells). */
export const TITLE_BAND = 96;

/** Width of the binding edge in screen px; it sits outside the scaled page layer. */
export const BINDING = 40;

/** The shortest a page is drawn: A4's ratio at the 960-unit width. */
export const PAGE_MIN_HEIGHT = 1358;

/** Room kept below the lowest item, so there is always paper to write on. */
const PAGE_TAIL = 240;

/** Margin kept around the page edge when placing a new item, and the gap between items. */
export const PAGE_MARGIN = 48;
const GAP = 16;
/** New items snap to the dot grid. */
const STEP = 24;

/**
 * The page's height for its items.
 *
 * @param items - Everything on the page.
 * @returns At least `PAGE_MIN_HEIGHT`, and always `PAGE_TAIL` below the lowest item.
 */
export function pageHeight(items: readonly Item[]): number {
  const bottom = items.reduce((max, i) => Math.max(max, i.y + i.h), 0);
  return Math.max(PAGE_MIN_HEIGHT, Math.ceil((bottom + PAGE_TAIL) / STEP) * STEP);
}

function overlaps(items: readonly Item[], x: number, y: number, w: number, h: number): boolean {
  return items.some(
    (i) => x < i.x + i.w + GAP && x + w + GAP > i.x && y < i.y + i.h + GAP && y + h + GAP > i.y,
  );
}

/** How far the page below the exchange moves down while the exchange is taller than its box. */
export interface ExchangeShift {
  /** Items whose top is at or below this page-unit line (the exchange box's bottom) move. */
  readonly boundary: number;
  /** How far they move, in page units; 0 when the exchange fits its box. */
  readonly extra: number;
}

/**
 * The display offset that keeps an expanded exchange from sliding under the cards seeded below it
 * (frame 05 draws the slip open with the cards after it). Display only: nothing is saved, so
 * collapsing puts everything back where it is stored.
 *
 * @param items - Everything on the page.
 * @param measured - The exchange's rendered height in page units, or null before it is measured.
 * @returns The shift, or null for a page without an exchange.
 */
export function exchangeShift(
  items: readonly Item[],
  measured: number | null,
): ExchangeShift | null {
  const exchange = items.find((i) => i.kind === 'exchange');
  if (exchange === undefined) return null;
  const extra = measured === null ? 0 : Math.max(0, Math.ceil(measured - exchange.h));
  return { boundary: exchange.y + exchange.h, extra };
}

/**
 * Reading order on the page: top to bottom, then left to right. The DOM and the keyboard follow it.
 *
 * @param a - One item.
 * @param b - Another.
 * @returns Negative when `a` comes first.
 */
export function readingOrder(a: Item, b: Item): number {
  return a.y - b.y || a.x - b.x;
}

/**
 * Where the keyboard goes when an item is removed: the next item in reading order, else the one
 * before it, else nowhere on the page (null: the caller focuses the page itself).
 *
 * @param items - Everything on the page, the removed item included.
 * @param id - The item being removed.
 * @returns The id to focus, or null.
 */
export function neighbourOf(items: readonly Item[], id: string): string | null {
  const ordered = [...items].sort(readingOrder);
  const at = ordered.findIndex((i) => i.id === id);
  if (at < 0) return null;
  return ordered[at + 1]?.id ?? ordered[at - 1]?.id ?? null;
}

/**
 * Where a new `w × h` item goes: the first free grid spot, reading the page top to bottom, left to
 * right. Nothing on the page is ever covered.
 *
 * @param items - Everything on the page.
 * @param w - The new item's width.
 * @param h - The new item's height.
 * @returns Its top-left corner in page units.
 */
export function placeNewItem(
  items: readonly Item[],
  w: number,
  h: number,
): { x: number; y: number } {
  const limit = pageHeight(items) + h;
  for (let y = PAGE_MARGIN; y < limit; y += STEP) {
    for (let x = PAGE_MARGIN; x + w <= PAGE_WIDTH - PAGE_MARGIN; x += STEP) {
      if (!overlaps(items, x, y, w, h)) return { x, y };
    }
  }
  return { x: PAGE_MARGIN, y: limit };
}

/** One template's paint: CSS background layers using the notebook's `--pt-nb-*` colour tokens. */
export interface TemplatePaint {
  readonly backgroundImage: string;
  readonly backgroundSize: string;
  readonly backgroundPosition: string;
  readonly backgroundRepeat: string;
}

function ruled(grid: number): string {
  return `repeating-linear-gradient(180deg, transparent 0 ${grid - 1}px, var(--pt-nb-rule) ${grid - 1}px ${grid}px)`;
}

function vertical(at: string, colour: string): string {
  return `linear-gradient(90deg, transparent calc(${at} - 1px), ${colour} calc(${at} - 1px) ${at}, transparent ${at})`;
}

/**
 * The background that draws a template on the page layer (`TEMPLATE_SPACING` gives the numbers).
 *
 * @param template - One of the five.
 * @returns CSS background properties; a blank page has no layers.
 */
export function templatePaint(template: PageTemplate): TemplatePaint {
  const s = TEMPLATE_SPACING[template];
  const layers: string[] = [];
  const sizes: string[] = [];
  const add = (image: string, size = 'auto'): void => {
    layers.push(image);
    sizes.push(size);
  };
  if (template === 'dot') {
    add(
      'radial-gradient(circle, var(--pt-nb-dot) 1.1px, transparent 1.6px)',
      `${s.grid}px ${s.grid}px`,
    );
  }
  if (template === 'lined' || template === 'cornell') add(ruled(s.grid));
  if (template === 'cornell') {
    add(vertical(`${s.cueColumn}px`, 'var(--pt-nb-margin)'));
    add(
      `linear-gradient(180deg, transparent calc(100% - ${s.summaryBand}px), var(--pt-nb-margin) calc(100% - ${s.summaryBand}px) calc(100% - ${s.summaryBand - 1}px), transparent calc(100% - ${s.summaryBand - 1}px))`,
    );
  }
  if (template === 'derivation') {
    add(vertical(`${s.stepGutter}px`, 'var(--pt-nb-margin)'));
    add(ruled(s.grid));
    add(
      `repeating-linear-gradient(90deg, transparent 0 ${s.grid - 1}px, var(--pt-nb-rule) ${s.grid - 1}px ${s.grid}px)`,
    );
  }
  return {
    backgroundImage: layers.length === 0 ? 'none' : layers.join(', '),
    backgroundSize: sizes.length === 0 ? 'auto' : sizes.join(', '),
    backgroundPosition: template === 'dot' ? `${s.grid / 2}px ${s.grid / 2}px` : '0 0',
    backgroundRepeat: 'repeat',
  };
}
