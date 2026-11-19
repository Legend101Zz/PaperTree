'use client';

/**
 * The small figure inside an answer (v0.3 answer format §1, prototype `dgbox`): a ```diagram
 * fence drawn with the plate's own boxes and arrows (`PlateDrawing`, the slot grid) in the
 * answer's column, with no key, no readout and no passage buttons: the answer's words and source
 * line already carry those. While the fence is still being written it stands as a quiet
 * placeholder, so the answer never reflows under the reader's eyes when the figure lands; a fence
 * that holds nothing drawable draws nothing at all (never the raw lines).
 *
 * The drawing is `aria-hidden` (a picture of its parts), so the figure's accessible name and a
 * visually hidden list of its parts carry the same content as text.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react';

import { mathToPlain } from '@/lib/markdown';

import { layoutPlate } from '../model/layout';
import { parseDiagramFence } from '../model/fence';
import { PlateDrawing } from './PlateDrawing';

import './plate.css';
import './inline.css';

/** Props for `InlineDiagram`. */
export interface InlineDiagramProps {
  /** The text between the fences. */
  readonly body: string;
  /** The closing fence has arrived. False: a placeholder, the figure is not read yet. */
  readonly closed: boolean;
}

/** The tallest the figure grows before it is scaled down; the panel scrolls, a figure must not fill it. */
const MAX_HEIGHT = 420;
/** Never scaled below this fraction: the labels (13 px in the grid) must stay legible. */
const MIN_SCALE = 0.75;

/** The figure of one ```diagram fence. */
export function InlineDiagram({ body, closed }: InlineDiagramProps): ReactNode {
  const figure = useMemo(() => (closed ? parseDiagramFence(body) : null), [body, closed]);
  const layout = useMemo(
    () => (figure === null ? null : layoutPlate(figure.parts, figure.links, false)),
    [figure],
  );
  const byLetter = useMemo(
    () => new Map((figure?.parts ?? []).map((p) => [p.letter, p] as const)),
    [figure],
  );
  if (!closed) {
    // A reserved, quiet box: the same width as the figure, so the text below does not jump.
    return (
      <div
        className="pt-diagram-inline pt-diagram-inline--pending"
        data-diagram-pending
        aria-hidden="true"
      />
    );
  }
  if (figure === null || layout === null) return null;
  const scale = Math.max(MIN_SCALE, Math.min(1, MAX_HEIGHT / layout.height));
  const name = `Diagram${figure.title === null ? '' : `: ${mathToPlain(figure.title)}`}`;
  return (
    <figure
      className="pt-diagram-inline"
      data-diagram-inline={figure.parts.length}
      aria-label={name}
      style={{ '--pt-diagram-w': `${String(Math.round(layout.width * scale))}px` } as CSSProperties}
    >
      <PlateDrawing layout={layout} parts={byLetter} lit={null} onPart={noop} />
      <ol className="pt-sr-only">
        {figure.parts.map((part) => (
          <li key={part.letter}>
            {part.letter}: {mathToPlain(part.label)}
            {part.text === '' ? '' : `. ${mathToPlain(part.text)}`}
          </li>
        ))}
      </ol>
    </figure>
  );
}

function noop(): void {
  // The plate's parts open the paper from the key; an answer's figure has no key.
}
