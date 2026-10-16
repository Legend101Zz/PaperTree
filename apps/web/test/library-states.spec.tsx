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
  return view;
}

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
