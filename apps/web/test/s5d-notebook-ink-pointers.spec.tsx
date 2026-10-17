/**
 * s5d-notebook-ink-pointers.spec — the hand on the glass (#209, review blocker 2): a palm resting on
 * the page never stops the pen and never scrolls while the pen writes, in either order (palm first
 * or pen first), and a pen that lands on a palm already inking takes over from it; the palm latch
 * outlives putting the tool down; a cancelled pencil stroke keeps its ink; Escape in the Shapes
 * menu closes the menu only. Synthetic pen and touch PointerEvents on the real surface.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeStroke } from '@/features/notebook';
import { bytesFromBase64 } from '@/features/notebook/model/wire';

import { drag, mount, pointer, posts, sent, settle, stubInk } from './s5d-ink-fixtures';

import type { Call } from './s5c-notebook-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/paper/x/notebook/y',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Counts what the desk is scrolled by (jsdom does not scroll). */
function watchScroll(): { moved: () => number } {
  const desk = document.querySelector<HTMLElement>('.pt-nb__desk')!;
  let moved = 0;
  for (const key of ['scrollTop', 'scrollLeft'] as const) {
    let value = 0;
    Object.defineProperty(desk, key, {
      configurable: true,
      get: () => value,
      set: (v: number) => {
        moved += Math.abs(v - value);
        value = v;
      },
    });
  }
  return { moved: () => moved };
}

const firstPoint = (call: Call) => {
  const g = decodeStroke(bytesFromBase64(sent(call)[0]!.points_b64));
  return [g.points[0]![0], g.points[0]![1]];
};

async function withPen(): Promise<Call[]> {
  const calls = stubInk();
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
  drag([[100, 300]], 'pen', 7); // a pen has touched the page: the latch is set
  await waitFor(() => expect(posts(calls)).toHaveLength(1));
  return calls;
}

describe('a palm on the glass', () => {
  it('does not stop the pen while it rests (the review’s probe P1)', async () => {
    const calls = await withPen();
    const palm = pointer('touch', 8);
    palm.down([600, 600]);
    drag(
      [
        [100, 400],
        [160, 420],
      ],
      'pen',
      9,
    );
    palm.up([600, 600]);
    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    expect(firstPoint(posts(calls)[1]!)).toEqual([100, 400]);
  });

  it('palm first, then the pen: the pen draws, and the palm neither inks nor scrolls', async () => {
    const calls = await withPen();
    const scrolled = watchScroll();
    const [palm, pen] = [pointer('touch', 8), pointer('pen', 9)];
    palm.down([600, 600]);
    pen.down([100, 500]);
    palm.move([610, 640]);
    pen.move([150, 520]);
    palm.move([620, 680]);
    pen.up([150, 520]);
    palm.move([630, 700]); // the pen is up, but this palm lost its scroll when the pen came down
    palm.up([630, 700]);
    await settle();
    expect(posts(calls)).toHaveLength(2);
    expect(firstPoint(posts(calls)[1]!)).toEqual([100, 500]);
    expect(scrolled.moved()).toBe(0);
  });

  it('while the pen writes, a finger that lands does nothing at all', async () => {
    const calls = await withPen();
    const scrolled = watchScroll();
    const [pen, finger] = [pointer('pen', 9), pointer('touch', 8)];
    pen.down([100, 500]);
    finger.down([600, 600]);
    finger.move([600, 500]);
    pen.move([150, 520]);
    pen.up([150, 520]);
    finger.up([600, 500]);
    await settle();
    expect(posts(calls)).toHaveLength(2);
    expect(scrolled.moved()).toBe(0);
  });

  it('with no pen down, a finger after a pen scrolls the desk and never inks', async () => {
    const calls = await withPen();
    const scrolled = watchScroll();
    drag(
      [
        [300, 500],
        [300, 400],
      ],
      'touch',
      8,
    );
    await settle();
    expect(posts(calls)).toHaveLength(1);
    expect(scrolled.moved()).toBe(100);
  });

  it('before any pen: a pen landing on a palm that is inking drops the palm’s stroke', async () => {
    const calls = stubInk();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    const [palm, pen] = [pointer('touch', 8), pointer('pen', 9)];
    palm.down([600, 600]);
    palm.move([600, 640]);
    pen.down([100, 500]);
    palm.move([600, 680]);
    pen.move([150, 520]);
    pen.up([150, 520]);
    palm.up([600, 680]);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    await settle();
    expect(posts(calls)).toHaveLength(1);
    expect(firstPoint(posts(calls)[0]!)).toEqual([100, 500]);
  });

  it('keeps the latch when the tool is put down and picked up again', async () => {
    const calls = await withPen();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'p' });
    drag(
      [
        [300, 500],
        [300, 450],
      ],
      'touch',
      8,
    );
    await settle();
    expect(posts(calls)).toHaveLength(1);
  });
});

describe('a cancelled stroke', () => {
  it('keeps the ink drawn before a system gesture cancelled the pencil', async () => {
    const calls = stubInk();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    const pen = pointer('pen', 9);
    pen.down([100, 500]);
    pen.move([150, 520]);
    pen.cancel([150, 520]);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(firstPoint(posts(calls)[0]!)).toEqual([100, 500]);
  });
});

describe('Escape in the Shapes menu', () => {
  it('closes the menu and leaves the pen in the hand', async () => {
    stubInk();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }));
    const shapes = await screen.findByRole('group', { name: 'Shapes' });
    fireEvent.keyDown(within(shapes).getAllByRole('button')[0]!, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Shapes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' }); // with the menu shut, Escape puts the pen down
    expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-pressed')).toBe('false');
  });
});
