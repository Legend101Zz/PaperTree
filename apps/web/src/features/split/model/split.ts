/**
 * split/model/split — the split view's sizes and what is remembered (P4 step 7, V3-25, #344). Pure.
 *
 * The paper is on the left and the board on the right. Where the divider sits is a SHARE of the
 * window (what the board takes), so the split survives a resize and a second window size. Either
 * side can be folded to a 44 px strip; a fold the reader did not ask for (the board widening on the
 * first branch, #349) is `auto`: it is never remembered, and one click puts the paper back.
 */

/** The narrowest paper that is still a page worth reading, and the narrowest board that fits a card pair. */
export const MIN_PAPER = 360;
export const MIN_BOARD = 400;
/** A folded side is this wide: a strip with one button. */
export const STRIP_WIDTH = 44;
/** The window below which there is no room for two panes (the explain drawer's own breakpoint). */
export const SPLIT_MIN_VIEWPORT = 768;
/** The board's first share of the window, when nothing was remembered (the prototype's even split). */
export const DEFAULT_SHARE = 0.5;
/** A key press on the divider moves it this far, a shifted one four times as far. */
export const KEY_STEP = 24;

/** Which side is folded to a strip. */
export type Folded = 'none' | 'paper' | 'board';

/** The remembered split. */
export interface SplitMemory {
  /** The board's share of the window, 0..1. */
  readonly share: number;
  /** A side the reader folded. */
  readonly folded: Folded;
}

/** The split as it stands. */
export interface SplitState extends SplitMemory {
  /** True when the fold was the board's own (widening on the first branch), not the reader's. */
  readonly auto: boolean;
}

/** The storage key of the remembered split. */
export const SPLIT_KEY = 'papertree/split';

/**
 * Whether the window has room for two panes.
 *
 * @param viewport The window's width in px.
 * @returns True when a split can be drawn.
 */
export function canSplit(viewport: number): boolean {
  return viewport >= SPLIT_MIN_VIEWPORT;
}

/**
 * The board's width in px for a share, kept so neither pane is narrower than its minimum.
 *
 * @param share The board's share of the window.
 * @param viewport The window's width in px.
 * @returns The board's width.
 */
export function boardWidthFor(share: number, viewport: number): number {
  const wanted = Math.round(share * viewport);
  const most = Math.max(MIN_BOARD, viewport - MIN_PAPER);
  return Math.min(most, Math.max(MIN_BOARD, wanted));
}

/**
 * The board's width in px for the split as it stands: a strip when the board is folded, nearly all
 * of the window when the paper is.
 *
 * @param state The split.
 * @param viewport The window's width in px.
 * @returns The board's width.
 */
export function boardWidthOf(state: SplitState, viewport: number): number {
  if (state.folded === 'board') return STRIP_WIDTH;
  if (state.folded === 'paper') return Math.max(MIN_BOARD, viewport - STRIP_WIDTH);
  return boardWidthFor(state.share, viewport);
}

/**
 * The share for a divider dragged to `x` (its left edge, in px from the window's left).
 *
 * @param x The divider's position.
 * @param viewport The window's width in px.
 * @returns The board's share, clamped to the minimums.
 */
export function shareAt(x: number, viewport: number): number {
  return boardWidthFor((viewport - x) / viewport, viewport) / viewport;
}

/**
 * The share after a key press on the divider: Left grows the board, Right grows the paper.
 *
 * @param state The split.
 * @param key The key.
 * @param viewport The window's width in px.
 * @param shift Whether Shift was held (a bigger step).
 * @returns The new share, or null when the key does nothing here.
 */
export function shareForKey(
  state: SplitState,
  key: string,
  viewport: number,
  shift: boolean,
): number | null {
  const step = shift ? KEY_STEP * 4 : KEY_STEP;
  const width = boardWidthFor(state.share, viewport);
  if (key === 'ArrowLeft') return boardWidthFor((width + step) / viewport, viewport) / viewport;
  if (key === 'ArrowRight') return boardWidthFor((width - step) / viewport, viewport) / viewport;
  if (key === 'Home') return boardWidthFor(MIN_BOARD / viewport, viewport) / viewport;
  if (key === 'End') return boardWidthFor((viewport - MIN_PAPER) / viewport, viewport) / viewport;
  return null;
}

/**
 * The split after the board's first branch (#349): the board widens by folding the paper to a strip,
 * once. A reader who already folded something, or who restored the paper after this, is not asked
 * again; the fold is `auto`, so it is not remembered.
 *
 * @param state The split.
 * @returns The new state (the same object when nothing changes).
 */
export function widenForBranch(state: SplitState): SplitState {
  if (state.folded !== 'none') return state;
  return { ...state, folded: 'paper', auto: true };
}

/**
 * What a state keeps for next time: the share and a side the READER folded.
 *
 * @param state The split.
 * @returns The memory.
 */
export function memoryOf(state: SplitState): SplitMemory {
  return { share: state.share, folded: state.auto ? 'none' : state.folded };
}

/**
 * Reads the remembered split; anything unreadable is the default.
 *
 * @param storage A `Storage`, or null when there is none.
 * @returns The memory.
 */
export function readSplit(storage: Pick<Storage, 'getItem'> | null): SplitMemory {
  const fallback: SplitMemory = { share: DEFAULT_SHARE, folded: 'none' };
  try {
    const raw = storage?.getItem(SPLIT_KEY) ?? null;
    if (raw === null) return fallback;
    const value = JSON.parse(raw) as { v?: unknown; share?: unknown; folded?: unknown };
    if (value.v !== 1 || typeof value.share !== 'number' || !Number.isFinite(value.share)) {
      return fallback;
    }
    const folded: Folded =
      value.folded === 'paper' || value.folded === 'board' ? value.folded : 'none';
    return { share: Math.min(0.9, Math.max(0.1, value.share)), folded };
  } catch {
    return fallback;
  }
}

/**
 * Remembers the split. A convenience: a storage that refuses is ignored.
 *
 * @param storage A `Storage`, or null.
 * @param state The split.
 */
export function writeSplit(storage: Pick<Storage, 'setItem'> | null, state: SplitState): void {
  try {
    storage?.setItem(SPLIT_KEY, JSON.stringify({ v: 1, ...memoryOf(state) }));
  } catch {
    /* a private window: the split just is not remembered */
  }
}
