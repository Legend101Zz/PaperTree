'use client';

/**
 * A plate at a board card's size (frame 06): the same slot grid as the panel's plate
 * (`layoutPlate`), so the card is a true miniature of the stored parts, never a picture made up for
 * it. Boxes, hatched shadows, arrows and letters only: at this size a label would not be legible,
 * so the card's own title and counts say what it is and the drawing is hidden from assistive tech.
 */
import { useId, useMemo, type ReactNode } from 'react';

import { GRID, layoutPlate } from '../model/layout';
import { verdictOf } from '../model/plate';

import type { MessageDiagram } from '@/lib/api/types';

import './plate.css';

/** Props for `PlateMiniature`. */
export interface PlateMiniatureProps {
  readonly plate: Pick<MessageDiagram, 'parts' | 'links'>;
}

/** The stored plate, drawn small. */
export function PlateMiniature({ plate }: PlateMiniatureProps): ReactNode {
  const hatch = `pt-mini-hatch-${useId().replace(/:/g, '')}`;
  const layout = useMemo(() => layoutPlate(plate.parts, plate.links, false), [plate]);
  const verdicts = new Map(plate.parts.map((p) => [p.letter, verdictOf(p)]));
  return (
    <svg
      className="pt-plate__drawing pt-plate-mini"
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-plate-mini={plate.parts.length}
    >
      <defs>
        <pattern
          id={hatch}
          width={4}
          height={4}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line className="pt-plate__hatch" x1={0} y1={0} x2={0} y2={4} />
        </pattern>
      </defs>
      {layout.routes.map((route) => (
        <polyline
          key={route.key}
          className="pt-plate-mini__route"
          points={route.points.map((p) => p.join(',')).join(' ')}
        />
      ))}
      {layout.slots.map((slot) => {
        const inferred = verdicts.get(slot.letter) === 'inferred';
        return (
          <g key={slot.letter} className="pt-plate__part" data-verdict={verdicts.get(slot.letter)}>
            {inferred ? null : (
              <rect
                x={slot.x + 5}
                y={slot.y + 5}
                width={slot.w}
                height={slot.h}
                fill={`url(#${hatch})`}
              />
            )}
            <rect className="pt-plate__box" x={slot.x} y={slot.y} width={slot.w} height={slot.h} />
            <text className="pt-plate-mini__letter" x={GRID.circleX} y={slot.y + slot.h / 2 + 8}>
              {slot.letter}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
