'use client';

/**
 * usePointerDrag — a pointer drag in page units for the notebook's items and their handles (S5c,
 * #208). `onDrag` runs on every move so the caller can restyle ONE element directly (no React
 * render, which is what keeps a drag inside the 16 ms frame budget); `onDrop` runs once on release
 * and is where the caller records one history command. A press that moves under 3 px is a click. A
 * cancelled pointer (a touch scroll took over) records nothing: `onCancel` snaps the element back.
 */
import { useRef } from 'react';

import type { PointerEvent } from 'react';

/** The pointer handlers to spread on the dragged element. */
export interface PointerDragHandlers {
  readonly onPointerDown: (e: PointerEvent<Element>) => void;
  readonly onPointerMove: (e: PointerEvent<Element>) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
}

/**
 * Tracks one drag at a time.
 *
 * @param scale - Screen px per page unit.
 * @param onDrag - Called with the offset so far, in page units.
 * @param onDrop - Called once with the final offset (rounded to whole units) if the pointer moved.
 * @param onCancel - Called when the pointer is cancelled after it moved: put the element back.
 * @returns Handlers for the element.
 */
export function usePointerDrag(
  scale: number,
  onDrag: (dx: number, dy: number) => void,
  onDrop: (dx: number, dy: number) => void,
  onCancel: () => void,
): PointerDragHandlers {
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(
    null,
  );
  const end = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d !== null && d.moved) onDrop(Math.round(d.dx), Math.round(d.dy));
  };
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (d === null) return;
      d.dx = (e.clientX - d.x) / scale;
      d.dy = (e.clientY - d.y) / scale;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
      d.moved = true;
      onDrag(d.dx, d.dy);
    },
    onPointerUp: end,
    onPointerCancel: () => {
      const moved = drag.current?.moved === true;
      drag.current = null;
      if (moved) onCancel();
    },
  };
}
