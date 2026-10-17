/**
 * s5e-notebook-phone.spec — the phone notebook as a person uses it (#210, frame 08c): at 390 the
 * page reads as a stack (call slip, the AI slip collapsed with "Read the whole answer", the trace
 * as 44 px rows "cited n×" that open their passage), the person's ink is shown view only, typed
 * notes are edited in place and saved, and the bottom bar offers exactly Text, Sticky, Highlight
 * and "Pen: off" under the honest line; no eraser, lasso, shapes or templates, by button or by key.
 * Switching the pen on shows the page and a stroke drawn there is saved. `fetch` plays the API.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotebookView } from '@/features/notebook';
import { moreParagraphs } from '@/features/notebook/components/ExchangeBlock';
import { strokeToWire } from '@/features/notebook/model/wire';

import { PAGE, PAPER, pageView, stubApi, wireItem } from './s5c-notebook-fixtures';

import type { Call } from './s5c-notebook-fixtures';
import type { Stroke } from '@/features/notebook/model/stroke';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/paper/x/notebook/y',
  useSearchParams: () => new URLSearchParams(),
}));

interface HappyWindow {
  readonly happyDOM: { setViewport: (size: { width: number; height: number }) => void };
}

const viewport = (width: number, height: number): void =>
  (window as unknown as HappyWindow).happyDOM.setViewport({ width, height });

afterEach(() => {
  cleanup();
  viewport(1440, 900);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  push.mockReset();
});

const INK: Stroke = {
  id: 'sk_phone0001',
  tool: 'pen',
  nib: 'F',
  color: 'pen',
  hasPressure: false,
  points: [
    [120, 420, 0.5],
    [160, 430, 0.5],
    [200, 425, 0.5],
  ],
};

/** Mounts the dived page at 390 × 844 with a sticky, a typed note and one stroke on it. */
async function mountPhone(): Promise<Call[]> {
  viewport(390, 844);
  const view = pageView([
    wireItem('ni_sticky0001', 'sticky', 690, 580, 170, 120, 6, 'Q: how does it know word order?'),
    wireItem('ni_typed00001', 'text', 360, 590, 260, 96, 7, 'Check §3.5 positional encoding.'),
  ]);
  const calls = stubApi(
    { ...view, strokes: [{ ...strokeToWire(INK), page_id: PAGE, created_at: '' }] },
    (call) =>
      call.path.endsWith('/strokes') && call.method === 'POST'
        ? new Response(JSON.stringify({ added: 1 }), { status: 201 })
        : null,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  );
  await screen.findByRole('toolbar', { name: 'Notebook tools' });
  await screen.findAllByRole('listitem');
  return calls;
}

const bar = (): HTMLElement => screen.getByRole('toolbar', { name: 'Notebook tools' });

describe('the stack (08c)', () => {
  it('reads ask → answer → trace: the AI slip collapsed, the trace as rows that open the paper', async () => {
    await mountPhone();
    const exchange = screen.getByRole('region', { name: 'The exchange this page started from' });
    expect(exchange.querySelector('[data-voice="you"]')).not.toBeNull();
    expect(exchange.querySelector('[data-voice="ai"]')).not.toBeNull();
    const more = within(exchange).getByRole('button', { name: 'Read the whole answer' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(exchange.textContent).toContain('4 more paragraphs');
    fireEvent.click(more);
    expect(within(exchange).getByRole('button', { name: 'Show less' })).toBeTruthy();

    const trace = screen.getByRole('list', { name: 'Passages the answer stands on' });
    const rows = within(trace).getAllByRole('button');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toMatch(/^Show in paper: 1p\. 1 ¶1.*cited/);
    fireEvent.click(rows[1]!);
    expect(push).toHaveBeenCalledWith(`/paper/${PAPER}/read?nb=${PAGE}&item=ni_quote0002`);
  });

  it('shows the ink view only: drawn, never a surface, and no key takes it up to erase', async () => {
    const calls = await mountPhone();
    const ink = screen.getByRole('figure', { name: /Your ink · view only/ });
    expect(ink.querySelectorAll('[data-stroke-id]')).toHaveLength(1);
    // E (eraser), L (lasso) and P (pen) pick nothing up on a phone: no surface, the stack stays.
    for (const key of ['e', 'l', 'p']) {
      fireEvent.keyDown(window, { key });
      expect(document.querySelector('.pt-nb-surface'), key).toBeNull();
      expect(document.querySelector('.pt-nb-stack'), key).not.toBeNull();
    }
    // H is the highlighter, which the phone allows.
    fireEvent.keyDown(window, { key: 'h' });
    expect(
      within(bar()).getByRole('button', { name: 'Highlight' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.pt-nb-surface')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stroke eraser' })).toBeNull();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('edits a typed note in place and saves it', async () => {
    const calls = await mountPhone();
    fireEvent.click(
      screen.getByRole('button', { name: 'Typed note: Check §3.5 positional encoding.' }),
    );
    const box = screen.getByRole('textbox', { name: 'Typed note' });
    fireEvent.change(box, { target: { value: 'Check §3.5 positional encoding (p. 6).' } });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            c.path.endsWith('/items/ni_typed00001') &&
            c.body?.['body'] === 'Check §3.5 positional encoding (p. 6).',
        ),
      ).toBe(true),
    );
  });

  it('adds a typed note from the bar, and it is saved', async () => {
    const calls = await mountPhone();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Text' }));
    const box = screen.getByRole('textbox', { name: 'Typed note' });
    fireEvent.change(box, { target: { value: 'A new note on the phone.' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.body?.['kind'] === 'text' &&
            c.body['body'] === 'A new note on the phone.',
        ),
      ).toBe(true),
    );
  });
});

describe('deleting on the phone (review blocker)', () => {
  const deletes = (calls: Call[]) => calls.filter((c) => c.method === 'DELETE');

  it('has no × a stray tap could find: a tap on the note, corner included, only edits it', async () => {
    const calls = await mountPhone();
    const stack = document.querySelector<HTMLElement>('.pt-nb-stack')!;
    expect(stack.querySelectorAll('.pt-nb-note__delete')).toHaveLength(0);
    expect(within(stack).queryByRole('button', { name: /^Delete/ })).toBeNull();
    const face = screen.getByRole('button', {
      name: 'Typed note: Check §3.5 positional encoding.',
    });
    fireEvent.pointerDown(face, { pointerType: 'touch', clientX: 370, clientY: 640 });
    fireEvent.click(face, { clientX: 370, clientY: 640 });
    const box = screen.getByRole('textbox', { name: 'Typed note' });
    fireEvent.blur(box);
    await new Promise((done) => setTimeout(done, 30));
    expect(deletes(calls)).toEqual([]);
    expect(
      screen.getByRole('button', { name: 'Typed note: Check §3.5 positional encoding.' }),
    ).toBeTruthy();
  });

  it('deletes from the editor’s 44 px Delete, says so, and Undo brings the note back', async () => {
    const calls = await mountPhone();
    fireEvent.click(
      screen.getByRole('button', { name: 'Typed note: Check §3.5 positional encoding.' }),
    );
    const remove = screen.getByRole('button', { name: 'Delete note' });
    expect(remove.classList.contains('pt-nb-note__remove')).toBe(true);
    // A press keeps the keyboard in the box, so the editing does not end under the press.
    expect(fireEvent.pointerDown(remove)).toBe(false);
    fireEvent.click(remove);
    await waitFor(() => expect(deletes(calls)).toHaveLength(1));
    expect(deletes(calls)[0]!.path).toContain('/items/ni_typed00001');
    expect(screen.queryByRole('button', { name: /^Typed note: Check/ })).toBeNull();
    expect(screen.getByText('Typed note deleted.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: /^Typed note: Check/ })).toBeTruthy();
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.body?.['item_id'] === 'ni_typed00001'),
      ).toBe(true),
    );
    expect(screen.queryByText('Typed note deleted.')).toBeNull();
  });

  it('drops a new note deleted before it was saved, sending nothing', async () => {
    const calls = await mountPhone();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Text' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Typed note' }), {
      target: { value: 'never mind' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.queryByRole('textbox', { name: 'Typed note' })).toBeNull();
    expect(screen.queryByRole('button', { name: /never mind/ })).toBeNull();
    await new Promise((done) => setTimeout(done, 30));
    expect(calls.some((c) => c.method === 'POST' && c.body?.['body'] === 'never mind')).toBe(false);
  });

  it('gives the answer’s markers the shared 44 px touch target', async () => {
    await mountPhone();
    const exchange = screen.getByRole('region', { name: 'The exchange this page started from' });
    const markers = exchange.querySelectorAll('.pt-marker:not(.pt-marker--static)');
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) expect(m.classList.contains('pt-marker--touch')).toBe(true);
  });
});

describe('turning a tablet into a phone', () => {
  /** media queries that answer for a width the test sets, and say when it crosses them */
  function media(start: number): (width: number) => void {
    let width = start;
    const heard = new Set<() => void>();
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const min = Number(/min-width: (\d+)px/.exec(query)?.[1] ?? Number.NaN);
      return {
        get matches() {
          return width >= min;
        },
        media: query,
        addEventListener: (_: string, f: () => void) => heard.add(f),
        removeEventListener: (_: string, f: () => void) => heard.delete(f),
      } as unknown as MediaQueryList;
    });
    return (next) => {
      width = next;
      for (const f of heard) f();
    };
  }

  it('puts down a tool the phone leaves out, and shows the stack', async () => {
    const turn = media(1180);
    stubApi(pageView());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NotebookView paperId={PAPER} pageId={PAGE} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Lasso' }));
    expect(document.querySelector('.pt-nb-surface')).not.toBeNull();
    act(() => turn(390));
    await waitFor(() => expect(document.querySelector('.pt-nb-stack')).not.toBeNull());
    expect(document.querySelector('.pt-nb-surface')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lasso' })).toBeNull();
  });
});

describe('the answer’s foot', () => {
  it('counts what "Read the whole answer" holds back, one paragraph or several', () => {
    expect(moreParagraphs(1)).toBe('1 more paragraph');
    expect(moreParagraphs(4)).toBe('4 more paragraphs');
  });
});

describe('the bar (08c)', () => {
  it('offers exactly Text, Sticky, Highlight and the pen’s opt-in, under the honest line', async () => {
    await mountPhone();
    expect(
      within(bar())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Text', 'Sticky', 'Highlight', 'Pen: off']);
    expect(screen.getByText('Lasso, shapes and templates: on a tablet or computer')).toBeTruthy();
    for (const name of ['Lasso', 'Stroke eraser', 'Shapes', 'Pen']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
    }
    expect(screen.queryByRole('radiogroup')).toBeNull(); // the template picker
    expect(screen.queryByRole('region', { name: 'Page' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Page' })).toBeNull();
  });

  it('switches the pen on: the page shows, a stroke is saved; off again, the stack is back', async () => {
    const calls = await mountPhone();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Pen: off' }));
    const on = within(bar()).getByRole('button', { name: 'Pen: on' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.pt-nb-page')).not.toBeNull();
    const surface = document.querySelector<HTMLElement>('.pt-nb-surface')!;
    const at = (x: number, y: number) => ({
      pointerId: 3,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
    });
    fireEvent.pointerDown(surface, { ...at(100, 300), button: 0, pressure: 0.5 });
    fireEvent.pointerMove(surface, at(140, 310));
    fireEvent.pointerUp(surface, at(180, 320));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/strokes'))).toHaveLength(
        1,
      ),
    );
    expect(within(bar()).getByRole('button', { name: 'Undo' })).toBeTruthy();
    fireEvent.click(on);
    expect(within(bar()).getByRole('button', { name: 'Pen: off' })).toBeTruthy();
    expect(document.querySelector('.pt-nb-stack')).not.toBeNull();
  });
});
