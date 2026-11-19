/**
 * ui/sources — the one quiet line under an AI answer's paragraph (v0.3, #340).
 *
 * The AI is a tutor, not an auditor: a paragraph that leans on the paper ends with
 * `From the paper: p. 1 · p. 4`, and one that does not ends with `General knowledge`, in the same
 * quiet type. Neither is a verdict, a count or a warning. Each page is a real button: hover or
 * focus peeks the passage's first words in a small popover, a click runs the caller's flash (the
 * reader scrolls there and pulses the passage). Nothing sits inside a line of prose.
 *
 * Presentation lives in the "AI answer sources (#340)" section of `styles.css`.
 */

import { useId, useState, type ReactNode } from 'react';

import { formatPageLabel } from './citations.js';
import { PaperText } from './provenance.js';

/** The words a source line starts with. */
export const FROM_THE_PAPER = 'From the paper:';

/** The words a paragraph with no paper source carries. */
export const GENERAL_KNOWLEDGE = 'General knowledge';

/** One page a paragraph draws on, and what a click on it does. */
export interface SourceLink {
  /** 1-based page. */
  readonly page: number;
  /** The passage's words (any length); the peek shows its first few. Empty: no peek. */
  readonly passage: string;
  /** The reader's flash for this passage. */
  readonly onShow: () => void;
}

/** Props for `SourceLine`. */
export interface SourceLineProps {
  /** The pages, already de-duplicated and in the order to draw them. */
  readonly sources: readonly SourceLink[];
  /**
   * Draw "General knowledge" when there are no sources. False while an answer still streams: a
   * paragraph's handle may not have resolved yet, and the line must never flip under the reader.
   */
  readonly general?: boolean;
  /** The phone sheet: each page answers taps over 44 px. */
  readonly touch?: boolean;
}

/** The longest peek, in characters; cut at a word and closed with an ellipsis. */
const PEEK_CHARS = 110;

/**
 * The first words of a passage, for the peek.
 *
 * @param passage The passage's words.
 * @param limit The most characters to keep. Default 110.
 * @returns The passage on one line, cut at a word with `…` when it is longer; "" when empty.
 * @example
 * firstWords('Attention is all you need', 9); // 'Attention…'
 */
export function firstWords(passage: string, limit: number = PEEK_CHARS): string {
  const line = passage.replace(/\s+/g, ' ').trim();
  if (line.length <= limit) return line;
  const cut = line.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * The quiet source line: `From the paper: p. 1 · p. 4`, or `General knowledge`.
 *
 * @example
 * <SourceLine sources={[{ page: 1, passage: 'We propose…', onShow: flash }]} general />
 */
export function SourceLine({ sources, general = true, touch = false }: SourceLineProps): ReactNode {
  const id = useId();
  const [open, setOpen] = useState<number | null>(null);
  if (sources.length === 0) {
    return general ? (
      <p className="pt-source pt-source--general" data-source="general">
        {GENERAL_KNOWLEDGE}
      </p>
    ) : null;
  }
  return (
    <p
      className="pt-source"
      data-source="paper"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open !== null) setOpen(null);
      }}
    >
      {FROM_THE_PAPER}{' '}
      {sources.map((source, index) => {
        const peek = firstWords(source.passage);
        const peekId = `${id}-${String(index)}`;
        const label = formatPageLabel(source.page);
        return (
          <span key={source.page} className="pt-source__item">
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            <button
              type="button"
              className={`pt-source__page${touch ? ' pt-source__page--touch' : ''}`}
              aria-label={`Show ${label} in the paper`}
              {...(peek === '' ? {} : { 'aria-describedby': peekId })}
              onClick={source.onShow}
              onMouseEnter={() => setOpen(index)}
              onMouseLeave={() => setOpen((was) => (was === index ? null : was))}
              onFocus={() => setOpen(index)}
              onBlur={() => setOpen((was) => (was === index ? null : was))}
            >
              {label}
            </button>
            {peek === '' ? null : (
              <span
                id={peekId}
                role="tooltip"
                className="pt-source__peek"
                hidden={open !== index}
                data-peek={source.page}
              >
                <span className="pt-source__peek-page">{label}</span>
                <PaperText as="span" className="pt-source__peek-text">
                  {`“${peek}”`}
                </PaperText>
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}
