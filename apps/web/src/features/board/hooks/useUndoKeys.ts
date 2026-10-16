'use client';

/**
 * board/hooks/useUndoKeys — Cmd/Ctrl+Z undoes and Shift+Cmd/Ctrl+Z (or Ctrl+Y) redoes the board's
 * last step (#215), anywhere on the board page, but never while a text field has the key: a note,
 * a frame's name or a thread's label keep the browser's own undo of their text, and the Link-as
 * picker (`nokey`) takes no board key at all.
 */
import { useEffect } from 'react';

import { historyKey } from '../model/history';

import type { BoardHistory } from './useBoardHistory';

/** Where a key belongs to the text being typed, not to the board. */
const TYPING = 'input, textarea, select, [contenteditable="true"], .nokey';

/**
 * Whether a key press lands in a text field (or the picker).
 *
 * @param target The event's target.
 * @returns True when the board must leave the key alone.
 */
export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || target.closest(TYPING) !== null)
  );
}

/**
 * Listens for the history keys while the board is mounted.
 *
 * @param history The board's history (its `undo` and `redo` are stable).
 */
export function useUndoKeys(history: Pick<BoardHistory, 'undo' | 'redo'>): void {
  const { undo, redo } = history;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const which = historyKey(event);
      if (which === null || event.defaultPrevented || isTyping(event.target)) return;
      event.preventDefault();
      void (which === 'undo' ? undo() : redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
}
