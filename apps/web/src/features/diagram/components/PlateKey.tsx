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
import type { Slot } from '../model/layout';

/** Props for `PlateKey`. */
export interface PlateKeyProps {
  readonly parts: readonly DiagramPart[];
  readonly gaps: readonly Slot[];
  /** The letter still arriving while the plate draws, or null. */
  readonly ghost: string | null;
  readonly numberOf: (part: DiagramPart) => number | null;
  readonly lit: string | null;
  readonly onLight: (letter: string | null) => void;
  readonly onPart: (letter: string) => void;
}

/**
 * A part's accessible name: its letter, label and where it stands (or that it stands nowhere).
 *
 * @param part The part.
 * @param n Its passage number, or null.
 * @returns e.g. "Part C, Scale ÷ √dk, passage 1, p. 4 ¶1: show in paper".
 */
export function partName(part: DiagramPart, n: number | null): string {
  const verdict = verdictOf(part);
  const head = `Part ${part.letter}, ${part.label}`;
  if (verdict === 'inferred') return `${head}, inferred, no passage`;
  const tab = tabOf(part.cite);
  const where =
    tab === null
      ? ''
      : `, p. ${String(tab.page)}${tab.para === null ? '' : ` ¶${String(tab.para)}`}`;
  const passage = n === null ? '' : `, passage ${String(n)}`;
  if (verdict === 'not-verified') {
    return tab === null
      ? `${head}, not verified, its quote was not found in the paper`
      : `${head}${passage}${where}, not verified: show in paper`;
  }
  return `${head}${passage}${where}: show in paper`;
}

function Evidence({ part }: { part: DiagramPart }): ReactNode {
  const verdict = verdictOf(part);
  const cite = part.cite;
  if (verdict === 'inferred' || cite === null) {
    return (
      <>
        <span className="pt-plate-key__caption">{INFERRED_WORDS}</span>
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
      <span className="pt-plate-key__ai pt-plate-key__ai-quote" data-voice="ai">
        {quote}
      </span>
      {tabOf(cite) === null ? (
        <span className="pt-plate-key__caption">not verified · not found in the paper</span>
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
}: Pick<PlateKeyProps, 'onLight' | 'onPart'> & {
  part: DiagramPart;
  n: number | null;
  lit: boolean;
}): ReactNode {
  const verdict = verdictOf(part);
  const tab = tabOf(part.cite);
  const status = verdict === 'cited' ? 'cited' : 'not-verified';
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
        aria-label={partName(part, n)}
        onClick={() => onPart(part.letter)}
        onMouseEnter={() => onLight(part.letter)}
        onMouseLeave={() => onLight(null)}
        onFocus={() => onLight(part.letter)}
        onBlur={() => onLight(null)}
      >
        <span className="pt-plate-key__letter" aria-hidden="true">
          {part.letter}
        </span>
        <span className="pt-plate-key__body">
          <span className="pt-plate-key__head">
            <span className="pt-plate-key__label" data-voice="ai">
              {part.label}
            </span>
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
          <Evidence part={part} />
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
            <span className="pt-plate-key__body pt-plate-key__caption">
              Part {letter} not drawn: its line could not be read
            </span>
          </li>
        ) : (
          <KeyRow
            key={letter}
            part={part}
            n={numberOf(part)}
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
