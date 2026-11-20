'use client';

/**
 * reader/useTextDragToBoard — a text selection dragged out of the page is a passage in the air: the
 * board beside the paper shows where it would land and takes it at the drop (#344). The paper says
 * what is being dragged when the drag starts and clears it when it ends. A picked picture's chip has
 * its own drag (`useImageSelection`), and is left alone here.
 */
import { useEffect, useRef } from 'react';

import { setDraggedPassage } from '@/features/split/model/passageDrag';

import type { SelectionCapture } from './useSelectionCapture';

/**
 * Wires the drag of the selected words to the board beside.
 *
 * @param root The scroller, or null before it mounts.
 * @param capture Captures the live text selection.
 * @param enabled False without a board to take it.
 */
export function useTextDragToBoard(
  root: HTMLElement | null,
  capture: (kind?: 'text') => SelectionCapture | null,
  enabled: boolean,
): void {
  // `capture` changes whenever the selection state does, and a native drag changes it (the
  // pointercancel it raises reconciles the selection): the listeners must not be torn down, nor the
  // passage in the air forgotten, in the middle of the very drag that set it. So they read the
  // latest `capture` through a ref and the passage is cleared only on unmount.
  const latest = useRef(capture);
  latest.current = capture;
  useEffect(() => {
    if (root === null || !enabled) return undefined;
    const start = (event: DragEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-pt-imgui]') !== null)
        return;
      const captured = latest.current('text');
      if (captured === null) return;
      setDraggedPassage({ anchor: captured.anchor, text: captured.selection.text });
      if (event.dataTransfer !== null) {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', captured.selection.text);
      }
    };
    const end = (): void => setDraggedPassage(null);
    root.addEventListener('dragstart', start);
    root.addEventListener('dragend', end);
    return () => {
      root.removeEventListener('dragstart', start);
      root.removeEventListener('dragend', end);
    };
  }, [root, enabled]);
  useEffect(() => () => setDraggedPassage(null), []);
}
