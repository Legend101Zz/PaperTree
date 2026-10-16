/**
 * board/components/BoardIcon — the board's line icons, drawn from frame 06's and 06b's mock-ups
 * (20-unit grid, 1.5 stroke, round ends, `currentColor`), so the bar reads as the design draws it.
 * Decorative: every icon sits beside its words or inside a named button.
 */
import type { ReactNode } from 'react';

/** The icons the board draws. */
export type BoardIconName =
  | 'back'
  | 'select'
  | 'note'
  | 'frame'
  | 'thread'
  | 'fit'
  | 'minus'
  | 'plus'
  | 'more'
  | 'pin'
  | 'map';

const SHAPES: Readonly<Record<BoardIconName, ReactNode>> = {
  back: <path d="M16 10H4M9 5l-5 5 5 5" />,
  select: <path d="M4.5 3l10.5 7.8-4.6.6 2.6 5.2-2 1-2.6-5.2-3.9 3z" />,
  note: (
    <>
      <rect x="3" y="4" width="14" height="12" rx=".5" />
      <path d="M6 8h8M6 11.5h5" />
    </>
  ),
  frame: <rect x="3" y="3" width="14" height="14" strokeDasharray="2.4 2" />,
  thread: (
    <>
      <circle cx="4.5" cy="15" r="1.9" />
      <circle cx="15.5" cy="5" r="1.9" />
      <path d="M6.2 13.8c3.4 2.4 4.6-6.4 7.6-7.6" />
    </>
  ),
  fit: <path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4" />,
  minus: <path d="M5 10h10" />,
  plus: <path d="M10 5v10M5 10h10" />,
  more: <path d="M4.5 10h.01M10 10h.01M15.5 10h.01" strokeWidth={3} />,
  pin: (
    <>
      <circle cx="10" cy="7" r="3.6" />
      <path d="M10 10.6V17.2" />
    </>
  ),
  map: (
    <>
      <rect x="3" y="4" width="14" height="12" rx=".5" />
      <rect x="6" y="7" width="5" height="4" />
    </>
  ),
};

/** Props for `BoardIcon`. */
export interface BoardIconProps {
  readonly name: BoardIconName;
  /** Pixels; 20 in the bar, 18 in the empty board's hints. */
  readonly size?: number;
}

/**
 * One of the board's icons, `aria-hidden`.
 *
 * @example
 * <BoardIcon name="thread" />
 */
export function BoardIcon({ name, size = 20 }: BoardIconProps): ReactNode {
  return (
    <svg
      className="pt-boardicon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[name]}
    </svg>
  );
}
