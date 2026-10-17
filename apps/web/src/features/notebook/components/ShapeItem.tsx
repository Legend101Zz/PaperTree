'use client';

/**
 * A drawn shape placed on the page as an object (rectangle, ellipse, arrow) in the person's pen
 * colour (S5c, #208). It moves by drag or arrow keys (Shift for 24), resizes from its two corner
 * handles or with Alt+arrows, and Delete removes it. Like a note, a drag restyles one element and
 * records one history command on release.
 */
import { X } from 'lucide-react';
import { memo, useRef } from 'react';

import { usePointerDrag } from '../hooks/usePointerDrag';

import type { Box } from '../model/history';
import type { ShapeItem as Shape } from '../model/page';
import type { KeyboardEvent, ReactNode } from 'react';

/** Props for `ShapeItem`. */
export interface ShapeItemProps {
  readonly item: Shape;
  /** Screen px per page unit. */
  readonly scale: number;
  /** Move this shape by this much, in page units. */
  readonly onMove: (id: string, dx: number, dy: number) => void;
  /** Give this shape a new box. */
  readonly onResize: (id: string, box: Box) => void;
  readonly onDelete: (id: string) => void;
}

/** The names a person hears and sees for each shape. */
export const SHAPE_NAMES: Readonly<Record<Shape['shape'], string>> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
};

/** The smallest a shape may be resized to, in page units. */
const MIN = 16;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The box after dragging a corner by (dx, dy), never smaller than `MIN`.
 *
 * @param box - The box before.
 * @param corner - `nw` moves the top-left corner, `se` the bottom-right.
 * @param dx - Horizontal drag in page units.
 * @param dy - Vertical drag in page units.
 * @returns The new box.
 */
export function resized(box: Box, corner: 'nw' | 'se', dx: number, dy: number): Box {
  if (corner === 'se') {
    return { ...box, w: Math.max(MIN, box.w + dx), h: Math.max(MIN, box.h + dy) };
  }
  const w = Math.max(MIN, box.w - dx);
  const h = Math.max(MIN, box.h - dy);
  return { x: box.x + box.w - w, y: box.y + box.h - h, w, h };
}

function Outline({ shape, w, h }: { shape: Shape['shape']; w: number; h: number }): ReactNode {
  const i = 1.5;
  if (shape === 'rect') return <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} />;
  if (shape === 'ellipse') return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - i} ry={h / 2 - i} />;
  const m = h / 2;
  return (
    <path
      d={`M${String(i)} ${String(m)}H${String(w - 4)}M${String(w - 14)} ${String(m - 8)}L${String(w - 4)} ${String(m)}L${String(w - 14)} ${String(m + 8)}`}
    />
  );
}

/** One shape, movable and resizable; re-rendered only when its item or the scale changes. */
export const ShapeItem = memo(
  function ShapeItem({ item, scale, onMove, onResize, onDelete }: ShapeItemProps): ReactNode {
    const ref = useRef<HTMLDivElement>(null);
    const box: Box = { x: item.x, y: item.y, w: item.w, h: item.h };
    const style = (b: Box): void => {
      const el = ref.current;
      if (el === null) return;
      Object.assign(el.style, {
        left: `${String(b.x)}px`,
        top: `${String(b.y)}px`,
        width: `${String(b.w)}px`,
        height: `${String(b.h)}px`,
      });
    };
    // On release the element goes back to the stored box before the command runs: a drag that
    // rounds to nothing records nothing and must not leave the element where the pointer let go.
    const move = usePointerDrag(
      scale,
      (dx, dy) => style({ ...box, x: box.x + dx, y: box.y + dy }),
      (dx, dy) => {
        style(box);
        onMove(item.id, dx, dy);
      },
      () => style(box),
    );
    const corner = (c: 'nw' | 'se') =>
      [
        (dx: number, dy: number) => style(resized(box, c, dx, dy)),
        (dx: number, dy: number) => {
          style(box);
          onResize(item.id, resized(box, c, dx, dy));
        },
        () => style(box),
      ] as const;
    const nw = usePointerDrag(scale, ...corner('nw'));
    const se = usePointerDrag(scale, ...corner('se'));
    const name = SHAPE_NAMES[item.shape];

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
      const arrow = ARROWS[e.key];
      const step = e.shiftKey ? 24 : 8;
      if (arrow !== undefined && e.altKey)
        onResize(item.id, resized(box, 'se', arrow[0] * step, arrow[1] * step));
      else if (arrow !== undefined) onMove(item.id, arrow[0] * step, arrow[1] * step);
      else if (e.key === 'Delete' || e.key === 'Backspace') onDelete(item.id);
      else return;
      e.preventDefault();
    };

    return (
      <div
        ref={ref}
        className="pt-nb-shape"
        data-item-id={item.id}
        style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z + 10 }}
      >
        <div
          className="pt-nb-shape__face"
          role="button"
          tabIndex={0}
          aria-roledescription="shape"
          aria-label={`${name} you drew`}
          aria-describedby="pt-nb-shape-help"
          onKeyDown={onKeyDown}
          {...move}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${String(item.w)} ${String(item.h)}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <Outline shape={item.shape} w={item.w} h={item.h} />
          </svg>
        </div>
        <span className="pt-nb-shape__handle pt-nb-shape__handle--nw" aria-hidden="true" {...nw} />
        <span className="pt-nb-shape__handle pt-nb-shape__handle--se" aria-hidden="true" {...se} />
        <button
          type="button"
          className="pt-nb-note__delete"
          aria-label={`Delete ${name.toLowerCase()}`}
          onClick={() => onDelete(item.id)}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  },
  // The callbacks are usePageEditing's stable, id-taking actions (see NoteItem).
  (a, b) => a.item === b.item && a.scale === b.scale,
);
