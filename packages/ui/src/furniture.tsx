/**
 * ui/furniture — the library's physical pieces (v0.2, #189).
 *
 * Owns `SproutMark` (the product's mark), `LabelHolder` (the brass frame on a shelf that holds a
 * topic card) and `ReadingNowRow` (a ribbon, a title, a progress rule and Continue). The holder's
 * card stays paper in both schemes and the ribbon stays `--pt-ribbon`; neither is ever AI-tinted.
 */

import type { CSSProperties, ReactNode } from 'react';

import { Button, joinClasses } from './controls.js';
import type { ControlSize } from './controls.js';

/** Sizes the sprout is drawn for; each has its own stroke weight so it stays crisp. */
export type SproutSize = 16 | 20 | 24 | 48;

/** Stroke weight per size, in the 24-unit drawing grid (scaled by the SVG, so 16 px needs more). */
const SPROUT_STROKE: Readonly<Record<SproutSize, number>> = { 16: 2.25, 20: 1.8, 24: 1.5, 48: 1.2 };

/** Props for `SproutMark`. */
export interface SproutMarkProps {
  /** Defaults to 24. */
  readonly size?: SproutSize;
  /** Gives the mark an accessible name; without it the mark is decorative (`aria-hidden`). */
  readonly title?: string;
  readonly className?: string;
}

/**
 * The PaperTree sprout: a stem and two leaves, drawn in `currentColor` strokes, never filled. At 48
 * it also carries leaf veins and a ground line.
 *
 * @example
 * <SproutMark size={20} />
 */
export function SproutMark({ size = 24, title, className }: SproutMarkProps): ReactNode {
  return (
    <svg
      className={joinClasses('pt-sprout', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={SPROUT_STROKE[size]}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
    >
      {/* The design's own mark (frames 00, 01, 10): a stem, two leaves, the leaf veins from 20 px up
          at about half the stroke, and a base line. */}
      <path d="M12 21.6V11.4" />
      <path d="M12 14.6C11.5 10.9 8.7 8.7 4.5 9c.2 3.9 3.2 5.9 7.5 5.6z" />
      <path d="M12 11.6c.4-4 3.3-6.6 7.7-6.7-.1 4.1-3.2 6.8-7.7 6.7z" />
      {size >= 20 ? (
        <path d="M5.8 10.1l6.2 4.3M13 10.6l5.4-4.6" strokeWidth={SPROUT_STROKE[size] * 0.55} />
      ) : null}
      <path d="M8 21.6h8" />
    </svg>
  );
}

/**
 * "7 papers" / "1 paper".
 *
 * @param count - How many papers.
 * @returns The count with its noun.
 */
export function paperCountLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'paper' : 'papers'}`;
}

/** Props for `LabelHolder`. */
export interface LabelHolderProps {
  /** The topic name, written normally; the small caps come from the face. */
  readonly name: string;
  /** How many papers sit under this topic. */
  readonly count: number;
  /** Makes the holder a button (click to filter the shelf). */
  readonly onSelect?: () => void;
  /** Marks the active filter (`aria-pressed`), only meaningful with `onSelect`. */
  readonly selected?: boolean;
  readonly size?: ControlSize;
  readonly className?: string;
}

/**
 * A brass frame holding a paper card with the topic name and a count. A `<button>` when given
 * `onSelect`, named "Transformers & attention, 7 papers".
 *
 * @example
 * <LabelHolder name="Transformers & attention" count={7} onSelect={() => filter('transformers')} />
 */
export function LabelHolder({
  name,
  count,
  onSelect,
  selected,
  size = 'md',
  className,
}: LabelHolderProps): ReactNode {
  const accessibleName = `${name}, ${paperCountLabel(count)}`;
  const card = (
    <span className="pt-holder__card" aria-hidden="true">
      <span className="pt-holder__name">{name}</span>
      <span className="pt-holder__count">{count}</span>
    </span>
  );
  const classes = joinClasses('pt-holder', className);
  if (onSelect === undefined) {
    return (
      <div className={classes}>
        {card}
        <span className="pt-sr-only">{accessibleName}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      style={{ minHeight: size === 'touch' ? 44 : 38, touchAction: 'manipulation' }}
      aria-label={accessibleName}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {card}
    </button>
  );
}

/**
 * How far through a paper a 1-based page is.
 *
 * @param page - The 1-based current page.
 * @param pageCount - Pages in the paper.
 * @returns 0 to 1; page 1 of 1 is complete, and a bad count gives 0.
 */
export function readingFraction(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || !Number.isFinite(pageCount) || pageCount < 1) return 0;
  return Math.min(1, Math.max(0, page / pageCount));
}

/** Props for `ReadingNowRow`. */
export interface ReadingNowRowProps {
  readonly title: string;
  /** 1-based current page. */
  readonly page: number;
  readonly pageCount: number;
  readonly onContinue: () => void;
  /** The book's cloth colour for the small spine swatch; the ribbon ignores it. */
  readonly cloth?: string;
  /** Icon node for the Continue arrow. */
  readonly arrow?: ReactNode;
  readonly size?: ControlSize;
  readonly className?: string;
}

/**
 * A "Reading now" row: ribbon, Caslon title, a 4 px progress rule with a page tick, "p. 4 of 15"
 * and an outline Continue. The rule is decoration (`aria-hidden`); the text is the value.
 *
 * @example
 * <ReadingNowRow title="Attention Is All You Need" page={4} pageCount={15} onContinue={resume} />
 */
export function ReadingNowRow({
  title,
  page,
  pageCount,
  onContinue,
  cloth,
  arrow = '→',
  size = 'md',
  className,
}: ReadingNowRowProps): ReactNode {
  const percent = `${String(Math.round(readingFraction(page, pageCount) * 1000) / 10)}%`;
  const rule = { '--pt-readnow-fill': percent } as CSSProperties;
  return (
    <div className={joinClasses('pt-readnow', className)}>
      <span className="pt-readnow__ribbon" aria-hidden="true" />
      {cloth === undefined ? null : (
        <span className="pt-readnow__spine" style={{ background: cloth }} aria-hidden="true" />
      )}
      <div className="pt-readnow__text">
        <p className="pt-readnow__title">{title}</p>
        <div className="pt-readnow__rule" style={rule} aria-hidden="true">
          <span className="pt-readnow__tick" />
        </div>
      </div>
      <span className="pt-readnow__page">
        p. {page} of {pageCount}
      </span>
      <Button variant="outline" size={size} trailingIcon={arrow} onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}
