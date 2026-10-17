/**
 * library/model/phone — the library at phone width (#199, frame 08a, DESIGN.md §10). Pure: what a
 * phone draws instead of the desktop shelf (books lying flat in a stack per row, Reading now always
 * above them, the catalogue card as a bottom sheet) and each flat book's picture, so the phone
 * layout is tested without a DOM. Lengths and offsets are decoration, never data.
 */
import { bookFace, fnv1a, shelfStep, spineState, spineTitle, type BookFace } from './shelf';
import { shelfLayout, type ShelfLayout } from './states';

import type { ShelfPaper } from './shelf';

/**
 * The widest viewport that gets the phone library: the same 900 px at which the header goes
 * compact and the Table scrolls sideways (owner may change).
 */
export const PHONE_MAX_WIDTH = 900;

/** The media query for `PHONE_MAX_WIDTH`; `phone.css` uses the same number. */
export const PHONE_QUERY = `(max-width: ${String(PHONE_MAX_WIDTH)}px)`;

/** What the shelf draws: the desktop's three layouts, or books lying flat (the phone). */
export type LibraryShelf = ShelfLayout | 'flat';

/** How the library is laid out for a width. */
export interface LibraryPlan {
  readonly shelf: LibraryShelf;
  /** Reading now stands above the shelf. */
  readonly readingNow: boolean;
  /** Where a taken-down book's catalogue card opens: the band above the shelf, or a bottom sheet. */
  readonly card: 'band' | 'sheet';
}

/**
 * The library's layout. A phone always lays its books flat, at any count: the face-out covers of
 * a short library would be one to a plank there. Flat books carry no Continue, so Reading now
 * stands above them even when the desktop would draw covers (which carry Continue themselves).
 *
 * @param count - Papers on the shelf (never after a search, which dims in place).
 * @param phone - The viewport is at most `PHONE_MAX_WIDTH` wide.
 * @returns The shelf, whether Reading now shows, and where the card opens.
 */
export function libraryPlan(count: number, phone: boolean): LibraryPlan {
  if (phone) return { shelf: 'flat', readingNow: true, card: 'sheet' };
  const shelf = shelfLayout(count);
  return { shelf, readingNow: shelf !== 'face-out', card: 'band' };
}

/**
 * Frame 08a's lengths, fitted to its 13 books on a 358 px stack: `274 + 1.12 × pages` px (8 pp →
 * 283, 15 → 291, 34 → 312, 75 → 358), within 2.3 px on 12 of the 13 (not NMT's two-line title).
 * Kept as how far a book falls short of the stack's width, so a 320 px phone draws it narrower.
 */
export const FLAT_SHORT_MAX = 84;
const FLAT_PX_PER_PAGE = 1.12;
/** A book whose pages are not counted yet is drawn as long as a 16-page one (the spine's 40 px). */
const FLAT_DEFAULT_PAGES = 16;
/** Frame 08a sets each book 0–12 px in from the stack's left edge, as a hand stacks them. */
const FLAT_OFFSETS = [0, 4, 6, 10, 12] as const;

/** One book lying flat, as the phone stack draws it. */
export interface FlatPicture {
  readonly face: BookFace;
  /** The short title (`spineTitle`), set across the book. */
  readonly title: string;
  /** The year in gilt; null on a paper label, kraft, a torn label, or when unknown. */
  readonly year: number | null;
  /** "being read" on kraft, "could not read" on the torn label. */
  readonly note: string | null;
  /** The red ribbon out of the fore-edge while the person is reading it. */
  readonly ribbon: boolean;
  /** How many px the book falls short of the stack's width (0 to `FLAT_SHORT_MAX`). */
  readonly short: number;
  /** How many px it sits in from the stack's left edge (from its id: stable, says nothing). */
  readonly offset: number;
}

/**
 * How a paper lies in the phone stack.
 *
 * @param paper - The paper.
 * @returns Its face, words, ribbon, length and offset.
 */
export function flatPicture(paper: ShelfPaper): FlatPicture {
  const face = bookFace(paper);
  const pages = paper.pageCount > 0 ? paper.pageCount : FLAT_DEFAULT_PAGES;
  const short = Math.round(Math.max(0, FLAT_SHORT_MAX - FLAT_PX_PER_PAGE * pages));
  const note = face === 'torn' ? 'could not read' : face === 'kraft' ? 'being read' : null;
  return {
    face,
    title: spineTitle(paper.title),
    year: face === 'gilt' && typeof paper.year === 'number' ? paper.year : null,
    note,
    ribbon: spineState(paper) === 'reading',
    short,
    offset: FLAT_OFFSETS[fnv1a(paper.id) % FLAT_OFFSETS.length] ?? 0,
  };
}

/**
 * The roving step for the stacks: ↓ and → to the next book (down the stack, then into the next
 * one), ↑ and ← to the previous, Home and End to the ends; no wrap.
 *
 * @param current - The index that has focus.
 * @param key - `KeyboardEvent.key`.
 * @param count - How many books.
 * @returns The index to focus, or null when the key is not a stack key.
 */
export function flatStep(current: number, key: string, count: number): number | null {
  const along = key === 'ArrowDown' ? 'ArrowRight' : key === 'ArrowUp' ? 'ArrowLeft' : key;
  return shelfStep(current, along, count);
}
