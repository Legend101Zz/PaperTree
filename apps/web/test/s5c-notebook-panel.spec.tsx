/**
 * s5c-notebook-panel.spec — the notebook's side panel and page actions (#208, part 2): the template
 * switch saves with the page's version, the counts are the server's, Send page to board creates the
 * `notebook` card and offers Open board, shapes are created, moved, resized and deleted by
 * keyboard, and search lights its matches on the page. `fetch` plays the API.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookView } from '@/features/notebook';

import { PAGE, PAPER, pageView, stubApi, wireItem } from './s5c-notebook-fixtures';

import type { Call } from './s5c-notebook-fixtures';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/paper/x/notebook/y',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => push.mockReset());
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
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const STICKY = wireItem('ni_sticky0001', 'sticky', 600, 600, 168, 144, 9, 'word order?');

/** The header's Send page to board (the panel offers a second one while the page is not sent). */
const headerSend = (): HTMLElement =>
  screen.getAllByRole('button', { name: 'Send page to board' })[0] as HTMLElement;

function count(label: string): string | null | undefined {
  const panel = screen.getByRole('complementary', { name: 'Page' });
  return within(panel).getByText(label).nextElementSibling?.textContent;
}

describe('the side panel', () => {
  it('switches the template and saves it with the page version', async () => {
    const calls = stubApi(pageView());
    mount();
    const lined = await screen.findByRole('radio', { name: 'Lined' });
    expect(screen.getByRole('radio', { name: /Dot grid/ })).toHaveProperty('checked', true);
    fireEvent.click(lined);
    await settle();
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: `/notebook/pages/${PAGE}`,
        body: { version: 1, template: 'lined' },
      }),
    ]);
    expect(document.querySelector('.pt-nb-page')?.getAttribute('data-template')).toBe('lined');
    expect(screen.getByRole('radio', { name: /Lined.*in use/ })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Cornell' }));
    await settle();
    expect(writes(calls)[1]?.body).toEqual({ version: 2, template: 'cornell' });
  });

  it('shows the server’s counts, ink as "yours" with no number, and keeps them current', async () => {
    stubApi(pageView([STICKY]));
    mount();
    await waitFor(() => expect(count('Passages it stands on')).toBe('4'));
    expect(count('Your question')).toBe('1');
    expect(count('The AI’s answer')).toBe('11 citations');
    expect(count('Sticky notes')).toBe('1');
    expect(count('Ink')).toBe('none yet');
    expect(screen.getByText(/Handwriting is not searchable/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const editor = screen.getByRole('textbox', { name: 'Sticky note' });
    fireEvent.change(editor, { target: { value: 'another' } });
    fireEvent.blur(editor);
    await waitFor(() => expect(count('Sticky notes')).toBe('2'));
  });
});

describe('Send page to board', () => {
  it('creates the notebook card, offers Open board, and shows the card with its counts', async () => {
    const calls = stubApi(pageView());
    mount();
    const panel = await screen.findByRole('complementary', { name: 'Page' });
    await within(panel).findByText(/not on the board yet/);
    fireEvent.click(headerSend());
    await screen.findByText('The page is on the board now, as one card.');
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: `/papers/${PAPER}/board/nodes`,
        body: expect.objectContaining({ kind: 'notebook', source_page_id: PAGE }),
      }),
    ]);
    await within(panel).findByText('4 quotes · 1 sticky');
    expect(within(panel).getByRole('link', { name: 'Open it there' }).getAttribute('href')).toBe(
      `/paper/${PAPER}/canvas`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open board' }));
    expect(push).toHaveBeenCalledWith(`/paper/${PAPER}/canvas`);
    fireEvent.click(headerSend());
    await screen.findByText('This page is already on the board.');
    expect(writes(calls)).toHaveLength(1);
  });
});

describe('shapes', () => {
  it('adds a rectangle, moves and resizes it by keyboard, deletes it and undoes the delete', async () => {
    const calls = stubApi(pageView());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Shapes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a rectangle' }));
    const shape = await screen.findByRole('button', { name: 'Rectangle you drew' });
    await settle();
    const made = writes(calls)[0];
    expect(made).toMatchObject({
      method: 'POST',
      body: { kind: 'shape', body: '{"shape":"rect"}' },
    });
    const { x, w } = made?.body as { x: number; w: number };
    fireEvent.keyDown(shape, { key: 'ArrowRight' });
    await settle();
    fireEvent.keyDown(shape, { key: 'ArrowRight', altKey: true });
    await settle();
    expect(
      writes(calls)
        .slice(1)
        .map((c) => c.body),
    ).toEqual([
      { version: 1, x: x + 8 },
      { version: 2, w: w + 8 },
    ]);
    fireEvent.keyDown(shape, { key: 'Delete' });
    await settle();
    expect(screen.queryByRole('button', { name: 'Rectangle you drew' })).toBeNull();
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await screen.findByRole('button', { name: 'Rectangle you drew' });
    await settle();
    expect(
      writes(calls)
        .slice(-2)
        .map((c) => c.method),
    ).toEqual(['DELETE', 'POST']);
  });
});

describe('search', () => {
  it('lights the items on this page that match', async () => {
    stubApi(pageView([STICKY]));
    mount();
    const box = await screen.findByRole('searchbox');
    fireEvent.change(box, { target: { value: 'word order' } });
    await screen.findByText('1 on this page');
    const lit = document.querySelectorAll('[data-match="true"]');
    expect([...lit].map((el) => el.getAttribute('data-item-id'))).toEqual(['ni_sticky0001']);
  });
});
