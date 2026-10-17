/**
 * useModalSheet: the phone's catalogue card as a modal bottom sheet (#199, review SF2). While it is
 * up, the rest of the page is `inert` (no focus, no taps: a book can never take focus behind it),
 * Tab wraps inside it, the room under the stacks is its measured height, and its book is scrolled
 * clear above it. Putting the book back (Esc, Put it back, the scrim) returns focus after the
 * commit that lifts the inert (`ShelfSection`'s `putBack`); this hook only lifts it.
 */
'use client';

import { useLayoutEffect } from 'react';

import type { RefObject } from 'react';

const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

// Every element beside the sheet's ancestors up to <body>, made inert; returns what it changed.
function inertAround(node: HTMLElement): HTMLElement[] {
  const made: HTMLElement[] = [];
  for (
    let at: HTMLElement | null = node;
    at !== null && at !== document.body;
    at = at.parentElement
  ) {
    for (const sibling of Array.from(at.parentElement?.children ?? [])) {
      if (!(sibling instanceof HTMLElement) || sibling === at) continue;
      // The scrim stays live: a tap on it puts the book back. An element already inert is not ours.
      if (sibling.hasAttribute('data-sheet-keep') || sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      made.push(sibling);
    }
  }
  return made;
}

// Tab from the last control goes to the first, Shift+Tab from the first to the last.
function wrapTab(event: KeyboardEvent, node: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const stops = Array.from(node.querySelectorAll<HTMLElement>(TABBABLE));
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) return;
  const from = document.activeElement;
  if (event.shiftKey ? from === first : from === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

// Scrolls the book into view and, if the sheet covers it, up until it clears the sheet's top.
function clearOfSheet(book: HTMLElement | null, node: HTMLElement): void {
  if (book === null) return;
  book.scrollIntoView?.({ block: 'nearest' });
  const over = book.getBoundingClientRect().bottom - (node.getBoundingClientRect().top - 12);
  // Optional calls, as `useCardPlacement`'s: jsdom has neither (no layout to scroll).
  if (over > 0) window.scrollBy?.({ top: over });
}

/**
 * Makes the card a modal sheet while `active`.
 *
 * @param sheet - The card.
 * @param active - The card is drawn as the phone's sheet.
 * @param paperId - The book it belongs to (scrolled clear of the sheet).
 * @returns Nothing; the effect undoes itself when the sheet goes or the screen widens.
 */
export function useModalSheet(
  sheet: RefObject<HTMLElement>,
  active: boolean,
  paperId: string,
): void {
  useLayoutEffect(() => {
    const node = sheet.current;
    if (!active || node === null) return undefined;
    const made = inertAround(node);
    // Focus is in the sheet from the start: crossing to phone width with a spine focused would
    // otherwise leave it on a book that has just become inert.
    if (!node.contains(document.activeElement)) {
      node.querySelector<HTMLElement>('[data-card-read]')?.focus({ preventScroll: true });
    }
    const band = node.closest<HTMLElement>('.pt-shelfband');
    const fit = (): void => {
      const room = Math.ceil(node.getBoundingClientRect().height) + 24;
      band?.style.setProperty('--pt-sheet-room', `${String(room)}px`);
    };
    fit();
    clearOfSheet(document.querySelector(`[data-paper-id="${CSS.escape(paperId)}"]`), node);
    // A confirmation or an error line makes the sheet taller; the room follows it.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(node);
    const onKey = (event: KeyboardEvent): void => wrapTab(event, node);
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      observer?.disconnect();
      band?.style.removeProperty('--pt-sheet-room');
      for (const element of made) element.removeAttribute('inert');
    };
  }, [sheet, active, paperId]);
}
