'use client';

/**
 * board/hooks/useEscapeDeselect — Escape on the board puts the selection away (cards and links), the
 * same as a click on the empty pane. It is the LAST thing Escape does: every level the board holds
 * open (a picker, the ask box, the path focus) closes first and claims the key; a key that was
 * claimed, or that is typed into a field, is left alone.
 */
import { useEffect, useRef } from 'react';

/**
 * Whether a key press at `target` belongs to the board and not to a field or a dialog.
 *
 * @param target The element the key went to.
 * @returns True when Escape may clear the selection from there.
 */
export function escapeBelongsToBoard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target === document.body) return true;
  if (target.isContentEditable) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return false;
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null) return false;
  return true;
}

/**
 * Clear the selection on Escape.
 *
 * @param active Whether anything is selected (and no gesture of its own is using Escape).
 * @param deselect Clears the selected cards and links.
 */
export function useEscapeDeselect(active: boolean, deselect: () => void): void {
  const latest = useRef({ active, deselect });
  latest.current = { active, deselect };
  useEffect(() => {
    // The board's own Escape (useBranchBoard) re-registers whenever its control changes, so it can
    // sit AFTER this listener on the window: listener order says nothing. Look once every listener
    // has run: a press that closed a level has been defaultPrevented by then.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!latest.current.active || !escapeBelongsToBoard(event.target)) return;
      setTimeout(() => {
        if (event.defaultPrevented || !latest.current.active) return;
        latest.current.deselect();
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
