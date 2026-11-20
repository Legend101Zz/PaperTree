'use client';

/**
 * The small figure inside an answer (v0.3 answer format §1, prototype `dgbox`): a ```diagram
 * fence drawn as layers (`layoutLayered`, `LayeredDrawing`): parallel branches side by side, the
 * plate's boxes and arrows, no key letters, no readout and no passage buttons: the answer's words
 * and source line already carry those. The layout takes the room the figure has (the Explain panel,
 * or a board card half as wide), measured, so boxes narrow and rows wrap rather than the text
 * shrinking. While the fence is still being written it stands as a quiet placeholder, so the
 * answer never reflows under the reader's eyes when the figure lands; a fence that holds nothing
 * drawable draws nothing at all (never the raw lines).
 *
 * The picture is a `role="img"` whose title and description carry its parts and arrows as text.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from 'react';

import { mathToPlain } from '@/lib/markdown';

import { LAYERED, layoutLayered } from '../model/layered';
import { parseDiagramFence } from '../model/fence';
import { LayeredDrawing } from './LayeredDrawing';

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
const MIN_SCALE = 0.85;
/** The figure's own padding and border, both sides: the drawing has the rest of its width. */
const CHROME = 16;
/** The narrowest layout width, and the step widths are rounded to so a resize does not thrash. */
const NARROWEST = 240;
const STEP = 20;

/** The width the drawing may take: the figure's measured width, rounded down to a step. */
function useRoom(ref: RefObject<HTMLElement | null>, mounted: boolean): number {
  const [room, setRoom] = useState<number>(LAYERED.defaultWidth);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = (): void => {
      const w = el.clientWidth - CHROME;
      if (w <= 0) return;
      const next = Math.max(NARROWEST, Math.min(LAYERED.defaultWidth, Math.floor(w / STEP) * STEP));
      setRoom((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return room;
}

/** The figure of one ```diagram fence. */
export function InlineDiagram({ body, closed }: InlineDiagramProps): ReactNode {
  const ref = useRef<HTMLElement | null>(null);
  const room = useRoom(ref, closed);
  const figure = useMemo(() => (closed ? parseDiagramFence(body) : null), [body, closed]);
  const layout = useMemo(
    () => (figure === null ? null : layoutLayered(figure.parts, figure.links, room)),
    [figure, room],
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
      ref={ref}
      className="pt-diagram-inline"
      data-diagram-inline={figure.parts.length}
      data-diagram-columns={layout.columns}
      aria-label={name}
      style={{ '--pt-diagram-w': `${String(Math.round(layout.width * scale))}px` } as CSSProperties}
    >
      <LayeredDrawing layout={layout} title={figure.title} />
    </figure>
  );
}
