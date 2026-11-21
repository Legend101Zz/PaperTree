import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBoardBeside } from '../hooks/useBoardBeside';
import { BoardBeside } from './BoardBeside';

vi.mock('@/features/board', async () => {
  const { createContext, useContext } = await import('react');
  const Context = createContext<unknown>(null);
  return {
    BoardHostProvider: Context.Provider,
    BoardView: () => {
      const host = useContext(Context) as { beside: boolean } | null;
      return <div data-testid="board" data-beside={String(host?.beside)} />;
    },
  };
});

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
  window.localStorage.clear();
});
afterEach(cleanup);

function mount() {
  const hook = renderHook(() => useBoardBeside());
  act(() => hook.result.current.openBeside());
  const view = () => (
    <BoardBeside
      paperId="ppr_1"
      split={hook.result.current}
      visiblePages={new Set()}
      arrival={null}
      onShowInPaper={vi.fn()}
      dragIn={null}
    />
  );
  const out = render(view());
  const again = () => out.rerender(view());
  return { hook, again };
}

describe('the board beside the paper', () => {
  it('shows the real board, told it is beside the paper', () => {
    mount();
    expect(screen.getByTestId('board').getAttribute('data-beside')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Board' })).not.toBeNull();
  });

  it('has a keyboard-resizable divider, named and valued', () => {
    const { hook, again } = mount();
    const divider = screen.getByRole('separator', { name: 'Resize paper and board' });
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    again();
    expect(hook.result.current.boardWidth).toBeGreaterThan(720);
    fireEvent.keyDown(divider, { key: 'Home' });
    again();
    expect(hook.result.current.boardWidth).toBe(400);
  });

  it('drags the divider with the pointer', () => {
    const { hook, again } = mount();
    const divider = screen.getByRole('separator');
    Object.assign(divider, { setPointerCapture: vi.fn() });
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 720 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1000 });
    again();
    expect(hook.result.current.boardWidth).toBe(440);
    fireEvent.pointerUp(divider, { pointerId: 1 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 600 });
    expect(hook.result.current.boardWidth).toBe(440);
  });

  it('folds the paper to a strip and one click brings it back; the board folds too', () => {
    const { hook, again } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the paper' }));
    again();
    expect(hook.result.current.state.folded).toBe('paper');
    const strip = screen.getAllByRole('button', { name: 'Show the paper' });
    expect(strip.length).toBeGreaterThan(0);
    fireEvent.click(strip[strip.length - 1]!);
    again();
    expect(hook.result.current.state.folded).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the board' }));
    again();
    expect(hook.result.current.state.folded).toBe('board');
    expect(screen.getByRole('button', { name: 'Show the board' })).not.toBeNull();
  });
});
