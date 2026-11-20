'use client';

/**
 * The drawing of the layered figure inside an answer (`model/layered.ts`): the plate's own boxes,
 * hatched shadows and arrows (same classes, same tokens, light and dark), but with the branches
 * side by side and no A–G key circles or leader lines: an answer's figure has no key beside it.
 *
 * A label with maths in it (`$…$`, or bare TeX the model wrote, `model/maths.ts`) goes through the
 * one maths renderer in a `foreignObject`; a plain label is SVG text wrapped by the layout. The
 * picture is one `role="img"` whose `<title>` and `<desc>` list the parts and the arrows in order.
 */
import { useId, type ReactNode } from 'react';

import { MathText } from '@/lib/MathText';
import { mathToPlain } from '@/lib/markdown';

import { cut } from '../model/fit';
import { type LayeredBox, type LayeredEdge, type LayeredLayout } from '../model/layered';

/** Props for `LayeredDrawing`. */
export interface LayeredDrawingProps {
  readonly layout: LayeredLayout;
  /** The figure's name, or null. */
  readonly title: string | null;
}

function Arrow({ edge }: { edge: LayeredEdge }): ReactNode {
  const [x1, y1] = edge.points[edge.points.length - 2] ?? [0, 0];
  const [x2, y2] = edge.points[edge.points.length - 1] ?? [0, 0];
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return (
    <g className="pt-plate__route pt-dg__route" data-route={edge.key} data-feedback={edge.feedback}>
      <polyline points={edge.points.map((p) => p.join(',')).join(' ')} />
      <path d="M0,0 L-8,-4.5 L-8,4.5 Z" transform={`translate(${x2},${y2}) rotate(${angle})`} />
    </g>
  );
}

function EdgeLabel({ edge }: { edge: LayeredEdge }): ReactNode {
  // A label with no room for three letters is left to the description, never set across a box.
  if (edge.label === null || edge.labelRoom < 22) return null;
  return (
    <text className="pt-dg__elabel" x={edge.labelAt[0]} y={edge.labelAt[1]}>
      {cut(mathToPlain(edge.label), edge.labelRoom, 13)}
    </text>
  );
}

function Box({ box, hatch }: { box: LayeredBox; hatch: string }): ReactNode {
  const { x, y, w, h } = box;
  const lineH = 16;
  const first = y + h / 2 - ((box.lines.length - 1) * lineH) / 2 + box.size * 0.35;
  return (
    <g className="pt-dg__part" data-part={box.letter} data-kind={box.kind} data-level={box.level}>
      <rect x={x + 5} y={y + 5} width={w} height={h} fill={`url(#${hatch})`} />
      <rect
        className="pt-plate__box"
        x={x}
        y={y}
        width={w}
        height={h}
        rx={box.kind === 'concept' ? 10 : 0}
      />
      {box.kind === 'output' ? (
        <rect className="pt-plate__rule" x={x + 3} y={y + 3} width={w - 6} height={h - 6} />
      ) : null}
      {box.math ? (
        <foreignObject x={x + 6} y={y} width={w - 12} height={h}>
          <div
            // The XHTML namespace makes the same markup valid in a standalone .svg file.
            {...{ xmlns: 'http://www.w3.org/1999/xhtml' }}
            className="pt-dg__math"
            data-kind={box.kind}
            style={{ fontSize: box.size }}
          >
            <span>
              <MathText text={box.tex} />
            </span>
          </div>
        </foreignObject>
      ) : (
        <text
          className="pt-plate__label"
          x={x + w / 2}
          y={first}
          textAnchor="middle"
          fontSize={box.size}
        >
          {box.lines.map((line, i) => (
            <tspan key={i} x={x + w / 2} dy={i === 0 ? 0 : lineH}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}

/** A label as words for a description: maths read as text, a subscript's underscore dropped. */
const spoken = (text: string): string => mathToPlain(text).replace(/_/g, '');

/**
 * The parts and the arrows of a layout as one sentence each, in order, for the picture's
 * description.
 *
 * @param layout The layout.
 * @returns The parts, then the arrows.
 */
export function describeLayout(layout: LayeredLayout): string {
  const name = new Map(layout.boxes.map((b) => [b.letter, spoken(b.tex)] as const));
  const parts = layout.boxes.map((b) => name.get(b.letter) ?? '').join('; ');
  const arrows = layout.edges.map(
    (e) =>
      `${name.get(e.from) ?? ''} ${e.feedback ? 'links back to' : 'to'} ${name.get(e.to) ?? ''}` +
      (e.label === null ? '' : ` (${spoken(e.label)})`),
  );
  return `Parts: ${parts}.${arrows.length === 0 ? '' : ` Arrows: ${arrows.join('; ')}.`}`;
}

/** The layered figure. */
export function LayeredDrawing({ layout, title }: LayeredDrawingProps): ReactNode {
  const id = useId().replace(/:/g, '');
  const hatch = `pt-dg-hatch-${id}`;
  const [titleId, descId] = [`pt-dg-t-${id}`, `pt-dg-d-${id}`];
  return (
    <svg
      className="pt-plate__drawing pt-dg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      width={layout.width}
      height={layout.height}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      data-columns={layout.columns}
    >
      <title id={titleId}>{title === null ? 'Diagram' : `Diagram: ${mathToPlain(title)}`}</title>
      <desc id={descId}>{describeLayout(layout)}</desc>
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
      {layout.edges.map((edge) => (
        <Arrow key={edge.key} edge={edge} />
      ))}
      {layout.boxes.map((box) => (
        <Box key={box.letter} box={box} hatch={hatch} />
      ))}
      {layout.edges.map((edge) => (
        <EdgeLabel key={edge.key} edge={edge} />
      ))}
    </svg>
  );
}
