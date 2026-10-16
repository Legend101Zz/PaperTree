'use client';

/**
 * The ink tools on the page (S5d, #209): the live stroke, drawn under the items like the stored
 * ink (`LiveInk`), and the surface that takes the pointer from the page while a tool is in the hand
 * (`InkSurface`). The surface exists only while a tool is held, so `touch-action: none` (no browser
 * pan or zoom mid-stroke) never stops a finger scrolling the page otherwise.
 */
import { forwardRef } from 'react';

import { useInkInput } from '../hooks/useInkInput';
import { inkColour } from './InkLayer';

import type { InkInputOptions } from '../hooks/useInkInput';
import type { ReactNode } from 'react';

/** Props for `LiveInk`. */
export interface LiveInkProps {
  readonly width: number;
  readonly height: number;
  /** The colour token of the pen or highlighter in the hand. */
  readonly color: string;
  readonly wash: boolean;
}

/** The stroke being drawn: one path, whose `d` `useInkInput` writes once per frame. */
export const LiveInk = forwardRef<SVGPathElement, LiveInkProps>(function LiveInk(
  { width, height, color, wash },
  ref,
): ReactNode {
  return (
    <svg
      className="pt-nb-ink pt-nb-ink--live"
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      aria-hidden="true"
    >
      <path
        ref={ref}
        className={wash ? 'pt-nb-ink__wash' : undefined}
        style={{ fill: inkColour(color) }}
      />
    </svg>
  );
});

/** Props for `InkSurface`. */
export interface InkSurfaceProps {
  readonly options: InkInputOptions;
  /** Where the items layer starts, in page units: the surface covers exactly it. */
  readonly top: number;
}

/** The pointer surface over the page while an ink tool is held. */
export function InkSurface({ options, top }: InkSurfaceProps): ReactNode {
  const handlers = useInkInput(options);
  return (
    <div
      className="pt-nb-surface"
      data-tool={options.tool}
      aria-hidden="true"
      style={{ top }}
      {...handlers}
    />
  );
}
