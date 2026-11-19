import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hostOf } from '../../../../test/branch-harness';
import { IMAGE_FOOTPRINT_HEIGHT } from '../model/panes';
import { useDropIn } from './useDropIn';

import type { DragEvent } from 'react';

vi.mock('@xyflow/react', () => ({
  // The board is panned 100 px right and zoomed to 50%: screen -> board is (x - 100) * 2.
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: (x - 100) * 2, y: y * 2 }),
  }),
}));

afterEach(cleanup);

const stage = () => {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 50, top: 80, width: 700, height: 500 }) as DOMRect;
  return { current: el };
};
const drag = (x: number, y: number, to: EventTarget | null = null) =>
  ({
    clientX: x,
    clientY: y,
    relatedTarget: to,
    currentTarget: document.createElement('div'),
    dataTransfer: { dropEffect: 'none' },
    preventDefault: vi.fn(),
  }) as unknown as DragEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };

describe('a selection dragged across the divider (V3-25)', () => {
  const words = 'x'.repeat(180);
  const host = () => {
    const dropped = vi.fn();
    return {
      dropped,
      host: hostOf({ beside: true, dragIn: { current: () => ({ text: words }), drop: dropped } }),
    };
  };

  it('shows a cross and a dashed footprint as tall as the card will be, following the pointer', () => {
    const { host: h } = host();
    const { result } = renderHook(() => useDropIn(h, stage()));
    const event = drag(300, 200);
    act(() => result.current.handlers.onDragOver(event));
    expect(event.preventDefault).toHaveBeenCalled();
    // Pane coordinates: the pointer minus the pane's corner; the footprint's corner is up and left.
    expect(result.current.mark).toMatchObject({ x: 250, y: 120, left: 228, top: 106, width: 304 });
    expect(result.current.mark!.height).toBe(50 + Math.ceil(182 / 45) * 18);
    act(() => result.current.handlers.onDragOver(drag(500, 400)));
    expect(result.current.mark).toMatchObject({ x: 450, y: 320 });
  });

  it('a dragged picture’s footprint is as tall as an image card, whatever its caption', () => {
    const h = hostOf({
      beside: true,
      dragIn: { current: () => ({ text: 'Figure 1.', image: true }), drop: vi.fn() },
    });
    const { result } = renderHook(() => useDropIn(h, stage()));
    act(() => result.current.handlers.onDragOver(drag(300, 200)));
    expect(result.current.mark!.height).toBe(IMAGE_FOOTPRINT_HEIGHT);
  });

  it('lands the card at the drop point, in board units, and the mark goes', () => {
    const { host: h, dropped } = host();
    const { result } = renderHook(() => useDropIn(h, stage()));
    act(() => result.current.handlers.onDragOver(drag(300, 200)));
    const event = drag(300, 200);
    act(() => result.current.handlers.onDrop(event));
    expect(event.preventDefault).toHaveBeenCalled();
    // (300 - 22 - 100) * 2 and (200 - 14) * 2: the card's corner sits under the cross.
    expect(dropped).toHaveBeenCalledWith({ x: 356, y: 372 });
    expect(result.current.mark).toBeNull();
  });

  it('leaving the pane clears the mark, moving inside it does not', () => {
    const { host: h } = host();
    const { result } = renderHook(() => useDropIn(h, stage()));
    act(() => result.current.handlers.onDragOver(drag(300, 200)));
    const inside = drag(300, 200, document.createElement('span'));
    act(() => result.current.handlers.onDragLeave(inside));
    expect(result.current.mark).toBeNull();
  });

  it('does nothing when nothing is being dragged, or the board is on its own page', () => {
    const none = hostOf({ beside: true, dragIn: { current: () => null, drop: vi.fn() } });
    const { result } = renderHook(() => useDropIn(none, stage()));
    const event = drag(300, 200);
    act(() => result.current.handlers.onDragOver(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.mark).toBeNull();
    const own = renderHook(() => useDropIn(hostOf(), stage()));
    act(() => own.result.current.handlers.onDrop(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
