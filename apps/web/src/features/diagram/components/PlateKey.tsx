'use client';

/**
 * The plate's key (frame 07c, right column, #340): one row per lettered part with its label, the
 * AI's line and, when the part came from a passage, one quiet "From the paper: p. 4". No verdict,
 * no marker. It is the plate's accessible content: each row is a button that flashes the part's
 * passage (or says it has none), and hovering or focusing one lights its box in the drawing.
 */
import { FROM_THE_PAPER, formatPageLabel } from '@papertree/ui';
import { type ReactNode } from 'react';

import { mathToPlain } from '@/lib/markdown';
import { MathText } from '@/lib/MathText';

import { pageOf } from '../model/plate';

import type { DiagramPart } from '@/lib/api/types';
import type { Route, Slot } from '../model/layout';

/** Props for `PlateKey`. */
export interface PlateKeyProps {
  readonly parts: readonly DiagramPart[];
  readonly gaps: readonly Slot[];
  /** The letter still arriving while the plate draws, or null. */
  readonly ghost: string | null;
  /** The drawn arrows and links, said in each row's words. */
  readonly routes: readonly Route[];
  readonly lit: string | null;
  readonly onLight: (letter: string | null) => void;
  readonly onPart: (letter: string) => void;
}

const edgeWords = (letter: string, label: string | null): string =>
  label === null ? letter : `${letter} (${mathToPlain(label)})`;

const listed = (words: readonly string[]): string =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;

/**
 * What the drawing says about a part that the key must say too (#217 review S2): the arrows into
 * it, with their labels, and the feedback links out of it, in words. The key is the plate's only
 * text alternative, so a diagram never reaches a screen reader as a list of boxes.
 *
 * @param letter The part's letter.
 * @param routes The layout's routes (what is drawn, so the words never claim an arrow the drawing
 *   dropped).
 * @returns e.g. "Arrows in from D and A (V).", or null when nothing points at or from it.
 */
export function structureOf(letter: string, routes: readonly Route[]): string | null {
  const into = routes.filter((r) => !r.feedback && r.to === letter);
  const back = routes.filter((r) => r.feedback && r.from === letter);
  const words: string[] = [];
  if (into.length > 0) {
    const from = listed(into.map((r) => edgeWords(r.from, r.label)));
    words.push(`${into.length === 1 ? 'Arrow' : 'Arrows'} in from ${from}.`);
  }
  if (back.length > 0) {
    const to = listed(back.map((r) => edgeWords(r.to, r.label)));
    words.push(`${back.length === 1 ? 'Link' : 'Links'} back to ${to}.`);
  }
  return words.length === 0 ? null : words.join(' ');
}

function KeyRow({
  part,
  lit,
  onLight,
  onPart,
  structure,
}: Pick<PlateKeyProps, 'onLight' | 'onPart'> & {
  part: DiagramPart;
  lit: boolean;
  structure: string | null;
}): ReactNode {
  const page = pageOf(part.cite);
  // No aria-label: the row's own words (with the hidden ones) name the button, so a screen reader
  // hears the quote, the AI's line and the arrows too, in reading order (review S2).
  return (
    <li className="pt-plate-key__row" data-letter={part.letter} data-lit={lit}>
      <button
        type="button"
        className="pt-plate-key__part"
        onClick={() => onPart(part.letter)}
        onMouseEnter={() => onLight(part.letter)}
        onMouseLeave={() => onLight(null)}
        onFocus={() => onLight(part.letter)}
        onBlur={() => onLight(null)}
      >
        <span className="pt-plate-key__letter" aria-hidden="true">
          {part.letter}
        </span>
        <span className="pt-sr-only">Part {part.letter}: </span>
        <span className="pt-plate-key__body">
          <span className="pt-plate-key__head">
            <span className="pt-plate-key__label" data-voice="ai">
              <MathText text={part.label} />
            </span>
          </span>
          <span className="pt-sr-only">. </span>
          <span className="pt-plate-key__ai" data-voice="ai">
            <MathText text={part.text} />
          </span>
          {page === null ? null : (
            <>
              <span className="pt-sr-only">. </span>
              <span className="pt-plate-key__source" data-source="paper">
                {FROM_THE_PAPER} {formatPageLabel(page)}
              </span>
            </>
          )}
          {structure === null ? null : <span className="pt-sr-only"> {structure}</span>}
          {page === null ? null : <span className="pt-sr-only"> Show in paper.</span>}
        </span>
      </button>
    </li>
  );
}

/** The key: every part in letter order, an empty row for a dropped letter, the part arriving. */
export function PlateKey({
  parts,
  gaps,
  ghost,
  routes,
  lit,
  onLight,
  onPart,
}: PlateKeyProps): ReactNode {
  const rows = [
    ...parts.map((part) => ({ letter: part.letter, part })),
    ...gaps.map((gap) => ({ letter: gap.letter, part: null })),
  ].sort((a, b) => a.letter.localeCompare(b.letter));
  return (
    <ol className="pt-plate-key" aria-label="Key to the plate">
      {rows.map(({ letter, part }) =>
        part === null ? (
          <li key={letter} className="pt-plate-key__row" data-gap={letter}>
            <span className="pt-plate-key__letter" aria-hidden="true">
              {letter}
            </span>
            {/* The API leaves a part out for an unreadable line or one the table refused: the
                browser knows only that it is missing (review N6). */}
            <span className="pt-plate-key__body pt-plate-key__caption">
              Part {letter} was left out of the plate.
            </span>
          </li>
        ) : (
          <KeyRow
            key={letter}
            part={part}
            structure={structureOf(letter, routes)}
            lit={lit === letter}
            onLight={onLight}
            onPart={onPart}
          />
        ),
      )}
      {ghost === null ? null : (
        <li className="pt-plate-key__row" data-ghost={ghost} aria-hidden="true">
          <span className="pt-plate-key__letter">{ghost}</span>
          <span className="pt-plate-key__body">
            <span className="pt-plate-key__head">arriving…</span>
            <span className="pt-plate-key__bar" />
          </span>
        </li>
      )}
    </ol>
  );
}
