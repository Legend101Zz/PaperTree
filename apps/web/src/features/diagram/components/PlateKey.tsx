'use client';

/**
 * The plate's key (frame 07c, right column): one row per lettered part with its passage marker,
 * page tab and the quote it stands on. It is the plate's accessible content: each row is a button
 * that flashes the part's passage (or says it has none), and hovering or focusing one lights its box
 * in the drawing. A quote the paper holds word for word is the paper's voice; one it does not is the
 * AI's, marked "not verified"; an inferred part shows the AI's own line under "Inferred, no passage".
 */
import { PageTab, PaperText } from '@papertree/ui';
import { type ReactNode } from 'react';

import { cleanQuote } from '@/features/explain/model/anchor';

import { INFERRED_WORDS, tabOf, verdictOf } from '../model/plate';

import type { DiagramPart } from '@/lib/api/types';
import type { Route, Slot } from '../model/layout';

/** Props for `PlateKey`. */
export interface PlateKeyProps {
  readonly parts: readonly DiagramPart[];
  readonly gaps: readonly Slot[];
  /** The letter still arriving while the plate draws, or null. */
  readonly ghost: string | null;
  readonly numberOf: (part: DiagramPart) => number | null;
  /** The drawn arrows and links, said in each row's words. */
  readonly routes: readonly Route[];
  readonly lit: string | null;
  readonly onLight: (letter: string | null) => void;
  readonly onPart: (letter: string) => void;
}

const edgeWords = (letter: string, label: string | null): string =>
  label === null ? letter : `${letter} (${label})`;

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

function Evidence({ part }: { part: DiagramPart }): ReactNode {
  const verdict = verdictOf(part);
  const cite = part.cite;
  if (verdict === 'inferred' || cite === null) {
    return (
      <>
        <span className="pt-plate-key__caption">{INFERRED_WORDS}</span>
        <span className="pt-sr-only">. The AI&apos;s own line: </span>
        <span className="pt-plate-key__ai" data-voice="ai">
          {part.text}
        </span>
      </>
    );
  }
  const quote = `“${cleanQuote(cite.quote)}”`;
  if (verdict === 'cited') {
    return (
      <PaperText as="span" className="pt-plate-key__quote pt-paper-quote">
        {quote}
      </PaperText>
    );
  }
  // Not word for word in the paper: the AI's quote, never shown in the paper's voice.
  return (
    <>
      <span className="pt-sr-only">The AI&apos;s quote: </span>
      <span className="pt-plate-key__ai pt-plate-key__ai-quote" data-voice="ai">
        {quote}
      </span>
      {tabOf(cite) === null ? (
        <>
          <span className="pt-sr-only">. </span>
          <span className="pt-plate-key__caption">not verified · not found in the paper</span>
        </>
      ) : null}
    </>
  );
}

function KeyRow({
  part,
  n,
  lit,
  onLight,
  onPart,
  structure,
}: Pick<PlateKeyProps, 'onLight' | 'onPart'> & {
  part: DiagramPart;
  n: number | null;
  lit: boolean;
  structure: string | null;
}): ReactNode {
  const verdict = verdictOf(part);
  const tab = tabOf(part.cite);
  const status = verdict === 'cited' ? 'cited' : 'not-verified';
  // No aria-label: the row's own words (with the hidden ones) name the button, so a screen reader
  // hears the quote, the AI's line and the arrows too, in reading order (review S2).
  return (
    <li
      className="pt-plate-key__row"
      data-letter={part.letter}
      data-verdict={verdict}
      data-lit={lit}
    >
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
              {part.label}
            </span>
            {n === null ? null : <span className="pt-sr-only">. Passage {n}, </span>}
            {n === null ? null : (
              <span
                className={`pt-marker pt-marker--static${status === 'cited' ? '' : ' pt-marker--not-verified'}${lit ? ' is-lit' : ''}`}
                aria-hidden="true"
              >
                {n}
              </span>
            )}
            {tab === null ? null : (
              <PageTab page={tab.page} para={tab.para} status={status} lit={lit} />
            )}
          </span>
          <span className="pt-sr-only">. </span>
          <Evidence part={part} />
          {structure === null ? null : <span className="pt-sr-only"> {structure}</span>}
          {tab === null ? null : <span className="pt-sr-only"> Show in paper.</span>}
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
  numberOf,
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
            n={numberOf(part)}
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
