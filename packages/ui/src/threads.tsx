/**
 * ThreadSwatch: a relation kind drawn as the line it is on the board, with its SECOND CUE (DESIGN.md
 * §5) so colour is never the only difference between two kinds. Shared by the design-system strip,
 * the board legend and, later, the "Link as" picker; the board's real threads read `THREAD_LINES`.
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

/**
 * How a kind's line is drawn: its second cue as data, so the swatch, the legend and the board's
 * real threads draw the same thing (DESIGN.md §5).
 */
export interface ThreadLine {
  /** Stroke width of the line. */
  readonly width: number;
  /** `stroke-dasharray` when the line is not solid. */
  readonly dash?: string;
  /** Marks drawn on the line. */
  readonly marks?: 'plus' | 'cross' | 'chevron';
  /** Two parallel lines. */
  readonly doubled?: boolean;
  /** A filled arrowhead at the far end. */
  readonly arrow?: boolean;
}

/** The cue of each kind. */
export const THREAD_LINES: Readonly<Record<ThreadKind, ThreadLine>> = {
  supports: { width: 2.25, marks: 'plus' },
  contradicts: { width: 2.25, dash: '7 5', marks: 'cross' },
  derives: { width: 2.25, marks: 'chevron' },
  answers: { width: 2.25, arrow: true },
  compares: { width: 2.25, doubled: true },
  references: { width: 3, dash: '0.5 5' },
  plain: { width: 1 },
};

const MID = 8;

/** A small × centred at x. */
const cross = (x: number): string =>
  `M${String(x - 3)} ${String(MID - 3)}l6 6M${String(x + 3)} ${String(MID - 3)}l-6 6`;
/** A small » chevron centred at x. */
const chevron = (x: number): string =>
  `M${String(x - 3)} ${String(MID - 4)}l4 4l-4 4M${String(x + 1)} ${String(MID - 4)}l4 4l-4 4`;
/** A + centred at x, drawn heavier than the line. */
const plus = (x: number): string =>
  `M${String(x - 4)} ${String(MID)}h8M${String(x)} ${String(MID - 4)}v8`;

/** The SVG shapes of one kind `w` wide, all stroked with `currentColor` (the kind's wire token). */
function Shapes({ kind, w }: { readonly kind: ThreadKind; readonly w: number }): ReactNode {
  const spec = THREAD_LINES[kind];
  const end = spec.arrow === true ? w - 10 : w - 2;
  const line = (y: number): ReactNode => (
    <line
      x1="2"
      y1={y}
      x2={end}
      y2={y}
      {...(spec.dash === undefined
        ? {}
        : { strokeDasharray: spec.dash, strokeLinecap: spec.width > 2.25 ? 'round' : undefined })}
      {...(spec.width === 2.25 ? {} : { strokeWidth: spec.width })}
    />
  );
  const at = [0.2, 0.5, 0.8].map((f) => Math.round(w * f));
  return (
    <>
      {spec.doubled === true ? (
        <>
          {line(MID - 2.5)}
          {line(MID + 2.5)}
        </>
      ) : (
        line(MID)
      )}
      {spec.marks === 'plus' ? <path d={plus(w / 2)} strokeWidth="3" /> : null}
      {spec.marks === 'cross' ? <path d={at.map(cross).join('')} /> : null}
      {spec.marks === 'chevron' ? <path d={at.map(chevron).join('')} /> : null}
      {spec.arrow === true ? (
        <path
          d={`M${String(w - 12)} ${String(MID - 5)}L${String(w - 2)} ${String(MID)}L${String(w - 12)} ${String(MID + 5)}z`}
          fill="currentColor"
        />
      ) : null}
    </>
  );
}

/** Props for `ThreadSwatch`. */
export interface ThreadSwatchProps {
  readonly kind: ThreadKind;
  readonly className?: string;
  /** The line's length in px. Default 120 (the design-system strip); the board legend uses 34. */
  readonly width?: number;
}

/**
 * One relation kind: its line with the second cue drawn, then the glyph and name as text. The whole
 * swatch is one image named "contradicts: dashed with crosses", so a screen reader gets the cue too.
 *
 * @example
 * <ThreadSwatch kind="contradicts" />
 */
export function ThreadSwatch({ kind, className, width = 120 }: ThreadSwatchProps): ReactNode {
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
        width={width}
        height="16"
        viewBox={`0 0 ${String(width)} 16`}
        data-cue={info.cue}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: `var(--pt-wire-${kind})` }}
      >
        <Shapes kind={kind} w={width} />
      </svg>
      <span className="pt-thread-swatch__tag" aria-hidden="true">
        <span className="pt-thread-swatch__glyph">{info.glyph}</span> {info.label}
      </span>
    </span>
  );
}
