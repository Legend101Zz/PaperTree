/**
 * s5c-notebook-page.spec — the notebook page as a person uses it (#208): the exchange keeps the
 * three voices apart, quote cards carry the answer's marker numbers, Open source flashes the
 * card's STORED Anchor, typed notes and stickies are created, edited, moved by keyboard, deleted
 * and undone, every change is saved with its version, and a 409 is shown, never overwritten.
 * `fetch` plays the API (s5c-notebook-fixtures); everything else is the real feature.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookView, encodeStroke } from '@/features/notebook';
import { QuoteCard } from '@/features/notebook/components/QuoteCard';

import { CITATIONS, PAGE, PAPER, pageView, stubApi, wireItem } from './s5c-notebook-fixtures';

import type { Call } from './s5c-notebook-fixtures';
import type { QuoteItem } from '@/features/notebook';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/paper/x/notebook/y',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  );
}

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET');

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('the exchange block', () => {
  it('keeps you, the paper and the AI apart', async () => {
    stubApi(pageView());
    mount();
    const exchange = await screen.findByRole('region', {
      name: 'The exchange this page started from',
    });
    await within(exchange).findByText(/6,776 tokens · ≈ \$0\.0027 \(estimate\)/);
    const voices = (v: string) => exchange.querySelectorAll(`[data-voice="${v}"]`);
    expect(voices('you')[0]?.textContent).toBe('Explain this passage.');
    expect(voices('paper')[0]?.textContent).toContain(
      'We propose a new simple network architecture',
    );
    expect(voices('ai')).toHaveLength(1);
    expect(within(voices('ai')[0] as HTMLElement).queryByText(/Explain this passage/)).toBeNull();
    expect(exchange.textContent).toContain('Stands on 4 passages · 11 citations');
  });

  it('numbers quote cards as the answer numbers its markers', async () => {
    stubApi(pageView());
    mount();
    const exchange = await screen.findByRole('region', {
      name: 'The exchange this page started from',
    });
    fireEvent.click(await within(exchange).findByRole('button', { name: 'Show all 5 paragraphs' }));
    for (const [n, where] of [
      [1, 'p. 1 ¶1'],
      [2, 'p. 2 ¶2'],
      [3, 'p. 2 ¶3'],
      [4, 'p. 2 ¶4'],
    ] as const) {
      const card = screen.getByRole('article', { name: `Passage ${String(n)}, ${where}` });
      within(card).getByRole('button', { name: `Passage ${String(n)}, ${where}` });
      expect(
        within(exchange).getAllByRole('button', { name: `Passage ${String(n)}, ${where}` }).length,
      ).toBeGreaterThan(0);
    }
    expect(
      within(screen.getByRole('article', { name: 'Passage 1, p. 1 ¶1' })).getByText('×5'),
    ).toBeTruthy();
    expect(within(exchange).getByText(/no citation · the AI's own reading/)).toBeTruthy();
  });

  it('sends a marker in the answer to the reader at the passage it cites', async () => {
    stubApi(pageView());
    mount();
    const exchange = await screen.findByRole('region', {
      name: 'The exchange this page started from',
    });
    fireEvent.click(await within(exchange).findByRole('button', { name: 'Passage 1, p. 1 ¶1' }));
    expect(push).toHaveBeenCalledWith(`/paper/${PAPER}/read?nb=${PAGE}&item=ni_quote0001`);
  });
});

describe('Show in paper', () => {
  it('calls focusAnchor with the card’s stored Anchor, from the button and from the marker', () => {
    const focus = vi.fn();
    const stored = CITATIONS[1]?.anchor;
    const quote = {
      kind: 'quote',
      id: 'ni_q',
      x: 0,
      y: 0,
      w: 272,
      h: 140,
      z: 0,
      anchor: stored,
      text: 'Recurrent models.',
    } as QuoteItem;
    const passage = {
      n: 2,
      page: 2,
      para: 2,
      cited: 1,
      anchorIds: [],
      blockId: null,
      supported: true,
    };
    render(<QuoteCard item={quote} passage={passage} onFocusAnchor={focus} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open source: show passage 2 in the paper' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Passage 2, p. 2 ¶2' }));
    expect(focus).toHaveBeenCalledTimes(2);
    expect(focus.mock.calls.every(([a]) => a === stored)).toBe(true);
  });
});

describe('typed notes and stickies', () => {
  it('creates, edits and undoes a typed note, saving each step', async () => {
    const calls = stubApi(pageView());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }));
    const editor = screen.getByRole('textbox', { name: 'Typed note' });
    expect(editor.getAttribute('data-voice')).toBe('you');
    fireEvent.change(editor, { target: { value: 'Check §3.5 positional encoding.' } });
    fireEvent.blur(editor);
    const note = await screen.findByRole('button', {
      name: 'Typed note: Check §3.5 positional encoding.',
    });
    await settle();
    expect(writes(calls)[0]).toMatchObject({
      method: 'POST',
      body: { kind: 'text', body: 'Check §3.5 positional encoding.' },
    });

    fireEvent.keyDown(note, { key: 'Enter' });
    const again = screen.getByRole('textbox', { name: 'Typed note' });
    fireEvent.change(again, { target: { value: 'Check §3.5 (p. 6).' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    fireEvent.blur(again);
    await screen.findByRole('button', { name: 'Typed note: Check §3.5 (p. 6).' });
    await settle();
    expect(writes(calls)[1]).toMatchObject({
      method: 'PATCH',
      body: { version: 1, body: 'Check §3.5 (p. 6).' },
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await screen.findByRole('button', { name: 'Typed note: Check §3.5 positional encoding.' });
    await settle();
    expect(writes(calls)[2]).toMatchObject({
      method: 'PATCH',
      body: { version: 2, body: 'Check §3.5 positional encoding.' },
    });
  });

  it('creates a sticky and moves it with the keyboard, then deletes it', async () => {
    const calls = stubApi(pageView());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sticky note' }));
    const editor = screen.getByRole('textbox', { name: 'Sticky note' });
    fireEvent.change(editor, { target: { value: 'Q: how does it know word order?' } });
    fireEvent.blur(editor);
    const sticky = await screen.findByRole('button', {
      name: 'Sticky note: Q: how does it know word order?',
    });
    await settle();
    const created = writes(calls)[0]?.body as { x: number; y: number };
    fireEvent.keyDown(sticky, { key: 'ArrowRight' });
    await settle();
    fireEvent.keyDown(sticky, { key: 'ArrowDown', shiftKey: true });
    await settle();
    expect(writes(calls).slice(1)).toEqual([
      expect.objectContaining({ method: 'PATCH', body: { version: 1, x: created.x + 8 } }),
      expect.objectContaining({ method: 'PATCH', body: { version: 2, y: created.y + 24 } }),
    ]);
    fireEvent.keyDown(sticky, { key: 'Delete' });
    await settle();
    expect(screen.queryByRole('button', { name: /Sticky note: Q:/ })).toBeNull();
    expect(writes(calls).at(-1)?.method).toBe('DELETE');
  });

  it('shows a conflict and stops saving instead of overwriting', async () => {
    const note = wireItem('ni_note00001', 'text', 600, 600, 288, 72, 9, 'mine');
    const calls = stubApi(pageView([note]), (call) =>
      call.method === 'PATCH'
        ? new Response(
            JSON.stringify({ detail: 'changed', code: 'stale_version', retryable: false }),
            { status: 409 },
          )
        : null,
    );
    mount();
    const face = await screen.findByRole('button', { name: 'Typed note: mine' });
    fireEvent.keyDown(face, { key: 'ArrowLeft' });
    await screen.findByText(/This page changed somewhere else/);
    fireEvent.keyDown(face, { key: 'ArrowLeft' });
    await settle();
    expect(writes(calls)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('draws stored ink read-only', async () => {
    const view = pageView();
    const stroke = {
      stroke_id: 'ns_stroke001',
      page_id: PAGE,
      tool: 'pen',
      nib: 'F',
      colour: 'pen',
      points_b64: btoa(
        String.fromCharCode(
          ...encodeStroke({
            hasPressure: true,
            points: [
              [100, 100, 0.5],
              [180, 140, 0.6],
            ],
          }),
        ),
      ),
      created_at: '',
    } as const;
    stubApi({ ...view, strokes: [stroke] });
    mount();
    const ink = await screen.findByRole('img', {
      name: 'Your handwriting: 1 stroke, not searchable',
    });
    expect(ink.querySelectorAll('path')).toHaveLength(1);
  });
});

describe('accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    stubApi(pageView([wireItem('ni_note00001', 'sticky', 600, 600, 168, 144, 9, 'stuck')]));
    mount();
    await screen.findByRole('region', { name: 'The exchange this page started from' });
    await screen.findByText(/6,776 tokens/);
    const results = await axe.run(document.body, {
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
        region: { enabled: false },
      },
    });
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
      [],
    );
  });
});
