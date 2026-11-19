/**
 * The book taken off the shelf and opened, through the library page (#200, v0.3 #337): a click (or
 * Enter) on any spine runs one 880 ms motion that lands on the opened spread, with focus on Read;
 * Esc puts it back with focus on the spine; there is no catalogue card in between, and the book
 * that opens is the one that was clicked, on any plank (#336). The bookplate asks once for a name
 * and never makes one up from the email; "Use Figure 1 as the plate" stores the figure's Anchor;
 * reduced motion is a cross-fade; axe finds nothing. The skip and the race of review B1 run with
 * animations that finish LATER, as a browser's do (`deferredAnimations`).
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

interface FakeAnimation {
  readonly finished: Promise<void>;
  readonly cancel: () => void;
  readonly finish: () => void;
}
const animate = vi.fn((..._args: unknown[]): FakeAnimation => ({
  finished: Promise.resolve(),
  cancel: () => undefined,
  finish: () => undefined,
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
    // `finish()` is "skip to the end": it settles the promise early, as the browser's does.
    return { finished, cancel: fail, finish };
  });
  return {
    // They all start within a few ms, so they end in the order of their durations: a 420 ms
    // put-back before an 880 ms take-out, as in the browser where the reviewer saw the race.
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
  animate.mockImplementation(() => ({
    finished: Promise.resolve(),
    cancel: () => undefined,
    finish: () => undefined,
  }));
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

/** A click on the book on the shelf: it comes out and opens. */
async function takeOut(): Promise<HTMLElement> {
  const spine = theBook() as HTMLElement;
  spine.focus();
  fireEvent.click(spine);
  return screen.findByRole('dialog', { name: 'Attention Is All You Need' });
}

/** The motion has played (the mock's animations end at once): the spread is open. */
async function settled(dialog: HTMLElement): Promise<void> {
  await waitFor(() => expect(dialog.getAttribute('data-book-stage')).toBe('open'));
}

async function seriousViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { resultTypes: ['violations'] });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id);
}

describe('take out and open (v0.3 #337)', () => {
  it('a click lands on the spread with focus on Read; Esc puts it back with focus on the spine', async () => {
    await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('heading', { name: 'Attention Is All You Need' })).toBeTruthy();
    expect(dialog.querySelector('[data-bookplate]')).not.toBeNull();
    expect(within(dialog).getByText('Reading now · p. 4 of 15')).toBeTruthy();
    const read = within(dialog).getByRole('button', { name: /^Read / });
    expect(document.activeElement).toBe(read);
    expect(theBook()?.getAttribute('data-pulled')).toBe('true');
    expect(document.querySelector('.pt-library')?.hasAttribute('inert')).toBe(true);

    fireEvent.keyDown(read, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(theBook());
    expect(theBook()?.hasAttribute('data-pulled')).toBe(false);
    expect(document.querySelector('.pt-library')?.hasAttribute('inert')).toBe(false);
  });

  it('Enter on a spine does the same (the keyboard path is the button’s own click)', async () => {
    await renderLibrary();
    const spine = theBook() as HTMLElement;
    spine.focus();
    // The browser turns an uncancelled Enter into the button's click; happy-dom does not.
    expect(fireEvent.keyDown(spine, { key: 'Enter' })).toBe(true);
    fireEvent.click(spine, { detail: 0 });
    const dialog = await screen.findByRole('dialog', { name: 'Attention Is All You Need' });
    await settled(dialog);
  });

  it('a click outside the book (on the veil) puts it back', async () => {
    await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
    const veil = dialog.querySelector('.pt-book__veil') as HTMLElement;
    fireEvent.pointerDown(veil);
    fireEvent.click(veil);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(theBook());
  });

  it('has no catalogue card: no Read / Open the book / Delete between the click and the spread', async () => {
    await renderLibrary();
    const dialog = await takeOut();
    expect(document.querySelector('[data-card-paper-id], [data-card-read]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Open the book/ })).toBeNull();
    await settled(dialog);
    expect(screen.queryByRole('button', { name: /^Open the book/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
    expect(document.querySelector('.pt-catalogue')).toBeNull();
  });

  it('stands nine books on two planks at 1440 px, and a click on the lower plank opens THAT book (#336)', async () => {
    // happy-dom lays nothing out: the shelf is 1280 px wide, as at 1440.
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('pt-planks') ? 1280 : 0;
      },
    });
    try {
      const on = (id: string, title: string, topic: string, at: number): LibraryPaper => ({
        ...ATTENTION,
        paper_id: id,
        title,
        reading: null,
        created_at: `2026-10-0${String(at)}T09:00:00+00:00`,
        topic:
          topic === 'Transformers & attention'
            ? ATTENTION.topic
            : {
                topic_id: `top_${topic}`,
                name: topic,
                cloth: 'vision',
                source: 'arxiv_category',
                source_detail: 'cs.CV',
              },
      });
      api.list.mockResolvedValue([
        { ...ATTENTION, reading: null, created_at: '2026-10-01T08:00:00+00:00' },
        on('ppr_t2', 'Sentence-BERT', 'Transformers & attention', 1),
        on('ppr_t3', 'BERT', 'Transformers & attention', 1),
        on('ppr_t4', 'FlashAttention', 'Transformers & attention', 1),
        on('ppr_l1', 'SuperGLUE', 'Language', 2),
        on('ppr_u1', 'Proof-Gated Skill Compilation', 'Agents', 3),
        on('ppr_v1', 'Deep Residual Learning', 'Vision & detection', 4),
        on('ppr_v2', 'Adam', 'Vision & detection', 4),
        on('ppr_v3', 'Neural Ordinary Differential Equations', 'Vision & detection', 4),
      ]);
      await renderLibrary();
      const planks = document.querySelectorAll('[aria-label="Your shelf"] .pt-plank');
      expect(planks).toHaveLength(2);
      const count = (plank: Element | undefined) =>
        plank?.querySelectorAll('button[data-paper-id]').length;
      expect([count(planks[0]), count(planks[1])]).toEqual([6, 3]);
      const resnet = planks[1]?.querySelector<HTMLElement>('[data-paper-id="ppr_v1"]');
      expect(resnet).not.toBeNull();
      fireEvent.click(resnet as HTMLElement);
      const dialog = await screen.findByRole('dialog', { name: 'Deep Residual Learning' });
      await settled(dialog);
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(resnet?.getAttribute('data-pulled')).toBe('true');
      expect(theBook()?.hasAttribute('data-pulled')).toBe(false);
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(resnet);
    } finally {
      if (width !== undefined) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
    }
  });

  it('opens THAT book when a row at scale is clicked (41 papers, a plank per topic)', async () => {
    const other = (id: string, title: string, topic: string): LibraryPaper => ({
      ...ATTENTION,
      paper_id: id,
      title,
      reading: null,
      topic: {
        topic_id: `top_${topic}`,
        name: topic,
        cloth: 'vision',
        source: 'arxiv_category',
        source_detail: 'cs.CV',
      },
    });
    const filler = Array.from({ length: 39 }, (_, i) =>
      other(`ppr_f${String(i)}`, `Filler paper ${String(i)}`, 'Vision'),
    );
    api.list.mockResolvedValue([
      ATTENTION,
      ...filler,
      other('ppr_node', 'Neural Ordinary Differential Equations', 'Optimization'),
    ]);
    await renderLibrary();
    const node = document.querySelector<HTMLElement>('[data-paper-id="ppr_node"]') as HTMLElement;
    const plank = node.closest('[role="group"]');
    expect(plank?.querySelectorAll('[data-paper-id]')).toHaveLength(1);
    expect(plank?.contains(theBook())).toBe(false);
    fireEvent.click(node);
    const dialog = await screen.findByRole('dialog', {
      name: 'Neural Ordinary Differential Equations',
    });
    await settled(dialog);
    expect(node.getAttribute('data-pulled')).toBe('true');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(node);
  });

  it('a book that cannot be opened yet is read instead, where Source mode works for it', async () => {
    api.list.mockResolvedValue([{ ...ATTENTION, processing: 'failed', generation: null }]);
    await renderLibrary();
    fireEvent.click(theBook() as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(push).toHaveBeenLastCalledWith(`/paper/${ID}/read`);
  });

  it('prints the real facts on the right page and goes to the reader', async () => {
    await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
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

  it('keeps Tab and Shift+Tab inside the open book', async () => {
    await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
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
    const dialog = await takeOut();
    await settled(dialog);
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
    const dialog = await takeOut();
    await settled(dialog);
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
    let dialog = await takeOut();
    await settled(dialog);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Not now' }));
    expect(within(dialog).queryByLabelText('Whose library is this?')).toBeNull();
    expect(dialog.textContent).not.toMatch(/From the library of/);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await takeOut();
    await settled(dialog);
    await waitFor(() => expect(dialog.querySelector('[data-bookplate]')).not.toBeNull());
    expect(within(dialog).queryByLabelText('Whose library is this?')).toBeNull();
  });
});

describe('the plate', () => {
  it('"Use Figure 1 (p. 3) as the plate" stores the figure’s Anchor, and the spread shows it', async () => {
    const client = await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use the typographic cover' }));
    await waitFor(() => expect(book.clearPlate).toHaveBeenCalledWith(ID));
  });

  it('offers nothing when the parser found no caption-matched Figure 1', async () => {
    book.figures.mockResolvedValue(FIGURES.slice(1));
    await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
    await waitFor(() => expect(dialog.querySelector('[data-book-figures]')).not.toBeNull());
    expect(within(dialog).queryByRole('button', { name: /as the plate$/ })).toBeNull();
  });
});

describe('skipping the motion, and the race of review B1', () => {
  it('any key while the book comes out skips to the end, landing on Read', async () => {
    const motion = deferredAnimations();
    await renderLibrary();
    const dialog = await takeOut();
    expect(dialog.getAttribute('data-book-stage')).toBe('moving'); // not before the motion ends
    expect(within(dialog).queryByRole('button', { name: /^Read / })).not.toBeNull();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dialog.getAttribute('data-book-stage')).toBe('open');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: /^Read / }));
    await motion.finishAll();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('a click while the book comes out skips to the end, and is not also a click outside', async () => {
    deferredAnimations();
    await renderLibrary();
    const dialog = await takeOut();
    const veil = dialog.querySelector('.pt-book__veil') as HTMLElement;
    fireEvent.pointerDown(veil);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dialog.getAttribute('data-book-stage')).toBe('open');
    fireEvent.click(veil); // the release of the same press
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('Esc during the motion skips to the end; a second Esc puts the book back, and it stays back', async () => {
    const motion = deferredAnimations();
    await renderLibrary();
    const dialog = await takeOut();
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dialog.getAttribute('data-book-stage')).toBe('open');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' }); // a third starts nothing more
    await motion.finishAll();
    await motion.finishAll();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(theBook());
    expect(theBook()?.hasAttribute('data-pulled')).toBe(false);
  });

  it('Esc on a book that is open does not bring it back after it has gone', async () => {
    const motion = deferredAnimations();
    await renderLibrary();
    const dialog = await takeOut();
    await motion.finishAll(); // the take-out ends by itself
    await settled(dialog);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Read / })); // too late: it is leaving
    await motion.finishAll();
    await motion.finishAll();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(theBook());
  });
});

describe('focus, the name and the summary', () => {
  it('after Save, focus is on the new name inside the book', async () => {
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: null });
    await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
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
    const dialog = await takeOut();
    await settled(dialog);
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
    const dialog = await takeOut();
    await settled(dialog);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Not now' }));
    expect(window.localStorage.getItem('papertree/book/name-declined/usr_1')).toBe('yes');
    auth.me.mockResolvedValue({ user_id: 'usr_2', email: 'b@example.test', display_name: null });
    await act(() => client.refetchQueries({ queryKey: ['me'] }));
    expect(await within(dialog).findByLabelText('Whose library is this?')).toBeTruthy();
  });

  it('a field with text takes the first Esc; the book stays open', async () => {
    auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: null });
    await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
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
    let dialog = await takeOut();
    await settled(dialog);
    expect(
      await within(dialog).findByText('Summary cached (partial: some points have no passage)'),
    ).toBeTruthy();
    expect(within(dialog).queryByText('Summary ready (cached)')).toBeNull();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    cleanup();
    summary.get.mockResolvedValue({ state: 'none', summary: null });
    await renderLibrary();
    dialog = await takeOut();
    await settled(dialog);
    expect(await within(dialog).findByText('No summary yet')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Summarize' })).toBeTruthy();
  });
});

describe('motion', () => {
  it('plays the take-out as one 880 ms sequence of cover, spine, spread and veil', async () => {
    await renderLibrary();
    const dialog = await takeOut();
    expect(dialog.getAttribute('data-motion')).toBe('full');
    await settled(dialog);
    const durations = animate.mock.calls.map(
      (call) => (call as unknown as [unknown, { duration: number }])[1].duration,
    );
    // The cover, the spine's cloth and the spread each take 880 ms; the veil is in by 280.
    expect(durations.filter((ms) => ms === 880)).toHaveLength(3);
    expect(durations).toContain(280);
    expect(durations).not.toContain(400); // no separate pull-out step any more
    expect(durations).not.toContain(480); // nor a separate opening swing
  });

  it('puts the book back in 420 ms', async () => {
    await renderLibrary();
    const dialog = await takeOut();
    await settled(dialog);
    animate.mockClear();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const durations = animate.mock.calls.map(
      (call) => (call as unknown as [unknown, { duration: number }])[1].duration,
    );
    expect(durations.filter((ms) => ms === 420).length).toBeGreaterThanOrEqual(3);
  });

  it('is a short cross-fade under reduced motion, with nothing moving', async () => {
    setReducedMotion(true);
    await renderLibrary();
    const dialog = await takeOut();
    expect(dialog.getAttribute('data-motion')).toBe('reduced');
    await settled(dialog);
    for (const call of animate.mock.calls) {
      const [keyframes, timing] = call as unknown as [Keyframe[], KeyframeAnimationOptions];
      expect(timing.duration).toBe(120);
      expect(keyframes.every((k) => k.transform === undefined)).toBe(true);
    }
    expect(animate).toHaveBeenCalled();
    expect(dialog.querySelector('.pt-book__flyer, .pt-book__slab')).toBeNull();
  });
});
