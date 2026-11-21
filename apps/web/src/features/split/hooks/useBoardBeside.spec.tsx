import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SPLIT_KEY } from '../model/split';
import { useBoardBeside } from './useBoardBeside';

const setWidth = (width: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
};

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });

beforeEach(() => {
  setWidth(1440);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-pt-board');
});

describe('Board beside: open, close and the B key', () => {
  it('B toggles it, with no modifier and not while typing', () => {
    const { result } = renderHook(() => useBoardBeside());
    expect(result.current.open).toBe(false);
    press('b');
    expect(result.current.open).toBe(true);
    press('b', { metaKey: true });
    expect(result.current.open).toBe(true);
    const field = document.createElement('input');
    document.body.appendChild(field);
    press('b', {}, field);
    expect(result.current.open).toBe(true);
    field.remove();
    press('B');
    expect(result.current.open).toBe(false);
  });

  it('makes room for the pane while open, and gives it back', () => {
    const { result } = renderHook(() => useBoardBeside());
    act(() => result.current.openBeside());
    expect(document.documentElement.getAttribute('data-pt-board')).toBe('open');
    expect(document.documentElement.style.getPropertyValue('--pt-board-width')).toBe('720px');
    act(() => result.current.close());
    expect(document.documentElement.hasAttribute('data-pt-board')).toBe(false);
  });

  it('opens on a card, and says where to go instead when the window has no room for two panes', () => {
    const away = vi.fn();
    const { result } = renderHook(() => useBoardBeside(away));
    act(() => result.current.openOn('cn_1'));
    expect(result.current.arrival).toMatchObject({ cardId: 'cn_1', centre: true });
    act(() => result.current.close());
    expect(result.current.arrival).toBeNull();
    setWidth(700);
    act(() => result.current.openOn('cn_2'));
    expect(result.current.open).toBe(false);
    expect(away).toHaveBeenCalledWith('cn_2');
  });

  it('a card that lands while the board is open arrives again, a drop without centring', () => {
    const { result } = renderHook(() => useBoardBeside());
    act(() => result.current.openOn('cn_1'));
    const first = result.current.arrival!.nonce;
    act(() => result.current.arriveAt('cn_1', false));
    expect(result.current.arrival).toMatchObject({ cardId: 'cn_1', centre: false });
    expect(result.current.arrival!.nonce).toBeGreaterThan(first);
  });
});

describe('the divider and what is remembered', () => {
  it('a dragged divider and a key move the board, and the split is remembered', () => {
    const { result } = renderHook(() => useBoardBeside());
    act(() => result.current.openBeside());
    act(() => result.current.dragTo(900)); // the board takes the right 540 px
    expect(result.current.boardWidth).toBe(540);
    expect(JSON.parse(window.localStorage.getItem(SPLIT_KEY)!).share).toBeCloseTo(0.375);
    // A second reader of the same window starts where the first left off.
    const again = renderHook(() => useBoardBeside());
    act(() => again.result.current.openBeside());
    expect(again.result.current.boardWidth).toBe(540);
  });

  it('either side folds to a strip and one click restores', () => {
    const { result } = renderHook(() => useBoardBeside());
    act(() => result.current.openBeside());
    act(() => result.current.fold('paper'));
    expect(result.current.state.folded).toBe('paper');
    expect(result.current.boardWidth).toBe(1440 - 44);
    act(() => result.current.restore());
    expect(result.current.state.folded).toBe('none');
    act(() => result.current.fold('board'));
    expect(result.current.boardWidth).toBe(44);
  });

  it('the first branch folds the paper once; restoring it is not undone by the next branch', () => {
    const { result } = renderHook(() => useBoardBeside());
    act(() => result.current.openBeside());
    act(() => result.current.widen());
    expect(result.current.state).toMatchObject({ folded: 'paper', auto: true });
    // Not remembered: a reload opens with both sides.
    expect(JSON.parse(window.localStorage.getItem(SPLIT_KEY)!).folded).toBe('none');
    act(() => result.current.restore());
    act(() => result.current.widen());
    expect(result.current.state.folded).toBe('none');
    // A new opening may widen again.
    act(() => result.current.close());
    act(() => result.current.openBeside());
    act(() => result.current.widen());
    expect(result.current.state.folded).toBe('paper');
  });
});
