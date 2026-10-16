'use client';

/**
 * A drawn shape placed on the page as an object (rectangle, ellipse, arrow), in the person's pen
 * colour (S5c, #208). Read-only here: it is drawn from its stored item; creating, moving and
 * resizing shapes is part 2 of this slice.
 */
import type { ShapeItem } from '../model/page';
import type { ReactNode } from 'react';

/** Props for `ShapeView`. */
export interface ShapeViewProps {
  readonly item: ShapeItem;
}

const NAMES: Readonly<Record<ShapeItem['shape'], string>> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
};

/** The outline of one shape item, inside its box. */
export function ShapeView({ item }: ShapeViewProps): ReactNode {
  const { w, h } = item;
  const inset = 1.5;
  return (
    <svg
      className="pt-nb-shape"
      data-item-id={item.id}
      style={{ left: item.x, top: item.y, zIndex: item.z + 10 }}
      width={w}
      height={h}
      viewBox={`0 0 ${String(w)} ${String(h)}`}
      role="img"
      aria-label={`${NAMES[item.shape]} you drew`}
    >
      {item.shape === 'rect' ? (
        <rect x={inset} y={inset} width={w - 2 * inset} height={h - 2 * inset} />
      ) : item.shape === 'ellipse' ? (
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - inset} ry={h / 2 - inset} />
      ) : (
        <path
          d={`M${String(inset)} ${String(h / 2)} H${String(w - 4)} M${String(w - 14)} ${String(h / 2 - 8)} L${String(w - 4)} ${String(h / 2)} L${String(w - 14)} ${String(h / 2 + 8)}`}
        />
      )}
    </svg>
  );
}
