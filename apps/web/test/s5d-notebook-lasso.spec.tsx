/**
 * s5d-notebook-lasso.spec — the lasso and its menu as a person uses them (#209): a loop drawn with
 * synthetic pointer events opens the menu on its first action; each action does what it says
 * (Ask about this → the reader with the typed words, Make sticky and Delete as ONE undo step each,
 * Send to board → one note card without the ink, Copy → the clipboard); what an action needs is
 * said when it is missing; the keyboard reaches all of it. The reader's half of Ask about this is
 * s5d-ask-from-notebook.spec.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookView, encodeStroke } from '@/features/notebook';
import { LassoLayer } from '@/features/notebook/components/LassoLayer';
import { base64FromBytes } from '@/features/notebook/model/wire';

import { PAGE, PAPER, pageView, stubApi, wireItem } from './s5c-notebook-fixtures';

import type { Call } from './s5c-notebook-fixtures';

const push = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/paper/x/notebook/y',
  useSearchParams: () => search,
}));

beforeEach(() => {
  push.mockReset();
  search = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOTE = 'Check §3.5 positional encoding (p. 6).';
const STROKES = `/notebook/pages/${PAGE}/strokes`;

/** The demo page plus a typed note at y 900 and a pen stroke at y 1000 (page units). */
function stub(): Call[] {
  const view = pageView([wireItem('ni_note00001', 'text', 48, 900, 288, 72, 9, NOTE)]);
  const points = base64FromBytes(
    encodeStroke({
      hasPressure: false,
      points: [
        [60, 1000, 0.5],
        [200, 1004, 0.5],
      ],
    }),
  );
  const ink = { stroke_id: 'ns_ink000001', page_id: PAGE, tool: 'pen', nib: 'F', colour: 'pen' };
  return stubApi(
    { ...view, strokes: [{ ...ink, points_b64: points, created_at: '' }] } as typeof view,
    (call) => {
      if (!call.path.startsWith(STROKES)) return null;
      if (call.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ added: 1 }), { status: 201 });
    },
  );
}

async function mount(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: `Typed note: ${NOTE}` });
}

/** Picks the lasso up by its key and draws a closed loop (screen px = page units here). */
function lasso(points: [number, number][]): HTMLElement {
  fireEvent.keyDown(window, { key: 'l' });
  const surface = document.querySelector<HTMLElement>('.pt-nb-surface')!;
  const at = (p: [number, number]) => ({
    pointerId: 1,
    pointerType: 'mouse',
    clientX: p[0],
    clientY: p[1],
  });
  fireEvent.pointerDown(surface, { ...at(points[0]!), button: 0 });
  for (const p of points.slice(1)) fireEvent.pointerMove(surface, at(p));
  fireEvent.pointerUp(surface, at(points.at(-1)!));
  return screen.getByRole('menu', { name: /^Lasso selection/ });
}

const AROUND_BOTH: [number, number][] = [
  [30, 880],
  [400, 880],
  [400, 1050],
  [30, 1050],
  [30, 884],
];
const AROUND_INK: [number, number][] = [
  [30, 985],
  [400, 985],
  [400, 1050],
  [30, 1050],
  [30, 988],
];
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

describe('the lasso menu', () => {
  it('opens on a loop round a note and a stroke, with the keyboard on its first action', async () => {
    stub();
    await mount();
    const menu = lasso(AROUND_BOTH);
    expect(screen.getByRole('button', { name: 'Lasso' }).getAttribute('aria-pressed')).toBe('true');
    expect(menu.getAttribute('aria-label')).toBe('Lasso selection: 1 note, 1 stroke');
    expect(document.activeElement?.textContent).toBe('Ask about this');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['Ask about this', 'Make sticky', 'Send to board', 'Copy', 'Delete']);
  });

  it('offers only Delete for ink, and says why the rest need typed text', async () => {
    stub();
    await mount();
    const menu = lasso(AROUND_INK);
    const item = (name: string) => within(menu).getByRole('menuitem', { name });
    for (const name of ['Ask about this', 'Make sticky', 'Send to board', 'Copy']) {
      expect(item(name).getAttribute('aria-disabled')).toBe('true');
    }
    expect(item('Delete').getAttribute('aria-disabled')).toBeNull();
    const why = document.getElementById(item('Ask about this').getAttribute('aria-describedby')!);
    expect(why?.textContent).toMatch(/the AI cannot read handwriting/);
    expect(document.activeElement?.textContent).toBe('Delete');
    expect(document.querySelector('.pt-nb-lasso-why')).toBeNull();
    // A sighted keyboard user who reaches a disabled action sees why, not only a screen reader.
    fireEvent.keyDown(menu, { key: 'ArrowLeft' });
    expect(document.activeElement?.textContent).toBe('Copy');
    expect(document.querySelector('.pt-nb-lasso-why')?.textContent).toMatch(
      /handwriting is not copied/,
    );
    fireEvent.click(item('Ask about this'));
    expect(push).not.toHaveBeenCalled();
    expect(document.querySelector('.pt-nb-lasso-why')?.textContent).toMatch(
      /the AI cannot read handwriting/,
    );
    expect(menu.getAttribute('aria-label')).toBe('Lasso selection: 1 stroke');
  });

  it('moves along by arrow keys, and Escape closes it but keeps the lasso in the hand', async () => {
    stub();
    await mount();
    const menu = lasso(AROUND_BOTH);
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toBe('Make sticky');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Delete');
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toBe('Ask about this');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    const button = screen.getByRole('button', { name: 'Lasso' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(button);
  });
});

describe('where the menu sits', () => {
  const menu = {
    name: 'Lasso selection: 1 note',
    enabled: { ask: true, sticky: true, board: true, copy: true, delete: true },
    onAction: vi.fn(),
    onClose: vi.fn(),
  };
  const at = (): string[] => {
    const style = document.querySelector<HTMLElement>('.pt-nb-lasso-at')!.style;
    return ['left', 'right', 'top'].map((k) => style.getPropertyValue(`--pt-lasso-${k}`));
  };

  it('hangs from the loop’s left edge in the page’s left half, just under the loop', () => {
    render(
      <LassoLayer
        {...menu}
        scale={1}
        path={[
          [100, 100],
          [300, 100],
          [300, 200],
          [100, 200],
        ]}
      />,
    );
    expect(at()).toEqual(['140px', '', '308px']);
  });

  it('hangs from the loop’s right edge in the right half, so it never runs off the page', () => {
    render(
      <LassoLayer
        {...menu}
        scale={1}
        path={[
          [700, 100],
          [940, 100],
          [940, 200],
          [700, 200],
        ]}
      />,
    );
    expect(at().slice(0, 2)).toEqual(['', '20px']);
  });
});

describe('the lasso’s actions', () => {
  it('Ask about this hands the reader the typed words through this tab, never in the URL', async () => {
    stub();
    await mount();
    fireEvent.click(within(lasso(AROUND_BOTH)).getByRole('menuitem', { name: 'Ask about this' }));
    expect(push).toHaveBeenCalledTimes(1);
    const href = String(push.mock.calls[0]![0]);
    const key = new URLSearchParams(href.split('?')[1]).get('ask')!;
    expect(href).toBe(`/paper/${PAPER}/read?ask=${key}`);
    expect(href).not.toContain('positional');
    expect(window.sessionStorage.getItem(`papertree.notebook-ask.${key}`)).toBe(NOTE);
  });

  it('Make sticky turns the note into a sticky as one undo step', async () => {
    const calls = stub();
    await mount();
    fireEvent.click(within(lasso(AROUND_BOTH)).getByRole('menuitem', { name: 'Make sticky' }));
    await screen.findByRole('button', { name: `Sticky note: ${NOTE}` });
    expect(screen.queryByRole('button', { name: `Typed note: ${NOTE}` })).toBeNull();
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    const sent = writes(calls).map((c) => `${c.method} ${String(c.body?.['kind'] ?? c.path)}`);
    expect(sent).toContain('POST sticky');
    expect(sent).toContain(`DELETE /notebook/pages/${PAGE}/items/ni_note00001?version=1`);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('button', { name: `Typed note: ${NOTE}` });
    expect(screen.queryByRole('button', { name: /^Sticky note:/ })).toBeNull();
  });

  it('Delete takes the stroke and the note as one undo step, and one Undo brings both back', async () => {
    const calls = stub();
    await mount();
    fireEvent.click(within(lasso(AROUND_BOTH)).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(writes(calls).filter((c) => c.method === 'DELETE')).toHaveLength(2));
    expect(document.querySelector('[data-stroke-id="ns_ink000001"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('button', { name: `Typed note: ${NOTE}` });
    expect(document.querySelector('[data-stroke-id="ns_ink000001"]')).not.toBeNull();
    await waitFor(() => expect(writes(calls).filter((c) => c.method === 'POST')).toHaveLength(2));
  });

  it('Send to board makes one note card from the typed words, without the ink', async () => {
    const calls = stub();
    await mount();
    fireEvent.click(within(lasso(AROUND_BOTH)).getByRole('menuitem', { name: 'Send to board' }));
    await screen.findByText(/Sent to the board as a note card\. Ink stays on this page\./);
    const sent = calls.filter((c) => c.path === `/papers/${PAPER}/board/nodes`);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ kind: 'note', body: NOTE });
  });

  it('Copy puts the typed words on the clipboard', async () => {
    stub();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await mount();
    fireEvent.click(within(lasso(AROUND_BOTH)).getByRole('menuitem', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(NOTE);
    await screen.findByText('Copied the typed text. Handwriting is not copied.');
  });
});
