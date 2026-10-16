/**
 * s5c-notebook-panel.spec — the notebook's side panel and page actions (#208, part 2): the template
 * switch saves with the page's version, the counts are the server's, Send page to board creates the
 * `notebook` card and offers Open board, shapes are created, moved, resized and deleted by
 * keyboard, and search lights its matches on the page. Two tabs send one card; the board is re-read
 * only while the page has a card; the template's failure clears when its choice goes back; the
 * title and a lit exchange keep their voice and say their match. `fetch` plays the API.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookView } from '@/features/notebook';
import { citationsPhrase } from '@/features/notebook/components/NotebookPanel';
import { cardIdFor } from '@/features/notebook/hooks/useBoardCard';

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

function mount(): HTMLElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  ).container;
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
    await within(panel).findByText('4 quotes');
    expect(within(panel).getByRole('link', { name: 'Open it there' }).getAttribute('href')).toBe(
      `/paper/${PAPER}/board`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open board' }));
    expect(push).toHaveBeenCalledWith(`/paper/${PAPER}/board`);
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

describe('Send page to board, once', () => {
  it('sends one card for a double click, and opens the board once the page is on it', async () => {
    const calls = stubApi(pageView());
    mount();
    await screen.findByText(/not on the board yet/);
    fireEvent.click(headerSend());
    fireEvent.click(headerSend());
    await screen.findByText('The page is on the board now, as one card.');
    const posts = writes(calls).filter((c) => c.path === `/papers/${PAPER}/board/nodes`);
    expect(posts).toHaveLength(1);
    fireEvent.click(headerSend());
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/paper/${PAPER}/board`));
    expect(writes(calls).filter((c) => c.path === `/papers/${PAPER}/board/nodes`)).toHaveLength(1);
  });

  it('sends nothing while the board cannot be read, and says so', async () => {
    const calls = stubApi(pageView(), undefined, { boardFails: true });
    mount();
    await screen.findByText('The board could not be read, so the page cannot be sent yet.');
    const send = headerSend();
    expect(send.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(send);
    await settle();
    expect(writes(calls)).toHaveLength(0);
  });

  it('keeps the card’s counts current as the page changes', async () => {
    stubApi(pageView([STICKY]));
    mount();
    await screen.findByText(/not on the board yet/);
    fireEvent.click(headerSend());
    const panel = screen.getByRole('complementary', { name: 'Page' });
    await within(panel).findByText('4 quotes · 1 sticky');
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const editor = screen.getByRole('textbox', { name: 'Sticky note' });
    fireEvent.change(editor, { target: { value: 'one more' } });
    fireEvent.blur(editor);
    await within(panel).findByText('4 quotes · 2 stickies');
  });
});

describe('the template’s saving', () => {
  it('a failed template save is in the notice, and Try again sends it again', async () => {
    let failing = true;
    const calls = stubApi(pageView(), (c) =>
      c.method === 'PATCH' && c.path === `/notebook/pages/${PAGE}` && failing
        ? new Response(
            JSON.stringify({ detail: 'down', code: 'agent_unavailable', retryable: true }),
            {
              status: 503,
            },
          )
        : null,
    );
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Lined' }));
    await screen.findByText(/Not saved yet: 1 edit could not be sent/);
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Not saved/)).toBeNull());
    const sends = writes(calls).filter((c) => c.path === `/notebook/pages/${PAGE}`);
    expect(sends.map((c) => c.body)).toEqual([
      { version: 1, template: 'lined' },
      { version: 1, template: 'lined' },
    ]);
  });
});

describe('the Shapes menu', () => {
  it('closes on Escape from its button and on a press outside it', async () => {
    stubApi(pageView());
    mount();
    const shapes = await screen.findByRole('button', { name: 'Shapes' });
    fireEvent.click(shapes);
    expect(screen.getByRole('group', { name: 'Shapes' })).toBeTruthy();
    fireEvent.keyDown(shapes, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Shapes' })).toBeNull();
    fireEvent.click(shapes);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Shapes' })).toBeNull();
  });
});

describe('the counts’ words', () => {
  it('says "1 citation", and counts passages from the answer, not from the cards', async () => {
    expect(citationsPhrase(1)).toBe('1 citation');
    expect(citationsPhrase(11)).toBe('11 citations');
    // Two quote cards deleted: the answer still stands on its four passages.
    const view = pageView();
    stubApi({ ...view, items: view.items.filter((i) => !/^ni_quote000[12]$/.test(i.item_id)) });
    mount();
    await waitFor(() => expect(count('Passages it stands on')).toBe('4'));
    expect(document.querySelectorAll('.pt-nb-quote')).toHaveLength(2);
  });
});

describe('one card per page, across tabs', () => {
  it('derives the card id from the page id, and keeps the client-id shape', () => {
    expect(cardIdFor('np_G9AYN750E5MG1NRBMGSQJ4N5JM')).toBe('cn_G9AYN750E5MG1NRBMGSQJ4N5JM');
    expect(cardIdFor('np_shot00001')).toBe('cn_shot00001');
    // Not the shape (too short): a fresh id, so the API never refuses the send for its id.
    expect(cardIdFor('np_x')).toMatch(/^cn_[0-9a-f-]{36}$/);
  });

  it('a second tab that has not seen the card sends the same id and gets the one card', async () => {
    const calls = stubApi(pageView());
    const first = mount();
    const second = mount();
    await within(second).findByText(/not on the board yet/);
    fireEvent.click(within(first).getAllByRole('button', { name: 'Send page to board' })[0]!);
    await within(first).findByText('The page is on the board now, as one card.');
    // The second tab's board is out of date; its send goes out and comes back with the first card.
    within(second).getByText(/not on the board yet/);
    fireEvent.click(within(second).getAllByRole('button', { name: 'Send page to board' })[0]!);
    await within(second).findByText('4 quotes');
    const posts = writes(calls).filter((c) => c.path === `/papers/${PAPER}/board/nodes`);
    expect(posts.map((c) => c.body?.['node_id'])).toEqual([cardIdFor(PAGE), cardIdFor(PAGE)]);
  });

  it('re-reads the board after an edit only while the page has a card on it', async () => {
    const calls = stubApi(pageView([STICKY]));
    mount();
    const sticky = await screen.findByRole('button', { name: 'Sticky note: word order?' });
    await screen.findByText(/not on the board yet/);
    const boardReads = (): number =>
      calls.filter((c) => c.method === 'GET' && c.path === `/papers/${PAPER}/board`).length;
    const before = boardReads();
    fireEvent.keyDown(sticky, { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').length).toBeGreaterThan(0),
    );
    await settle();
    expect(boardReads()).toBe(before);
    fireEvent.click(headerSend());
    await screen.findByText('The page is on the board now, as one card.');
    const sent = boardReads();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sticky note: word order?' }), {
      key: 'ArrowLeft',
    });
    await waitFor(() => expect(boardReads()).toBe(sent + 1));
  });
});

describe('the template’s saving, at the edges', () => {
  const failing = (status: number, code: string) => (c: Call) =>
    c.method === 'PATCH' && c.path === `/notebook/pages/${PAGE}`
      ? new Response(JSON.stringify({ detail: code, code, retryable: false }), { status })
      : null;

  it('choosing the saved template back clears a failure, and Try again then sends nothing', async () => {
    const calls = stubApi(pageView(), failing(503, 'agent_unavailable'));
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Lined' }));
    await screen.findByText(/Not saved yet: 1 edit could not be sent/);
    fireEvent.click(screen.getByRole('radio', { name: /Dot grid/ }));
    await waitFor(() => expect(screen.queryByText(/Not saved/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(writes(calls).filter((c) => c.path === `/notebook/pages/${PAGE}`)).toHaveLength(1);
  });

  it('a template save on a page deleted elsewhere is the page-gone bar', async () => {
    stubApi(pageView(), failing(404, 'not_found'));
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Lined' }));
    const bar = await screen.findByRole('alert');
    expect(bar.textContent).toContain('This page was deleted somewhere else');
  });
});

describe('voices and search, said', () => {
  it('the title is the paper’s words after Dive in’s lead-in; a lit exchange says it matched', async () => {
    stubApi(pageView());
    mount();
    const title = await screen.findByRole('heading', { level: 1 });
    expect(title.textContent).toBe('Dive in: the Transformer’s central proposal');
    expect(title.querySelector('[data-voice="paper"]')?.textContent).toBe(
      'the Transformer’s central proposal',
    );
    expect(
      screen.getByRole('region', { name: 'The exchange this page started from' }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Transformer' } });
    await screen.findByRole('region', {
      name: 'The exchange this page started from (matches your search)',
    });
  });
});
