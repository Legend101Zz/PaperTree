/**
 * The library's states (#196): Reading now with Continue (frame 01), the empty library's accession
 * slip (01b) and a short library standing face-out (01c). Titles and authors are the corpus
 * papers' own (research/benchmarks/corpus and fresh/pdfs parses), never invented.
 */
import axe from 'axe-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView } from '@/features/library';
import type { LibraryPaper, ReadingProgress } from '@/lib/api/types';
import { useAuthStore } from '@/store/authStore';

import { corpusRows, readingAt } from './library-corpus';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  uploadWithProgress: vi.fn(),
  putReadingState: vi.fn(),
}));
vi.mock('@/lib/api/papers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/papers')>()),
  papersApi: api,
}));

function row(
  id: string,
  title: string,
  authors: string[],
  overrides: Partial<LibraryPaper> = {},
): LibraryPaper {
  return {
    paper_id: id,
    title,
    authors,
    original_filename: `${id}.pdf`,
    source_hash: `sha256:${id}`,
    page_count: 15,
    processing: 'ready',
    job: null,
    generation: 1,
    parser_version: '1.0.0',
    highlight_count: 0,
    created_at: '2026-10-10T10:00:00+00:00',
    updated_at: '2026-10-15T10:00:00+00:00',
    reading: null,
    year: null,
    arxiv_id: null,
    arxiv_category: null,
    thread_count: 0,
    has_summary: false,
    topic: null,
    ...overrides,
  };
}

const ATTENTION = row('ppr_att', 'Attention Is All You Need', ['Ashish Vaswani', 'Noam Shazeer'], {
  year: 2017,
  arxiv_category: 'cs.CL',
  reading: readingAt(3, 15, '2026-10-12T09:00:00Z'),
});
const DDPM = row('ppr_ddpm', 'Denoising Diffusion Probabilistic Models', ['Jonathan Ho'], {
  page_count: 25,
  year: 2020,
  reading: readingAt(8, 25, '2026-10-14T09:00:00Z'),
});
const YOLO = row(
  'ppr_yolo',
  'You Only Look Once: Unified, Real-Time Object Detection',
  ['Joseph Redmon', 'Santosh Divvala', 'Ross Girshick'],
  {
    page_count: 10,
    year: 2015,
    reading: {
      ...readingAt(9, 10, '2026-10-02T09:00:00Z'),
      finished_at: '2026-10-02T10:00:00Z',
      state: 'finished',
    },
  },
);
const RESNET = row('ppr_res', 'Deep Residual Learning for Image Recognition', ['Kaiming He'], {
  page_count: 12,
});

async function renderLibrary(rows: LibraryPaper[]) {
  api.list.mockResolvedValue(rows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
  // The title is there from the start; the shelf, strip or slip once the list has loaded.
  await waitFor(() =>
    expect(screen.queryByRole('status', { name: 'Loading your papers' })).toBeNull(),
  );
  return { ...view, client };
}

/** The server now lists `rows`, and the library reads it again (as a poll would). */
async function serverNowLists(client: QueryClient, rows: LibraryPaper[]): Promise<void> {
  api.list.mockResolvedValue(rows);
  await act(() => client.invalidateQueries({ queryKey: ['papers'] }));
}

const bookOf = (paperId: string) =>
  document.querySelector<HTMLElement>(`button[data-paper-id="${paperId}"]`);

const books = (shelf: HTMLElement) =>
  within(shelf)
    .getAllByRole('button')
    .filter((b) => b.dataset['paperId'] !== undefined);

async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  push.mockReset();
  window.localStorage.clear();
  useAuthStore.setState({
    user: { id: 'u', email: 'mrigesh@example.test' },
    isAuthenticated: true,
    isLoading: false,
    sessionUnverified: false,
    signedOutByUser: false,
  });
});
afterEach(cleanup);

/**
 * The fourteen corpus papers (spines, so the strip stands above them), four of them opened:
 * Attention (p. 4 of 15), FlashAttention (p. 3 of 34), DDPM (p. 9 of 25), Adam (p. 2 of 15), the
 * most recent first in that order, and YOLO finished.
 */
function shelfWithReading(): LibraryPaper[] {
  const rows = corpusRows(14);
  const place: Record<number, ReadingProgress> = {
    0: readingAt(3, 15, '2026-10-14T09:00:00Z'),
    1: readingAt(2, 34, '2026-10-13T09:00:00Z'),
    2: readingAt(8, 25, '2026-10-12T09:00:00Z'),
    6: readingAt(1, 15, '2026-10-11T09:00:00Z'),
    4: { ...readingAt(9, 10, '2026-10-15T09:00:00Z'), state: 'finished', finished_at: 'x' },
  };
  return rows.map((r, i) => ({ ...r, reading: place[i] ?? null }));
}

describe('Reading now', () => {
  it('lists the papers in progress, most recent first, at most three, all counted', async () => {
    await renderLibrary(shelfWithReading());
    const strip = screen.getByRole('region', { name: 'Reading now' });
    const rows = within(strip).getAllByRole('listitem');
    expect(rows.map((r) => r.dataset['readingPaperId'])).toEqual(['ppr_c0', 'ppr_c1', 'ppr_c2']);
    expect(rows[0]?.textContent).toMatch(/Attention Is All You Need.*p\. 4 of 15/);
    expect(rows[1]?.textContent).toMatch(/^FlashAttentionp\. 3 of 34/);
    expect(rows[2]?.textContent).toMatch(/p\. 9 of 25/);
    // The stats line counts every paper in progress, the strip shows three.
    const stats = document.querySelector('.pt-libtitle__stats')?.textContent ?? '';
    expect(stats.replace(/\s+/g, ' ')).toContain('4 reading now');
  });

  it("Continue opens the reader at the server's page, even with no place in this browser", async () => {
    const { container } = await renderLibrary(shelfWithReading());
    const strip = screen.getByRole('region', { name: 'Reading now' });
    fireEvent.click(
      within(strip).getByRole('button', { name: 'Continue reading Attention Is All You Need' }),
    );
    expect(push).toHaveBeenCalledWith('/paper/ppr_c0/read');
    const place = JSON.parse(window.localStorage.getItem('papertree/reader/ppr_c0') ?? 'null');
    expect(place).toMatchObject({ v: 1, page: 3, yPt: 0 });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('keeps the exact line of a place this browser already has on that page', async () => {
    const saved = { v: 1, mode: 'split', zoomMode: { kind: 'fit-width' }, page: 2, yPt: 518 };
    window.localStorage.setItem('papertree/reader/ppr_c1', JSON.stringify(saved));
    await renderLibrary(shelfWithReading());
    fireEvent.click(screen.getByRole('button', { name: 'Continue reading FlashAttention' }));
    expect(push).toHaveBeenCalledWith('/paper/ppr_c1/read');
    expect(JSON.parse(window.localStorage.getItem('papertree/reader/ppr_c1') ?? '')).toEqual(saved);
  });

  it('is absent when nothing is in progress, and on a face-out shelf (01c)', async () => {
    await renderLibrary(corpusRows(14));
    expect(screen.queryByRole('region', { name: 'Reading now' })).toBeNull();
    cleanup();
    // A short shelf carries Continue under each cover instead.
    await renderLibrary([ATTENTION, DDPM]);
    const stats = document.querySelector('.pt-libtitle__stats')?.textContent ?? '';
    expect(stats.replace(/\s+/g, ' ')).toContain('2 reading now');
    expect(screen.queryByRole('region', { name: 'Reading now' })).toBeNull();
  });
});

describe('the empty library', () => {
  it('says "No papers yet", keeps the view tabs, and offers the accession slip', async () => {
    const { container } = await renderLibrary([]);
    await screen.findByRole('heading', { name: 'Drop PDFs here or choose files' });
    expect(document.querySelector('.pt-libtitle__stats')?.textContent).toBe('No papers yet');
    expect(screen.getByRole('button', { name: 'Shelf' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Arrange by' })).toBeNull();
    expect(screen.getByText(/Each paper opens in Source mode straight away\./)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('"choose files" opens the file picker', async () => {
    await renderLibrary([]);
    const input = document.querySelector<HTMLInputElement>('[data-add-papers] input[type="file"]');
    const click = vi.spyOn(input as HTMLInputElement, 'click');
    fireEvent.click(await screen.findByRole('button', { name: 'choose files' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('takes a PDF dropped on the slip', async () => {
    await renderLibrary([]);
    const added = row('ppr_new', 'attention-is-all-you-need', [], { processing: 'queued' });
    api.uploadWithProgress.mockResolvedValue({
      paper_id: 'ppr_new',
      job_id: 'j',
      created: true,
      paper: added,
    });
    const slip = await screen.findByRole('region', { name: 'Drop PDFs here or choose files' });
    const file = new File(['%PDF-1.4 x'], 'attention.pdf', { type: 'application/pdf' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
    act(() => {
      slip.dispatchEvent(drop);
    });
    await waitFor(() => expect(api.uploadWithProgress).toHaveBeenCalledTimes(1));
    expect((api.uploadWithProgress.mock.calls[0] as [File])[0].name).toBe('attention.pdf');
  });
});

describe('a short library stands face-out', () => {
  it('draws covers, one tab stop, the arrows walk them and Enter takes one down', async () => {
    await renderLibrary([ATTENTION, DDPM, YOLO]);
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    const covers = books(shelf);
    expect(covers).toHaveLength(3);
    expect(covers.every((c) => c.classList.contains('pt-cover'))).toBe(true);
    expect(covers.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    covers[0]?.focus();
    fireEvent.keyDown(covers[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(covers[1]);
    fireEvent.keyDown(covers[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(covers[2]);
    fireEvent.click(covers[2] as HTMLElement);
    expect(covers[2]?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-card-paper-id="ppr_yolo"]')).not.toBeNull();
  });

  it('puts Continue, or the state and Open, under each cover by its state', async () => {
    const { container } = await renderLibrary([ATTENTION, YOLO, RESNET]);
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    const continueButton = within(shelf).getByRole('button', {
      name: 'Continue reading Attention Is All You Need',
    });
    expect(continueButton.closest('[data-cover-caption]')?.textContent).toMatch(/p\. 4 of 15/);
    const yolo = within(shelf).getByRole('button', { name: /^Open You Only Look Once/ });
    expect(yolo.closest('[data-cover-caption]')?.textContent).toMatch(/Read/);
    const resnet = within(shelf).getByRole('button', { name: /^Open Deep Residual/ });
    expect(resnet.closest('[data-cover-caption]')?.textContent).toMatch(/Not started/);

    // A caption's controls are ordinary tab stops: the arrows there belong to them.
    resnet.focus();
    fireEvent.keyDown(resnet, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(resnet);
    fireEvent.click(resnet);
    expect(push).toHaveBeenCalledWith('/paper/ppr_res/read');
    fireEvent.click(continueButton);
    expect(push).toHaveBeenLastCalledWith('/paper/ppr_att/read');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('stands thirteen papers as spines again', async () => {
    await renderLibrary(corpusRows(13));
    const spines = books(screen.getByRole('toolbar', { name: 'Shelf' }));
    expect(spines).toHaveLength(13);
    expect(spines.every((s) => s.classList.contains('pt-spine'))).toBe(true);
  });
});

describe('a library of spines (13 to 40 papers) at page level (review S2)', () => {
  it('is one tab stop; the arrows walk it; Enter takes a book down, Esc puts it back', async () => {
    await renderLibrary(corpusRows(13));
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    const spines = books(shelf);
    expect(spines.every((s) => s.classList.contains('pt-spine'))).toBe(true);
    expect(spines.filter((s) => s.tabIndex === 0)).toEqual([spines[0]]);
    spines[0]?.focus();
    fireEvent.keyDown(spines[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(spines[1]);
    fireEvent.keyDown(spines[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(spines[12]);
    fireEvent.click(spines[12] as HTMLElement);
    const card = await screen.findByRole('region', { name: /^Asynchronous Methods/ });
    expect(document.activeElement).toBe(within(card).getByRole('button', { name: /^Read / }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(document.activeElement).toBe(spines[12]);
  });
});

describe('focus survives a change of layout (review B2)', () => {
  async function deleteByCard(paperId: string): Promise<void> {
    fireEvent.click(bookOf(paperId) as HTMLElement);
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-card-paper-id="${paperId}"]`);
      if (found === null) throw new Error('no card');
      return found;
    });
    fireEvent.click(within(card).getByRole('button', { name: /^Delete / }));
    fireEvent.click(within(card).getByRole('button', { name: 'Delete paper' }));
  }

  it('Delete at 13 papers (spines → covers) lands on the next book, now a cover', async () => {
    api.remove.mockResolvedValue(undefined);
    await renderLibrary(corpusRows(13));
    await deleteByCard('ppr_c5');
    await waitFor(() => expect(bookOf('ppr_c6')?.classList.contains('pt-cover')).toBe(true));
    expect(document.activeElement).toBe(bookOf('ppr_c6'));
    expect(bookOf('ppr_c6')?.tabIndex).toBe(0);
  });

  it('Delete of the last book at 13 lands on the one before it', async () => {
    api.remove.mockResolvedValue(undefined);
    await renderLibrary(corpusRows(13));
    await deleteByCard('ppr_c12');
    await waitFor(() => expect(document.activeElement).toBe(bookOf('ppr_c11')));
    expect(bookOf('ppr_c11')?.classList.contains('pt-cover')).toBe(true);
  });

  it('a 13th paper arriving while a cover has focus keeps focus on that paper, now a spine', async () => {
    const { client } = await renderLibrary(corpusRows(12));
    bookOf('ppr_c3')?.focus();
    expect(document.activeElement?.classList.contains('pt-cover')).toBe(true);
    await serverNowLists(client, corpusRows(13));
    await waitFor(() => expect(bookOf('ppr_c3')?.classList.contains('pt-spine')).toBe(true));
    expect(document.activeElement).toBe(bookOf('ppr_c3'));
    expect(bookOf('ppr_c3')?.tabIndex).toBe(0);
  });

  it("a 13th paper arriving while a caption's Continue has focus moves it to that paper", async () => {
    const rows = corpusRows(12).map((row, i) =>
      i === 2 ? { ...row, reading: readingAt(3, 25, '2026-10-14T09:00:00Z') } : row,
    );
    const { client } = await renderLibrary(rows);
    screen.getByRole('button', { name: /^Continue reading Denoising/ }).focus();
    await serverNowLists(client, [...rows, ...corpusRows(13).slice(12)]);
    await waitFor(() => expect(bookOf('ppr_c2')?.classList.contains('pt-spine')).toBe(true));
    expect(document.activeElement).toBe(bookOf('ppr_c2'));
  });

  it('never takes focus from where the person moved it', async () => {
    const { client } = await renderLibrary(corpusRows(12));
    bookOf('ppr_c3')?.focus();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    search.focus();
    await serverNowLists(client, corpusRows(13));
    await waitFor(() => expect(bookOf('ppr_c3')?.classList.contains('pt-spine')).toBe(true));
    expect(document.activeElement).toBe(search);
  });
});

describe('Continue keeps a later place this browser holds (review S1)', () => {
  it('keeps it, sends it to the server again, and opens the reader there', async () => {
    api.putReadingState.mockResolvedValue(undefined);
    const rows = corpusRows(14).map((row, i) =>
      i === 0 ? { ...row, reading: readingAt(2, 15, '2026-10-14T09:00:00Z') } : row,
    );
    // The reader showed p. 10 here, but its write never reached the server (p. 3 there).
    const here = { v: 1, mode: 'source', zoomMode: { kind: 'fit-width' }, page: 9, yPt: 120 };
    window.localStorage.setItem('papertree/reader/ppr_c0', JSON.stringify(here));
    await renderLibrary(rows);
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue reading Attention Is All You Need' }),
    );
    expect(JSON.parse(window.localStorage.getItem('papertree/reader/ppr_c0') ?? '')).toEqual(here);
    expect(api.putReadingState).toHaveBeenCalledWith('ppr_c0', 9, 'source');
    expect(push).toHaveBeenCalledWith('/paper/ppr_c0/read');
  });
});

describe('a library at scale (01f)', () => {
  // happy-dom lays nothing out: give each sideways row 600 px of room and let scrollTo move it.
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('pt-rows__spines') ? 600 : 0;
      },
    });
  });
  afterEach(() => {
    if (width !== undefined) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
  });

  it('stands each row on its own plank with "N of M shown" and a "+n more" bookend', async () => {
    await renderLibrary(corpusRows(60));
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    expect(shelf.classList.contains('pt-rows')).toBe(true);
    expect(books(shelf)).toHaveLength(60);
    const row = within(shelf).getByRole('group', { name: 'Unshelved, 60 papers' });
    const more = within(row).getByRole('button', {
      name: /^\d+ more in Unshelved, scroll sideways$/,
    });
    const after = Number(/^(\d+)/.exec(more.getAttribute('aria-label') ?? '')?.[1]);
    const shown = Number(/(\d+) of 60 shown/.exec(row.textContent ?? '')?.[1]);
    expect(after).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(0);
    expect(shown + after).toBeLessThanOrEqual(60);
    // The stats line drops the pages at scale.
    const stats = document.querySelector('.pt-libtitle__stats')?.textContent ?? '';
    expect(stats.replace(/\s+/g, ' ')).toBe('60 papers');
  });

  it('"+n more" is a tab stop that brings the next spine into view and focus', async () => {
    await renderLibrary(corpusRows(60));
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    const more = within(shelf).getByRole('button', { name: /more in Unshelved/ });
    expect(more.getAttribute('tabindex')).toBeNull(); // a plain button: in the tab order
    const after = Number(/^(\d+)/.exec(more.getAttribute('aria-label') ?? '')?.[1]);
    const scroller = shelf.querySelector<HTMLElement>('.pt-rows__spines') as HTMLElement;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    more.focus();
    // Its arrows are its own; Enter on a button is a click.
    fireEvent.keyDown(more, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    const firstHidden = books(shelf)[60 - after];
    expect(document.activeElement).toBe(firstHidden);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // Focus took the tab stop with it: Tab back into the shelf lands there.
    expect(books(shelf).filter((b) => b.tabIndex === 0)).toEqual([firstHidden]);
  });

  it('a search counts the matches inside the overflow, in the header and on the bookend', async () => {
    await renderLibrary(corpusRows(60));
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    const more = within(shelf).getByRole('button', { name: /more in Unshelved/ });
    const after = Number(/^(\d+)/.exec(more.getAttribute('aria-label') ?? '')?.[1]);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the library' }), {
      target: { value: 'atten' },
    });
    // Attention and FlashAttention, in each of the corpus's repeats: 60 rows hold 10 of them.
    const lit = books(shelf).filter((b) => b.dataset['match'] === 'true');
    expect(lit).toHaveLength(10);
    expect(screen.getByText('10 of 60')).toBeTruthy();
    const here = lit.filter((b) => books(shelf).indexOf(b) >= 60 - after).length;
    expect(here).toBeGreaterThan(0);
    const words = `${String(here)} ${here === 1 ? 'match' : 'matches'} here`;
    expect(more.textContent).toContain(words);
    expect(more.getAttribute('aria-label')).toBe(
      `${String(after)} more in Unshelved, ${words}, scroll sideways`,
    );
  });

  it('keeps the shelf one tab stop across rows, and axe finds nothing', async () => {
    const { container } = await renderLibrary(
      corpusRows(60).map((row, i) => ({ ...row, year: 2014 + (i % 3) })),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Arrange by' }), {
      target: { value: 'year' },
    });
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    expect(within(shelf).getAllByRole('group')).toHaveLength(3);
    expect(books(shelf).filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
  });
});
