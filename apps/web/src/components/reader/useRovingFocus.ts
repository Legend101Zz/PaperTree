'use client';

/**
 * reader/useRovingFocus — one tab stop for a toolbar, arrows inside it (WAI-ARIA toolbar pattern).
 *
 * The selection menu has nine or more buttons; with every one tabbable, a keyboard reader would
 * press Tab nine times to get past it. Here only the current button has `tabindex="0"`, the rest
 * `-1`, and the arrow keys (either axis: the bar is a column in the margin and a row when docked)
 * move between the enabled ones. Done on the DOM after each render because the buttons come and go
 * (the Send to board choices open and close) and React sets no `tabindex` on them.
 */

import { useCallback, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';

const ENABLED = 'button:not(:disabled)';

/** What to spread on the toolbar element. */
export interface RovingHandlers {
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * Roving focus for the buttons inside `ref`'s element.
 *
 * @param ref - The toolbar element.
 * @returns Handlers for the toolbar's `onKeyDown` and `onFocus`.
 */
export function useRovingFocus(ref: { readonly current: HTMLElement | null }): RovingHandlers {
  const current = useRef<HTMLElement | null>(null);
  const buttons = useCallback(
    (): HTMLElement[] => Array.from(ref.current?.querySelectorAll<HTMLElement>(ENABLED) ?? []),
    [ref],
  );
  // After every render: the remembered button keeps the tab stop while it exists, else the first.
  useLayoutEffect(() => {
    const all = buttons();
    const stop =
      current.current !== null && all.includes(current.current) ? current.current : all[0];
    for (const button of all) button.tabIndex = button === stop ? 0 : -1;
  });
  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !buttons().includes(target)) return;
      current.current = target;
      for (const button of buttons()) button.tabIndex = button === target ? 0 : -1;
    },
    [buttons],
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const all = buttons();
      const at = all.findIndex((button) => button === document.activeElement);
      if (at < 0) return;
      const last = all.length - 1;
      let to = at;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') to = at === last ? 0 : at + 1;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') to = at === 0 ? last : at - 1;
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = last;
      else return;
      event.preventDefault();
      all[to]?.focus();
    },
    [buttons],
  );
  return { onKeyDown, onFocus };
}
