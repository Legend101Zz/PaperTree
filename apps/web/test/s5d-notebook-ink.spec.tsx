/**
 * s5d-notebook-ink.spec — ink on the notebook page as a person uses it (#209): a drawn stroke is
 * saved as ONE POST whose blob `decodeStroke` reads back, the eraser DELETEs, undo and redo send
 * both ways, the tools switch by key with `aria-pressed`, a finger after a pen scrolls instead of
 * inking, and a failed save is said and sent again. Synthetic pointer events on the real surface;
 * `fetch` plays the API (s5c-notebook-fixtures).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotebookView, decodeStroke } from '@/features/notebook';
import { bytesFromBase64 } from '@/features/notebook/model/wire';

import { PAGE, PAPER, pageView, stubApi } from './s5c-notebook-fixtures';

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

const STROKES = `/notebook/pages/${PAGE}/strokes`;

/** The stroke routes, answered as the server does; `fail` answers the next POSTs with a 500. */
function stubInk(fail = { posts: 0 }): Call[] {
  return stubApi(pageView(), (call) => {
    if (!call.path.startsWith(STROKES)) return null;
    if (call.method === 'DELETE') return new Response(null, { status: 204 });
    if (fail.posts > 0) {
      fail.posts -= 1;
      return new Response(JSON.stringify({ detail: 'down', code: 'internal' }), { status: 500 });
    }
    const added = (call.body as unknown as unknown[]).length;
    return new Response(JSON.stringify({ added }), { status: 201 });
  });
}

async function mount(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  );
  await screen.findByRole('toolbar', { name: 'Notebook tools' });
}

const surface = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.pt-nb-surface');
  if (el === null) throw new Error('no ink surface: no tool in the hand');
  return el;
};

/** A drag on the ink surface from one point to another, in screen px. */
function drag(points: [number, number][], pointerType = 'mouse', pointerId = 1): void {
  const [first, ...rest] = points;
  const at = (p: [number, number]) => ({ pointerId, pointerType, clientX: p[0], clientY: p[1] });
  fireEvent.pointerDown(surface(), { ...at(first!), button: 0, pressure: 0.5 });
  for (const p of rest) fireEvent.pointerMove(surface(), at(p));
  fireEvent.pointerUp(surface(), at(points.at(-1)!));
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === STROKES);
const deletes = (calls: Call[]) =>
  calls.filter((c) => c.method === 'DELETE' && c.path.startsWith(`${STROKES}/`));
const sent = (call: Call) =>
  call.body as unknown as { stroke_id: string; tool: string; colour: string; points_b64: string }[];

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('drawing', () => {
  it('saves a pen stroke as one POST whose blob decodeStroke reads back', async () => {
    const calls = stubInk();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    drag([
      [100, 300],
      [140, 310],
      [180, 330],
    ]);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    const [stroke] = sent(posts(calls)[0]!);
    expect(stroke).toMatchObject({ tool: 'pen', nib: 'F', colour: 'pen' });
    const geometry = decodeStroke(bytesFromBase64(stroke!.points_b64));
    expect(geometry.hasPressure).toBe(false); // a mouse: no pressure stored
    expect(geometry.points.map(([x, y]) => [x, y])).toEqual([
      [100, 300],
      [140, 310],
      [180, 330],
    ]);
    expect(document.querySelectorAll('.pt-nb-ink [data-stroke-id]')).toHaveLength(1);
  });

  it('draws a highlighter wash in the colour chosen for it', async () => {
    const calls = stubInk();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Highlighter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    fireEvent.click(screen.getByRole('button', { name: 'Medium nib' }));
    drag([
      [100, 300],
      [200, 300],
    ]);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(sent(posts(calls)[0]!)[0]).toMatchObject({
      tool: 'highlighter',
      nib: 'M',
      colour: 'hl-green',
    });
    expect(document.querySelector('.pt-nb-ink__wash [data-stroke-id]')).not.toBeNull();
  });

  it('lets a finger scroll, not ink, once a pen has touched the page', async () => {
    const calls = stubInk();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    drag([[100, 300]], 'pen', 7);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
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
  });

  it('says a failed save, keeps the stroke, and sends it again on Try again', async () => {
    const calls = stubInk({ posts: 1 });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    drag([
      [100, 300],
      [120, 320],
    ]);
    await screen.findByText(/Not saved yet: 1 edit could not be sent/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    expect(sent(posts(calls)[1]!)[0]?.stroke_id).toBe(sent(posts(calls)[0]!)[0]?.stroke_id);
    await waitFor(() => expect(screen.queryByText(/Not saved yet/)).toBeNull());
  });
});

describe('erasing, undo and redo', () => {
  it('erases a whole stroke with a DELETE, and undo and redo send the change both ways', async () => {
    const calls = stubInk();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    drag([
      [100, 300],
      [200, 300],
    ]);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    const id = sent(posts(calls)[0]!)[0]!.stroke_id;

    fireEvent.click(screen.getByRole('button', { name: 'Stroke eraser' }));
    drag([
      [150, 280],
      [150, 320],
    ]);
    await waitFor(() => expect(deletes(calls)).toHaveLength(1));
    expect(deletes(calls)[0]?.path).toBe(`${STROKES}/${id}`);
    expect(document.querySelector(`[data-stroke-id="${id}"]`)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' })); // the erase: back, POSTed again
    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    expect(sent(posts(calls)[1]!)[0]?.stroke_id).toBe(id);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' })); // the drawing: gone again
    await waitFor(() => expect(deletes(calls)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(3));
    expect(document.querySelector(`[data-stroke-id="${id}"]`)).not.toBeNull();
  });
});

describe('keyboard', () => {
  it('switches tools by key, marks the one in the hand, and Escape puts it down', async () => {
    stubInk();
    await mount();
    const pressed = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed');
    fireEvent.keyDown(window, { key: 'p' });
    expect(pressed('Pen')).toBe('true');
    expect(document.querySelector('.pt-nb-surface')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'h' });
    expect([pressed('Pen'), pressed('Highlighter')]).toEqual(['false', 'true']);
    fireEvent.keyDown(window, { key: 'e' });
    expect(pressed('Stroke eraser')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pressed('Stroke eraser')).toBe('false');
    expect(document.querySelector('.pt-nb-surface')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-keyshortcuts')).toBe('P');
  });

  it('leaves letters typed into a note to the note', async () => {
    stubInk();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const field = await screen.findByRole('textbox', { name: 'Typed note' });
    fireEvent.keyDown(field, { key: 'p' });
    expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-pressed')).toBe('false');
  });
});
