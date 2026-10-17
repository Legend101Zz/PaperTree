/**
 * reader/guidedTables — a Guided table wider than its column (#205 review): it scrolls sideways, so
 * it must take focus for a keyboard to scroll it (axe `scrollable-region-focusable`), and then it
 * needs a name. One that fits is a plain block: no tab stop that does nothing, no landmark.
 */
import { useEffect, useState, type RefObject } from 'react';

const NAME_MAX = 80;

/**
 * The scroller's accessible name: "Table: <caption>", else "Table: <first header>", else "Table".
 *
 * @param caption - The table's caption as the reading shows it, if it has one.
 * @param firstHeader - The text of its first header cell, if any.
 * @returns The name, cut to 80 characters with an ellipsis.
 * @example
 * tableRegionName('Maximum path lengths per layer type', undefined) // "Table: Maximum path lengths per layer type"
 */
export function tableRegionName(caption?: string, firstHeader?: string): string {
  const text = (caption ?? firstHeader ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return 'Table';
  const named = /^table\b/i.test(text) ? text : `Table: ${text}`;
  return named.length > NAME_MAX ? `${named.slice(0, NAME_MAX - 1).trimEnd()}…` : named;
}

/**
 * Whether the element's content is wider than its box, kept in step as either resizes.
 *
 * @param ref - The scroller.
 * @returns True while it scrolls sideways.
 */
export function useScrollsSideways(ref: RefObject<HTMLElement>): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return undefined;
    const check = (): void => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild !== null) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [ref]);
  return scrolls;
}
