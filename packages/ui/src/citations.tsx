/**
 * ui/citations — the numbered marker and the page tab (v0.2, #190), kept for the places that still
 * point at a passage by number (the notebook's quote cards) and the call slip's quoted passage.
 * AI answers no longer use them: their sources are one quiet line (`SourceLine`, `sources.tsx`).
 *
 * Presentation lives in the "v0.2 voices and citations (#190)" section of `styles.css`.
 */

import type { CSSProperties, ReactNode } from 'react';

/** DESIGN.md §2 and §10: every tap target on a phone is 44 px or more. */
export const TOUCH_TARGET_PX = 44;

/** The phone marker's visible square (frame 08b): small numerals that do not spread the lines. */
export const TOUCH_MARKER_PX = 22;

/**
 * How far a target's hit area reaches past its visible box on each side, so a small square in a
 * line of text answers taps over a `target`-sized area without making the line taller.
 *
 * @param visual The visible size, px.
 * @param target The size the hit area must reach, px. Default `TOUCH_TARGET_PX`.
 * @returns The outset per side, px; 0 when the box is already big enough.
 * @example
 * hitOutset(22); // 11: a 22 px marker answers taps over 44 × 44 px
 */
export function hitOutset(visual: number, target: number = TOUCH_TARGET_PX): number {
  return Math.max(0, Math.ceil((target - visual) / 2));
}

/** Props for `NumberedMarker`. */
export interface NumberedMarkerProps {
  /** The passage number shown in the square. */
  readonly n: number;
  /**
   * Where the passage is, e.g. `"p. 2 ¶2"`. The accessible name is `Passage {n}, {label}`.
   */
  readonly label: string;
  /** True while the matching trace row (or claim) is lit. */
  readonly lit?: boolean;
  /** Run the citation flash: scroll to the passage and flash it. Click, Enter and Space. */
  readonly onFlash: () => void;
  /** Hover or focus in (`true`) and out (`false`), so the trace row can light in step. */
  readonly onLight?: (lit: boolean) => void;
  /** `touch` draws a 22 px square whose hit area reaches 44 px (`hitOutset`), for the phone. */
  readonly size?: 'compact' | 'touch';
}

/**
 * A small solid square carrying a passage number; a button that runs the citation flash.
 *
 * Enter is handled on keydown (and its default click suppressed) so it fires exactly once; Space
 * and pointer use the button's native click.
 *
 * @example
 * <NumberedMarker n={2} label="p. 2 ¶2" onFlash={flash} onLight={setLit} />
 */
export function NumberedMarker({
  n,
  label,
  lit = false,
  onFlash,
  onLight,
  size = 'compact',
}: NumberedMarkerProps): ReactNode {
  const light = (on: boolean): void => onLight?.(on);
  // The hit area is a ::after this far out on each side (styles.css, `.pt-marker--touch`).
  const outset =
    size === 'touch'
      ? ({ '--pt-hit-outset': `${String(hitOutset(TOUCH_MARKER_PX))}px` } as CSSProperties)
      : undefined;
  return (
    <button
      type="button"
      style={outset}
      className={`pt-marker${size === 'touch' ? ' pt-marker--touch' : ''}${lit ? ' is-lit' : ''}`}
      aria-label={`Passage ${String(n)}, ${label}`}
      // `lit` is a hover/focus echo between a marker and its trace row, so it is visual and a test
      // hook only: `aria-current` would announce "current" on every hover (review #230/2).
      {...(lit ? { 'data-lit': 'true' } : {})}
      onClick={onFlash}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onFlash();
      }}
      onMouseEnter={() => light(true)}
      onMouseLeave={() => light(false)}
      onFocus={() => light(true)}
      onBlur={() => light(false)}
    >
      <span className="pt-marker__n" aria-hidden="true">
        {n}
      </span>
    </button>
  );
}

/** Props for `PageTab`. */
export interface PageTabProps {
  /** 1-based page number. */
  readonly page: number;
  /** 1-based paragraph on that page; `null` or absent gives just `p. 2`. */
  readonly para?: number | null;
  /** True while its trace row is lit. */
  readonly lit?: boolean;
}

/**
 * The text a `PageTab` shows, e.g. `p. 2 ¶2`. Pure, so the row, the marker label and tests agree.
 *
 * @param page 1-based page number.
 * @param para 1-based paragraph, or null/absent for the page alone.
 * @returns `p. 2 ¶2` or `p. 2`.
 */
export function formatPageLabel(page: number, para?: number | null): string {
  return para === null || para === undefined
    ? `p. ${String(page)}`
    : `p. ${String(page)} ¶${String(para)}`;
}

/** The tab saying where in the paper a passage stands. */
export function PageTab({ page, para, lit = false }: PageTabProps): ReactNode {
  return (
    <span className="pt-tab-group">
      <span className={`pt-tab${lit ? ' is-lit' : ''}`}>{formatPageLabel(page, para)}</span>
    </span>
  );
}
