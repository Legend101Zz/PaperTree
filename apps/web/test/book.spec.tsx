/**
 * The pulled-out and opened book through the library page (#200, frames 02a and 02): Enter on a
 * book takes it out, Enter (a click on the focused cover: happy-dom does not turn Enter into a
 * click) opens the spread, Esc puts it back with focus on the book; the bookplate asks once for a
 * name and never makes one up from the email; "Use Figure 1 as the plate" stores the figure's
 * Anchor and the cover then shows the plate; reduced motion is a fade; axe finds nothing. The race
 * of review B1 (Esc during the opening swing) runs with animations that finish LATER, as a
 * browser's do (`deferredAnimations`).
 * Titles, ids, figures and the abstract are Attention's own (its real parse), never invented.
 */
import axe from 'axe-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView } from '@/features/library';
import type { LibraryPaper } from '@/lib/api/types';

import { readingAt } from './library-corpus';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  uploadWithProgress: vi.fn(),
  putReadingState: vi.fn(),
}));
const auth = vi.hoisted(() => ({ me: vi.fn(), setDisplayName: vi.fn() }));
vi.mock('@/lib/api/papers', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api/papers')>();
  return { ...real, papersApi: api, authApi: { ...real.authApi, ...auth } };
});
const book = vi.hoisted(() => ({
  figures: vi.fn(),
  abstract: vi.fn(),
  setPlate: vi.fn(),
  clearPlate: vi.fn(),
}));
vi.mock('@/features/book/api/bookApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/book/api/bookApi')>()),
  bookApi: book,
}));
const summary = vi.hoisted(() => ({ get: vi.fn(), generate: vi.fn() }));
vi.mock('@/lib/api/summary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/summary')>()),
  summaryApi: summary,
}));
// The library's topics (S2b): answered here, so no request leaves for the default API port (8000,
// another app's on the maintainer's machine; #199 follow-up).
const topics = vi.hoisted(() => ({ list: vi.fn(() => Promise.resolve([])), ofPaper: vi.fn() }));
vi.mock('@/lib/api/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/topics')>()),
  topicsApi: topics,
}));

const ID = 'ppr_G9AYN750E5MG1NRBMGSQJ4N5JM';
const FIGURE_1_ANCHOR = { id: 'anc_figure1', targetKind: 'figure' };
const ATTENTION: LibraryPaper = {
  paper_id: ID,
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
  original_filename: 'attention-is-all-you-need.pdf',
  source_hash: 'sha256:attention',
  page_count: 15,
  processing: 'ready',
  job: null,
  generation: 1,
  parser_version: '1.0.0',
  highlight_count: 3,
  created_at: '2026-10-15T09:00:00+00:00',
  updated_at: '2026-10-15T09:00:00+00:00',
  reading: readingAt(3, 15, '2026-10-16T09:00:00Z'),
  year: 2017,
  arxiv_id: '1706.03762',
  arxiv_category: 'cs.CL',
  thread_count: 2,
  has_summary: true,
  topic: {
    topic_id: 'top_01K0000000000000000000000T',
    name: 'Transformers & attention',
    cloth: 'transformers',
    source: 'arxiv_category',
    source_detail: 'cs.CL',
  },
  notebook_count: 1,
  plate: null,
};
const PLATE = {
  block_id: 'blk_dsibp5ju4rblkcpa',
  page_index: 2,
  label: 'Figure 1',
  caption_text: 'Figure 1: The Transformer - model architecture.',
  asset_url: 'http://127.0.0.1:18909/papers/x/assets/figures/blk_dsibp5ju4rblkcpa?sig=1',
};
const FIGURES = [
  {
    blockId: 'blk_dsibp5ju4rblkcpa',
    pageIndex: 2,
    label: 'Figure 1',
    captionText: PLATE.caption_text,
    assetUrl: PLATE.asset_url,
    anchor: FIGURE_1_ANCHOR,
  },
  {
    blockId: 'blk_q7d5zr6o63eyjhjp',
    pageIndex: 3,
    label: 'Figure 2',
    captionText: 'Figure 2: …',
    assetUrl: 'u2',
    anchor: { id: 'a2' },
  },
  {
    blockId: 'blk_75vfyglfaxdbyinl',
    pageIndex: 3,
    label: null,
    captionText: null,
    assetUrl: 'u3',
    anchor: { id: 'a3' },
  },
];
const ABSTRACT_TEXT =
  'The dominant sequence transduction models are based on complex recurrent or\n' +
  'convolutional neural networks that include an encoder and a decoder. The best\n' +
  'performing models also connect the encoder and decoder through an attention\n' +
  'mechanism. We propose a new simple network architecture, the Transformer, based\n' +
  'solely on attention mechanisms, dispensing with recurrence and convolutions\n' +
  'entirely. Experiments on two machine translation tasks show these models to be.';

function setReducedMotion(reduced: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const animate = vi.fn((..._args: unknown[]): { finished: Promise<void>; cancel: () => void } => ({
  finished: Promise.resolve(),
  cancel: () => undefined,
}));

/**
 * Animations that finish only when told to (or reject when cancelled), as a browser's do: the
 * immediate mock above cannot show a handler that acts after its moment has passed.
 */
function deferredAnimations(): { finishAll: () => Promise<void> } {
  const pending: { readonly ms: number; readonly finish: () => void }[] = [];
  animate.mockImplementation((...args: unknown[]) => {
    const options = args[1] as KeyframeAnimationOptions | undefined;
    let finish = (): void => undefined;
    let fail = (): void => undefined;
    const finished = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = () => reject(new DOMException('cancelled', 'AbortError'));
    });
    pending.push({ ms: Number(options?.duration ?? 0), finish });
    return { finished, cancel: fail };
  });
  return {
    // They all start within a few ms, so they end in the order of their durations: a 200 ms
    // put-back before a 480 ms swing, as in the browser where the reviewer saw the race.
    finishAll: async () => {
      const due = pending.splice(0).sort((a, b) => a.ms - b.ms);
      for (const { finish } of due) {
        finish();
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    },
  };
}

beforeEach(() => {
  push.mockReset();
  api.list.mockResolvedValue([ATTENTION]);
  auth.me.mockResolvedValue({
    user_id: 'usr_1',
    email: 'demo@example.test',
    display_name: 'Mrigesh',
  });
  auth.setDisplayName.mockImplementation((name: string) =>
    Promise.resolve({ user_id: 'usr_1', email: 'demo@example.test', display_name: name }),
  );
  book.figures.mockResolvedValue(FIGURES);
  book.abstract.mockResolvedValue({
    text: ABSTRACT_TEXT,
    page_index: 0,
    anchor: { id: 'anc_abs' },
  });
  book.setPlate.mockResolvedValue(undefined);
  book.clearPlate.mockResolvedValue(undefined);
  summary.get.mockResolvedValue({ state: 'ready', summary: null });
  setReducedMotion(false);
  animate.mockReset();
  animate.mockImplementation(() => ({ finished: Promise.resolve(), cancel: () => undefined }));
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  window.localStorage.clear();
  window.localStorage.setItem('papertree.session', 'tok_test'); // signed in: `useMe` asks
});
afterEach(() => {
  cleanup();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

async function renderLibrary(): Promise<QueryClient> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector(`[data-paper-id="${ID}"]`)).not.toBeNull());
  return client;
}

const theBook = () =>
  document.querySelector<HTMLElement>(`[aria-label="Your shelf"] [data-paper-id="${ID}"]`);

/** Enter on the book on the shelf: it comes out. */
async function pullOut(): Promise<HTMLElement> {
  const spine = theBook() as HTMLElement;
  spine.focus();
  fireEvent.keyDown(spine, { key: 'Enter' });
  return screen.findByRole('dialog', { name: 'Attention Is All You Need' });
}

/** Enter again: the focused cover is a button, and its click opens the spread. */
async function openSpread(dialog: HTMLElement): Promise<void> {
  fireEvent.click(document.activeElement as HTMLElement);
  await waitFor(() => expect(dialog.getAttribute('data-book-stage')).toBe('open'));
}

async function seriousViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { resultTypes: ['violations'] });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id);
}

describe('pull out and open (02a → 02)', () => {
  it('Enter lifts the book out, Enter opens it, Esc puts it back with focus on it', async () => {
    await renderLibrary();
    const dialog = await pullOut();
    expect(dialog.getAttribute('data-book-stage')).toBe('pulled');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const cover = within(dialog).getByRole('button', { name: 'Open Attention Is All You Need' });
    expect(document.activeElement).toBe(cover);
    expect(dialog.querySelector('[data-cover="typographic"]')?.textContent).toMatch(
      /2017 · arXiv 1706\.03762/,
    );
    expect(within(dialog).getByText('Reading now · p. 4 of 15')).toBeTruthy();
    expect(theBook()?.getAttribute('data-pulled')).toBe('true');
    expect(document.querySelector('.pt-library')?.hasAttribute('inert')).toBe(true);

    await openSpread(dialog);
    const read = within(dialog).getByRole('button', { name: /^Read / });
    expect(document.activeElement).toBe(read);

    fireEvent.keyDown(read, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(theBook());
    expect(theBook()?.hasAttribute('data-pulled')).toBe(false);
    expect(document.querySelector('.pt-library')?.hasAttribute('inert')).toBe(false);
  });

  it('prints the real facts on the right page and goes to the reader', async () => {
    await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    await waitFor(() =>
      expect(dialog.querySelector('[data-book-figures]')?.textContent).toBe(
        '2 figures found · Figure 1 (p. 3), Figure 2 (p. 4)',
      ),
    );
    expect(dialog.querySelector('[data-book-meta]')?.textContent).toMatch(
      /^2017 · arXiv 1706\.03762 · 15 pages/,
    );
    expect(within(dialog).getByText('suggested from arXiv cs.CL · you accepted')).toBeTruthy();
    const quote = await waitFor(() => {
      const found = dialog.querySelector('[data-voice="paper"]');
      if (found === null) throw new Error('no abstract yet');
      return found;
    });
    expect(quote.textContent).toMatch(/^“The dominant sequence transduction models/);
    expect(quote.textContent).toMatch(/convolutions entirely\.”$/);
    const tab = within(dialog).getByRole('link', { name: /^p\. 1, Abstract/ });
    expect(tab.getAttribute('href')).toBe(`/paper/${ID}/read?from=book&at=abstract`);
    expect(
      within(dialog).getByText('3 highlights · 2 explanation threads · 1 notebook page'),
    ).toBeTruthy();
    expect(await within(dialog).findByText('Summary ready (cached)')).toBeTruthy();
    expect(
      within(dialog)
        .getByRole('link', { name: /arxiv\.org\/abs\/1706\.03762/ })
        .getAttribute('href'),
    ).toBe('https://arxiv.org/abs/1706.03762');
    expect(await seriousViolations()).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Summary' }));
    expect(push).toHaveBeenLastCalledWith(`/paper/${ID}/read?from=book&open=summary`);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Read / }));
    await waitFor(() => expect(push).toHaveBeenLastCalledWith(`/paper/${ID}/read`));
  });

  it('a click keeps the catalogue card, whose "Open the book" goes to the spread', async () => {
    await renderLibrary();
    fireEvent.click(theBook() as HTMLElement);
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-card-paper-id="${ID}"]`);
      if (found === null) throw new Error('no card');
      return found;
    });
    fireEvent.click(within(card).getByRole('button', { name: /^Open the book/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Attention Is All You Need' });
    expect(dialog.getAttribute('data-book-stage')).toBe('open');
  });

  it('a book that cannot be opened yet keeps Enter for its card', async () => {
    api.list.mockResolvedValue([{ ...ATTENTION, processing: 'failed', generation: null }]);
    await renderLibrary();
    const spine = theBook() as HTMLElement;
    spine.focus();
    // Not cancelled: the browser turns this Enter into the button's click, which opens the card.
    expect(fireEvent.keyDown(spine, { key: 'Enter' })).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(spine, { detail: 0 });
    expect(
      await waitFor(() => {
        const card = document.querySelector(`[data-card-paper-id="${ID}"]`);
        if (card === null) throw new Error('no card');
        return card;
      }),
    ).toBeTruthy();
  });

  it('keeps Tab and Shift+Tab inside the open book', async () => {
    await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    await within(dialog).findByText('Summary ready (cached)');
    const stops = Array.from(
      dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input'),
    );
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe('the bookplate', () => {
  it('names the library from display_name', async () => {
    await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    const plate = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-bookplate]');
      if (found?.textContent?.includes('Mrigesh') !== true) throw new Error('no name yet');
      return found;
    });
    expect(plate.textContent).toMatch(/ex libris.*From the library of.*Mrigesh/);
    expect(plate.textContent).toMatch(/PaperTree · shelved 15 Oct 2026/);
  });

  it('asks once when there is no name, saves the answer, and never uses the email', async () => {
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: null });
    await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    const field = await within(dialog).findByLabelText('Whose library is this?');
    expect(dialog.textContent).not.toMatch(/demo/i);
    fireEvent.change(field, { target: { value: '  Mrigesh ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(auth.setDisplayName).toHaveBeenCalledWith('Mrigesh'));
    await waitFor(() =>
      expect(dialog.querySelector('[data-bookplate]')?.textContent).toMatch(
        /From the library of\s*Mrigesh/,
      ),
    );
    expect(within(dialog).queryByLabelText('Whose library is this?')).toBeNull();
  });

  it('after Not now leaves the line out, and does not ask again', async () => {
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: null });
    await renderLibrary();
    let dialog = await pullOut();
    await openSpread(dialog);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Not now' }));
    expect(within(dialog).queryByLabelText('Whose library is this?')).toBeNull();
    expect(dialog.textContent).not.toMatch(/From the library of/);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await pullOut();
    await openSpread(dialog);
    await waitFor(() => expect(dialog.querySelector('[data-bookplate]')).not.toBeNull());
    expect(within(dialog).queryByLabelText('Whose library is this?')).toBeNull();
  });
});

describe('the plate', () => {
  it('"Use Figure 1 (p. 3) as the plate" stores the figure’s Anchor, and the cover shows it', async () => {
    const client = await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    const offer = await within(dialog).findByRole('button', {
      name: 'Use Figure 1 (p. 3) as the plate',
    });
    api.list.mockResolvedValue([{ ...ATTENTION, plate: PLATE }]);
    fireEvent.click(offer);
    await waitFor(() => expect(book.setPlate).toHaveBeenCalledWith(ID, FIGURE_1_ANCHOR));
    await act(() => client.refetchQueries({ queryKey: ['papers'] }));
    await waitFor(() =>
      expect(dialog.querySelector('[data-plate] img')?.getAttribute('src')).toBe(PLATE.asset_url),
    );
    expect(
      within(dialog).getByText('Figure 1 (p. 3) · The Transformer - model architecture.'),
    ).toBeTruthy();
    // The face-out cover on the shelf shows the plate too.
    expect(theBook()?.querySelector('img')?.getAttribute('src')).toBe(PLATE.asset_url);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use the typographic cover' }));
    await waitFor(() => expect(book.clearPlate).toHaveBeenCalledWith(ID));
  });

  it('offers nothing when the parser found no caption-matched Figure 1', async () => {
    book.figures.mockResolvedValue(FIGURES.slice(1));
    await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    await waitFor(() => expect(dialog.querySelector('[data-book-figures]')).not.toBeNull());
    expect(within(dialog).queryByRole('button', { name: /as the plate$/ })).toBeNull();
  });
});

describe('the race of review B1: Esc while the book is moving', () => {
  it('Esc during the opening swing puts the book back, and it stays back', async () => {
    const motion = deferredAnimations();
    await renderLibrary();
    const dialog = await pullOut();
    fireEvent.click(document.activeElement as HTMLElement); // Enter: the swing starts
    fireEvent.click(document.activeElement as HTMLElement); // a second Enter starts nothing
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await motion.finishAll(); // the swing (cancelled) and the put-back settle
    await motion.finishAll();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(theBook());
    expect(theBook()?.hasAttribute('data-pulled')).toBe(false);
  });

  it('Enter on the cover right after Esc does not bring the book back', async () => {
    const motion = deferredAnimations();
    await renderLibrary();
    const dialog = await pullOut();
    const cover = document.activeElement as HTMLElement;
    fireEvent.keyDown(cover, { key: 'Escape' });
    fireEvent.click(cover); // Enter 50 ms later, while the put-back is still running
    await motion.finishAll();
    await motion.finishAll();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(theBook());
  });

  it('still opens when nothing interrupts the swing', async () => {
    const motion = deferredAnimations();
    await renderLibrary();
    const dialog = await pullOut();
    fireEvent.click(document.activeElement as HTMLElement);
    expect(dialog.getAttribute('data-book-stage')).toBe('pulled'); // not before the swing ends
    await motion.finishAll();
    expect(dialog.getAttribute('data-book-stage')).toBe('open');
  });
});

describe('focus, the name and the summary', () => {
  it('after Save, focus is on the new name inside the book', async () => {
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: null });
    await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    const field = await within(dialog).findByLabelText('Whose library is this?');
    fireEvent.change(field, { target: { value: 'Mrigesh' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect((document.activeElement as HTMLElement).hasAttribute('data-bookplate-owner')).toBe(
        true,
      ),
    );
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toMatch(/From the library of\s*Mrigesh/);
  });

  it('after Not now, focus is on "Name this library", which asks again', async () => {
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: null });
    await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Not now' }));
    const again = within(dialog).getByRole('button', { name: 'Name this library' });
    await waitFor(() => expect(document.activeElement).toBe(again));
    fireEvent.click(again);
    const field = await within(dialog).findByLabelText('Whose library is this?');
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('remembers Not now per account, so another account in this browser is still asked', async () => {
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'a@example.test', display_name: null });
    const client = await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Not now' }));
    expect(window.localStorage.getItem('papertree/book/name-declined/usr_1')).toBe('yes');
    auth.me.mockResolvedValue({ user_id: 'usr_2', email: 'b@example.test', display_name: null });
    await act(() => client.refetchQueries({ queryKey: ['me'] }));
    expect(await within(dialog).findByLabelText('Whose library is this?')).toBeTruthy();
  });

  it('a field with text takes the first Esc; the book stays open', async () => {
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: null });
    await renderLibrary();
    const dialog = await pullOut();
    await openSpread(dialog);
    const field = (await within(dialog).findByLabelText(
      'Whose library is this?',
    )) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Mrig' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('');
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('the header’s initial is the library’s name once there is one, else the email’s', async () => {
    await renderLibrary();
    const account = screen.getByRole('button', { name: /^Account/ });
    await waitFor(() => expect(account.textContent?.trim()).toBe('M'));
    cleanup();
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: null });
    await renderLibrary();
    await waitFor(() => expect(auth.me).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^Account/ }).textContent?.trim()).not.toBe('M');
  });

  it('says what the summary is: partial is not "ready", and none offers to make one', async () => {
    summary.get.mockResolvedValue({ state: 'partial', summary: null });
    await renderLibrary();
    let dialog = await pullOut();
    await openSpread(dialog);
    expect(
      await within(dialog).findByText('Summary cached (partial: some points have no passage)'),
    ).toBeTruthy();
    expect(within(dialog).queryByText('Summary ready (cached)')).toBeNull();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    cleanup();
    summary.get.mockResolvedValue({ state: 'none', summary: null });
    await renderLibrary();
    dialog = await pullOut();
    await openSpread(dialog);
    expect(await within(dialog).findByText('No summary yet')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Summarize' })).toBeTruthy();
  });
});

describe('motion', () => {
  it('pulls out on the lift curve from the spine, and opens with the 480 ms swing', async () => {
    await renderLibrary();
    const dialog = await pullOut();
    expect(dialog.getAttribute('data-motion')).toBe('full');
    const [, pullTiming] = animate.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(pullTiming.duration).toBe(400);
    await openSpread(dialog);
    const durations = animate.mock.calls.map(
      (call) => (call as unknown as [unknown, { duration: number }])[1].duration,
    );
    expect(durations).toContain(480);
  });

  it('is an instant swap with a short fade under reduced motion', async () => {
    setReducedMotion(true);
    await renderLibrary();
    const dialog = await pullOut();
    expect(dialog.getAttribute('data-motion')).toBe('reduced');
    await openSpread(dialog);
    for (const call of animate.mock.calls) {
      const [keyframes, timing] = call as unknown as [Keyframe[], KeyframeAnimationOptions];
      expect(timing.duration).toBe(120);
      expect(keyframes.every((k) => k.transform === undefined)).toBe(true);
    }
    expect(animate).toHaveBeenCalled();
  });
});
