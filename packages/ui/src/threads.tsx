/**
 * ThreadSwatch: a relation kind drawn as the line it is on the board, with its SECOND CUE (DESIGN.md
 * §5) so colour is never the only difference between two kinds. Shared by the design-system legend
 * and, later, the "Link as" picker; the board's real edges draw the same patterns.
 */
import type { ReactNode } from 'react';

/** The seven relation kinds. */
export type ThreadKind =
  'supports' | 'contradicts' | 'derives' | 'answers' | 'compares' | 'references' | 'plain';

/** What a kind is called, its glyph and the non-colour cue it draws. */
export interface ThreadKindInfo {
  readonly kind: ThreadKind;
  /** The name on the paper tag. */
  readonly label: string;
  /** The glyph on the paper tag. */
  readonly glyph: string;
  /** The cue drawn on the line, in words (also the `data-cue` attribute). */
  readonly cue: string;
}

/** The seven kinds in the design's order. */
export const THREAD_KINDS: readonly ThreadKindInfo[] = [
  { kind: 'supports', label: 'supports', glyph: '+', cue: 'solid with plus' },
  { kind: 'contradicts', label: 'contradicts', glyph: '×', cue: 'dashed with crosses' },
  { kind: 'derives', label: 'derives from', glyph: '»', cue: 'chevrons on the line' },
  { kind: 'answers', label: 'answers', glyph: '→', cue: 'arrowhead' },
  { kind: 'compares', label: 'compares with', glyph: '=', cue: 'doubled line' },
  { kind: 'references', label: 'references', glyph: '⋯', cue: 'dotted' },
  { kind: 'plain', label: 'plain link', glyph: '—', cue: 'fine line' },
];

const W = 120;
const MID = 8;

/** A small × centred at x. */
const cross = (x: number): string =>
  `M${String(x - 3)} ${String(MID - 3)}l6 6M${String(x + 3)} ${String(MID - 3)}l-6 6`;
/** A small » chevron centred at x. */
const chevron = (x: number): string =>
  `M${String(x - 3)} ${String(MID - 4)}l4 4l-4 4M${String(x + 1)} ${String(MID - 4)}l4 4l-4 4`;

/** The SVG shapes of one kind, all stroked with `currentColor` (set to the kind's wire token). */
function Shapes({ kind }: { readonly kind: ThreadKind }): ReactNode {
  const line = (y: number, extra?: object): ReactNode => (
    <line x1="2" y1={y} x2={W - 2} y2={y} {...extra} />
  );
  switch (kind) {
    case 'supports':
      return (
        <>
          {line(MID)}
          <path
            d={`M${String(W / 2 - 4)} ${String(MID)}h8M${String(W / 2)} ${String(MID - 4)}v8`}
            strokeWidth="3"
          />
        </>
      );
    case 'contradicts':
      return (
        <>
          {line(MID, { strokeDasharray: '7 5' })}
          <path d={[24, 60, 96].map(cross).join('')} />
        </>
      );
    case 'derives':
      return (
        <>
          {line(MID)}
          <path d={[24, 60, 96].map(chevron).join('')} />
        </>
      );
    case 'answers':
      return (
        <>
          <line x1="2" y1={MID} x2={W - 10} y2={MID} />
          <path
            d={`M${String(W - 12)} ${String(MID - 5)}L${String(W - 2)} ${String(MID)}L${String(W - 12)} ${String(MID + 5)}z`}
            fill="currentColor"
          />
        </>
      );
    case 'compares':
      return (
        <>
          {line(MID - 2.5)}
          {line(MID + 2.5)}
        </>
      );
    case 'references':
      return line(MID, { strokeDasharray: '0.5 5', strokeLinecap: 'round', strokeWidth: 3 });
    case 'plain':
      return line(MID, { strokeWidth: 1 });
  }
}

/** Props for `ThreadSwatch`. */
export interface ThreadSwatchProps {
  readonly kind: ThreadKind;
  readonly className?: string;
}

/**
 * One relation kind: its line with the second cue drawn, then the glyph and name as text. The whole
 * swatch is one image named "contradicts: dashed with crosses", so a screen reader gets the cue too.
 *
 * @example
 * <ThreadSwatch kind="contradicts" />
 */
export function ThreadSwatch({ kind, className }: ThreadSwatchProps): ReactNode {
  const info = THREAD_KINDS.find((k) => k.kind === kind) ?? THREAD_KINDS[0]!;
  return (
    <span
      className={`pt-thread-swatch${className === undefined ? '' : ` ${className}`}`}
      role="img"
      aria-label={`${info.label}: ${info.cue}`}
      data-kind={kind}
    >
      <svg
        className="pt-thread-swatch__line"
        width={W}
        height="16"
        viewBox={`0 0 ${String(W)} 16`}
        data-cue={info.cue}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: `var(--pt-wire-${kind})` }}
      >
        <Shapes kind={kind} />
      </svg>
      <span className="pt-thread-swatch__tag" aria-hidden="true">
        <span className="pt-thread-swatch__glyph">{info.glyph}</span> {info.label}
      </span>
    </span>
  );
}
