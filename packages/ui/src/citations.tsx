/**
 * ui/citations — the numbered marker, the margin tab and the coverage line (v0.2, #190).
 *
 * These are the pieces of "ask -> answer -> trace" that tie an AI claim to the paper: a small
 * numbered marker beside the claim, a margin tab saying where in the paper it stands ("p. 2 ¶2"),
 * and a one-line account of how much of the answer is cited. Honest labels only: a claim is "cited"
 * or "not verified", never "checked" (AGENTS.md §2). Colour is never the only cue: a not-verified
 * tab is dashed and open AND says so in words; a lit marker is navy AND outlined.
 *
 * Presentation lives in the "v0.2 voices and citations (#190)" section of `styles.css`.
 */

import type { ReactNode } from 'react';

/** Props for `NumberedMarker`. */
export interface NumberedMarkerProps {
  /** The passage number shown in the square. */
  readonly n: number;
  /**
   * Where the passage is, e.g. `"p. 2 ¶2"`. The accessible name is `Passage {n}, {label}`, with
   * `, not verified` added when `notVerified` (the dashed outline alone is not announced).
   */
  readonly label: string;
  /** True while the matching trace row (or claim) is lit. */
  readonly lit?: boolean;
  /** Run the citation flash: scroll to the passage and flash it. Click, Enter and Space. */
  readonly onFlash: () => void;
  /** Hover or focus in (`true`) and out (`false`), so the trace row can light in step. */
  readonly onLight?: (lit: boolean) => void;
  /** Dashed outline instead of a solid fill: the claim's passage was not verified. */
  readonly notVerified?: boolean;
  /** `touch` gives the phone a 44 px target around the same small square. */
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
  notVerified = false,
  size = 'compact',
}: NumberedMarkerProps): ReactNode {
  const light = (on: boolean): void => onLight?.(on);
  return (
    <button
      type="button"
      className={`pt-marker${size === 'touch' ? ' pt-marker--touch' : ''}${notVerified ? ' pt-marker--not-verified' : ''}${lit ? ' is-lit' : ''}`}
      aria-label={`Passage ${String(n)}, ${label}${notVerified ? ', not verified' : ''}`}
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
  /** `cited` = solid swallowtail; `not-verified` = dashed open tab plus a caption. */
  readonly status?: 'cited' | 'not-verified';
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

/**
 * The margin tab saying where in the paper a claim stands.
 *
 * The not-verified variant is deliberately not a recoloured cited tab: it loses its fill and its
 * swallowtail and gains a dashed edge and the words "not verified", so it reads without colour.
 */
export function PageTab({ page, para, status = 'cited', lit = false }: PageTabProps): ReactNode {
  const notVerified = status === 'not-verified';
  return (
    <span className="pt-tab-group">
      <span
        className={`pt-tab${notVerified ? ' pt-tab--not-verified' : ''}${lit ? ' is-lit' : ''}`}
        data-status={status}
      >
        {formatPageLabel(page, para)}
      </span>
      {notVerified ? <span className="pt-nv-caption">not verified</span> : null}
    </span>
  );
}

/** The counts `CoverageReadout` reports. */
export interface Coverage {
  /** Distinct passages the answer stands on. */
  readonly passages: number;
  /** Citation markers in the answer (a passage can be cited more than once). */
  readonly citations: number;
  /** Paragraphs with no citation: the AI's own reading. */
  readonly uncitedParagraphs: number;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

/**
 * The coverage sentence: "Stands on 4 passages · 11 citations · 1 paragraph uncited (the AI's own
 * reading)". Singular and plural are handled; the uncited clause is left out when it is zero.
 *
 * @param coverage The three counts.
 * @returns The sentence, with no trailing full stop.
 * @example
 * formatCoverage({ passages: 1, citations: 1, uncitedParagraphs: 0 }); // "Stands on 1 passage · 1 citation"
 */
export function formatCoverage(coverage: Coverage): string {
  const parts = [
    `Stands on ${coverage.passages === 0 ? 'no passages' : plural(coverage.passages, 'passage', 'passages')}`,
    plural(coverage.citations, 'citation', 'citations'),
  ];
  if (coverage.uncitedParagraphs > 0) {
    parts.push(
      `${plural(coverage.uncitedParagraphs, 'paragraph', 'paragraphs')} uncited (the AI's own reading)`,
    );
  }
  return parts.join(' · ');
}

/** One line under the answer: how much of it is cited, with the pilcrow icon. */
export function CoverageReadout(props: Coverage): ReactNode {
  return (
    <p className="pt-coverage" data-uncited={props.uncitedParagraphs}>
      <span className="pt-coverage__icon" aria-hidden="true">
        ¶
      </span>
      <span>{formatCoverage(props)}</span>
    </p>
  );
}
