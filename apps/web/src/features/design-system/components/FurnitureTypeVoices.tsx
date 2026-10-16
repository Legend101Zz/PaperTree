/**
 * Furniture (cloths, gilt, brass, walnut, kraft), the five highlight washes, the type scale and
 * the three voices. Every swatch and face reads a real token or a real shared component.
 */
'use client';

import { AiText, PaperText, YouText } from '@papertree/ui';

import { CLOTHS, HIGHLIGHTS } from '../model/roles';

import type { ReactNode } from 'react';

const TYPE_ROWS: readonly {
  readonly role: string;
  readonly font: string;
  readonly size: string;
  readonly sample: string;
  readonly note: string;
}[] = [
  {
    role: 'Display',
    font: '--pt-font-display',
    size: '--pt-t-display-l',
    sample: 'Your library',
    note: 'Libre Caslon Display, 56/40/34/30: only at 28 px and up',
  },
  {
    role: 'Paper words',
    font: '--pt-font-paper',
    size: '--pt-t-paper',
    sample: '“based solely on attention mechanisms”',
    note: 'Libre Caslon Text: quotation marks mark paper words',
  },
  {
    role: 'AI text · UI',
    font: '--pt-font-ai',
    size: '--pt-t-ai',
    sample: 'The passage states the paper’s central proposal.',
    note: 'Alegreya Sans, 15 and 14.5',
  },
  {
    role: 'Labels',
    font: '--pt-font-label',
    size: '--pt-t-label',
    sample: 'Reading now · no citation',
    note: 'Alegreya Sans SC, real small caps, never faked from lowercase',
  },
  {
    role: 'Your words',
    font: '--pt-font-you',
    size: '--pt-t-you',
    sample: 'Why does dropping recurrence make training faster?',
    note: 'Courier Prime, pen ink: asks, follow-ups, notes',
  },
  {
    role: 'Numbers',
    font: '--pt-font-you',
    size: '--pt-t-num',
    sample: 'p. 4 of 15 · 4,776 tokens · ≈ $0.0027 (estimate)',
    note: 'Courier Prime, lining, tabular',
  },
];

/** The furniture and highlight tables. */
export function Furniture(): ReactNode {
  return (
    <section className="ds-section" aria-labelledby="ds-furniture">
      <h2 id="ds-furniture" className="ds-h2">
        Furniture and washes
      </h2>
      <p className="ds-lede">
        Cloth, gilt, brass and walnut are the furniture; the five washes are the highlighter.
      </p>
      <ul className="ds-chips" aria-label="Topic cloths">
        {CLOTHS.map((c) => (
          <li key={c.token} className="ds-chip">
            <span
              className="ds-chip__swatch"
              style={{ background: `var(${c.token})` }}
              aria-hidden="true"
            />
            {c.name}
          </li>
        ))}
        <li className="ds-chip">
          <span
            className="ds-chip__swatch"
            style={{ background: 'var(--pt-gilt)' }}
            aria-hidden="true"
          />
          Gilt foil
        </li>
        <li className="ds-chip">
          <span
            className="ds-chip__swatch"
            style={{ background: 'var(--pt-brass)' }}
            aria-hidden="true"
          />
          Brass
        </li>
        <li className="ds-chip">
          <span
            className="ds-chip__swatch"
            style={{ background: 'var(--pt-walnut)' }}
            aria-hidden="true"
          />
          Walnut
        </li>
        <li className="ds-chip">
          <span
            className="ds-chip__swatch"
            style={{ background: 'var(--pt-kraft)' }}
            aria-hidden="true"
          />
          Kraft
        </li>
      </ul>
      <ul className="ds-chips" aria-label="Highlight washes">
        {HIGHLIGHTS.map((h) => (
          <li key={h} className="ds-chip">
            <span
              className="ds-chip__swatch"
              style={{ background: `var(--pt-hl-${h})`, borderColor: `var(--pt-hl-${h}-ink)` }}
              aria-hidden="true"
            />
            {h}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The type scale and the three voices. */
export function TypeVoices(): ReactNode {
  return (
    <>
      <section className="ds-section" aria-labelledby="ds-type">
        <h2 id="ds-type" className="ds-h2">
          Type
        </h2>
        <p className="ds-lede">
          Three voices, three faces. The face tells you who is speaking before you read a word.
        </p>
        <dl className="ds-type">
          {TYPE_ROWS.map((row) => (
            <div key={row.role} className="ds-type__row">
              <dt className="ds-label">{row.role}</dt>
              <dd
                className="ds-type__sample"
                style={{ fontFamily: `var(${row.font})`, fontSize: `var(${row.size})` }}
              >
                {row.sample}
              </dd>
              <dd className="ds-type__note">{row.note}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="ds-section" aria-labelledby="ds-voices">
        <h2 id="ds-voices" className="ds-h2">
          Who wrote this? Marking AI, paper and you
        </h2>
        <p className="ds-lede">
          The product’s first promise: you can always tell the paper’s words from the AI’s, and both
          from your own.
        </p>
        <div className="ds-voices">
          <div>
            <h3 className="ds-label">The paper’s words</h3>
            <PaperText as="blockquote" pageLabel="p. 2">
              “Recurrent models typically factor computation along the symbol positions of the input
              and output sequences.”
            </PaperText>
          </div>
          <div>
            <h3 className="ds-label">The AI</h3>
            <AiText model="placeholder model">
              Placeholder text: an AI paraphrase of the passage would sit here, under the reserved
              marker.
            </AiText>
          </div>
          <div>
            <h3 className="ds-label">You</h3>
            <YouText>Explain this passage</YouText>
          </div>
        </div>
      </section>
    </>
  );
}
