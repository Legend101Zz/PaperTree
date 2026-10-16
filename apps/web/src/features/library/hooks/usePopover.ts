/**
 * usePopover: the library's disclosure popovers (#195, #197): the header's Aa and account menus,
 * the Table's Columns and Filter menus, a row's "…" menu and its authors. A button with
 * `aria-expanded` opens a panel under it; Esc (focus back on the button) or a press outside closes it.
 */
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { RefObject } from 'react';

/** What `usePopover` gives a disclosure. */
export interface Popover {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
  /** Close, and put focus back on the button (after an action that removes the panel). */
  readonly close: () => void;
  /** Wraps the button and the panel: a press inside it is not "outside". */
  readonly wrapper: RefObject<HTMLDivElement>;
  readonly button: RefObject<HTMLButtonElement>;
  /** For the button's `aria-controls` and the panel's `id`. */
  readonly panelId: string;
}

/**
 * A disclosure's state and its closing rules.
 *
 * @returns The state, refs and handlers.
 * @example
 * const menu = usePopover();
 * <div ref={menu.wrapper}><button ref={menu.button} aria-expanded={menu.open} onClick={menu.toggle} />…</div>
 */
export function usePopover(): Popover {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  useEffect(() => {
    const node = wrapper.current;
    if (!open || node === null) return undefined;
    const outside = (event: PointerEvent): void => {
      if (!node.contains(event.target as Node)) setOpen(false);
    };
    // Esc from the button or anything in the panel; stopped here so it never also puts a book back.
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', outside);
    node.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      node.removeEventListener('keydown', escape);
    };
  }, [open, close]);
  return { open, setOpen, toggle, close, wrapper, button, panelId };
}
