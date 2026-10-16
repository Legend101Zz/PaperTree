/**
 * The library page (#195, part 2): the header search ("/" focuses it, Esc clears it, "2 of N",
 * Enter takes down the first match, nothing reorders), the catalogue card (Enter opens it with
 * focus on Read, Esc puts the book back and returns focus to its spine), the stats line and
 * "need a look", Arrange by, the header menus and dropping PDFs anywhere.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView } from '@/features/library';
import type { LibraryPaper } from '@/lib/api/types';
import { useAuthStore } from '@/store/authStore';

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

let seq = 0;
function row(title: string, overrides: Partial<LibraryPaper> = {}): LibraryPaper {
  seq += 1;
  return {
    paper_id: `ppr_${String(seq)}`,
    title,
    authors: ['Ada Author', 'Bo Writer', 'Cy Third'],
    original_filename: `${title}.pdf`,
    source_hash: 'sha256:00',
    page_count: 12,
    processing: 'ready',
    job: null,
    generation: 1,
    parser_version: '1.0.0',
    highlight_count: 0,
    created_at: `2026-10-0${String(seq % 9)}T10:00:00+00:00`,
    updated_at: '2026-10-15T10:00:00+00:00',
    reading: null,
    year: 2017,
    arxiv_id: null,
    arxiv_category: 'cs.CL',
    thread_count: 0,
    has_summary: false,
    ...overrides,
  };
}

const ROWS = (): LibraryPaper[] => {
  seq = 0;
  return [
    row('Attention Is All You Need', {
      reading: {
        last_page: 3,
        furthest_page: 3,
        page_count: 12,
        opened_at: '2026-10-10T00:00:00Z',
        finished_at: null,
        state: 'reading',
      },
    }),
    row('FlashAttention: Fast and Memory-Efficient Exact Attention', { year: 2022 }),
    row('Deep Residual Learning for Image Recognition', { year: 2015 }),
    row('garbage', {
      processing: 'failed',
      page_count: null,
      year: null,
      job: {
        job_id: 'j',
        kind: 'parse',
        state: 'dead_letter',
        step: 'parse',
        done: 0,
        total: 3,
        attempt: 3,
        max_attempts: 3,
        error_code: 'pdf_unreadable',
      },
    }),
  ];
};

async function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
  return screen.findByRole('toolbar', { name: 'Shelf' });
}

const spineOrder = (shelf: HTMLElement) =>
  within(shelf)
    .getAllByRole('button')
    .map((spine) => spine.dataset['paperId']);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  push.mockReset();
  window.localStorage.clear();
  api.list.mockResolvedValue(ROWS());
  useAuthStore.setState({
    user: { id: 'u', email: 'mrigesh@example.test' },
    isAuthenticated: true,
    isLoading: false,
    sessionUnverified: false,
    signedOutByUser: false,
  });
});
afterEach(cleanup);

describe('the header search', () => {
  it('"/" focuses it from anywhere but a field', async () => {
    await renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(search);
  });

  it('lights the matches, dims the rest, counts "2 of 4", reorders nothing, and Esc clears', async () => {
    const shelf = await renderLibrary();
    const before = spineOrder(shelf);
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    fireEvent.change(search, { target: { value: 'atten' } });

    const count = document.getElementById(search.getAttribute('aria-describedby') ?? '');
    expect(count?.getAttribute('role')).toBe('status');
    expect(count?.textContent).toBe('2 of 4');
    expect(spineOrder(shelf)).toEqual(before);
    const lit = within(shelf)
      .getAllByRole('button')
      .filter((spine) => spine.dataset['match'] === 'true')
      .map((spine) => spine.dataset['paperId']);
    expect(lit).toEqual(['ppr_1', 'ppr_2']);
    expect(document.body.textContent).toContain('2 of 4 match “atten”');

    fireEvent.keyDown(search, { key: 'Escape' });
    expect((search as HTMLInputElement).value).toBe('');
    expect(
      within(shelf)
        .getAllByRole('button')
        .every((s) => s.dataset['match'] === undefined),
    ).toBe(true);
  });

  it('Enter takes down the first match', async () => {
    await renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    fireEvent.change(search, { target: { value: 'residual' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    const card = await screen.findByRole('region', {
      name: 'Deep Residual Learning for Image Recognition',
    });
    expect(within(card).getByText('Not started')).toBeTruthy();
  });
});

describe('the catalogue card', () => {
  it('opens on Enter with focus on Read, points at its spine, and Esc puts it back', async () => {
    const shelf = await renderLibrary();
    const spine = within(shelf).getByRole('button', { name: /^Attention Is All You Need/ });
    spine.focus();
    // A native button turns Enter into a click; happy-dom does not, so the click stands for it.
    fireEvent.click(spine);
    const card = await screen.findByRole('region', { name: 'Attention Is All You Need' });
    expect(spine.getAttribute('aria-expanded')).toBe('true');
    expect(spine.getAttribute('aria-controls')).toBe(card.id);
    expect(within(card).getByText('Reading now · p. 4 of 12')).toBeTruthy();
    expect(within(card).getByText('Ada Author et al. · 2017 · 12 pages')).toBeTruthy();
    const read = within(card).getByRole('button', { name: 'Read Attention Is All You Need' });
    expect(document.activeElement).toBe(read);
    // Enter again (on Read) opens the reader.
    fireEvent.click(read);
    expect(push).toHaveBeenCalledWith(`/paper/${spine.dataset['paperId'] ?? ''}/read`);

    fireEvent.keyDown(read, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Attention Is All You Need' })).toBeNull();
    expect(document.activeElement).toBe(spine);
    expect(spine.getAttribute('aria-expanded')).toBe('false');
  });

  it('Esc on the shelf also puts the open book back', async () => {
    const shelf = await renderLibrary();
    const spine = within(shelf).getByRole('button', { name: /^Deep Residual/ });
    fireEvent.click(spine);
    await screen.findByRole('region', { name: /Deep Residual/ });
    spine.focus();
    fireEvent.keyDown(spine, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /Deep Residual/ })).toBeNull();
    expect(document.activeElement).toBe(spine);
  });

  it('a failed paper offers Retry, and Delete is danger, confirmed inline', async () => {
    api.retry.mockResolvedValue({ job_id: 'j2', generation: 2 });
    const shelf = await renderLibrary();
    fireEvent.click(within(shelf).getByRole('button', { name: /^garbage, .*could not read$/ }));
    const card = await screen.findByRole('region', { name: 'garbage' });
    fireEvent.click(within(card).getByRole('button', { name: 'Retry reading garbage' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('ppr_4'));
    const remove = within(card).getByRole('button', { name: 'Delete garbage' });
    expect(remove.className).toContain('pt-button--danger');
    fireEvent.click(remove);
    expect(within(card).getByRole('group', { name: 'Confirm deleting garbage' })).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();
  });
});

describe('the title block', () => {
  it('computes the stats line from the papers and says how many need a look', async () => {
    await renderLibrary();
    expect(screen.getByRole('heading', { level: 1, name: 'Your library' })).toBeTruthy();
    const stats = document.querySelector('.pt-libtitle__stats')?.textContent ?? '';
    expect(stats.replace(/\s+/g, ' ')).toBe('4 papers · 1 reading now · 36 pages');
    expect(stats).not.toMatch(/topic/);
  });

  it('"need a look" filters the shelf to the papers that need one, and back', async () => {
    const shelf = await renderLibrary();
    const alert = screen.getByRole('button', { name: '1 need a look' });
    fireEvent.click(alert);
    expect(alert.getAttribute('aria-pressed')).toBe('true');
    expect(spineOrder(shelf)).toEqual(['ppr_4']);
    fireEvent.click(alert);
    expect(spineOrder(shelf)).toHaveLength(4);
  });

  it('Arrange by Year regroups the shelf; the other views say they are coming', async () => {
    await renderLibrary();
    fireEvent.change(screen.getByRole('combobox', { name: 'Arrange by' }), {
      target: { value: 'year' },
    });
    const groups = screen
      .getAllByRole('group', { name: /papers?$/ })
      .map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual([
      '2015, 1 paper',
      '2017, 1 paper',
      '2022, 1 paper',
      'Year unknown, 1 paper',
    ]);
    const table = screen.getByRole('button', { name: 'Table' });
    expect(table.getAttribute('aria-disabled')).toBe('true');
    expect(table.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(table.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Coming in this release',
    );
  });
});

describe('the header menus', () => {
  it('Aa holds the theme switch; the account menu holds the email and Sign out', async () => {
    await renderLibrary();
    const aa = screen.getByRole('button', { name: 'Reading settings' });
    fireEvent.click(aa);
    expect(aa.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Colour scheme' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Colour scheme' }), { key: 'Escape' });
    expect(aa.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(aa);

    const account = screen.getByRole('button', { name: 'Account: mrigesh@example.test' });
    expect(account.textContent).toBe('M');
    fireEvent.click(account);
    const panel = screen.getByRole('group', { name: 'Account: mrigesh@example.test' });
    expect(within(panel).getByText('mrigesh@example.test')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('drop PDFs anywhere', () => {
  it('a PDF dropped on the window goes up through the same upload path', async () => {
    await renderLibrary();
    const dropped = row('dropped', { paper_id: 'ppr_NEW', processing: 'queued' });
    api.uploadWithProgress.mockResolvedValue({
      paper_id: 'ppr_NEW',
      job_id: 'j',
      created: true,
      paper: dropped,
    });
    // The server lists it from now on, as the real one does after a 202.
    api.list.mockResolvedValue([...ROWS(), dropped]);
    const file = new File(['%PDF-1.4 x'], 'dropped.pdf', { type: 'application/pdf' });
    const transfer = { types: ['Files'], files: [file] };
    const drag = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      return event;
    };
    act(() => {
      window.dispatchEvent(drag('dragenter'));
    });
    expect(document.querySelector('[data-drop-anywhere]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(drag('drop'));
    });
    expect(document.querySelector('[data-drop-anywhere]')).toBeNull();
    await waitFor(() => expect(api.uploadWithProgress).toHaveBeenCalledTimes(1));
    expect((api.uploadWithProgress.mock.calls[0] as [File])[0].name).toBe('dropped.pdf');
    expect(
      await screen.findByRole('button', { name: /^dropped, .*waiting to be read$/ }),
    ).toBeTruthy();
  });
});
