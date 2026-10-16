'use client';

/**
 * The engraved plate's drawing (frame 07c): hairline boxes on the slot grid, hatched shadows from an
 * SVG `<pattern>`, letter circles, arrows and feedback links, each part's passage marker. It is a
 * picture of the key beside it, so it is hidden from assistive tech (the key is the accessible
 * content, ADR-004 §2.9); a pointer tap on a part does what its key row does.
 */
import { useId, type ReactNode } from 'react';

import { cut, fitLabel } from '../model/fit';
import { GRID, type PlateLayout, type Route, type Slot } from '../model/layout';
import { verdictOf } from '../model/plate';

import type { DiagramPart } from '@/lib/api/types';

/** Props for `PlateDrawing`. */
export interface PlateDrawingProps {
  readonly layout: PlateLayout;
  readonly parts: ReadonlyMap<string, DiagramPart>;
  /** The passage number of a part's marker, or null when it has none (inferred, not found). */
  readonly numberOf: (part: DiagramPart) => number | null;
  /** The letter lit from the key (hover, focus) or by a tap. */
  readonly lit: string | null;
  readonly onPart: (letter: string) => void;
}

function Arrow({ route }: { route: Route }): ReactNode {
  const [x1, y1] = route.points[route.points.length - 2] ?? [0, 0];
  const [x2, y2] = route.points[route.points.length - 1] ?? [0, 0];
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return (
    <g className="pt-plate__route" data-route={route.key} data-feedback={route.feedback}>
      <polyline points={route.points.map((p) => p.join(',')).join(' ')} />
      <path d="M0,0 L-8,-4.5 L-8,4.5 Z" transform={`translate(${x2},${y2}) rotate(${angle})`} />
      {/* A label with no room for three letters is left to the key, never set across a line. */}
      {route.label === null || route.labelRoom < 22 ? null : (
        <text x={route.labelAt[0]} y={route.labelAt[1] + 5} textAnchor="start">
          {cut(route.label, route.labelRoom, 13)}
        </text>
      )}
    </g>
  );
}

function Letter({ slot, faint = false }: { slot: Slot; faint?: boolean }): ReactNode {
  const cy = slot.y + slot.h / 2;
  return (
    <g className="pt-plate__letter" data-faint={faint}>
      <line x1={GRID.circleX + 13} x2={slot.x} y1={cy} y2={cy} />
      <circle cx={GRID.circleX} cy={cy} r={13} />
      <text x={GRID.circleX} y={cy + 5} textAnchor="middle">
        {slot.letter}
      </text>
    </g>
  );
}

interface PartBoxProps {
  readonly slot: Slot;
  readonly part: DiagramPart;
  readonly n: number | null;
  readonly lit: boolean;
  readonly hatch: string;
  readonly onPart: (letter: string) => void;
}

/** The caption a box carries under its label when it is not grounded word for word. */
const CAPTION: Partial<Record<ReturnType<typeof verdictOf>, string>> = {
  inferred: 'inferred, no passage',
  'not-verified': 'not verified',
};

/**
 * A part's marker: the passage number on a solid square when cited, on a dashed open one when
 * not verified, and "?" there when the quote was found nowhere; none for an inferred part.
 */
function Mark({ x, y, n, verdict }: { x: number; y: number; n: number | null; verdict: string }) {
  if (verdict === 'inferred' || (verdict === 'cited' && n === null)) return null;
  return (
    <g className="pt-plate__mark" data-not-verified={verdict === 'not-verified'}>
      <rect x={x - 8} y={y - 8} width={16} height={16} rx={2} />
      <text x={x} y={y + 4} textAnchor="middle">
        {n ?? '?'}
      </text>
    </g>
  );
}

function PartBox({ slot, part, n, lit, hatch, onPart }: PartBoxProps): ReactNode {
  const verdict = verdictOf(part);
  // Only a cited part stands on the page: the others are drawn lighter, never more solid (S3).
  const caption = CAPTION[verdict];
  const { x, y, w, h } = slot;
  const label = fitLabel(part.label, w - 20, caption === undefined ? 2 : 1);
  const two = label.lines.length === 2;
  return (
    <g
      className="pt-plate__part"
      data-part={part.letter}
      data-kind={part.kind}
      data-verdict={verdict}
      data-lit={lit}
      onClick={() => onPart(part.letter)}
    >
      {caption === undefined ? (
        <rect x={x + 5} y={y + 5} width={w} height={h} fill={`url(#${hatch})`} />
      ) : null}
      <rect
        className="pt-plate__box"
        x={x}
        y={y}
        width={w}
        height={h}
        rx={part.kind === 'concept' ? 10 : 0}
      />
      {lit ? <rect className="pt-plate__wash" x={x} y={y} width={w} height={h} /> : null}
      {part.kind === 'output' ? (
        <rect className="pt-plate__rule" x={x + 3} y={y + 3} width={w - 6} height={h - 6} />
      ) : null}
      <text
        className="pt-plate__label"
        x={x + w / 2}
        y={caption === undefined ? y + h / 2 + (two ? -2 : 5) : y + 19}
        textAnchor="middle"
        fontSize={label.size}
      >
        {label.lines.map((line, i) => (
          <tspan key={i} x={x + w / 2} dy={i === 0 ? 0 : 15}>
            {line}
          </tspan>
        ))}
      </text>
      {caption === undefined ? null : (
        <text className="pt-plate__caption" x={x + w / 2} y={y + 36} textAnchor="middle">
          {caption}
        </text>
      )}
      <Mark x={x + w} y={y} n={n} verdict={verdict} />
      <Letter slot={slot} />
    </g>
  );
}

/** The plate's picture, at the grid's size, scaling down with its column. */
export function PlateDrawing({
  layout,
  parts,
  numberOf,
  lit,
  onPart,
}: PlateDrawingProps): ReactNode {
  const hatch = `pt-hatch-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className="pt-plate__drawing"
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      width={layout.width}
      height={layout.height}
      aria-hidden="true"
      focusable="false"
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
        <Arrow key={route.key} route={route} />
      ))}
      {layout.gaps.map((slot) => (
        <g key={slot.letter} className="pt-plate__gap" data-gap={slot.letter}>
          <Letter slot={slot} faint />
          <text x={slot.x} y={slot.y + slot.h / 2 + 5}>
            not drawn
          </text>
        </g>
      ))}
      {layout.slots.map((slot) => {
        const part = parts.get(slot.letter);
        return part === undefined ? null : (
          <PartBox
            key={slot.letter}
            slot={slot}
            part={part}
            n={numberOf(part)}
            lit={lit === slot.letter}
            hatch={hatch}
            onPart={onPart}
          />
        );
      })}
      {layout.ghost === null ? null : (
        <g className="pt-plate__ghost" data-ghost={layout.ghost.letter}>
          <rect
            x={layout.ghost.x}
            y={layout.ghost.y}
            width={layout.ghost.w}
            height={layout.ghost.h}
          />
          <text x={layout.ghost.x + layout.ghost.w / 2} y={layout.ghost.y + 27} textAnchor="middle">
            arriving…
          </text>
          <Letter slot={layout.ghost} faint />
        </g>
      )}
    </svg>
  );
}
