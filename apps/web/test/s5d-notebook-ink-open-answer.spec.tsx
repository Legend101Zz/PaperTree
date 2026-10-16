/**
 * s5d-notebook-ink-open-answer.spec — ink while the open answer pushes the page down (#209, review
 * blocker 1 and should-fix 1): the eraser erases the stroke under it as SHOWN, with the answer open
 * and closed, and never one it does not touch; a stroke cannot start in the band the answer opened
 * (the page says why), and strokes begun above or below it stay exactly where they were drawn.
 * The open answer is an exchange measured 200 units taller than its box (`openAnswer`).
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeStroke } from '@/features/notebook';
import { INK_FOLD_NOTE } from '@/features/notebook/components/NotebookView';
import { bytesFromBase64 } from '@/features/notebook/model/wire';

import {
  BOX_BOTTOM,
  STROKES,
  deletes,
  drag,
  mount,
  openAnswer,
  posts,
  sent,
  settle,
  stubInk,
} from './s5d-ink-fixtures';
import { stroke } from '@/features/notebook/model/test-helpers';

import type { Call } from './s5c-notebook-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/paper/x/notebook/y',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EXTRA = 200; // the open exchange measures 520 against its 320-unit box
const BAND = [BOX_BOTTOM, BOX_BOTTOM + EXTRA] as const; // [368, 568) as shown

// Stored beside a card below the exchange's box, at y 600: shown at y 800 while the answer is open.
const CARD_INK = stroke(
  'ns_cardink01',
  [
    [100, 600],
    [200, 600],
  ],
  { hasPressure: false },
);

const ys = (call: Call) =>
  decodeStroke(bytesFromBase64(sent(call)[0]!.points_b64)).points.map((p) => p[1]);

async function withEraser(open: boolean): Promise<Call[]> {
  if (open) openAnswer(320 + EXTRA);
  const calls = stubInk({ strokes: [CARD_INK] });
  await mount();
  if (open) {
    await waitFor(() =>
      expect(document.querySelector('.pt-nb-page__below')?.getAttribute('data-shift')).toBe('200'),
    );
  }
  fireEvent.click(screen.getByRole('button', { name: 'Stroke eraser' }));
  return calls;
}

describe('the eraser with the answer open', () => {
  it('erases the stroke where it is shown, 200 below where it is stored', async () => {
    const calls = await withEraser(true);
    drag([
      [150, 780],
      [150, 820],
    ]);
    await waitFor(() => expect(deletes(calls)).toHaveLength(1));
    expect(deletes(calls)[0]?.path).toBe(`${STROKES}/${CARD_INK.id}`);
  });

  it('erases nothing where the stroke is stored but not shown', async () => {
    const calls = await withEraser(true);
    drag([
      [150, 580],
      [150, 620],
    ]);
    await settle();
    expect(deletes(calls)).toHaveLength(0);
    expect(document.querySelector(`[data-stroke-id="${CARD_INK.id}"]`)).not.toBeNull();
  });
});

describe('the eraser with the answer closed', () => {
  it('erases the stroke where it is stored, which is where it is shown', async () => {
    const calls = await withEraser(false);
    drag([
      [150, 580],
      [150, 620],
    ]);
    await waitFor(() => expect(deletes(calls)).toHaveLength(1));
  });
});

describe('drawing with the answer open', () => {
  async function withPen(): Promise<Call[]> {
    openAnswer(320 + EXTRA);
    const calls = stubInk();
    await mount();
    await waitFor(() => expect(document.querySelector('.pt-nb-surface')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    return calls;
  }

  it('marks the band and refuses a stroke begun in it, saying why', async () => {
    const calls = await withPen();
    const fold = document.querySelector<HTMLElement>('.pt-nb-surface__fold')!;
    expect([fold.style.top, fold.style.height]).toEqual([`${BAND[0]}px`, `${EXTRA}px`]);
    drag([
      [700, 450],
      [760, 470],
    ]);
    await screen.findByText(INK_FOLD_NOTE);
    await settle();
    expect(posts(calls)).toHaveLength(0);
  });

  it('keeps a stroke begun above the box where it was drawn, through the band', async () => {
    const calls = await withPen();
    drag([
      [700, 300],
      [700, 450],
    ]);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(ys(posts(calls)[0]!)).toEqual([300, 450]);
    expect(document.querySelector('.pt-nb-page__below [data-stroke-id]')).toBeNull();
  });

  it('stores a stroke begun below the band 200 higher, and draws it back where it was', async () => {
    const calls = await withPen();
    drag([
      [700, 700],
      [700, 450],
    ]);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(ys(posts(calls)[0]!)).toEqual([500, 250]);
    // In the layer the answer pushes down by 200: shown at 700 → 450, as drawn.
    expect(document.querySelector('.pt-nb-page__below [data-stroke-id]')).not.toBeNull();
  });
});
