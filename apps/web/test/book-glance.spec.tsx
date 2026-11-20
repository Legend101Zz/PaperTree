/**
 * The spread's "At a glance" sheet (v0.3 #337; V3-AI-NOTES §5, V3-33, V3-15b, V3-36), through the
 * library page as a person reaches it: take a book out and read its right page. The sheet shows
 * every field (the gist, Problem · Idea · How it works · Results with two large numbers · Limits,
 * Read first, five Words to know) in the AI's tab with a quiet model line; maths is typeset; no page
 * mark at rest, but each block that cites a page is a link to the reader there with a `p. 3 ›` that
 * only hover or focus shows; the abstract folds to two lines ("all of it" unfolds); a sheet that is
 * still being made draws its labels over hairlines and fills in place; "from the start" sits
 * beside Continue. Never "Stands on", never "verified".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  glance: vi.fn(),
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
const topics = vi.hoisted(() => ({ list: vi.fn(() => Promise.resolve([])), ofPaper: vi.fn() }));
vi.mock('@/lib/api/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/topics')>()),
  topicsApi: topics,
}));

const ID = 'ppr_G9AYN750E5MG1NRBMGSQJ4N5JM';
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
const ABSTRACT_TEXT =
  'The dominant sequence transduction models are based on complex recurrent or\n' +
  'convolutional neural networks that include an encoder and a decoder. The best\n' +
  'performing models also connect the encoder and decoder through an attention\n' +
  'mechanism. We propose a new simple network architecture, the Transformer, based\n' +
  'solely on attention mechanisms, dispensing with recurrence and convolutions\n' +
  'entirely. Experiments on two machine translation tasks show these models to be.';

/** Attention's sheet, as the API serves it: pages resolved, maths as `$…$`, caps applied. */
const SHEET = {
  gist: 'Build a translator from attention alone, so every word can look at every other word at once.',
  problem: {
    text: 'Recurrent models read one word at a time, so training cannot run in parallel.',
    page: 2,
  },
  idea: {
    text: 'Drop recurrence. Let attention $\\mathrm{softmax}(QK^T/\\sqrt{d_k})V$ relate all positions.',
    page: 3,
  },
  how: {
    text: 'An encoder and a decoder, six layers each, built from multi-head attention.',
    page: null,
  },
  results: {
    numbers: [
      { value: '28.4', measures: 'BLEU, English-German' },
      { value: '41.8', measures: 'BLEU, English-French' },
    ],
    note: 'The big model trained for 3.5 days on eight GPUs.',
    page: 8,
  },
  limits: { text: 'Cost grows with the square of the sequence length.', page: 10 },
  read_first: '§3 and Figure 1, then §4; skip the references on a first read.',
  words: [
    { term: 'self-attention', gloss: 'each position weighs every other position' },
    { term: 'encoder', gloss: 'reads the input into a representation' },
    { term: 'decoder', gloss: 'writes the output one token at a time' },
    { term: 'BLEU', gloss: 'a translation quality score' },
    { term: 'positional encoding', gloss: 'tells the model where each word sits' },
  ],
  model: 'MiniMax-M3.1-Flash',
  generation: 1,
};

beforeEach(() => {
  push.mockReset();
  api.list.mockResolvedValue([ATTENTION]);
  auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'demo@example.test', display_name: 'M' });
  book.figures.mockResolvedValue([]);
  book.abstract.mockResolvedValue({ text: ABSTRACT_TEXT, page_index: 0, anchor: { id: 'anc' } });
  book.glance.mockResolvedValue({ state: 'ready', glance: SHEET });
  summary.get.mockResolvedValue({ state: 'ready', summary: null });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  window.localStorage.clear();
  window.localStorage.setItem('papertree.session', 'tok_test');
});
afterEach(cleanup);

async function openSpread(): Promise<{ dialog: HTMLElement; client: QueryClient }> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector(`[data-paper-id="${ID}"]`)).not.toBeNull());
  const spine = document.querySelector<HTMLElement>(
    `[aria-label="Your shelf"] [data-paper-id="${ID}"]`,
  ) as HTMLElement;
  spine.focus();
  fireEvent.click(spine);
  const dialog = await screen.findByRole('dialog', { name: 'Attention Is All You Need' });
  await waitFor(() => expect(dialog.getAttribute('data-book-stage')).toBe('open'));
  return { dialog, client };
}

describe('the sheet on the spread', () => {
  it('shows every field under the AI tab with a quiet model line, and nothing the design removed', async () => {
    const { dialog } = await openSpread();
    const sheet = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-glance="ready"]');
      if (found === null) throw new Error('no sheet yet');
      return found;
    });
    const section = within(dialog).getByRole('region', { name: 'Paper at a glance' });
    expect(within(section).getByText('AI')).toBeTruthy();
    expect(within(section).getByText('M3.1 Flash')).toBeTruthy();
    expect(within(sheet).getByText(SHEET.gist)).toBeTruthy();
    for (const label of ['Problem', 'Idea', 'How it works', 'Results', 'Limits', 'Read first']) {
      expect(within(sheet).getByText(label)).toBeTruthy();
    }
    expect(within(sheet).getByText('Words to know')).toBeTruthy();
    expect(within(sheet).getByText(SHEET.problem.text)).toBeTruthy();
    expect(within(sheet).getByText(SHEET.how.text)).toBeTruthy();
    expect(within(sheet).getByText(SHEET.limits.text)).toBeTruthy();
    expect(within(sheet).getByText(SHEET.read_first)).toBeTruthy();
    // Results: two large numbers, each with what it measures, then the note.
    expect(within(sheet).getByText('28.4')).toBeTruthy();
    expect(within(sheet).getByText('BLEU, English-German')).toBeTruthy();
    expect(within(sheet).getByText('41.8')).toBeTruthy();
    expect(within(sheet).getByText(SHEET.results.note)).toBeTruthy();
    // Five words to know, each with its gloss (a tooltip, and words for a screen reader).
    const terms = Array.from(sheet.querySelectorAll<HTMLElement>('.pt-glance__term'));
    expect(terms.map((t) => t.textContent)).toEqual(SHEET.words.map((w) => w.term));
    expect(terms.map((t) => t.getAttribute('title'))).toEqual(SHEET.words.map((w) => w.gloss));
    expect(within(sheet).getByText(': a translation quality score')).toBeTruthy();
    // What V3-33 removed stays removed.
    const text = (sheet.textContent ?? '') + (section.textContent ?? '');
    expect(text).not.toMatch(/stands on|verified|from the paper/i);
  });

  it('typesets the maths in the sheet (KaTeX), never a raw dollar sign', async () => {
    const { dialog } = await openSpread();
    const sheet = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-glance="ready"]');
      if (found === null) throw new Error('no sheet yet');
      return found;
    });
    const maths = sheet.querySelectorAll('.pt-math .katex');
    expect(maths.length).toBe(1);
    expect(maths[0]?.querySelector('annotation')?.textContent).toBe(
      '\\mathrm{softmax}(QK^T/\\sqrt{d_k})V',
    );
    expect(sheet.textContent).not.toContain('$');
  });

  it('puts the page on each block that cites one: a link to the reader there, its p. n › drawn only on hover or focus', async () => {
    const { dialog } = await openSpread();
    const sheet = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-glance="ready"]');
      if (found === null) throw new Error('no sheet yet');
      return found;
    });
    const links = Array.from(sheet.querySelectorAll<HTMLAnchorElement>('a[data-glance-page]'));
    // Problem 2, Idea 3, Results 8, Limits 10: How it works cited nothing, Read first needs no mark.
    expect(links.map((l) => [l.getAttribute('data-glance-page'), l.getAttribute('href')])).toEqual(
      [2, 3, 8, 10].map((page) => [
        String(page),
        `/paper/${ID}/read?from=book&page=${String(page)}`,
      ]),
    );
    const marks = links.map((l) => l.querySelector('.pt-glance__page')?.textContent);
    expect(marks).toEqual(['p. 2 ›', 'p. 3 ›', 'p. 8 ›', 'p. 10 ›']);
    expect(links[0]?.querySelector('.pt-glance__page')?.getAttribute('aria-hidden')).toBe('true');
    // A screen reader hears where each block goes.
    expect(within(links[0] as HTMLElement).getByText(/page 2: show it in the paper/)).toBeTruthy();
    // The block without a page is plain: no link, no mark.
    const how = within(sheet).getByText(SHEET.how.text).closest('.pt-glance__row');
    expect(how?.tagName).toBe('DIV');
    expect(how?.querySelector('.pt-glance__page')).toBeNull();
    expect(sheet.querySelectorAll('.pt-glance__page').length).toBe(4);
    // Focus is the keyboard's hover: the link takes it.
    (links[1] as HTMLElement).focus();
    expect(document.activeElement).toBe(links[1]);
  });

  it('keeps the mark off the page at rest and on only for hover and focus (the stylesheet)', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/book/components/spread.css'),
      'utf8',
    );
    const rest = /\.pt-glance__page \{([^}]+)\}/.exec(css)?.[1] ?? '';
    expect(rest).toMatch(/opacity:\s*0;/);
    const shown =
      /\.pt-glance__row--link:hover \.pt-glance__page,\s*\.pt-glance__row--link:focus-visible \.pt-glance__page \{([^}]+)\}/.exec(
        css,
      )?.[1];
    expect(shown ?? '').toMatch(/opacity:\s*1;/);
  });

  it('folds the abstract to two lines in the paper’s own face; "all of it" unfolds it and "fold it" folds it again', async () => {
    const { dialog } = await openSpread();
    const toggle = await within(dialog).findByRole('button', { name: /all of it/ });
    const fold = dialog.querySelector('.pt-bookdetails__fold') as HTMLElement;
    expect(fold.getAttribute('data-folded')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(fold.id);
    // The whole abstract is in the page, in the paper's register, with the line breaks joined.
    const quote = fold.querySelector('[data-voice="paper"]') as HTMLElement;
    expect(quote.textContent).toMatch(/^“The dominant sequence transduction models/);
    expect(quote.textContent).toMatch(/machine translation tasks show these models to be\.”$/);
    expect(quote.textContent).not.toMatch(/\n/);
    fireEvent.click(toggle);
    expect(fold.getAttribute('data-folded')).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('fold it');
    fireEvent.click(toggle);
    expect(fold.getAttribute('data-folded')).toBe('true');
    // The two lines are the stylesheet's.
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/book/components/spread.css'),
      'utf8',
    );
    expect(css).toMatch(
      /data-folded='true'\] \.pt-bookdetails__excerpt \{[^}]*-webkit-line-clamp: 2;/,
    );
  });

  it('sets the abstract above the sheet: the paper speaks, then the AI', async () => {
    const { dialog } = await openSpread();
    await waitFor(() => expect(dialog.querySelector('[data-glance="ready"]')).not.toBeNull());
    const abstract = dialog.querySelector('.pt-bookdetails__abstract') as HTMLElement;
    const sheet = dialog.querySelector('[data-glance-section]') as HTMLElement;
    expect(abstract.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The abstract is the paper's words and the sheet is not: only the abstract is `paper` voice.
    expect(sheet.querySelector('[data-voice="paper"]')).toBeNull();
  });
});

describe('a sheet that is not there yet', () => {
  it('draws its labels over hairlines and fills in place when it is made; the abstract and Read are there throughout', async () => {
    book.glance.mockResolvedValue({ state: 'making', glance: null });
    const { dialog, client } = await openSpread();
    const making = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-glance="making"]');
      if (found === null) throw new Error('not making yet');
      return found;
    });
    expect(making.getAttribute('aria-busy')).toBe('true');
    // Every label is placed at once, so nothing jumps; the blocks are quiet hairlines, not spinners.
    expect(
      Array.from(making.querySelectorAll('.pt-glance__label')).map((l) => l.textContent),
    ).toEqual([
      'Problem',
      'Idea',
      'How it works',
      'Results',
      'Limits',
      'Read first',
      'Words to know',
    ]);
    expect(making.querySelectorAll('.pt-glance__hairline').length).toBe(7);
    expect(within(making).getByRole('status').textContent).toBe(
      'Writing it now. You can start reading.',
    );
    expect(within(dialog).queryByRole('progressbar', { name: /glance/i })).toBeNull();
    // The abstract is always there, and Continue is live from the first second.
    expect(dialog.querySelector('.pt-bookdetails__abstract')).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: /^Continue at p\. 4 / })).toBeTruthy();
    expect(dialog.querySelector('[data-glance="ready"]')).toBeNull();

    // The next ask finds it made: the sheet takes the labels' places.
    book.glance.mockResolvedValue({ state: 'ready', glance: SHEET });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['book', ID, 'glance'] });
    });
    await waitFor(() => expect(dialog.querySelector('[data-glance="ready"]')).not.toBeNull());
    expect(dialog.querySelector('[data-glance="making"]')).toBeNull();
    expect(within(dialog).getByText(SHEET.gist)).toBeTruthy();
  });

  it('draws the frame without claiming anything while the first answer is on its way', async () => {
    book.glance.mockReturnValue(new Promise(() => undefined));
    const { dialog } = await openSpread();
    const making = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-glance="making"]');
      if (found === null) throw new Error('no frame yet');
      return found;
    });
    expect(making.textContent).not.toMatch(/writing it now/i);
    expect(dialog.querySelector('.pt-bookdetails__abstract')).not.toBeNull();
  });

  it('draws nothing when none is coming or the request fails: the abstract is the page', async () => {
    for (const answer of [
      () => Promise.resolve({ state: 'none', glance: null }),
      () => Promise.reject(new Error('down')),
    ]) {
      book.glance.mockImplementation(answer);
      const { dialog } = await openSpread();
      await waitFor(() => expect(book.glance).toHaveBeenCalled());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(dialog.querySelector('[data-glance-section]')).toBeNull();
      expect(dialog.querySelector('.pt-bookdetails__abstract')).not.toBeNull();
      cleanup();
      book.glance.mockReset();
    }
  });
});

describe('from the start (V3-36)', () => {
  it('is a link beside Continue that opens the reader at page 1', async () => {
    const { dialog } = await openSpread();
    const link = within(dialog).getByRole('link', { name: /^from the start/ });
    expect(link.getAttribute('href')).toBe(`/paper/${ID}/read?from=book&page=1`);
    const row = dialog.querySelector('.pt-bookdetails__actions') as HTMLElement;
    const continueAt = within(dialog).getByRole('button', { name: /^Continue at p\. 4 / });
    expect(row.contains(link) && row.contains(continueAt)).toBe(true);
    expect(continueAt.nextElementSibling).toBe(link);
  });

  it('is not there for a paper not yet started: that one says Read', async () => {
    api.list.mockResolvedValue([{ ...ATTENTION, reading: null }]);
    const { dialog } = await openSpread();
    expect(within(dialog).getByRole('button', { name: /^Read / })).toBeTruthy();
    expect(within(dialog).queryByRole('link', { name: /from the start/ })).toBeNull();
  });
});
