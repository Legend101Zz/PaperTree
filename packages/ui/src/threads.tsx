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

/** A mark drawn on a thread: its shape, and where (fixed fractions, or every so many px). */
export interface ThreadMark {
  readonly shape: 'plus' | 'cross' | 'chevron';
  /** Fractions of the line's length, e.g. `[0.5]`; used when `every` is absent. */
  readonly at?: readonly number[];
  /** Spacing in px along the line: marks repeat the whole length (at least one is drawn). */
  readonly every?: number;
  /** Stroke width of the mark, when heavier than the line's. */
  readonly weight?: number;
}

/**
 * How a kind's line is drawn: its second cue as data. The design-system strip, the board legend
 * and the board's real threads all draw from this one table (DESIGN.md §5).
 */
export interface ThreadLine {
  /** Stroke width of the line. */
  readonly width: number;
  /** `stroke-dasharray` when the line is not solid. */
  readonly dash?: string;
  /** Marks drawn on the line. */
  readonly marks?: ThreadMark;
  /** Two parallel lines. */
  readonly doubled?: boolean;
  /** A filled arrowhead at the far end. */
  readonly arrow?: boolean;
}

/** The cue of each kind. */
export const THREAD_LINES: Readonly<Record<ThreadKind, ThreadLine>> = {
  supports: { width: 2.25, marks: { shape: 'plus', at: [0.5], weight: 3 } },
  contradicts: { width: 2.25, dash: '7 5', marks: { shape: 'cross', every: 28 } },
  derives: { width: 2.25, marks: { shape: 'chevron', at: [0.5] } },
  answers: { width: 2.25, arrow: true },
  compares: { width: 2.25, doubled: true },
  references: { width: 3, dash: '0.5 5' },
  plain: { width: 1 },
};

/** Each mark's shape, centred on (0, 0) and pointing along +x (the way the thread runs). */
export const THREAD_MARK_PATHS: Readonly<Record<ThreadMark['shape'], string>> = {
  plus: 'M-4 0h8M0 -4v8',
  cross: 'M-3 -3l6 6M3 -3l-6 6',
  chevron: 'M-3 -4l4 4l-4 4M1 -4l4 4l-4 4',
};

/**
 * Where a line's marks go, as fractions of its length.
 *
 * @param line The kind's line.
 * @param length The line's length in px.
 * @returns The fractions, in order (empty when the kind has no marks).
 * @example
 * markPositions(THREAD_LINES.contradicts, 116); // [28, 56, 84] / 116
 */
export function markPositions(line: ThreadLine, length: number): number[] {
  const marks = line.marks;
  if (marks === undefined) return [];
  if (marks.every === undefined) return [...(marks.at ?? [0.5])];
  const out: number[] = [];
  for (let s = marks.every; s <= length - marks.every / 2; s += marks.every) out.push(s / length);
  return out.length === 0 ? [0.5] : out;
}

const MID = 8;

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
  const marks = spec.marks;
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
      {marks === undefined
        ? null
        : markPositions(spec, w - 4).map((f, i) => (
            <path
              key={i}
              d={THREAD_MARK_PATHS[marks.shape]}
              transform={`translate(${String(2 + f * (w - 4))} ${String(MID)})`}
              {...(marks.weight === undefined ? {} : { strokeWidth: marks.weight })}
            />
          ))}
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
