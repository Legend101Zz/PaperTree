import { describe, expect, it } from 'vitest';

import {
  MIN_BOARD,
  MIN_PAPER,
  SPLIT_KEY,
  STRIP_WIDTH,
  boardWidthFor,
  boardWidthOf,
  canSplit,
  memoryOf,
  readSplit,
  shareAt,
  shareForKey,
  widenForBranch,
  writeSplit,
  type SplitState,
} from './split';

const even: SplitState = { share: 0.5, folded: 'none', auto: false };

describe('the split sizes', () => {
  it('gives the board its share, never leaving either pane under its minimum', () => {
    expect(boardWidthFor(0.5, 1440)).toBe(720);
    expect(boardWidthFor(0.1, 1440)).toBe(MIN_BOARD);
    expect(boardWidthFor(0.95, 1440)).toBe(1440 - MIN_PAPER);
  });
  it('is a strip when the board is folded and nearly the window when the paper is', () => {
    expect(boardWidthOf({ ...even, folded: 'board' }, 1440)).toBe(STRIP_WIDTH);
    expect(boardWidthOf({ ...even, folded: 'paper' }, 1440)).toBe(1440 - STRIP_WIDTH);
    expect(boardWidthOf(even, 1440)).toBe(720);
  });
  it('has room for two panes from 768 px up', () => {
    expect(canSplit(767)).toBe(false);
    expect(canSplit(768)).toBe(true);
  });
  it('turns the divider position into a share, clamped', () => {
    expect(shareAt(720, 1440)).toBeCloseTo(0.5);
    expect(shareAt(10, 1440) * 1440).toBeCloseTo(1440 - MIN_PAPER);
    expect(shareAt(1430, 1440) * 1440).toBeCloseTo(MIN_BOARD);
  });
});

describe('the divider by keyboard', () => {
  it('Left gives the board room, Right gives the paper room, Shift moves further', () => {
    const left = shareForKey(even, 'ArrowLeft', 1440, false)!;
    const right = shareForKey(even, 'ArrowRight', 1440, false)!;
    expect(left).toBeGreaterThan(0.5);
    expect(right).toBeLessThan(0.5);
    expect(shareForKey(even, 'ArrowLeft', 1440, true)!).toBeGreaterThan(left);
  });
  it('Home and End go to the extremes, and any other key is left alone', () => {
    expect(shareForKey(even, 'Home', 1440, false)! * 1440).toBeCloseTo(MIN_BOARD);
    expect(shareForKey(even, 'End', 1440, false)! * 1440).toBeCloseTo(1440 - MIN_PAPER);
    expect(shareForKey(even, 'a', 1440, false)).toBeNull();
  });
});

describe('widening on the first branch (#349)', () => {
  it('folds the paper to a strip, as the board’s own doing', () => {
    expect(widenForBranch(even)).toMatchObject({ folded: 'paper', auto: true });
  });
  it('does nothing when the reader already folded a side', () => {
    const folded: SplitState = { ...even, folded: 'board' };
    expect(widenForBranch(folded)).toBe(folded);
  });
  it('is not remembered: only a fold the reader chose is', () => {
    expect(memoryOf(widenForBranch(even))).toEqual({ share: 0.5, folded: 'none' });
    expect(memoryOf({ ...even, folded: 'paper' })).toEqual({ share: 0.5, folded: 'paper' });
  });
});

describe('the remembered split', () => {
  const store = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };
  it('is written and read back', () => {
    const s = store();
    writeSplit(s, { share: 0.38, folded: 'none', auto: false });
    expect(JSON.parse(s.getItem(SPLIT_KEY)!)).toEqual({ v: 1, share: 0.38, folded: 'none' });
    expect(readSplit(s)).toEqual({ share: 0.38, folded: 'none' });
  });
  it('falls back to an even split for anything unreadable, and survives a storage that refuses', () => {
    const fallback = { share: 0.5, folded: 'none' };
    expect(readSplit(null)).toEqual(fallback);
    expect(readSplit({ getItem: () => '{nope' })).toEqual(fallback);
    expect(readSplit({ getItem: () => JSON.stringify({ v: 2, share: 0.3 }) })).toEqual(fallback);
    expect(() =>
      writeSplit(
        {
          setItem: () => {
            throw new Error('private window');
          },
        },
        even,
      ),
    ).not.toThrow();
  });
});
