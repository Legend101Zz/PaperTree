/**
 * useFocusTrap — keeps Tab and Shift+Tab inside the open book (#200: the book is a modal dialog;
 * focus never wanders behind the veil). The page behind is also made `inert` while the book is out,
 * so a pointer or a screen reader cannot reach it either; the shelf gets it back on close.
 */
'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus in `container` and makes `behind` inert while mounted.
 *
 * @param container - The dialog.
 * @param behind - The page behind it (the library), or null.
 */
export function useFocusTrap(container: RefObject<HTMLElement>, behind: HTMLElement | null): void {
  useEffect(() => {
    behind?.setAttribute('inert', '');
    const node = container.current;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || node === null) return;
      const all = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.closest('[inert], [hidden]'),
      );
      const first = all[0];
      const last = all[all.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      behind?.removeAttribute('inert');
    };
  }, [container, behind]);
}
